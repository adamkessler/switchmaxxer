import assert from "node:assert/strict";
import test from "node:test";

import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { McpToolError } from "./errors";
import {
  parsePruneArgs,
  parseTraceObservationsArgs,
  parseTraceRepairArgs,
  parseTraceShowArgs,
  parseTraceVerifyArgs
} from "./parsers-observability";

function assertMcpToolError(error: unknown, code: string, message: RegExp | string): void {
  assert.ok(error instanceof McpToolError);
  assert.equal(error.code, code);
  if (typeof message === "string") {
    assert.equal(error.message, message);
  } else {
    assert.match(error.message, message);
  }
}

void test("parseTraceObservationsArgs rejects invalid typed event values", () => {
  assert.throws(
    () => parseTraceObservationsArgs({ event: "bogus" }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, /field 'event' must be one of:/);
      return true;
    }
  );
});

void test("parseTraceVerifyArgs rejects contradictory single-trace and all-scopes", () => {
  assert.throws(
    () =>
      parseTraceVerifyArgs({
        trace_id: "trace_123",
        all: true
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "Use either '<trace-id>' or '--all', not both");
      return true;
    }
  );
});

void test("parseTraceVerifyArgs requires exactly one scope", () => {
  assert.throws(
    () => parseTraceVerifyArgs({}),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "Provide '<trace-id>' or '--all'");
      return true;
    }
  );
});

void test("parseTraceRepairArgs rejects batch_size without all-scope", () => {
  assert.throws(
    () =>
      parseTraceRepairArgs({
        trace_id: "trace_123",
        batch_size: 10
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "Flag '--batch-size' is only supported with '--all'");
      return true;
    }
  );
});

void test("parseTraceRepairArgs preserves valid all-scope batch size", () => {
  const parsed = parseTraceRepairArgs({
    all: true,
    batch_size: 10
  });

  assert.equal(parsed.traceId, undefined);
  assert.equal(parsed.all, true);
  assert.equal(parsed.batchSize, 10);
});

void test("parsePruneArgs rejects invalid retention durations at the typed boundary", () => {
  assert.throws(
    () => parsePruneArgs({ older_than: "tomorrow" }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.invalidInputField,
        "field 'older_than' must be a duration like '14d', '168h', '30m', or '2w'."
      );
      return true;
    }
  );
});

void test("parseTraceShowArgs requires a non-empty trace id", () => {
  assert.throws(() => parseTraceShowArgs({}), /Tool 'trace_show' requires non-empty 'trace_id'\./);
});
