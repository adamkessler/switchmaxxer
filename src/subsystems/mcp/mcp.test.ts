import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  appendMcpParserChunkForTests,
  handleMcpRequestForTests,
  probeGatewayHealthAtHostForTests,
  processMcpBufferForTests,
  runMcpServe
} from "./mcp";
import { recordGatewayHealthProbe } from "../gateway/health-probe-metrics";
import { resetGatewayHealthProbeMetricsForTests } from "../gateway/health-probe-metrics.test-support";
import { handleMcpRequestDispatch } from "./dispatch";
import { mutateConfigDocument as mutateMcpConfigDocument } from "./config-runtime";
import { closeMcpSessionContext } from "./session";
import { ObservabilityService } from "../observability/service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "../observability/store";
import { MASKED_ENV_NAME_SENTINEL } from "../../platform/masked-secret";
import { withLogWriters } from "../../platform/logger";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { sanitizeMcpErrorDetails } from "./errors";
import { buildMcpErrorEnvelope } from "./envelope";
import type { McpSessionContext } from "./types";
import type { McpToolRuntimeDeps } from "./tool-context";
import {
  catalogPathForConfigForTests,
  copyExampleConfigPairForTests,
  readJsonForTests,
  writeSecureJsonForTests
} from "../config/config-file.test-support";

const EXAMPLE_CONFIG_PATH = path.resolve(process.cwd(), "config-examples", "config.example.json");
const EXAMPLE_CONFIG_ENV = {
  SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef",
  SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key",
  SWITCHMAXXER_ANTHROPIC_API_KEY: "test-anthropic-key",
  SWITCHMAXXER_OPENROUTER_API_KEY: "test-openrouter-key",
  SWITCHMAXXER_MINIMAX_API_KEY: "test-minimax-key"
} as const;

const FULL_MCP_CAPABILITIES: Array<"read" | "mutation" | "privileged"> = ["read", "mutation", "privileged"];
const GPT_4O_MINI_COST = {
  input: 0.15,
  output: 0.6,
  cacheRead: 0.075,
  cacheWrite: 0.15
};
const SERIALIZED_GPT_4O_MINI_COST = {
  input: 0.15,
  output: 0.6,
  cache_read: 0.075,
  cache_write: 0.15
};

function createSecureExampleConfigCopy(): { tempDir: string; configPath: string } {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-mcp-config-"));
  const configPath = path.join(tempDir, "config.json");
  copyExampleConfigPairForTests(configPath);
  return { tempDir, configPath };
}

function createSecureExampleConfigCopyWithMcpCapabilities(
  capabilities: Array<"read" | "mutation" | "privileged">
): { tempDir: string; configPath: string } {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-mcp-config-"));
  const configPath = path.join(tempDir, "config.json");
  copyExampleConfigPairForTests(configPath);
  const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  document["mcp"] = {
    capabilities
  };
  writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  chmodSync(configPath, 0o600);
  return { tempDir, configPath };
}

async function withExampleConfigEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(EXAMPLE_CONFIG_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
}

async function withOpenAiLikeLatencyServer<T>(fn: (endpoint: string) => Promise<T>): Promise<T> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let model = "";
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        model = typeof parsed["model"] === "string" ? parsed["model"] : "";
      } catch {
        model = "";
      }

      const delayMs = model.includes("slow") ? 40 : 1;
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop"
            }
          ]
        }));
      }, delayMs);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    return await fn(`http://127.0.0.1:${address.port}/v1/chat/completions`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function callTool(name: string, args?: unknown, configPath?: string): Promise<Record<string, unknown>> {
  const response = await withExampleConfigEnv(async () =>
    await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: typeof args === "undefined" ? { name } : { name, arguments: args }
    }, configPath, typeof configPath === "undefined" ? createFullAccessSessionContext() : undefined)
  );

  return ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
}

async function callToolWithSession(
  name: string,
  args: unknown,
  configPath: string,
  sessionContext: McpSessionContext,
  runtimeDeps?: McpToolRuntimeDeps
): Promise<Record<string, unknown>> {
  const response = await withExampleConfigEnv(async () =>
    await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args
      }
    }, configPath, sessionContext, runtimeDeps)
  );

  return ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
}

function createFullAccessSessionContext(): McpSessionContext {
  return {
    sessionId: "test-full-access-session",
    observabilityHandle: null,
    observabilityHandleDbPath: null,
    observabilityStoreKnownMissing: false,
    grantedCapabilities: new Set(["read", "mutation", "privileged"]),
    abortSignal: new AbortController().signal
  };
}

function createReadOnlySessionContext(): McpSessionContext {
  return {
    sessionId: "test-read-only-session",
    observabilityHandle: null,
    observabilityHandleDbPath: null,
    observabilityStoreKnownMissing: false,
    grantedCapabilities: new Set(["read"]),
    abortSignal: new AbortController().signal
  };
}

function buildMcpFrame(payload: Record<string, unknown>): string {
  return `${JSON.stringify(payload)}\n`;
}

function parseMcpFrames(rawOutput: string): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  for (const line of rawOutput.split("\n")) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    messages.push(JSON.parse(trimmed) as Record<string, unknown>);
  }
  return messages;
}

function mcpServeEnvWithoutProviderSecrets(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const envVar of Object.keys(EXAMPLE_CONFIG_ENV)) {
    delete env[envVar];
  }

  return env;
}

test.beforeEach(() => {
  resetGatewayHealthProbeMetricsForTests();
});

void test("MCP returns a stable success envelope for config_schema", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const payload = await callTool("config_schema", {}, configPath);
    const data = payload["data"] as Record<string, unknown>;

    assert.equal(payload["ok"], true);
    assert.equal(payload["command"], "config schema");
    assert.equal(payload["schema_version"], "1");
    assert.deepEqual(Object.keys(data).sort(), ["entities", "error_codes"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP serve fails closed when the resolved config file is missing", async () => {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-missing-mcp-config-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");
  let loggedStderr = "";

  try {
    const exitCode = await withLogWriters(
      {
        stderr: (message) => {
          loggedStderr += message;
        }
      },
      async () => await runMcpServe(["--config", missingConfigPath])
    );

    assert.equal(exitCode, 2);
    assert.match(loggedStderr, /MCP config file is required and must exist/);
    assert.match(loggedStderr, /missing-config\.json/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP serve initializes and lists read tools without provider runtime env vars", () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read"]);
  const input = [
    buildMcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize"
    }),
    buildMcpFrame({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    })
  ].join("");

  try {
    const result = spawnSync(
      process.execPath,
      ["--enable-source-maps", path.join(process.cwd(), "dist", "index.js"), "mcp", "serve", "--config", configPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: mcpServeEnvWithoutProviderSecrets(),
        input,
        timeout: 5000
      }
    );

    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
    assert.match(result.stderr, /MCP granted capabilities: read/);
    assert.match(result.stderr, /MCP enabled tools: \d+/);
    assert.match(result.stderr, /MCP disabled tools: \d+/);
    assert.doesNotMatch(result.stderr, /requires environment variable/);

    const messages = parseMcpFrames(result.stdout);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.["id"], 1);
    assert.equal(messages[1]?.["id"], 2);

    const toolsResult = messages[1]?.["result"] as Record<string, unknown>;
    const tools = toolsResult["tools"] as Array<Record<string, unknown>>;
    const toolNames = tools.map((tool) => tool["name"]);

    assert.ok(toolNames.includes("config_show"));
    assert.ok(toolNames.includes("trace_verify"));
    assert.ok(toolNames.includes("optimize_list"));
    assert.ok(toolNames.includes("optimize_show"));
    assert.ok(!toolNames.includes("ledger_list"));
    assert.ok(!toolNames.includes("ledger_show"));
    assert.ok(!toolNames.includes("prune"));
    assert.ok(!toolNames.includes("models_create"));
    assert.ok(!toolNames.includes("providers_set_key"));
    assert.ok(!toolNames.includes("bench_run"));
    assert.ok(!toolNames.includes("optimize_run"));
    assert.ok(!toolNames.includes("optimize_apply"));
    assert.ok(!toolNames.includes("optimize_restore"));
    assert.ok(!toolNames.includes("optimize_apply"));
    assert.ok(!toolNames.includes("optimize_restore"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP returns the redacted config document for config_show", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const payload = await callTool("config_show", {}, configPath);
    const data = payload["data"] as Record<string, unknown>;
    const document = data["document"] as Record<string, unknown>;
    const providers = document["service_providers"] as Record<string, unknown>;
    const openaiDirect = providers["openai_direct"] as Record<string, unknown>;

    assert.equal(payload["ok"], true);
    assert.equal(payload["command"], "config show");
    assert.equal(payload["schema_version"], "1");
    assert.equal(data["source_file"], "config.json");
    assert.equal(typeof document, "object");
    assert.equal(openaiDirect["api_key"], undefined);
    assert.equal(openaiDirect["api_key_env"], "SWITCHMAXXER_OPENAI_API_KEY");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP returns the configured models on the models_list happy path", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const payload = await callTool("models_list", {}, configPath);
    const data = payload["data"] as Array<Record<string, unknown>>;
    const firstModel = data.find((model) => model["name"] === "gpt-4o-mini");

    assert.equal(payload["ok"], true);
    assert.equal(payload["command"], "models list");
    assert.equal(payload["schema_version"], "1");
    assert.equal(payload["count"], data.length);
    assert.ok(data.length > 0);
    assert.deepEqual(firstModel, {
      name: "gpt-4o-mini",
      display_name: "GPT-4o-Mini",
      model_creator: "openai",
      route_count: 2,
      cost: GPT_4O_MINI_COST
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP returns the configured providers on the providers_list happy path", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const payload = await callTool("providers_list", {}, configPath);
    const data = payload["data"] as Array<Record<string, unknown>>;
    const openaiDirect = data.find((provider) => provider["name"] === "openai_direct");

    assert.equal(payload["ok"], true);
    assert.equal(payload["command"], "providers list");
    assert.equal(payload["schema_version"], "1");
    assert.equal(payload["count"], data.length);
    assert.ok(data.length > 0);
    assert.deepEqual(openaiDirect, {
      name: "openai_direct",
      api_mode: "openai-completions",
      endpoint: "https://api.openai.com/v1/chat/completions",
      allow_private_endpoints: false,
      allow_insecure_http: false,
      anthropic_version: null,
      model_id_format: "passthrough",
      auth_source: "env var",
      api_key_env: MASKED_ENV_NAME_SENTINEL,
      api_key: null
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP returns the configured routes on the routes_list happy path", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const payload = await callTool("routes_list", {}, configPath);
    const data = payload["data"] as Array<Record<string, unknown>>;
    const route = data.find((entry) => entry["name"] === "gpt-4o-mini");

    assert.equal(payload["ok"], true);
    assert.equal(payload["command"], "routes list");
    assert.equal(payload["schema_version"], "1");
    assert.equal(payload["count"], data.length);
    assert.ok(data.length > 0);
    assert.deepEqual(route, {
      name: "gpt-4o-mini",
      display_name: "GPT-4o-Mini",
      model: "gpt-4o-mini",
      service_provider: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      api_mode: "openai-completions",
      timeout_ms: null,
      effective_timeout_ms: 15000,
      cost: GPT_4O_MINI_COST,
      model_cost: GPT_4O_MINI_COST,
      effective_cost: GPT_4O_MINI_COST
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP supports a successful models mutation lifecycle", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);

  try {
    const createPayload = await callTool("models_create", {
      model_id: "mcp-happy-path-model",
      display_name: "MCP Happy Path Model",
      model_creator: "switchmaxxer"
    }, configPath);
    const createData = createPayload["data"] as Record<string, unknown>;

    assert.equal(createPayload["ok"], true);
    assert.equal(createPayload["command"], "models create");
    assert.equal(createPayload["schema_version"], "1");
    assert.deepEqual(createData, {
      name: "mcp-happy-path-model",
      display_name: "MCP Happy Path Model",
      model_creator: "switchmaxxer",
      route_count: 0,
      cost: null
    });

    const showPayload = await callTool("models_show", {
      model_id: "mcp-happy-path-model"
    }, configPath);
    const showData = showPayload["data"] as Record<string, unknown>;

    assert.equal(showPayload["ok"], true);
    assert.equal(showPayload["command"], "models show");
    assert.equal(showData["name"], "mcp-happy-path-model");
    assert.equal(showData["display_name"], "MCP Happy Path Model");
    assert.equal(showData["model_creator"], "switchmaxxer");

    const deletePayload = await callTool("models_delete", {
      model_id: "mcp-happy-path-model"
    }, configPath);

    assert.equal(deletePayload["ok"], true);
    assert.equal(deletePayload["command"], "models delete");
    assert.deepEqual(deletePayload["data"], {
      name: "mcp-happy-path-model",
      deleted: true
    });

    const writtenConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
      models?: Record<string, unknown>;
    };
    assert.equal(writtenConfig.models?.["mcp-happy-path-model"], undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP model mutations write to catalog.json", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
    const createPayload = await callTool("models_create", {
      model_id: "mcp-catalog-model",
      display_name: "MCP Catalog Model",
      model_creator: "switchmaxxer"
    }, configPath);

    assert.equal(createPayload["ok"], true);
    assert.equal(createPayload["command"], "models create");

    const writtenConfig = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const writtenCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      models?: Record<string, unknown>;
    };

    assert.equal(writtenConfig["models"], undefined);
    assert.deepEqual(writtenCatalog.models?.["mcp-catalog-model"], {
      display_name: "MCP Catalog Model",
      model_creator: "switchmaxxer"
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP supports a successful routes mutation lifecycle", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);

  try {
    const createPayload = await callTool("routes_create", {
      route_id: "mcp-happy-path-route",
      model: "gpt-4o-mini",
      service_provider: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      display_name: "MCP Happy Path Route"
    }, configPath);
    const createData = createPayload["data"] as Record<string, unknown>;

    assert.equal(createPayload["ok"], true);
    assert.equal(createPayload["command"], "routes create");
    assert.deepEqual(createData, {
      name: "mcp-happy-path-route",
      display_name: "MCP Happy Path Route",
      model: "gpt-4o-mini",
      service_provider: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      api_mode: "openai-completions",
      timeout_ms: null,
      effective_timeout_ms: 15000,
      cost: null,
      model_cost: GPT_4O_MINI_COST,
      effective_cost: GPT_4O_MINI_COST
    });

    const updatePayload = await callTool("routes_update", {
      route_id: "mcp-happy-path-route",
      display_name: "MCP Happy Path Route Updated",
      timeout_ms: 20000
    }, configPath);
    const updateData = updatePayload["data"] as Record<string, unknown>;

    assert.equal(updatePayload["ok"], true);
    assert.equal(updatePayload["command"], "routes update");
    assert.equal(updateData["display_name"], "MCP Happy Path Route Updated");
    assert.equal(updateData["timeout_ms"], 20000);
    assert.equal(updateData["effective_timeout_ms"], 20000);

    const deletePayload = await callTool("routes_delete", {
      route_id: "mcp-happy-path-route"
    }, configPath);

    assert.equal(deletePayload["ok"], true);
    assert.equal(deletePayload["command"], "routes delete");
    assert.deepEqual(deletePayload["data"], {
      name: "mcp-happy-path-route",
      deleted: true
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP rejects config paths that escape the bounded config root", async () => {
  await assert.rejects(
    async () => await callTool("config_show", {}, "/tmp/switchmaxxer-outside-config.json"),
    /escapes the allowed config root/
  );
});

void test("MCP rejects config symlinks that resolve outside the bounded config root", async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-mcp-outside-config-"));
  const insideDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-mcp-symlink-"));
  const outsideConfigPath = path.join(outsideDir, "config.json");
  const symlinkPath = path.join(insideDir, "config.json");

  try {
    writeFileSync(outsideConfigPath, readFileSync(EXAMPLE_CONFIG_PATH, "utf8"), "utf8");
    symlinkSync(outsideConfigPath, symlinkPath);

    await assert.rejects(
      async () => await callTool("config_show", {}, symlinkPath),
      /resolves outside the allowed config root/
    );
  } finally {
    rmSync(insideDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

void test("MCP sanitizes unexpected lower-level tool failures instead of mirroring raw internal details", async () => {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-mcp-missing-config-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const payload = await callTool("config_show", {}, missingConfigPath);
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(error["code"], "tool_execution_error");
    assert.equal(error["message"], "Tool execution failed: see server logs for details.");
    assert.doesNotMatch(JSON.stringify(payload), /missing-config\.json/);
    assert.doesNotMatch(JSON.stringify(payload), /\/home\//);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP dispatch converts unexpected raw tool-builder throws into the generic tool execution envelope", async () => {
  const response = await handleMcpRequestDispatch(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "config_schema",
        arguments: {}
      }
    },
    {
      protocolVersion: "2024-11-05",
      serverName: "switchmaxxer",
      serverVersion: "0.0.2",
      buildToolPayload: async () => {
        throw new Error("builder exploded with secret-path details");
      }
    }
  );

  const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
  const error = structuredContent["error"] as Record<string, unknown>;

  assert.equal(response.isNotification, false);
  assert.equal(structuredContent["ok"], false);
  assert.equal(structuredContent["command"], "mcp tool call");
  assert.equal(error["code"], "tool_execution_error");
  assert.equal(error["message"], "Tool execution failed: see server logs for details.");
  assert.doesNotMatch(JSON.stringify(structuredContent), /builder exploded/);
  assert.doesNotMatch(JSON.stringify(structuredContent), /secret-path details/);
});

void test("MCP rejects non-object tool arguments before dispatch", async () => {
  const payload = await callTool("config_schema", ["not-an-object"]);
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_tool_input");
  assert.equal(error["message"], "Tool arguments must be a JSON object when provided");
});

void test("MCP preserves typed schema validation codes for invalid tool input", async () => {
  const payload = await callTool("config_schema", {
    extra_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'extra_field' is not allowed");
});

void test("MCP returns a stable tool-not-found envelope for unknown tool names", async () => {
  const payload = await callTool("definitely_missing_tool");
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "tool_not_found");
  assert.match(error["message"] as string, /definitely_missing_tool/);
});

void test("MCP rejects unknown fields at the typed models_create boundary", async () => {
  const payload = await callTool("models_create", {
    model_id: "demo-model",
    display_name: "Demo Model",
    model_creator: "openai",
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP rejects unknown nested cost fields at the typed models_create boundary", async () => {
  const payload = await callTool("models_create", {
    model_id: "demo-model",
    display_name: "Demo Model",
    model_creator: "openai",
    cost: {
      input: 0.1,
      output: 0.2,
      cache_read: 0.05,
      cache_write: 0.05,
      extra_field: 123
    }
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'cost.extra_field' is not allowed");
});

void test("MCP preserves missing_update_fields when models_update has no typed update payload", async () => {
  const payload = await callTool("models_update", {
    model_id: "demo-model"
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "missing_update_fields");
  assert.equal(
    error["message"],
    "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
  );
});

void test("MCP rejects unknown fields at the typed providers_create boundary", async () => {
  const payload = await callTool("providers_create", {
    provider_id: "demo-provider",
    endpoint: "https://example.invalid/v1",
    api_mode: "openai-completions",
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP rejects auth fields at the typed providers_create boundary", async () => {
  const payload = await callTool("providers_create", {
    provider_id: "demo-provider",
    endpoint: "https://example.invalid/v1",
    api_mode: "openai-completions",
    api_key_env: "SWITCHMAXXER_DEMO_PROVIDER_KEY"
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'api_key_env' is not allowed");
});

void test("MCP rejects reserved provider_id values at the typed providers_create boundary", async () => {
  for (const reservedKey of ["__proto__", "constructor", "prototype", "__defineGetter__", "hasOwnProperty"]) {
    const payload = await callTool("providers_create", {
      provider_id: reservedKey,
      endpoint: "https://example.invalid/v1",
      api_mode: "openai-completions"
    });
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(error["code"], "invalid_input_field");
    assert.equal(error["message"], `field 'provider_id' '${reservedKey}' is reserved and cannot be used.`);
  }
});

void test("MCP rejects reserved provider_id values at the typed providers_set_key boundary", async () => {
  for (const reservedKey of ["__proto__", "constructor", "prototype", "__defineGetter__", "hasOwnProperty"]) {
    const payload = await callTool("providers_set_key", {
      provider_id: reservedKey,
      api_key: "sk-demo-secret"
    });
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(error["code"], "invalid_input_field");
    assert.equal(error["message"], `field 'provider_id' '${reservedKey}' is reserved and cannot be used.`);
  }
});

void test("MCP rejects unknown fields at the typed routes_create boundary", async () => {
  const payload = await callTool("routes_create", {
    route_id: "demo-route",
    model: "demo-model",
    service_provider: "demo-provider",
    provider_model_id: "provider-model",
    display_name: "Demo Route",
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP rejects unknown nested cost fields at the typed routes_create boundary", async () => {
  const payload = await callTool("routes_create", {
    route_id: "demo-route",
    model: "demo-model",
    service_provider: "demo-provider",
    provider_model_id: "demo-provider-model",
    display_name: "Demo Route",
    cost: {
      input: 0.1,
      output: 0.2,
      cache_read: 0.05,
      cache_write: 0.05,
      mystery_field: 123
    }
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'cost.mystery_field' is not allowed");
});

void test("MCP preserves missing_update_fields when routes_update has no typed update payload", async () => {
  const payload = await callTool("routes_update", {
    route_id: "demo-route"
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "missing_update_fields");
  assert.equal(
    error["message"],
    "Provide at least one update field for 'routes update': 'model', 'service_provider', 'provider_model_id', 'display_name', 'timeout_ms', or 'cost'"
  );
});

void test("MCP rejects reserved route_id values at the typed routes_create boundary", async () => {
  for (const reservedKey of ["__proto__", "constructor", "prototype", "__defineGetter__", "hasOwnProperty"]) {
    const payload = await callTool("routes_create", {
      route_id: reservedKey,
      model: "demo-model",
      service_provider: "demo-provider",
      provider_model_id: "provider-model",
      display_name: "Demo Route"
    });
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(error["code"], "invalid_input_field");
    assert.equal(error["message"], `field 'route_id' '${reservedKey}' is reserved and cannot be used.`);
  }
});

void test("MCP rejects unknown fields at the typed trace_list boundary", async () => {
  const payload = await callTool("trace_list", {
    route_id: "demo-route",
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP preserves trace_verify scope validation at the typed boundary", async () => {
  const payload = await callTool("trace_verify", {
    trace_id: "trace-123",
    all: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "Use either '<trace-id>' or '--all', not both");
});

void test("MCP preserves trace_repair batch_size scope validation at the typed boundary", async () => {
  const payload = await callTool("trace_repair", {
    trace_id: "trace-123",
    batch_size: 10
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "Flag '--batch-size' is only supported with '--all'");
});

void test("MCP prune uses the canonical whole-store retention envelope", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(tempDir, "missing-observability.sqlite");
    const payload = await callTool("prune", {
      older_than: "30d"
    }, configPath);
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(payload["ok"], false);
    assert.equal(payload["command"], "prune");
    assert.equal(error["code"], "prune_error");
    assert.match(error["message"] as string, /Observability store was not found/);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP rejects unknown fields at the typed gateway_health boundary", async () => {
  const payload = await callTool("gateway_health", {
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP preserves gateway_health check validation at the typed boundary", async () => {
  const payload = await callTool("gateway_health", {
    check: "not-a-real-check"
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'check' must be one of: gateway, config, providers, routes, all");
});

void test("MCP rejects unknown fields at the typed bench_list boundary", async () => {
  const payload = await callTool("bench_list", {
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP rejects unknown fields at the typed optimize_list boundary", async () => {
  const payload = await callTool("optimize_list", {
    unexpected_field: true
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "field 'unexpected_field' is not allowed");
});

void test("MCP ledger_list and ledger_show expose privileged scoped Ledger reads", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const sessionContext = createFullAccessSessionContext();

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    service.controlPlaneActions.createEvent({
      id: "ledger-mcp-read-test",
      created_at: "2026-04-27T10:00:00.000Z",
      finished_at: "2026-04-27T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "mcp",
      actor_kind: "agent",
      actor_id: null,
      session_id: sessionContext.sessionId,
      operation: "optimize_restore",
      status: "dry_run_succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: "run-ledger-mcp",
      mutation_event_id: null,
      correlation_ids_json: "{\"schema_version\":\"1\",\"run_id\":\"run-ledger-mcp\"}",
      result_json: "{\"schema_version\":\"1\",\"dry_run\":true}",
      error_json: "{}",
      metadata_json: "{\"schema_version\":\"1\",\"selector\":\"own_session\"}"
    });
    closeObservabilityStore(store);

    const listPayload = await callToolWithSession("ledger_list", {
      own_session: true,
      status: "dry_run_succeeded"
    }, configPath, sessionContext);
    const listData = listPayload["data"] as Record<string, unknown>;
    const filters = listData["filters"] as Record<string, unknown>;
    const events = listData["events"] as Array<Record<string, unknown>>;

    assert.equal(listPayload["ok"], true);
    assert.equal(listPayload["command"], "ledger list");
    assert.equal(listPayload["count"], 1);
    assert.equal(filters["session_id"], sessionContext.sessionId);
    assert.equal(events[0]?.["ledger_event_id"], "ledger-mcp-read-test");
    assert.equal(events[0]?.["operation"], "optimize_restore");
    assert.equal(events[0]?.["status"], "dry_run_succeeded");
    assert.equal(Object.hasOwn(events[0] ?? {}, "result"), false);

    const showPayload = await callToolWithSession("ledger_show", {
      ledger_event_id: "ledger-mcp-read-test"
    }, configPath, sessionContext);
    const showData = showPayload["data"] as Record<string, unknown>;
    const event = showData["event"] as Record<string, unknown>;
    const result = event["result"] as Record<string, unknown>;
    const metadata = event["metadata"] as Record<string, unknown>;
    assert.equal(showPayload["ok"], true);
    assert.equal(showPayload["command"], "ledger show");
    assert.equal(event["ledger_event_id"], "ledger-mcp-read-test");
    assert.equal(result["dry_run"], true);
    assert.equal(metadata["selector"], "own_session");
  } finally {
    closeMcpSessionContext(sessionContext);
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP optimize_run requires a prompt for latency optimization", async () => {
  const payload = await callTool("optimize_run", {
    model: "gpt-4o-mini",
    objective: "latency"
  });
  const error = payload["error"] as Record<string, unknown>;

  assert.equal(error["code"], "invalid_input_field");
  assert.equal(error["message"], "Tool 'optimize_run' requires non-empty 'prompt' when objective is 'latency'.");
});

void test("MCP optimize_run persists cost recommendations and optimize_list/show round-trip them", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const sessionContext = createFullAccessSessionContext();

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const models = catalog["models"] as Record<string, Record<string, unknown>>;
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    const directRoute = routes["gpt-4o-mini"];
    if (directRoute) {
      delete directRoute["cost"];
    }
    models["gpt-4o-mini"] = {
      ...(models["gpt-4o-mini"] ?? {}),
      cost: SERIALIZED_GPT_4O_MINI_COST
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      cost: {
        input: 0.3,
        output: 1.2,
        cache_read: 0.15,
        cache_write: 0.3
      }
    };
    writeSecureJsonForTests(catalogPath, catalog);
    const beforeCatalogText = readFileSync(catalogPath, "utf8");

    const runPayload = await callToolWithSession("optimize_run", {
      model: "gpt-4o-mini",
      objective: "cost",
      input_tokens: 1000,
      output_tokens: 1000
    }, configPath, sessionContext);
    const runData = runPayload["data"] as Record<string, unknown>;
    const run = runData["run"] as Record<string, unknown>;
    const winner = runData["winner"] as Record<string, unknown>;

    assert.equal(runPayload["ok"], true);
    assert.equal(runPayload["command"], "optimize");
    assert.equal(runPayload["count"], 2);
    assert.equal(run["persisted"], true);
    assert.equal(run["created_by"], "switchmaxxer mcp optimize");
    assert.equal(run["target_model"], "gpt-4o-mini");
    assert.equal(winner["route_id"], "gpt-4o-mini");
    assert.equal(readFileSync(catalogPath, "utf8"), beforeCatalogText);

    const runId = run["run_id"] as string;
    assert.ok(runId);

    const listPayload = await callToolWithSession("optimize_list", {
      limit: 5
    }, configPath, sessionContext);
    const listData = listPayload["data"] as Record<string, unknown>;
    const listedRuns = listData["runs"] as Array<Record<string, unknown>>;
    assert.equal(listPayload["ok"], true);
    assert.equal(listPayload["command"], "optimize list");
    assert.equal(listPayload["count"], 1);
    assert.equal(listedRuns[0]?.["run_id"], runId);
    assert.equal(listedRuns[0]?.["winner_route"], "gpt-4o-mini");

    const showPayload = await callToolWithSession("optimize_show", {
      run_id: runId
    }, configPath, sessionContext);
    const showData = showPayload["data"] as Record<string, unknown>;
    const shownRun = showData["run"] as Record<string, unknown>;
    assert.equal(showPayload["ok"], true);
    assert.equal(showPayload["command"], "optimize show");
    assert.equal(showPayload["count"], 2);
    assert.equal(shownRun["run_id"], runId);
    assert.equal((showData["winner"] as Record<string, unknown>)["route_id"], "gpt-4o-mini");
  } finally {
    closeMcpSessionContext(sessionContext);
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP optimize_apply and optimize_restore mutate a route provider with managed restore snapshots", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(FULL_MCP_CAPABILITIES);
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const sessionContext = createFullAccessSessionContext();

  function routeProvider(routeId: string): string {
    const catalog = readJsonForTests(catalogPathForConfigForTests(configPath));
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    return routes[routeId]?.["service_provider"] as string;
  }

  function makeOpenrouterCheapest(): void {
    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    routes["gpt-4o-mini"] = {
      ...(routes["gpt-4o-mini"] ?? {}),
      cost: {
        input: 9,
        output: 9,
        cache_read: 9,
        cache_write: 9
      }
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      cost: {
        input: 0.01,
        output: 0.01,
        cache_read: 0.01,
        cache_write: 0.01
      }
    };
    writeSecureJsonForTests(catalogPath, catalog);
  }

  const postActionCalls: Array<{ kind: "reload" | "verify"; operation: "apply" | "restore"; routeId?: string }> = [];
  const runtimeDeps: McpToolRuntimeDeps = {
    optimizePostActions: {
      runOptimizeApplyReload: async (options) => {
        postActionCalls.push({ kind: "reload", operation: options.operation ?? "apply" });
        return {
          requested: true,
          status: "succeeded",
          exit_code: 0,
          command: "gateway reload",
          message: null
        };
      },
      runOptimizeApplyVerify: async (options) => {
        postActionCalls.push({
          kind: "verify",
          operation: options.operation ?? "apply",
          routeId: options.routeId
        });
        return {
          requested: true,
          status: "passed",
          exit_code: 0,
          command: "test",
          route_id: options.routeId,
          message: null
        };
      }
    }
  };

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    assert.equal(routeProvider("gpt-4o-mini"), "openai_direct");
    makeOpenrouterCheapest();

    const runPayload = await callToolWithSession("optimize_run", {
      model: "gpt-4o-mini",
      objective: "cost"
    }, configPath, sessionContext);
    const runData = runPayload["data"] as Record<string, unknown>;
    const run = runData["run"] as Record<string, unknown>;
    const winner = runData["winner"] as Record<string, unknown>;
    assert.equal(runPayload["ok"], true);
    assert.equal(winner["route_id"], "openrouter-gpt-4o-mini");
    const runId = run["run_id"] as string;

    const dryRunApplyPayload = await callToolWithSession("optimize_apply", {
      run_id: runId,
      route_id: "gpt-4o-mini",
      dry_run: true
    }, configPath, sessionContext);
    const dryRunApplyData = dryRunApplyPayload["data"] as Record<string, unknown>;
    assert.equal(dryRunApplyPayload["ok"], true);
    assert.equal(dryRunApplyPayload["command"], "optimize apply");
    assert.equal(dryRunApplyData["dry_run"], true);
    assert.equal(dryRunApplyData["changed"], true);
    assert.equal(dryRunApplyData["snapshot"], null);
    assert.deepEqual(dryRunApplyData["mutation"], {
      field: "service_provider",
      from: "openai_direct",
      to: "openrouter",
      service_provider: {
        changed: true,
        from: "openai_direct",
        to: "openrouter"
      },
      provider_model_id: {
        changed: true,
        from: "gpt-4o-mini",
        to: "openai/gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: {
          input: 9,
          output: 9,
          cache_read: 9,
          cache_write: 9
        },
        to: {
          input: 0.01,
          output: 0.01,
          cache_read: 0.01,
          cache_write: 0.01
        }
      }
    });
    assert.equal(routeProvider("gpt-4o-mini"), "openai_direct");
    const dryRunLedgerDb = new DatabaseSync(dbPath);
    const dryRunLedgerRow = dryRunLedgerDb
      .prepare(
        `
          SELECT source_surface, actor_kind, session_id, operation, status, target_id, optimization_run_id, mutation_event_id
          FROM control_plane_action_events
          WHERE operation = 'optimize_apply'
            AND status = 'dry_run_succeeded'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get() as {
        source_surface?: string;
        actor_kind?: string;
        session_id?: string;
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
        mutation_event_id?: string | null;
      } | undefined;
    dryRunLedgerDb.close();
    assert.equal(dryRunLedgerRow?.source_surface, "mcp");
    assert.equal(dryRunLedgerRow?.actor_kind, "agent");
    assert.equal(dryRunLedgerRow?.session_id, sessionContext.sessionId);
    assert.equal(dryRunLedgerRow?.operation, "optimize_apply");
    assert.equal(dryRunLedgerRow?.status, "dry_run_succeeded");
    assert.equal(dryRunLedgerRow?.mutation_event_id, null);

    const missingPostActionsPayload = await callToolWithSession("optimize_apply", {
      run_id: runId,
      route_id: "gpt-4o-mini",
      reload: true,
      verify: true
    }, configPath, sessionContext);
    const missingPostActionsError = missingPostActionsPayload["error"] as Record<string, unknown>;
    const missingPostActionsDetails = missingPostActionsPayload["details"] as Record<string, unknown>;
    assert.equal(missingPostActionsPayload["ok"], false);
    assert.equal(missingPostActionsPayload["command"], "optimize apply");
    assert.equal(missingPostActionsError["code"], APP_ERROR_CODES.optimizePostActionsUnavailable);
    assert.match(String(missingPostActionsError["message"]), /optimizePostActions/);
    assert.deepEqual(missingPostActionsDetails["requested_actions"], ["reload", "verify"]);
    assert.equal(missingPostActionsDetails["required_dependency"], "optimizePostActions");
    assert.equal(routeProvider("gpt-4o-mini"), "openai_direct");

    const applyPayload = await callToolWithSession("optimize_apply", {
      run_id: runId,
      route_id: "gpt-4o-mini",
      reload: true,
      verify: true
    }, configPath, sessionContext, runtimeDeps);
    const applyData = applyPayload["data"] as Record<string, unknown>;
    const applySnapshot = applyData["snapshot"] as Record<string, unknown>;
    const applyActionId = applyData["action_id"] as string;
    const applyReload = applyData["reload"] as Record<string, unknown>;
    const applyVerification = applyData["verification"] as Record<string, unknown>;
    assert.equal(applyPayload["ok"], true);
    assert.equal(applyData["dry_run"], false);
    assert.equal(applyData["changed"], true);
    assert.equal(applyReload["status"], "succeeded");
    assert.equal(applyVerification["status"], "passed");
    assert.deepEqual(applyData["warnings"], []);
    assert.equal(typeof applyActionId, "string");
    assert.equal((applyData["after"] as Record<string, unknown>)["service_provider"], "openrouter");
    assert.equal(routeProvider("gpt-4o-mini"), "openrouter");
    assert.equal(typeof applySnapshot["snapshot_id"], "string");
    assert.equal(applySnapshot["source_path"], catalogPathForConfigForTests(configPath));
    const applyLedgerDb = new DatabaseSync(dbPath);
    const applyLedgerRow = applyLedgerDb
      .prepare("SELECT source_surface, actor_kind, session_id, operation, status, result_json FROM control_plane_action_events WHERE mutation_event_id = ?")
      .get(applyActionId) as {
        source_surface?: string;
        actor_kind?: string;
        session_id?: string;
        operation?: string;
        status?: string;
        result_json?: string;
      } | undefined;
    applyLedgerDb.close();
    assert.equal(applyLedgerRow?.source_surface, "mcp");
    assert.equal(applyLedgerRow?.actor_kind, "agent");
    assert.equal(applyLedgerRow?.session_id, sessionContext.sessionId);
    assert.equal(applyLedgerRow?.operation, "optimize_apply");
    assert.equal(applyLedgerRow?.status, "succeeded");
    const applyLedgerResult = JSON.parse(applyLedgerRow?.result_json ?? "{}") as Record<string, unknown>;
    assert.equal((applyLedgerResult["reload"] as Record<string, unknown>)["status"], "succeeded");
    assert.equal((applyLedgerResult["verification"] as Record<string, unknown>)["status"], "passed");

    const dryRunRestorePayload = await callToolWithSession("optimize_restore", {
      action_id: applyActionId,
      dry_run: true
    }, configPath, sessionContext);
    assert.equal(dryRunRestorePayload["ok"], true, JSON.stringify(dryRunRestorePayload));
    const dryRunRestoreData = dryRunRestorePayload["data"] as Record<string, unknown>;
    const dryRunRestorePoint = dryRunRestoreData["restore_point"] as Record<string, unknown>;
    assert.equal(dryRunRestorePayload["command"], "optimize restore");
    assert.equal(dryRunRestoreData["dry_run"], true);
    assert.equal(dryRunRestoreData["changed"], true);
    assert.equal(dryRunRestorePoint["action_id"], applyActionId);
    assert.deepEqual(dryRunRestoreData["mutation"], {
      field: "service_provider",
      from: "openrouter",
      to: "openai_direct",
      service_provider: {
        changed: true,
        from: "openrouter",
        to: "openai_direct"
      },
      provider_model_id: {
        changed: true,
        from: "openai/gpt-4o-mini",
        to: "gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: {
          input: 0.01,
          output: 0.01,
          cache_read: 0.01,
          cache_write: 0.01
        },
        to: {
          input: 9,
          output: 9,
          cache_read: 9,
          cache_write: 9
        }
      }
    });
    assert.equal(routeProvider("gpt-4o-mini"), "openrouter");
    const restoreDryRunLedgerDb = new DatabaseSync(dbPath);
    const restoreDryRunLedgerRow = restoreDryRunLedgerDb
      .prepare(
        `
          SELECT source_surface, actor_kind, session_id, operation, status, target_id, optimization_run_id, mutation_event_id
          FROM control_plane_action_events
          WHERE operation = 'optimize_restore'
            AND status = 'dry_run_succeeded'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get() as {
        source_surface?: string;
        actor_kind?: string;
        session_id?: string;
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
        mutation_event_id?: string | null;
      } | undefined;
    restoreDryRunLedgerDb.close();
    assert.equal(restoreDryRunLedgerRow?.source_surface, "mcp");
    assert.equal(restoreDryRunLedgerRow?.actor_kind, "agent");
    assert.equal(restoreDryRunLedgerRow?.session_id, sessionContext.sessionId);
    assert.equal(restoreDryRunLedgerRow?.operation, "optimize_restore");
    assert.equal(restoreDryRunLedgerRow?.status, "dry_run_succeeded");
    assert.equal(restoreDryRunLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(restoreDryRunLedgerRow?.optimization_run_id, runId);
    assert.equal(restoreDryRunLedgerRow?.mutation_event_id, null);

    const restorePayload = await callToolWithSession("optimize_restore", {
      action_id: applyActionId,
      reload: true,
      verify: true
    }, configPath, sessionContext, runtimeDeps);
    const restoreData = restorePayload["data"] as Record<string, unknown>;
    const restoreSnapshot = restoreData["snapshot"] as Record<string, unknown>;
    const restoreReload = restoreData["reload"] as Record<string, unknown>;
    const restoreVerification = restoreData["verification"] as Record<string, unknown>;
    assert.equal(restorePayload["ok"], true);
    assert.equal(restoreData["dry_run"], false);
    assert.equal(restoreData["changed"], true);
    assert.equal(restoreReload["status"], "succeeded");
    assert.equal(restoreVerification["status"], "passed");
    assert.deepEqual(restoreData["warnings"], []);
    assert.equal(typeof restoreData["action_id"], "string");
    assert.equal(typeof restoreSnapshot["snapshot_id"], "string");
    assert.equal((restoreData["after"] as Record<string, unknown>)["service_provider"], "openai_direct");
    assert.equal(routeProvider("gpt-4o-mini"), "openai_direct");
    const restoreLedgerDb = new DatabaseSync(dbPath);
    const restoreLedgerRow = restoreLedgerDb
      .prepare("SELECT source_surface, actor_kind, session_id, operation, status, target_id, optimization_run_id FROM control_plane_action_events WHERE mutation_event_id = ?")
      .get(restoreData["action_id"] as string) as {
        source_surface?: string;
        actor_kind?: string;
        session_id?: string;
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
      } | undefined;
    restoreLedgerDb.close();
    assert.equal(restoreLedgerRow?.source_surface, "mcp");
    assert.equal(restoreLedgerRow?.actor_kind, "agent");
    assert.equal(restoreLedgerRow?.session_id, sessionContext.sessionId);
    assert.equal(restoreLedgerRow?.operation, "optimize_restore");
    assert.equal(restoreLedgerRow?.status, "succeeded");
    assert.equal(restoreLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(restoreLedgerRow?.optimization_run_id, runId);
    assert.deepEqual(postActionCalls, [
      { kind: "reload", operation: "apply" },
      { kind: "verify", operation: "apply", routeId: "gpt-4o-mini" },
      { kind: "reload", operation: "restore" },
      { kind: "verify", operation: "restore", routeId: "gpt-4o-mini" }
    ]);
  } finally {
    closeMcpSessionContext(sessionContext);
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP optimize_run persists latency recommendations through the benchmark runner", async () => {
  await withOpenAiLikeLatencyServer(async (endpoint) => {
    const { tempDir, configPath } = createSecureExampleConfigCopy();
    const dbPath = path.join(tempDir, "observability.sqlite");
    const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    const sessionContext = createFullAccessSessionContext();

    try {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

      const catalogPath = catalogPathForConfigForTests(configPath);
      const catalog = readJsonForTests(catalogPath);
      const models = catalog["models"] as Record<string, Record<string, unknown>>;
      const providers = catalog["service_providers"] as Record<string, Record<string, unknown>>;
      const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
      models["mcp-latency-model"] = {
        display_name: "MCP Latency Model",
        model_creator: "switchmaxxer"
      };
      providers["mcp_latency_provider"] = {
        endpoint: endpoint,
        allow_private_endpoints: true,
        allow_insecure_http: true,
        api_mode: "openai-completions",
        api_key: null,
        api_key_env: null
      };
      routes["latency-slow"] = {
        model: "mcp-latency-model",
        service_provider: "mcp_latency_provider",
        provider_model_id: "slow-model",
        display_name: "Latency Slow"
      };
      routes["latency-fast"] = {
        model: "mcp-latency-model",
        service_provider: "mcp_latency_provider",
        provider_model_id: "fast-model",
        display_name: "Latency Fast"
      };
      writeSecureJsonForTests(catalogPath, catalog);
      const beforeCatalogText = readFileSync(catalogPath, "utf8");

      const runPayload = await callToolWithSession("optimize_run", {
        model: "mcp-latency-model",
        objective: "latency",
        routes: ["latency-slow", "latency-fast"],
        prompt: "ping",
        iterations: 1,
        warmup: 0,
        concurrency: 1,
        path_mode: "direct"
      }, configPath, sessionContext);
      const runData = runPayload["data"] as Record<string, unknown>;
      const run = runData["run"] as Record<string, unknown>;
      const bench = runData["bench"] as Record<string, unknown>;
      const benchmarkSummary = bench["summary"] as Record<string, unknown>;

      assert.equal(runPayload["ok"], true);
      assert.equal(runPayload["command"], "optimize");
      assert.equal(runPayload["count"], 2);
      assert.equal(run["persisted"], true);
      assert.equal(run["created_by"], "switchmaxxer mcp optimize");
      assert.equal(run["target_model"], "mcp-latency-model");
      assert.equal(run["objective"], "latency");
      assert.equal((runData["winner"] as Record<string, unknown>)["route_id"], "latency-fast");
      assert.equal(benchmarkSummary["measured_samples"], 2);
      assert.equal(benchmarkSummary["failed_count"], 0);
      assert.equal(readFileSync(catalogPath, "utf8"), beforeCatalogText);

      const runId = run["run_id"] as string;
      assert.ok(runId);

      const showPayload = await callToolWithSession("optimize_show", {
        run_id: runId
      }, configPath, sessionContext);
      const showData = showPayload["data"] as Record<string, unknown>;

      assert.equal(showPayload["ok"], true);
      assert.equal(showPayload["command"], "optimize show");
      assert.equal(((showData["run"] as Record<string, unknown>)["objective"]), "latency");
      assert.equal(((showData["winner"] as Record<string, unknown>)["route_id"]), "latency-fast");
    } finally {
      closeMcpSessionContext(sessionContext);
      if (typeof previousDbPath === "string") {
        process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
      } else {
        delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

void test("MCP bench_run schema requires exactly one of route_id or routes at the typed boundary", async () => {
  const missingSelectorPayload = await callTool("bench_run", {
    prompt: "Hello"
  });
  const missingSelectorError = missingSelectorPayload["error"] as Record<string, unknown>;

  assert.equal(missingSelectorError["code"], "invalid_tool_input");
  assert.equal(missingSelectorError["message"], "Tool arguments must provide exactly one of 'route_id' or 'routes'.");

  const bothSelectorsPayload = await callTool("bench_run", {
    prompt: "Hello",
    route_id: "demo-route",
    routes: ["demo-route"]
  });
  const bothSelectorsError = bothSelectorsPayload["error"] as Record<string, unknown>;

  assert.equal(bothSelectorsError["code"], "invalid_tool_input");
  assert.equal(bothSelectorsError["message"], "Tool arguments must provide exactly one of 'route_id' or 'routes'.");
});

void test("MCP parser rejects message bodies above the maximum size", async () => {
  const state = {
    buffer: Buffer.concat([Buffer.alloc(16 * 1024 * 1024 + 1, "x"), Buffer.from("\n")])
  };

  await assert.rejects(
    async () => {
      await processMcpBufferForTests(
        state,
        async () => undefined,
        async () => undefined
      );
    },
    /MCP message exceeds the maximum size/
  );
});

void test("MCP parser rejects raw buffer growth beyond the sentinel limit", () => {
  const state = {
    buffer: Buffer.alloc(0)
  };

  assert.throws(
    () => appendMcpParserChunkForTests(state, Buffer.alloc(16 * 1024 * 1024 + 64 * 1024 + 1)),
    /MCP parser buffer exceeded the maximum size/
  );
});

void test("MCP parser waits for an incomplete line without emitting messages or protocol errors", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping"
  });

  appendMcpParserChunkForTests(state, body.slice(0, 8));

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, []);
  assert.notEqual(state.buffer.length, 0);
});

void test("MCP parser accepts a valid JSON-RPC line whose body arrives across multiple chunks", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize"
  });
  const splitIndex = Math.floor(body.length / 2);

  appendMcpParserChunkForTests(state, body.slice(0, splitIndex));
  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  appendMcpParserChunkForTests(state, `${body.slice(splitIndex)}\n`);
  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(protocolErrors, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.["method"], "initialize");
  assert.equal(state.buffer.length, 0);
});

void test("MCP parser normalizes params onto a null-prototype object", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    params: {
      route_id: "demo"
    }
  });

  appendMcpParserChunkForTests(state, `${body}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.equal(messages.length, 1);
  assert.deepEqual(protocolErrors, []);
  assert.equal(Object.getPrototypeOf(messages[0]?.["params"] as object), null);
});

void test("MCP parser silently skips bare blank lines", async () => {
  const state = {
    buffer: Buffer.from("\n\n", "utf8")
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (message) => {
      protocolErrors.push(message);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, []);
  assert.equal(state.buffer.length, 0);
});

void test("MCP parser reports malformed JSON bodies as parse errors instead of invalid requests", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = '{"jsonrpc":"2.0","id":1,"method":"ping"';

  appendMcpParserChunkForTests(state, `${body}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, [{ code: -32700, message: "Invalid JSON-RPC message body" }]);
  assert.equal(state.buffer.length, 0);
});

void test("MCP parser rejects deeply nested JSON bodies before raw parse recursion", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  let nestedParams = "null";

  for (let index = 0; index < 300; index += 1) {
    nestedParams = `{"child":${nestedParams}}`;
  }

  const body = `{"jsonrpc":"2.0","id":1,"method":"ping","params":${nestedParams}}`;
  appendMcpParserChunkForTests(state, `${body}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, [{ code: -32700, message: "Invalid JSON-RPC message body" }]);
  assert.equal(state.buffer.length, 0);
});

void test("MCP config mutation runtime rejects symbolic-link config paths through the shared hardened reader", () => {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-mcp-config-symlink-"));
  const targetPath = path.join(tempDir, "config-target.json");
  const symlinkPath = path.join(tempDir, "config-link.json");

  try {
    writeFileSync(targetPath, readFileSync(EXAMPLE_CONFIG_PATH, "utf8"), "utf8");
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, symlinkPath);

    assert.throws(
      () => mutateMcpConfigDocument(symlinkPath, () => undefined),
      /must not be a symbolic link/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP parser recovers from a malformed line and resyncs to the next valid line", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: string[] = [];
  const validBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  });
  const malformedLine = "this is not json";

  appendMcpParserChunkForTests(state, `${malformedLine}\n${validBody}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error.message);
    }
  );

  assert.deepEqual(protocolErrors, ["Invalid JSON-RPC message body"]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.["method"], "tools/list");
  assert.equal(state.buffer.length, 0);
});

void test("MCP parser rejects JSON-RPC envelopes with non-scalar id values", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: { nested: true },
    method: "ping"
  });

  appendMcpParserChunkForTests(state, `${body}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, [{ code: -32600, message: "Invalid Request" }]);
  assert.equal(state.buffer.length, 0);
});

void test("MCP parser rejects JSON-RPC envelopes with unexpected top-level fields", async () => {
  const state = {
    buffer: Buffer.alloc(0)
  };
  const messages: Array<Record<string, unknown>> = [];
  const protocolErrors: Array<{ code: number; message: string }> = [];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    extra: true
  });

  appendMcpParserChunkForTests(state, `${body}\n`);

  await processMcpBufferForTests(
    state,
    async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    async (error) => {
      protocolErrors.push(error);
    }
  );

  assert.deepEqual(messages, []);
  assert.deepEqual(protocolErrors, [{ code: -32600, message: "Invalid Request" }]);
  assert.equal(state.buffer.length, 0);
});

void test("MCP direct request handler rejects invalid JSON-RPC id types with -32600", async () => {
  const response = await handleMcpRequestForTests({
    jsonrpc: "2.0",
    id: { nested: true } as unknown as string,
    method: "ping"
  });

  assert.equal(response.isNotification, false);
  assert.deepEqual(response.response, {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32600,
      message: "Invalid Request"
    }
  });
});

void test("MCP tools/list only advertises tools allowed by the current session grant", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const response = await handleMcpRequestForTests(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      },
      configPath,
      createReadOnlySessionContext()
    );

    const tools = ((response.response?.["result"] as Record<string, unknown>)["tools"]) as Array<Record<string, unknown>>;
    const toolNames = tools.map((tool) => tool["name"]);

    assert.ok(toolNames.includes("config_show"));
    assert.ok(toolNames.includes("trace_verify"));
    assert.ok(toolNames.includes("optimize_list"));
    assert.ok(toolNames.includes("optimize_show"));
    assert.ok(!toolNames.includes("ledger_list"));
    assert.ok(!toolNames.includes("ledger_show"));
    assert.ok(!toolNames.includes("prune"));
    assert.ok(!toolNames.includes("models_create"));
    assert.ok(!toolNames.includes("providers_set_key"));
    assert.ok(!toolNames.includes("bench_run"));
    assert.ok(!toolNames.includes("optimize_run"));
    assert.ok(!toolNames.includes("optimize_apply"));
    assert.ok(!toolNames.includes("optimize_restore"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP tools/list derives the advertised tools from config.json MCP capabilities when no explicit session grant is provided", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read"]);

  try {
    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list"
        },
        configPath
      )
    );

    const tools = ((response.response?.["result"] as Record<string, unknown>)["tools"]) as Array<Record<string, unknown>>;
    const toolNames = tools.map((tool) => tool["name"]);

    assert.ok(toolNames.includes("config_show"));
    assert.ok(toolNames.includes("trace_verify"));
    assert.ok(toolNames.includes("optimize_list"));
    assert.ok(toolNames.includes("optimize_show"));
    assert.ok(!toolNames.includes("prune"));
    assert.ok(!toolNames.includes("models_create"));
    assert.ok(!toolNames.includes("providers_set_key"));
    assert.ok(!toolNames.includes("bench_run"));
    assert.ok(!toolNames.includes("optimize_run"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP tools/list exposes provider creation as mutation under read and mutation capabilities", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read", "mutation"]);

  try {
    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list"
        },
        configPath
      )
    );

    const tools = ((response.response?.["result"] as Record<string, unknown>)["tools"]) as Array<Record<string, unknown>>;
    const toolNames = tools.map((tool) => tool["name"]);

    assert.ok(toolNames.includes("providers_update"));
    assert.ok(toolNames.includes("optimize_apply"));
    assert.ok(toolNames.includes("optimize_restore"));
    assert.ok(!toolNames.includes("ledger_list"));
    assert.ok(!toolNames.includes("ledger_show"));
    assert.ok(!toolNames.includes("prune"));
    assert.ok(toolNames.includes("providers_create"));
    assert.ok(!toolNames.includes("providers_set_key"));
    assert.ok(!toolNames.includes("optimize_run"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP bench_run cancels immediately when the session signal is already aborted", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const abortController = new AbortController();
    abortController.abort(new Error("test session disconnected"));

    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "bench_run",
            arguments: {
              route_id: "gpt-4o-mini",
              prompt: "ping",
              iterations: 1,
              warmup: 0,
              concurrency: 1,
              path_mode: "direct"
            }
          }
        },
        configPath,
        {
          sessionId: "test-aborted-bench-session",
          observabilityHandle: null,
          observabilityHandleDbPath: null,
          observabilityStoreKnownMissing: false,
          grantedCapabilities: new Set(["read", "mutation", "privileged"]),
          abortSignal: abortController.signal
        }
      )
    );

    const result = response.response?.["result"] as Record<string, unknown>;
    const payload = result["structuredContent"] as Record<string, unknown>;
    const error = payload["error"] as Record<string, unknown>;

    assert.equal(result["isError"], true);
    assert.equal(error["code"], "bench_error");
    assert.match(String(error["message"]), /cancelled/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP sanitizes error details before returning them to clients", () => {
  assert.deepEqual(
    sanitizeMcpErrorDetails({
      field: "provider_id",
      reason: "invalid value",
      api_key: "sk-live-secret",
      api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
      auth_mode: "header",
      nested: {
        auth_header: "Bearer token",
        safe_flag: true
      },
      items: [
        {
          public_message: "safe"
        },
        {
          sessionToken: "abc123",
          retryable: false
        }
      ],
      deeply_nested: {
        one: {
          two: {
            three: {
              four: {
                five: {
                  six: "too deep"
                }
              }
            }
          }
        }
      }
    }),
    {
      field: "provider_id",
      reason: "invalid value",
      api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
      auth_mode: "header",
      nested: {
        safe_flag: true
      },
      items: [
        {
          public_message: "safe"
        },
        {
          retryable: false
        }
      ],
      deeply_nested: {
        one: {
          two: {
            three: {
              four: {
                five: {
                  truncated: true
                }
              }
            }
          }
        }
      }
    }
  );
  assert.equal(sanitizeMcpErrorDetails(["not-a-plain-object"]), undefined);
});

void test("MCP error envelopes sanitize nested details by default", () => {
  const envelope = buildMcpErrorEnvelope("mcp test", APP_ERROR_CODES.toolExecutionError, "failed", {
    details: {
      field: "provider_id",
      api_key: "sk-live-secret",
      api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
      nested: {
        auth_header: "Bearer token",
        safe_flag: true
      },
      items: [
        {
          public_message: "safe"
        },
        {
          sessionToken: "abc123",
          retryable: false
        }
      ]
    }
  });

  assert.deepEqual(envelope.details, {
    field: "provider_id",
    api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
    nested: {
      safe_flag: true
    },
    items: [
      {
        public_message: "safe"
      },
      {
        retryable: false
      }
    ]
  });
  assert.equal(JSON.stringify(envelope).includes("sk-live-secret"), false);
  assert.equal(JSON.stringify(envelope).includes("Bearer token"), false);
  assert.equal(JSON.stringify(envelope).includes("abc123"), false);
});

void test("MCP rejects mutating tools/call notifications without an id", async () => {
  const response = await handleMcpRequestForTests(
    {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "models_delete",
        arguments: {
          model_id: "demo-model"
        }
      }
    },
    undefined,
    createFullAccessSessionContext()
  );

  assert.equal(response.isNotification, false);
  assert.deepEqual(response.response, {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32600,
      message: "Invalid Request"
    }
  });
});

void test("MCP allows read-only tools/call notifications and suppresses the response", async () => {
  const response = await handleMcpRequestForTests({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "config_schema",
      arguments: {}
    }
  });

  assert.equal(response.isNotification, true);
  assert.equal(response.response, undefined);
});

void test("MCP denies mutation tools when the session grant is read-only", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();

  try {
    const response = await handleMcpRequestForTests(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "models_create",
          arguments: {
            model_id: "unauthorized-model",
            display_name: "Unauthorized Model",
            model_creator: "switchmaxxer"
          }
        }
      },
      configPath,
      createReadOnlySessionContext()
    );

    const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
    const error = structuredContent["error"] as Record<string, unknown>;

    assert.equal(structuredContent["ok"], false);
    assert.equal(structuredContent["command"], "models create");
    assert.equal(error["code"], "unsupported");
    assert.equal(error["message"], "MCP session is not authorized to call 'models_create'.");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP denies privileged tools when config.json grants only read and mutation capabilities", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read", "mutation"]);

  try {
    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "providers_set_key",
            arguments: {
              provider_id: "openai_direct",
              api_key: "sk-demo-secret"
            }
          }
        },
        configPath
      )
    );

    const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
    const error = structuredContent["error"] as Record<string, unknown>;

    assert.equal(structuredContent["ok"], false);
    assert.equal(structuredContent["command"], "providers set-key");
    assert.equal(error["code"], "unsupported");
    assert.equal(error["message"], "MCP session is not authorized to call 'providers_set_key'.");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP allows provider creation without auth material when config.json grants read and mutation capabilities", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read", "mutation"]);

  try {
    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "providers_create",
            arguments: {
              provider_id: "unauthorized-provider",
              endpoint: "https://example.invalid/v1/chat/completions",
              api_mode: "openai-completions"
            }
          }
        },
        configPath
      )
    );

    const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
    const data = structuredContent["data"] as Record<string, unknown>;

    assert.equal(structuredContent["ok"], true);
    assert.equal(structuredContent["command"], "providers create");
    assert.equal(data["name"], "unauthorized-provider");
    assert.equal(data["auth_source"], "not required");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP denies provider auth field updates when config.json grants only read and mutation capabilities", async () => {
  const cases = [
    {
      name: "api_key_env",
      arguments: {
        provider_id: "openai_direct",
        api_key_env: "SWITCHMAXXER_REPLACEMENT_API_KEY"
      }
    },
    {
      name: "no_auth",
      arguments: {
        provider_id: "openai_direct",
        no_auth: true
      }
    }
  ];

  for (const testCase of cases) {
    const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read", "mutation"]);

    try {
      const response = await withExampleConfigEnv(async () =>
        await handleMcpRequestForTests(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "providers_update",
              arguments: testCase.arguments
            }
          },
          configPath
        )
      );

      const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;
      const error = structuredContent["error"] as Record<string, unknown>;

      assert.equal(structuredContent["ok"], false, testCase.name);
      assert.equal(structuredContent["command"], "providers update");
      assert.equal(error["code"], "unsupported");
      assert.equal(
        error["message"],
        "MCP session is not authorized to change provider auth fields through 'providers_update'."
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

void test("MCP allows non-auth provider updates when config.json grants read and mutation capabilities", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopyWithMcpCapabilities(["read", "mutation"]);

  try {
    const response = await withExampleConfigEnv(async () =>
      await handleMcpRequestForTests(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "providers_update",
            arguments: {
              provider_id: "openai_direct",
              endpoint: "https://api.openai.com/v1/chat/completions",
              model_id_format: "passthrough"
            }
          }
        },
        configPath
      )
    );

    const structuredContent = ((response.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>;

    assert.equal(structuredContent["ok"], true);
    assert.equal(structuredContent["command"], "providers update");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP gateway health probe accepts the minimal non-identifying health payload", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          process_integrity_status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )) as typeof fetch;

    const result = await probeGatewayHealthAtHostForTests("127.0.0.1", 4080, 500);

    assert.equal(result.running, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.probe_host, "127.0.0.1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("MCP gateway_status includes aggregate in-memory health probe metrics", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy();
  const originalFetch = globalThis.fetch;

  try {
    recordGatewayHealthProbe({ rateLimited: false, observedAt: new Date("2026-04-24T12:00:00.000Z") });
    recordGatewayHealthProbe({ rateLimited: true, observedAt: new Date("2026-04-24T12:05:00.000Z") });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          process_integrity_status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )) as typeof fetch;

    const payload = await callTool("gateway_status", {}, configPath);
    const data = payload["data"] as Record<string, unknown>;
    const healthProbeMetrics = data["health_probe_metrics"] as Record<string, unknown>;

    assert.deepEqual(healthProbeMetrics, {
      total_requests: 2,
      allowed_requests: 1,
      rate_limited_requests: 1,
      last_seen_at: "2026-04-24T12:05:00.000Z"
    });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
