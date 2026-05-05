import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { run } from "../../index";
import { MASKED_ENV_NAME_SENTINEL } from "../../platform/masked-secret";
import { captureCliIo, parseCliEnvelope, runWithCapturedIo, test } from "./cli.test-support";
import { SWITCHMAXXER_SECRETS_PATH_ENV } from "../config/secrets-path";
import {
  copyExampleConfigPairForTests,
  splitExistingConfigFileForTests
} from "../config/config-file.test-support";

void test("runCli routes models help through the models command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["models", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer models/);
  assert.match(stdout, /models list/);
  assert.match(stdout, /create\s+Create a model/);
  assert.equal(stderr, "");
});

void test("runCli models list emits column-aligned text output", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    copyExampleConfigPairForTests(configPath);
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "test-inbound-auth-token-for-list-output";

    const { result, stdout } = await runWithCapturedIo(["models", "list", "--config", configPath]);
    const lines = stdout.trimEnd().split("\n");

    assert.equal(result, 0);
    assert.match(lines[0] ?? "", /^NAME\s+DISPLAY_NAME\s+CREATOR\s+ROUTES\s+COST$/);
    assert.match(
      lines.find((line) => line.startsWith("gpt-4o-mini")) ?? "",
      /^gpt-4o-mini\s+GPT-4o-Mini\s+openai\s+2\s+input=0\.15 output=0\.6 cacheRead=0\.075 cacheWrite=0\.15$/
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

void test("runCli providers list emits column-aligned text output", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    copyExampleConfigPairForTests(configPath);
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "test-inbound-auth-token-for-list-output";

    const { result, stdout } = await runWithCapturedIo(["providers", "list", "--config", configPath]);
    const lines = stdout.trimEnd().split("\n");

    assert.equal(result, 0);
    assert.match(
      lines[0] ?? "",
      /^NAME\s+API_MODE\s+ENDPOINT\s+ANTHROPIC_VERSION\s+MODEL_ID_FORMAT\s+AUTH_SOURCE\s+API_KEY_ENV$/
    );
    assert.match(
      lines.find((line) => line.startsWith("openai_direct")) ?? "",
      /^openai_direct\s+openai-completions\s+https:\/\/api\.openai\.com\/v1\/chat\/completions\s+null\s+passthrough\s+env var\s+\(configured\)$/
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

void test("runCli model mutations write to catalog.json", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-catalog-mutation-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");
  const envKeys = [
    "SWITCHMAXXER_INBOUND_API_KEY",
    "SWITCHMAXXER_OPENAI_API_KEY",
    "SWITCHMAXXER_ANTHROPIC_API_KEY",
    "SWITCHMAXXER_OPENROUTER_API_KEY",
    "SWITCHMAXXER_MINIMAX_API_KEY"
  ];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

  try {
    copyExampleConfigPairForTests(configPath);

    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";

    const { result, stdout, stderr } = await runWithCapturedIo([
      "models",
      "create",
      "catalog-added-model",
      "--json",
      "--config",
      configPath,
      "--display-name",
      "Catalog Added Model",
      "--model-creator",
      "switchmaxxer"
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.equal((parseCliEnvelope(stdout)["data"] as Record<string, unknown>)["name"], "catalog-added-model");

    const writtenConfig = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const writtenCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      models?: Record<string, unknown>;
    };

    assert.equal(writtenConfig["models"], undefined);
    assert.deepEqual(writtenCatalog.models?.["catalog-added-model"], {
      display_name: "Catalog Added Model",
      model_creator: "switchmaxxer"
    });
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli providers surfaces report secrets override auth without printing the secret", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-provider-secrets-"));
  const configPath = path.join(tempDir, "config.json");
  const secretsPath = path.join(tempDir, "secrets.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY_FROM_SECRETS";
  const previousEnvValue = process.env[envVarName];
  const previousSecretsPath = process.env[SWITCHMAXXER_SECRETS_PATH_ENV];

  try {
    delete process.env[envVarName];
    process.env[SWITCHMAXXER_SECRETS_PATH_ENV] = secretsPath;
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4080,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {
            provider_a: {
              endpoint: "https://api.example.com/v1/chat/completions",
              api_key_env: envVarName,
              api_mode: "openai-completions"
            }
          },
          models: {
            model_a: {
              display_name: "Model A",
              model_creator: "example"
            }
          },
          routes: {
            route_a: {
              model: "model_a",
              service_provider: "provider_a",
              provider_model_id: "provider-model-a",
              display_name: "Route A"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);
    writeFileSync(
      secretsPath,
      JSON.stringify(
        {
          api_key_overrides: {
            [envVarName]: "sk-provider-key-from-secrets"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(secretsPath, 0o600);

    const listResult = await runWithCapturedIo(["providers", "list", "--config", configPath]);
    assert.equal(listResult.result, 0);
    assert.match(listResult.stdout, /provider_a\s+openai-completions\s+https:\/\/api\.example\.com\/v1\/chat\/completions\s+null\s+passthrough\s+secrets override\s+\(configured\)/);
    assert.doesNotMatch(listResult.stdout, /sk-provider-key-from-secrets/);

    const showResult = await runWithCapturedIo(["providers", "show", "provider_a", "--config", configPath, "--json"]);
    assert.equal(showResult.result, 0);
    const payload = parseCliEnvelope(showResult.stdout) as {
      data: {
        auth_source: string;
        api_key_env: string;
        api_key: string | null;
      };
    };

    assert.equal(payload.data.auth_source, "secrets override");
    assert.equal(payload.data.api_key_env, MASKED_ENV_NAME_SENTINEL);
    assert.equal(payload.data.api_key, null);
    assert.doesNotMatch(showResult.stdout, /sk-provider-key-from-secrets/);
  } finally {
    if (typeof previousEnvValue === "string") {
      process.env[envVarName] = previousEnvValue;
    } else {
      delete process.env[envVarName];
    }

    if (typeof previousSecretsPath === "string") {
      process.env[SWITCHMAXXER_SECRETS_PATH_ENV] = previousSecretsPath;
    } else {
      delete process.env[SWITCHMAXXER_SECRETS_PATH_ENV];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli returns typed json mutation errors for duplicate model create", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    copyExampleConfigPairForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) =>
        await run([
          "models",
          "create",
          "gpt-4o-mini",
          "--json",
          "--config",
          configPath,
          "--display-name",
          "Duplicate",
          "--model-creator",
          "test"
        ], io)
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "models create",
      schema_version: "1",
      error: {
        code: "model_already_exists",
        message: "Model 'gpt-4o-mini' already exists"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli emits models CRUD fallback error codes for missing config reads and mutations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const listResult = await runWithCapturedIo([
      "models",
      "list",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(listResult.result, 1);
    assert.equal((parseCliEnvelope(listResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.modelsListError);

    const showResult = await runWithCapturedIo([
      "models",
      "show",
      "demo-model",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(showResult.result, 1);
    assert.equal((parseCliEnvelope(showResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.modelsShowError);

    const createResult = await runWithCapturedIo([
      "models",
      "create",
      "demo-model",
      "--json",
      "--config",
      missingConfigPath,
      "--display-name",
      "Demo Model",
      "--model-creator",
      "test"
    ]);
    assert.equal(createResult.result, 1);
    assert.equal((parseCliEnvelope(createResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.modelsCreateError);

    const updateResult = await runWithCapturedIo([
      "models",
      "update",
      "demo-model",
      "--json",
      "--config",
      missingConfigPath,
      "--display-name",
      "Updated Model"
    ]);
    assert.equal(updateResult.result, 1);
    assert.equal((parseCliEnvelope(updateResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.modelsUpdateError);

    const deleteResult = await runWithCapturedIo([
      "models",
      "delete",
      "demo-model",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(deleteResult.result, 1);
    assert.equal((parseCliEnvelope(deleteResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.modelsDeleteError);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli enforces declarative positional metadata for models create", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["models", "create"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Missing required argument '<name>' for 'models create'/);
});

void test("runCli enforces typed required-flag semantics for models create", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["models", "create", "demo-model", "--display-name", "Demo Model"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--model-creator' is required when not using '--stdin' or '--json-input'/);
});

void test("runCli enforces typed unsupported clear-cost semantics for models create", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["models", "create", "demo-model", "--clear-cost"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--clear-cost' is not supported for 'models create'/);
});

void test("runCli returns typed json usage errors for unsupported clear-cost semantics", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo([
    "models",
    "create",
    "demo-model",
    "--json",
    "--clear-cost"
  ]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "models create",
    schema_version: "1",
    error: {
      code: APP_ERROR_CODES.unsupportedClearCost,
      message: "Flag '--clear-cost' is not supported for 'models create'"
    }
  });
});

void test("runCli returns typed json usage errors for conflicting cost flags", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo([
    "models",
    "update",
    "demo-model",
    "--json",
    "--clear-cost",
    "--cost-input",
    "1",
    "--cost-output",
    "1",
    "--cost-cache-read",
    "1",
    "--cost-cache-write",
    "1"
  ]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "models update",
    schema_version: "1",
    error: {
      code: APP_ERROR_CODES.conflictingCostFlags,
      message: "Flag '--clear-cost' cannot be combined with explicit '--cost-*' values"
    }
  });
});

void test("runCli returns typed json usage errors for conflicting structured-input modes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "models-update.json");

  try {
    writeFileSync(inputPath, JSON.stringify({ display_name: "Demo Model" }));

    const { result, stdout, stderr } = await runWithCapturedIo([
      "models",
      "update",
      "demo-model",
      "--json",
      "--stdin",
      "--json-input",
      inputPath
    ]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "models update",
      schema_version: "1",
      error: {
        code: APP_ERROR_CODES.conflictingStructuredInput,
        message: "Use only one of '--stdin' or '--json-input' for 'models update'"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli enforces the shared update-field contract for models update", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["models", "update", "demo-model"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'/);
});

void test("runCli returns typed json usage errors for models update structured-input field validation", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "models-update.json");

  try {
    writeFileSync(inputPath, JSON.stringify({ display_name: "" }));

    const { result, stdout, stderr } = await runWithCapturedIo(["models", "update", "demo-model", "--json", "--json-input", inputPath]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "models update",
      schema_version: "1",
      error: {
        code: "invalid_input_field",
        message: "json input field 'display_name' must be a non-empty string"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli returns typed json usage errors for models update structured-input cost validation", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "models-update-cost.json");

  try {
    writeFileSync(
      inputPath,
      JSON.stringify({
        cost: {
          input: -1,
          output: 1,
          cache_read: 1,
          cache_write: 1
        }
      })
    );

    const { result, stdout, stderr } = await runWithCapturedIo(["models", "update", "demo-model", "--json", "--json-input", inputPath]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "models update",
      schema_version: "1",
      error: {
        code: "invalid_input_field",
        message: "json input field 'cost'.input must be a non-negative number"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli rejects unknown fields in models update structured json input", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "models-update-unknown-field.json");

  try {
    writeFileSync(inputPath, JSON.stringify({ unexpected: true }));

    const { result, stdout, stderr } = await runWithCapturedIo(["models", "update", "demo-model", "--json", "--json-input", inputPath]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "models update",
      schema_version: "1",
      error: {
        code: "invalid_input_field",
        message: "json input does not support field 'unexpected'"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli returns typed json usage errors for malformed structured json input", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "models-update-bad-json.json");

  try {
    writeFileSync(inputPath, "{");

    const { result, stdout, stderr } = await runWithCapturedIo(["models", "update", "demo-model", "--json", "--json-input", inputPath]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      ok: boolean;
      command: string;
      schema_version: string;
      error: {
        code: string;
        message: string;
      };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.command, "models update");
    assert.equal(payload.schema_version, "1");
    assert.equal(payload.error.code, "invalid_input_field");
    assert.match(payload.error.message, /models-update-bad-json\.json is not valid JSON:/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli routes providers help through the providers command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["providers", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer providers/);
  assert.match(stdout, /providers set-key/);
  assert.match(stdout, /set-key-env\s+Point provider auth at an env var/);
  assert.equal(stderr, "");
});

void test("runCli enforces declarative positional metadata for providers set-key-env", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["providers", "set-key-env", "provider_id"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Missing required argument '<env_var>' for 'providers set-key-env'/);
});

void test("runCli enforces the typed required-flag contract for providers set-key", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["providers", "set-key", "provider_id"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--api-key-stdin' is required for 'providers set-key'/);
});

void test("runCli returns typed json usage errors for providers update invalid flag values", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["providers", "update", "provider_id", "--json", "--api-mode", "bogus"]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "providers update",
    schema_version: "1",
    error: {
      code: "invalid_flag_value",
      message: "Flag '--api-mode' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'"
    }
  });
});

void test("runCli returns typed json usage errors for providers update missing flag values", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["providers", "update", "provider_id", "--json", "--api-mode"]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "providers update",
    schema_version: "1",
    error: {
      code: "missing_flag_value",
      message: "Flag '--api-mode' requires a value"
    }
  });
});

void test("runCli rejects conflicting providers create auth flags before mutation runtime", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo([
    "providers",
    "create",
    "provider_id",
    "--json",
    "--endpoint",
    "https://api.example.invalid/v1/chat/completions",
    "--api-mode",
    "openai-completions",
    "--api-key-env",
    "SWITCHMAXXER_OPENAI_API_KEY",
    "--no-auth"
  ]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "providers create",
    schema_version: "1",
    error: {
      code: "conflicting_input_modes",
      message: "Flag '--no-auth' cannot be combined with '--api-key-stdin' or '--api-key-env'"
    }
  });
});

void test("runCli returns typed json mutation errors for duplicate provider create", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    copyExampleConfigPairForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) =>
        await run([
          "providers",
          "create",
          "openai_direct",
          "--json",
          "--config",
          configPath,
          "--endpoint",
          "https://api.openai.com/v1/chat/completions",
          "--api-mode",
          "openai-completions",
          "--api-key-env",
          "SWITCHMAXXER_OPENAI_API_KEY"
        ], io)
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "providers create",
      schema_version: "1",
      error: {
        code: "provider_already_exists",
        message: "Provider 'openai_direct' already exists"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli emits providers CRUD fallback error codes for missing config reads and mutations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const listResult = await runWithCapturedIo([
      "providers",
      "list",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(listResult.result, 1);
    assert.equal((parseCliEnvelope(listResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersListError);

    const showResult = await runWithCapturedIo([
      "providers",
      "show",
      "provider_id",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(showResult.result, 1);
    assert.equal((parseCliEnvelope(showResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersShowError);

    const createResult = await runWithCapturedIo([
      "providers",
      "create",
      "provider_id",
      "--json",
      "--config",
      missingConfigPath,
      "--endpoint",
      "https://api.example.invalid/v1/chat/completions",
      "--api-mode",
      "openai-completions",
      "--api-key-env",
      "SWITCHMAXXER_OPENAI_API_KEY"
    ]);
    assert.equal(createResult.result, 1);
    assert.equal((parseCliEnvelope(createResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersCreateError);

    const updateResult = await runWithCapturedIo([
      "providers",
      "update",
      "provider_id",
      "--json",
      "--config",
      missingConfigPath,
      "--endpoint",
      "https://api.example.invalid/v1/responses"
    ]);
    assert.equal(updateResult.result, 1);
    assert.equal((parseCliEnvelope(updateResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersUpdateError);

    const deleteResult = await runWithCapturedIo([
      "providers",
      "delete",
      "provider_id",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(deleteResult.result, 1);
    assert.equal((parseCliEnvelope(deleteResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersDeleteError);

    const setKeyEnvResult = await runWithCapturedIo([
      "providers",
      "set-key-env",
      "provider_id",
      "SWITCHMAXXER_OPENAI_API_KEY",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(setKeyEnvResult.result, 1);
    assert.equal((parseCliEnvelope(setKeyEnvResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersSetKeyEnvError);

    const clearKeyResult = await runWithCapturedIo([
      "providers",
      "clear-key",
      "provider_id",
      "--json",
      "--config",
      missingConfigPath
    ]);
    assert.equal(clearKeyResult.result, 1);
    assert.equal((parseCliEnvelope(clearKeyResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersClearKeyError);

    const setKeyResult = await captureCliIo(async (io) =>
      await run([
        "providers",
        "set-key",
        "provider_id",
        "--json",
        "--config",
        missingConfigPath,
        "--api-key-stdin"
      ], {
        ...io,
        stdin: {
          isTTY: false,
          readAllSync: () => "sk-test-inline",
          readAll: async () => "sk-test-inline"
        }
      })
    );
    assert.equal(setKeyResult.result, 1);
    assert.equal((parseCliEnvelope(setKeyResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.providersSetKeyError);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli rejects unknown fields in providers update structured json input", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const inputPath = path.join(tempDir, "providers-update-unknown-field.json");

  try {
    writeFileSync(inputPath, JSON.stringify({ api_key: "sk-test" }));

    const { result, stdout, stderr } = await runWithCapturedIo([
      "providers",
      "update",
      "provider_id",
      "--json",
      "--json-input",
      inputPath
    ]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "providers update",
      schema_version: "1",
      error: {
        code: "invalid_input_field",
        message:
          "json input field 'api_key' is not supported by 'providers update'; use 'providers set-key' or 'providers clear-key'"
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli providers show json masks api_key_env display values", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_ACME_CORP_CUSTOMER_42_KEY_2026";

  try {
    copyExampleConfigPairForTests(configPath);
    const catalogPath = path.join(tempDir, "catalog.json");
    const document = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      service_providers: Record<string, Record<string, unknown>>;
    };
    document.service_providers["openai_direct"] = {
      ...document.service_providers["openai_direct"],
      api_key_env: envVarName
    };
    writeFileSync(catalogPath, `${JSON.stringify(document, null, 2)}\n`);
    chmodSync(catalogPath, 0o600);

    const { result, stdout, stderr } = await runWithCapturedIo([
      "providers",
      "show",
      "openai_direct",
      "--json",
      "--config",
      configPath
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as { data: Record<string, unknown> };
    assert.equal(payload.data["api_key_env"], MASKED_ENV_NAME_SENTINEL);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
