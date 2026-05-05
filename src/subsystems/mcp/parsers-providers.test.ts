import assert from "node:assert/strict";
import test from "node:test";

import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { McpToolError } from "./errors";
import { parseProvidersCreateArgs, parseProvidersSetKeyArgs, parseProvidersUpdateArgs } from "./parsers-providers";

function assertMcpToolError(error: unknown, code: string, message: RegExp | string): void {
  assert.ok(error instanceof McpToolError);
  assert.equal(error.code, code);
  if (typeof message === "string") {
    assert.equal(error.message, message);
  } else {
    assert.match(error.message, message);
  }
}

void test("parseProvidersCreateArgs preserves a normalized no-auth provider payload", () => {
  const parsed = parseProvidersCreateArgs({
    provider_id: "local_gateway",
    endpoint: "https://api.openai.com/v1/chat/completions",
    api_mode: "openai-completions"
  });

  assert.equal(parsed.providerId, "local_gateway");
  assert.deepEqual(parsed.requestedProvider, {
    endpoint: "https://api.openai.com/v1/chat/completions",
    api_mode: "openai-completions",
    api_key_env: null
  });
});

void test("parseProvidersCreateArgs rejects reserved provider identifiers at the parser boundary", () => {
  assert.throws(
    () =>
      parseProvidersCreateArgs({
        provider_id: "__proto__",
        endpoint: "https://api.openai.com/v1/chat/completions",
        api_mode: "openai-completions"
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, /field 'provider_id'/);
      return true;
    }
  );
});

void test("parseProvidersSetKeyArgs rejects reserved provider identifiers at the parser boundary", () => {
  assert.throws(
    () =>
      parseProvidersSetKeyArgs({
        provider_id: "constructor",
        api_key: "sk-test"
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, /field 'provider_id'/);
      return true;
    }
  );
});

void test("parseProvidersUpdateArgs preserves the typed missing_update_fields contract", () => {
  assert.throws(
    () => parseProvidersUpdateArgs({ provider_id: "openai_direct" }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.missingUpdateFields,
        /Provide at least one update field for 'providers update'/
      );
      return true;
    }
  );
});

void test("parseProvidersCreateArgs converts nullable string validation into the MCP null-or-string contract", () => {
  assert.throws(
    () =>
      parseProvidersCreateArgs({
        provider_id: "openai_direct",
        endpoint: "https://api.openai.com/v1/chat/completions",
        api_mode: "openai-completions",
        anthropic_version: 123
      }),
    (error: unknown) => {
      assertMcpToolError(error, MCP_USAGE_ERROR_CODES.invalidInputField, "field 'anthropic_version' must be a non-empty string or null");
      return true;
    }
  );
});
