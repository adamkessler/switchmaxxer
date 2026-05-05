import {
  closeObservabilityServiceHandle,
  openExistingObservabilityService,
  openObservabilityService,
  type ObservabilityRuntimeHandle
} from "../observability/runtime-loader";
import { DEFAULT_MCP_TOOL_CAPABILITIES, type McpToolCapability } from "../../platform/mcp-capabilities";
import type { McpSessionContext } from "./types";

type McpSessionState = {
  observabilityHandle: ObservabilityRuntimeHandle | null;
  observabilityHandleDbPath: string | null;
  observabilityStoreKnownMissing: boolean;
  abortController: AbortController;
};

export const DEFAULT_MCP_SESSION_ID = "stdio";

const sessionStateById = new Map<string, McpSessionState>();

function getOrCreateSessionState(sessionId: string): McpSessionState {
  const existing = sessionStateById.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: McpSessionState = {
    observabilityHandle: null,
    observabilityHandleDbPath: null,
    observabilityStoreKnownMissing: false,
    abortController: new AbortController()
  };
  sessionStateById.set(sessionId, created);
  return created;
}

function syncContextFromState(sessionContext: McpSessionContext, state: McpSessionState): void {
  sessionContext.observabilityHandle = state.observabilityHandle;
  sessionContext.observabilityHandleDbPath = state.observabilityHandleDbPath;
  sessionContext.observabilityStoreKnownMissing = state.observabilityStoreKnownMissing;
  sessionContext.abortSignal = state.abortController.signal;
}

function cloneGrantedCapabilities(
  grantedCapabilities: Iterable<McpToolCapability> = DEFAULT_MCP_TOOL_CAPABILITIES
): Set<McpToolCapability> {
  return new Set(grantedCapabilities);
}

export function createMcpSessionContext(
  sessionId = DEFAULT_MCP_SESSION_ID,
  grantedCapabilities: Iterable<McpToolCapability> = DEFAULT_MCP_TOOL_CAPABILITIES
): McpSessionContext {
  const state = getOrCreateSessionState(sessionId);
  return {
    sessionId,
    observabilityHandle: state.observabilityHandle,
    observabilityHandleDbPath: state.observabilityHandleDbPath,
    observabilityStoreKnownMissing: state.observabilityStoreKnownMissing,
    grantedCapabilities: cloneGrantedCapabilities(grantedCapabilities),
    abortSignal: state.abortController.signal
  };
}

export function abortMcpSessionContext(
  sessionContext: McpSessionContext,
  reason: unknown = new Error("MCP session disconnected")
): void {
  const sessionState = sessionStateById.get(sessionContext.sessionId);
  const controller = sessionState?.abortController;
  if (controller && !controller.signal.aborted) {
    controller.abort(reason);
  }

  sessionContext.abortSignal = controller?.signal ?? AbortSignal.abort(reason);
}

export function getSessionObservabilityHandle(
  sessionContext: McpSessionContext | undefined,
  dbPath: string,
  options: { createIfMissing: boolean }
): ObservabilityRuntimeHandle | null {
  if (!sessionContext) {
    return options.createIfMissing ? openObservabilityService(dbPath) : openExistingObservabilityService(dbPath);
  }

  const sessionState = getOrCreateSessionState(sessionContext.sessionId);

  if (sessionState.observabilityHandle && sessionState.observabilityHandleDbPath === dbPath) {
    syncContextFromState(sessionContext, sessionState);
    return sessionState.observabilityHandle;
  }

  if (!options.createIfMissing && sessionState.observabilityHandleDbPath === dbPath && sessionState.observabilityStoreKnownMissing) {
    syncContextFromState(sessionContext, sessionState);
    return null;
  }

  if (options.createIfMissing) {
    sessionState.observabilityHandle = openObservabilityService(dbPath);
    sessionState.observabilityHandleDbPath = dbPath;
    sessionState.observabilityStoreKnownMissing = false;
    syncContextFromState(sessionContext, sessionState);
    return sessionState.observabilityHandle;
  }

  const handle = openExistingObservabilityService(dbPath);
  if (!handle) {
    sessionState.observabilityHandle = null;
    sessionState.observabilityHandleDbPath = dbPath;
    sessionState.observabilityStoreKnownMissing = true;
    syncContextFromState(sessionContext, sessionState);
    return null;
  }

  sessionState.observabilityHandle = handle;
  sessionState.observabilityHandleDbPath = dbPath;
  sessionState.observabilityStoreKnownMissing = false;
  syncContextFromState(sessionContext, sessionState);
  return handle;
}

export function closeMcpSessionContext(sessionContext: McpSessionContext): void {
  abortMcpSessionContext(sessionContext, new Error("MCP session closed"));
  const sessionState = sessionStateById.get(sessionContext.sessionId);
  if (sessionState?.observabilityHandle) {
    closeObservabilityServiceHandle(sessionState.observabilityHandle);
  }
  sessionStateById.delete(sessionContext.sessionId);
  sessionContext.observabilityHandle = null;
  sessionContext.observabilityHandleDbPath = null;
  sessionContext.observabilityStoreKnownMissing = false;
  sessionContext.grantedCapabilities = cloneGrantedCapabilities(sessionContext.grantedCapabilities);
}
