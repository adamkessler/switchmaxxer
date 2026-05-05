import { logDebug, logLine, isDebugLoggingEnabled, sanitizeLogValue } from "../../../../platform/logger";
import {
  emitLegacyGatewayFailureObservation,
  emitLegacyGatewayObservation
} from "../observation-emit";
import type { ProxyRequestContext, RouteConfig } from "../../../../platform/types";

export type ProxyDebugIngressSummary = {
  messageCount: number;
  hasSystemMessage: boolean;
  promptChars: number;
  toolCount: number;
  hasMetadata: boolean;
  maxTokens: number | null;
  temperature: number | null;
};

export function safeLogField(value: string | null | undefined, maxLen = 256): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  return sanitizeLogValue(value, maxLen);
}

export function safeLogReason(value: string | null | undefined): string {
  return safeLogField(value, 512);
}

export function safeLogUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const queryPart = parsed.search.length > 0 ? "  query=true" : "  query=false";
    return `${safeLogField(`${parsed.origin}${parsed.pathname}`, 512)}${queryPart}`;
  } catch {
    return safeLogField(value.split("?")[0] ?? value, 512);
  }
}

function debugField(name: string, value: unknown, maxLen = 256): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }

  const rendered = sanitizeLogValue(String(value), maxLen);
  return rendered.length > 0 ? `${name}=${rendered}` : null;
}

function debugQuotedField(name: string, value: unknown, maxLen = 512): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return `${name}="${safeLogReason(value).slice(0, maxLen)}"`;
}

function renderDebugErrorDiagnostics(attributes: Record<string, unknown> | undefined): string {
  if (!attributes) {
    return "";
  }

  const fields = [
    debugField("error_kind", attributes["error_kind"], 128),
    debugField("socket_code", attributes["socket_code"], 128),
    debugField("socket_errno", attributes["socket_errno"], 128),
    debugField("socket_syscall", attributes["socket_syscall"], 128),
    debugField("socket_hostname", attributes["socket_hostname"], 256),
    debugField("error_name", attributes["error_name"], 128),
    debugField("root_cause_name", attributes["root_cause_name"], 128),
    debugQuotedField("root_cause_message", attributes["root_cause_message"], 512)
  ].filter((field): field is string => typeof field === "string");

  return fields.length > 0 ? `  ${fields.join("  ")}` : "";
}

export function logUpstreamResponse(route: RouteConfig, context: ProxyRequestContext, status: number): void {
  const routeHint = safeLogField(context.bareModel, 128) || "unknown";
  logLine(
    `<-- UPSTREAM  request_id=${context.requestId}  status=${status}  route=${routeHint}  provider=${safeLogField(route.serviceProvider, 128)}  model=${safeLogField(route.model, 128)}  api_mode=${context.apiMode}  latency=${Date.now() - context.requestStartedAt}ms`
  );
}

export function logError(model: string, reason: string, statusCode: number, requestId?: string): void {
  const requestPart = requestId ? `request_id=${requestId}  ` : "";
  logLine(`x ERROR     ${requestPart}model=${safeLogField(model, 128)}  reason="${safeLogReason(reason)}"  status=${statusCode}`);
}

export function logDebugIngress(
  request: {
    method?: string;
    url?: string;
  },
  context: ProxyRequestContext,
  apiSurface: "openai" | "anthropic",
  summary: ProxyDebugIngressSummary
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const path = request.url ? request.url.split("?")[0] : "/";
  const caller = safeLogField(context.caller, 128);
  const routeHint = safeLogField(context.bareModel, 128) || "unknown";

  logDebug(
    `event=debug_ingress  request_id=${context.requestId}  method=${safeLogField(request.method ?? "POST", 16)}  path=${safeLogField(path, 256)}  caller=${caller}  listener_api_mode=${context.apiMode}  stream=${String(context.stream)}  route_hint=${routeHint}  message_count=${summary.messageCount}  has_system_message=${String(summary.hasSystemMessage)}  prompt_chars=${summary.promptChars}  tool_count=${summary.toolCount}  has_metadata=${String(summary.hasMetadata)}  max_tokens=${summary.maxTokens ?? "null"}  temperature=${summary.temperature ?? "null"}`
  );

  emitLegacyGatewayObservation({
    context,
    kind: "debug",
    event: "debug_ingress",
    stage: "ingress",
    attributes: {
      method: request.method ?? "POST",
      path,
      listener_api_mode: apiSurface,
      stream: context.stream,
      route_hint: context.bareModel || "unknown",
      message_count: summary.messageCount,
      has_system_message: summary.hasSystemMessage,
      prompt_chars: summary.promptChars,
      tool_count: summary.toolCount,
      has_metadata: summary.hasMetadata,
      max_tokens: summary.maxTokens,
      temperature: summary.temperature
    }
  });
}

export function logDebugRouteResolution(context: ProxyRequestContext, route: RouteConfig | null): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const routeHint = safeLogField(context.bareModel, 128) || "unknown";
  logDebug(
    `event=debug_route_resolution  request_id=${context.requestId}  route_hint=${routeHint}  resolved=${String(route !== null)}  route_id=${routeHint}  provider=${safeLogField(route?.serviceProvider, 128)}  provider_model_id=${safeLogField(route?.model, 128)}  upstream_api_mode=${route?.api_mode ?? "unknown"}`
  );

  emitLegacyGatewayObservation({
    context,
    route,
    kind: "debug",
    event: "debug_route_resolution",
    stage: "route_resolution",
    attributes: {
      route_hint: context.bareModel || "unknown",
      resolved: route !== null
    }
  });
}

export function logDebugUpstreamRequest(
  context: ProxyRequestContext,
  route: RouteConfig,
  upstreamUrl: string,
  timeoutMs: number,
  bodyBytes: number,
  forwardMode: "openai-listener" | "anthropic-listener",
  upstreamModel: string
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  logDebug(
    `event=debug_upstream_request  request_id=${context.requestId}  forward_mode=${forwardMode}  timeout_ms=${timeoutMs}  url=${safeLogUrl(upstreamUrl)}  upstream_api_mode=${route.api_mode}  upstream_model=${safeLogField(upstreamModel, 128)}  body_bytes=${bodyBytes}  anthropic_version=${safeLogField(route.anthropicVersion ?? "null", 64)}`
  );

  emitLegacyGatewayObservation({
    context,
    route,
    kind: "debug",
    event: "debug_upstream_request",
    stage: "upstream_request",
    request_bytes: bodyBytes,
    attributes: {
      forward_mode: forwardMode,
      timeout_ms: timeoutMs,
      url: upstreamUrl,
      upstream_model: upstreamModel,
      anthropic_version: route.anthropicVersion
    }
  });
}

export function logDebugResponsePath(
  context: ProxyRequestContext,
  route: RouteConfig,
  upstreamStatusCode: number,
  responseMode: "stream" | "buffered"
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const routeHint = safeLogField(context.bareModel, 128) || "unknown";
  logDebug(
    `event=debug_response_path  request_id=${context.requestId}  route=${routeHint}  provider=${safeLogField(route.serviceProvider, 128)}  provider_model_id=${safeLogField(route.model, 128)}  client_api_mode=${context.apiMode}  upstream_api_mode=${route.api_mode}  translated=${String(route.api_mode !== context.apiMode)}  response_mode=${responseMode}  upstream_status_code=${upstreamStatusCode}`
  );

  emitLegacyGatewayObservation({
    context,
    route,
    kind: "debug",
    event: "debug_response_path",
    stage: "upstream_response",
    status_code: upstreamStatusCode,
    attributes: {
      translated: route.api_mode !== context.apiMode,
      response_mode: responseMode
    }
  });
}

export function logDebugClientResponse(
  context: ProxyRequestContext,
  route: RouteConfig,
  responseStatusCode: number
): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  const routeHint = safeLogField(context.bareModel, 128) || "unknown";
  logDebug(
    `event=debug_client_response  request_id=${context.requestId}  route=${routeHint}  provider=${safeLogField(route.serviceProvider, 128)}  provider_model_id=${safeLogField(route.model, 128)}  client_api_mode=${context.apiMode}  upstream_api_mode=${route.api_mode}  status_code=${responseStatusCode}  total_time=${Date.now() - context.requestStartedAt}ms`
  );

  emitLegacyGatewayObservation({
    context,
    route,
    kind: "debug",
    event: "debug_client_response",
    stage: "client_response",
    status_code: responseStatusCode,
    attributes: {
      total_time_ms: Date.now() - context.requestStartedAt
    }
  });
}

export function logDebugErrorContext(
  stage: string,
  context: ProxyRequestContext,
  reason: string,
  route?: RouteConfig | null,
  attributes?: Record<string, unknown>
): void {
  if (isDebugLoggingEnabled()) {
    const routeHint = safeLogField(context.bareModel, 128) || "unknown";
    logDebug(
      `event=debug_error_context  request_id=${context.requestId}  stage=${safeLogField(stage, 64)}  route=${routeHint}  provider=${safeLogField(route?.serviceProvider, 128)}  provider_model_id=${safeLogField(route?.model, 128)}  client_api_mode=${context.apiMode}  upstream_api_mode=${route?.api_mode ?? "unknown"}  reason="${safeLogReason(reason)}"${renderDebugErrorDiagnostics(attributes)}`
    );
  }

  emitLegacyGatewayFailureObservation(stage, context, reason, route, attributes);
}
