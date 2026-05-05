import { assertNoReservedObjectKeysDeep } from "../../../../platform/object-key-policy";
import { isObjectLike } from "../../../../platform/type-guards";

export interface GatewayOpenAiChatRequestBody extends Record<string, unknown> {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Record<string, unknown> | null;
  tools?: unknown[];
  tool_choice?: unknown;
  stop?: string | string[];
}

export interface GatewayAnthropicMessagesRequestBody extends Record<string, unknown> {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Record<string, unknown> | null;
  tools?: unknown[];
  tool_choice?: unknown;
  stop_sequences?: string[];
}

export type GatewayProxyRequestBody =
  | {
      apiSurface: "openai";
      body: GatewayOpenAiChatRequestBody;
    }
  | {
      apiSurface: "anthropic";
      body: GatewayAnthropicMessagesRequestBody;
    };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertOptionalString(value: unknown, fieldName: string): void {
  if (typeof value !== "undefined" && typeof value !== "string") {
    throw new Error(`field '${fieldName}' must be a string`);
  }
}

function assertOptionalNumber(value: unknown, fieldName: string): void {
  if (typeof value !== "undefined" && typeof value !== "number") {
    throw new Error(`field '${fieldName}' must be a number`);
  }
}

function assertOptionalBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== "undefined" && typeof value !== "boolean") {
    throw new Error(`field '${fieldName}' must be a boolean`);
  }
}

function assertOptionalArray(value: unknown, fieldName: string): void {
  if (typeof value !== "undefined" && !Array.isArray(value)) {
    throw new Error(`field '${fieldName}' must be an array`);
  }
}

function assertOptionalObjectOrNull(value: unknown, fieldName: string): void {
  if (typeof value === "undefined" || value === null) {
    return;
  }

  if (!isObjectLike(value) || Array.isArray(value)) {
    throw new Error(`field '${fieldName}' must be an object or null`);
  }
}

function validateOpenAiChatRequestBody(
  body: Record<string, unknown>
): GatewayOpenAiChatRequestBody {
  assertOptionalString(body["model"], "model");
  assertOptionalArray(body["messages"], "messages");
  assertOptionalBoolean(body["stream"], "stream");
  assertOptionalNumber(body["max_tokens"], "max_tokens");
  assertOptionalNumber(body["max_completion_tokens"], "max_completion_tokens");
  assertOptionalNumber(body["temperature"], "temperature");
  assertOptionalNumber(body["top_p"], "top_p");
  assertOptionalObjectOrNull(body["metadata"], "metadata");
  assertOptionalArray(body["tools"], "tools");

  const stop = body["stop"];
  if (typeof stop !== "undefined" && typeof stop !== "string" && !isStringArray(stop)) {
    throw new Error("field 'stop' must be a string or string[]");
  }

  return body as GatewayOpenAiChatRequestBody;
}

function validateAnthropicMessagesRequestBody(
  body: Record<string, unknown>
): GatewayAnthropicMessagesRequestBody {
  assertOptionalString(body["model"], "model");
  assertOptionalArray(body["messages"], "messages");
  assertOptionalBoolean(body["stream"], "stream");
  assertOptionalString(body["system"], "system");
  assertOptionalNumber(body["max_tokens"], "max_tokens");
  assertOptionalNumber(body["temperature"], "temperature");
  assertOptionalNumber(body["top_p"], "top_p");
  assertOptionalObjectOrNull(body["metadata"], "metadata");
  assertOptionalArray(body["tools"], "tools");

  const stopSequences = body["stop_sequences"];
  if (typeof stopSequences !== "undefined" && !isStringArray(stopSequences)) {
    throw new Error("field 'stop_sequences' must be a string[]");
  }

  return body as GatewayAnthropicMessagesRequestBody;
}

export function validateGatewayProxyRequestBody(
  body: Record<string, unknown>,
  apiSurface: "openai" | "anthropic"
): GatewayProxyRequestBody {
  assertNoReservedObjectKeysDeep(body, "gateway request body");

  if (apiSurface === "anthropic") {
    return {
      apiSurface,
      body: validateAnthropicMessagesRequestBody(body)
    };
  }

  return {
    apiSurface,
    body: validateOpenAiChatRequestBody(body)
  };
}
