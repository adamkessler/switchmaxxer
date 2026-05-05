import { type AppErrorCode as McpErrorCode } from "../../platform/error-codes";
import { McpToolError } from "./errors";
import {
  buildSanitizedErrorEnvelope,
  type ErrorEnvelopeOptions,
  type ErrorEnvelope,
  type SuccessEnvelope
} from "../../platform/response-envelope";

export type McpSuccessEnvelope = SuccessEnvelope;
export type McpErrorEnvelope = ErrorEnvelope<McpErrorCode>;

export function buildMcpErrorEnvelope(
  command: string,
  code: McpErrorCode,
  message: string,
  options: ErrorEnvelopeOptions = {}
): McpErrorEnvelope {
  return buildSanitizedErrorEnvelope(command, code, message, options);
}

export function toEnvelopeFromError(
  command: string,
  error: unknown,
  fallbackCode: McpErrorCode,
  fallbackDetails?: unknown
): McpErrorEnvelope {
  if (error instanceof McpToolError) {
    return buildMcpErrorEnvelope(command, error.code, error.message, {
      details: error.details
    });
  }

  const message = error instanceof Error ? error.message : "Unknown MCP error";
  return buildMcpErrorEnvelope(command, fallbackCode, message, {
    details: fallbackDetails
  });
}

export function buildHandledResult(
  command: string,
  fallbackCode: McpErrorCode,
  handler: () => McpSuccessEnvelope | McpErrorEnvelope
): McpSuccessEnvelope | McpErrorEnvelope {
  try {
    return handler();
  } catch (error) {
    return toEnvelopeFromError(command, error, fallbackCode);
  }
}

export function buildHandledPayload(
  command: string,
  fallbackCode: McpErrorCode,
  handler: () => Promise<McpSuccessEnvelope | McpErrorEnvelope> | McpSuccessEnvelope | McpErrorEnvelope
): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  return Promise.resolve(handler()).catch((error) => toEnvelopeFromError(command, error, fallbackCode));
}

export function runParsedMcpTool<TArgs>(
  command: string,
  fallbackCode: McpErrorCode,
  parse: () => TArgs,
  handler: (args: TArgs) => Promise<McpSuccessEnvelope | McpErrorEnvelope> | McpSuccessEnvelope | McpErrorEnvelope
): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  return buildHandledPayload(command, fallbackCode, () => handler(parse()));
}
