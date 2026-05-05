import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CURRENT_CONFIG_VERSION, loadConfig } from "./config";
import { readConfigTextWithinLimit } from "./config-read";
import { DEFAULT_MCP_TOOL_CAPABILITIES } from "../../platform/mcp-capabilities";
import { withLogWriters } from "../../platform/logger";
import {
  loadCliReadModel,
  loadConfigDocumentForDisplay,
  loadRawConfigJsonDocument,
  sanitizeConfigDocumentForDisplay
} from "./read-model";
import { resolveRouteApiKey } from "./provider-auth";
import { SWITCHMAXXER_SECRETS_PATH_ENV } from "./secrets-path";
import {
  catalogPathForConfigForTests,
  writeSplitConfigForTests
} from "./config-file.test-support";

void test("loadConfig rejects unknown keys and reads benchmark defaults", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-unit-"));
  const badConfigPath = path.join(tempDir, "bad-config.json");
  const goodConfigPath = path.join(tempDir, "good-config.json");

  try {
    const baseCatalog = {
      service_providers: {
        provider_a: {
          endpoint: "https://api.example.com/v1",
          api_key: null,
          api_key_env: null,
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
    };

    writeSplitConfigForTests(badConfigPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      timeout_ms: 15000,
      stream_idle_timeout_ms: 120000,
      max_connections: 200,
      max_payload_siz: 4000000,
      ...baseCatalog
    });

    assert.throws(() => loadConfig(badConfigPath), /unsupported field 'max_payload_siz'/);

    writeSplitConfigForTests(goodConfigPath, {
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
      one_trusted_operator_boundary: true,
      service_providers: {
        provider_a: {
          endpoint: "https://api.example.com/v1",
          api_key: null,
          api_key_env: null,
          api_mode: "anthropic-messages"
        }
      },
      models: {
        model_a: {
          display_name: "Model A",
          model_creator: "example",
          cost: {
            input: 1,
            output: 2,
            cache_read: 3,
            cache_write: 4
          }
        }
      },
      routes: {
        route_a: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "provider-model-a",
          display_name: "Route A"
        }
      },
      benchmark: {
        default_max_tokens: 64,
        default_anthropic_version: "2023-06-01"
      }
    });

    const config = loadConfig(goodConfigPath);
    assert.equal(config.benchmark.defaultMaxTokens, 64);
    assert.equal(config.benchmark.defaultAnthropicVersion, "2023-06-01");
    assert.equal(config.oneTrustedOperatorBoundary, true);
    assert.equal(config.routes["route_a"]?.timeoutMs, 15000);
    assert.equal(config.streamMaxLifetimeMs, 600000);
    assert.equal(config.streamMaxEventBytes, 1048576);
    assert.equal(config.streamMaxTotalBytes, 67108864);
    assert.equal(config.streamMinBytesPerSecond, 16);
    assert.equal(config.streamRateWindowMs, 30000);
    assert.equal((config.routes["route_a"] as unknown as Record<string, unknown>)["apiKey"], undefined);
    assert.equal(config.routes["route_a"]?.inlineApiKey, null);
    assert.equal(config.routes["route_a"]?.apiKeyEnv, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig composes provider, route, and model sections from sibling catalog.json", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-catalog-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          config_version: CURRENT_CONFIG_VERSION,
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
          allow_unauthenticated_gateway: true
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      catalogPath,
      JSON.stringify(
        {
          catalog_version: 1,
          service_providers: {
            provider_a: {
              endpoint: "https://api.example.com/v1",
              api_key: null,
              api_key_env: null,
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
    chmodSync(catalogPath, 0o600);

    const config = loadConfig(configPath);
    assert.equal(config.routes["route_a"]?.baseUrl, "https://api.example.com/v1");
    assert.equal(config.routes["route_a"]?.modelCreator, "example");
    assert.equal(config.routes["route_a"]?.model, "provider-model-a");

    const readModel = loadCliReadModel(configPath);
    assert.equal(readModel.routesByName["route_a"]?.display_name, "Route A");
    assert.equal(readModel.modelsByName["model_a"]?.route_count, 1);

    const display = loadConfigDocumentForDisplay(configPath);
    assert.equal(typeof display.document["service_providers"], "object");
    assert.equal(typeof display.document["routes"], "object");
    assert.equal(typeof display.document["models"], "object");

    const rawConfig = loadRawConfigJsonDocument(configPath);
    assert.equal(typeof rawConfig.document["service_providers"], "undefined");
    assert.equal(typeof rawConfig.document["routes"], "undefined");
    assert.equal(typeof rawConfig.document["models"], "undefined");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects catalog sections in config.json even when catalog.json exists", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-catalog-duplicate-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
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
          allow_unauthenticated_gateway: true,
          service_providers: {}
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      catalogPath,
      JSON.stringify(
        {
          catalog_version: 1,
          service_providers: {},
          models: {},
          routes: {}
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    chmodSync(catalogPath, 0o600);

    assert.throws(
      () => loadConfig(configPath),
      /config\.json must not define 'service_providers'/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects catalog sections in config.json even when catalog.json is missing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-catalog-forbidden-without-catalog-"));

  try {
    for (const key of ["service_providers", "routes", "models"] as const) {
      const configPath = path.join(tempDir, `${key}.json`);
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
            allow_unauthenticated_gateway: true,
            [key]: {}
          },
          null,
          2
        ),
        "utf8"
      );
      chmodSync(configPath, 0o600);

      const expected = new RegExp(`${key}\\.json must not define '${key}'`);
      assert.throws(() => loadConfig(configPath), expected);
      assert.throws(() => loadCliReadModel(configPath), expected);
      assert.throws(() => loadConfigDocumentForDisplay(configPath), expected);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig requires complete and securely readable catalog.json", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-catalog-hardening-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
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
          allow_unauthenticated_gateway: true
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      catalogPath,
      JSON.stringify(
        {
          catalog_version: 1,
          service_providers: {},
          routes: {}
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    chmodSync(catalogPath, 0o600);

    assert.throws(
      () => loadConfig(configPath),
      /catalog\.json must contain a 'models' object/
    );

    chmodSync(catalogPath, 0o640);
    assert.throws(() => loadConfig(configPath), /catalog\.json.*insecure mode 0640/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig migrates omitted MCP capabilities to read-only with a warning and validates explicit MCP capability policy", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-mcp-capabilities-"));
  const defaultConfigPath = path.join(tempDir, "default-config.json");
  const omittedCapabilitiesConfigPath = path.join(tempDir, "omitted-capabilities-config.json");
  const restrictedConfigPath = path.join(tempDir, "restricted-config.json");
  const invalidConfigPath = path.join(tempDir, "invalid-config.json");
  let loggedStderr = "";

  try {
    const baseDocument = {
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
          endpoint: "https://api.example.com/v1",
          api_key: null,
          api_key_env: null,
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
    };

    writeSplitConfigForTests(defaultConfigPath, baseDocument);
    writeSplitConfigForTests(omittedCapabilitiesConfigPath, { ...baseDocument, mcp: {} });
    writeSplitConfigForTests(restrictedConfigPath, {
      ...baseDocument,
      mcp: { capabilities: ["read", "mutation", "read"] }
    });
    writeSplitConfigForTests(invalidConfigPath, {
      ...baseDocument,
      mcp: { capabilities: ["read", "dangerous"] }
    });

    const defaultConfig = await withLogWriters(
      {
        stderr: (message) => {
          loggedStderr += message;
        }
      },
      async () => loadConfig(defaultConfigPath)
    );
    const omittedCapabilitiesConfig = await withLogWriters(
      {
        stderr: (message) => {
          loggedStderr += message;
        }
      },
      async () => loadConfig(omittedCapabilitiesConfigPath)
    );
    const restrictedConfig = loadConfig(restrictedConfigPath);

    assert.deepEqual(defaultConfig.mcp?.capabilities, [...DEFAULT_MCP_TOOL_CAPABILITIES]);
    assert.deepEqual(omittedCapabilitiesConfig.mcp?.capabilities, [...DEFAULT_MCP_TOOL_CAPABILITIES]);
    assert.match(loggedStderr, /default-config\.json omits 'mcp'; defaulting MCP sessions to read-only access/);
    assert.match(
      loggedStderr,
      /omitted-capabilities-config\.json omits 'mcp\.capabilities'; defaulting MCP sessions to read-only access/
    );
    assert.deepEqual(restrictedConfig.mcp?.capabilities, ["read", "mutation"]);
    assert.throws(
      () => loadConfig(invalidConfigPath),
      /field 'mcp\.capabilities' may only contain: read, mutation, privileged\./
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects provider api keys with invalid HTTP header characters", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-invalid-provider-key-"));
  const inlineConfigPath = path.join(tempDir, "inline.json");
  const envConfigPath = path.join(tempDir, "env.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY_INVALID_HEADER";
  const originalValue = process.env[envVarName];

  try {
    process.env[envVarName] = "abc\r\nX-Admin: 1";

    writeSplitConfigForTests(inlineConfigPath, {
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
          endpoint: "https://api.example.com/v1",
          api_key: "abc\r\nX-Admin: 1",
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
    });

    assert.throws(
      () => loadConfig(inlineConfigPath),
      /Service provider 'provider_a' field 'api_key' contains invalid HTTP header characters\./
    );

    writeSplitConfigForTests(envConfigPath, {
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
          endpoint: "https://api.example.com/v1",
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
    });

    assert.throws(
      () => loadConfig(envConfigPath),
      new RegExp(`requires environment variable '${envVarName}', but it contains invalid HTTP header characters`)
    );
  } finally {
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig uses secrets.json api_key_overrides before provider auth env vars", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-secrets-provider-key-"));
  const configPath = path.join(tempDir, "config.json");
  const secretsPath = path.join(tempDir, "secrets.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY_FROM_SECRETS";
  const originalEnvValue = process.env[envVarName];
  const originalSecretsPath = process.env[SWITCHMAXXER_SECRETS_PATH_ENV];

  try {
    delete process.env[envVarName];
    process.env[SWITCHMAXXER_SECRETS_PATH_ENV] = secretsPath;

    writeSplitConfigForTests(configPath, {
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
          endpoint: "https://api.example.com/v1",
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
    });

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

    const config = loadConfig(configPath);
    const route = config.routes["route_a"];

    assert.ok(route);
    assert.equal(resolveRouteApiKey(route), "sk-provider-key-from-secrets");

    writeFileSync(
      secretsPath,
      JSON.stringify(
        {
          api_key_overrides: {
            [envVarName]: "abc\r\nX-Admin: 1"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(secretsPath, 0o600);

    assert.throws(
      () => loadConfig(configPath),
      new RegExp(`requires secrets override for environment variable '${envVarName}', but it contains invalid HTTP header characters`)
    );
  } finally {
    if (typeof originalEnvValue === "string") {
      process.env[envVarName] = originalEnvValue;
    } else {
      delete process.env[envVarName];
    }

    if (typeof originalSecretsPath === "string") {
      process.env[SWITCHMAXXER_SECRETS_PATH_ENV] = originalSecretsPath;
    } else {
      delete process.env[SWITCHMAXXER_SECRETS_PATH_ENV];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects reserved provider names like __proto__, constructor, and prototype", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-reserved-provider-name-"));

  try {
    for (const reservedKey of ["__proto__", "constructor", "prototype", "__defineGetter__", "hasOwnProperty"]) {
      const configPath = path.join(tempDir, `${reservedKey}.json`);
      const catalogPath = catalogPathForConfigForTests(configPath);
      writeFileSync(
        configPath,
        `{
  "config_version": 1,
  "bind_host": "127.0.0.1",
  "port": 4080,
  "timeout_ms": 15000,
  "stream_idle_timeout_ms": 120000,
  "max_connections": 200,
  "max_payload_size": 4000000,
  "rate_limit": { "requests": 50, "window": "1s" },
  "allow_unauthenticated_gateway": true
}
`,
        "utf8"
      );
      writeFileSync(
        catalogPath,
        `{
  "catalog_version": 1,
  "service_providers": {
    "${reservedKey}": {
      "endpoint": "https://api.example.com/v1/chat/completions",
      "api_key": null,
      "api_key_env": null,
      "api_mode": "openai-completions"
    }
  },
  "models": {
    "model_a": {
      "display_name": "Model A",
      "model_creator": "example"
    }
  },
  "routes": {
    "route_a": {
      "model": "model_a",
      "service_provider": "${reservedKey}",
      "provider_model_id": "provider-model-a",
      "display_name": "Route A"
    }
  }
}
`,
        "utf8"
      );
      chmodSync(configPath, 0o600);
      chmodSync(catalogPath, 0o600);

      assert.throws(() => loadConfig(configPath), new RegExp(`Provider name '${reservedKey}' is reserved and cannot be used\\.`));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig does not pollute Object.prototype when config input contains __proto__ provider keys", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-proto-pollution-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    delete (Object.prototype as Record<string, unknown>)["polluted"];

    writeFileSync(
      configPath,
      `{
  "config_version": 1,
  "bind_host": "127.0.0.1",
  "port": 4080,
  "timeout_ms": 15000,
  "stream_idle_timeout_ms": 120000,
  "max_connections": 200,
  "max_payload_size": 4000000,
  "rate_limit": { "requests": 50, "window": "1s" },
  "allow_unauthenticated_gateway": true
}
`,
      "utf8"
    );
    writeFileSync(
      catalogPathForConfigForTests(configPath),
      `{
  "catalog_version": 1,
  "service_providers": {
    "__proto__": {
      "polluted": "yes",
      "endpoint": "https://api.example.com/v1/chat/completions",
      "api_key": null,
      "api_key_env": null,
      "api_mode": "openai-completions"
    }
  },
  "models": {
    "model_a": {
      "display_name": "Model A",
      "model_creator": "example"
    }
  },
  "routes": {
    "route_a": {
      "model": "model_a",
      "service_provider": "__proto__",
      "provider_model_id": "provider-model-a",
      "display_name": "Route A"
    }
  }
}
`,
      "utf8"
    );
    chmodSync(configPath, 0o600);
    chmodSync(catalogPathForConfigForTests(configPath), 0o600);

    assert.throws(() => loadConfig(configPath), /Provider name '__proto__' is reserved and cannot be used\./);
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
    assert.equal((Object.prototype as Record<string, unknown>)["polluted"], undefined);
  } finally {
    delete (Object.prototype as Record<string, unknown>)["polluted"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders migrate legacy unversioned config files and reject unsupported config versions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-version-"));
  const legacyConfigPath = path.join(tempDir, "legacy-config.json");
  const futureConfigPath = path.join(tempDir, "future-config.json");

  const baseConfig = {
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
        endpoint: "https://api.example.com/v1",
        api_key: null,
        api_key_env: null,
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
  };

  try {
    writeSplitConfigForTests(legacyConfigPath, baseConfig);
    writeSplitConfigForTests(futureConfigPath, {
      ...baseConfig,
      config_version: CURRENT_CONFIG_VERSION + 1
    });

    const config = loadConfig(legacyConfigPath);
    assert.equal(config.port, 4080);

    const display = loadConfigDocumentForDisplay(legacyConfigPath);
    assert.equal(display.document["config_version"], CURRENT_CONFIG_VERSION);

    assert.throws(
      () => loadConfig(futureConfigPath),
      new RegExp(`unsupported future config_version ${CURRENT_CONFIG_VERSION + 1}`)
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders accept canonical snake_case top-level runtime fields", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-runtime-aliases-"));
  const configPath = path.join(tempDir, "config.json");

  const aliasedConfig = {
    config_version: 1,
    bind_host: "127.0.0.1",
    port: 4080,
    timeout_ms: 15000,
    stream_idle_timeout_ms: 120000,
    stream_max_lifetime_ms: 600000,
    stream_min_bytes_per_second: 16,
    stream_rate_window_ms: 30000,
    stream_max_event_bytes: 1048576,
    stream_max_total_bytes: 67108864,
    max_connections: 200,
    max_concurrent_streams_per_ip: 8,
    max_concurrent_json_parses: 4,
    max_buffered_upstream_response_bytes: 16777216,
    shutdown_timeout_ms: 30000,
    log_level: "info",
    max_payload_size: 4000000,
    rate_limit: {
      requests: 50,
      window: "1s"
    },
    allow_unauthenticated_gateway: true,
    systemd_unit: "switchmaxxer.service",
    service_providers: {
      provider_a: {
        endpoint: "https://api.example.com/v1",
        api_key: null,
        api_key_env: null,
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
  };

  try {
    writeSplitConfigForTests(configPath, aliasedConfig);

    const config = loadConfig(configPath);
    assert.equal(config.bindHost, "127.0.0.1");
    assert.equal(config.timeoutMs, 15000);
    assert.equal(config.streamIdleTimeoutMs, 120000);
    assert.equal(config.streamMaxLifetimeMs, 600000);
    assert.equal(config.streamMinBytesPerSecond, 16);
    assert.equal(config.streamRateWindowMs, 30000);
    assert.equal(config.streamMaxEventBytes, 1048576);
    assert.equal(config.streamMaxTotalBytes, 67108864);
    assert.equal(config.maxConnections, 200);
    assert.equal(config.maxConcurrentStreamsPerIp, 8);
    assert.equal(config.maxConcurrentJsonParses, 4);
    assert.equal(config.maxBufferedUpstreamResponseBytes, 16777216);
    assert.equal(config.shutdownTimeoutMs, 30000);
    assert.equal(config.logLevel, "info");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject legacy camelCase top-level runtime fields", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-legacy-warning-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      config_version: CURRENT_CONFIG_VERSION,
      bindHost: "127.0.0.1",
      port: 4080,
      logLevel: "info",
      maxConnections: 200,
      timeoutMs: 15_000,
      streamIdleTimeoutMs: 120_000,
      rate_limit: {
        requests: 50,
        window: "1s"
      },
      inbound_api_key_env: "SWITCHMAXXER_INBOUND_API_KEY",
      service_providers: {
        openai_direct: {
          endpoint: "https://api.openai.com/v1/chat/completions",
          api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
          api_mode: "openai-completions"
        }
      },
      models: {
        "gpt-4o-mini": {
          model_creator: "openai",
          display_name: "GPT-4o Mini"
        }
      },
      routes: {
        "gpt-4o-mini": {
          model: "gpt-4o-mini",
          provider_model_id: "gpt-4o-mini",
          service_provider: "openai_direct",
          display_name: "GPT-4o Mini"
        }
      }
    });

    assert.throws(() => loadConfig(configPath), /contains unsupported field 'bindHost'/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig collapses private-endpoint warnings into one summary line", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-private-endpoint-warning-"));
  const configPath = path.join(tempDir, "config.json");
  let loggedStderr = "";

  try {
    writeSplitConfigForTests(configPath, {
      config_version: CURRENT_CONFIG_VERSION,
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
          endpoint: "http://localhost:11434/v1/chat/completions",
          allow_private_endpoints: true,
          allow_insecure_http: true,
          api_key: null,
          api_key_env: null,
          api_mode: "openai-completions"
        },
        provider_b: {
          endpoint: "http://127.0.0.1:8080/v1/chat/completions",
          allow_private_endpoints: true,
          allow_insecure_http: true,
          api_key: null,
          api_key_env: null,
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          model_creator: "local",
          display_name: "Model A"
        }
      },
      routes: {
        route_a: {
          model: "model_a",
          provider_model_id: "model-a",
          service_provider: "provider_a",
          display_name: "Route A"
        }
      }
    });

    await withLogWriters(
      {
        stderr: (message) => {
          loggedStderr += message;
        }
      },
      async () => {
        loadConfig(configPath);
      }
    );

    assert.match(loggedStderr, /The following service providers enable 'allow_private_endpoints'\./);
    assert.match(loggedStderr, /This permits private-address routing/);
    assert.match(loggedStderr, /DNS hostnames still use pinned-resolution dispatch/);
    assert.match(loggedStderr, /\n    - provider_a\n    - provider_b/);
    assert.equal(loggedStderr.match(/allow_private_endpoints/g)?.length ?? 0, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject configs that specify both legacy camelCase and canonical snake_case runtime fields", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-runtime-alias-conflict-"));
  const configPath = path.join(tempDir, "config.json");

  const conflictingConfig = {
    config_version: 1,
    bindHost: "127.0.0.1",
    bind_host: "0.0.0.0",
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
        endpoint: "https://api.example.com/v1",
        api_key: null,
        api_key_env: null,
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
  };

  try {
    writeSplitConfigForTests(configPath, conflictingConfig);

    assert.throws(() => loadConfig(configPath), /contains unsupported field 'bindHost'/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject oversized config files before parsing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-size-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(configPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
    chmodSync(configPath, 0o600);

    assert.throws(
      () => loadConfig(configPath),
      /exceeds the maximum supported size of 8 MB/
    );
    assert.throws(
      () => loadConfigDocumentForDisplay(configPath),
      /exceeds the maximum supported size of 8 MB/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("main config loaders reject structurally oversized JSON before normal validation", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-structure-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    let deepJson = "null";
    for (let index = 0; index < 257; index += 1) {
      deepJson = `{\"child\":${deepJson}}`;
    }

    writeFileSync(configPath, deepJson, "utf8");
    chmodSync(configPath, 0o600);

    assert.throws(() => loadConfig(configPath), /json_structure_too_large/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject malformed JSON inputs before validation", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-malformed-"));
  const trailingCommaPath = path.join(tempDir, "trailing-comma.json");
  const truncatedPath = path.join(tempDir, "truncated.json");
  const bomPath = path.join(tempDir, "bom.json");

  try {
    writeFileSync(trailingCommaPath, `{"bind_host":"127.0.0.1",}\n`, "utf8");
    writeFileSync(truncatedPath, `{"bind_host":"127.0.0.1"`, "utf8");
    writeFileSync(bomPath, `\ufeff{"bind_host":"127.0.0.1"}\n`, "utf8");
    chmodSync(trailingCommaPath, 0o600);
    chmodSync(truncatedPath, 0o600);
    chmodSync(bomPath, 0o600);

    assert.throws(() => loadConfig(trailingCommaPath), /is not valid JSON/);
    assert.throws(() => loadConfigDocumentForDisplay(trailingCommaPath), /is not valid JSON/);

    assert.throws(() => loadConfig(truncatedPath), /is not valid JSON/);
    assert.throws(() => loadConfigDocumentForDisplay(truncatedPath), /is not valid JSON/);

    assert.throws(() => loadConfig(bomPath), /is not valid JSON/);
    assert.throws(() => loadConfigDocumentForDisplay(bomPath), /is not valid JSON/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject deeply nested JSON even when it stays under the 8 MB file limit", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-deep-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    let deepJson = "null";
    for (let index = 0; index < 10_000; index += 1) {
      deepJson = `{\"child\":${deepJson}}`;
    }

    writeFileSync(configPath, deepJson, "utf8");
    chmodSync(configPath, 0o600);

    assert.ok(readFileSync(configPath, "utf8").length < 8 * 1024 * 1024);
    assert.throws(() => loadConfig(configPath), /json_structure_too_large/);
    assert.throws(() => loadConfigDocumentForDisplay(configPath), /json_structure_too_large/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects explicit unauthenticated gateway mode on non-loopback bind hosts", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-nonloopback-unauth-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      bind_host: "0.0.0.0",
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
          endpoint: "https://api.example.com/v1",
          api_key: null,
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
          provider_model_id: "provider-model-a",
          display_name: "Route A"
        }
      }
    });

    assert.throws(
      () => loadConfig(configPath),
      /must not set 'allow_unauthenticated_gateway: true' unless 'bind_host' stays on a loopback address/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig requires explicit remote-bind opt-in for authenticated non-loopback bind hosts", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-remote-bind-auth-test-"));
  const rejectedConfigPath = path.join(tempDir, "rejected.json");
  const acceptedConfigPath = path.join(tempDir, "accepted.json");
  const wildcardMissingOptInConfigPath = path.join(tempDir, "wildcard-missing-opt-in.json");
  const wildcardAcceptedConfigPath = path.join(tempDir, "wildcard-accepted.json");
  const invalidWildcardOptInConfigPath = path.join(tempDir, "invalid-wildcard-opt-in.json");
  const invalidOptInConfigPath = path.join(tempDir, "invalid-opt-in.json");
  const envVarName = "SWITCHMAXXER_TEST_REMOTE_BIND_INBOUND_KEY";
  const previousInboundToken = process.env[envVarName];
  const remoteBindConfig = {
    bind_host: "192.0.2.10",
    port: 4080,
    timeout_ms: 15000,
    stream_idle_timeout_ms: 120000,
    max_connections: 200,
    max_payload_size: 4000000,
    rate_limit: {
      requests: 50,
      window: "1s"
    },
    inbound_api_key_env: envVarName,
    service_providers: {
      provider_a: {
        endpoint: "https://api.example.com/v1",
        api_key: null,
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
        provider_model_id: "provider-model-a",
        display_name: "Route A"
      }
    }
  };

  try {
    process.env[envVarName] = "0123456789abcdef0123456789abcdef";

    writeSplitConfigForTests(rejectedConfigPath, remoteBindConfig);
    assert.throws(
      () => loadConfig(rejectedConfigPath),
      /must not set non-loopback 'bind_host' unless 'allow_remote_bind: true' is explicitly configured with 'inbound_api_key_env'/
    );

    writeSplitConfigForTests(acceptedConfigPath, {
      ...remoteBindConfig,
      allow_remote_bind: true
    });
    const acceptedConfig = loadConfig(acceptedConfigPath);
    assert.equal(acceptedConfig.bindHost, "192.0.2.10");
    assert.equal(acceptedConfig.inboundApiKeyEnv, envVarName);
    assert.equal(acceptedConfig.allowRemoteBind, true);
    assert.equal(acceptedConfig.allowWildcardBind, false);

    writeSplitConfigForTests(wildcardMissingOptInConfigPath, {
      ...remoteBindConfig,
      bind_host: "0.0.0.0",
      allow_remote_bind: true
    });
    assert.throws(
      () => loadConfig(wildcardMissingOptInConfigPath),
      /must not set wildcard 'bind_host' unless 'allow_remote_bind: true' and 'allow_wildcard_bind: true'/
    );

    writeSplitConfigForTests(wildcardAcceptedConfigPath, {
      ...remoteBindConfig,
      bind_host: "0.0.0.0",
      allow_remote_bind: true,
      allow_wildcard_bind: true
    });
    const wildcardAcceptedConfig = loadConfig(wildcardAcceptedConfigPath);
    assert.equal(wildcardAcceptedConfig.bindHost, "0.0.0.0");
    assert.equal(wildcardAcceptedConfig.inboundApiKeyEnv, envVarName);
    assert.equal(wildcardAcceptedConfig.allowRemoteBind, true);
    assert.equal(wildcardAcceptedConfig.allowWildcardBind, true);

    writeSplitConfigForTests(invalidWildcardOptInConfigPath, {
      ...remoteBindConfig,
      allow_remote_bind: true,
      allow_wildcard_bind: true
    });
    assert.throws(
      () => loadConfig(invalidWildcardOptInConfigPath),
      /field 'allow_wildcard_bind' only applies when 'bind_host' is '0\.0\.0\.0' or '::'/
    );

    writeSplitConfigForTests(invalidOptInConfigPath, {
      ...remoteBindConfig,
      bind_host: "127.0.0.1",
      inbound_api_key_env: null,
      allow_unauthenticated_gateway: true,
      allow_remote_bind: true
    });
    assert.throws(
      () => loadConfig(invalidOptInConfigPath),
      /field 'allow_remote_bind' requires 'inbound_api_key_env'/
    );
  } finally {
    if (typeof previousInboundToken === "string") {
      process.env[envVarName] = previousInboundToken;
    } else {
      delete process.env[envVarName];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("shared config reader rejects symlinked config paths instead of following them", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-read-symlink-"));
  const targetPath = path.join(tempDir, "target.json");
  const symlinkPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(targetPath, `{"bind_host":"127.0.0.1"}\n`, "utf8");
    symlinkSync(targetPath, symlinkPath);

    assert.throws(
      () =>
        readConfigTextWithinLimit(symlinkPath, {
          logicalName: "config.json"
        }),
      /must not be a symbolic link/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("shared config reader rejects group- or world-accessible config file permissions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-read-mode-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    for (const mode of [0o640, 0o644, 0o660]) {
      writeFileSync(configPath, `{"bind_host":"127.0.0.1"}\n`, "utf8");
      chmodSync(configPath, mode);

      assert.throws(
        () =>
          readConfigTextWithinLimit(configPath, {
            logicalName: "config.json"
          }),
        new RegExp(
          `config\\.json at '${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}' has insecure mode 0${mode.toString(8)}; ` +
          "it must not be group- or world-accessible\\. " +
          `Run: chmod 0600 ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
        )
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject symlinked config files before parsing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-loader-symlink-"));
  const targetPath = path.join(tempDir, "real-config.json");
  const symlinkPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(targetPath, readFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), "utf8"), "utf8");
    symlinkSync(targetPath, symlinkPath);

    assert.throws(() => loadConfig(symlinkPath), /must not be a symbolic link/);
    assert.throws(() => loadConfigDocumentForDisplay(symlinkPath), /must not be a symbolic link/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject group- or world-accessible config file permissions before parsing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-loader-mode-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    for (const mode of [0o640, 0o644]) {
      writeFileSync(configPath, readFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), "utf8"), "utf8");
      chmodSync(configPath, mode);

      const expectedMode = `0${mode.toString(8)}`;
      assert.throws(
        () => loadConfig(configPath),
        new RegExp(`has insecure mode ${expectedMode};.*Run: chmod 0600 .+config\\.json`)
      );
      assert.throws(
        () => loadConfigDocumentForDisplay(configPath),
        new RegExp(`has insecure mode ${expectedMode};.*Run: chmod 0600 .+config\\.json`)
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config loaders reject group-readable configs that contain inline api_key secrets before parsing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-inline-secret-mode-"));
  const configPath = path.join(tempDir, "config.json");

  try {
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
              endpoint: "https://api.example.com/v1",
              api_key: "sk-test-inline-secret",
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
              provider_model_id: "provider-model-a",
              display_name: "Route A"
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(configPath, 0o640);

    assert.throws(
      () => loadConfig(configPath),
      /has insecure mode 0640;.*Run: chmod 0600 .+config\.json/
    );
    assert.throws(
      () => loadConfigDocumentForDisplay(configPath),
      /has insecure mode 0640;.*Run: chmod 0600 .+config\.json/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("read model sanitization masks inline api keys and computes effective cost fallbacks", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-read-model-unit-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
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
          endpoint: "https://api.example.com/v1",
          api_key: "sk-inline-secret",
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          display_name: "Model A",
          model_creator: "example",
          cost: {
            input: 1,
            output: 2,
            cache_read: 3,
            cache_write: 4
          }
        }
      },
      routes: {
        route_inherit: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "provider-model-a",
          display_name: "Route Inherit"
        },
        route_override: {
          model: "model_a",
          service_provider: "provider_a",
          provider_model_id: "provider-model-b",
          display_name: "Route Override",
          cost: {
            input: 10,
            output: 20,
            cache_read: 30,
            cache_write: 40
          }
        }
      }
    });

    const redacted = sanitizeConfigDocumentForDisplay({
      service_providers: {
        provider_a: {
          api_key: "sk-inline-secret"
        }
      }
    });
    const redactedProviders = redacted["service_providers"] as Record<string, { api_key: string }>;
    assert.equal(redactedProviders["provider_a"]?.["api_key"], "***masked***");

    const readModel = loadCliReadModel(configPath);
    assert.deepEqual(readModel.routesByName["route_inherit"]?.effective_cost, {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4
    });
    assert.deepEqual(readModel.routesByName["route_override"]?.effective_cost, {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40
    });
    assert.equal(readModel.providersByName["provider_a"]?.auth_source, "inline override");
    assert.equal(readModel.providersByName["provider_a"]?.api_key_masked, "***masked***");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadCliReadModel rejects typoed config fields instead of silently coercing them away", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-read-model-strict-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
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
          endpoint: "https://api.example.com/v1",
          api_key: "sk-inline-secret",
          api_mode: "openai-completions"
        }
      },
      models: {
        model_a: {
          display_nam: "Model A",
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
    });

    assert.throws(
      () => loadCliReadModel(configPath),
      /Model 'model_a' contains unsupported field 'display_nam'/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
