import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_CONFIG_FILE_BYTES } from "../config/config-read";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { MASKED_SECRET_SENTINEL } from "../../platform/masked-secret";
import { run } from "../../index";
import { captureCliIo, parseCliEnvelope, runWithCapturedIo, test } from "./cli.test-support";
import { writeSplitConfigForTests } from "../config/config-file.test-support";

function buildConfigImportSecretRedactionDocument(apiKey: string | null): Record<string, unknown> {
  return {
    bind_host: "127.0.0.1",
    port: 4080,
    max_connections: 200,
    timeout_ms: 15000,
    stream_idle_timeout_ms: 120000,
    max_payload_size: 4000000,
    rate_limit: {
      requests: 50,
      window: "1s"
    },
    allow_unauthenticated_gateway: true,
    service_providers: {
      provider_a: {
        endpoint: "https://api.openai.com/v1/chat/completions",
        api_key: apiKey,
        api_mode: "openai-completions"
      }
    },
    models: {
      model_a: {
        display_name: "Model A",
        model_creator: "openai"
      }
    },
    routes: {
      route_a: {
        model: "model_a",
        service_provider: "provider_a",
        provider_model_id: "gpt-4o-mini",
        display_name: "Route A"
      }
    }
  };
}

function writeConfigImportSecretRedactionDocument(filePath: string, apiKey: string | null): void {
  writeFileSync(
    filePath,
    `${JSON.stringify(buildConfigImportSecretRedactionDocument(apiKey), null, 2)}\n`,
    "utf8"
  );
}

function assertNoSecretLeaks(output: string, secrets: Array<string | null>): void {
  for (const secret of secrets) {
    if (secret === null) {
      continue;
    }

    assert.equal(output.includes(secret), false, `output leaked secret '${secret}'`);
  }
}

void test("runCli routes config help through the config command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer config/);
  assert.match(stdout, /config validate/);
  assert.match(stdout, /import\s+Import a full config document/);
  assert.equal(stderr, "");
});

void test("runCli enforces declarative positional metadata for config set", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "set", "max_payload_size"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Missing required argument '<value>' for 'config set'/);
});

void test("runCli enforces typed config-set field validation", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "set", "bogus_key", "123"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown config key 'bogus_key' for 'config set'/);
});

void test("runCli config set rejects non-canonical max_payload_size integers", async () => {
  for (const value of ["123abc", "1.5", "+1", " 123", "123 ", "9007199254740992"]) {
    const { result, stdout, stderr } = await runWithCapturedIo(["config", "set", "max_payload_size", value]);

    assert.equal(result, 2, value);
    assert.equal(stdout, "", value);
    assert.match(stderr, /Value for 'max_payload_size' must be a positive integer number of bytes/, value);
  }
});

void test("runCli config set json emits config_set_error for mutation failures", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "set",
      "max_payload_size",
      "123",
      "--json",
      "--config",
      missingConfigPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, APP_ERROR_CODES.configSetError);
    assert.match(payload.error.message, /missing-config\.json/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli enforces the shared structured-input contract for config import", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "import"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Provide config input for 'config import' using '--stdin' or '--json-input'/);
});

void test("runCli returns typed json usage errors for config import input-mode failures", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "import", "--json"]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "config import",
    schema_version: "1",
    error: {
      code: "missing_required_field",
      message: "Provide config input for 'config import' using '--stdin' or '--json-input'"
    }
  });
});

void test("runCli config show json errors redact absolute config paths", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "show",
      "--json",
      "--config",
      missingConfigPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as { error: { code: string; message: string } };
    assert.equal(payload.error.code, APP_ERROR_CODES.configReadError);
    assert.match(payload.error.message, /Unable to read config at 'missing-config\.json'/);
    assert.doesNotMatch(payload.error.message, /switchmaxxer-cli-test-/);
    assert.doesNotMatch(payload.error.message, /\/home\/|[A-Za-z]:\\/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import json errors redact absolute json-input paths", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const badInputPath = path.join(tempDir, "bad-import.json");

  try {
    writeFileSync(configPath, readFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), "utf8"));
    chmodSync(configPath, 0o600);
    writeFileSync(badInputPath, "{\"routes\": {");

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "import",
      "--json",
      "--config",
      configPath,
      "--json-input",
      badInputPath
    ]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "invalid_input_field");
    assert.match(payload.error.message, /bad-import\.json is not valid JSON/);
    assert.doesNotMatch(payload.error.message, /switchmaxxer-cli-test-/);
    assert.doesNotMatch(payload.error.message, /\/home\/|[A-Za-z]:\\/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import rejects unknown top-level keys instead of silently dropping them", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const importPath = path.join(tempDir, "import.json");

  try {
    writeFileSync(configPath, readFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), "utf8"));
    chmodSync(configPath, 0o600);
    writeFileSync(
      importPath,
      `${JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4000,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          inbound_api_key_env: "SWITCHMAXXER_INBOUND_API_KEY",
          service_providers: {},
          models: {},
          routes: {},
          fooo_bar_model: {}
        },
        null,
        2
      )}\n`
    );

    const { result, stdout, stderr } = await captureCliIo(
      async (io) =>
        await run(
          [
            "config",
            "import",
            "--json",
            "--config",
            configPath,
            "--json-input",
            importPath
          ],
          {
            ...io,
            env: {
              ...io.env,
              SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef"
            }
          }
        )
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "config import",
      schema_version: "1",
      error: {
        code: "config_import_error",
        message: "config.json contains unsupported field 'fooo_bar_model'."
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import rejects oversized json-input before parsing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const importPath = path.join(tempDir, "oversized-import.json");

  try {
    writeFileSync(configPath, readFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), "utf8"));
    chmodSync(configPath, 0o600);
    writeFileSync(importPath, Buffer.alloc(MAX_CONFIG_FILE_BYTES + 1, 0x20));

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "import",
      "--json",
      "--backup",
      "--config",
      configPath,
      "--json-input",
      importPath
    ]);

    assert.equal(result, 2);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as { error: { code: string; message: string } };
    assert.equal(payload.error.code, "invalid_input_field");
    assert.match(payload.error.message, /oversized-import\.json exceeds the maximum supported size of 8 MB/);
    assert.doesNotMatch(payload.error.message, /switchmaxxer-cli-test-/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import rejects deeply nested stdin JSON before validation", async () => {
  let deepJson = "null";
  for (let index = 0; index < 257; index += 1) {
    deepJson = `{"child":${deepJson}}`;
  }

  const { result, stdout, stderr } = await captureCliIo(
    async (io) =>
      await run(
        [
          "config",
          "import",
          "--json",
          "--stdin"
        ],
        {
          ...io,
          stdin: {
            ...io.stdin,
            readAll: async () => deepJson
          }
        }
      )
  );

  assert.equal(result, 2);
  assert.equal(stderr, "");
  const payload = parseCliEnvelope(stdout) as unknown as { error: { code: string; message: string } };
  assert.equal(payload.error.code, "invalid_input_field");
  assert.match(payload.error.message, /stdin is not valid JSON: json_structure_too_large/);
});

void test("runCli config import rejects oversized current config before diffing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const importPath = path.join(tempDir, "import.json");

  try {
    writeFileSync(configPath, Buffer.alloc(MAX_CONFIG_FILE_BYTES + 1, 0x20));
    chmodSync(configPath, 0o600);
    writeFileSync(
      importPath,
      `${JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4000,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {},
          models: {},
          routes: {}
        },
        null,
        2
      )}\n`
    );

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "import",
      "--json",
      "--dry-run",
      "--config",
      configPath,
      "--json-input",
      importPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as { error: { code: string; message: string } };
    assert.equal(payload.error.code, APP_ERROR_CODES.configImportError);
    assert.match(payload.error.message, /config\.json.*exceeds the maximum supported size of 8 MB/);
    assert.doesNotMatch(payload.error.message, /switchmaxxer-cli-test-/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import writes catalog sections to catalog.json", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const importPath = path.join(tempDir, "import.json");

  try {
    const currentDocument = buildConfigImportSecretRedactionDocument(null);
    const importedDocument = buildConfigImportSecretRedactionDocument(null);
    importedDocument["timeout_ms"] = 22000;
    importedDocument["routes"] = {
      route_b: {
        model: "model_a",
        service_provider: "provider_a",
        provider_model_id: "gpt-4o-mini",
        display_name: "Route B"
      }
    };
    const catalogPath = writeSplitConfigForTests(configPath, currentDocument);
    writeFileSync(importPath, `${JSON.stringify(importedDocument, null, 2)}\n`, "utf8");

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "import",
      "--json",
      "--backup",
      "--config",
      configPath,
      "--json-input",
      importPath
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      data: {
        route_count: number;
        imported: boolean;
        backup_path: string;
        catalog_backup_path: string;
      };
    };
    const expectedConfigBackupPath = path.join(path.dirname(configPath), ".switchmaxxer", "catalog-backups", `${path.basename(configPath)}.bak`);
    const expectedCatalogBackupPath = path.join(path.dirname(catalogPath), ".switchmaxxer", "catalog-backups", `${path.basename(catalogPath)}.bak`);
    assert.equal(payload.data.route_count, 1);
    assert.equal(payload.data.imported, true);
    assert.equal(payload.data.backup_path, expectedConfigBackupPath);
    assert.equal(payload.data.catalog_backup_path, expectedCatalogBackupPath);
    assert.equal(statSync(expectedConfigBackupPath).mode & 0o777, 0o600);
    assert.equal(statSync(expectedCatalogBackupPath).mode & 0o777, 0o600);

    const configDocument = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    assert.equal(configDocument["timeout_ms"], 22000);
    assert.equal(typeof configDocument["service_providers"], "undefined");
    assert.equal(typeof configDocument["routes"], "undefined");
    assert.equal(typeof configDocument["models"], "undefined");

    const catalogDocument = JSON.parse(readFileSync(catalogPath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(catalogDocument["routes"] as Record<string, unknown>), ["route_b"]);
    assert.deepEqual(Object.keys(catalogDocument["service_providers"] as Record<string, unknown>), ["provider_a"]);
    assert.deepEqual(Object.keys(catalogDocument["models"] as Record<string, unknown>), ["model_a"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config import dry-run redacts inline provider secrets in text and json diffs", async () => {
  const scenarios: Array<{
    name: string;
    currentApiKey: string | null;
    importedApiKey: string | null;
    expectedSummary: RegExp;
  }> = [
    {
      name: "changed",
      currentApiKey: "sk-current-inline-secret",
      importedApiKey: "sk-imported-inline-secret",
      expectedSummary: /provider 'provider_a' inline api_key changed/
    },
    {
      name: "current-only",
      currentApiKey: "sk-current-only-inline-secret",
      importedApiKey: null,
      expectedSummary: /provider 'provider_a' inline api_key removed/
    },
    {
      name: "imported-only",
      currentApiKey: null,
      importedApiKey: "sk-imported-only-inline-secret",
      expectedSummary: /provider 'provider_a' inline api_key added/
    }
  ];

  for (const scenario of scenarios) {
    const tempDir = mkdtempSync(path.join(tmpdir(), `switchmaxxer-cli-import-redaction-${scenario.name}-`));
    const configPath = path.join(tempDir, "config.json");
    const importPath = path.join(tempDir, "import.json");
    const secrets = [scenario.currentApiKey, scenario.importedApiKey];

    try {
      writeSplitConfigForTests(configPath, buildConfigImportSecretRedactionDocument(scenario.currentApiKey));
      writeConfigImportSecretRedactionDocument(importPath, scenario.importedApiKey);

      const textResult = await runWithCapturedIo([
        "config",
        "import",
        "--dry-run",
        "--config",
        configPath,
        "--json-input",
        importPath
      ]);

      assert.equal(textResult.result, 0, scenario.name);
      assert.equal(textResult.stderr, "", scenario.name);
      assertNoSecretLeaks(textResult.stdout, secrets);
      assert.match(textResult.stdout, /# Redacted inline api_key changes:/, scenario.name);
      assert.match(textResult.stdout, scenario.expectedSummary, scenario.name);

      const jsonResult = await runWithCapturedIo([
        "config",
        "import",
        "--json",
        "--dry-run",
        "--config",
        configPath,
        "--json-input",
        importPath
      ]);

      assert.equal(jsonResult.result, 0, scenario.name);
      assert.equal(jsonResult.stderr, "", scenario.name);
      assertNoSecretLeaks(jsonResult.stdout, secrets);

      const payload = parseCliEnvelope(jsonResult.stdout) as unknown as {
        data: {
          changed: boolean;
          diff: string;
        };
      };

      assert.equal(payload.data.changed, true, scenario.name);
      assertNoSecretLeaks(payload.data.diff, secrets);
      assert.match(payload.data.diff, /# Redacted inline api_key changes:/, scenario.name);
      assert.match(payload.data.diff, scenario.expectedSummary, scenario.name);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

void test("runCli config export json emits canonical snake_case top-level runtime fields", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];

  try {
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";

    writeSplitConfigForTests(configPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      log_level: "info",
      max_connections: 200,
      timeout_ms: 15000,
      stream_idle_timeout_ms: 120000,
      max_payload_size: 4000000,
      rate_limit: {
        requests: 50,
        window: "1s"
      },
      allow_unauthenticated_gateway: true,
      service_providers: {
        provider_a: {
          endpoint: "https://api.openai.com/v1/chat/completions",
          api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          display_name: "Model A",
          model_creator: "openai"
        }
      },
      routes: {
        route_a: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "gpt-4o-mini",
          display_name: "Route A"
        }
      }
    });

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "export",
      "--json",
      "--config",
      configPath
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");

    const payload = parseCliEnvelope(stdout) as unknown as {
      data: {
        document: Record<string, unknown>;
      };
    };
    const document = payload.data.document;

    assert.equal(document["bind_host"], "127.0.0.1");
    assert.equal(document["log_level"], "info");
    assert.equal(document["max_connections"], 200);
    assert.equal(document["timeout_ms"], 15000);
    assert.equal(document["stream_idle_timeout_ms"], 120000);
    assert.equal(document["bindHost"], undefined);
    assert.equal(document["logLevel"], undefined);
    assert.equal(document["maxConnections"], undefined);
    assert.equal(document["timeoutMs"], undefined);
    assert.equal(document["streamIdleTimeoutMs"], undefined);
  } finally {
    if (typeof previousOpenAiKey === "string") {
      process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENAI_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config export redacts inline provider secrets by default", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      max_connections: 200,
      timeout_ms: 15000,
      stream_idle_timeout_ms: 120000,
      max_payload_size: 4000000,
      rate_limit: {
        requests: 50,
        window: "1s"
      },
      allow_unauthenticated_gateway: true,
      service_providers: {
        provider_a: {
          endpoint: "https://api.openai.com/v1/chat/completions",
          api_key: "sk-inline-secret",
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          display_name: "Model A",
          model_creator: "openai"
        }
      },
      routes: {
        route_a: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "gpt-4o-mini",
          display_name: "Route A"
        }
      }
    });

    const jsonResult = await runWithCapturedIo(["config", "export", "--json", "--config", configPath]);
    assert.equal(jsonResult.result, 0);
    assert.equal(jsonResult.stderr, "");
    assert.doesNotMatch(jsonResult.stdout, /sk-inline-secret/);

    const payload = parseCliEnvelope(jsonResult.stdout) as unknown as {
      data: {
        document: {
          service_providers: Record<string, { api_key: string }>;
        };
        secrets_included: boolean;
        secrets_redacted: boolean;
        secret_bearing: boolean;
      };
    };

    assert.equal(payload.data.document.service_providers["provider_a"]?.api_key, MASKED_SECRET_SENTINEL);
    assert.equal(payload.data.secrets_included, false);
    assert.equal(payload.data.secrets_redacted, true);
    assert.equal(payload.data.secret_bearing, false);

    const textResult = await runWithCapturedIo(["config", "export", "--config", configPath]);
    assert.equal(textResult.result, 0);
    assert.equal(textResult.stderr, "");
    assert.doesNotMatch(textResult.stdout, /sk-inline-secret/);

    const textDocument = JSON.parse(textResult.stdout) as {
      service_providers: Record<string, { api_key: string }>;
    };
    assert.equal(textDocument.service_providers["provider_a"]?.api_key, MASKED_SECRET_SENTINEL);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config export requires explicit file output for secret-bearing backups", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const outputPath = path.join(tempDir, "backup.json");

  try {
    writeSplitConfigForTests(configPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      max_connections: 200,
      timeout_ms: 15000,
      stream_idle_timeout_ms: 120000,
      max_payload_size: 4000000,
      rate_limit: {
        requests: 50,
        window: "1s"
      },
      allow_unauthenticated_gateway: true,
      service_providers: {
        provider_a: {
          endpoint: "https://api.openai.com/v1/chat/completions",
          api_key: "sk-inline-secret",
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          display_name: "Model A",
          model_creator: "openai"
        }
      },
      routes: {
        route_a: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "gpt-4o-mini",
          display_name: "Route A"
        }
      }
    });

    const stdoutAttempt = await runWithCapturedIo(["config", "export", "--include-secrets", "--config", configPath]);
    assert.equal(stdoutAttempt.result, 2);
    assert.equal(stdoutAttempt.stdout, "");
    assert.match(stdoutAttempt.stderr, /--include-secrets.*requires '--output <path>'/);

    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "export",
      "--include-secrets",
      "--output",
      outputPath,
      "--config",
      configPath
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.doesNotMatch(stdout, /sk-inline-secret/);
    assert.match(stdout, /secret-bearing inline api_key values included/);

    const exported = JSON.parse(readFileSync(outputPath, "utf8")) as {
      service_providers: Record<string, { api_key: string }>;
    };
    assert.equal(exported.service_providers["provider_a"]?.api_key, "sk-inline-secret");
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config export json emits config_export_error for read failures", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "config",
      "export",
      "--json",
      "--config",
      missingConfigPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, APP_ERROR_CODES.configExportError);
    assert.match(payload.error.message, /missing-config\.json/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
