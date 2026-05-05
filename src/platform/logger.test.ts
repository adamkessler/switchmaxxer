import assert from "node:assert/strict";
import test from "node:test";

import {
  logDebug,
  logError,
  logLine,
  logWarning,
  redactSensitiveText,
  sanitizeLogValue,
  setRuntimeLogLevelOverride,
  withLogWriters
} from "./logger";
import { REDACTED_SECRET } from "./secret-string";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

void test("logger redaction inventory masks supported secret shapes", () => {
  const cases = [
    {
      label: "bearer token",
      input: "Authorization: Bearer sk-secret-value"
    },
    {
      label: "basic auth header",
      input: "Authorization: Basic dXNlcjpzdXBlcnNlY3JldA=="
    },
    {
      label: "digest auth header",
      input: "Authorization: Digest username=\"alice\", realm=\"example\", nonce=\"abc123\", response=\"secret-digest\""
    },
    {
      label: "token auth header",
      input: "Authorization: Token token-value-123456"
    },
    {
      label: "apikey auth header",
      input: "Authorization: ApiKey api-key-value-123456"
    },
    {
      label: "jwt",
      input: "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturePart123456"
    },
    {
      label: "openai-style key",
      input: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456"
    },
    {
      label: "anthropic-style key",
      input: "api_key=ak-demo-secret-value"
    },
    {
      label: "slack token",
      input: "token=xoxb-123456789012-abcdefghijklmnop"
    },
    {
      label: "github token",
      input: "token=ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    },
    {
      label: "huggingface token",
      input: "token=hf_abcdefghijklmnopqrstuvwxyz123456"
    },
    {
      label: "xai token",
      input: "token=xai-abcdefghijklmnopqrstuvwxyz123456"
    },
    {
      label: "google api key",
      input: "key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p"
    },
    {
      label: "aws access key id",
      input: "key=AKIA1234567890ABCDEF"
    },
    {
      label: "generic env-style secret token",
      input: "OPENAI_API_KEY=abcdefghijklmnopqrstuvwxyz123456"
    },
    {
      label: "contextual long hex secret",
      input: "digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    {
      label: "query token",
      input: "https://example.test/v1/messages?api_key=secret-value-123&api-version=2024-01-01"
    },
    {
      label: "url credentials",
      input: "https://alice:supersecret@example.com/path"
    }
  ];

  for (const testCase of cases) {
    const redacted = redactSensitiveText(testCase.input);
    assert.notEqual(redacted, testCase.input, `expected redaction for ${testCase.label}`);
    assert.match(redacted, new RegExp(escapeRegExp(REDACTED_SECRET)), `expected marker for ${testCase.label}`);
    assert.doesNotMatch(
      redacted,
      new RegExp(escapeRegExp(testCase.input)),
      `expected source secret to be removed for ${testCase.label}`
    );
  }

  const bearer = redactSensitiveText("Authorization: Bearer sk-secret-value");
  assert.equal(bearer, `Authorization: Bearer ${REDACTED_SECRET}`);

  const basic = redactSensitiveText("Authorization: Basic dXNlcjpzdXBlcnNlY3JldA==");
  assert.equal(basic, `Authorization: Basic ${REDACTED_SECRET}`);

  const digest = redactSensitiveText(
    "Authorization: Digest username=\"alice\", realm=\"example\", nonce=\"abc123\", response=\"secret-digest\""
  );
  assert.equal(digest, `Authorization: Digest ${REDACTED_SECRET}`);

  const paddedDigest = redactSensitiveText(`Authorization: Digest ${" ".repeat(2000)}nonce="abc123"`);
  assert.match(paddedDigest, new RegExp(`^Authorization: Digest ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(paddedDigest, /nonce="abc123"$/);

  const urlCreds = redactSensitiveText("https://alice:supersecret@example.com/path");
  assert.equal(urlCreds, `https://${REDACTED_SECRET}:${REDACTED_SECRET}@example.com/path`);

  const queryCreds = redactSensitiveText("https://example.test/path?api_key=secret-value&api-version=2024-01-01");
  assert.equal(queryCreds, `https://example.test/path?api_key=${REDACTED_SECRET}&api-version=2024-01-01`);

  const envStyleSecret = redactSensitiveText("OPENAI_API_KEY=abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(envStyleSecret, `OPENAI_API_KEY=${REDACTED_SECRET}`);

  const colonSeparatedSecret = redactSensitiveText("provider_token: abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(colonSeparatedSecret, `provider_token: ${REDACTED_SECRET}`);
});

void test("logger redaction inventory does not clobber ordinary identifiers and diagnostics", () => {
  const safeCases = [
    "commit=0123456789abcdef0123456789abcdef01234567",
    "uuid=550e8400-e29b-41d4-a716-446655440000",
    "sha256_prefix=0123456789abcdef",
    "file_hash=abcdef1234567890fedcba0987654321",
    "route_id=ghp_docs_reference",
    "model=AKI route=ghp docs say API_KEY is optional for local testing",
    "request_id=req_0123456789abcdef",
    "path=/tmp/switchmaxxer/logs",
    "checksum=9f86d081884c7d659a2feaa0c55ad015",
    "etag=\"686897696a7c876b7e\"",
    "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "request=REQ_0123456789abcdef0123456789abcdef",
    "trace=TRACE-0123456789abcdef0123456789abcdef",
    "hash=HASH_abcdef1234567890fedcba0987654321",
    "prefixed_uuid=RUN_550e8400-e29b-41d4-a716-446655440000"
  ];

  for (const safeCase of safeCases) {
    assert.equal(redactSensitiveText(safeCase), safeCase, `expected no redaction for '${safeCase}'`);
  }
});

void test("logger redaction bounds work on oversized attacker-influenced strings", () => {
  const redacted = redactSensitiveText(`OPENAI_API_KEY=abcdefghijklmnopqrstuvwxyz123456 ${"x".repeat(9000)}`);

  assert.match(redacted, new RegExp(`^OPENAI_API_KEY=${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, / \.\.\.\[truncated\]$/);
  assert.ok(redacted.length < 8_300);
});

void test("sanitizeLogValue preserves a truncation marker when clipping output", () => {
  const sanitized = sanitizeLogValue(`alpha\n${"x".repeat(100)}`, 32);

  assert.match(sanitized, /^alpha /);
  assert.match(sanitized, / \.\.\.\[truncated\]$/);
  assert.equal(
    sanitized.length,
    32
  );
});

void test("logWarning preserves intentional multiline formatting", async () => {
  let stderr = "";

  await withLogWriters(
    {
      stderr: (message) => {
        stderr += message;
      }
    },
    async () => {
      logWarning("First line\n  - alpha\n  - beta");
    }
  );

  assert.match(stderr, /! WARNING\s+First line/);
  assert.match(stderr, /\n    - alpha\n    - beta\n$/);
});

void test("public log sinks redact secrets before writing", async () => {
  const secret = "sk-public-log-sink-secret-123456";
  let stdout = "";
  let stderr = "";

  try {
    setRuntimeLogLevelOverride("debug");

    await withLogWriters(
      {
        stdout: (message) => {
          stdout += message;
        },
        stderr: (message) => {
          stderr += message;
        }
      },
      async () => {
        logLine(`line Authorization: Bearer ${secret}`);
        logWarning(`warning https://example.test/path?api_key=${secret}\nAuthorization: Token ${secret}`);
        logError(`error https://alice:${secret}@example.test/path`);
        logDebug(`debug token=${secret}`);
      }
    );
  } finally {
    setRuntimeLogLevelOverride(null);
  }

  const combined = `${stdout}\n${stderr}`;
  assert.doesNotMatch(combined, new RegExp(escapeRegExp(secret)));
  assert.match(combined, new RegExp(escapeRegExp(REDACTED_SECRET)));
  assert.match(combined, new RegExp(`api_key=${escapeRegExp(REDACTED_SECRET)}`));
});
