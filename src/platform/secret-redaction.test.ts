import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  logDebug,
  logLine,
  logStartup,
  redactSensitiveText,
  resetProcessLogLevel,
  safeErrorMessage,
  setProcessLogLevel,
  withLogWriters
} from "./logger";
import { getPackageVersion } from "./package-version";
import { REDACTED_SECRET, SecretString } from "./secret-string";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

void test("safeErrorMessage sanitizes control characters before log interpolation", () => {
  assert.equal(
    safeErrorMessage(new Error('bad\nfield=value\twith\rcontrol\u0000chars')),
    "bad field=value with control chars"
  );
  assert.equal(safeErrorMessage("plain\ntext"), "plain text");
  assert.equal(safeErrorMessage("\u001b[31mred\u001b[0m"), " [31mred [0m");
  assert.equal(safeErrorMessage("prefix\u009b31mvalue"), "prefix 31mvalue");
});

void test("safeErrorMessage redacts absolute local file paths", () => {
  assert.equal(
    safeErrorMessage(new Error("failed to open /tmp/switchmaxxer/config.json")),
    "failed to open <path>"
  );
  assert.equal(
    safeErrorMessage(new Error("panic at C:\\Users\\adam\\switchmaxxer\\config.json:12")),
    "panic at <path>"
  );
  assert.equal(
    safeErrorMessage(new Error("Error loading file:///home/adam-kessler/dev/switchmaxxer/config.json")),
    "Error loading <path>"
  );
});

void test("logStartup uses the package version instead of a hard-coded gateway version", async () => {
  let output = "";

  await withLogWriters(
    {
      stdout: (message) => {
        output += message;
      }
    },
    async () => {
      logStartup(getPackageVersion(), "127.0.0.1", 4000, 3, "config.json");
    }
  );

  assert.match(output, new RegExp(`Switchmaxxer Gateway v${getPackageVersion().replace(/\./g, "\\.")} started on 127\\.0\\.0\\.1:4000`));
  assert.doesNotMatch(output, /v0\.01/);
});

void test("package metadata exposes both documented CLI wrapper names through bin", () => {
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    bin?: Record<string, unknown>;
  };

  assert.deepEqual(packageJson.bin, {
    switchmaxxer: "./switchmaxxer",
    smx: "./smx"
  });
});

void test("CLI wrappers replace their shell process before launching runtime", () => {
  const switchmaxxerWrapper = readFileSync(path.join(process.cwd(), "switchmaxxer"), "utf8");
  const smxWrapper = readFileSync(path.join(process.cwd(), "smx"), "utf8");

  assert.match(switchmaxxerWrapper, /\nexec node "\$DIST_ENTRY" "\$@"\n/);
  assert.match(smxWrapper, /\nexec "\$SCRIPT_DIR\/switchmaxxer" "\$@"\n/);
});

void test("redactSensitiveText masks bearer tokens, modern provider tokens, contextual long hex secrets, and URL credentials", () => {
  const redacted = redactSensitiveText(
    [
      "Authorization: Basic dXNlcjpzdXBlcnNlY3JldA==",
      "Authorization: Digest username=\"alice\", realm=\"example\", nonce=\"abc123\", response=\"secret-digest\"",
      "Authorization: Token token-value-123456",
      "Authorization: ApiKey api-key-value-123456",
      "Bearer sk-secret-value",
      "https://alice:supersecret@example.com/path",
      "ak-demo-secret",
      "xoxb-123456789012-abcdefghijklmnop",
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p",
      "hf_abcdefghijklmnopqrstuvwxyz123456",
      "xai-abcdefghijklmnopqrstuvwxyz123456",
      "AKIA1234567890ABCDEF",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturePart123456",
      "digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ].join("\n")
  );

  assert.match(redacted, new RegExp(`Authorization: Basic ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`Authorization: Digest ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`Authorization: Token ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`Authorization: ApiKey ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(redacted, new RegExp(`Bearer ${escapeRegExp(REDACTED_SECRET)}`));
  assert.match(
    redacted,
    new RegExp(
      `https://${escapeRegExp(REDACTED_SECRET)}:${escapeRegExp(REDACTED_SECRET)}@example\\.com/path`
    )
  );
  assert.doesNotMatch(redacted, /sk-secret-value/);
  assert.doesNotMatch(redacted, /dXNlcjpzdXBlcnNlY3JldA==/);
  assert.doesNotMatch(redacted, /secret-digest/);
  assert.doesNotMatch(redacted, /token-value-123456/);
  assert.doesNotMatch(redacted, /api-key-value-123456/);
  assert.doesNotMatch(redacted, /supersecret/);
  assert.doesNotMatch(redacted, /ak-demo-secret/);
  assert.doesNotMatch(redacted, /xoxb-123456789012-abcdefghijklmnop/);
  assert.doesNotMatch(redacted, /ghp_1234567890abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(redacted, /AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p/);
  assert.doesNotMatch(redacted, /hf_abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(redacted, /xai-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(redacted, /AKIA1234567890ABCDEF/);
  assert.doesNotMatch(redacted, /eyJhbGciOiJIUzI1Ni/);
  assert.doesNotMatch(redacted, /digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/);
});

void test("redactSensitiveText avoids clobbering ordinary short identifiers", () => {
  const original = "model=AKI route=ghp docs say API_KEY is optional for local testing";
  assert.equal(redactSensitiveText(original), original);
});

void test("redactSensitiveText preserves ordinary bare 64-character hex digests outside secret-like contexts", () => {
  const original = "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  assert.equal(redactSensitiveText(original), original);
});

void test("withLogWriters keeps concurrent async log capture scopes isolated", async () => {
  let outputA = "";
  let outputB = "";

  await Promise.all([
    withLogWriters(
      {
        stdout: (message) => {
          outputA += message;
        }
      },
      async () => {
        await Promise.resolve();
        logLine("scope-a-1");
        await new Promise((resolve) => setTimeout(resolve, 0));
        logLine("scope-a-2");
      }
    ),
    withLogWriters(
      {
        stdout: (message) => {
          outputB += message;
        }
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        logLine("scope-b-1");
        await Promise.resolve();
        logLine("scope-b-2");
      }
    )
  ]);

  assert.match(outputA, /scope-a-1/);
  assert.match(outputA, /scope-a-2/);
  assert.doesNotMatch(outputA, /scope-b-1|scope-b-2/);
  assert.match(outputB, /scope-b-1/);
  assert.match(outputB, /scope-b-2/);
  assert.doesNotMatch(outputB, /scope-a-1|scope-a-2/);
});

void test("withLogWriters captures log level per async scope instead of inheriting later process log-level changes", async () => {
  let debugScopeOutput = "";
  let infoScopeOutput = "";

  try {
    setProcessLogLevel("debug");
    const debugScope = withLogWriters(
      {
        stdout: (message) => {
          debugScopeOutput += message;
        }
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        logDebug("debug-scope-message");
      }
    );

    setProcessLogLevel("info");
    const infoScope = withLogWriters(
      {
        stdout: (message) => {
          infoScopeOutput += message;
        }
      },
      async () => {
        await Promise.resolve();
        logDebug("info-scope-message");
      }
    );

    await Promise.all([debugScope, infoScope]);

    assert.match(debugScopeOutput, /debug-scope-message/);
    assert.doesNotMatch(debugScopeOutput, /info-scope-message/);
    assert.equal(infoScopeOutput.includes("info-scope-message"), false);
  } finally {
    setProcessLogLevel("info");
  }
});

void test("logger reads SWITCHMAXXER_LOG_LEVEL lazily and can reset to env", async () => {
  const previousLogLevel = process.env["SWITCHMAXXER_LOG_LEVEL"];
  let output = "";

  try {
    process.env["SWITCHMAXXER_LOG_LEVEL"] = "debug";
    resetProcessLogLevel();

    await withLogWriters(
      {
        stdout: (message) => {
          output += message;
        }
      },
      async () => {
        logDebug("env-lazily-enables-debug");
      }
    );

    assert.equal(output.includes("env-lazily-enables-debug"), true);

    output = "";
    setProcessLogLevel("info");

    await withLogWriters(
      {
        stdout: (message) => {
          output += message;
        }
      },
      async () => {
        logDebug("explicit-override-wins");
      }
    );

    assert.equal(output.includes("explicit-override-wins"), false);
  } finally {
    if (typeof previousLogLevel === "string") {
      process.env["SWITCHMAXXER_LOG_LEVEL"] = previousLogLevel;
    } else {
      delete process.env["SWITCHMAXXER_LOG_LEVEL"];
    }
    resetProcessLogLevel();
    setProcessLogLevel("info");
  }
});

void test("SecretString redacts stringification and JSON while still allowing explicit reveal", () => {
  const secret = new SecretString("top-secret");

  assert.equal(secret.reveal(), "top-secret");
  assert.equal(String(secret), REDACTED_SECRET);
  assert.equal(JSON.stringify({ secret }), JSON.stringify({ secret: REDACTED_SECRET }));
});
