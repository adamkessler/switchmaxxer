import type { ObservabilityRuntimeHandle } from "../observability/runtime-loader";
import type { McpToolCapability } from "../../platform/mcp-capabilities";

export type { McpToolCapability } from "../../platform/mcp-capabilities";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  capability: McpToolCapability;
  inputSchema: Record<string, unknown>;
};

export type ToolInputSchema = {
  type?: string | string[];
  additionalProperties?: boolean;
  properties?: Record<string, ToolInputSchema>;
  required?: string[];
  oneOf?: ToolInputSchema[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  items?: ToolInputSchema;
};

export interface McpSessionContext {
  sessionId: string;
  observabilityHandle: ObservabilityRuntimeHandle | null;
  observabilityHandleDbPath: string | null;
  observabilityStoreKnownMissing: boolean;
  grantedCapabilities: Set<McpToolCapability>;
  abortSignal: AbortSignal;
}

export type McpParserState = {
  buffer: Buffer;
};
