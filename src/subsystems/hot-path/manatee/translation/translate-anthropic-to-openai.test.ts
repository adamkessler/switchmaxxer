import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSseChunk,
  parseSseEvents,
  SseRemainderLimitError,
  translateAnthropicEventToOpenAiChunks,
  translateAnthropicResponse,
  type AnthropicToOpenAiStreamState
} from "./translate-anthropic-to-openai";

function createStreamState(): AnthropicToOpenAiStreamState {
  return {
    placeholderResponseId: "placeholder-id",
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map()
  };
}

function readChunkPayload(chunk: string): Record<string, unknown> | "[DONE]" {
  const line = chunk.trim();
  assert.ok(line.startsWith("data: "));
  const payload = line.slice("data: ".length);
  return payload === "[DONE]" ? "[DONE]" : JSON.parse(payload) as Record<string, unknown>;
}

void test("translateAnthropicResponse maps text and tool_use blocks into OpenAI choices", () => {
  const translated = translateAnthropicResponse(
    {
      id: "msg-1",
      content: [
        {
          type: "text",
          text: "answer"
        },
        {
          type: "tool_use",
          id: "tool-1",
          name: "lookup",
          input: { query: "switchmaxxer" }
        }
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 10,
        output_tokens: 5
      }
    },
    "claude-test"
  );

  assert.equal(translated["id"], "msg-1");
  assert.equal(translated["model"], "claude-test");
  assert.deepEqual(translated["usage"], {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15
  });

  const choices = translated["choices"] as Array<Record<string, unknown>>;
  assert.equal(choices[0]?.["finish_reason"], "tool_calls");
  assert.deepEqual(choices[0]?.["message"], {
    role: "assistant",
    content: "answer",
    tool_calls: [
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup",
          arguments: "{\"query\":\"switchmaxxer\"}"
        }
      }
    ]
  });
});

void test("translateAnthropicResponse ignores thinking blocks while preserving tool_use arguments", () => {
  const translated = translateAnthropicResponse(
    {
      id: "msg-minimax-tool",
      content: [
        {
          type: "thinking",
          thinking: "The tool input should not be exposed to the client as text.",
          signature: "test-signature"
        },
        {
          type: "tool_use",
          id: "call_function_1",
          name: "exec",
          input: { command: "pwd" }
        }
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 216,
        output_tokens: 59
      }
    },
    "MiniMax-M2.7-highspeed"
  );

  const choices = translated["choices"] as Array<Record<string, unknown>>;
  const message = choices[0]?.["message"] as Record<string, unknown>;
  const toolCalls = message["tool_calls"] as Array<Record<string, unknown>>;

  assert.equal(choices[0]?.["finish_reason"], "tool_calls");
  assert.equal(message["content"], null);
  assert.deepEqual(toolCalls[0], {
    id: "call_function_1",
    type: "function",
    function: {
      name: "exec",
      arguments: "{\"command\":\"pwd\"}"
    }
  });
  assert.doesNotMatch(JSON.stringify(translated), /test-signature|The tool input should not be exposed/);
});

void test("parseSseEvents normalizes line endings and carries incomplete remainder", () => {
  assert.deepEqual(parseSseEvents("event: ping\r\ndata: {}\r\n\r\nevent: next\ndata:"), {
    events: ["event: ping\ndata: {}"],
    remainder: "event: next\ndata:"
  });
});

void test("parseSseEvents rejects oversized incomplete remainders locally", () => {
  assert.throws(
    () => parseSseEvents(`event: next\ndata: ${"x".repeat(32)}`, { maxRemainderBytes: 16 }),
    (error) => {
      assert.ok(error instanceof SseRemainderLimitError);
      assert.equal(error.maxBytes, 16);
      assert.ok(error.actualBytes > 16);
      return true;
    }
  );
});

void test("parseSseEvents rejects oversized trailing remainders after complete events", () => {
  assert.throws(
    () => parseSseEvents(`event: ping\ndata: {}\n\n${"x".repeat(17)}`, { maxRemainderBytes: 16 }),
    SseRemainderLimitError
  );
});

void test("translateAnthropicEventToOpenAiChunks emits role, text, tool-call, finish, and done chunks", () => {
  const state = createStreamState();

  const startChunks = translateAnthropicEventToOpenAiChunks(
    "event: message_start\ndata: {\"message\":{\"id\":\"msg-stream-1\"}}",
    "claude-test",
    state
  );
  assert.equal(startChunks.length, 1);
  const startPayload = readChunkPayload(startChunks[0]!);
  if (startPayload === "[DONE]") {
    assert.fail("expected JSON stream chunk payload");
  }
  assert.equal(startPayload["id"], "msg-stream-1");

  const textChunks = translateAnthropicEventToOpenAiChunks(
    "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}",
    "claude-test",
    state
  );
  assert.equal(textChunks.length, 1);
  const textPayload = readChunkPayload(textChunks[0]!) as { choices: Array<{ delta: Record<string, unknown> }> };
  assert.equal(textPayload.choices[0]?.delta["content"], "hello");

  const toolStartChunks = translateAnthropicEventToOpenAiChunks(
    "event: content_block_start\ndata: {\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool-1\",\"name\":\"lookup\",\"input\":{}}}",
    "claude-test",
    state
  );
  assert.equal(toolStartChunks.length, 1);
  const toolStartPayload = readChunkPayload(toolStartChunks[0]!) as { choices: Array<{ delta: Record<string, unknown> }> };
  assert.deepEqual(toolStartPayload.choices[0]?.delta["tool_calls"], [
    {
      index: 0,
      id: "tool-1",
      type: "function",
      function: {
        name: "lookup",
        arguments: ""
      }
    }
  ]);

  const toolDeltaChunks = translateAnthropicEventToOpenAiChunks(
    "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"query\\\":\"}}",
    "claude-test",
    state
  );
  const toolDeltaPayload = readChunkPayload(toolDeltaChunks[0]!) as { choices: Array<{ delta: Record<string, unknown> }> };
  assert.deepEqual(toolDeltaPayload.choices[0]?.delta["tool_calls"], [
    {
      index: 0,
      function: {
        arguments: "{\"query\":"
      }
    }
  ]);

  const finishChunks = translateAnthropicEventToOpenAiChunks(
    "event: message_delta\ndata: {\"delta\":{\"stop_reason\":\"end_turn\"}}",
    "claude-test",
    state
  );
  const finishPayload = readChunkPayload(finishChunks[0]!) as { choices: Array<{ finish_reason: string }> };
  assert.equal(finishPayload.choices[0]?.finish_reason, "stop");

  assert.deepEqual(
    translateAnthropicEventToOpenAiChunks("event: message_stop\ndata: {\"type\":\"message_stop\"}", "claude-test", state),
    [formatSseChunk("[DONE]")]
  );
});

void test("translateAnthropicEventToOpenAiChunks ignores streaming thinking blocks before tool_use", () => {
  const state = createStreamState();

  const startChunks = translateAnthropicEventToOpenAiChunks(
    "event: message_start\ndata: {\"message\":{\"id\":\"msg-minimax-stream\"}}",
    "MiniMax-M2.7-highspeed",
    state
  );
  assert.equal(startChunks.length, 1);

  assert.deepEqual(
    translateAnthropicEventToOpenAiChunks(
      "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}",
      "MiniMax-M2.7-highspeed",
      state
    ),
    []
  );
  assert.deepEqual(
    translateAnthropicEventToOpenAiChunks(
      "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"private reasoning\"}}",
      "MiniMax-M2.7-highspeed",
      state
    ),
    []
  );
  assert.deepEqual(
    translateAnthropicEventToOpenAiChunks(
      "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"test-signature\"}}",
      "MiniMax-M2.7-highspeed",
      state
    ),
    []
  );
  assert.deepEqual(
    translateAnthropicEventToOpenAiChunks(
      "event: content_block_stop\ndata: {\"index\":0}",
      "MiniMax-M2.7-highspeed",
      state
    ),
    []
  );

  const toolStartChunks = translateAnthropicEventToOpenAiChunks(
    "event: content_block_start\ndata: {\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_function_1\",\"name\":\"exec\",\"input\":{}}}",
    "MiniMax-M2.7-highspeed",
    state
  );
  assert.equal(toolStartChunks.length, 1);
  const toolStartPayload = readChunkPayload(toolStartChunks[0]!) as { choices: Array<{ delta: Record<string, unknown> }> };
  assert.deepEqual(toolStartPayload.choices[0]?.delta["tool_calls"], [
    {
      index: 0,
      id: "call_function_1",
      type: "function",
      function: {
        name: "exec",
        arguments: ""
      }
    }
  ]);

  const toolDeltaChunks = translateAnthropicEventToOpenAiChunks(
    "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}",
    "MiniMax-M2.7-highspeed",
    state
  );
  const toolDeltaPayload = readChunkPayload(toolDeltaChunks[0]!) as { choices: Array<{ delta: Record<string, unknown> }> };
  assert.deepEqual(toolDeltaPayload.choices[0]?.delta["tool_calls"], [
    {
      index: 0,
      function: {
        arguments: "{\"command\":\"pwd\"}"
      }
    }
  ]);
  assert.doesNotMatch(`${toolStartChunks.join("")}${toolDeltaChunks.join("")}`, /private reasoning|test-signature/);
});
