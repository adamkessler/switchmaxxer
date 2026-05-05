import type { IncomingMessage, ServerResponse } from "node:http";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { parseCanonicalNonNegativeInteger } from "../../platform/number-parsing";
import { getOrAssignRequestId } from "../../platform/request-id";
import { isRecord } from "../../platform/type-guards";
import type { AppConfig } from "../../platform/types";
import { recordGatewayObservation } from "../observability/gateway";
import type {
  GatewayAnthropicMessagesRequestBody,
  GatewayOpenAiChatRequestBody
} from "./request-body-types";
import { validateGatewayProxyRequestBody } from "./request-body-types";
import {
  classifyGatewayApiMode,
  gatewayRequestSourceIp,
  requestHasJsonContentType
} from "./runtime-helpers";
import {
  normalizeIncomingInspectionHeaders,
  recordClientToSmxInspectionExchange
} from "./invoke-inspection";
import type {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";

export async function handleGatewayProxyRequest(options: {
  request: IncomingMessage;
  response: ServerResponse;
  config: AppConfig;
  pathname: string;
  method: string;
  isAnthropicPath: boolean;
  readRequestBodyWithLimit: (
    request: IncomingMessage,
    maxPayloadSize: number,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ) => Promise<string>;
  validateParsedRequestBodyShape: (body: Record<string, unknown>, maxPayloadSize: number) => void;
  defaultRequestBodyIdleTimeoutMs: number;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  logLine: (message: string) => void;
  logWarning: (message: string) => void;
  proxyAnthropicMessage: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayAnthropicMessagesRequestBody,
    rawBody: string
  ) => Promise<void>;
  proxyChatCompletion: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayOpenAiChatRequestBody,
    rawBody: string
  ) => Promise<void>;
  jsonParseConcurrencyManager: JsonParseConcurrencyManager;
  streamingRequestConcurrencyManager: StreamingRequestConcurrencyManager;
}): Promise<void> {
  const {
    request,
    response,
    config,
    pathname,
    method
  } = options;
  const transferEncodingHeader = request.headers["transfer-encoding"];
  const contentLengthHeader = request.headers["content-length"];
  const hasTransferEncoding = Array.isArray(transferEncodingHeader)
    ? transferEncodingHeader.some((value) => value.trim().length > 0)
    : typeof transferEncodingHeader === "string" && transferEncodingHeader.trim().length > 0;

  if (hasTransferEncoding) {
    options.logLine(`x ERROR     model=unknown  reason="Transfer-Encoding request bodies are not supported"  status=411`);
    response.setHeader("connection", "close");
    options.sendJsonError(
      response,
      411,
      "Transfer-Encoding is not supported for gateway JSON request bodies.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  if (Array.isArray(contentLengthHeader)) {
    options.logLine(`x ERROR     model=unknown  reason="Duplicate Content-Length header"  status=400`);
    response.setHeader("connection", "close");
    options.sendJsonError(
      response,
      400,
      "Request body must include exactly one Content-Length header.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  if (typeof contentLengthHeader !== "string" || contentLengthHeader.trim().length === 0) {
    options.logLine(`x ERROR     model=unknown  reason="Missing Content-Length header"  status=411`);
    response.setHeader("connection", "close");
    options.sendJsonError(
      response,
      411,
      "Request body must include a Content-Length header.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  const declaredLength = parseCanonicalNonNegativeInteger(contentLengthHeader);
  if (declaredLength === null) {
    options.logLine(`x ERROR     model=unknown  reason="Invalid Content-Length header"  status=400`);
    options.sendJsonError(
      response,
      400,
      "Content-Length header must be a non-negative integer.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  if (declaredLength > config.maxPayloadSize) {
    options.logLine(`x ERROR     model=unknown  reason="Request body too large"  status=413`);
    options.sendJsonError(
      response,
      413,
      `Request body exceeds max_payload_size (${config.maxPayloadSize} bytes)`,
      APP_ERROR_CODES.payloadTooLarge
    );
    return;
  }

  if (!requestHasJsonContentType(request)) {
    options.logLine(`x ERROR     model=unknown  reason="Unsupported Content-Type header"  status=415`);
    options.sendJsonError(
      response,
      415,
      "Gateway JSON request bodies require 'Content-Type: application/json'.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  let rawBody: string;
  const releaseJsonParseSlot = options.jsonParseConcurrencyManager.tryAcquire(config.maxConcurrentJsonParses ?? 4);

  if (releaseJsonParseSlot === null) {
    const sourceIp = gatewayRequestSourceIp(request);
    const apiMode = classifyGatewayApiMode(pathname) ?? "openai-completions";

    options.logWarning(
      `Gateway concurrent JSON parse cap exceeded for source ${sourceIp}; active_parse_limit=${config.maxConcurrentJsonParses ?? 4}.`
    );
    recordGatewayObservation({
      context: {
        requestId: getOrAssignRequestId(request),
        caller: sourceIp,
        bareModel: "",
        stream: false,
        apiMode,
        requestStartedAt: Date.now()
      },
      kind: "error",
      event: "rate_limited",
      stage: "ingress",
      outcome: "rejected",
      status_code: 503,
      attributes: {
        scope: "json_parse_concurrency",
        source_ip: sourceIp,
        method,
        path: pathname,
        max_concurrent_json_parses: config.maxConcurrentJsonParses ?? 4
      },
      message: "Too many concurrent request bodies are being parsed."
    });
    options.sendJsonError(
      response,
      503,
      "Server is busy parsing other request bodies. Retry later.",
      APP_ERROR_CODES.requestParseCapacityExceeded
    );
    return;
  }

  try {
    try {
      rawBody = await options.readRequestBodyWithLimit(
        request,
        config.maxPayloadSize,
        Math.min(config.timeoutMs, options.defaultRequestBodyIdleTimeoutMs),
        config.timeoutMs
      );
    } catch (error) {
      if (error instanceof Error && error.message === "request_body_too_large") {
        options.logLine(`x ERROR     model=unknown  reason="Request body too large"  status=413`);
        options.sendJsonError(
          response,
          413,
          `Request body exceeds max_payload_size (${config.maxPayloadSize} bytes)`,
          APP_ERROR_CODES.payloadTooLarge
        );
        return;
      }

      if (
        error instanceof Error &&
        (error.message === "request_body_idle_timeout" || error.message === "request_body_total_timeout")
      ) {
        options.logLine(`x ERROR     model=unknown  reason="Request body upload timed out"  status=408`);
        response.setHeader("connection", "close");
        options.sendJsonError(response, 408, "Request body upload timed out", APP_ERROR_CODES.requestTimeout);
        return;
      }

      throw error;
    }

    recordClientToSmxInspectionExchange(request, {
      method,
      url: request.url ?? pathname,
      headers: normalizeIncomingInspectionHeaders(request.headers),
      body: rawBody
    });

    let parsedBody: GatewayOpenAiChatRequestBody | GatewayAnthropicMessagesRequestBody;

    try {
      const candidate = parseJsonWithinBounds(rawBody, {
        maxSerializedBytes: config.maxPayloadSize
      });

      if (!isRecord(candidate)) {
        throw new Error("Request body must be a JSON object");
      }

      options.validateParsedRequestBodyShape(candidate, config.maxPayloadSize);
      parsedBody = validateGatewayProxyRequestBody(
        candidate,
        options.isAnthropicPath ? "anthropic" : "openai"
      ).body;
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message === "request_body_structure_too_large" ||
          error.message === "json_structure_too_large" ||
          error.message === "json_serialized_too_large"
        )
      ) {
        options.logLine(`x ERROR     model=unknown  reason="Request body structure too large after parse"  status=413`);
        options.sendJsonError(
          response,
          413,
          `Request body exceeds the allowed parsed JSON shape for max_payload_size (${config.maxPayloadSize} bytes)`,
          APP_ERROR_CODES.payloadTooLarge
        );
        return;
      }

      options.logLine(`x ERROR     model=unknown  reason="Malformed request body"  status=400`);
      options.sendJsonError(response, 400, "Malformed request body", APP_ERROR_CODES.invalidJson);
      return;
    }

    const requestedStream = parsedBody["stream"] === true;
    const sourceIp = gatewayRequestSourceIp(request);
    let releaseStreamingRequestSlot: (() => void) | null = null;

    if (requestedStream) {
      releaseStreamingRequestSlot = options.streamingRequestConcurrencyManager.tryAcquire(
        sourceIp,
        config.maxConcurrentStreamsPerIp ?? 8
      );

      if (releaseStreamingRequestSlot === null) {
        const apiMode = classifyGatewayApiMode(pathname) ?? "openai-completions";
        const bareModel = typeof parsedBody["model"] === "string" ? parsedBody["model"] : "";

        options.logWarning(
          `Gateway concurrent stream cap exceeded for source ${sourceIp}; active_stream_limit=${config.maxConcurrentStreamsPerIp ?? 8}.`
        );
        recordGatewayObservation({
          context: {
            requestId: getOrAssignRequestId(request),
            caller: sourceIp,
            bareModel,
            stream: true,
            apiMode,
            requestStartedAt: Date.now()
          },
          kind: "error",
          event: "rate_limited",
          stage: "ingress",
          outcome: "rejected",
          status_code: 429,
          attributes: {
            scope: "concurrent_streams",
            source_ip: sourceIp,
            method,
            path: pathname,
            max_concurrent_streams_per_ip: config.maxConcurrentStreamsPerIp ?? 8
          },
          message: "Too many concurrent streaming requests from this source."
        });
        options.sendJsonError(
          response,
          429,
          "Too many concurrent streaming requests from this source. Retry later.",
          APP_ERROR_CODES.streamCapacityExceeded
        );
        return;
      }
    }

    try {
      if (options.isAnthropicPath) {
        await options.proxyAnthropicMessage(
          request,
          response,
          config,
          parsedBody as GatewayAnthropicMessagesRequestBody,
          rawBody
        );
        return;
      }

      await options.proxyChatCompletion(
        request,
        response,
        config,
        parsedBody as GatewayOpenAiChatRequestBody,
        rawBody
      );
    } finally {
      releaseStreamingRequestSlot?.();
    }
  } finally {
    releaseJsonParseSlot();
  }
}
