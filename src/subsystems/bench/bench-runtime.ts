import { randomUUID } from "node:crypto";

import type { BenchmarkRunRecord, BenchmarkSampleRecord } from "../observability/benchmarks";
import type { ObservabilityService } from "../observability/service";
import type { ObservationEvent, ObservationOutcome } from "../observability/types";
import type { BenchmarkExecutionWarning, BenchmarkPath } from "../observability/contracts";
import { fetchWithSwitchmaxxerTransport } from "../hot-path/manatee/proxy/http-transport";
import { buildLocalGatewayAuthHeaders } from "../hot-path/manatee/runtime/local-gateway-auth";
import { buildLocalHttpUrl, normalizeHealthProbeHost } from "../../platform/net-utils";
import { HARD_MAX_JSON_SERIALIZED_BYTES } from "../../platform/json-bounds";
import { resolveRouteApiKey } from "../config/provider-auth";
import { createUpstreamUrl } from "../hot-path/manatee/proxy/upstream-url";
import type { AppConfig, RouteConfig } from "../../platform/types";

const BENCHMARK_RESPONSE_REASON_MAX_BYTES = 4 * 1024;

class BenchmarkResponseTooLargeError extends Error {
  readonly path: BenchmarkPath;
  readonly maxBytes: number;
  readonly bytesRead: number;

  constructor(path: BenchmarkPath, maxBytes: number, bytesRead: number) {
    super(`Benchmark ${path} response exceeded ${maxBytes} bytes.`);
    this.name = "BenchmarkResponseTooLargeError";
    this.path = path;
    this.maxBytes = maxBytes;
    this.bytesRead = bytesRead;
  }
}

export type BenchmarkRunTask = {
  sampleIndex: number;
  routeName: string;
  path: BenchmarkPath;
  iteration: number;
  isWarmup: boolean;
};

export type BenchmarkExecutionPlan = {
  requestedPathMode: "gateway" | "direct" | "both";
  effectivePaths: BenchmarkPath[];
  skippedPaths: BenchmarkPath[];
  warnings: BenchmarkExecutionWarning[];
};

export type BenchmarkPreflightResult =
  | {
      ok: true;
      sourceFile: string;
      sourcePath: string;
      bindHost: string;
      port: number;
      probeHost: string;
      healthUrl: string;
      pid: number | null;
      latencyMs: number | null;
    }
  | {
      ok: false;
      code: "invalid_config" | "gateway_unavailable";
      message: string;
      sourceFile: string;
      sourcePath: string;
      bindHost: string;
      port: number | null;
      probeHost: string;
      healthUrl: string | null;
      pid: number | null;
      latencyMs: number | null;
    };

export class BenchmarkCancelledError extends Error {
  readonly reason: "SIGINT" | "aborted";
  readonly exitCode: number;

  constructor(message = "Benchmark run cancelled", reason: "SIGINT" | "aborted" = "aborted") {
    super(message);
    this.name = "BenchmarkCancelledError";
    this.reason = reason;
    this.exitCode = 130;
  }
}

function toBenchmarkCancelledError(signal?: AbortSignal | null): BenchmarkCancelledError {
  const reason = signal?.reason;

  if (reason instanceof BenchmarkCancelledError) {
    return reason;
  }

  if (reason instanceof Error && reason.name === "AbortError") {
    return new BenchmarkCancelledError(reason.message || "Benchmark run cancelled", "aborted");
  }

  return new BenchmarkCancelledError("Benchmark run cancelled", "aborted");
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof BenchmarkCancelledError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function benchmarkResponseMaxBytes(config: AppConfig): number {
  return config.maxBufferedUpstreamResponseBytes ?? HARD_MAX_JSON_SERIALIZED_BYTES;
}

function parseContentLengthBytes(response: Response): number | null {
  const rawContentLength = response.headers.get("content-length");
  if (rawContentLength === null || !/^[0-9]+$/.test(rawContentLength)) {
    return null;
  }

  return Number.parseInt(rawContentLength, 10);
}

async function readBenchmarkResponseText(
  response: Response,
  path: BenchmarkPath,
  maxBytes: number
): Promise<string> {
  const contentLengthBytes = parseContentLengthBytes(response);
  if (contentLengthBytes !== null && contentLengthBytes > maxBytes) {
    await response.body?.cancel();
    throw new BenchmarkResponseTooLargeError(path, maxBytes, contentLengthBytes);
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new BenchmarkResponseTooLargeError(path, maxBytes, bytesRead);
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function truncateTextToUtf8Bytes(text: string, maxBytes: number): string {
  const textBytes = Buffer.byteLength(text, "utf8");
  if (textBytes <= maxBytes) {
    return text;
  }

  return `${Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")}...`;
}

function benchmarkFailureReason(responseText: string, fallback: string): string {
  const trimmed = responseText.trim();
  return trimmed.length > 0
    ? truncateTextToUtf8Bytes(trimmed, BENCHMARK_RESPONSE_REASON_MAX_BYTES)
    : fallback;
}

function buildBenchmarkPaths(pathMode: "gateway" | "direct" | "both"): BenchmarkPath[] {
  if (pathMode === "both") {
    return ["gateway", "direct"];
  }

  return [pathMode];
}

export function buildBenchTasks(
  routeNames: string[],
  pathMode: "gateway" | "direct" | "both",
  warmup: number,
  iterations: number
): BenchmarkRunTask[] {
  const paths = buildBenchmarkPaths(pathMode);
  const tasks: BenchmarkRunTask[] = [];
  let sampleIndex = 0;

  for (const routeName of routeNames) {
    for (const path of paths) {
      for (let index = 0; index < warmup; index += 1) {
        tasks.push({
          sampleIndex,
          routeName,
          path,
          iteration: index + 1,
          isWarmup: true
        });
        sampleIndex += 1;
      }

      for (let index = 0; index < iterations; index += 1) {
        tasks.push({
          sampleIndex,
          routeName,
          path,
          iteration: index + 1,
          isWarmup: false
        });
        sampleIndex += 1;
      }
    }
  }

  return tasks;
}

export async function resolveBenchmarkExecutionPlan(
  requestedPathMode: "gateway" | "direct" | "both",
  preflightGateway: () => Promise<BenchmarkPreflightResult>
): Promise<
  | {
      ok: true;
      plan: BenchmarkExecutionPlan;
    }
  | {
      ok: false;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    }
> {
  if (requestedPathMode === "direct") {
    return {
      ok: true,
      plan: {
        requestedPathMode,
        effectivePaths: ["direct"],
        skippedPaths: [],
        warnings: []
      }
    };
  }

  const preflight = await preflightGateway();
  if (preflight.ok) {
    return {
      ok: true,
      plan: {
        requestedPathMode,
        effectivePaths: requestedPathMode === "both" ? ["gateway", "direct"] : ["gateway"],
        skippedPaths: [],
        warnings: []
      }
    };
  }

  const details = {
    health_url: preflight.healthUrl,
    source_file: preflight.sourceFile,
    bind_host: preflight.bindHost,
    port: preflight.port,
    probe_host: preflight.probeHost,
    pid: preflight.pid,
    latency_ms: preflight.latencyMs
  };

  if (requestedPathMode === "gateway") {
    return {
      ok: false,
      code: preflight.code,
      message: preflight.message,
      details
    };
  }

  return {
    ok: true,
    plan: {
      requestedPathMode,
      effectivePaths: ["direct"],
      skippedPaths: ["gateway"],
      warnings: [
        {
          code: preflight.code,
          message: `Skipping gateway benchmark path: ${preflight.message}`,
          path: "gateway",
          details
        }
      ]
    }
  };
}

function createBenchmarkGatewayRequest(
  config: AppConfig,
  routeName: string,
  route: RouteConfig,
  prompt: string
): {
  api: "openai" | "anthropic";
  body: string;
} {
  if (route.api_mode === "anthropic-messages") {
    return {
      api: "anthropic",
      body: JSON.stringify({
        model: routeName,
        messages: [{ role: "user", content: prompt }],
        max_tokens: config.benchmark.defaultMaxTokens,
        stream: false
      })
    };
  }

  return {
    api: "openai",
    body: JSON.stringify({
      model: routeName,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: config.benchmark.defaultMaxTokens,
      stream: false
    })
  };
}

function createBenchmarkDirectRequest(
  config: AppConfig,
  route: RouteConfig,
  prompt: string
): {
  headers: Headers;
  body: string;
  upstreamUrl: string;
} {
  const upstreamUrl = createUpstreamUrl(route.baseUrl, route.api_mode);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    accept: "application/json"
  });
  const apiKey = resolveRouteApiKey(route);

  if (route.api_mode === "anthropic-messages") {
    headers.set("anthropic-version", route.anthropicVersion ?? config.benchmark.defaultAnthropicVersion);
    if (apiKey !== null) {
      headers.set("x-api-key", apiKey);
    }

    return {
      headers,
      upstreamUrl,
      body: JSON.stringify({
        model: route.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: config.benchmark.defaultMaxTokens
      })
    };
  }

  if (apiKey !== null) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return {
    headers,
    upstreamUrl,
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.benchmark.defaultMaxTokens
    })
  };
}

function addMs(baseIso: string, deltaMs: number): string {
  const timestamp = Date.parse(baseIso);
  return new Date(timestamp + deltaMs).toISOString();
}

function recordSyntheticBenchmarkExecution(params: {
  service: ObservabilityService;
  routeName: string;
  route: RouteConfig;
  path: BenchmarkPath;
  benchmarkRunId: string;
  benchmarkCaseId: string;
  sampleMetadata: Record<string, unknown>;
  startedAtIso: string;
  completedAtIso: string;
  statusCode: number | null;
  outcome: ObservationOutcome;
  reason: string | null;
  createdBy: string;
}): NonNullable<ReturnType<ObservabilityService["getRequestExecution"]>> {
  const requestId = randomUUID();
  const clientApiMode = params.path === "direct" ? "direct-upstream" : params.route.api_mode;
  // Synthetic benchmark rows are intentionally marked surface: "benchmark" so they can live in the
  // same observability store without being mistaken for live gateway traffic. User-facing trace
  // listings must not return these rows unless they are explicitly filtering for benchmark surface data.
  const baseRecord = {
    request_id: requestId,
    trace_id: requestId,
    surface: "benchmark",
    route_id: params.routeName,
    route_name: params.routeName,
    provider_id: params.route.serviceProvider,
    provider_model_id: params.route.model,
    client_api_mode: clientApiMode,
    upstream_api_mode: params.route.api_mode,
    actor: params.createdBy,
    benchmark_run_id: params.benchmarkRunId,
    benchmark_case_id: params.benchmarkCaseId
  } as const;

  const recordObservation = (
    event: ObservationEvent,
    observedAt: string,
    extras: Partial<Parameters<ObservabilityService["recordObservation"]>[0]>
  ): void => {
    params.service.recordObservation({
      id: randomUUID(),
      observed_at: observedAt,
      kind: "measurement",
      event,
      stage:
        event === "request_received"
          ? "ingress"
          : event === "route_resolved"
            ? "route_resolution"
            : event === "upstream_request_started"
              ? "upstream_request"
              : event === "upstream_response_completed"
                ? "upstream_response"
                : "client_response",
      attributes_json: JSON.stringify(params.sampleMetadata),
      ...baseRecord,
      ...extras
    });
  };

  recordObservation("request_received", params.startedAtIso, {
    outcome: "started"
  });
  recordObservation("route_resolved", addMs(params.startedAtIso, 1), {
    outcome: "in_progress"
  });
  recordObservation("upstream_request_started", addMs(params.startedAtIso, 2), {
    outcome: "in_progress"
  });
  recordObservation("upstream_response_completed", params.completedAtIso, {
    outcome: params.outcome === "succeeded" ? "in_progress" : params.outcome,
    status_code: params.statusCode,
    latency_ms: Math.max(0, Date.parse(params.completedAtIso) - Date.parse(params.startedAtIso)),
    duration_ms: Math.max(0, Date.parse(params.completedAtIso) - Date.parse(params.startedAtIso))
  });
  recordObservation("client_response_started", params.completedAtIso, {
    outcome: params.outcome === "succeeded" ? "in_progress" : params.outcome,
    status_code: params.statusCode
  });
  recordObservation("client_response_completed", params.completedAtIso, {
    outcome: params.outcome,
    status_code: params.statusCode
  });

  if (params.reason) {
    params.service.recordObservation({
      id: randomUUID(),
      observed_at: params.completedAtIso,
      kind: "error",
      event: "debug_error_context",
      stage: params.path === "direct" ? "upstream_fetch" : "client_response",
      outcome: params.outcome,
      message: params.reason,
      attributes_json: JSON.stringify({
        ...params.sampleMetadata,
        reason: params.reason
      }),
      ...baseRecord
    });
  }

  const execution = params.service.getRequestExecution(requestId);
  if (!execution) {
    throw new Error(`Synthetic benchmark execution '${requestId}' was not materialized`);
  }

  return execution;
}

async function waitForRequestExecution(
  service: ObservabilityService,
  requestId: string,
  attempts = 8,
  signal?: AbortSignal
): Promise<ReturnType<ObservabilityService["getRequestExecution"]>> {
  for (let index = 0; index < attempts; index += 1) {
    if (signal?.aborted) {
      throw toBenchmarkCancelledError(signal);
    }

    const execution = service.getRequestExecution(requestId);
    if (execution) {
      return execution;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, 25);

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(toBenchmarkCancelledError(signal));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  return null;
}

export async function executeBenchmarkTask(params: {
  service: ObservabilityService;
  config: AppConfig;
  routeName: string;
  route: RouteConfig;
  prompt: string;
  benchmarkRunId: string;
  task: BenchmarkRunTask;
  bindHost: string;
  port: number;
  createdBy: string;
  signal?: AbortSignal;
}): Promise<{
  sample: BenchmarkSampleRecord;
  requestExecution: ReturnType<ObservabilityService["getRequestExecution"]>;
}> {
  const benchmarkCaseId = `${params.task.path}:${params.routeName}:${params.task.isWarmup ? "warmup" : "measured"}:${params.task.iteration}`;
  const startedAtIso = new Date().toISOString();
  const metadataBase = {
    path: params.task.path,
    route_name: params.routeName,
    iteration: params.task.iteration,
    phase: params.task.isWarmup ? "warmup" : "measured"
  };

  let requestExecution: ReturnType<ObservabilityService["getRequestExecution"]> = null;
  let statusCode: number | null = null;
  let outcome: ObservationOutcome = "failed";
  let completedAtIso = startedAtIso;
  let reason: string | null = null;
  let details: Record<string, unknown> = metadataBase;
  let detailContext: Record<string, unknown> = {};

  const classifyFailure = (
    path: BenchmarkPath,
    failureReason: string | null,
    httpStatus: number | null
  ): Record<string, unknown> => {
    const lowerReason = failureReason?.toLowerCase() ?? "";
    const pathPrefix = path === "gateway" ? "gateway" : "direct";

    if (typeof httpStatus === "number") {
      return {
        failure_kind: `${pathPrefix}_http_error`,
        http_status: httpStatus
      };
    }

    if (lowerReason.includes("timeout") || lowerReason.includes("aborted")) {
      return {
        failure_kind: `${pathPrefix}_timeout`
      };
    }

    return {
      failure_kind: `${pathPrefix}_transport_error`
    };
  };

  try {
    if (params.signal?.aborted) {
      throw toBenchmarkCancelledError(params.signal);
    }

    if (params.task.path === "gateway") {
      const gatewayRequest = createBenchmarkGatewayRequest(params.config, params.routeName, params.route, params.prompt);
      const probeHost = normalizeHealthProbeHost(params.bindHost);
      const endpoint =
        gatewayRequest.api === "anthropic"
          ? buildLocalHttpUrl(probeHost, params.port, "/anthropic/v1/messages")
          : buildLocalHttpUrl(probeHost, params.port, "/v1/chat/completions");
      detailContext = {
        endpoint
      };
      const gatewayHeaders = buildLocalGatewayAuthHeaders(
        params.config.inboundApiKeyEnv,
        params.config.allowUnauthenticatedGateway === true,
        params.config.oneTrustedOperatorBoundary === true
      );
      gatewayHeaders.set("content-type", "application/json; charset=utf-8");
      gatewayHeaders.set("accept", "application/json");

      const response = await fetchWithSwitchmaxxerTransport(endpoint, {
        method: "POST",
        headers: gatewayHeaders,
        body: gatewayRequest.body,
        signal: params.signal
      }, {
        timeoutMs: params.route.timeoutMs
      });
      completedAtIso = new Date().toISOString();
      statusCode = response.status;
      outcome = response.ok ? "succeeded" : "failed";
      const requestId = response.headers.get("x-switchmaxxer-request-id");
      detailContext = {
        endpoint,
        request_id: requestId
      };
      const responseText = await readBenchmarkResponseText(
        response,
        "gateway",
        benchmarkResponseMaxBytes(params.config)
      );
      const responseReason = benchmarkFailureReason(responseText, `gateway returned HTTP ${response.status}`);
      details = {
        ...metadataBase,
        ...detailContext,
        reason: response.ok ? null : responseReason,
        ...(!response.ok ? classifyFailure("gateway", responseReason, response.status) : {})
      };
      reason = typeof details["reason"] === "string" ? details["reason"] : null;

      if (requestId) {
        requestExecution = await waitForRequestExecution(params.service, requestId, 8, params.signal);
      }

      if (!requestExecution) {
        requestExecution = recordSyntheticBenchmarkExecution({
          service: params.service,
          routeName: params.routeName,
          route: params.route,
          path: "gateway",
          benchmarkRunId: params.benchmarkRunId,
          benchmarkCaseId,
          sampleMetadata: details,
          startedAtIso,
          completedAtIso,
          statusCode,
          outcome,
          reason,
          createdBy: params.createdBy
        });
      }
    } else {
      const directRequest = createBenchmarkDirectRequest(params.config, params.route, params.prompt);
      detailContext = {
        upstream_url: directRequest.upstreamUrl
      };
      const response = await fetchWithSwitchmaxxerTransport(directRequest.upstreamUrl, {
        method: "POST",
        headers: directRequest.headers,
        body: directRequest.body,
        signal: params.signal
      }, {
        timeoutMs: params.route.timeoutMs
      });
      completedAtIso = new Date().toISOString();
      statusCode = response.status;
      outcome = response.ok ? "succeeded" : "failed";
      const responseText = await readBenchmarkResponseText(
        response,
        "direct",
        benchmarkResponseMaxBytes(params.config)
      );
      const responseReason = benchmarkFailureReason(responseText, `upstream returned HTTP ${response.status}`);
      details = {
        ...metadataBase,
        ...detailContext,
        reason: response.ok ? null : responseReason,
        ...(!response.ok ? classifyFailure("direct", responseReason, response.status) : {})
      };
      reason = typeof details["reason"] === "string" ? details["reason"] : null;

      requestExecution = recordSyntheticBenchmarkExecution({
        service: params.service,
        routeName: params.routeName,
        route: params.route,
        path: "direct",
        benchmarkRunId: params.benchmarkRunId,
        benchmarkCaseId,
        sampleMetadata: details,
        startedAtIso,
        completedAtIso,
        statusCode,
        outcome,
        reason,
        createdBy: params.createdBy
      });
    }
  } catch (error) {
    completedAtIso = new Date().toISOString();
    outcome = isAbortLikeError(error) ? "cancelled" : "failed";
    reason =
      error instanceof BenchmarkCancelledError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown benchmark execution error";
    const failureAttributes = error instanceof BenchmarkResponseTooLargeError
      ? {
          failure_kind: `${params.task.path}_response_too_large`,
          max_response_bytes: error.maxBytes,
          response_bytes_read: error.bytesRead
        }
      : outcome === "cancelled"
        ? {
            failure_kind: `${params.task.path}_cancelled`
          }
        : classifyFailure(params.task.path, reason, statusCode);
    details = {
      ...metadataBase,
      ...detailContext,
      reason,
      ...failureAttributes
    };

    requestExecution = recordSyntheticBenchmarkExecution({
      service: params.service,
      routeName: params.routeName,
      route: params.route,
      path: params.task.path,
      benchmarkRunId: params.benchmarkRunId,
      benchmarkCaseId,
      sampleMetadata: details,
      startedAtIso,
      completedAtIso,
      statusCode,
      outcome,
      reason,
      createdBy: params.createdBy
    });
  }

  if (!requestExecution) {
    throw new Error("Benchmark execution did not produce a request execution record");
  }

  const sample: BenchmarkSampleRecord = {
    id: randomUUID(),
    benchmark_run_id: params.benchmarkRunId,
    request_execution_id: requestExecution.request_id,
    route_id: requestExecution.route_id ?? params.routeName,
    provider_id: requestExecution.provider_id ?? params.route.serviceProvider,
    provider_model_id: requestExecution.provider_model_id ?? params.route.model,
    sample_index: params.task.sampleIndex,
    started_at: requestExecution.started_at,
    completed_at: requestExecution.completed_at,
    status_code: requestExecution.status_code,
    outcome: requestExecution.outcome,
    latency_ms: requestExecution.latency_ms,
    ttft_ms: requestExecution.ttft_ms,
    duration_ms: requestExecution.duration_ms,
    input_tokens: requestExecution.input_tokens,
    output_tokens: requestExecution.output_tokens,
    total_tokens: requestExecution.total_tokens,
    estimated_cost_micros: requestExecution.estimated_cost_micros,
    is_warmup: params.task.isWarmup ? 1 : 0,
    score_value: null,
    score_scale: null,
    score_direction: null,
    score_source: null,
    score_method: null,
    scored_at: null,
    score_json: JSON.stringify(details)
  };

  params.service.benchmarks.insertSample(sample);

  return {
    sample,
    requestExecution
  };
}

export type { BenchmarkRunRecord, BenchmarkSampleRecord };
