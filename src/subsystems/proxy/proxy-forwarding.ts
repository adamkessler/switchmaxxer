import type { IncomingHttpHeaders } from "node:http";
import type { Writable } from "node:stream";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import {
  fetchStreamingWithSwitchmaxxerTransport,
  fetchWithSwitchmaxxerTransport,
  type SwitchmaxxerRetryAttemptDetails
} from "./http-transport";
import { isDebugLoggingEnabled, logDebug, logLine, sanitizeLogValue } from "../../platform/logger";
import { recordGatewayObservation } from "../observability/gateway";
import { assertResolvedProviderEndpointPolicy } from "./provider-endpoint-policy";
import { getOrAssignRequestId } from "../../platform/request-id";
import {
  logDebugClientResponse,
  logDebugErrorContext,
  logError,
  logUpstreamResponse,
  safeLogField
} from "./proxy-logging";
import { ProviderAuthMisconfiguredError } from "../config/provider-auth";
import { apiModeFromSurface, type AppConfig, type ErrorBody, type ProxyRequestContext, type RouteConfig } from "../../platform/types";
import { classifyUpstreamStatus } from "./proxy-error-classification";
import { recordSmxToClientInspectionBody } from "../gateway/invoke-inspection";

const MAX_CALLER_DISPLAY_LABEL_LENGTH = 128;

export interface ProxyRequestLike {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  socket: {
    remoteAddress?: string;
  };
}

export interface ProxyResponseLike extends Writable {
  statusCode: number;
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  removeHeader(name: string): void;
}

function buildErrorBody(message: string, code: string): ErrorBody {
  return {
    error: {
      message,
      type: "switchmaxxer_error",
      code
    }
  };
}

export function sendJsonError(
  response: ProxyResponseLike,
  statusCode: number,
  message: string,
  code: string
): void {
  // Intentionally do not reuse the CLI/MCP success/error envelope here.
  // The proxy surface is a client-facing API compatibility surface, so its
  // JSON error body must stay in the `{ error: ... }` shape expected by SDKs
  // and model clients.
  const body = `${JSON.stringify(buildErrorBody(message, code))}\n`;
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

function getResponseSafeRouteHint(bareModel: string): string {
  return safeLogField(bareModel, 128) || "unknown";
}

export function getCallerDisplayLabel(request: ProxyRequestLike): string {
  const headers = request.headers;
  const explicitCaller =
    headerValue(headers["x-switchmaxxer-caller"]) ??
    headerValue(headers["x-switchmaxxer-client"]) ??
    headerValue(headers["x-client-name"]);

  if (explicitCaller) {
    return sanitizeLogValue(explicitCaller, MAX_CALLER_DISPLAY_LABEL_LENGTH);
  }

  return sanitizeLogValue(request.socket.remoteAddress ?? "unknown", MAX_CALLER_DISPLAY_LABEL_LENGTH);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }

  const resolved = Array.isArray(value) ? value[0] : value;
  if (typeof resolved !== "string") {
    return null;
  }
  const trimmed = resolved.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function forwardUpstreamRequestWithMode(
  upstreamUrl: string,
  allowPrivateEndpoints: boolean,
  headers: Headers,
  body: string,
  mode: "buffered" | "streaming",
  timeoutMs: number,
  onRetry?: (details: SwitchmaxxerRetryAttemptDetails) => void,
  fetchImpl?: typeof fetch
): Promise<Response> {
  const transport = mode === "streaming" ? fetchStreamingWithSwitchmaxxerTransport : fetchWithSwitchmaxxerTransport;

  const pinnedDnsResolution = await assertResolvedProviderEndpointPolicy(new URL(upstreamUrl), {
    allowPrivateEndpoints
  });

  return transport(upstreamUrl, {
    method: "POST",
    headers,
    body
  }, {
    timeoutMs,
    retry: {
      maxRetries: 0,
      onRetry
    },
    pinnedDnsResolution,
    fetchImpl
  });
}

export async function forwardUpstreamRequest(
  upstreamUrl: string,
  allowPrivateEndpoints: boolean,
  headers: Headers,
  body: string,
  timeoutMs: number,
  onRetry?: (details: SwitchmaxxerRetryAttemptDetails) => void,
  fetchImpl?: typeof fetch
): Promise<Response> {
  return forwardUpstreamRequestWithMode(
    upstreamUrl,
    allowPrivateEndpoints,
    headers,
    body,
    "buffered",
    timeoutMs,
    onRetry,
    fetchImpl
  );
}

export async function forwardStreamingUpstreamRequest(
  upstreamUrl: string,
  allowPrivateEndpoints: boolean,
  headers: Headers,
  body: string,
  timeoutMs: number,
  onRetry?: (details: SwitchmaxxerRetryAttemptDetails) => void,
  fetchImpl?: typeof fetch
): Promise<Response> {
  return forwardUpstreamRequestWithMode(
    upstreamUrl,
    allowPrivateEndpoints,
    headers,
    body,
    "streaming",
    timeoutMs,
    onRetry,
    fetchImpl
  );
}

export function createContext(
  request: ProxyRequestLike,
  parsedBody: Record<string, unknown>,
  apiSurface: "openai" | "anthropic"
): ProxyRequestContext {
  const context = {
    requestId: getOrAssignRequestId(request as object),
    caller: getCallerDisplayLabel(request),
    bareModel: typeof parsedBody["model"] === "string" ? parsedBody["model"] : "",
    stream: parsedBody["stream"] === true,
    apiMode: apiModeFromSurface(apiSurface),
    requestStartedAt: Date.now()
  };

  recordGatewayObservation({
    context,
    kind: "measurement",
    event: "request_received",
    stage: "ingress",
    observedAt: new Date(context.requestStartedAt).toISOString(),
    attributes: {
      api_surface: apiSurface
    }
  });

  return context;
}

export function logIncomingRequest(context: ProxyRequestContext, route?: RouteConfig | null): void {
  const provider = safeLogField(route?.serviceProvider, 128);
  const model = safeLogField(route?.model, 128);
  const caller = safeLogField(context.caller, 128);
  const routeHint = safeLogField(context.bareModel, 128) || "unknown";

  logLine(
    `--> REQUEST  request_id=${context.requestId}  from=${caller}  route=${routeHint}  provider=${provider}  model=${model}  api_mode=${context.apiMode}  stream=${String(context.stream)}`
  );

  if (isDebugLoggingEnabled()) {
    logDebug(
      `request_id=${context.requestId}  request_started_at=${context.requestStartedAt}  caller=${caller}  listener_api_mode=${context.apiMode}`
    );
  }
}

export function resolveRoute(config: AppConfig, context: ProxyRequestContext): RouteConfig | null {
  if (!context.bareModel) {
    return null;
  }

  return config.routes[context.bareModel] ?? null;
}

export function validateCommonRouteState(
  route: RouteConfig | null,
  context: ProxyRequestContext,
  response: ProxyResponseLike
): route is RouteConfig {
  if (!context.bareModel) {
    logDebugErrorContext("request_validation", context, "missing_model_field");
    logError("unknown", "Request body must include a string 'model' field", 400, context.requestId);
    sendJsonError(response, 400, "Request body must include a string 'model' field", APP_ERROR_CODES.invalidRequest);
    return false;
  }

  if (!route) {
    logDebugErrorContext("route_resolution", context, APP_ERROR_CODES.routeNotFound);
    logError(context.bareModel, "No route found in the active configuration", 404, context.requestId);
    sendJsonError(
      response,
      404,
      `No route found for model '${getResponseSafeRouteHint(context.bareModel)}'`,
      APP_ERROR_CODES.routeNotFound
    );
    return false;
  }

  return true;
}

export function validateListenerForRequest(
  route: RouteConfig,
  context: ProxyRequestContext,
  response: ProxyResponseLike
): boolean {
  // The OpenAI listener is intentionally broader: it can proxy native OpenAI
  // routes and translate Anthropic routes back into the OpenAI-compatible
  // surface. The Anthropic listener is strict and only serves Anthropic routes.
  if (context.apiMode === "openai-completions" || route.api_mode === context.apiMode) {
    return true;
  }

  logDebugErrorContext("listener_compatibility", context, "route_incompatible_with_listener", route);
  logError(
    context.bareModel,
    "Route is not compatible with the Anthropic listener",
    400,
    context.requestId
  );
  sendJsonError(
    response,
    400,
    `Route '${context.bareModel}' is not compatible with the Anthropic listener`,
    "route_incompatible_with_listener"
  );
  return false;
}

export function recordUpstreamResponseStarted(
  context: ProxyRequestContext,
  route: RouteConfig,
  statusCode: number
): void {
  recordGatewayObservation({
    context,
    route,
    kind: "measurement",
    event: "upstream_response_started",
    stage: "upstream_response",
    status_code: statusCode,
    attributes: {
      upstream_status_classification: classifyUpstreamStatus(statusCode)
    }
  });
}

export function recordUpstreamResponseCompleted(
  context: ProxyRequestContext,
  route: RouteConfig,
  statusCode: number,
  responseBytes?: number
): void {
  recordGatewayObservation({
    context,
    route,
    kind: "measurement",
    event: "upstream_response_completed",
    stage: "upstream_response",
    status_code: statusCode,
    response_bytes: responseBytes ?? null,
    attributes: {
      upstream_status_classification: classifyUpstreamStatus(statusCode)
    }
  });
}

export function recordClientResponseStarted(
  context: ProxyRequestContext,
  route: RouteConfig,
  statusCode: number
): void {
  recordGatewayObservation({
    context,
    route,
    kind: "measurement",
    event: "client_response_started",
    stage: "client_response",
    status_code: statusCode
  });
}

export function observeClientResponseLifecycle(
  response: ProxyResponseLike,
  context: ProxyRequestContext,
  route: RouteConfig
): void {
  response.on("finish", () => {
    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "client_response_completed",
      stage: "client_response",
      status_code: response.statusCode
    });
    logLine(
      `<-- RESPONSE  request_id=${context.requestId}  status=${response.statusCode}  route=${safeLogField(context.bareModel, 128) || "unknown"}  provider=${safeLogField(route.serviceProvider, 128)}  model=${safeLogField(route.model, 128)}  api_mode=${context.apiMode}  total_time=${Date.now() - context.requestStartedAt}ms`
    );
    logDebugClientResponse(context, route, response.statusCode);
  });
}

export async function sendBufferedResponse(
  response: ProxyResponseLike,
  context: ProxyRequestContext,
  route: RouteConfig,
  upstreamResponse: Response,
  buffered: Buffer,
  contentType?: string
): Promise<void> {
  logUpstreamResponse(route, context, upstreamResponse.status);
  recordUpstreamResponseCompleted(context, route, upstreamResponse.status, buffered.byteLength);
  recordClientResponseStarted(context, route, response.statusCode);

  if (contentType) {
    response.setHeader("content-type", contentType);
  }

  response.setHeader("content-length", buffered.byteLength);
  recordSmxToClientInspectionBody(context.requestId, response.statusCode, buffered);
  response.end(buffered);
}

export function getStreamingObservationHooks() {
  return {
    recordUpstreamResponseStarted,
    recordUpstreamResponseCompleted,
    recordClientResponseStarted
  };
}

export { ProviderAuthMisconfiguredError };
