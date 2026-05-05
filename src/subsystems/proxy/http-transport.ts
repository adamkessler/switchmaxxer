import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import { parseCanonicalNonNegativeInteger } from "../../platform/number-parsing";
import type { PinnedProviderEndpointResolution } from "./provider-endpoint-policy";

type SwitchmaxxerFetchInit = RequestInit & {
  keepalive?: boolean;
};

type SwitchmaxxerFetchImplementation = typeof fetch;

export type SwitchmaxxerRetryAttemptDetails = {
  attempt: number;
  nextDelayMs: number;
  reason: string;
  method: string;
  maxRetries: number;
  streaming: boolean;
  idempotencyKeyPresent: boolean;
  retryPolicy: "explicit" | "idempotency_key";
  duplicateRisk: "not_applicable" | "idempotency_key" | "caller_accepted";
};

type SwitchmaxxerRetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxBackoffMs?: number;
  onRetry?: (details: SwitchmaxxerRetryAttemptDetails) => void;
};

type SwitchmaxxerTransportOptions = {
  timeoutMs: number;
  retry?: SwitchmaxxerRetryOptions;
  fetchImpl?: SwitchmaxxerFetchImplementation;
  pinnedDnsResolution?: PinnedProviderEndpointResolution | null;
};

type SwitchmaxxerRetryMode = {
  streaming: boolean;
};

function composeSwitchmaxxerFetchSignal(timeoutMs: number, callerSignal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
}

function getFetchMethod(init: RequestInit): string {
  return typeof init.method === "string" ? init.method.toUpperCase() : "GET";
}

function hasIdempotencyKeyHeader(init: RequestInit): boolean {
  return new Headers(init.headers).has("idempotency-key");
}

function resolveMaxRetries(init: RequestInit, options: SwitchmaxxerTransportOptions): {
  idempotencyKeyPresent: boolean;
  maxRetries: number;
  retryPolicy: SwitchmaxxerRetryAttemptDetails["retryPolicy"] | null;
} {
  const explicitMaxRetries = typeof options.retry?.maxRetries === "number";
  const idempotencyKeyPresent = hasIdempotencyKeyHeader(init);

  if (explicitMaxRetries) {
    return {
      idempotencyKeyPresent,
      maxRetries: options.retry!.maxRetries!,
      retryPolicy: "explicit"
    };
  }

  if (idempotencyKeyPresent) {
    return {
      idempotencyKeyPresent,
      maxRetries: 1,
      retryPolicy: "idempotency_key"
    };
  }

  return {
    idempotencyKeyPresent,
    maxRetries: 0,
    retryPolicy: null
  };
}

function buildRetryAttemptDetails(params: {
  attempt: number;
  nextDelayMs: number;
  reason: string;
  method: string;
  maxRetries: number;
  streaming: boolean;
  idempotencyKeyPresent: boolean;
  retryPolicy: SwitchmaxxerRetryAttemptDetails["retryPolicy"];
}): SwitchmaxxerRetryAttemptDetails {
  return {
    ...params,
    duplicateRisk:
      params.method === "POST"
        ? params.idempotencyKeyPresent
          ? "idempotency_key"
          : "caller_accepted"
        : "not_applicable"
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function isCallerAbort(callerSignal?: AbortSignal | null): boolean {
  return Boolean(callerSignal?.aborted);
}

function extractRetryableErrorReason(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return error.message || error.name;
  }

  const cause = (error as Error & { cause?: { code?: string } }).cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : null;
  if (
    causeCode === "ECONNRESET" ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "EHOSTUNREACH" ||
    causeCode === "ENETUNREACH" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN"
  ) {
    return causeCode;
  }

  if (error.message === "fetch failed") {
    return error.message;
  }

  return null;
}

function computeRetryDelayMs(baseDelayMs: number, attempt: number, retryAfterHeader?: string | null): number {
  const headerDelayMs = (() => {
    if (typeof retryAfterHeader !== "string" || retryAfterHeader.trim().length === 0) {
      return null;
    }

    const normalizedRetryAfterHeader = retryAfterHeader.trim();
    const seconds = parseCanonicalNonNegativeInteger(normalizedRetryAfterHeader);
    if (seconds !== null) {
      return seconds * 1000;
    }

    if (/^[+-]?[0-9]/.test(normalizedRetryAfterHeader)) {
      return null;
    }

    const retryAt = Date.parse(normalizedRetryAfterHeader);
    if (!Number.isNaN(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }

    return null;
  })();

  if (typeof headerDelayMs === "number") {
    return headerDelayMs;
  }

  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs / 2)));
  return exponential + jitter;
}

function clampRetryDelayMs(delayMs: number, remainingMs: number, maxBackoffMs: number): number {
  return Math.min(delayMs, Math.max(0, remainingMs), maxBackoffMs);
}

async function sleepWithSignal(delayMs: number, callerSignal?: AbortSignal | null): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const cleanup = () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(callerSignal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    if (callerSignal?.aborted) {
      onAbort();
      return;
    }

    callerSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeFetchInput(input: URL | RequestInfo): URL {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  if (input instanceof Request) {
    return new URL(input.url);
  }

  throw new Error("Switchmaxxer transport only supports URL, string, or Request inputs.");
}

function buildPinnedDnsHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);

  if (typeof init.body === "string" && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(init.body)));
  }

  return headers;
}

async function fetchWithPinnedDnsResolution(
  input: URL | RequestInfo,
  init: RequestInit,
  pinnedDnsResolution: PinnedProviderEndpointResolution
): Promise<Response> {
  const url = normalizeFetchInput(input);
  const transport = url.protocol === "https:" ? https : http;
  const headers = buildPinnedDnsHeaders(init);
  const method = getFetchMethod(init);

  return await new Promise<Response>((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers: Object.fromEntries(headers.entries()),
      lookup: (_hostname, options, callback) => {
        const family =
          typeof options.family === "number" && options.family !== 0 ? options.family : pinnedDnsResolution.family;

        if (family !== pinnedDnsResolution.family) {
          callback(
            new Error(`Pinned DNS family mismatch for '${pinnedDnsResolution.hostname}'.`),
            pinnedDnsResolution.address,
            pinnedDnsResolution.family
          );
          return;
        }

        if (options.all === true) {
          (callback as unknown as (
            error: Error | null,
            addresses: Array<{ address: string; family: number }>
          ) => void)(null, [{
            address: pinnedDnsResolution.address,
            family: pinnedDnsResolution.family
          }]);
          return;
        }

        callback(null, pinnedDnsResolution.address, pinnedDnsResolution.family);
      }
    }, (response) => {
      cleanupAbortListener();
      const responseHeaders = new Headers();

      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === "undefined") {
          continue;
        }

        if (Array.isArray(value)) {
          for (const entry of value) {
            responseHeaders.append(name, entry);
          }
          continue;
        }

        responseHeaders.set(name, value);
      }

      resolve(
        new Response(
          // Node's `Readable.toWeb()` return type and the DOM `BodyInit`
          // declaration do not line up cleanly in TypeScript even though the
          // runtime accepts the stream just fine.
          Readable.toWeb(response as unknown as Readable) as unknown as BodyInit,
          {
          status: response.statusCode ?? 502,
          statusText: response.statusMessage ?? "",
          headers: responseHeaders
          }
        )
      );
    });

    const abortSignal = init.signal;

    const cleanupAbortListener = () => {
      abortSignal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanupAbortListener();
      request.destroy(abortSignal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    request.on("error", (error) => {
      cleanupAbortListener();
      reject(error);
    });

    abortSignal?.addEventListener("abort", onAbort, { once: true });

    if (typeof init.body === "string") {
      request.end(init.body);
      return;
    }

    if (typeof init.body === "undefined" || init.body === null) {
      request.end();
      return;
    }

    cleanupAbortListener();
    request.destroy(new Error("Pinned DNS transport only supports string request bodies."));
  });
}

async function fetchWithSwitchmaxxerRetry(
  input: URL | RequestInfo,
  init: RequestInit,
  options: SwitchmaxxerTransportOptions,
  retryMode: SwitchmaxxerRetryMode
): Promise<Response> {
  const callerSignal = init.signal;
  const method = getFetchMethod(init);
  const isPost = method === "POST";
  const retryPolicy = resolveMaxRetries(init, options);
  const pinnedDnsResolution = options.pinnedDnsResolution;
  const fetchImpl =
    pinnedDnsResolution === null || typeof pinnedDnsResolution === "undefined"
      ? options.fetchImpl ?? fetch
      : async (nextInput: URL | RequestInfo, nextInit?: RequestInit): Promise<Response> =>
          await fetchWithPinnedDnsResolution(nextInput, nextInit ?? {}, pinnedDnsResolution);
  const maxRetries = retryPolicy.maxRetries;
  const baseDelayMs = options.retry?.baseDelayMs ?? 150;
  const maxBackoffMs = options.retry?.maxBackoffMs ?? 5_000;
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;

  while (true) {
    attempt += 1;
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      throw new DOMException("Switchmaxxer upstream request timed out", "TimeoutError");
    }

    const requestInit: SwitchmaxxerFetchInit = {
      ...init,
      redirect: "manual",
      signal: composeSwitchmaxxerFetchSignal(remainingMs, callerSignal),
      keepalive: true
    };

    try {
      const response = await fetchImpl(input, requestInit);

      if (isPost || attempt > maxRetries || !shouldRetryStatus(response.status)) {
        return response;
      }

      const nextDelayMs = clampRetryDelayMs(
        computeRetryDelayMs(baseDelayMs, attempt, response.headers.get("retry-after")),
        deadline - Date.now(),
        maxBackoffMs
      );
      if (retryPolicy.retryPolicy) {
        options.retry?.onRetry?.(buildRetryAttemptDetails({
          attempt,
          nextDelayMs,
          reason: `HTTP ${response.status}`,
          method,
          maxRetries,
          streaming: retryMode.streaming,
          idempotencyKeyPresent: retryPolicy.idempotencyKeyPresent,
          retryPolicy: retryPolicy.retryPolicy
        }));
      }
      await sleepWithSignal(nextDelayMs, callerSignal);
      continue;
    } catch (error) {
      const retryReason = extractRetryableErrorReason(error);

      if (attempt > maxRetries || retryReason === null || isCallerAbort(callerSignal)) {
        throw error;
      }

      const nextDelayMs = clampRetryDelayMs(
        computeRetryDelayMs(baseDelayMs, attempt),
        deadline - Date.now(),
        maxBackoffMs
      );
      if (retryPolicy.retryPolicy) {
        options.retry?.onRetry?.(buildRetryAttemptDetails({
          attempt,
          nextDelayMs,
          reason: retryReason,
          method,
          maxRetries,
          streaming: retryMode.streaming,
          idempotencyKeyPresent: retryPolicy.idempotencyKeyPresent,
          retryPolicy: retryPolicy.retryPolicy
        }));
      }
      await sleepWithSignal(nextDelayMs, callerSignal);
    }
  }
}

export async function fetchWithSwitchmaxxerTransport(
  input: URL | RequestInfo,
  init: RequestInit,
  options: SwitchmaxxerTransportOptions
): Promise<Response> {
  return await fetchWithSwitchmaxxerRetry(input, init, options, { streaming: false });
}

export async function fetchStreamingWithSwitchmaxxerTransport(
  input: URL | RequestInfo,
  init: RequestInit,
  options: SwitchmaxxerTransportOptions
): Promise<Response> {
  return await fetchWithSwitchmaxxerRetry(input, init, options, { streaming: true });
}
