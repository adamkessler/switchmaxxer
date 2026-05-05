import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";
import type { JsonRpcRequest, McpParserState } from "./types";

const MAX_MCP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_MCP_PARSER_BUFFER_BYTES = MAX_MCP_MESSAGE_BYTES + 64 * 1024;
const NEWLINE_BYTE = 0x0a;

export function writeProtocolMessage(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  if (body.includes("\n") || body.includes("\r")) {
    throw new Error("MCP message body must not contain embedded newline characters");
  }
  process.stdout.write(`${body}\n`);
}

export function writeJsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): void {
  writeProtocolMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(typeof data === "undefined" ? {} : { data })
    }
  });
}

export function appendMcpParserChunk(state: McpParserState, chunk: Buffer | string): void {
  const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const nextLength = state.buffer.length + nextChunk.length;

  if (nextLength > MAX_MCP_PARSER_BUFFER_BYTES) {
    throw new Error(`MCP parser buffer exceeded the maximum size of ${MAX_MCP_PARSER_BUFFER_BYTES} bytes`);
  }

  state.buffer = Buffer.concat([state.buffer, nextChunk], nextLength);
}

type JsonRpcProtocolError = {
  code: -32700 | -32600;
  message: string;
};

function isJsonRpcIdCandidate(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
}

function validateJsonRpcRequestEnvelope(value: unknown): JsonRpcRequest {
  if (!isRecord(value)) {
    throw {
      code: -32600,
      message: "Invalid Request"
    } satisfies JsonRpcProtocolError;
  }

  const request = value;
  const allowedKeys = new Set(["jsonrpc", "id", "method", "params"]);

  for (const key of Object.keys(request)) {
    if (!allowedKeys.has(key)) {
      throw {
        code: -32600,
        message: "Invalid Request"
      } satisfies JsonRpcProtocolError;
    }
  }

  if (request["jsonrpc"] !== "2.0") {
    throw {
      code: -32600,
      message: "Invalid Request"
    } satisfies JsonRpcProtocolError;
  }

  const id = request["id"];

  const method = request["method"];
  if (typeof method !== "string" || method.length === 0) {
    throw {
      code: -32600,
      message: "Invalid Request"
    } satisfies JsonRpcProtocolError;
  }

  const params = request["params"];

  const normalizedRequest: JsonRpcRequest = {
    jsonrpc: "2.0",
    method
  };

  if (Object.hasOwn(request, "id")) {
    if (!isJsonRpcIdCandidate(id)) {
      throw {
        code: -32600,
        message: "Invalid Request"
      } satisfies JsonRpcProtocolError;
    }

    normalizedRequest.id = id;
  }

  if (Object.hasOwn(request, "params")) {
    if (!isRecord(params)) {
      throw {
        code: -32600,
        message: "Invalid Request"
      } satisfies JsonRpcProtocolError;
    }

    normalizedRequest.params = Object.assign(Object.create(null), params);
  }

  return normalizedRequest;
}

export function processMcpBuffer(
  state: McpParserState,
  onMessage: (message: JsonRpcRequest) => void | Promise<void>,
  onProtocolError: (error: JsonRpcProtocolError) => void | Promise<void>
): Promise<void> {
  const newlineIndex = state.buffer.indexOf(NEWLINE_BYTE);

  if (newlineIndex === -1) {
    return Promise.resolve();
  }

  let line = state.buffer.subarray(0, newlineIndex);
  state.buffer = state.buffer.subarray(newlineIndex + 1);

  if (line.length > 0 && line[line.length - 1] === 0x0d) {
    line = line.subarray(0, line.length - 1);
  }

  if (line.length > MAX_MCP_MESSAGE_BYTES) {
    throw new Error(`MCP message exceeds the maximum size of ${MAX_MCP_MESSAGE_BYTES} bytes`);
  }

  const body = line.toString("utf8").trim();

  if (body.length === 0) {
    return processMcpBuffer(state, onMessage, onProtocolError);
  }

  let parsedBody: JsonRpcRequest;

  try {
    parsedBody = parseJsonWithinBounds(body, {
      maxSerializedBytes: MAX_MCP_MESSAGE_BYTES
    }) as JsonRpcRequest;
  } catch {
    return Promise.resolve(onProtocolError({ code: -32700, message: "Invalid JSON-RPC message body" })).then(() =>
      processMcpBuffer(state, onMessage, onProtocolError)
    );
  }

  try {
    parsedBody = validateJsonRpcRequestEnvelope(parsedBody);
  } catch (error) {
    const protocolError = error as JsonRpcProtocolError;
    return Promise.resolve(onProtocolError(protocolError)).then(() =>
      processMcpBuffer(state, onMessage, onProtocolError)
    );
  }

  return Promise.resolve(onMessage(parsedBody)).then(() =>
    processMcpBuffer(state, onMessage, onProtocolError)
  );
}
