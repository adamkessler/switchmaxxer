import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { run } from "../../index";
import { captureCliIo, parseCliEnvelope, test } from "./cli.test-support";
import { SWITCHMAXXER_SECRETS_PATH_ENV } from "../config/secrets-path";
import { splitExistingConfigFileForTests } from "../config/config-file.test-support";

void test("runCli config validate fails closed when inbound auth env var is configured but unset", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_TEST_INBOUND_KEY";
  const env: NodeJS.ProcessEnv = { ...process.env, SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key" };
  const originalValue = process.env[envVarName];

  try {
    delete env[envVarName];
    delete process.env[envVarName];
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
          inbound_api_key_env: envVarName,
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
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], {
        ...io,
        env
      })
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.match(stdout, /"code":"invalid_config"/);
    assert.match(stdout, new RegExp(`requires environment variable '${envVarName}'`));
  } finally {
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate rejects short inbound auth env vars", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_TEST_INBOUND_KEY";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [envVarName]: "short-token",
    SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key"
  };
  const originalValue = process.env[envVarName];

  try {
    process.env[envVarName] = "short-token";
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
          inbound_api_key_env: envVarName,
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
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], {
        ...io,
        env
      })
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.match(stdout, /"code":"invalid_config"/);
    assert.match(stdout, /at least 32 characters long/);
  } finally {
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate allows explicit unauthenticated gateway mode", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const env: NodeJS.ProcessEnv = { ...process.env, SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key" };
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];

  try {
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
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
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], {
        ...io,
        env
      })
    );

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /"ok":true/);
    assert.match(stdout, /"command":"config validate"/);
  } finally {
    if (typeof previousOpenAiKey === "string") {
      process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENAI_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate accepts provider auth supplied by secrets.json", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-secrets-validate-"));
  const configPath = path.join(tempDir, "config.json");
  const secretsPath = path.join(tempDir, "secrets.json");
  const providerEnvVar = "SWITCHMAXXER_TEST_PROVIDER_KEY_FROM_SECRETS";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [SWITCHMAXXER_SECRETS_PATH_ENV]: secretsPath
  };
  const previousProviderEnvValue = process.env[providerEnvVar];
  const previousSecretsPath = process.env[SWITCHMAXXER_SECRETS_PATH_ENV];

  try {
    delete process.env[providerEnvVar];
    delete env[providerEnvVar];
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
              endpoint: "https://api.openai.com/v1/chat/completions",
              api_key_env: providerEnvVar,
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
            [providerEnvVar]: "sk-provider-key-from-secrets"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(secretsPath, 0o600);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], {
        ...io,
        env
      })
    );

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /"ok":true/);
    assert.doesNotMatch(stdout, /sk-provider-key-from-secrets/);
    assert.doesNotMatch(stdout, new RegExp(`depends on missing environment variable '${providerEnvVar}'`));
  } finally {
    if (typeof previousProviderEnvValue === "string") {
      process.env[providerEnvVar] = previousProviderEnvValue;
    } else {
      delete process.env[providerEnvVar];
    }

    if (typeof previousSecretsPath === "string") {
      process.env[SWITCHMAXXER_SECRETS_PATH_ENV] = previousSecretsPath;
    } else {
      delete process.env[SWITCHMAXXER_SECRETS_PATH_ENV];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate json keeps config warning/detail error codes covered", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef",
    SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key"
  };

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
          inbound_api_key_env: "SWITCHMAXXER_INBOUND_API_KEY",
          service_providers: {
            provider_inline: {
              endpoint: "https://api.openai.com/v1/chat/completions",
              api_key: "sk-inline-secret",
              api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
              api_mode: "openai-completions"
            }
          },
          models: {
            model_inline: {
              display_name: "Inline Model",
              model_creator: "openai"
            }
          },
          routes: {
            route_inline: {
              model: "model_inline",
              service_provider: "provider_inline",
              provider_model_id: "gpt-4o-mini",
              display_name: "Inline Route"
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

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], {
        ...io,
        env
      })
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, APP_ERROR_CODES.invalidConfig);
    assert.equal(APP_ERROR_CODES.missingEnvVar, "missing_env_var");
    assert.equal(APP_ERROR_CODES.inlineApiKeyOverride, "inline_api_key_override");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate rejects explicit unauthenticated gateway mode on non-loopback bind hosts", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const env: NodeJS.ProcessEnv = { ...process.env, SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key" };

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
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
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(async (io) =>
      await run(["config", "validate", "--config", configPath], {
        ...io,
        env
      })
    );

    assert.equal(result, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /must not set 'allow_unauthenticated_gateway: true' unless 'bind_host' stays on a loopback address/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config validate rejects configs without any inbound auth mode", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
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
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const { result, stdout, stderr } = await captureCliIo(
      async (io) => await run(["config", "validate", "--config", configPath, "--json"], io)
    );

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.match(stdout, /"code":"invalid_config"/);
    assert.match(stdout, /must set either 'inbound_api_key_env' or 'allow_unauthenticated_gateway: true'/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
