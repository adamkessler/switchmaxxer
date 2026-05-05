import type { IncomingMessage, ServerResponse } from "node:http";

import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import type { AppConfig } from "../../../../platform/types";
import {
  attachInvokeInspectionCapture,
  completeSmxToClientInspectionExchange,
  INVOKE_INSPECTION_REQUEST_HEADER,
  INVOKE_INSPECTION_RESPONSE_HEADER,
  INVOKE_INSPECTION_TOKEN_HEADER,
  normalizeOutgoingInspectionHeaders
} from "./invoke-inspection";
import type { InvokeInspectionCaptureStore } from "./invoke-inspection-store";
import { handleGatewayProxyRequest } from "./request-dispatch";
import type { GatewayRuntimeRequestHandlerDeps } from "./runtime-handler-types";
import type {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";

// Trust contract: the router has already authenticated the caller, applied
// unauthenticated local-client browser defenses, and enforced caller rate limits.
export async function handleDataPlaneRequest(params: {
  request: IncomingMessage;
  response: ServerResponse;
  config: AppConfig;
  pathname: string;
  method: string;
  isAnthropicPath: boolean;
  deps: GatewayRuntimeRequestHandlerDeps;
  inspectionCaptureStore: InvokeInspectionCaptureStore;
  jsonParseConcurrencyManager: JsonParseConcurrencyManager;
  streamingRequestConcurrencyManager: StreamingRequestConcurrencyManager;
}): Promise<void> {
  const callerSuppliedInspectId = readSingleHeaderValue(
    params.request.headers[INVOKE_INSPECTION_RESPONSE_HEADER]
  );
  const callerSuppliedInspectToken = readSingleHeaderValue(
    params.request.headers[INVOKE_INSPECTION_TOKEN_HEADER]
  );
  if (callerSuppliedInspectId !== null || callerSuppliedInspectToken !== null) {
    params.deps.sendJsonError(
      params.response,
      400,
      `Invoke inspection ids and tokens are server allocated; send '${INVOKE_INSPECTION_REQUEST_HEADER}: 1' to request inspection.`,
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  const inspectRequested = readSingleHeaderValue(params.request.headers[INVOKE_INSPECTION_REQUEST_HEADER]);
  if (inspectRequested !== null) {
    if (inspectRequested !== "1") {
      params.deps.sendJsonError(
        params.response,
        400,
        "Invoke inspection request header is invalid.",
        APP_ERROR_CODES.invalidRequest
      );
      return;
    }

    const { id: inspectId, readToken: inspectReadToken, capture } = params.inspectionCaptureStore.allocate();
    attachInvokeInspectionCapture(params.request, capture);
    params.response.setHeader(INVOKE_INSPECTION_RESPONSE_HEADER, inspectId);
    params.response.setHeader(INVOKE_INSPECTION_TOKEN_HEADER, inspectReadToken);
    params.response.on("finish", () => {
      completeSmxToClientInspectionExchange(
        capture,
        params.response.statusCode,
        normalizeOutgoingInspectionHeaders(params.response.getHeaders())
      );
    });
  }

  await handleGatewayProxyRequest({
    request: params.request,
    response: params.response,
    config: params.config,
    pathname: params.pathname,
    method: params.method,
    isAnthropicPath: params.isAnthropicPath,
    readRequestBodyWithLimit: params.deps.readRequestBodyWithLimit,
    validateParsedRequestBodyShape: params.deps.validateParsedRequestBodyShape,
    defaultRequestBodyIdleTimeoutMs: params.deps.defaultRequestBodyIdleTimeoutMs,
    sendJsonError: params.deps.sendJsonError,
    logLine: params.deps.logLine,
    logWarning: params.deps.logWarning,
    proxyAnthropicMessage: params.deps.proxyAnthropicMessage,
    proxyChatCompletion: params.deps.proxyChatCompletion,
    jsonParseConcurrencyManager: params.jsonParseConcurrencyManager,
    streamingRequestConcurrencyManager: params.streamingRequestConcurrencyManager
  });
}

function readSingleHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] ?? null : null;
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
