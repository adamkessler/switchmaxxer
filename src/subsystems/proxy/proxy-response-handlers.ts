import {
  HARD_MAX_JSON_DEPTH,
  HARD_MAX_JSON_NODE_COUNT,
  HARD_MAX_JSON_SERIALIZED_BYTES,
  parseJsonWithinBounds,
  safeJsonStringifyWithinBounds
} from "../../platform/json-bounds";
import { type AppConfig, type ProxyRequestContext, type RouteConfig } from "../../platform/types";
import { getStreamingObservationHooks, observeClientResponseLifecycle, recordUpstreamResponseStarted, sendBufferedResponse, sendJsonError } from "./proxy-forwarding";
import { copyBufferedResponseHeaders, copyResponseHeaders } from "./proxy-headers";
import { logDebugErrorContext, logDebugResponsePath } from "./proxy-logging";
import { bufferResponseWithinLimit } from "./proxy-response-buffer";
import { pipeAnthropicStreamingToOpenAi, pipeOpenAiStreamingResponse, prepareStreamingResponseHeaders } from "./proxy-streaming";
import { type AnthropicResponseBody, translateAnthropicResponse } from "./proxy-translation";
import type { ProxyResponse } from "./proxy-core";
import {
  normalizeFetchInspectionHeaders,
  recordProviderToSmxInspectionExchange
} from "../gateway/invoke-inspection";

function appendTrailingNewline(buffer: Buffer): Buffer {
  if (buffer.length > 0 && buffer[buffer.length - 1] === 0x0a) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.from("\n")]);
}

export function sendJsonErrorIfWritable(
  response: ProxyResponse,
  statusCode: number,
  message: string,
  code: string
): boolean {
  if (response.headersSent || response.writableEnded) {
    response.destroy();
    return false;
  }

  sendJsonError(response, statusCode, message, code);
  return true;
}

async function bufferResponse(response: Response, maxBytes: number): Promise<Buffer> {
  return bufferResponseWithinLimit(response, maxBytes);
}

async function pipeAnthropicStreamingPassThrough(
  upstreamResponse: Response,
  response: ProxyResponse,
  context: ProxyRequestContext,
  route: RouteConfig,
  streamIdleTimeoutMs: number,
  streamMaxLifetimeMs: number,
  streamMinBytesPerSecond: number,
  streamRateWindowMs: number,
  streamMaxTotalBytes: number
): Promise<void> {
  copyResponseHeaders(upstreamResponse.headers, response);
  prepareStreamingResponseHeaders(response, {
    contentType: "text/event-stream; charset=utf-8"
  });
  await pipeOpenAiStreamingResponse(
    upstreamResponse,
    response,
    context,
    route,
    getStreamingObservationHooks(),
    streamIdleTimeoutMs,
    streamMaxLifetimeMs,
    streamMinBytesPerSecond,
    streamRateWindowMs,
    streamMaxTotalBytes
  );
}

async function sendBufferedAnthropicPassthroughResponse(
  upstreamResponse: Response,
  response: ProxyResponse,
  context: ProxyRequestContext,
  route: RouteConfig,
  maxBufferedUpstreamResponseBytes: number | undefined
): Promise<void> {
  copyBufferedResponseHeaders(upstreamResponse.headers, response);
  let buffered: Buffer;

  try {
    buffered = await bufferResponse(upstreamResponse, maxBufferedUpstreamResponseBytes ?? 16 * 1024 * 1024);
    recordProviderToSmxInspectionExchange(context.requestId, {
      status_code: upstreamResponse.status,
      headers: normalizeFetchInspectionHeaders(upstreamResponse.headers),
      body: buffered
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "buffer_response_failed";
    logDebugErrorContext("response_delivery", context, reason, route);
    throw error;
  }

  await sendBufferedResponse(response, context, route, upstreamResponse, buffered);
}

export async function handleUpstreamResponseForOpenAiClient(
  upstreamResponse: Response,
  route: RouteConfig,
  response: ProxyResponse,
  context: ProxyRequestContext,
  config: AppConfig
): Promise<void> {
  observeClientResponseLifecycle(response, context, route);

  response.statusCode = upstreamResponse.status;
  recordUpstreamResponseStarted(context, route, upstreamResponse.status);

  if (upstreamResponse.status >= 400) {
    logDebugResponsePath(context, route, upstreamResponse.status, "buffered");
    copyBufferedResponseHeaders(upstreamResponse.headers, response);
    let buffered: Buffer;

    try {
      buffered = appendTrailingNewline(await bufferResponse(upstreamResponse, config.maxBufferedUpstreamResponseBytes ?? 16 * 1024 * 1024));
      recordProviderToSmxInspectionExchange(context.requestId, {
        status_code: upstreamResponse.status,
        headers: normalizeFetchInspectionHeaders(upstreamResponse.headers),
        body: buffered
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "buffer_response_failed";
      logDebugErrorContext("response_delivery", context, reason, route);
      throw error;
    }

    await sendBufferedResponse(response, context, route, upstreamResponse, buffered);
    return;
  }

  if (context.stream) {
    if (route.api_mode === "openai-completions") {
      logDebugResponsePath(context, route, upstreamResponse.status, "stream");
      await pipeOpenAiStreamingResponse(
        upstreamResponse,
        response,
        context,
        route,
        getStreamingObservationHooks(),
        config.streamIdleTimeoutMs,
        config.streamMaxLifetimeMs,
        config.streamMinBytesPerSecond,
        config.streamRateWindowMs,
        config.streamMaxTotalBytes
      );
      return;
    }

    logDebugResponsePath(context, route, upstreamResponse.status, "stream");
    await pipeAnthropicStreamingToOpenAi(
      upstreamResponse,
      response,
      context,
      route,
      getStreamingObservationHooks(),
      config.streamIdleTimeoutMs,
      config.streamMaxLifetimeMs,
      config.streamMinBytesPerSecond,
      config.streamRateWindowMs,
      config.streamMaxEventBytes,
      config.streamMaxTotalBytes
    );
    return;
  }

  if (route.api_mode === "openai-completions") {
    logDebugResponsePath(context, route, upstreamResponse.status, "buffered");
    copyBufferedResponseHeaders(upstreamResponse.headers, response);
    let buffered: Buffer;

    try {
      buffered = appendTrailingNewline(
        await bufferResponse(upstreamResponse, config.maxBufferedUpstreamResponseBytes ?? 16 * 1024 * 1024)
      );
      recordProviderToSmxInspectionExchange(context.requestId, {
        status_code: upstreamResponse.status,
        headers: normalizeFetchInspectionHeaders(upstreamResponse.headers),
        body: buffered
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "buffer_response_failed";
      logDebugErrorContext("response_delivery", context, reason, route);
      throw error;
    }

    await sendBufferedResponse(response, context, route, upstreamResponse, buffered);
    return;
  }

  logDebugResponsePath(context, route, upstreamResponse.status, "buffered");
  let upstreamBody: AnthropicResponseBody;

  try {
    const upstreamRawBody = (await bufferResponse(
      upstreamResponse,
      config.maxBufferedUpstreamResponseBytes ?? 16 * 1024 * 1024
    )).toString("utf8");
    recordProviderToSmxInspectionExchange(context.requestId, {
      status_code: upstreamResponse.status,
      headers: normalizeFetchInspectionHeaders(upstreamResponse.headers),
      body: upstreamRawBody
    });
    upstreamBody = parseJsonWithinBounds(upstreamRawBody, {
      maxNodeCount: HARD_MAX_JSON_NODE_COUNT,
      maxDepth: HARD_MAX_JSON_DEPTH,
      maxSerializedBytes: HARD_MAX_JSON_SERIALIZED_BYTES
    }) as AnthropicResponseBody;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "anthropic_response_json_failed";
    logDebugErrorContext("response_translation", context, reason, route);
    throw error;
  }

  const translated = `${safeJsonStringifyWithinBounds(translateAnthropicResponse(upstreamBody, route.model))}\n`;
  await sendBufferedResponse(
    response,
    context,
    route,
    upstreamResponse,
    Buffer.from(translated),
    "application/json; charset=utf-8"
  );
}

export async function handleUpstreamResponseForAnthropicClient(
  upstreamResponse: Response,
  route: RouteConfig,
  response: ProxyResponse,
  context: ProxyRequestContext,
  config: AppConfig
): Promise<void> {
  observeClientResponseLifecycle(response, context, route);

  response.statusCode = upstreamResponse.status;
  recordUpstreamResponseStarted(context, route, upstreamResponse.status);

  if (upstreamResponse.status >= 400) {
    logDebugResponsePath(context, route, upstreamResponse.status, "buffered");
    await sendBufferedAnthropicPassthroughResponse(
      upstreamResponse,
      response,
      context,
      route,
      config.maxBufferedUpstreamResponseBytes
    );
    return;
  }

  if (context.stream) {
    logDebugResponsePath(context, route, upstreamResponse.status, "stream");
    await pipeAnthropicStreamingPassThrough(
      upstreamResponse,
      response,
      context,
      route,
      config.streamIdleTimeoutMs,
      config.streamMaxLifetimeMs,
      config.streamMinBytesPerSecond,
      config.streamRateWindowMs,
      config.streamMaxTotalBytes
    );
    return;
  }

  logDebugResponsePath(context, route, upstreamResponse.status, "buffered");
  await sendBufferedAnthropicPassthroughResponse(
    upstreamResponse,
    response,
    context,
    route,
    config.maxBufferedUpstreamResponseBytes
  );
}
