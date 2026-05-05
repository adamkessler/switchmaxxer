import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { type AppErrorCode as McpErrorCode } from "../../platform/error-codes";
import { sanitizeErrorDetails } from "../../platform/error-detail-sanitizer";

export function sanitizeMcpErrorDetails(details: unknown): Record<string, unknown> | undefined {
  return sanitizeErrorDetails(details);
}

export class McpToolError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export function missingRequiredFieldError(message: string): McpToolError {
  return new McpToolError(MCP_USAGE_ERROR_CODES.missingRequiredField, message);
}

export function invalidInputFieldError(message: string): McpToolError {
  return new McpToolError(MCP_USAGE_ERROR_CODES.invalidInputField, message);
}

export function entityStateError(code: McpErrorCode, message: string): McpToolError {
  return new McpToolError(code, message);
}
