import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadConfiguredSecretsFile,
  loadOptionalConfiguredSecretsFile,
  loadSecretsFile
} from "./secrets";
import { SWITCHMAXXER_SECRETS_PATH_ENV } from "./secrets-path";

function writeSecureJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  chmodSync(filePath, 0o600);
}

void test("loadSecretsFile loads sparse api key overrides as redacting secret values", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-loader-"));
  const secretsPath = path.join(tempDir, "secrets.json");

  try {
    writeSecureJson(secretsPath, {
      api_key_overrides: {
        SWITCHMAXXER_OPENAI_API_KEY: "sk-openai-test-secret"
      }
    });

    const secrets = loadSecretsFile(secretsPath);

    assert.equal(secrets.sourceFile, "secrets.json");
    assert.equal(secrets.sourcePath, secretsPath);
    assert.ok(secrets.apiKeyOverrides["SWITCHMAXXER_OPENAI_API_KEY"]);
    assert.equal(JSON.stringify(secrets.apiKeyOverrides), "{\"SWITCHMAXXER_OPENAI_API_KEY\":\"***redacted***\"}");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadSecretsFile accepts an empty sparse secrets document", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-empty-"));
  const secretsPath = path.join(tempDir, "secrets.json");

  try {
    writeSecureJson(secretsPath, {});

    const secrets = loadSecretsFile(secretsPath);

    assert.deepEqual(Object.keys(secrets.apiKeyOverrides), []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("secrets.example.json stays compatible with the sparse secrets schema", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-example-"));
  const secretsPath = path.join(tempDir, "secrets.json");

  try {
    writeFileSync(secretsPath, readFileSync(path.join(process.cwd(), "config-examples", "secrets.example.json"), "utf8"), "utf8");
    chmodSync(secretsPath, 0o600);

    const secrets = loadSecretsFile(secretsPath);

    assert.ok(secrets.apiKeyOverrides["SWITCHMAXXER_OPENAI_API_KEY"]);
    assert.equal(JSON.stringify(secrets.apiKeyOverrides), "{\"SWITCHMAXXER_OPENAI_API_KEY\":\"***redacted***\"}");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfiguredSecretsFile uses explicit SWITCHMAXXER_SECRETS_PATH", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-explicit-"));
  const secretsPath = path.join(tempDir, "operator-secrets.json");

  try {
    writeSecureJson(secretsPath, {
      api_key_overrides: {
        SWITCHMAXXER_ANTHROPIC_API_KEY: "sk-ant-test-secret"
      }
    });

    const secrets = loadConfiguredSecretsFile({
      cwd: tempDir,
      env: {
        [SWITCHMAXXER_SECRETS_PATH_ENV]: "operator-secrets.json"
      }
    });

    assert.equal(secrets.sourcePath, secretsPath);
    assert.ok(secrets.apiKeyOverrides["SWITCHMAXXER_ANTHROPIC_API_KEY"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadOptionalConfiguredSecretsFile returns null when the default file is absent", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-optional-"));

  try {
    assert.equal(
      loadOptionalConfiguredSecretsFile({
        cwd: tempDir,
        env: {},
        homeDir: null
      }),
      null
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadOptionalConfiguredSecretsFile fails closed when an explicit secrets path is absent", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-explicit-missing-"));

  try {
    assert.throws(
      () =>
        loadOptionalConfiguredSecretsFile({
          cwd: tempDir,
          env: {
            [SWITCHMAXXER_SECRETS_PATH_ENV]: "missing-secrets.json"
          }
        }),
      /Unable to find missing-secrets\.json at/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadSecretsFile rejects unsupported secrets fields", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-unsupported-"));
  const secretsPath = path.join(tempDir, "secrets.json");

  try {
    writeSecureJson(secretsPath, {
      provider_keys: {}
    });

    assert.throws(() => loadSecretsFile(secretsPath), /secrets\.json contains unsupported field 'provider_keys'\./);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadSecretsFile rejects malformed api key overrides", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-malformed-"));
  const secretsPath = path.join(tempDir, "secrets.json");

  try {
    writeSecureJson(secretsPath, {
      api_key_overrides: []
    });

    assert.throws(
      () => loadSecretsFile(secretsPath),
      /secrets\.json field 'api_key_overrides' must be an object when provided\./
    );

    writeSecureJson(secretsPath, {
      api_key_overrides: {
        OPENAI_API_KEY: "sk-openai-test-secret"
      }
    });

    assert.throws(
      () => loadSecretsFile(secretsPath),
      /field 'api_key_overrides\.OPENAI_API_KEY' must reference a Switchmaxxer-managed environment variable name/
    );

    writeSecureJson(secretsPath, {
      api_key_overrides: {
        SWITCHMAXXER_OPENAI_API_KEY: " "
      }
    });

    assert.throws(
      () => loadSecretsFile(secretsPath),
      /secrets\.json field 'api_key_overrides\.SWITCHMAXXER_OPENAI_API_KEY' must be a non-empty string\./
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadSecretsFile rejects symlinked or group-readable secrets files", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-secrets-file-mode-"));
  const realSecretsPath = path.join(tempDir, "real-secrets.json");
  const symlinkSecretsPath = path.join(tempDir, "secrets.json");

  try {
    writeSecureJson(realSecretsPath, {});
    symlinkSync(realSecretsPath, symlinkSecretsPath);

    assert.throws(
      () => loadSecretsFile(symlinkSecretsPath),
      /secrets\.json at '.+' must not be a symbolic link\./
    );

    rmSync(symlinkSecretsPath, { force: true });
    writeSecureJson(symlinkSecretsPath, {});
    chmodSync(symlinkSecretsPath, 0o640);

    assert.throws(
      () => loadSecretsFile(symlinkSecretsPath),
      /secrets\.json at '.+' has insecure mode 0640/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
