import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchedJsonBody, buildRequestShapeSummary } from "./proxy-request-shape";

void test("buildRequestShapeSummary summarizes OpenAI-compatible request bodies without retaining prompt text", () => {
  assert.deepEqual(
    buildRequestShapeSummary(
      {
        messages: [
          { role: "system", content: "be helpful" },
          {
            role: "user",
            content: [
              "hello",
              {
                type: "text",
                text: " world"
              }
            ]
          },
          {
            role: "assistant",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.test/image.png" }
              }
            ]
          }
        ],
        tools: [{ type: "function" }],
        metadata: { request_id: "req-1" },
        max_completion_tokens: 123,
        temperature: 0.2
      },
      "openai"
    ),
    {
      messageCount: 3,
      hasSystemMessage: true,
      promptChars: "be helpful".length + "hello world".length,
      toolCount: 1,
      hasMetadata: true,
      maxTokens: 123,
      temperature: 0.2
    }
  );
});

void test("buildRequestShapeSummary summarizes Anthropic request bodies from native fields", () => {
  assert.deepEqual(
    buildRequestShapeSummary(
      {
        system: "be concise",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" }
        ],
        tools: [{ name: "lookup" }],
        metadata: { request_id: "req-1" },
        max_tokens: 64,
        temperature: 0.7
      },
      "anthropic"
    ),
    {
      messageCount: 2,
      hasSystemMessage: true,
      promptChars: "be concise".length,
      toolCount: 1,
      hasMetadata: true,
      maxTokens: 64,
      temperature: 0.7
    }
  );
});

void test("buildPatchedJsonBody returns the original raw body when no fields change", () => {
  const rawBody = "{\"model\":\"route-a\",\"stream\":false}";
  const parsedBody = {
    model: "route-a",
    stream: false
  };

  assert.equal(buildPatchedJsonBody(rawBody, parsedBody, { model: "route-a" }), rawBody);
});

void test("buildPatchedJsonBody serializes a bounded patched object when fields change", () => {
  const rawBody = "{\"model\":\"route-a\",\"stream\":false}";
  const patched = buildPatchedJsonBody(
    rawBody,
    {
      model: "route-a",
      stream: false
    },
    {
      model: "provider-model-a"
    }
  );

  assert.deepEqual(JSON.parse(patched) as Record<string, unknown>, {
    model: "provider-model-a",
    stream: false
  });
});

void test("buildPatchedJsonBody enforces the caller's serialized byte limit after patching", () => {
  const parsedBody = {
    model: "route-a",
    stream: false
  };
  const rawBody = JSON.stringify(parsedBody);

  assert.throws(
    () =>
      buildPatchedJsonBody(
        rawBody,
        parsedBody,
        { model: "provider-model-a" },
        { maxSerializedBytes: Buffer.byteLength(rawBody) }
      ),
    /json_serialized_too_large/
  );
});
