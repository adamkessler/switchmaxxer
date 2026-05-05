import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCliConfigSchemaMetadata,
  buildMcpConfigSchemaMetadata,
  buildModelFieldMetadata,
  buildProviderFieldMetadata,
  buildRouteFieldMetadata
} from "../config/config-metadata";
import { closeMcpSessionContext, handleMcpRequestForTests, type McpSessionContext } from "../mcp/mcp";
import { MASKED_ENV_NAME_SENTINEL } from "../../platform/masked-secret";
import { BENCH_MAX_TOTAL_TASKS } from "./bench-limits";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import { ObservabilityService } from "./service";
import { seedSuccessfulRequest } from "./test-helpers";
import { run, type CliIo } from "../../index";
import { copyExampleConfigPairForTests } from "../config/config-file.test-support";

const TEST_INBOUND_API_KEY = "0123456789abcdef0123456789abcdef";
type TestMcpCapability = "read" | "mutation" | "privileged";
const FULL_MCP_CAPABILITIES: TestMcpCapability[] = ["read", "mutation", "privileged"];

function createSecureRepoConfigCopy(
  prefix: string,
  options: {
    parentDir?: string;
    transform?: (source: string) => string;
    mcpCapabilities?: TestMcpCapability[];
  } = {}
): { tempDir: string; configPath: string } {
  const tempDir = mkdtempSync(path.join(options.parentDir ?? tmpdir(), prefix));
  const configPath = path.join(tempDir, "config.json");
  copyExampleConfigPairForTests(configPath);
  const source = readFileSync(configPath, "utf8");
  const transformedSource = options.transform ? options.transform(source) : source;
  if (options.mcpCapabilities) {
    const document = JSON.parse(transformedSource) as Record<string, unknown>;
    document["mcp"] = {
      capabilities: options.mcpCapabilities
    };
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } else {
    writeFileSync(configPath, transformedSource, "utf8");
  }
  chmodSync(configPath, 0o600);
  return { tempDir, configPath };
}

async function captureCliIo<T>(
  fn: (io: CliIo) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  result: T;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (message: string) => {
      stdout += message;
    },
    stderr: (message: string) => {
      stderr += message;
    },
    stdin: {
      isTTY: false,
      readAllSync: () => "",
      readAll: async () => ""
    },
    env: { ...env },
    cwd: () => process.cwd()
  };

  const result = await fn(io);
  return { result, stdout, stderr };
}

async function runWithCapturedIo(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  result: number;
  stdout: string;
  stderr: string;
}> {
  return await captureCliIo(async (io) => await run(argv, io), env);
}

void test("CLI and MCP metadata contracts expose transport-specific schema projections", () => {
  const cliSchema = buildCliConfigSchemaMetadata();
  const mcpSchema = buildMcpConfigSchemaMetadata();
  const cliEntities = cliSchema["entities"] as Record<string, unknown>;
  const mcpEntities = mcpSchema["entities"] as Record<string, unknown>;
  const cliProviderFields = ((cliEntities["provider"] as Record<string, unknown>)["fields"]) as Record<string, unknown>;
  const mcpProviderFields = ((mcpEntities["provider"] as Record<string, unknown>)["fields"]) as Record<string, unknown>;

  const cliProviderApiKeyField = (cliProviderFields["api_key"] ?? {}) as Record<string, unknown>;
  assert.deepEqual(Object.keys(cliProviderApiKeyField).sort(), [
    "flag",
    "mutation_mode",
    "notes",
    "required_on_create",
    "type",
    "writable_on"
  ]);
  assert.equal(cliProviderApiKeyField["flag"], "--api-key-stdin");

  const mcpProviderApiKeyField = (mcpProviderFields["api_key"] ?? {}) as Record<string, unknown>;
  assert.deepEqual(Object.keys(mcpProviderApiKeyField).sort(), [
    "notes",
    "required_on_create",
    "type",
    "writable_on"
  ]);
  assert.ok(Array.isArray(mcpProviderApiKeyField["notes"]));

  const mcpRouteCostField = (((((mcpEntities["route"] as Record<string, unknown>)["fields"]) ?? {}) as Record<string, unknown>)["cost"] ?? {}) as Record<string, unknown>;
  assert.deepEqual(Object.keys(mcpRouteCostField).sort(), [
    "clearable_on_update",
    "constraints",
    "required_on_create",
    "type",
    "writable_on"
  ]);
  assert.equal("flags" in mcpRouteCostField, false);
  assert.equal("clear_flag" in mcpRouteCostField, false);
  assert.equal("mutation_mode" in mcpRouteCostField, false);

  assert.deepEqual(buildModelFieldMetadata(), {
    writable: ["display_name", "model_creator", "cost"],
    derived: ["name", "route_count"],
    effective: []
  });

  assert.deepEqual(buildProviderFieldMetadata(), {
    writable: [
      "endpoint",
      "allow_private_endpoints",
      "allow_insecure_http",
      "api_mode",
      "anthropic_version",
      "model_id_format",
      "api_key_env"
    ],
    derived: ["name", "auth_source"],
    effective: []
  });

  assert.deepEqual(buildRouteFieldMetadata(), {
    writable: ["display_name", "model", "service_provider", "provider_model_id", "timeout_ms", "cost"],
    derived: ["name", "api_mode", "model_cost"],
    effective: ["effective_cost", "effective_timeout_ms"]
  });
});

void test("MCP request handler exposes the first read-only config tool surface", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-readonly-config-", {
    parentDir: process.cwd()
  });
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = TEST_INBOUND_API_KEY;

    const initializeResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {}
      }
    });
    assert.equal(initializeResponse.isNotification, false);
    assert.equal((initializeResponse.response?.["result"] as Record<string, unknown>)["protocolVersion"], "2024-11-05");

    const toolsListResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const tools = ((toolsListResponse.response?.["result"] as Record<string, unknown>)["tools"]) as Array<Record<string, unknown>>;
    assert.deepEqual(
      tools.map((tool) => tool["name"]).sort(),
      [
        "bench_list",
        "bench_show",
        "config_schema",
        "config_show",
        "config_validate",
        "gateway_health",
        "gateway_runtime_config",
        "gateway_status",
        "models_list",
        "models_show",
        "optimize_list",
        "optimize_show",
        "providers_list",
        "providers_show",
        "routes_explain",
        "routes_list",
        "routes_show",
        "trace_list",
        "trace_observations",
        "trace_show",
        "trace_stats",
        "trace_verify"
      ]
    );

    const configSchemaResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "config_schema",
        arguments: {}
      }
    }, configPath);
    const configSchemaPayload = (((configSchemaResponse.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(configSchemaPayload["ok"], true);
    assert.deepEqual(Object.keys(configSchemaPayload["data"] as Record<string, unknown>).sort(), ["entities", "error_codes"]);
    const mcpEntities = (configSchemaPayload["data"] as Record<string, unknown>)["entities"] as Record<string, unknown>;
    const mcpRouteFields = ((mcpEntities["route"] as Record<string, unknown>)["fields"]) as Record<string, unknown>;
    const mcpRouteCost = mcpRouteFields["cost"] as Record<string, unknown>;
    assert.equal("flags" in mcpRouteCost, false);
    assert.equal("clear_flag" in mcpRouteCost, false);

    const providerShowResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "providers_show",
        arguments: {
          provider_id: "openai_direct"
        }
      }
    }, configPath);
    const providerShowPayload = (((providerShowResponse.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerShowPayload["ok"], true);
    assert.equal(((providerShowPayload["data"] as Record<string, unknown>)["name"]), "openai_direct");

    const missingRouteResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "routes_show",
        arguments: {
          route_id: "definitely-missing-route"
        }
      }
    }, configPath);
    const missingRouteResult = missingRouteResponse.response?.["result"] as Record<string, unknown>;
    const missingRoutePayload = missingRouteResult["structuredContent"] as Record<string, unknown>;
    assert.equal(missingRouteResult["isError"], true);
    assert.equal(((missingRoutePayload["error"] as Record<string, unknown>)["code"]), "route_not_found");

    const invalidArgumentsResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "config_schema",
        arguments: ["not-an-object"]
      }
    }, configPath);
    const invalidArgumentsResult = invalidArgumentsResponse.response?.["result"] as Record<string, unknown>;
    const invalidArgumentsPayload = invalidArgumentsResult["structuredContent"] as Record<string, unknown>;
    assert.equal(invalidArgumentsResult["isError"], true);
    assert.equal(((invalidArgumentsPayload["error"] as Record<string, unknown>)["code"]), "invalid_tool_input");
    assert.equal(
      ((invalidArgumentsPayload["error"] as Record<string, unknown>)["message"]),
      "Tool arguments must be a JSON object when provided"
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
  }
});

void test("MCP request handler exposes observability read tools with CLI-aligned envelopes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-mcp-observability-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  let store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    seedSuccessfulRequest(service, "req-mcp-trace");
    service.benchmarks.createRun({
      id: "bench-mcp-1",
      name: "mcp-bench",
      created_at: "2026-04-18T14:10:00.000Z",
      created_by: "switchmaxxer bench",
      objective: "route_benchmark",
      notes: "MCP observability test",
      status: "completed",
      settings_json: JSON.stringify({
        requested_path_mode: "direct",
        effective_paths: ["direct"],
        skipped_paths: [],
        warnings: []
      })
    });
    service.benchmarks.insertSample({
      id: "bench-mcp-sample-1",
      benchmark_run_id: "bench-mcp-1",
      request_execution_id: "req-mcp-trace",
      route_id: "gpt-4o-mini",
      provider_id: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      sample_index: 0,
      started_at: "2026-04-18T14:10:01.000Z",
      completed_at: "2026-04-18T14:10:01.150Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 150,
      ttft_ms: 80,
      duration_ms: 150,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      estimated_cost_micros: 4500,
      is_warmup: 0,
      score_value: 0.95,
      score_scale: "0_to_1",
      score_direction: "higher_is_better",
      score_source: "synthetic",
      score_method: "latency",
      score_json: JSON.stringify({ path: "direct" }),
      scored_at: "2026-04-18T14:10:01.160Z"
    });
    closeObservabilityStore(store);
    store = bootstrapObservabilityStore({ dbPath });

    const traceList = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "trace_list",
        arguments: {
          route_id: "route-alpha",
          limit: 10
        }
      }
    });
    const traceListPayload = (((traceList.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceListPayload["ok"], true);
    assert.equal(traceListPayload["command"], "trace list");
    assert.equal(traceListPayload["count"], 1);
    assert.equal((((traceListPayload["data"] as Record<string, unknown>)["traces"] as Array<Record<string, unknown>>)[0]?.["trace_id"]), "req-mcp-trace");

    const traceShow = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "trace_show",
        arguments: {
          trace_id: "req-mcp-trace"
        }
      }
    });
    const traceShowPayload = (((traceShow.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceShowPayload["ok"], true);
    assert.equal(
      traceShowPayload["observation_count"],
      (((traceShowPayload["data"] as Record<string, unknown>)["observations"] as Array<Record<string, unknown>>).length)
    );
    assert.equal("count" in traceShowPayload, false);
    assert.equal((((traceShowPayload["data"] as Record<string, unknown>)["trace"] as Record<string, unknown>)["trace_id"]), "req-mcp-trace");
    assert.equal((((traceShowPayload["data"] as Record<string, unknown>)["benchmark_samples"] as Array<Record<string, unknown>>).length), 1);

    const traceStats = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "trace_stats",
        arguments: {}
      }
    });
    const traceStatsPayload = (((traceStats.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceStatsPayload["ok"], true);
    assert.equal((((traceStatsPayload["data"] as Record<string, unknown>)["stats"] as Record<string, unknown>)["total_count"]), 1);

    const traceObservations = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "trace_observations",
        arguments: {
          event: "client_response_completed",
          limit: 5
        }
      }
    });
    const traceObservationsPayload = (((traceObservations.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceObservationsPayload["ok"], true);
    assert.equal(traceObservationsPayload["count"], 1);

    const traceVerify = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "trace_verify",
        arguments: {
          trace_id: "req-mcp-trace"
        }
      }
    });
    const traceVerifyPayload = (((traceVerify.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceVerifyPayload["ok"], true);
    assert.equal(traceVerifyPayload["result_count"], 1);
    assert.equal("count" in traceVerifyPayload, false);
    assert.equal(traceVerifyPayload["details"] && ((traceVerifyPayload["details"] as Record<string, unknown>)["drifted_count"]), 0);

    const benchList = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "bench_list",
        arguments: {}
      }
    });
    const benchListPayload = (((benchList.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(benchListPayload["ok"], true);
    assert.equal(benchListPayload["count"], 1);

    const benchShow = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "bench_show",
        arguments: {
          run_id: "bench-mcp-1"
        }
      }
    });
    const benchShowPayload = (((benchShow.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(benchShowPayload["ok"], true);
    assert.equal(benchShowPayload["sample_count"], 1);
    assert.equal("count" in benchShowPayload, false);
    assert.equal((((benchShowPayload["data"] as Record<string, unknown>)["run"] as Record<string, unknown>)["run_id"]), "bench-mcp-1");
    assert.equal(((((benchShowPayload["data"] as Record<string, unknown>)["samples"] as Array<Record<string, unknown>>)[0] as Record<string, unknown>)["sample_id"]), "bench-mcp-sample-1");
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI trace text surfaces truncated observation attributes clearly", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-cli-truncation-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);
  const requestId = "req-cli-truncation";

  try {
    seedSuccessfulRequest(service, requestId);
    store.db
      .prepare(
        "UPDATE observations SET attributes_json = ?, attributes_truncated = 1 WHERE request_id = ? AND event = 'client_response_completed'"
      )
      .run(JSON.stringify({ long_payload: "trimmed" }), requestId);
    closeObservabilityStore(store);

    const env = {
      ...process.env,
      SWITCHMAXXER_OBSERVABILITY_DB: dbPath
    };

    const traceShow = await runWithCapturedIo(["trace", "show", requestId], env);
    assert.equal(traceShow.result, 0);
    assert.equal(traceShow.stderr, "");
    assert.match(traceShow.stdout, /\[attributes truncated\]/);

    const traceObservations = await runWithCapturedIo(
      ["trace", "observations", "--event", "client_response_completed"],
      env
    );
    assert.equal(traceObservations.result, 0);
    assert.equal(traceObservations.stderr, "");
    assert.match(traceObservations.stdout, /\[attributes truncated\]/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP request handler supports observability repair and benchmark execution tools", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-ops-test-", {
    parentDir: process.cwd(),
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const providerEnvNames = [
    "SWITCHMAXXER_OPENAI_API_KEY",
    "SWITCHMAXXER_ANTHROPIC_API_KEY",
    "SWITCHMAXXER_OPENROUTER_API_KEY",
    "SWITCHMAXXER_MINIMAX_API_KEY"
  ] as const;
  const previousProviderEnvValues = new Map<string, string | undefined>(
    providerEnvNames.map((name) => [name, process.env[name]])
  );
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const catalogPath = path.join(tempDir, "catalog.json");
  const sourceCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Record<string, unknown>;
  sourceCatalog["models"] = sourceCatalog["models"] ?? {};
  sourceCatalog["service_providers"] = sourceCatalog["service_providers"] ?? {};
  sourceCatalog["routes"] = sourceCatalog["routes"] ?? {};
  (sourceCatalog["models"] as Record<string, unknown>)["mcp_bench_model"] = {
    display_name: "MCP Bench Model",
    model_creator: "switchmaxxer"
  };
  (sourceCatalog["service_providers"] as Record<string, unknown>)["mcp_bench_provider"] = {
    endpoint: "http://127.0.0.1:9/v1",
    allow_private_endpoints: true,
    allow_insecure_http: true,
    api_mode: "openai-completions",
    api_key: null,
    api_key_env: null
  };
  (sourceCatalog["routes"] as Record<string, unknown>)["mcp_bench_route"] = {
    model: "mcp_bench_model",
    service_provider: "mcp_bench_provider",
    provider_model_id: "provider-bench-model",
    display_name: "MCP Bench Route"
  };
  writeFileSync(catalogPath, `${JSON.stringify(sourceCatalog, null, 2)}\n`, "utf8");
  chmodSync(catalogPath, 0o600);

  let store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = TEST_INBOUND_API_KEY;
    for (const envName of providerEnvNames) {
      process.env[envName] = previousProviderEnvValues.get(envName) ?? "test-provider-api-key";
    }

    seedSuccessfulRequest(service, "req-mcp-repair");
    service.requestExecutions.repair("req-mcp-repair");
    store.db
      .prepare("UPDATE request_executions SET outcome = 'failed' WHERE request_id = ?")
      .run("req-mcp-repair");
    closeObservabilityStore(store);
    store = bootstrapObservabilityStore({ dbPath });

    const repairResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "trace_repair",
        arguments: {
          trace_id: "req-mcp-repair"
        }
      }
    }, configPath);
    const repairPayload = (((repairResponse.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(repairPayload["ok"], true);
    assert.equal(repairPayload["command"], "trace repair");
    assert.equal(repairPayload["result_count"], 1);
    assert.equal("count" in repairPayload, false);
    assert.equal((((((repairPayload["data"] as Record<string, unknown>)["results"] as Array<Record<string, unknown>>)[0]?.["verification"] as Record<string, unknown>)?.["status"])), "ok");

    const benchRunResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "bench_run",
        arguments: {
          route_id: "mcp_bench_route",
          prompt: "ping",
          iterations: 1,
          warmup: 0,
          concurrency: 1,
          path_mode: "direct"
        }
      }
    }, configPath);
    const benchRunPayload = (((benchRunResponse.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(benchRunPayload["ok"], true);
    assert.equal(benchRunPayload["command"], "bench");
    assert.equal(benchRunPayload["sample_count"], 1);
    assert.equal("count" in benchRunPayload, false);
    const run = (((benchRunPayload["data"] as Record<string, unknown>)["run"]) as Record<string, unknown>);
    assert.equal(typeof run["run_id"], "string");
    assert.equal("config_path" in (((run["settings"] as Record<string, unknown>) ?? {})), false);
    const summary = (((benchRunPayload["data"] as Record<string, unknown>)["summary"]) as Record<string, unknown>);
    assert.equal(summary["failed_count"], 1);
    assert.equal(summary["success_count"], 0);
    const samples = (benchRunPayload["data"] as Record<string, unknown>)["samples"] as Array<Record<string, unknown>>;
    assert.equal(samples.length, 1);
    assert.equal(samples[0]?.["outcome"], "failed");
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    for (const envName of providerEnvNames) {
      const previousValue = previousProviderEnvValues.get(envName);
      if (typeof previousValue === "string") {
        process.env[envName] = previousValue;
      } else {
        delete process.env[envName];
      }
    }
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP session context reuses one observability handle across tool calls", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-session-handle-test-", {
    parentDir: process.cwd()
  });
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-mcp-session-handle");
    closeObservabilityStore(store);

    const sessionContext: McpSessionContext = {
      sessionId: "test-session-reuse",
      observabilityHandle: null,
      observabilityHandleDbPath: null,
      observabilityStoreKnownMissing: false,
      grantedCapabilities: new Set(["read", "mutation", "privileged"]),
      abortSignal: new AbortController().signal
    };

    const traceList = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "trace_list",
        arguments: {
          limit: 5
        }
      }
    }, configPath, sessionContext);
    const firstHandle = sessionContext.observabilityHandle;
    assert.ok(firstHandle);
    const traceListPayload = (((traceList.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(traceListPayload["ok"], true);

    const benchList = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: {
        name: "bench_list",
        arguments: {
          limit: 5
        }
      }
    }, configPath, sessionContext);
    assert.equal(sessionContext.observabilityHandle, firstHandle);
    const benchListPayload = (((benchList.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(benchListPayload["ok"], true);

    if (sessionContext.observabilityHandle) {
      closeObservabilityStore(sessionContext.observabilityHandle.store);
      sessionContext.observabilityHandle = null;
    }
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP session context keys observability handles by session id", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-session-scope-test-", {
    parentDir: process.cwd()
  });
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-mcp-session-scope");
    closeObservabilityStore(store);

    const firstSessionContext: McpSessionContext = {
      sessionId: "test-session-a",
      observabilityHandle: null,
      observabilityHandleDbPath: null,
      observabilityStoreKnownMissing: false,
      grantedCapabilities: new Set(["read", "mutation", "privileged"]),
      abortSignal: new AbortController().signal
    };
    const secondSessionContext: McpSessionContext = {
      sessionId: "test-session-b",
      observabilityHandle: null,
      observabilityHandleDbPath: null,
      observabilityStoreKnownMissing: false,
      grantedCapabilities: new Set(["read", "mutation", "privileged"]),
      abortSignal: new AbortController().signal
    };

    await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: {
        name: "trace_list",
        arguments: {
          limit: 5
        }
      }
    }, configPath, firstSessionContext);

    await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "trace_list",
        arguments: {
          limit: 5
        }
      }
    }, configPath, secondSessionContext);

    assert.ok(firstSessionContext.observabilityHandle);
    assert.ok(secondSessionContext.observabilityHandle);
    assert.notEqual(firstSessionContext.observabilityHandle, secondSessionContext.observabilityHandle);

    closeMcpSessionContext(firstSessionContext);
    closeMcpSessionContext(secondSessionContext);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP bench_run enforces iterations, concurrency, prompt length, and total-task caps", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-bench-caps-", {
    parentDir: process.cwd(),
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = TEST_INBOUND_API_KEY;
    const overIterations = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "bench_run",
        arguments: {
          route_id: "gpt-4o-mini",
          prompt: "ping",
          iterations: 501
        }
      }
    }, configPath);
    const overIterationsResult = overIterations.response?.["result"] as Record<string, unknown>;
    const overIterationsPayload = overIterationsResult["structuredContent"] as Record<string, unknown>;
    assert.equal(overIterationsResult["isError"], true);
    assert.equal(((overIterationsPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const overConcurrency = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "bench_run",
        arguments: {
          route_id: "gpt-4o-mini",
          prompt: "ping",
          concurrency: 17
        }
      }
    }, configPath);
    const overConcurrencyResult = overConcurrency.response?.["result"] as Record<string, unknown>;
    const overConcurrencyPayload = overConcurrencyResult["structuredContent"] as Record<string, unknown>;
    assert.equal(overConcurrencyResult["isError"], true);
    assert.equal(((overConcurrencyPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const overPrompt = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "bench_run",
        arguments: {
          route_id: "gpt-4o-mini",
          prompt: "x".repeat(65537)
        }
      }
    }, configPath);
    const overPromptResult = overPrompt.response?.["result"] as Record<string, unknown>;
    const overPromptPayload = overPromptResult["structuredContent"] as Record<string, unknown>;
    assert.equal(overPromptResult["isError"], true);
    assert.equal(((overPromptPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const oversizedPlan = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: {
        name: "bench_run",
        arguments: {
          routes: Array.from({ length: 32 }, () => "gpt-4o-mini"),
          prompt: "ping",
          path_mode: "direct",
          iterations: 500,
          warmup: 1100
        }
      }
    }, configPath);
    const oversizedPlanResult = oversizedPlan.response?.["result"] as Record<string, unknown>;
    const oversizedPlanPayload = oversizedPlanResult["structuredContent"] as Record<string, unknown>;
    assert.equal(oversizedPlanResult["isError"], true);
    assert.equal(((oversizedPlanPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");
    assert.match(
      String(((oversizedPlanPayload["error"] as Record<string, unknown>)["message"])),
      new RegExp(`at most ${BENCH_MAX_TOTAL_TASKS} tasks`)
    );
  } finally {
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP bench_run gateway preflight errors redact absolute source paths from client details", async () => {
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-bench-redacted-paths-", {
    parentDir: process.cwd(),
    mcpCapabilities: FULL_MCP_CAPABILITIES,
    transform: (source) => {
      const document = JSON.parse(source) as Record<string, unknown>;
      document["port"] = 65534;
      return `${JSON.stringify(document, null, 2)}\n`;
    }
  });
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousAnthropicKey = process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  const previousMiniMaxKey = process.env["SWITCHMAXXER_MINIMAX_API_KEY"];

  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = TEST_INBOUND_API_KEY;
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey ?? "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = previousAnthropicKey ?? "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = previousOpenRouterKey ?? "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = previousMiniMaxKey ?? "test-minimax-key";

    const response = await handleMcpRequestForTests({
        jsonrpc: "2.0",
        id: 36,
        method: "tools/call",
        params: {
          name: "bench_run",
          arguments: {
            route_id: "gpt-4o-mini",
            prompt: "ping",
            iterations: 1,
            warmup: 0,
            concurrency: 1,
            path_mode: "gateway"
          }
        }
      }, configPath);

    const result = response.response?.["result"] as Record<string, unknown>;
    const payload = result["structuredContent"] as Record<string, unknown>;
    const error = payload["error"] as Record<string, unknown>;
    const serializedPayload = JSON.stringify(payload);

    assert.equal(result["isError"], true);
    assert.equal(error["code"], "gateway_unavailable");
    assert.match(serializedPayload, /config\.json/);
    assert.doesNotMatch(serializedPayload, /source_path/);
    assert.doesNotMatch(serializedPayload, new RegExp(configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    if (typeof previousOpenAiKey === "string") {
      process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENAI_API_KEY"];
    }
    if (typeof previousAnthropicKey === "string") {
      process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = previousAnthropicKey;
    } else {
      delete process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
    }
    if (typeof previousOpenRouterKey === "string") {
      process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = previousOpenRouterKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
    }
    if (typeof previousMiniMaxKey === "string") {
      process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = previousMiniMaxKey;
    } else {
      delete process.env["SWITCHMAXXER_MINIMAX_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI bench enforces the same iterations, concurrency, route, prompt, and total-task caps", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-bench-cli-caps-"));
  const promptPath = path.join(tempDir, "prompt.txt");

  try {
    const overIterations = await runWithCapturedIo([
      "bench",
      "--route",
      "gpt-4o-mini",
      "--prompt",
      "ping",
      "--iterations",
      "501",
      "--json"
    ]);
    assert.equal(overIterations.result, 2);

    const overConcurrency = await runWithCapturedIo([
      "bench",
      "--route",
      "gpt-4o-mini",
      "--prompt",
      "ping",
      "--concurrency",
      "17",
      "--json"
    ]);
    assert.equal(overConcurrency.result, 2);

    writeFileSync(promptPath, "x".repeat(65537), "utf8");
    const overPrompt = await runWithCapturedIo([
      "bench",
      "--route",
      "gpt-4o-mini",
      "--file",
      promptPath,
      "--json"
    ]);
    assert.equal(overPrompt.result, 2);

    const overRoutes = await runWithCapturedIo([
      "bench",
      "--routes",
      Array.from({ length: 33 }, (_, index) => `r${String(index + 1).padStart(2, "0")}`).join(","),
      "--prompt",
      "ping",
      "--json"
    ]);
    assert.equal(overRoutes.result, 2);

    const oversizedPlan = await runWithCapturedIo([
      "bench",
      "--routes",
      Array.from({ length: 32 }, () => "gpt-4o-mini").join(","),
      "--prompt",
      "ping",
      "--path",
      "direct",
      "--iterations",
      "500",
      "--warmup",
      "1100",
      "--json"
    ]);
    assert.equal(oversizedPlan.result, 2);
    assert.match(oversizedPlan.stdout, new RegExp(`at most ${BENCH_MAX_TOTAL_TASKS} tasks`));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP trace_repair fails clearly when the observability store is missing", async () => {
  const { tempDir: configTempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-missing-repair-config-", {
    parentDir: process.cwd(),
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-mcp-missing-repair-"));
  const missingDbPath = path.join(tempDir, "missing-observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = missingDbPath;
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = TEST_INBOUND_API_KEY;

    const repairResponse = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: {
        name: "trace_repair",
        arguments: {
          all: true
        }
      }
    }, configPath);
    const repairResult = repairResponse.response?.["result"] as Record<string, unknown>;
    const repairPayload = repairResult["structuredContent"] as Record<string, unknown>;
    assert.equal(repairResult["isError"], true);
    assert.equal((((repairPayload["error"] as Record<string, unknown>)["code"])), "trace_repair_error");
    assert.equal(((((repairPayload["error"] as Record<string, unknown>)["message"]) as string).includes("nothing can be repaired yet")), true);
    assert.equal((((repairPayload["details"] as Record<string, unknown>)?.["store_path"]) as string), missingDbPath);
  } finally {
    rmSync(configTempDir, { recursive: true, force: true });
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("MCP request handler supports config mutation tools with CLI-aligned envelopes", async () => {
  const providerEnvVarName = "SWITCHMAXXER_TEST_API_KEY_MCP_MUTATION";
  const inboundEnvVarName = "SWITCHMAXXER_TEST_INBOUND_KEY_MCP_MUTATION";
  const { tempDir, configPath } = createSecureRepoConfigCopy(".switchmaxxer-mcp-mutation-test-", {
    parentDir: process.cwd(),
    mcpCapabilities: FULL_MCP_CAPABILITIES,
    transform: (source) => source.replaceAll("SWITCHMAXXER_INBOUND_API_KEY", inboundEnvVarName)
  });
  const dbPath = path.join(tempDir, "observability.sqlite");
  const providerEnvNames = [
    "SWITCHMAXXER_OPENAI_API_KEY",
    "SWITCHMAXXER_ANTHROPIC_API_KEY",
    "SWITCHMAXXER_OPENROUTER_API_KEY",
    "SWITCHMAXXER_MINIMAX_API_KEY"
  ] as const;
  const previousProviderEnv = process.env[providerEnvVarName];
  const previousInboundKey = process.env[inboundEnvVarName];
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousProviderEnvValues = new Map<string, string | undefined>(
    providerEnvNames.map((name) => [name, process.env[name]])
  );

  try {
    process.env[providerEnvVarName] = "mcp-test-api-key";
    process.env[inboundEnvVarName] = TEST_INBOUND_API_KEY;
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    for (const envName of providerEnvNames) {
      process.env[envName] = previousProviderEnvValues.get(envName) ?? "test-provider-api-key";
    }

    const modelCreate = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "models_create",
        arguments: {
          model_id: "mcp-test-model",
          display_name: "MCP Test Model",
          model_creator: "switchmaxxer",
          cost: {
            input: 0.1,
            output: 0.2,
            cache_read: 0.05,
            cache_write: 0.05
          }
        }
      }
    }, configPath);
    const modelCreatePayload = (((modelCreate.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(modelCreatePayload["ok"], true);
    assert.equal(((modelCreatePayload["data"] as Record<string, unknown>)["name"]), "mcp-test-model");

    const modelCreateWithoutCost = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 10.5,
      method: "tools/call",
      params: {
        name: "models_create",
        arguments: {
          model_id: "mcp-test-model-no-cost",
          display_name: "MCP Test Model Without Cost",
          model_creator: "switchmaxxer",
          cost: null
        }
      }
    }, configPath);
    const modelCreateWithoutCostPayload = ((((modelCreateWithoutCost.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>));
    assert.equal(modelCreateWithoutCostPayload["ok"], true);
    assert.equal(((modelCreateWithoutCostPayload["data"] as Record<string, unknown>)["name"]), "mcp-test-model-no-cost");
    assert.equal(((modelCreateWithoutCostPayload["data"] as Record<string, unknown>)["cost"]), null);

    const writtenConfigAfterNullCostCreate = JSON.parse(readFileSync(path.join(tempDir, "catalog.json"), "utf8")) as {
      models: Record<string, Record<string, unknown>>;
    };
    const storedModelWithoutCost = writtenConfigAfterNullCostCreate.models["mcp-test-model-no-cost"];
    assert.ok(storedModelWithoutCost);
    assert.equal("cost" in storedModelWithoutCost, false);

    const providerCreate = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "providers_create",
        arguments: {
          provider_id: "mcp-test-provider",
          endpoint: "https://example.invalid/v1",
          api_mode: "openai-completions"
        }
      }
    }, configPath);
    const providerCreatePayload = (((providerCreate.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerCreatePayload["ok"], true);
    assert.equal(((providerCreatePayload["data"] as Record<string, unknown>)["name"]), "mcp-test-provider");
    assert.equal(((providerCreatePayload["data"] as Record<string, unknown>)["api_mode"]), "openai-completions");

    const routeCreate = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "routes_create",
        arguments: {
          route_id: "mcp-test-route",
          model: "mcp-test-model",
          service_provider: "mcp-test-provider",
          provider_model_id: "provider-model",
          display_name: "MCP Test Route"
        }
      }
    }, configPath);
    const routeCreatePayload = (((routeCreate.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(routeCreatePayload["ok"], true);
    assert.equal(((routeCreatePayload["data"] as Record<string, unknown>)["name"]), "mcp-test-route");

    const duplicateModel = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "models_create",
        arguments: {
          model_id: "mcp-test-model",
          display_name: "Duplicate",
          model_creator: "switchmaxxer"
        }
      }
    }, configPath);
    const duplicateModelResult = duplicateModel.response?.["result"] as Record<string, unknown>;
    const duplicateModelPayload = duplicateModelResult["structuredContent"] as Record<string, unknown>;
    assert.equal(duplicateModelResult["isError"], true);
    assert.equal(((duplicateModelPayload["error"] as Record<string, unknown>)["code"]), "model_already_exists");

    const auditStore = bootstrapObservabilityStore({ dbPath });
    try {
      const auditService = new ObservabilityService(auditStore.db);
      const createdModelEvents = auditService.controlPlaneActions.listEvents({
        operation: "models_create",
        targetKind: "model",
        targetId: "mcp-test-model"
      });
      assert.equal(createdModelEvents.length, 2);
      assert.equal(createdModelEvents.some((event) => event.status === "succeeded"), true);
      assert.equal(createdModelEvents.some((event) => event.status === "failed" && event.error_json.includes("model_already_exists")), true);
      assert.equal(createdModelEvents.every((event) => event.source_surface === "mcp"), true);
    } finally {
      closeObservabilityStore(auditStore);
    }

    const routeUpdate = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "routes_update",
        arguments: {
          route_id: "mcp-test-route",
          display_name: "Updated MCP Route",
          cost: null
        }
      }
    }, configPath);
    const routeUpdatePayload = (((routeUpdate.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(routeUpdatePayload["ok"], true);
    assert.equal(((routeUpdatePayload["data"] as Record<string, unknown>)["display_name"]), "Updated MCP Route");

    const providerSetKey = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "providers_set_key",
        arguments: {
          provider_id: "mcp-test-provider",
          api_key: "sk-test-inline"
        }
      }
    }, configPath);
    const providerSetKeyPayload = (((providerSetKey.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerSetKeyPayload["ok"], true);
    assert.equal(((providerSetKeyPayload["data"] as Record<string, unknown>)["api_key"]), "***masked***");

    const providerSetKeyRejected = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15.25,
      method: "tools/call",
      params: {
        name: "providers_set_key",
        arguments: {
          provider_id: "mcp-test-provider",
          api_key: "***masked***"
        }
      }
    }, configPath);
    const providerSetKeyRejectedResult = providerSetKeyRejected.response?.["result"] as Record<string, unknown>;
    const providerSetKeyRejectedPayload = providerSetKeyRejectedResult["structuredContent"] as Record<string, unknown>;
    assert.equal(providerSetKeyRejectedResult["isError"], true);
    assert.equal(((providerSetKeyRejectedPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const providerUpdateRejected = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15.5,
      method: "tools/call",
      params: {
        name: "providers_update",
        arguments: {
          provider_id: "mcp-test-provider",
          api_key: "***masked***"
        }
      }
    }, configPath);
    const providerUpdateRejectedResult = providerUpdateRejected.response?.["result"] as Record<string, unknown>;
    const providerUpdateRejectedPayload = providerUpdateRejectedResult["structuredContent"] as Record<string, unknown>;
    assert.equal(providerUpdateRejectedResult["isError"], true);
    assert.equal(((providerUpdateRejectedPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const providerCreateRejected = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15.75,
      method: "tools/call",
      params: {
        name: "providers_create",
        arguments: {
          provider_id: "mcp-test-provider-masked",
          endpoint: "https://example.invalid/v1",
          api_mode: "openai-completions",
          api_key: "***masked***"
        }
      }
    }, configPath);
    const providerCreateRejectedResult = providerCreateRejected.response?.["result"] as Record<string, unknown>;
    const providerCreateRejectedPayload = providerCreateRejectedResult["structuredContent"] as Record<string, unknown>;
    assert.equal(providerCreateRejectedResult["isError"], true);
    assert.equal(((providerCreateRejectedPayload["error"] as Record<string, unknown>)["code"]), "invalid_input_field");

    const providerCreateNearMatch = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15.875,
      method: "tools/call",
      params: {
        name: "providers_create",
        arguments: {
          provider_id: "mcp-test-provider-near-mask",
          endpoint: "https://example.invalid/v1",
          api_mode: "openai-completions"
        }
      }
    }, configPath);
    const providerCreateNearMatchPayload = ((((providerCreateNearMatch.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>));
    assert.equal(providerCreateNearMatchPayload["ok"], true);

    const providerSetKeyNearMatch = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 15.9,
      method: "tools/call",
      params: {
        name: "providers_set_key",
        arguments: {
          provider_id: "mcp-test-provider-near-mask",
          api_key: "***masked***x"
        }
      }
    }, configPath);
    const providerSetKeyNearMatchPayload = ((((providerSetKeyNearMatch.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>));
    assert.equal(providerSetKeyNearMatchPayload["ok"], true);
    assert.equal(((providerSetKeyNearMatchPayload["data"] as Record<string, unknown>)["api_key"]), "***masked***");

    const providerClearKey = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "providers_clear_key",
        arguments: {
          provider_id: "mcp-test-provider"
        }
      }
    }, configPath);
    const providerClearKeyPayload = (((providerClearKey.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerClearKeyPayload["ok"], true);
    assert.equal(((providerClearKeyPayload["data"] as Record<string, unknown>)["api_key"]), null);

    const providerSetKeyEnv = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "providers_set_key_env",
        arguments: {
          provider_id: "mcp-test-provider",
          api_key_env: providerEnvVarName
        }
      }
    }, configPath);
    const providerSetKeyEnvPayload = (((providerSetKeyEnv.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerSetKeyEnvPayload["ok"], true);
    assert.equal(((providerSetKeyEnvPayload["data"] as Record<string, unknown>)["api_key_env"]), MASKED_ENV_NAME_SENTINEL);

    const routeDelete = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "routes_delete",
        arguments: {
          route_id: "mcp-test-route"
        }
      }
    }, configPath);
    const routeDeletePayload = (((routeDelete.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(routeDeletePayload["ok"], true);

    const providerDelete = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "providers_delete",
        arguments: {
          provider_id: "mcp-test-provider"
        }
      }
    }, configPath);
    const providerDeletePayload = (((providerDelete.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(providerDeletePayload["ok"], true);

    const modelDelete = await handleMcpRequestForTests({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "models_delete",
        arguments: {
          model_id: "mcp-test-model"
        }
      }
    }, configPath);
    const modelDeletePayload = (((modelDelete.response?.["result"] as Record<string, unknown>)["structuredContent"]) as Record<string, unknown>);
    assert.equal(modelDeletePayload["ok"], true);
  } finally {
    if (typeof previousProviderEnv === "string") {
      process.env[providerEnvVarName] = previousProviderEnv;
    } else {
      delete process.env[providerEnvVarName];
    }
    if (typeof previousInboundKey === "string") {
      process.env[inboundEnvVarName] = previousInboundKey;
    } else {
      delete process.env[inboundEnvVarName];
    }
    for (const envName of providerEnvNames) {
      const previousValue = previousProviderEnvValues.get(envName);
      if (typeof previousValue === "string") {
        process.env[envName] = previousValue;
      } else {
        delete process.env[envName];
      }
    }
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
