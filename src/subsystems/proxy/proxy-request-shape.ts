import { safeJsonStringifyWithinBounds } from "../../platform/json-bounds";
import { isObjectLike } from "../../platform/type-guards";
import { type ProxyDebugIngressSummary } from "./proxy-logging";
import { UnsupportedTextContentError, normalizeTextContent } from "./proxy-translation";

function countMessages(messages: unknown): number {
  return Array.isArray(messages) ? messages.filter((item) => typeof item === "object" && item !== null).length : 0;
}

function hasOpenAiSystemMessage(messages: unknown): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.some((item) => {
    if (!isObjectLike(item)) {
      return false;
    }

    return item["role"] === "system";
  });
}

export function buildRequestShapeSummary(
  parsedBody: Record<string, unknown>,
  apiSurface: "openai" | "anthropic"
): ProxyDebugIngressSummary {
  if (apiSurface === "anthropic") {
    const systemValue = typeof parsedBody["system"] === "string" ? parsedBody["system"] : "";
    const messageCount = countMessages(parsedBody["messages"]);

    return {
      messageCount,
      hasSystemMessage: systemValue.trim().length > 0,
      promptChars: systemValue.length,
      toolCount: Array.isArray(parsedBody["tools"]) ? parsedBody["tools"].length : 0,
      hasMetadata: typeof parsedBody["metadata"] === "object" && parsedBody["metadata"] !== null,
      maxTokens: typeof parsedBody["max_tokens"] === "number" ? parsedBody["max_tokens"] : null,
      temperature: typeof parsedBody["temperature"] === "number" ? parsedBody["temperature"] : null
    };
  }

  const messages = Array.isArray(parsedBody["messages"]) ? parsedBody["messages"] : [];
  const promptChars = messages.reduce((total, item) => {
    if (!isObjectLike(item)) {
      return total;
    }

    try {
      return total + normalizeTextContent(item["content"]).length;
    } catch (error) {
      if (error instanceof UnsupportedTextContentError) {
        return total;
      }

      throw error;
    }
  }, 0);

  return {
    messageCount: countMessages(messages),
    hasSystemMessage: hasOpenAiSystemMessage(messages),
    promptChars,
    toolCount: Array.isArray(parsedBody["tools"]) ? parsedBody["tools"].length : 0,
    hasMetadata: typeof parsedBody["metadata"] === "object" && parsedBody["metadata"] !== null,
    maxTokens:
      typeof parsedBody["max_tokens"] === "number"
        ? parsedBody["max_tokens"]
        : typeof parsedBody["max_completion_tokens"] === "number"
          ? parsedBody["max_completion_tokens"]
          : null,
    temperature: typeof parsedBody["temperature"] === "number" ? parsedBody["temperature"] : null
  };
}

export function buildPatchedJsonBody(
  rawBody: string,
  parsedBody: Record<string, unknown>,
  updatedFields: Record<string, unknown>,
  options: {
    maxSerializedBytes?: number;
  } = {}
): string {
  let changed = false;

  for (const [key, value] of Object.entries(updatedFields)) {
    if (parsedBody[key] !== value) {
      changed = true;
      break;
    }
  }

  if (!changed) {
    return rawBody;
  }

  return safeJsonStringifyWithinBounds(
    {
      ...parsedBody,
      ...updatedFields
    },
    options
  );
}
