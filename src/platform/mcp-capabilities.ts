export const ALL_MCP_TOOL_CAPABILITIES = ["read", "mutation", "privileged"] as const;
export const DEFAULT_MCP_TOOL_CAPABILITIES = ["read"] as const;

export type McpToolCapability = typeof ALL_MCP_TOOL_CAPABILITIES[number];
