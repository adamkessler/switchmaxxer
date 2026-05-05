import { existsSync } from "node:fs";
import path from "node:path";

import {
  ALL_MCP_TOOL_CAPABILITIES,
  DEFAULT_MCP_TOOL_CAPABILITIES,
  type McpToolCapability
} from "../../platform/mcp-capabilities";
import { buildToolPayload } from "./tool-payload-builder";
import {
  probeGatewayHealthAtHost
} from "./gateway-tools";
import { handleMcpRequestDispatch } from "./dispatch";
import { appendMcpParserChunk, processMcpBuffer, writeJsonRpcError, writeProtocolMessage } from "./protocol";
import {
  DEFAULT_MCP_SESSION_ID,
  abortMcpSessionContext,
  closeMcpSessionContext,
  createMcpSessionContext
} from "./session";
import { formatMcpToolList, getAllowedToolDefinitions, getToolDefinitions, isMcpMutationToolName } from "./tools";
import type { JsonRpcRequest, McpParserState, McpSessionContext } from "./types";
import type { McpToolRuntimeDeps } from "./tool-context";
import { logError } from "../../platform/logger";
import { getPackageVersion } from "../../platform/package-version";
import { loadCliValidatedConfigSnapshot } from "../config/config";
import { resolveBoundedConfigPath } from "../config/read-model";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "switchmaxxer";

type McpCapabilitiesView = {
  source_file: string;
  source_path: string;
  capabilities: McpToolCapability[];
  enabled_tools: string[];
  disabled_tools: string[];
};

export type { McpSessionContext } from "./types";
export { closeMcpSessionContext, createMcpSessionContext } from "./session";

function resolveMcpConfigPath(configPath?: string): string {
  return resolveBoundedConfigPath(configPath, process.cwd());
}

function resolveConfiguredMcpCapabilities(configPath?: string): Set<McpToolCapability> {
  const resolvedConfigPath = resolveMcpConfigPath(configPath);

  if (!existsSync(resolvedConfigPath)) {
    throw new Error(
      `MCP config file is required and must exist at '${resolvedConfigPath}'. Pass --config with an existing config file.`
    );
  }

  const config = loadCliValidatedConfigSnapshot(resolvedConfigPath);
  return new Set(config.mcp?.capabilities ?? DEFAULT_MCP_TOOL_CAPABILITIES);
}

function sortMcpCapabilities(capabilities: Iterable<McpToolCapability>): McpToolCapability[] {
  const granted = new Set(capabilities);
  return ALL_MCP_TOOL_CAPABILITIES.filter((capability) => granted.has(capability));
}

function buildMcpCapabilitiesView(configPath?: string): McpCapabilitiesView {
  const resolvedConfigPath = resolveMcpConfigPath(configPath);
  const grantedCapabilities = resolveConfiguredMcpCapabilities(resolvedConfigPath);
  const allowedTools = getAllowedToolDefinitions({ grantedCapabilities });
  const allowedToolNames = new Set(allowedTools.map((tool) => tool.name));

  return {
    source_file: path.basename(resolvedConfigPath),
    source_path: resolvedConfigPath,
    capabilities: sortMcpCapabilities(grantedCapabilities),
    enabled_tools: allowedTools.map((tool) => tool.name).sort(),
    disabled_tools: getToolDefinitions()
      .map((tool) => tool.name)
      .filter((toolName) => !allowedToolNames.has(toolName))
      .sort()
  };
}

function renderMcpCapabilitiesText(view: McpCapabilitiesView): string {
  return [
    "MCP capabilities",
    `Config: ${view.source_file}`,
    `Config Path: ${view.source_path}`,
    `Granted: ${view.capabilities.join(", ") || "(none)"}`,
    `Enabled Tools: ${view.enabled_tools.length}`,
    formatMcpToolList(view.enabled_tools),
    `Disabled Tools: ${view.disabled_tools.length}`,
    view.disabled_tools.length > 0 ? formatMcpToolList(view.disabled_tools) : "  (none)"
  ].join("\n");
}

function writeMcpStartupCapabilities(view: McpCapabilitiesView): void {
  process.stderr.write(
    [
      `MCP granted capabilities: ${view.capabilities.join(", ") || "(none)"}`,
      `MCP enabled tools: ${view.enabled_tools.length}`,
      `MCP disabled tools: ${view.disabled_tools.length}`,
      `MCP config: ${view.source_path}`
    ].join("\n") + "\n"
  );
}

function resolveConfiguredMcpCapabilitiesForTests(configPath?: string): Set<McpToolCapability> {
  if (typeof configPath === "undefined") {
    return new Set(DEFAULT_MCP_TOOL_CAPABILITIES);
  }

  try {
    return resolveConfiguredMcpCapabilities(configPath);
  } catch {
    return new Set(DEFAULT_MCP_TOOL_CAPABILITIES);
  }
}

export async function probeGatewayHealthAtHostForTests(
  bindHost: string,
  port: number,
  timeoutMs = 3000
): Promise<{ running: boolean; reason?: string; pid?: number; latency_ms?: number; probe_host: string }> {
  return await probeGatewayHealthAtHost(bindHost, port, timeoutMs);
}


async function handleRequest(
  request: JsonRpcRequest,
  configPath?: string,
  sessionContext?: McpSessionContext,
  runtimeDeps?: McpToolRuntimeDeps
): Promise<{ isNotification: boolean; response?: Record<string, unknown> }> {
  const resolvedConfigPath = typeof configPath === "undefined" ? undefined : resolveMcpConfigPath(configPath);
  return await handleMcpRequestDispatch(request, {
    configPath: resolvedConfigPath,
    sessionContext,
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverName: SERVER_NAME,
    serverVersion: getPackageVersion(),
    buildToolPayload: (toolName, params, toolConfigPath, toolSessionContext) =>
      buildToolPayload(toolName, params, toolConfigPath, toolSessionContext, runtimeDeps)
  });
}

export function handleMcpRequestForTests(
  request: JsonRpcRequest,
  configPath?: string,
  sessionContext?: McpSessionContext,
  runtimeDeps?: McpToolRuntimeDeps
): Promise<{ isNotification: boolean; response?: Record<string, unknown> }> {
  if (sessionContext) {
    return handleRequest(request, configPath, sessionContext, runtimeDeps);
  }

  const temporarySessionContext = createMcpSessionContext(
    DEFAULT_MCP_SESSION_ID,
    resolveConfiguredMcpCapabilitiesForTests(configPath)
  );
  return handleRequest(request, configPath, temporarySessionContext, runtimeDeps).finally(() => {
    closeMcpSessionContext(temporarySessionContext);
  });
}

export function appendMcpParserChunkForTests(state: { buffer: Buffer }, chunk: Buffer | string): void {
  appendMcpParserChunk(state, chunk);
}

export function processMcpBufferForTests(
  state: { buffer: Buffer },
  onMessage: (message: JsonRpcRequest) => void | Promise<void>,
  onProtocolError: (error: { code: -32700 | -32600; message: string }) => void | Promise<void>
): Promise<void> {
  return processMcpBuffer(state, onMessage, onProtocolError);
}

function parseMcpServeArgs(argv: string[]): {
  configPath?: string;
  errorMessage?: string;
} {
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--config") {
      const nextArg = argv[index + 1];

      if (!nextArg || nextArg.startsWith("-")) {
        return { configPath, errorMessage: "Flag '--config' requires a value" };
      }

      configPath = nextArg;
      index += 1;
      continue;
    }

    return { configPath, errorMessage: `Unknown flag '${arg}'` };
  }

  return { configPath };
}

function parseMcpCapabilitiesArgs(argv: string[]): {
  configPath?: string;
  json: boolean;
  errorMessage?: string;
} {
  let configPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1];

      if (!nextArg || nextArg.startsWith("-")) {
        return { configPath, json, errorMessage: "Flag '--config' requires a value" };
      }

      configPath = nextArg;
      index += 1;
      continue;
    }

    return { configPath, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { configPath, json };
}

export function getMcpHelpText(): string {
  const toolDefinitions = getToolDefinitions();
  const mutationTools = toolDefinitions
    .map((tool) => tool.name)
    .filter((toolName) => isMcpMutationToolName(toolName));
  const readOnlyTools = toolDefinitions
    .map((tool) => tool.name)
    .filter((toolName) => !isMcpMutationToolName(toolName));

  return `switchmaxxer mcp

Usage:
  switchmaxxer mcp serve [--config <path>]
  switchmaxxer mcp capabilities [--config <path>] [--json]

Description:
  Runs the first real Switchmaxxer MCP server over stdio.

Current v1 MCP slice:
  serve
  capabilities

Current supported MCP methods:
  initialize
  ping
  tools/list
  tools/call

Current supported MCP tools:
${formatMcpToolList(readOnlyTools)}

Current supported MCP mutation tools:
${formatMcpToolList(mutationTools)}

Notes:
  Tool results return the same machine-facing envelopes used by the CLI JSON surfaces.
  Tool failures use isError: true with ok: false and a stable error.code in the envelope.
  Mutation tools use structured arguments instead of CLI flag parsing.
  bench_run and latency optimize_run have a 15-minute wall-clock cap by default; override with SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS.
  MCP tool envelopes intentionally use the matching CLI command names for cross-surface parity, so command is not an origin marker.
  The invoke surface is intentionally CLI-only; MCP clients must not originate live model invocations.
  Secrets are never exposed raw through providers_show; api_key is masked.

Examples:
  switchmaxxer mcp serve
  switchmaxxer mcp serve --config ./config.json
  switchmaxxer mcp capabilities --config ./config.json --json

Docs:
  docs/subsystems/mcp/how-to-launch-switchmaxxer-mcp.md

Pro tip:
  smx mcp serve is the official short operator alias form.
`;
}

export async function runMcpCapabilities(
  argv: string[],
  deps: {
    writeStdout: (message: string) => void;
    writeJsonSuccessEnvelope: (command: string, data: unknown) => void;
    printUsageError: (message: string) => void;
  }
): Promise<number> {
  const parsedArgs = parseMcpCapabilitiesArgs(argv);

  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  try {
    const view = buildMcpCapabilitiesView(parsedArgs.configPath);

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("mcp capabilities", view);
    } else {
      deps.writeStdout(renderMcpCapabilitiesText(view));
    }

    return 0;
  } catch (error) {
    deps.printUsageError((error as Error).message);
    return 2;
  }
}

export async function runMcpServe(argv: string[], runtimeDeps?: McpToolRuntimeDeps): Promise<number> {
  const parsedArgs = parseMcpServeArgs(argv);

  if (parsedArgs.errorMessage) {
    logError(`Error: ${parsedArgs.errorMessage}`);
    return 2;
  }

  let resolvedConfigPath: string | undefined;
  try {
    resolvedConfigPath = resolveMcpConfigPath(parsedArgs.configPath);
  } catch (error) {
    logError(`Error: ${(error as Error).message}`);
    return 2;
  }

  const parserState: McpParserState = {
    buffer: Buffer.alloc(0)
  };
  let sessionContext: McpSessionContext;
  try {
    const capabilitiesView = buildMcpCapabilitiesView(resolvedConfigPath);
    writeMcpStartupCapabilities(capabilitiesView);
    sessionContext = createMcpSessionContext("stdio", capabilitiesView.capabilities);
  } catch (error) {
    logError(`Error: ${(error as Error).message}`);
    return 2;
  }
  let hasSeenInput = false;
  let finished = false;
  let processingQueue: Promise<void> = Promise.resolve();
  const keepAliveTimer = setInterval(() => {}, 1 << 30);

  return await new Promise<number>((resolve) => {
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      closeMcpSessionContext(sessionContext);
      clearInterval(keepAliveTimer);
      resolve(0);
    };

    const flushAndFinish = () => {
      if (!hasSeenInput && !process.stdin.isTTY) {
        return;
      }

      abortMcpSessionContext(sessionContext, new Error("MCP client disconnected"));

      processingQueue.then(
        () => finish(),
        () => finish()
      );
    };

    process.stdin.on("data", (chunk: Buffer | string) => {
      if (finished) {
        return;
      }

      hasSeenInput = true;

      processingQueue = processingQueue.then(async () => {
        try {
          appendMcpParserChunk(parserState, chunk);

          await processMcpBuffer(
            parserState,
            async (message) => {
              const handled = await handleRequest(message, resolvedConfigPath, sessionContext, runtimeDeps);

              if (!handled.isNotification && handled.response) {
                writeProtocolMessage(handled.response);
              }
            },
            async (error) => {
              writeJsonRpcError(null, error.code, error.message);
            }
          );
        } catch (error) {
          parserState.buffer = Buffer.alloc(0);
          const message = error instanceof Error ? error.message : "Unknown MCP framing error";
          writeJsonRpcError(null, -32700, message);
          process.stdin.pause();
          finish();
        }
      });
    });

    const maybeFinish = () => {
      flushAndFinish();
    };

    process.stdin.on("end", maybeFinish);
    process.stdin.on("close", maybeFinish);
    process.stdin.resume();
  });
}
