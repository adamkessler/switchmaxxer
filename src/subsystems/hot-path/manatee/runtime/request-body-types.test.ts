import assert from "node:assert/strict";
import test from "node:test";

import { validateGatewayProxyRequestBody } from "./request-body-types";

// ---------------------------------------------------------------------------
// Positive paths — happy validation
// ---------------------------------------------------------------------------

void test("validateGatewayProxyRequestBody accepts a minimal OpenAI body", () => {
  const result = validateGatewayProxyRequestBody({}, "openai");
  assert.equal(result.apiSurface, "openai");
});

void test("validateGatewayProxyRequestBody accepts a minimal Anthropic body", () => {
  const result = validateGatewayProxyRequestBody({}, "anthropic");
  assert.equal(result.apiSurface, "anthropic");
});

void test("validateGatewayProxyRequestBody accepts a fully-populated OpenAI body", () => {
  const result = validateGatewayProxyRequestBody({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    max_tokens: 256,
    max_completion_tokens: 256,
    temperature: 0.5,
    top_p: 0.9,
    metadata: { user: "alice" },
    tools: [],
    tool_choice: "auto",
    stop: "STOP"
  }, "openai");
  assert.equal(result.apiSurface, "openai");
});

void test("validateGatewayProxyRequestBody accepts a fully-populated Anthropic body", () => {
  const result = validateGatewayProxyRequestBody({
    model: "claude-sonnet-4",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    system: "You are helpful.",
    max_tokens: 1024,
    temperature: 0.7,
    top_p: 0.95,
    metadata: { user_id: "abc" },
    tools: [],
    tool_choice: { type: "auto" },
    stop_sequences: ["END", "STOP"]
  }, "anthropic");
  assert.equal(result.apiSurface, "anthropic");
});

void test("validateGatewayProxyRequestBody accepts metadata explicitly null", () => {
  const result = validateGatewayProxyRequestBody({ metadata: null }, "openai");
  assert.equal(result.apiSurface, "openai");
});

void test("validateGatewayProxyRequestBody accepts stop as string[]", () => {
  const result = validateGatewayProxyRequestBody({
    stop: ["END", "STOP"]
  }, "openai");
  assert.equal(result.apiSurface, "openai");
});

// ---------------------------------------------------------------------------
// Negative paths — OpenAI surface
// ---------------------------------------------------------------------------

void test("OpenAI: rejects model that is not a string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ model: 42 }, "openai"),
    /field 'model' must be a string/
  );
});

void test("OpenAI: rejects messages that is not an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ messages: "not-an-array" }, "openai"),
    /field 'messages' must be an array/
  );
});

void test("OpenAI: rejects stream that is not a boolean", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stream: "yes" }, "openai"),
    /field 'stream' must be a boolean/
  );
});

void test("OpenAI: rejects max_tokens that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ max_tokens: "256" }, "openai"),
    /field 'max_tokens' must be a number/
  );
});

void test("OpenAI: rejects max_completion_tokens that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ max_completion_tokens: true }, "openai"),
    /field 'max_completion_tokens' must be a number/
  );
});

void test("OpenAI: rejects temperature that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ temperature: "0.5" }, "openai"),
    /field 'temperature' must be a number/
  );
});

void test("OpenAI: rejects top_p that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ top_p: "0.9" }, "openai"),
    /field 'top_p' must be a number/
  );
});

void test("OpenAI: rejects metadata that is a primitive", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ metadata: "alice" }, "openai"),
    /field 'metadata' must be an object or null/
  );
});

void test("OpenAI: rejects metadata that is an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ metadata: ["a", "b"] }, "openai"),
    /field 'metadata' must be an object or null/
  );
});

void test("OpenAI: rejects tools that is not an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ tools: { not: "array" } }, "openai"),
    /field 'tools' must be an array/
  );
});

void test("OpenAI: rejects stop that is a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop: 42 }, "openai"),
    /field 'stop' must be a string or string\[\]/
  );
});

void test("OpenAI: rejects stop that is an array containing a non-string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop: ["END", 0] }, "openai"),
    /field 'stop' must be a string or string\[\]/
  );
});

void test("OpenAI: rejects stop that is an object", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop: { kind: "set" } }, "openai"),
    /field 'stop' must be a string or string\[\]/
  );
});

// ---------------------------------------------------------------------------
// Negative paths — Anthropic surface
// ---------------------------------------------------------------------------

void test("Anthropic: rejects model that is not a string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ model: 99 }, "anthropic"),
    /field 'model' must be a string/
  );
});

void test("Anthropic: rejects messages that is not an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ messages: 42 }, "anthropic"),
    /field 'messages' must be an array/
  );
});

void test("Anthropic: rejects stream that is not a boolean", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stream: 1 }, "anthropic"),
    /field 'stream' must be a boolean/
  );
});

void test("Anthropic: rejects system that is not a string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ system: 0 }, "anthropic"),
    /field 'system' must be a string/
  );
});

void test("Anthropic: rejects max_tokens that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ max_tokens: "1024" }, "anthropic"),
    /field 'max_tokens' must be a number/
  );
});

void test("Anthropic: rejects temperature that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ temperature: "0.7" }, "anthropic"),
    /field 'temperature' must be a number/
  );
});

void test("Anthropic: rejects top_p that is not a number", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ top_p: "0.95" }, "anthropic"),
    /field 'top_p' must be a number/
  );
});

void test("Anthropic: rejects metadata that is a primitive", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ metadata: 7 }, "anthropic"),
    /field 'metadata' must be an object or null/
  );
});

void test("Anthropic: rejects metadata that is an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ metadata: [] }, "anthropic"),
    /field 'metadata' must be an object or null/
  );
});

void test("Anthropic: rejects tools that is not an array", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ tools: "no-tools" }, "anthropic"),
    /field 'tools' must be an array/
  );
});

void test("Anthropic: rejects stop_sequences that is a string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop_sequences: "END" }, "anthropic"),
    /field 'stop_sequences' must be a string\[\]/
  );
});

void test("Anthropic: rejects stop_sequences that is an array containing a non-string", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop_sequences: ["END", 1] }, "anthropic"),
    /field 'stop_sequences' must be a string\[\]/
  );
});

void test("Anthropic: rejects stop_sequences that is an object", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ stop_sequences: { kind: "set" } }, "anthropic"),
    /field 'stop_sequences' must be a string\[\]/
  );
});

// ---------------------------------------------------------------------------
// Reserved-key rejection — both surfaces
// ---------------------------------------------------------------------------

void test("Reserved object keys at top level are rejected (OpenAI surface)", () => {
  // Use JSON.parse so __proto__ becomes an own property rather than being
  // interpreted by the object-literal parser as the prototype setter.
  const body = JSON.parse('{"__proto__": {}}') as Record<string, unknown>;
  assert.throws(
    () => validateGatewayProxyRequestBody(body, "openai"),
    /__proto__/
  );
});

void test("Reserved object keys at top level are rejected (Anthropic surface)", () => {
  assert.throws(
    () => validateGatewayProxyRequestBody({ constructor: {} }, "anthropic"),
    /constructor/
  );
});
