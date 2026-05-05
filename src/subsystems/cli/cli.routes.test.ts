import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../config/config";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { run } from "../../index";
import { captureCliIo, parseCliEnvelope, runWithCapturedIo, test } from "./cli.test-support";
import { copyExampleConfigPairForTests } from "../config/config-file.test-support";

void test("runCli routes routes help through the routes command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["routes", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer routes/);
  assert.match(stdout, /routes explain/);
  assert.match(stdout, /explain\s+Explain route resolution details/);
  assert.equal(stderr, "");
});

void test("runCli routes list emits column-aligned text output", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    copyExampleConfigPairForTests(configPath);
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "test-inbound-auth-token-for-list-output";

    const { result, stdout } = await runWithCapturedIo(["routes", "list", "--config", configPath]);
    const lines = stdout.trimEnd().split("\n");

    assert.equal(result, 0);
    assert.match(
      lines[0] ?? "",
      /^NAME\s+DISPLAY_NAME\s+MODEL\s+PROVIDER\s+PROVIDER_MODEL\s+API_MODE\s+EFFECTIVE_TIMEOUT_MS\s+EFFECTIVE_COST$/
    );
    assert.match(
      lines.find((line) => line.startsWith("gpt-4o-mini")) ?? "",
      /^gpt-4o-mini\s+GPT-4o-Mini\s+gpt-4o-mini\s+openai_direct\s+gpt-4o-mini\s+openai-completions\s+15000\s+input=0\.15 output=0\.6 cacheRead=0\.075 cacheWrite=0\.15$/
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

void test("runCli returns typed json mutation errors for duplicate route create", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousAnthropicKey = process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  const previousMiniMaxKey = process.env["SWITCHMAXXER_MINIMAX_API_KEY"];

  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";
    copyExampleConfigPairForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) =>
        await run([
          "routes",
          "create",
          "gpt-4o-mini",
          "--json",
          "--config",
          configPath,
          "--model",
          "gpt-4o-mini",
          "--service-provider",
          "openai_direct",
          "--provider-model-id",
          "gpt-4o-mini",
          "--display-name",
          "Duplicate Route"
        ], io)
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "routes create",
      schema_version: "1",
      error: {
        code: "route_already_exists",
        message: "Route 'gpt-4o-mini' already exists"
      }
    });
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

void test("runCli emits routes CRUD fallback error codes for missing config reads and mutations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const listResult = await runWithCapturedIo([
      "routes",
      "list",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(listResult.result, 1);
    assert.equal((parseCliEnvelope(listResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesListError);

    const showResult = await runWithCapturedIo([
      "routes",
      "show",
      "demo-route",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(showResult.result, 1);
    assert.equal((parseCliEnvelope(showResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesShowError);

    const explainResult = await runWithCapturedIo([
      "routes",
      "explain",
      "demo-route",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(explainResult.result, 1);
    assert.equal((parseCliEnvelope(explainResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesExplainError);

    const createResult = await runWithCapturedIo([
      "routes",
      "create",
      "demo-route",
      "--json",
      "--config",
      missingConfigPath,
      "--model",
      "demo-model",
      "--service-provider",
      "provider_id",
      "--provider-model-id",
      "demo-model",
      "--display-name",
      "Demo Route"
    ]);
    assert.equal(createResult.result, 1);
    assert.equal((parseCliEnvelope(createResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesCreateError);

    const updateResult = await runWithCapturedIo([
      "routes",
      "update",
      "demo-route",
      "--json",
      "--config",
      missingConfigPath,
      "--display-name",
      "Updated Route"
    ]);
    assert.equal(updateResult.result, 1);
    assert.equal((parseCliEnvelope(updateResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesUpdateError);

    const deleteResult = await runWithCapturedIo([
      "routes",
      "delete",
      "demo-route",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(deleteResult.result, 1);
    assert.equal((parseCliEnvelope(deleteResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routesDeleteError);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli rejects mixing routes create structured input with flag-sugar fields before mutation runtime", async () => {
  const { result, stdout, stderr } = await captureCliIo(async (io) =>
    await run([
      "routes",
      "create",
      "--json",
      "--stdin",
      "--timeout-ms",
      "90000"
    ], {
      ...io,
      stdin: {
        isTTY: false,
        readAllSync: () =>
          JSON.stringify({
            name: "route_id",
            model: "gpt-4o-mini",
            service_provider: "provider_id",
            provider_model_id: "gpt-4o-mini",
            display_name: "Example Route"
          }),
        readAll: async () =>
          JSON.stringify({
            name: "route_id",
            model: "gpt-4o-mini",
            service_provider: "provider_id",
            provider_model_id: "gpt-4o-mini",
            display_name: "Example Route"
          })
      }
    })
  );

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "routes create",
    schema_version: "1",
    error: {
      code: "conflicting_input_modes",
      message: "Do not mix '--stdin' or '--json-input' with '--cost-*' flags, '--clear-cost', '--timeout-ms', or '--clear-timeout-ms' for 'routes create'"
    }
  });
});

void test("runCli routes update clears route timeout via --clear-timeout-ms", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousAnthropicKey = process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  const previousMiniMaxKey = process.env["SWITCHMAXXER_MINIMAX_API_KEY"];

  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";

    copyExampleConfigPairForTests(configPath);
    const catalogPath = path.join(tempDir, "catalog.json");
    const document = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      routes: Record<string, Record<string, unknown>>;
    };
    document.routes["gpt-4o-mini"] = {
      ...document.routes["gpt-4o-mini"],
      timeout_ms: 4321
    };
    writeFileSync(catalogPath, `${JSON.stringify(document, null, 2)}\n`);
    chmodSync(catalogPath, 0o600);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) =>
        await run([
          "routes",
          "update",
          "gpt-4o-mini",
          "--json",
          "--config",
          configPath,
          "--clear-timeout-ms"
        ], io)
    );

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: true,
      command: "routes update",
      schema_version: "1",
      data: {
        name: "gpt-4o-mini",
        display_name: "GPT-4o-Mini",
        model: "gpt-4o-mini",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        api_mode: "openai-completions",
        timeout_ms: null,
        effective_timeout_ms: 15000,
        cost: {
          input: 0.15,
          output: 0.6,
          cacheRead: 0.075,
          cacheWrite: 0.15
        },
        model_cost: {
          input: 0.15,
          output: 0.6,
          cacheRead: 0.075,
          cacheWrite: 0.15
        },
        effective_cost: {
          input: 0.15,
          output: 0.6,
          cacheRead: 0.075,
          cacheWrite: 0.15
        }
      }
    });

    const reloaded = loadConfig(configPath);
    assert.equal(reloaded.routes["gpt-4o-mini"]?.routeTimeoutMs, null);
    const persisted = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      routes: Record<string, Record<string, unknown>>;
    };
    assert.equal("timeout_ms" in (persisted.routes["gpt-4o-mini"] ?? {}), false);
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

void test("runCli rejects unknown fields in routes update structured json input", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "routes-update-unknown-field.json");

  try {
    writeFileSync(inputPath, JSON.stringify({ name: "demo-route" }));

    const { result, stdout, stderr } = await runWithCapturedIo([
      "routes",
      "update",
      "demo-route",
      "--json",
      "--json-input",
      inputPath
    ]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "routes update",
      schema_version: "1",
      error: {
        code: "invalid_input_field",
        message: "json input does not support field 'name'"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
