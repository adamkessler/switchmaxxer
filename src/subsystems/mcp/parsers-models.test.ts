import assert from "node:assert/strict";
import test from "node:test";

import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { McpToolError } from "./errors";
import { parseModelsCreateArgs, parseModelsUpdateArgs } from "./parsers-models";

function assertMcpToolError(error: unknown, code: string, message: RegExp | string): void {
  assert.ok(error instanceof McpToolError);
  assert.equal(error.code, code);
  if (typeof message === "string") {
    assert.equal(error.message, message);
  } else {
    assert.match(error.message, message);
  }
}

void test("parseModelsCreateArgs returns a normalized requestedModel payload", () => {
  const parsed = parseModelsCreateArgs({
    model_id: "gpt-4o-mini",
    display_name: "GPT-4o Mini",
    model_creator: "openai",
    cost: {
      input: 0.15,
      output: 0.6,
      cache_read: 0.01,
      cache_write: 0.02
    }
  });

  assert.equal(parsed.modelId, "gpt-4o-mini");
  assert.equal(parsed.displayName, "GPT-4o Mini");
  assert.equal(parsed.modelCreator, "openai");
  assert.deepEqual(parsed.requestedModel, {
    display_name: "GPT-4o Mini",
    model_creator: "openai",
    cost: {
      input: 0.15,
      output: 0.6,
      cacheRead: 0.01,
      cacheWrite: 0.02
    }
  });
});

void test("parseModelsCreateArgs rejects unknown nested cost fields at the parser boundary", () => {
  assert.throws(
    () =>
      parseModelsCreateArgs({
        model_id: "gpt-4o-mini",
        display_name: "GPT-4o Mini",
        model_creator: "openai",
        cost: {
          input: 0.15,
          output: 0.6,
          cache_read: 0.01,
          cache_write: 0.02,
          extra_field: 1
        }
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "field 'cost' contains unsupported field 'extra_field'.");
      return true;
    }
  );
});

void test("parseModelsUpdateArgs preserves the typed missing_update_fields contract", () => {
  assert.throws(
    () => parseModelsUpdateArgs({ model_id: "gpt-4o-mini" }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.missingUpdateFields,
        "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
      );
      return true;
    }
  );
});
