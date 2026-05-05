import { ResolvedPrivateEndpointError } from "./provider-endpoint-policy";
import { safeErrorMessage, sanitizeLogValue } from "../../../../platform/logger";
import { isRecord } from "../../../../platform/type-guards";

export type FetchErrorDiagnosticCause = {
  name: string | null;
  message: string | null;
  code: string | null;
  errno: string | number | null;
  syscall: string | null;
  hostname: string | null;
};

export type FetchErrorDiagnostics = {
  error_kind: string;
  error_name: string | null;
  error_message: string | null;
  root_cause_name: string | null;
  root_cause_message: string | null;
  socket_code: string | null;
  socket_errno: string | number | null;
  socket_syscall: string | null;
  socket_hostname: string | null;
  cause_chain: FetchErrorDiagnosticCause[];
};

function getCause(value: unknown): unknown {
  return typeof value === "object" && value !== null && "cause" in value ? (value as { cause?: unknown }).cause ?? null : null;
}

function getCode(value: unknown): string | null {
  if (!isRecord(value) || typeof value["code"] !== "string") {
    return null;
  }

  return value["code"];
}

function getStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value) || !(key in value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? safeErrorMessage(candidate, 512)
    : null;
}

function getStringOrNumberProperty(value: unknown, key: string): string | number | null {
  if (!isRecord(value) || !(key in value)) {
    return null;
  }

  const candidate = value[key];

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  return typeof candidate === "string" && candidate.trim().length > 0
    ? sanitizeLogValue(candidate, 128)
    : null;
}

function collectErrorChain(error: unknown, maxDepth = 8): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  let remaining = maxDepth;

  while (remaining > 0 && current) {
    chain.push(current);

    const cause = getCause(current);

    if (!cause) {
      break;
    }

    current = cause;
    remaining -= 1;
  }

  return chain;
}

function isTimeoutLike(chain: unknown[]): boolean {
  return chain.some(
    (item) => item instanceof Error && (item.name === "TimeoutError" || item.name === "AbortError")
  );
}

function firstCauseWithSocketCode(chain: unknown[]): unknown | null {
  for (const item of chain) {
    if (getCode(item)) {
      return item;
    }
  }

  return null;
}

function buildDiagnosticCause(value: unknown): FetchErrorDiagnosticCause {
  const message = value instanceof Error
    ? safeErrorMessage(value, 512)
    : getStringProperty(value, "message");

  return {
    name: value instanceof Error ? sanitizeLogValue(value.name, 128) : getStringProperty(value, "name"),
    message,
    code: getCode(value),
    errno: getStringOrNumberProperty(value, "errno"),
    syscall: getStringProperty(value, "syscall"),
    hostname: getStringProperty(value, "hostname")
  };
}

function classifyDiagnosticKind(error: unknown, chain: unknown[], socketCode: string | null): string {
  if (error instanceof ResolvedPrivateEndpointError) {
    return "private_endpoint_blocked";
  }

  if (isTimeoutLike(chain)) {
    return "timeout";
  }

  switch (socketCode) {
    case "ENOTFOUND":
      return "dns_not_found";
    case "EAI_AGAIN":
      return "dns_temporary_failure";
    case "ECONNREFUSED":
      return "connection_refused";
    case "ECONNRESET":
      return "connection_reset";
    case "ECONNABORTED":
      return "connection_aborted";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return "connection_timeout";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "tls_certificate_error";
    default:
      return socketCode ? "socket_error" : "fetch_error";
  }
}

export function describeFetchErrorDiagnostics(error: unknown): FetchErrorDiagnostics {
  const chain = collectErrorChain(error);
  const socketCause = firstCauseWithSocketCode(chain);
  const socketCode = socketCause ? getCode(socketCause) : null;
  const rootCause = chain.length > 0 ? chain[chain.length - 1] ?? error : error;
  const rootCauseDetails = buildDiagnosticCause(rootCause);
  const topLevelDetails = buildDiagnosticCause(error);
  const socketDetails = socketCause ? buildDiagnosticCause(socketCause) : null;

  return {
    error_kind: classifyDiagnosticKind(error, chain, socketCode),
    error_name: topLevelDetails.name,
    error_message: topLevelDetails.message,
    root_cause_name: rootCauseDetails.name,
    root_cause_message: rootCauseDetails.message,
    socket_code: socketCode,
    socket_errno: socketDetails?.errno ?? null,
    socket_syscall: socketDetails?.syscall ?? null,
    socket_hostname: socketDetails?.hostname ?? null,
    cause_chain: chain.map((item) => buildDiagnosticCause(item))
  };
}

export class StreamingResponseLimitError extends Error {
  readonly code:
    | "upstream_stream_lifetime_exceeded"
    | "upstream_stream_event_oversized"
    | "upstream_stream_oversized"
    | "upstream_stream_rate_too_low";
  readonly statusCode: number;

  constructor(
    code:
      | "upstream_stream_lifetime_exceeded"
      | "upstream_stream_event_oversized"
      | "upstream_stream_oversized"
      | "upstream_stream_rate_too_low",
    message: string
  ) {
    super(message);
    this.name = "StreamingResponseLimitError";
    this.code = code;
    this.statusCode = 502;
  }
}

export class BufferedResponseLimitError extends Error {
  readonly code: "upstream_response_too_large";
  readonly statusCode: number;

  constructor(maxBytes: number) {
    super(`Upstream response exceeded maxBufferedUpstreamResponseBytes (${maxBytes} bytes).`);
    this.name = "BufferedResponseLimitError";
    this.code = "upstream_response_too_large";
    this.statusCode = 502;
  }
}

export function classifyUpstreamStatus(status: number): string {
  if (status === 401) {
    return "upstream_unauthorized";
  }

  if (status === 403) {
    return "upstream_forbidden";
  }

  if (status === 404) {
    return "upstream_not_found";
  }

  if (status === 408) {
    return "upstream_timeout";
  }

  if (status === 429) {
    return "upstream_rate_limited";
  }

  if (status >= 500) {
    return "upstream_error";
  }

  if (status >= 400) {
    return "upstream_http_error";
  }

  return "upstream_ok";
}

export function classifyFetchError(error: unknown): { statusCode: number; message: string; code: string } {
  if (error instanceof StreamingResponseLimitError || error instanceof BufferedResponseLimitError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code
    };
  }

  if (error instanceof ResolvedPrivateEndpointError) {
    return {
      statusCode: 502,
      message: "Upstream provider endpoint resolved to a private or local address that is not allowed.",
      code: "private_endpoint_resolution_blocked"
    };
  }

  const chain = collectErrorChain(error);

  if (isTimeoutLike(chain)) {
    return {
      statusCode: 504,
      message: "Upstream request timed out",
      code: "upstream_timeout"
    };
  }

  let socketCode: string | null = null;

  for (const item of chain) {
    const candidate = getCode(item);

    if (candidate) {
      socketCode = candidate;
      break;
    }
  }

  if (
    socketCode === "ENOTFOUND" ||
    socketCode === "EAI_AGAIN" ||
    socketCode === "ECONNREFUSED" ||
    socketCode === "ECONNRESET"
  ) {
    return {
      statusCode: 502,
      message: "Could not reach upstream provider",
      code: "upstream_unreachable"
    };
  }

  return {
    statusCode: 502,
    message: "Could not reach upstream provider",
    code: "upstream_unreachable"
  };
}

export function classifyResponseDeliveryError(error: unknown): { statusCode: number; message: string; code: string } {
  if (error instanceof StreamingResponseLimitError || error instanceof BufferedResponseLimitError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code
    };
  }

  return {
    statusCode: 502,
    message: "Could not deliver upstream response",
    code: "response_delivery_failed"
  };
}

export function describeTestFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "Unauthorized - check API key";
  }

  if (status === 404) {
    return "model not found at upstream - check baseUrl and model name";
  }

  if (status === 429) {
    return "rate limited";
  }

  if (status >= 500) {
    return "upstream server error";
  }

  return "unexpected upstream response";
}
