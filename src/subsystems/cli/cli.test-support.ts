import assert from "node:assert/strict";
import test from "node:test";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { CLI_SCHEMA_VERSION } from "../../platform/response-envelope";
import { run, type CliIo } from "../../index";

export { test };

export function parseCliEnvelope(
  stdout: string
) {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const ok = parsed["ok"];
  const command = parsed["command"];
  const schemaVersion = parsed["schema_version"];
  const error = parsed["error"] as
    | {
        code?: unknown;
        message?: unknown;
      }
    | undefined;
  const appErrorCodes = new Set<string>(Object.values(APP_ERROR_CODES));

  assert.equal(typeof ok, "boolean");
  assert.equal(typeof command, "string");
  assert.ok((command as string).length > 0);
  assert.equal(schemaVersion, CLI_SCHEMA_VERSION);

  if (ok === true) {
    assert.ok(Object.hasOwn(parsed, "data"));
  } else {
    assert.equal(ok, false);
    assert.equal(typeof error, "object");
    assert.ok(error !== null);
    assert.equal(typeof error?.code, "string");
    assert.equal(typeof error?.message, "string");
    assert.ok(
      appErrorCodes.has(error?.code as string),
      `Unexpected CLI error.code: ${error?.code as string}`
    );
  }

  return parsed;
}

export async function captureCliIo<T>(fn: (io: CliIo) => Promise<T>): Promise<{
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
    env: { ...process.env },
    cwd: () => process.cwd()
  };

  const result = await fn(io);
  return { result, stdout, stderr };
}

export async function runWithCapturedIo(argv: string[]): Promise<{
  result: number;
  stdout: string;
  stderr: string;
}> {
  return await captureCliIo(async (io) => await run(argv, io));
}
