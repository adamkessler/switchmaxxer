import { randomUUID } from "node:crypto";

import { safeJsonStringifyWithinBounds } from "../../platform/json-bounds";
import { isObjectLike } from "../../platform/type-guards";
import { parseJsonObjectWithinBounds, UnsupportedTextContentError } from "./translation-shared";

export type AnthropicResponseBody = {
  id?: string;
  type?: string;
  role?: string;
  content?: Array<Record<string, unknown>>;
  model?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function translateAnthropicAssistantMessage(
  content: AnthropicResponseBody["content"]
): Record<string, unknown> {
  if (!Array.isArray(content)) {
    return {
      role: "assistant",
      content: ""
    };
  }

  const textParts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const block of content) {
    if (isIgnorableAnthropicContentBlockType(block["type"])) {
      continue;
    }

    if (block["type"] === "text" && typeof block["text"] === "string") {
      textParts.push(block["text"]);
      continue;
    }

    if (block["type"] === "tool_use") {
      if (typeof block["name"] !== "string" || block["name"].trim().length === 0) {
        throw new UnsupportedTextContentError(
          "Encountered malformed Anthropic tool_use block while translating response."
        );
      }

      toolCalls.push({
        id:
          typeof block["id"] === "string" && block["id"].trim().length > 0
            ? block["id"]
            : `call_${randomUUID().replace(/-/g, "")}`,
        type: "function",
        function: {
          name: block["name"],
          arguments: safeJsonStringifyWithinBounds(block["input"] ?? {})
        }
      });
      continue;
    }

    const blockType = typeof block["type"] === "string" ? block["type"] : "unknown";
    throw new UnsupportedTextContentError(
      `Encountered unsupported upstream content block type '${blockType}' while translating response.`
    );
  }

  const message: Record<string, unknown> = {
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("") : toolCalls.length > 0 ? null : ""
  };

  if (toolCalls.length > 0) {
    message["tool_calls"] = toolCalls;
  }

  return message;
}

function mapStopReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

export function translateAnthropicResponse(
  upstreamBody: AnthropicResponseBody,
  model: string
): Record<string, unknown> {
  const promptTokens = upstreamBody.usage?.input_tokens ?? 0;
  const completionTokens = upstreamBody.usage?.output_tokens ?? 0;
  const created = Math.floor(Date.now() / 1000);
  const message = translateAnthropicAssistantMessage(upstreamBody.content);

  return {
    id: upstreamBody.id ?? `switchmaxxer-${created}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(upstreamBody.stop_reason)
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };
}

export function formatSseChunk(payload: Record<string, unknown> | "[DONE]"): string {
  if (payload === "[DONE]") {
    return "data: [DONE]\n\n";
  }

  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createOpenAiStreamChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason
      }
    ]
  };
}

export type AnthropicToOpenAiStreamState = {
  placeholderResponseId: string;
  announcedRole: boolean;
  nextToolCallIndex: number;
  toolCallIndexes: Map<number, number>;
  ignoredContentBlockIndexes?: Set<number>;
};

export const MAX_SSE_REMAINDER_BYTES = 64 * 1024;

export type ParseSseEventsOptions = {
  maxRemainderBytes?: number;
};

export class SseRemainderLimitError extends Error {
  readonly maxBytes: number;
  readonly actualBytes: number;

  constructor(maxBytes: number, actualBytes: number) {
    super(`SSE remainder exceeded maxRemainderBytes (${maxBytes} bytes).`);
    this.name = "SseRemainderLimitError";
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

function resolveMaxSseRemainderBytes(options: ParseSseEventsOptions): number {
  const maxRemainderBytes = options.maxRemainderBytes ?? MAX_SSE_REMAINDER_BYTES;

  if (!Number.isFinite(maxRemainderBytes) || maxRemainderBytes <= 0) {
    throw new Error("parseSseEvents requires a positive 'maxRemainderBytes'.");
  }

  return Math.trunc(maxRemainderBytes);
}

function assertSseRemainderWithinLimit(remainder: string, maxRemainderBytes: number): void {
  const actualBytes = Buffer.byteLength(remainder, "utf8");

  if (actualBytes > maxRemainderBytes) {
    throw new SseRemainderLimitError(maxRemainderBytes, actualBytes);
  }
}

function isIgnorableAnthropicContentBlockType(blockType: unknown): boolean {
  return blockType === "thinking" || blockType === "redacted_thinking";
}

function ignoreAnthropicContentBlockIndex(
  state: AnthropicToOpenAiStreamState,
  index: number | null
): void {
  if (index === null) {
    return;
  }

  state.ignoredContentBlockIndexes ??= new Set<number>();
  state.ignoredContentBlockIndexes.add(index);
}

function isIgnoredAnthropicContentBlockIndex(
  state: AnthropicToOpenAiStreamState,
  index: number | null
): boolean {
  return index !== null && (state.ignoredContentBlockIndexes?.has(index) ?? false);
}

function serializeInitialStreamingToolArguments(input: unknown): string {
  if (input === undefined) {
    return "";
  }

  if (isObjectLike(input) && Object.keys(input).length === 0) {
    return "";
  }

  return safeJsonStringifyWithinBounds(input);
}

export function parseSseEvents(
  buffer: string,
  options: ParseSseEventsOptions = {}
): { events: string[]; remainder: string } {
  const maxRemainderBytes = resolveMaxSseRemainderBytes(options);
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");

  if (parts.length === 1) {
    assertSseRemainderWithinLimit(normalized, maxRemainderBytes);

    return {
      events: [],
      remainder: normalized
    };
  }

  const remainder = parts.pop() ?? "";
  assertSseRemainderWithinLimit(remainder, maxRemainderBytes);

  return {
    events: parts,
    remainder
  };
}

export function translateAnthropicEventToOpenAiChunks(
  rawEvent: string,
  model: string,
  state: AnthropicToOpenAiStreamState
): string[] {
  const lines = rawEvent.split("\n");
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const rawData = dataLines.join("\n");

  if (rawData.length === 0 || rawData === "[DONE]") {
    return [];
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = parseJsonObjectWithinBounds(rawData, "Anthropic SSE event");
  } catch {
    throw new Error("Invalid Anthropic SSE event payload.");
  }

  if (eventName === "message_start") {
    const messageValue = parsed["message"];
    const message = isObjectLike(messageValue) ? messageValue : parsed;

    if (typeof message["id"] === "string") {
      state.placeholderResponseId = message["id"];
    }

    state.announcedRole = true;

    return [
      formatSseChunk(
        createOpenAiStreamChunk(state.placeholderResponseId, model, { role: "assistant", content: "" }, null)
      )
    ];
  }

  if (eventName === "content_block_start") {
    const index = typeof parsed["index"] === "number" ? parsed["index"] : null;
    const blockValue = parsed["content_block"];
    const block = isObjectLike(blockValue) ? blockValue : undefined;

    if (isIgnorableAnthropicContentBlockType(block?.["type"])) {
      ignoreAnthropicContentBlockIndex(state, index);
      return [];
    }

    if (block?.["type"] !== "tool_use" || typeof block["name"] !== "string") {
      return [];
    }

    const toolCallIndex = state.nextToolCallIndex;
    state.nextToolCallIndex += 1;

    if (index !== null) {
      state.toolCallIndexes.set(index, toolCallIndex);
    }

    const chunks: string[] = [];

    if (!state.announcedRole) {
      state.announcedRole = true;
      chunks.push(
        formatSseChunk(
          createOpenAiStreamChunk(state.placeholderResponseId, model, { role: "assistant", content: "" }, null)
        )
      );
    }

    chunks.push(
      formatSseChunk(
        createOpenAiStreamChunk(
          state.placeholderResponseId,
          model,
          {
            tool_calls: [
              {
                index: toolCallIndex,
                id:
                  typeof block["id"] === "string" && block["id"].trim().length > 0
                    ? block["id"]
                    : `call_${randomUUID().replace(/-/g, "")}`,
                type: "function",
                function: {
                  name: block["name"],
                  arguments: serializeInitialStreamingToolArguments(block["input"])
                }
              }
            ]
          },
          null
        )
      )
    );

    return chunks;
  }

  if (eventName === "content_block_delta") {
    const index = typeof parsed["index"] === "number" ? parsed["index"] : null;

    if (isIgnoredAnthropicContentBlockIndex(state, index)) {
      return [];
    }

    const deltaValue = parsed["delta"];
    const delta = isObjectLike(deltaValue) ? deltaValue : undefined;
    const text = typeof delta?.["text"] === "string" ? delta["text"] : "";

    if (delta?.["type"] === "input_json_delta" && typeof delta["partial_json"] === "string") {
      const toolCallIndex = index === null ? undefined : state.toolCallIndexes.get(index);

      if (toolCallIndex === undefined) {
        return [];
      }

      if (!state.announcedRole) {
        state.announcedRole = true;

        return [
          formatSseChunk(
            createOpenAiStreamChunk(state.placeholderResponseId, model, { role: "assistant", content: "" }, null)
          ),
          formatSseChunk(
            createOpenAiStreamChunk(
              state.placeholderResponseId,
              model,
              {
                tool_calls: [
                  {
                    index: toolCallIndex,
                    function: {
                      arguments: delta["partial_json"]
                    }
                  }
                ]
              },
              null
            )
          )
        ];
      }

      return [
        formatSseChunk(
          createOpenAiStreamChunk(
            state.placeholderResponseId,
            model,
            {
              tool_calls: [
                {
                  index: toolCallIndex,
                  function: {
                    arguments: delta["partial_json"]
                  }
                }
              ]
            },
            null
          )
        )
      ];
    }

    if (text.length === 0) {
      return [];
    }

    if (!state.announcedRole) {
      state.announcedRole = true;

      return [
        formatSseChunk(
          createOpenAiStreamChunk(state.placeholderResponseId, model, { role: "assistant", content: "" }, null)
        ),
        formatSseChunk(createOpenAiStreamChunk(state.placeholderResponseId, model, { content: text }, null))
      ];
    }

    return [formatSseChunk(createOpenAiStreamChunk(state.placeholderResponseId, model, { content: text }, null))];
  }

  if (eventName === "content_block_stop") {
    const index = typeof parsed["index"] === "number" ? parsed["index"] : null;

    if (index !== null) {
      state.toolCallIndexes.delete(index);
      state.ignoredContentBlockIndexes?.delete(index);
    }

    return [];
  }

  if (eventName === "message_delta") {
    const deltaValue = parsed["delta"];
    const delta = isObjectLike(deltaValue) ? deltaValue : undefined;
    const finishReason = mapStopReason(
      typeof delta?.["stop_reason"] === "string" ? delta["stop_reason"] : null
    );

    return [formatSseChunk(createOpenAiStreamChunk(state.placeholderResponseId, model, {}, finishReason))];
  }

  if (eventName === "message_stop") {
    return [formatSseChunk("[DONE]")];
  }

  return [];
}
