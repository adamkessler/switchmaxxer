import { type Writable } from "node:stream";

import { recordGatewayObservation } from "../observability/gateway";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { isDebugLoggingEnabled, logDebug, logLine } from "../../platform/logger";
import {
  classifyFetchError,
  classifyResponseDeliveryError,
  describeFetchErrorDiagnostics
} from "./proxy-error-classification";
import {
  AnthropicMessagesRequiredError,
  UnsupportedTextContentError
} from "./proxy-translation";
import {
  ProviderAuthMisconfiguredError,
  createContext,
  forwardStreamingUpstreamRequest,
  forwardUpstreamRequest,
  logIncomingRequest,
  resolveRoute,
  sendJsonError,
  validateCommonRouteState
} from "./proxy-forwarding";
import type { SwitchmaxxerRetryAttemptDetails } from "./http-transport";
import {
  applyProviderHeaders,
  sanitizeIncomingHeaders
} from "./proxy-headers";
import {
  logDebugErrorContext,
  logDebugIngress,
  logDebugRouteResolution,
  logDebugUpstreamRequest,
  logError,
  safeLogField,
  safeLogUrl
} from "./proxy-logging";
import { createUpstreamUrl } from "./upstream-url";
import { type AppConfig, type ProxyRequestContext, type RouteConfig } from "../../platform/types";
import { buildRequestShapeSummary } from "./proxy-request-shape";
import { buildUpstreamModel } from "./proxy-upstream-model";
import { sendJsonErrorIfWritable } from "./proxy-response-handlers";
import {
  bindInvokeInspectionCaptureToRequestId,
  normalizeFetchInspectionHeaders,
  recordSmxToProviderInspectionExchange
} from "../gateway/invoke-inspection";

export interface ProxyRequest {
  method?: string;
  url?: string;
  headers: import("node:http").IncomingHttpHeaders;
  socket: {
    remoteAddress?: string;
  };
}

export interface ProxyResponse extends Writable {
  statusCode: number;
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  getHeader(name: string): unknown;
  removeHeader(name: string): void;
}

type ProxyExecutionOptions = {
  apiSurface: "openai" | "anthropic";
  forwardMode: "openai-listener" | "anthropic-listener";
  fetchImpl?: typeof fetch;
  validateRoute?: (route: RouteConfig, context: ProxyRequestContext, response: ProxyResponse) => boolean;
  buildRequestBody: (route: RouteConfig, rawBody: string, maxSerializedBytes: number) => string;
  handleResponse: (
    upstreamResponse: Response,
    route: RouteConfig,
    response: ProxyResponse,
    context: ProxyRequestContext,
    config: AppConfig
  ) => Promise<void>;
};

function isJsonRequestBodyBoundsError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === "json_serialized_too_large" || error.message === "json_structure_too_large")
  );
}

export async function executeProxyRequest(
  request: ProxyRequest,
  response: ProxyResponse,
  config: AppConfig,
  parsedBody: Record<string, unknown>,
  rawBody: string,
  options: ProxyExecutionOptions
): Promise<void> {
  const context = createContext(request, parsedBody, options.apiSurface);
  bindInvokeInspectionCaptureToRequestId(context.requestId, request);
  response.setHeader("x-switchmaxxer-request-id", context.requestId);
  const route = resolveRoute(config, context);
  logDebugIngress(request, context, options.apiSurface, buildRequestShapeSummary(parsedBody, options.apiSurface));
  logDebugRouteResolution(context, route);
  logIncomingRequest(context, route);

  if (!validateCommonRouteState(route, context, response)) {
    return;
  }

  recordGatewayObservation({
    context,
    route,
    kind: "measurement",
    event: "route_resolved",
    stage: "route_resolution"
  });

  if (options.validateRoute && !options.validateRoute(route, context, response)) {
    return;
  }

  const upstreamUrl = createUpstreamUrl(route.baseUrl, route.api_mode);
  const upstreamModel = buildUpstreamModel(route);
  let rewrittenBody: string;

  try {
    rewrittenBody = options.buildRequestBody(route, rawBody, config.maxPayloadSize);
  } catch (error) {
    if (error instanceof AnthropicMessagesRequiredError) {
      logDebugErrorContext("request_translation", context, "anthropic_messages_required", route);
      sendJsonError(
        response,
        400,
        "Request body must include at least one non-system message",
        APP_ERROR_CODES.invalidRequest
      );
      return;
    }

    if (error instanceof UnsupportedTextContentError) {
      logDebugErrorContext("request_translation", context, error.message, route);
      sendJsonError(
        response,
        400,
        "Request body contains unsupported content for this translation path",
        APP_ERROR_CODES.unsupportedContentShape
      );
      return;
    }

    if (isJsonRequestBodyBoundsError(error)) {
      logDebugErrorContext("request_translation", context, APP_ERROR_CODES.payloadTooLarge, route);
      sendJsonError(
        response,
        413,
        `Request body exceeds max_payload_size (${config.maxPayloadSize} bytes) after proxy rewriting`,
        APP_ERROR_CODES.payloadTooLarge
      );
      return;
    }

    throw error;
  }

  logLine(
    `--> FORWARD   request_id=${context.requestId}  route=${safeLogField(context.bareModel, 128) || "unknown"}  provider=${safeLogField(route.serviceProvider, 128)}  model=${safeLogField(route.model, 128)}  api_mode=${context.apiMode}  upstream=${safeLogField(upstreamModel, 128)}  url=${safeLogUrl(upstreamUrl)}`
  );

  if (isDebugLoggingEnabled()) {
    logDebug(
      `request_id=${context.requestId}  forward_mode=${options.forwardMode}  timeout_ms=${route.timeoutMs}  upstream_api_mode=${route.api_mode}  upstream_model=${upstreamModel}`
    );
  }

  logDebugUpstreamRequest(
    context,
    route,
    upstreamUrl,
    route.timeoutMs,
    Buffer.byteLength(rewrittenBody),
    options.forwardMode,
    upstreamModel
  );

  let headers: Headers;

  try {
    headers = sanitizeIncomingHeaders(request.headers);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_header_value") {
      logDebugErrorContext("request_validation", context, APP_ERROR_CODES.invalidHeaderValue, route);
      sendJsonError(
        response,
        400,
        "Request headers contain an invalid value",
        APP_ERROR_CODES.invalidHeaderValue
      );
      return;
    }

    throw error;
  }

  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("accept", context.stream ? "text/event-stream" : "application/json");
  headers.set("accept-encoding", "identity");

  try {
    applyProviderHeaders(headers, route);
  } catch (error) {
    if (error instanceof ProviderAuthMisconfiguredError) {
      logDebugErrorContext("upstream_fetch", context, "invalid_provider_auth", route);
      logError(context.bareModel, error.message, 500, context.requestId);
      sendJsonError(
        response,
        500,
        "Upstream provider auth is misconfigured.",
        "invalid_provider_auth"
      );
      return;
    }

    throw error;
  }

  recordSmxToProviderInspectionExchange(context.requestId, {
    method: "POST",
    url: upstreamUrl,
    headers: normalizeFetchInspectionHeaders(headers),
    body: rewrittenBody
  });

  let upstreamResponse: Response;
  const logRetryAttempt = (details: SwitchmaxxerRetryAttemptDetails): void => {
    logDebug(
      `event=debug_upstream_retry  request_id=${context.requestId}  route=${safeLogField(context.bareModel, 128) || "unknown"}  provider=${safeLogField(route.serviceProvider, 128)}  attempt=${details.attempt}  next_delay_ms=${details.nextDelayMs}  reason=${safeLogField(details.reason, 128)}  retry_policy=${details.retryPolicy}  duplicate_risk=${details.duplicateRisk}`
    );
    recordGatewayObservation({
      context,
      route,
      kind: "debug",
      event: "debug_upstream_retry",
      stage: "upstream_fetch",
      outcome: "in_progress",
      attributes: {
        retry_attempt: details.attempt,
        retry_next_delay_ms: details.nextDelayMs,
        retry_reason: details.reason,
        retry_policy: details.retryPolicy,
        retry_max_retries: details.maxRetries,
        retry_method: details.method,
        retry_streaming: details.streaming,
        retry_idempotency_key_present: details.idempotencyKeyPresent,
        retry_duplicate_risk: details.duplicateRisk
      }
    });
  };

  try {
    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "upstream_request_started",
      stage: "upstream_fetch"
    });
    upstreamResponse = context.stream
      ? await forwardStreamingUpstreamRequest(
          upstreamUrl,
          route.allowPrivateEndpoints,
          headers,
          rewrittenBody,
          route.timeoutMs,
          logRetryAttempt,
          options.fetchImpl
        )
      : await forwardUpstreamRequest(
          upstreamUrl,
          route.allowPrivateEndpoints,
          headers,
          rewrittenBody,
          route.timeoutMs,
          logRetryAttempt,
          options.fetchImpl
        );
  } catch (error) {
    const classified = classifyFetchError(error);
    logDebugErrorContext("upstream_fetch", context, classified.code, route, describeFetchErrorDiagnostics(error));
    logError(context.bareModel, classified.message, classified.statusCode, context.requestId);
    sendJsonError(response, classified.statusCode, classified.message, classified.code);
    return;
  }

  try {
    await options.handleResponse(upstreamResponse, route, response, context, config);
  } catch (error) {
    const classified = classifyResponseDeliveryError(error);
    logDebugErrorContext("response_delivery", context, classified.code, route);
    logError(context.bareModel, classified.message, classified.statusCode, context.requestId);
    sendJsonErrorIfWritable(response, classified.statusCode, classified.message, classified.code);
  }
}

export { classifyFetchError, describeFetchErrorDiagnostics, describeTestFailure } from "./proxy-error-classification";
export { classifyUpstreamStatus } from "./proxy-error-classification";
export { validateListenerForRequest } from "./proxy-forwarding";
export { buildPatchedJsonBody } from "./proxy-request-shape";
export { runRouteTests, runRouteTestsDetailed, type RouteTestResult } from "./proxy-route-tests";
export {
  normalizeTextContent,
  translateAnthropicResponse,
  translateAnthropicEventToOpenAiChunks
} from "./proxy-translation";
export { getAbortReason } from "./proxy-streaming";
export { getCallerDisplayLabel, sendJsonError } from "./proxy-forwarding";
export { sanitizeHeadersForLogging } from "./proxy-headers";
