import assert from "node:assert/strict";
import test from "node:test";

import {
  AnthropicMessagesRequiredError,
  buildAnthropicRequestBodyFromOpenAi,
  normalizeTextContent
} from "./translate-openai-to-anthropic";
import { UnsupportedTextContentError } from "./translation-shared";

void test("normalizeTextContent joins supported text shapes and rejects non-text content", () => {
  assert.equal(normalizeTextContent("hello"), "hello");
  assert.equal(
    normalizeTextContent([
      "hello",
      {
        type: "text",
        text: " world"
      }
    ]),
    "hello world"
  );
  assert.equal(normalizeTextContent(null), "");

  assert.throws(
    () => normalizeTextContent({ type: "image_url", image_url: { url: "https://example.test/image.png" } }),
    UnsupportedTextContentError
  );
});

void test("buildAnthropicRequestBodyFromOpenAi maps system/developer messages and request knobs", () => {
  assert.deepEqual(
    buildAnthropicRequestBodyFromOpenAi(
      {
        messages: [
          { role: "system", content: "system rules" },
          { role: "developer", content: "developer rules" },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "hello"
              }
            ]
          }
        ],
        max_completion_tokens: 256,
        stream: true,
        temperature: 0.2,
        stop: ["END", 42],
        metadata: { request_id: "req-1" }
      },
      "claude-test"
    ),
    {
      model: "claude-test",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello"
            }
          ]
        }
      ],
      max_tokens: 256,
      stream: true,
      system: "system rules\n\ndeveloper rules",
      temperature: 0.2,
      metadata: { request_id: "req-1" },
      stop_sequences: ["END"]
    }
  );
});

void test("buildAnthropicRequestBodyFromOpenAi translates OpenAI tool definitions and choices", () => {
  assert.deepEqual(
    buildAnthropicRequestBodyFromOpenAi(
      {
        messages: [{ role: "user", content: "what is the weather?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Look up current weather.",
              parameters: {
                type: "object",
                properties: {
                  city: { type: "string" }
                },
                required: ["city"]
              }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: {
            name: "get_weather"
          }
        }
      },
      "claude-test"
    ),
    {
      model: "claude-test",
      messages: [{ role: "user", content: "what is the weather?" }],
      max_tokens: 1024,
      stream: false,
      tools: [
        {
          name: "get_weather",
          description: "Look up current weather.",
          input_schema: {
            type: "object",
            properties: {
              city: { type: "string" }
            },
            required: ["city"]
          }
        }
      ],
      tool_choice: {
        type: "tool",
        name: "get_weather"
      }
    }
  );
});

void test("buildAnthropicRequestBodyFromOpenAi translates OpenAI tool calls and tool results", () => {
  assert.deepEqual(
    buildAnthropicRequestBodyFromOpenAi(
      {
        messages: [
          { role: "user", content: "look this up" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "lookup",
                  arguments: "{\"query\":\"switchmaxxer\"}"
                }
              }
            ]
          },
          {
            role: "tool",
            tool_call_id: "call-1",
            content: "Switchmaxxer is a local gateway."
          }
        ],
        tool_choice: "required"
      },
      "claude-test"
    ),
    {
      model: "claude-test",
      messages: [
        { role: "user", content: "look this up" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "lookup",
              input: { query: "switchmaxxer" }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              content: "Switchmaxxer is a local gateway."
            }
          ]
        }
      ],
      max_tokens: 1024,
      stream: false,
      tool_choice: {
        type: "any"
      }
    }
  );
});

void test("buildAnthropicRequestBodyFromOpenAi omits tools for OpenAI none tool choice", () => {
  const translated = buildAnthropicRequestBodyFromOpenAi(
    {
      messages: [{ role: "user", content: "answer directly" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup"
          }
        }
      ],
      tool_choice: "none"
    },
    "claude-test"
  );

  assert.equal("tools" in translated, false);
  assert.equal("tool_choice" in translated, false);
});

void test("buildAnthropicRequestBodyFromOpenAi rejects invalid OpenAI tool call arguments", () => {
  assert.throws(
    () =>
      buildAnthropicRequestBodyFromOpenAi(
        {
          messages: [
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "lookup",
                    arguments: "{not-json"
                  }
                }
              ]
            }
          ]
        },
        "claude-test"
      ),
    UnsupportedTextContentError
  );
});

void test("buildAnthropicRequestBodyFromOpenAi rejects requests with only system messages", () => {
  assert.throws(
    () =>
      buildAnthropicRequestBodyFromOpenAi(
        {
          messages: [{ role: "system", content: "system rules" }]
        },
        "claude-test"
      ),
    AnthropicMessagesRequiredError
  );
});
