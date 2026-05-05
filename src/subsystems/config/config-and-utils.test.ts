import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "./config";
import {
  assertJsonValueWithinBounds,
  HARD_MAX_JSON_NODE_COUNT,
  parseJsonWithinBounds,
  safeJsonStringifyWithinBounds
} from "../../platform/json-bounds";
import { createGatewayHttpRuntimeHelpers } from "../gateway/http-runtime-helpers";
import { getCallerDisplayLabel, type ProxyRequest } from "../proxy/proxy";
import { resolveBoundedConfigPath } from "./read-model";
import { parseRetentionDurationMs, retentionDurationToCutoffIso } from "../../platform/retention-duration";
import {
  resolveDefaultSecretsPath,
  resolveSecretsPath,
  SWITCHMAXXER_SECRETS_PATH_ENV
} from "./secrets-path";
import {
  assertValidSystemdUnitName,
  CONFIG_VALIDATION_ERROR_CODES,
  ConfigValidationError,
  getNullableStringField,
  isValidSystemdUnitName
} from "./config-validation";
import { writeSplitConfigForTests } from "./config-file.test-support";

function makeProxyRequestWithOptions(options: {
  headers?: Record<string, string>;
  remoteAddress?: string;
} = {}): ProxyRequest {
  return Object.assign(new EventEmitter(), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    socket: {
      remoteAddress: options.remoteAddress ?? "127.0.0.1"
    }
  });
}


void test("retention-duration helpers parse and normalize supported values", () => {
  assert.equal(parseRetentionDurationMs("15m"), 15 * 60_000);
  assert.equal(parseRetentionDurationMs(" 2H "), 2 * 60 * 60_000);
  assert.equal(parseRetentionDurationMs("3d"), 3 * 24 * 60 * 60_000);
  assert.equal(parseRetentionDurationMs("2w"), 2 * 7 * 24 * 60 * 60_000);
  assert.equal(parseRetentionDurationMs("520w"), 520 * 7 * 24 * 60 * 60_000);
  assert.equal(parseRetentionDurationMs("0h"), null);
  assert.equal(parseRetentionDurationMs("10x"), null);
  assert.equal(parseRetentionDurationMs("522w"), null);
  assert.equal(parseRetentionDurationMs("99999999999999999d"), null);
  assert.equal(
    retentionDurationToCutoffIso("2h", new Date("2026-04-19T20:00:00.000Z")),
    "2026-04-19T18:00:00.000Z"
  );
  assert.throws(
    () => retentionDurationToCutoffIso("522w", new Date("2026-04-19T20:00:00.000Z")),
    /up to 10 years/
  );
});

void test("json bounds helper rejects excessive depth and node counts independent of payload size", () => {
  const deepValue: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = deepValue;

  for (let index = 0; index < 260; index += 1) {
    const next: Record<string, unknown> = {};
    cursor["child"] = next;
    cursor = next;
  }

  assert.throws(
    () => assertJsonValueWithinBounds(deepValue, { maxDepth: 256, maxNodeCount: HARD_MAX_JSON_NODE_COUNT }),
    /json_structure_too_large/
  );

  const wideValue = Array.from({ length: 70_000 }, (_, index) => index);
  assert.throws(
    () => safeJsonStringifyWithinBounds(wideValue, { maxNodeCount: HARD_MAX_JSON_NODE_COUNT, maxDepth: 256 }),
    /json_structure_too_large/
  );

  let deepJson = "null";
  for (let index = 0; index < 257; index += 1) {
    deepJson = `{"child":${deepJson}}`;
  }
  assert.throws(
    () => parseJsonWithinBounds(deepJson, { maxNodeCount: HARD_MAX_JSON_NODE_COUNT, maxDepth: 256 }),
    /json_structure_too_large/
  );

  const stringHeavyJson = JSON.stringify({
    braces: "{".repeat(400) + "}".repeat(400),
    brackets: "[".repeat(400) + "]".repeat(400),
    escapedQuote: "\\\"".repeat(200)
  });
  assert.deepEqual(
    parseJsonWithinBounds(stringHeavyJson, { maxNodeCount: HARD_MAX_JSON_NODE_COUNT, maxDepth: 8 }),
    JSON.parse(stringHeavyJson)
  );
});

void test("json bounds helper still accepts large but legitimate payloads under the tightened default node cap", () => {
  const representativePayload = {
    items: Array.from({ length: 4_000 }, (_, index) => ({
      id: `item-${index}`,
      value: index
    }))
  };

  const serialized = safeJsonStringifyWithinBounds(representativePayload);
  const parsed = parseJsonWithinBounds(serialized);

  assert.deepEqual(parsed, representativePayload);
});

void test("config validation reports clear field paths for malformed observability settings", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-config-validation-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      observability: 1,
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";
    assert.throws(() => loadConfig(configPath), /config\.json field 'observability' must be an object when provided\./);

    writeSplitConfigForTests(configPath, {
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      observability: {
        retention: 1
      },
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    assert.throws(
      () => loadConfig(configPath),
      /config\.json field 'observability\.retention' must be an object when provided\./
    );
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config validation uses a typed error for invalid nullable string fields", () => {
  assert.throws(
    () => getNullableStringField({ api_key_env: 123 }, "api_key_env", "config.json"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.equal(error.code, CONFIG_VALIDATION_ERROR_CODES.invalidNullableStringField);
      assert.equal(error.message, "config.json field 'api_key_env' must be a non-empty string when provided.");
      assert.deepEqual(error.details, {
        fieldName: "api_key_env",
        sourceName: "config.json"
      });
      return true;
    }
  );
});

void test("config validation rejects provider api_key_env names outside the SWITCHMAXXER_ namespace", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-provider-env-name-validation-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";
    writeSplitConfigForTests(configPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key_env: "OPENAI_API_KEY"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    assert.throws(
      () => loadConfig(configPath),
      /field 'api_key_env' must reference a Switchmaxxer-managed environment variable name/
    );
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config validation rejects inbound_api_key_env names outside the SWITCHMAXXER_ namespace", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-inbound-env-name-validation-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      bind_host: "127.0.0.1",
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "PATH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    assert.throws(
      () => loadConfig(configPath),
      /field 'inbound_api_key_env' must reference a Switchmaxxer-managed environment variable name/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("bounded config path resolution keeps untrusted paths inside the allowed root", () => {
  const allowedRoot = path.join("/tmp", "switchmaxxer-config-root");

  assert.equal(
    resolveBoundedConfigPath("nested/config.json", allowedRoot),
    path.join(allowedRoot, "nested", "config.json")
  );
  assert.equal(resolveBoundedConfigPath(undefined, allowedRoot), path.join(allowedRoot, "config.json"));
  assert.throws(
    () => resolveBoundedConfigPath("../../../etc/passwd", allowedRoot),
    /escapes the allowed config root/
  );
  assert.throws(
    () => resolveBoundedConfigPath("/etc/passwd", allowedRoot),
    /escapes the allowed config root/
  );
});

void test("secrets path resolution defaults to the operator config directory", () => {
  assert.equal(
    resolveDefaultSecretsPath({
      env: {
        XDG_CONFIG_HOME: "/tmp/switchmaxxer-xdg-config",
        HOME: "/tmp/switchmaxxer-home"
      }
    }),
    path.join("/tmp/switchmaxxer-xdg-config", "switchmaxxer", "secrets.json")
  );

  assert.equal(
    resolveDefaultSecretsPath({
      env: {
        HOME: "/tmp/switchmaxxer-home"
      }
    }),
    path.join("/tmp/switchmaxxer-home", ".config", "switchmaxxer", "secrets.json")
  );

  assert.equal(
    resolveDefaultSecretsPath({
      cwd: "/tmp/switchmaxxer-cwd",
      env: {},
      homeDir: null
    }),
    path.join("/tmp/switchmaxxer-cwd", "secrets.json")
  );
});

void test("secrets path resolution honors explicit SWITCHMAXXER_SECRETS_PATH overrides", () => {
  assert.equal(
    resolveSecretsPath({
      cwd: "/tmp/switchmaxxer-cwd",
      env: {
        [SWITCHMAXXER_SECRETS_PATH_ENV]: "local/secrets.json",
        XDG_CONFIG_HOME: "/tmp/switchmaxxer-xdg-config"
      }
    }),
    path.join("/tmp/switchmaxxer-cwd", "local", "secrets.json")
  );

  assert.equal(
    resolveSecretsPath({
      cwd: "/tmp/switchmaxxer-cwd",
      env: {
        [SWITCHMAXXER_SECRETS_PATH_ENV]: "/var/lib/switchmaxxer/secrets.json"
      }
    }),
    "/var/lib/switchmaxxer/secrets.json"
  );
});

void test("secrets path resolution canonicalizes existing explicit path overrides", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-realpath-test-"));

  try {
    const realDir = path.join(tempDir, "real");
    const linkDir = path.join(tempDir, "link");
    mkdirSync(realDir);
    symlinkSync(realDir, linkDir);
    const secretsPath = path.join(realDir, "secrets.json");
    writeFileSync(secretsPath, "{}\n", "utf8");

    assert.equal(
      resolveSecretsPath({
        cwd: tempDir,
        env: {
          [SWITCHMAXXER_SECRETS_PATH_ENV]: "link/secrets.json"
        }
      }),
      secretsPath
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("secrets path resolution rejects explicit symlink path overrides before canonicalizing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-symlink-test-"));

  try {
    const realSecretsPath = path.join(tempDir, "real-secrets.json");
    const symlinkSecretsPath = path.join(tempDir, "operator-secrets.json");
    writeFileSync(realSecretsPath, "{}\n", "utf8");
    symlinkSync(realSecretsPath, symlinkSecretsPath);

    assert.throws(
      () =>
        resolveSecretsPath({
          cwd: tempDir,
          env: {
            [SWITCHMAXXER_SECRETS_PATH_ENV]: "operator-secrets.json"
          }
        }),
      /SWITCHMAXXER_SECRETS_PATH must not point to a symbolic link/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("caller display label is bounded and sanitized at acquisition time", () => {
  const longInjectedCaller = `${"proxy-test-client-".repeat(10)}tail\nINJECTED`;
  const request = makeProxyRequestWithOptions({
    headers: {
      "x-switchmaxxer-caller": longInjectedCaller
    }
  });

  const callerLabel = getCallerDisplayLabel(request);
  assert.equal(callerLabel.length, 128);
  assert.match(callerLabel, / \.\.\.\[truncated\]$/);
  assert.doesNotMatch(callerLabel, /[\r\n\t\x00-\x1f\x7f]/);
  assert.equal(
    getCallerDisplayLabel(makeProxyRequestWithOptions({ headers: {}, remoteAddress: "127.0.0.1" })),
    "127.0.0.1"
  );
});

void test("caller display label respects header priority before falling back to remote address", () => {
  assert.equal(
    getCallerDisplayLabel(
      makeProxyRequestWithOptions({
        headers: {
          "x-switchmaxxer-caller": "preferred-caller",
          "x-switchmaxxer-client": "secondary-client",
          "x-client-name": "tertiary-client"
        },
        remoteAddress: "127.0.0.1"
      })
    ),
    "preferred-caller"
  );

  assert.equal(
    getCallerDisplayLabel(
      makeProxyRequestWithOptions({
        headers: {
          "x-switchmaxxer-client": "secondary-client",
          "x-client-name": "tertiary-client"
        },
        remoteAddress: "127.0.0.1"
      })
    ),
    "secondary-client"
  );

  assert.equal(
    getCallerDisplayLabel(
      makeProxyRequestWithOptions({
        headers: {
          "x-client-name": "tertiary-client"
        },
        remoteAddress: "127.0.0.1"
      })
    ),
    "tertiary-client"
  );

  assert.equal(
    getCallerDisplayLabel(makeProxyRequestWithOptions({ headers: {}, remoteAddress: "127.0.0.1" })),
    "127.0.0.1"
  );
});

void test("systemd unit validation accepts expected unit names and rejects malformed values", () => {
  assert.equal(isValidSystemdUnitName("switchmaxxer.service"), true);
  assert.equal(isValidSystemdUnitName("switchmaxxer.timer"), true);

  assert.equal(isValidSystemdUnitName("switchmaxxer"), false);
  assert.equal(isValidSystemdUnitName("bad unit.service"), false);
  assert.equal(isValidSystemdUnitName("../../weird.service"), false);
  assert.equal(isValidSystemdUnitName("my-unit.service\u0000"), false);
  assert.equal(isValidSystemdUnitName("-switchmaxxer.service"), false);
  assert.equal(isValidSystemdUnitName("switchmaxxer\n.service"), false);
  assert.equal(isValidSystemdUnitName("switchmaxxer\r.service"), false);
  assert.equal(isValidSystemdUnitName("switchmaxxer-dev@blue.service"), false);
  assert.throws(
    () => assertValidSystemdUnitName("bad unit.service", "config.json"),
    /must contain a valid 'systemd_unit' value/
  );
});

void test("gateway systemd unit resolution validates SWITCHMAXXER_UNIT overrides", () => {
  const previousUnit = process.env["SWITCHMAXXER_UNIT"];
  const gatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: () => process.env,
    isNonEmptyCliString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isNonEmptyConfigString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isValidSystemdUnitName,
    defaultSystemdUnit: "switchmaxxer.service",
    maxRequestJsonDepth: 8
  });

  try {
    delete process.env["SWITCHMAXXER_UNIT"];
    assert.equal(
      gatewayHttpRuntimeHelpers.resolveConfiguredSystemdUnit({ systemdUnit: "switchmaxxer.service" }),
      "switchmaxxer.service"
    );

    process.env["SWITCHMAXXER_UNIT"] = "switchmaxxer-dev.service";
    assert.equal(
      gatewayHttpRuntimeHelpers.resolveConfiguredSystemdUnit({ systemdUnit: "switchmaxxer.service" }),
      "switchmaxxer-dev.service"
    );
    assert.equal(
      gatewayHttpRuntimeHelpers.resolveSystemdUnitFromDocument({ systemd_unit: "switchmaxxer.service" }),
      "switchmaxxer-dev.service"
    );

    process.env["SWITCHMAXXER_UNIT"] = "bad unit.service";
    assert.throws(
      () => gatewayHttpRuntimeHelpers.resolveConfiguredSystemdUnit({ systemdUnit: "switchmaxxer.service" }),
      /SWITCHMAXXER_UNIT/
    );
    assert.throws(
      () => gatewayHttpRuntimeHelpers.resolveSystemdUnitFromDocument({ systemd_unit: "switchmaxxer.service" }),
      /SWITCHMAXXER_UNIT/
    );

    delete process.env["SWITCHMAXXER_UNIT"];
    assert.equal(
      gatewayHttpRuntimeHelpers.resolveSystemdUnitFromDocument({ systemd_unit: "switchmaxxer.service" }),
      "switchmaxxer.service"
    );
    assert.throws(
      () => gatewayHttpRuntimeHelpers.resolveSystemdUnitFromDocument({ systemd_unit: "--all" }),
      /systemd_unit/
    );
  } finally {
    if (typeof previousUnit === "string") {
      process.env["SWITCHMAXXER_UNIT"] = previousUnit;
    } else {
      delete process.env["SWITCHMAXXER_UNIT"];
    }
  }
});

void test("config loading rejects malformed systemd_unit values", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-systemd-unit-config-validation-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "bad unit.service",
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";
    assert.throws(
      () => loadConfig(configPath),
      /must contain a valid 'systemd_unit' value like 'switchmaxxer\.service'/
    );
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});
