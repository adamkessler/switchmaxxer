import { randomUUID } from "node:crypto";

import { isObjectLike } from "../../../../platform/type-guards";
import { parseJsonObjectWithinBounds, UnsupportedTextContentError } from "./translation-shared";

type AnthropicContentBlock =
  | {
      type: "text";
      text: string;
    }
  | Record<string, unknown>;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type ToolChoiceTranslation = {
  value?: unknown;
  omitTools: boolean;
};

export class AnthropicMessagesRequiredError extends Error {
  constructor() {
    super("Anthropic request translation requires at least one non-system message.");
    this.name = "AnthropicMessagesRequiredError";
  }
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return isObjectLike(value) && value["type"] === "text" && typeof value["text"] === "string";
}

function isInputTextBlock(value: unknown): value is { type: "input_text"; text: string } {
  return isObjectLike(value) && value["type"] === "input_text" && typeof value["text"] === "string";
}

export function normalizeTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }

      if (isTextBlock(item)) {
        return [item.text];
      }

      throw new UnsupportedTextContentError("Encountered unsupported array content block during text normalization.");
    });

    return textParts.join("");
  }

  if (content === null || typeof content === "undefined") {
    return "";
  }

  throw new UnsupportedTextContentError("Encountered unsupported non-text content during normalization.");
}

function toAnthropicContent(content: unknown): string | AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return normalizeTextContent(content);
  }

  const blocks: AnthropicContentBlock[] = [];

  for (const item of content) {
    if (typeof item === "string") {
      blocks.push({
        type: "text",
        text: item
      });
      continue;
    }

    if (!isObjectLike(item)) {
      continue;
    }

    if (isTextBlock(item) || isInputTextBlock(item)) {
      blocks.push({
        type: "text",
        text: item.text
      });
      continue;
    }

    const blockType = typeof item["type"] === "string" ? item["type"] : "unknown";
    throw new UnsupportedTextContentError(
      `Encountered unsupported message block type '${blockType}' while translating request content.`
    );
  }

  return blocks.length > 0 ? blocks : "";
}

function mapMessageRole(role: unknown): "system" | "user" | "assistant" {
  if (role === "system" || role === "developer") {
    return "system";
  }

  if (role === "assistant") {
    return "assistant";
  }

  return "user";
}

function parseToolArguments(argumentsValue: unknown): Record<string, unknown> {
  if (typeof argumentsValue === "undefined" || argumentsValue === null || argumentsValue === "") {
    return {};
  }

  if (typeof argumentsValue === "string") {
    try {
      return parseJsonObjectWithinBounds(argumentsValue, "OpenAI tool call arguments");
    } catch {
      throw new UnsupportedTextContentError("Encountered invalid OpenAI tool call arguments JSON.");
    }
  }

  if (isObjectLike(argumentsValue)) {
    return argumentsValue;
  }

  throw new UnsupportedTextContentError("Encountered unsupported OpenAI tool call arguments.");
}

function toAnthropicToolResultContent(content: unknown): string | AnthropicContentBlock[] {
  if (Array.isArray(content)) {
    const blocks: AnthropicContentBlock[] = [];

    for (const item of content) {
      if (typeof item === "string") {
        blocks.push({ type: "text", text: item });
        continue;
      }

      if (isObjectLike(item) && (isTextBlock(item) || isInputTextBlock(item))) {
        blocks.push({ type: "text", text: item.text });
        continue;
      }

      throw new UnsupportedTextContentError("Encountered unsupported OpenAI tool result content block.");
    }

    return blocks;
  }

  return normalizeTextContent(content);
}

function toAnthropicAssistantContent(item: Record<string, unknown>): string | AnthropicContentBlock[] {
  const toolCalls = Array.isArray(item["tool_calls"]) ? item["tool_calls"] : [];

  if (toolCalls.length === 0) {
    return toAnthropicContent(item["content"]);
  }

  const blocks: AnthropicContentBlock[] = [];
  const text = normalizeTextContent(toAnthropicContent(item["content"]));

  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }

  for (const toolCall of toolCalls) {
    if (!isObjectLike(toolCall)) {
      throw new UnsupportedTextContentError("Encountered malformed OpenAI tool call.");
    }

    const functionValue = toolCall["function"];
    const functionRecord = isObjectLike(functionValue) ? functionValue : undefined;
    const name = functionRecord && typeof functionRecord["name"] === "string" ? functionRecord["name"] : "";

    if (name.trim().length === 0) {
      throw new UnsupportedTextContentError("Encountered OpenAI tool call without a function name.");
    }

    blocks.push({
      type: "tool_use",
      id:
        typeof toolCall["id"] === "string" && toolCall["id"].trim().length > 0
          ? toolCall["id"]
          : `call_${randomUUID().replace(/-/g, "")}`,
      name,
      input: parseToolArguments(functionRecord?.["arguments"])
    });
  }

  return blocks;
}

function toAnthropicMessage(item: Record<string, unknown>): AnthropicMessage | null {
  if (item["role"] === "tool") {
    const toolUseId = typeof item["tool_call_id"] === "string" ? item["tool_call_id"] : "";

    if (toolUseId.trim().length === 0) {
      throw new UnsupportedTextContentError("Encountered OpenAI tool result without a tool_call_id.");
    }

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: toAnthropicToolResultContent(item["content"])
        }
      ]
    };
  }

  const role = mapMessageRole(item["role"]);

  if (role === "system") {
    return null;
  }

  return {
    role,
    content: role === "assistant" ? toAnthropicAssistantContent(item) : toAnthropicContent(item["content"])
  };
}

function translateOpenAiToolsToAnthropic(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.map((tool) => {
    if (!isObjectLike(tool)) {
      return tool;
    }

    if (typeof tool["name"] === "string" && isObjectLike(tool["input_schema"])) {
      return tool;
    }

    if (tool["type"] !== "function" || !isObjectLike(tool["function"])) {
      return tool;
    }

    const functionDefinition = tool["function"];
    const name = functionDefinition["name"];

    if (typeof name !== "string" || name.trim().length === 0) {
      return tool;
    }

    const translated: Record<string, unknown> = {
      name,
      input_schema: isObjectLike(functionDefinition["parameters"])
        ? functionDefinition["parameters"]
        : { type: "object", properties: {} }
    };

    if (typeof functionDefinition["description"] === "string") {
      translated["description"] = functionDefinition["description"];
    }

    return translated;
  });
}

function translateOpenAiToolChoiceToAnthropic(toolChoice: unknown): ToolChoiceTranslation {
  if (typeof toolChoice === "undefined") {
    return { omitTools: false };
  }

  if (toolChoice === "none") {
    return { omitTools: true };
  }

  if (toolChoice === "auto") {
    return { value: { type: "auto" }, omitTools: false };
  }

  if (toolChoice === "required") {
    return { value: { type: "any" }, omitTools: false };
  }

  if (isObjectLike(toolChoice) && toolChoice["type"] === "function") {
    const functionValue = toolChoice["function"];
    const functionName = isObjectLike(functionValue) ? functionValue["name"] : undefined;

    if (typeof functionName === "string" && functionName.trim().length > 0) {
      return { value: { type: "tool", name: functionName }, omitTools: false };
    }
  }

  return { value: toolChoice, omitTools: false };
}

export function buildAnthropicRequestBodyFromOpenAi(
  parsedBody: Record<string, unknown>,
  upstreamModel: string
): Record<string, unknown> {
  const inputMessages = Array.isArray(parsedBody["messages"]) ? parsedBody["messages"] : [];
  const anthropicMessages: AnthropicMessage[] = [];
  const systemParts: string[] = [];

  for (const item of inputMessages) {
    if (!isObjectLike(item)) {
      continue;
    }

    const role = mapMessageRole(item["role"]);

    if (role === "system") {
      const systemText = normalizeTextContent(toAnthropicContent(item["content"]));

      if (systemText.length > 0) {
        systemParts.push(systemText);
      }

      continue;
    }

    const translatedMessage = toAnthropicMessage(item);

    if (translatedMessage) {
      anthropicMessages.push(translatedMessage);
    }
  }

  if (anthropicMessages.length === 0) {
    throw new AnthropicMessagesRequiredError();
  }

  const body: Record<string, unknown> = {
    model: upstreamModel,
    messages: anthropicMessages,
    max_tokens:
      typeof parsedBody["max_tokens"] === "number"
        ? parsedBody["max_tokens"]
        : typeof parsedBody["max_completion_tokens"] === "number"
          ? parsedBody["max_completion_tokens"]
          : 1024,
    stream: parsedBody["stream"] === true
  };

  if (systemParts.length > 0) {
    body["system"] = systemParts.join("\n\n");
  }

  const passthroughFields = ["temperature", "top_p", "metadata"];

  for (const field of passthroughFields) {
    if (typeof parsedBody[field] !== "undefined") {
      body[field] = parsedBody[field];
    }
  }

  const toolChoice = translateOpenAiToolChoiceToAnthropic(parsedBody["tool_choice"]);
  const tools = translateOpenAiToolsToAnthropic(parsedBody["tools"]);

  if (!toolChoice.omitTools && typeof tools !== "undefined") {
    body["tools"] = tools;
  }

  if (typeof toolChoice.value !== "undefined") {
    body["tool_choice"] = toolChoice.value;
  }

  const stop = parsedBody["stop"];

  if (typeof stop === "string") {
    body["stop_sequences"] = [stop];
  } else if (Array.isArray(stop)) {
    body["stop_sequences"] = stop.filter((item): item is string => typeof item === "string");
  }

  return body;
}
