import assert from "node:assert/strict";
import test from "node:test";

import { parseGatewayRunArgs, parseLogsTailArgs } from "./runtime-support";

function readLongFlagValue(
  argv: string[],
  index: number,
  flagName: string,
  missingValueMessage = `Flag '${flagName}' requires a value`
): { consumed: number; value?: string; errorMessage?: string } | null {
  const arg = argv[index];
  if (typeof arg === "undefined") {
    return null;
  }

  if (arg === flagName) {
    const nextArg = argv[index + 1];
    if (typeof nextArg === "undefined") {
      return { consumed: 0, errorMessage: missingValueMessage };
    }

    return { consumed: 1, value: nextArg };
  }

  if (arg.startsWith(`${flagName}=`)) {
    const value = arg.slice(flagName.length + 1);
    if (value.length === 0) {
      return { consumed: 0, errorMessage: missingValueMessage };
    }

    return { consumed: 0, value };
  }

  return null;
}

void test("parseLogsTailArgs accepts ISO 8601 --since values", () => {
  const parsed = parseLogsTailArgs(["--since", "2026-04-21T12:34:56Z"], readLongFlagValue);

  assert.equal(parsed.errorMessage, undefined);
  assert.equal(parsed.since, "2026-04-21T12:34:56Z");
});

void test("parseLogsTailArgs accepts supported relative --since values", () => {
  const parsed = parseLogsTailArgs(["--since", "5 minutes ago"], readLongFlagValue);

  assert.equal(parsed.errorMessage, undefined);
  assert.equal(parsed.since, "5 minutes ago");
});

void test("parseLogsTailArgs rejects flag-like --since values", () => {
  const parsed = parseLogsTailArgs(["--since", "-n 100"], readLongFlagValue);

  assert.equal(
    parsed.errorMessage,
    "Flag '--since' must be an ISO 8601 timestamp or a relative time like '5 minutes ago'"
  );
});

void test("parseLogsTailArgs rejects free-form --since values outside the allowlist", () => {
  const parsed = parseLogsTailArgs(["--since", "yesterday; echo pwned"], readLongFlagValue);

  assert.equal(
    parsed.errorMessage,
    "Flag '--since' must be an ISO 8601 timestamp or a relative time like '5 minutes ago'"
  );
});

void test("parseLogsTailArgs rejects control characters in --since values", () => {
  const cases = ["5\nminutes ago", "5\rminutes ago", "5\tminutes ago"];

  for (const value of cases) {
    const parsed = parseLogsTailArgs(["--since", value], readLongFlagValue);

    assert.equal(
      parsed.errorMessage,
      "Flag '--since' must be an ISO 8601 timestamp or a relative time like '5 minutes ago'",
      value
    );
  }
});

void test("gateway operator parsers reject partial numeric flag tokens", () => {
  assert.equal(
    parseGatewayRunArgs(["--port", "4080x"], readLongFlagValue).errorMessage,
    "Flag '--port' must be a positive integer"
  );
  assert.equal(
    parseLogsTailArgs(["--lines", "25x"], readLongFlagValue).errorMessage,
    "Flag '--lines' must be a non-negative integer"
  );
});
