import { randomUUID } from "node:crypto";
import { Readable, type Writable } from "node:stream";

import { StreamingResponseLimitError } from "./proxy-error-classification";
import { logDebugErrorContext, logError, logUpstreamResponse } from "./proxy-logging";
import {
  formatSseChunk,
  parseSseEvents,
  SseRemainderLimitError,
  translateAnthropicEventToOpenAiChunks,
  type AnthropicToOpenAiStreamState
} from "./proxy-translation";
import type { ProxyRequestContext, RouteConfig } from "../../platform/types";

export interface ProxyStreamingResponse extends Writable {
  statusCode: number;
  headersSent: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  removeHeader(name: string): void;
}

function createPlaceholderAnthropicStreamResponseId(): string {
  return `switchmaxxer-placeholder-${randomUUID()}`;
}

type StreamingObservationHooks = {
  recordUpstreamResponseStarted: (
    context: ProxyRequestContext,
    route: RouteConfig,
    statusCode: number
  ) => void;
  recordUpstreamResponseCompleted: (
    context: ProxyRequestContext,
    route: RouteConfig,
    statusCode: number,
    responseBytes?: number
  ) => void;
  recordClientResponseStarted: (
    context: ProxyRequestContext,
    route: RouteConfig,
    statusCode: number
  ) => void;
};

async function writeChunkWithBackpressure(
  response: ProxyStreamingResponse,
  chunk: string | Buffer
): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  const canContinue = response.write(chunk);

  if (canContinue || response.destroyed || response.writableEnded) {
    return;
  }

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      response.off("drain", onDrain);
      response.off("close", onClose);
      response.off("finish", onFinish);
    };

    const onDrain = (): void => {
      cleanup();
      resolve();
    };

    const onClose = (): void => {
      cleanup();
      resolve();
    };

    const onFinish = (): void => {
      cleanup();
      resolve();
    };

    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("finish", onFinish);
  });
}

function createStreamingProgressMonitor(
  exceedStreamLimit: (error: StreamingResponseLimitError) => void,
  streamMinBytesPerSecond: number,
  streamRateWindowMs: number
): {
  start: () => void;
  recordProgress: (bytes: number) => void;
  clear: () => void;
} {
  let progressWindowStartedAt = 0;
  let progressBytes = 0;
  let progressTimeout: NodeJS.Timeout | null = null;

  const clear = (): void => {
    if (progressTimeout) {
      clearTimeout(progressTimeout);
      progressTimeout = null;
    }
  };

  const scheduleCheck = (): void => {
    clear();
    progressTimeout = setTimeout(() => {
      const now = Date.now();
      const elapsedMs = Math.max(1, now - progressWindowStartedAt);
      const minimumBytes = Math.ceil((streamMinBytesPerSecond * elapsedMs) / 1_000);

      if (progressBytes < minimumBytes) {
        exceedStreamLimit(
          new StreamingResponseLimitError(
            "upstream_stream_rate_too_low",
            `Streaming response fell below streamMinBytesPerSecond (${streamMinBytesPerSecond} B/s over ${streamRateWindowMs} ms).`
          )
        );
        return;
      }

      progressWindowStartedAt = now;
      progressBytes = 0;
      scheduleCheck();
    }, streamRateWindowMs);
  };

  return {
    start: (): void => {
      progressWindowStartedAt = Date.now();
      progressBytes = 0;
      scheduleCheck();
    },
    recordProgress: (bytes: number): void => {
      if (bytes > 0) {
        progressBytes += bytes;
      }
    },
    clear
  };
}

export function prepareStreamingResponseHeaders(
  response: ProxyStreamingResponse,
  options: {
    contentType?: string;
    cacheControl?: string;
    connection?: string;
  } = {}
): void {
  if (options.contentType) {
    response.setHeader("content-type", options.contentType);
  }

  if (options.cacheControl) {
    response.setHeader("cache-control", options.cacheControl);
  }

  if (options.connection) {
    response.setHeader("connection", options.connection);
  }

  response.removeHeader("content-length");
}

export function getAbortReason(signal: AbortSignal): string | null {
  return typeof signal.reason === "string" ? signal.reason : null;
}

export async function pipeOpenAiStreamingResponse(
  upstreamResponse: Response,
  response: ProxyStreamingResponse,
  context: ProxyRequestContext,
  route: RouteConfig,
  hooks: StreamingObservationHooks,
  streamIdleTimeoutMs: number,
  streamMaxLifetimeMs: number,
  streamMinBytesPerSecond: number,
  streamRateWindowMs: number,
  streamMaxTotalBytes: number
): Promise<void> {
  if (!upstreamResponse.body) {
    logUpstreamResponse(route, context, upstreamResponse.status);
    response.end();
    return;
  }

  const stream = Readable.fromWeb(upstreamResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  const abortController = new AbortController();
  let upstreamLogged = false;
  let idleTimeout: NodeJS.Timeout | null = null;
  let lifetimeTimeout: NodeJS.Timeout | null = null;
  let settled = false;
  let totalStreamBytes = 0;
  let clientCloseRecorded = false;

  const settle = (): void => {
    settled = true;
  };

  const abortStream = (reason: string): void => {
    if (!abortController.signal.aborted) {
      abortController.abort(reason);
    }
  };

  const clearLifetimeTimeout = (): void => {
    if (lifetimeTimeout) {
      clearTimeout(lifetimeTimeout);
      lifetimeTimeout = null;
    }
  };

  const resetIdleTimeout = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    idleTimeout = setTimeout(() => {
      logDebugErrorContext("response_stream", context, "streaming_idle_timeout", route);
      logError(context.bareModel, "Streaming response idle timeout reached", 504, context.requestId);
      abortStream("streaming_idle_timeout");
      response.end();
      stream.destroy(new Error("Streaming response idle timeout reached"));
    }, streamIdleTimeoutMs);
  };

  const clearIdleTimeout = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  };

  const exceedStreamLimit = (error: StreamingResponseLimitError): void => {
    logDebugErrorContext("response_stream", context, error.code, route);
    logError(context.bareModel, error.message, error.statusCode, context.requestId);
    abortStream(error.code);
    stream.destroy(error);
  };
  const progressMonitor = createStreamingProgressMonitor(
    exceedStreamLimit,
    streamMinBytesPerSecond,
    streamRateWindowMs
  );

  prepareStreamingResponseHeaders(response);
  resetIdleTimeout();
  progressMonitor.start();
  lifetimeTimeout = setTimeout(() => {
    exceedStreamLimit(
      new StreamingResponseLimitError(
        "upstream_stream_lifetime_exceeded",
        `Streaming response exceeded streamMaxLifetimeMs (${streamMaxLifetimeMs} ms).`
      )
    );
  }, streamMaxLifetimeMs);

  const onData = (chunk: Buffer | string): void => {
    resetIdleTimeout();
    const chunkBytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    progressMonitor.recordProgress(chunkBytes);
    totalStreamBytes += chunkBytes;
    if (totalStreamBytes > streamMaxTotalBytes) {
      exceedStreamLimit(
        new StreamingResponseLimitError(
          "upstream_stream_oversized",
          `Streaming response exceeded streamMaxTotalBytes (${streamMaxTotalBytes} bytes).`
        )
      );
    }
    if (!upstreamLogged) {
      upstreamLogged = true;
      hooks.recordUpstreamResponseStarted(context, route, upstreamResponse.status);
      logUpstreamResponse(route, context, upstreamResponse.status);
    }
  };

  const onEnd = (): void => {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
    if (!upstreamLogged) {
      hooks.recordUpstreamResponseStarted(context, route, upstreamResponse.status);
      logUpstreamResponse(route, context, upstreamResponse.status);
    }
    hooks.recordUpstreamResponseCompleted(context, route, upstreamResponse.status);
  };

  const onClose = (): void => {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
  };

  const onAbort = (): void => {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
    stream.unpipe(response);
    if (!stream.destroyed) {
      stream.destroy();
    }
  };

  const onError = (error: Error): void => {
    settle();
    clearIdleTimeout();
    progressMonitor.clear();

    if (abortController.signal.aborted && getAbortReason(abortController.signal) === "streaming_idle_timeout") {
      return;
    }

    logDebugErrorContext("response_delivery", context, error.message, route);
    throw error;
  };

  const onResponseClose = (): void => {
    if (!clientCloseRecorded && !response.writableEnded) {
      clientCloseRecorded = true;
      logDebugErrorContext("response_stream", context, "client_closed", route);
    }
    abortStream("client_closed");
    settle();
  };

  const onResponseFinish = (): void => {
    settle();
  };

  try {
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("close", onClose);
    stream.once("error", onError);
    response.once("close", onResponseClose);
    response.once("finish", onResponseFinish);
    abortController.signal.addEventListener("abort", onAbort, { once: true });

    await new Promise<void>((resolve, reject) => {
      stream.off("error", onError);
      response.off("close", onResponseClose);
      response.off("finish", onResponseFinish);
      stream.once("error", (error: Error) => {
        try {
          onError(error);
          resolve();
        } catch (caughtError) {
          reject(caughtError);
        }
      });
      response.once("close", () => {
        onResponseClose();
        resolve();
      });
      response.once("finish", () => {
        onResponseFinish();
        resolve();
      });
      hooks.recordClientResponseStarted(context, route, response.statusCode);
      stream.pipe(response);
    });
  } finally {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
    stream.unpipe(response);
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("close", onClose);
    stream.off("error", onError);
    response.off("close", onResponseClose);
    response.off("finish", onResponseFinish);
    abortController.signal.removeEventListener("abort", onAbort);
    if (!settled && !abortController.signal.aborted) {
      abortStream("stream_cleanup");
    }
    if (!stream.destroyed && !stream.readableEnded) {
      stream.destroy();
    }
  }
}

export async function pipeAnthropicStreamingToOpenAi(
  upstreamResponse: Response,
  response: ProxyStreamingResponse,
  context: ProxyRequestContext,
  route: RouteConfig,
  hooks: StreamingObservationHooks,
  streamIdleTimeoutMs: number,
  streamMaxLifetimeMs: number,
  streamMinBytesPerSecond: number,
  streamRateWindowMs: number,
  streamMaxEventBytes: number,
  streamMaxTotalBytes: number
): Promise<void> {
  if (!upstreamResponse.body) {
    logUpstreamResponse(route, context, upstreamResponse.status);
    response.end();
    return;
  }

  const decoder = new TextDecoder();
  const reader = upstreamResponse.body.getReader();
  const abortController = new AbortController();
  let buffer = "";
  let upstreamLogged = false;
  let idleTimeout: NodeJS.Timeout | null = null;
  let lifetimeTimeout: NodeJS.Timeout | null = null;
  let readerCancelled = false;
  let totalStreamBytes = 0;
  let terminalStreamError: StreamingResponseLimitError | null = null;
  let clientCloseRecorded = false;
  let sentTerminalDoneChunk = false;
  const terminalDoneChunk = formatSseChunk("[DONE]");
  const streamState: AnthropicToOpenAiStreamState = {
    placeholderResponseId: createPlaceholderAnthropicStreamResponseId(),
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map<number, number>()
  };

  const cancelReader = async (reason: string): Promise<void> => {
    if (readerCancelled) {
      return;
    }

    readerCancelled = true;

    try {
      await reader.cancel(reason);
    } catch {
      // Ignore cancellation errors during stream shutdown.
    }
  };

  const abortStream = (reason: string): void => {
    if (!abortController.signal.aborted) {
      abortController.abort(reason);
    }
  };

  const resetIdleTimeout = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    idleTimeout = setTimeout(() => {
      logDebugErrorContext("response_stream", context, "streaming_idle_timeout", route);
      logError(context.bareModel, "Streaming response idle timeout reached", 504, context.requestId);
      abortStream("streaming_idle_timeout");
      response.end();
    }, streamIdleTimeoutMs);
  };

  const clearIdleTimeout = (): void => {
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  };

  const clearLifetimeTimeout = (): void => {
    if (lifetimeTimeout) {
      clearTimeout(lifetimeTimeout);
      lifetimeTimeout = null;
    }
  };

  const exceedStreamLimit = (error: StreamingResponseLimitError): void => {
    terminalStreamError = error;
    logDebugErrorContext("response_stream", context, error.code, route);
    logError(context.bareModel, error.message, error.statusCode, context.requestId);
    abortStream(error.code);
  };
  const progressMonitor = createStreamingProgressMonitor(
    exceedStreamLimit,
    streamMinBytesPerSecond,
    streamRateWindowMs
  );

  prepareStreamingResponseHeaders(response, {
    contentType: "text/event-stream; charset=utf-8",
    cacheControl: "no-cache",
    connection: "keep-alive"
  });
  resetIdleTimeout();
  progressMonitor.start();
  lifetimeTimeout = setTimeout(() => {
    exceedStreamLimit(
      new StreamingResponseLimitError(
        "upstream_stream_lifetime_exceeded",
        `Streaming response exceeded streamMaxLifetimeMs (${streamMaxLifetimeMs} ms).`
      )
    );
  }, streamMaxLifetimeMs);

  const onAbort = (): void => {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
    const reason =
      typeof abortController.signal.reason === "string" ? abortController.signal.reason : "stream_aborted";
    void cancelReader(reason);
  };

  const onResponseClose = (): void => {
    if (!clientCloseRecorded && !response.writableEnded) {
      clientCloseRecorded = true;
      logDebugErrorContext("response_stream", context, "client_closed", route);
    }
    abortStream("client_closed");
  };

  const onResponseFinish = (): void => {
    abortStream("client_finished");
  };

  abortController.signal.addEventListener("abort", onAbort, { once: true });
  response.once("close", onResponseClose);
  response.once("finish", onResponseFinish);

  try {
    while (!abortController.signal.aborted) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      resetIdleTimeout();
      totalStreamBytes += value.byteLength;

      if (totalStreamBytes > streamMaxTotalBytes) {
        throw new StreamingResponseLimitError(
          "upstream_stream_oversized",
          `Streaming response exceeded streamMaxTotalBytes (${streamMaxTotalBytes} bytes).`
        );
      }

      if (!upstreamLogged) {
        upstreamLogged = true;
        hooks.recordUpstreamResponseStarted(context, route, upstreamResponse.status);
        logUpstreamResponse(route, context, upstreamResponse.status);
      }

      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer) > streamMaxEventBytes) {
        throw new StreamingResponseLimitError(
          "upstream_stream_event_oversized",
          `Streaming SSE event exceeded streamMaxEventBytes (${streamMaxEventBytes} bytes).`
        );
      }
      let parsed: { events: string[]; remainder: string };
      try {
        parsed = parseSseEvents(buffer, { maxRemainderBytes: streamMaxEventBytes });
      } catch (error) {
        if (error instanceof SseRemainderLimitError) {
          throw new StreamingResponseLimitError(
            "upstream_stream_event_oversized",
            `Streaming SSE event exceeded streamMaxEventBytes (${streamMaxEventBytes} bytes).`
          );
        }

        throw error;
      }
      buffer = parsed.remainder;

      for (const event of parsed.events) {
        for (const chunk of translateAnthropicEventToOpenAiChunks(event, route.model, streamState)) {
          if (!response.headersSent) {
            hooks.recordClientResponseStarted(context, route, response.statusCode);
          }
          if (chunk === terminalDoneChunk) {
            sentTerminalDoneChunk = true;
          }
          progressMonitor.recordProgress(Buffer.byteLength(chunk));
          await writeChunkWithBackpressure(response, chunk);

          if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
            break;
          }
        }

        if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof StreamingResponseLimitError) {
      exceedStreamLimit(error);
      throw error;
    }

    if (!abortController.signal.aborted) {
      const reason = error instanceof Error ? error.message : "stream_translation_failed";
      logDebugErrorContext("response_translation", context, reason, route);
      throw error;
    }
  } finally {
    clearIdleTimeout();
    clearLifetimeTimeout();
    progressMonitor.clear();
    response.off("close", onResponseClose);
    response.off("finish", onResponseFinish);
    abortController.signal.removeEventListener("abort", onAbort);
    await cancelReader(
      typeof abortController.signal.reason === "string" ? abortController.signal.reason : "stream_cleanup"
    );
  }

  if (terminalStreamError) {
    throw terminalStreamError;
  }

  if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
    return;
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    const error = new Error("Incomplete Anthropic SSE event payload.");
    logDebugErrorContext("response_translation", context, error.message, route);
    throw error;
  }

  if (!upstreamLogged) {
    hooks.recordUpstreamResponseStarted(context, route, upstreamResponse.status);
    logUpstreamResponse(route, context, upstreamResponse.status);
  }

  hooks.recordUpstreamResponseCompleted(context, route, upstreamResponse.status);

  if (!sentTerminalDoneChunk) {
    if (!response.headersSent) {
      hooks.recordClientResponseStarted(context, route, response.statusCode);
    }
    await writeChunkWithBackpressure(response, terminalDoneChunk);
  }

  response.end();
}
