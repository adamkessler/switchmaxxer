import { logWarning } from "../../platform/logger";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { McpToolError } from "./errors";
import { getRequiredToolString } from "./parsers";
import {
  getAllowedToolDefinitions,
  getToolDefinition,
  getToolEnvelopeCommand,
  isMcpMutationToolName,
  sessionCanCallTool,
  validateToolArguments
} from "./tools";
import type { JsonRpcRequest, McpSessionContext } from "./types";
import { type ErrorEnvelope, type SuccessEnvelope } from "../../platform/response-envelope";
import { buildMcpErrorEnvelope } from "./envelope";

type McpSuccessEnvelope = SuccessEnvelope;
type McpErrorEnvelope = ErrorEnvelope;

export type McpRequestDispatchResult = {
  isNotification: boolean;
  response?: Record<string, unknown>;
};

type McpToolPayloadBuilder = (
  toolName: string,
  params: unknown,
  configPath?: string,
  sessionContext?: McpSessionContext
) => Promise<McpSuccessEnvelope | McpErrorEnvelope>;

export type McpDispatchOptions = {
  configPath?: string;
  sessionContext?: McpSessionContext;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  buildToolPayload: McpToolPayloadBuilder;
};

const GENERIC_MCP_TOOL_EXECUTION_FAILURE_MESSAGE = "Tool execution failed: see server logs for details.";

function buildInvalidRequestResponse(id: string | number | null): McpRequestDispatchResult {
  return {
    isNotification: false,
    response: {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32600,
        message: "Invalid Request"
      }
    }
  };
}

export async function handleMcpRequestDispatch(
  request: JsonRpcRequest,
  options: McpDispatchOptions
): Promise<McpRequestDispatchResult> {
  const idIsPresent = Object.hasOwn(request, "id");
  if (idIsPresent && request.id !== null && typeof request.id !== "string" && typeof request.id !== "number") {
    return buildInvalidRequestResponse(null);
  }

  const allowedKeys = new Set(["jsonrpc", "id", "method", "params"]);
  for (const key of Object.keys(request)) {
    if (!allowedKeys.has(key)) {
      return buildInvalidRequestResponse(null);
    }
  }

  if (request.jsonrpc !== "2.0") {
    return buildInvalidRequestResponse(null);
  }

  const isNotification = !Object.hasOwn(request, "id") || typeof request.id === "undefined";
  const id = typeof request.id === "undefined" ? null : request.id;
  const method = request.method;

  if (!method) {
    return buildInvalidRequestResponse(id);
  }

  if (method === "notifications/initialized") {
    return { isNotification: true };
  }

  if (method === "ping") {
    return {
      isNotification: false,
      response: {
        jsonrpc: "2.0",
        id,
        result: {}
      }
    };
  }

  if (method === "initialize") {
    return {
      isNotification: false,
      response: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: options.protocolVersion,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: options.serverName,
            version: options.serverVersion
          }
        }
      }
    };
  }

  if (method === "tools/list") {
    return {
      isNotification: false,
      response: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: getAllowedToolDefinitions(options.sessionContext)
        }
      }
    };
  }

  if (method === "tools/call") {
    let toolName: string;
    try {
      toolName = getRequiredToolString(request.params, "name", "tools/call");
    } catch {
      return {
        isNotification: false,
        response: {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Missing required tool name"
          }
        }
      };
    }

    try {
      const toolDefinition = getToolDefinition(toolName);
      if (!toolDefinition) {
        if (isNotification) {
          return buildInvalidRequestResponse(null);
        }

        const payload = buildMcpErrorEnvelope(
          getToolEnvelopeCommand(toolName),
          APP_ERROR_CODES.toolNotFound,
          `Unknown MCP tool '${toolName}'`
        );
        return {
          isNotification: false,
          response: {
            jsonrpc: "2.0",
            id,
            result: toToolResult(payload, true)
          }
        };
      }

      if (!sessionCanCallTool(toolDefinition, options.sessionContext)) {
        const payload = buildMcpErrorEnvelope(
          getToolEnvelopeCommand(toolName),
          APP_ERROR_CODES.unsupported,
          `MCP session is not authorized to call '${toolName}'.`
        );
        return {
          isNotification: false,
          response: {
            jsonrpc: "2.0",
            id,
            result: toToolResult(payload, true)
          }
        };
      }

      if (isNotification && isMcpMutationToolName(toolName)) {
        return buildInvalidRequestResponse(null);
      }

      if (
        typeof request.params?.["arguments"] !== "undefined" &&
        (typeof request.params["arguments"] !== "object" ||
          request.params["arguments"] === null ||
          Array.isArray(request.params["arguments"]))
      ) {
        const payload = buildMcpErrorEnvelope(
          getToolEnvelopeCommand(toolName),
          APP_ERROR_CODES.invalidToolInput,
          "Tool arguments must be a JSON object when provided"
        );
        return {
          isNotification: false,
          response: {
            jsonrpc: "2.0",
            id,
            result: toToolResult(payload, true)
          }
        };
      }

      const args: unknown = typeof request.params?.["arguments"] === "undefined" ? {} : request.params["arguments"];
      const validationError = validateToolArguments(toolDefinition, args);
      if (validationError) {
        const payload = buildMcpErrorEnvelope(getToolEnvelopeCommand(toolName), validationError.code, validationError.message);
        return {
          isNotification: false,
          response: {
            jsonrpc: "2.0",
            id,
            result: toToolResult(payload, true)
          }
        };
      }

      const payload = await options.buildToolPayload(toolName, args, options.configPath, options.sessionContext);

      return {
        isNotification,
        response: isNotification
          ? undefined
          : {
              jsonrpc: "2.0",
              id,
              result: toToolResult(payload, payload.ok === false)
            }
      };
    } catch (error) {
      const payload =
        error instanceof McpToolError
          ? buildMcpErrorEnvelope(getToolEnvelopeCommand(toolName), error.code, error.message, {
              details: error.details
            })
          : (() => {
              const detail = error instanceof Error ? error.message : "Unknown MCP tool execution error";
              logWarning(`MCP tool '${toolName}' failed: ${detail}`);
              return buildMcpErrorEnvelope(
                "mcp tool call",
                APP_ERROR_CODES.toolExecutionError,
                GENERIC_MCP_TOOL_EXECUTION_FAILURE_MESSAGE
              );
            })();

      return {
        isNotification: false,
        response: {
          jsonrpc: "2.0",
          id,
          result: toToolResult(payload, true)
        }
      };
    }
  }

  if (isNotification) {
    return { isNotification: true };
  }

  return {
    isNotification: false,
    response: {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`
      }
    }
  };
}

function toToolResult(payload: unknown, isError = false): Record<string, unknown> {
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent: payload,
    ...(isError ? { isError: true } : {})
  };
}
