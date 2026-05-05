import assert from "node:assert/strict";
import test from "node:test";

import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { McpToolError } from "./errors";
import { parseRoutesCreateArgs, parseRoutesUpdateArgs } from "./parsers-routes";

function assertMcpToolError(error: unknown, code: string, message: RegExp | string): void {
  assert.ok(error instanceof McpToolError);
  assert.equal(error.code, code);
  if (typeof message === "string") {
    assert.equal(error.message, message);
  } else {
    assert.match(error.message, message);
  }
}

void test("parseRoutesCreateArgs returns a normalized route payload", () => {
  const parsed = parseRoutesCreateArgs({
    route_id: "gpt4o-mini-chat",
    model: "gpt-4o-mini",
    service_provider: "openai_direct",
    provider_model_id: "gpt-4o-mini",
    display_name: "GPT-4o Mini Chat",
    timeout_ms: 30_000
  });

  assert.equal(parsed.routeId, "gpt4o-mini-chat");
  assert.equal(parsed.timeoutMs, 30_000);
});

void test("parseRoutesCreateArgs rejects unknown nested cost fields at the parser boundary", () => {
  assert.throws(
    () =>
      parseRoutesCreateArgs({
        route_id: "gpt4o-mini-chat",
        model: "gpt-4o-mini",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        display_name: "GPT-4o Mini Chat",
        cost: {
          input: 0.15,
          output: 0.6,
          cache_read: 0.01,
          cache_write: 0.02,
          mystery_field: 1
        }
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "field 'cost' contains unsupported field 'mystery_field'.");
      return true;
    }
  );
});

void test("parseRoutesUpdateArgs preserves explicit timeout clearing with null", () => {
  const parsed = parseRoutesUpdateArgs({
    route_id: "gpt4o-mini-chat",
    timeout_ms: null
  });

  assert.equal(parsed.routeId, "gpt4o-mini-chat");
  assert.equal(parsed.timeoutMs, null);
});

void test("parseRoutesUpdateArgs preserves the typed missing_update_fields contract", () => {
  assert.throws(
    () => parseRoutesUpdateArgs({ route_id: "gpt4o-mini-chat" }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.missingUpdateFields,
        /Provide at least one update field for 'routes update'/
      );
      return true;
    }
  );
});
