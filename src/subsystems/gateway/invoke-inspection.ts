import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import { REDACTED_SECRET } from "../../platform/secret-string";

export const INVOKE_INSPECTION_REQUEST_HEADER = "x-switchmaxxer-inspect";
export const INVOKE_INSPECTION_RESPONSE_HEADER = "x-switchmaxxer-inspect-id";
export const INVOKE_INSPECTION_TOKEN_HEADER = "x-switchmaxxer-inspect-token";
export const INVOKE_INSPECTION_DEFAULT_TTL_MS = 60_000;
export const INVOKE_INSPECTION_MAX_CAPTURE_BYTES = 64 * 1024;
export const INVOKE_INSPECTION_MAX_CAPTURES = 32;
export const INVOKE_INSPECTION_SECRET_REVEAL_ENV = "SWITCHMAXXER_ALLOW_INSPECT_SECRETS";

export type InvokeInspectionHeaders = Record<string, string | string[]>;

export type InvokeInspectionExchange = {
  method?: string;
  url?: string;
  status_code?: number;
  headers: InvokeInspectionHeaders;
  body: string;
  body_truncated: boolean;
};

export type InvokeInspectionCaptureView = {
  id: string;
  created_at: string;
  completed_at: string | null;
  include_secrets: boolean;
  client_to_smx: InvokeInspectionExchange | null;
  smx_to_provider: InvokeInspectionExchange | null;
  provider_to_smx: InvokeInspectionExchange | null;
  smx_to_client: InvokeInspectionExchange | null;
};

export type InvokeInspectionCapture = {
  id: string;
  createdAt: number;
  createdAtIso: string;
  completedAtIso: string | null;
  clientToSmx: InvokeInspectionExchange | null;
  smxToProvider: InvokeInspectionExchange | null;
  providerToSmx: InvokeInspectionExchange | null;
  smxToClient: InvokeInspectionExchange | null;
};

type UnnormalizedInvokeInspectionExchange = Omit<InvokeInspectionExchange, "body" | "body_truncated"> & {
  body: string | Buffer;
};

const captureByRequest = new WeakMap<object, InvokeInspectionCapture>();
const captureByRequestId = new Map<string, InvokeInspectionCapture>();
const requestIdsByCapture = new WeakMap<InvokeInspectionCapture, Set<string>>();

function normalizeHeaderValue(value: string | number | string[] | readonly string[] | undefined): string | string[] | null {
  if (typeof value === "undefined") {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return String(value);
}

function isSecretBearingHeader(name: string): boolean {
  const normalized = name.toLowerCase();

  return (
    normalized === "authorization" ||
    normalized === "proxy-authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "set-cookie2" ||
    normalized === "x-api-key" ||
    normalized.includes("api-key") ||
    normalized.includes("apikey") ||
    normalized.includes("auth") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password")
  );
}

function truncateBody(body: string | Buffer): { body: string; body_truncated: boolean } {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");

  if (buffer.byteLength <= INVOKE_INSPECTION_MAX_CAPTURE_BYTES) {
    return {
      body: buffer.toString("utf8"),
      body_truncated: false
    };
  }

  return {
    body: buffer.subarray(0, INVOKE_INSPECTION_MAX_CAPTURE_BYTES).toString("utf8"),
    body_truncated: true
  };
}

export function normalizeIncomingInspectionHeaders(headers: IncomingHttpHeaders): InvokeInspectionHeaders {
  const normalized: InvokeInspectionHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    const headerValue = normalizeHeaderValue(value);
    if (headerValue !== null) {
      normalized[name.toLowerCase()] = headerValue;
    }
  }

  return normalized;
}

export function normalizeFetchInspectionHeaders(headers: Headers): InvokeInspectionHeaders {
  const normalized: InvokeInspectionHeaders = {};

  for (const [name, value] of headers.entries()) {
    normalized[name.toLowerCase()] = value;
  }

  return normalized;
}

export function normalizeOutgoingInspectionHeaders(headers: OutgoingHttpHeaders): InvokeInspectionHeaders {
  const normalized: InvokeInspectionHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === INVOKE_INSPECTION_TOKEN_HEADER) {
      continue;
    }

    const headerValue = normalizeHeaderValue(value);
    if (headerValue !== null) {
      normalized[name.toLowerCase()] = headerValue;
    }
  }

  return normalized;
}

export function sanitizeInspectionHeaders(
  headers: InvokeInspectionHeaders,
  includeSecrets: boolean,
  options: { alwaysRedactSecretBearingHeaders?: boolean } = {}
): InvokeInspectionHeaders {
  const sanitized: InvokeInspectionHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    const shouldRedactSecretBearingHeader =
      name.toLowerCase() === INVOKE_INSPECTION_TOKEN_HEADER ||
      ((!includeSecrets || options.alwaysRedactSecretBearingHeaders === true) && isSecretBearingHeader(name));
    sanitized[name] = shouldRedactSecretBearingHeader
      ? REDACTED_SECRET
      : Array.isArray(value)
        ? [...value]
        : value;
  }

  return sanitized;
}

function sanitizeExchange(
  exchange: InvokeInspectionExchange | null,
  includeSecrets: boolean,
  options: { alwaysRedactSecretBearingHeaders?: boolean } = {}
): InvokeInspectionExchange | null {
  if (exchange === null) {
    return null;
  }

  return {
    ...exchange,
    headers: sanitizeInspectionHeaders(exchange.headers, includeSecrets, options)
  };
}

export function createInvokeInspectionCapture(id: string, nowMs = Date.now()): InvokeInspectionCapture {
  return {
    id,
    createdAt: nowMs,
    createdAtIso: new Date(nowMs).toISOString(),
    completedAtIso: null,
    clientToSmx: null,
    smxToProvider: null,
    providerToSmx: null,
    smxToClient: null
  };
}

export function attachInvokeInspectionCapture(request: object, capture: InvokeInspectionCapture): void {
  captureByRequest.set(request, capture);
}

export function getInvokeInspectionCaptureForRequest(request: object): InvokeInspectionCapture | null {
  return captureByRequest.get(request) ?? null;
}

export function bindInvokeInspectionCaptureToRequestId(requestId: string, request: object): void {
  const capture = getInvokeInspectionCaptureForRequest(request);
  if (capture !== null) {
    removeRequestIdInspectionBinding(requestId);
    captureByRequestId.set(requestId, capture);

    const requestIds = requestIdsByCapture.get(capture) ?? new Set<string>();
    requestIds.add(requestId);
    requestIdsByCapture.set(capture, requestIds);
  }
}

export function recordClientToSmxInspectionExchange(
  request: object,
  exchange: UnnormalizedInvokeInspectionExchange
): void {
  const capture = getInvokeInspectionCaptureForRequest(request);
  if (capture === null) {
    return;
  }

  capture.clientToSmx = {
    ...exchange,
    ...truncateBody(exchange.body)
  };
}

export function recordSmxToProviderInspectionExchange(
  requestId: string,
  exchange: UnnormalizedInvokeInspectionExchange
): void {
  const capture = captureByRequestId.get(requestId);
  if (capture === undefined) {
    return;
  }

  capture.smxToProvider = {
    ...exchange,
    ...truncateBody(exchange.body)
  };
}

export function recordProviderToSmxInspectionExchange(
  requestId: string,
  exchange: UnnormalizedInvokeInspectionExchange
): void {
  const capture = captureByRequestId.get(requestId);
  if (capture === undefined) {
    return;
  }

  capture.providerToSmx = {
    ...exchange,
    ...truncateBody(exchange.body)
  };
}

export function recordSmxToClientInspectionBody(
  requestId: string,
  statusCode: number,
  body: string | Buffer
): void {
  const capture = captureByRequestId.get(requestId);
  if (capture === undefined) {
    return;
  }

  capture.smxToClient = {
    status_code: statusCode,
    headers: {},
    ...truncateBody(body)
  };
}

export function completeSmxToClientInspectionExchange(
  capture: InvokeInspectionCapture,
  statusCode: number,
  headers: InvokeInspectionHeaders,
  completedAtMs = Date.now()
): void {
  capture.completedAtIso = new Date(completedAtMs).toISOString();
  capture.smxToClient = {
    ...(capture.smxToClient ?? {
      body: "",
      body_truncated: false
    }),
    status_code: statusCode,
    headers
  };
}

export function toInvokeInspectionCaptureView(
  capture: InvokeInspectionCapture,
  includeSecrets: boolean
): InvokeInspectionCaptureView {
  return {
    id: capture.id,
    created_at: capture.createdAtIso,
    completed_at: capture.completedAtIso,
    include_secrets: includeSecrets,
    client_to_smx: sanitizeExchange(capture.clientToSmx, includeSecrets),
    smx_to_provider: sanitizeExchange(capture.smxToProvider, includeSecrets, {
      alwaysRedactSecretBearingHeaders: true
    }),
    provider_to_smx: sanitizeExchange(capture.providerToSmx, includeSecrets),
    smx_to_client: sanitizeExchange(capture.smxToClient, includeSecrets)
  };
}

export function removeRequestIdInspectionBinding(requestId: string): void {
  const capture = captureByRequestId.get(requestId);
  if (typeof capture !== "undefined") {
    const requestIds = requestIdsByCapture.get(capture);
    requestIds?.delete(requestId);
    if (requestIds?.size === 0) {
      requestIdsByCapture.delete(capture);
    }
  }

  captureByRequestId.delete(requestId);
}

export function removeInvokeInspectionCaptureBindings(capture: InvokeInspectionCapture): void {
  const requestIds = requestIdsByCapture.get(capture);
  if (typeof requestIds === "undefined") {
    return;
  }

  for (const requestId of requestIds) {
    if (captureByRequestId.get(requestId) === capture) {
      captureByRequestId.delete(requestId);
    }
  }

  requestIdsByCapture.delete(capture);
}
