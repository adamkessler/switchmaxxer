import path from "node:path";

import { getNonEmptyEnvValue } from "../../platform/env";
import { BenchmarkCancelledError } from "../bench/bench-runtime";
import { MCP_ENTITY_STATE_ERROR_CODES } from "../config/config-metadata";
import { loadConfig } from "../config/config";
import { resolveCliConfigPath } from "../config/read-model";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildLocalHttpUrl, normalizeHealthProbeHost } from "../../platform/net-utils";
import { parseCanonicalPositiveInteger } from "../../platform/number-parsing";
import { createOstrichBenchmarkRunPort } from "../observability/observability-module";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { buildMcpErrorEnvelope, toEnvelopeFromError, type McpErrorEnvelope, type McpSuccessEnvelope } from "./envelope";
import { resolveObservabilityStorePath } from "./helpers";
import { parseBenchRunArgs } from "./parsers";
import { getSessionObservabilityHandle } from "./session";
import type { McpToolContext } from "./tool-context";
import { probeGatewayHealthAtHost } from "./gateway-tools";
import { closeObservabilityServiceHandle } from "../observability/runtime-loader";

const DEFAULT_MCP_BENCH_RUN_MAX_DURATION_MS = 15 * 60 * 1000;

function resolveMcpBenchRunMaxDurationMs(): number {
  const raw = getNonEmptyEnvValue("SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS");
  if (raw === null) {
    return DEFAULT_MCP_BENCH_RUN_MAX_DURATION_MS;
  }

  return parseCanonicalPositiveInteger(raw) ?? DEFAULT_MCP_BENCH_RUN_MAX_DURATION_MS;
}

export function resolveMcpBenchRunMaxDurationMsForTests(): number {
  return resolveMcpBenchRunMaxDurationMs();
}

export function createMcpBenchmarkOperationAbortSignal(options: {
  sessionSignal?: AbortSignal;
  timeoutMessage: string;
}): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(resolveMcpBenchRunMaxDurationMs());
  const timeoutController = new AbortController();
  timeoutSignal.addEventListener(
    "abort",
    () => {
      timeoutController.abort(new BenchmarkCancelledError(options.timeoutMessage, "aborted"));
    },
    { once: true }
  );

  return options.sessionSignal ? AbortSignal.any([options.sessionSignal, timeoutController.signal]) : timeoutController.signal;
}

function createBenchRunAbortSignal(sessionSignal?: AbortSignal): AbortSignal {
  return createMcpBenchmarkOperationAbortSignal({
    sessionSignal,
    timeoutMessage: "MCP bench_run exceeded the wall-clock limit"
  });
}

export async function preflightGatewayBench(configPath?: string): Promise<
  | {
      ok: true;
      sourcePath: string;
      sourceFile: string;
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
      sourcePath: string;
      sourceFile: string;
      bindHost: string;
      port: number | null;
      probeHost: string;
      healthUrl: string | null;
      pid: number | null;
      latencyMs: number | null;
    }
> {
  const sourcePath = resolveCliConfigPath(configPath);
  const sourceFile = path.basename(sourcePath);
  let config;

  try {
    config = loadConfig(configPath);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_config",
      message: (error as Error).message,
      sourcePath,
      sourceFile,
      bindHost: "127.0.0.1",
      port: null,
      probeHost: normalizeHealthProbeHost("127.0.0.1"),
      healthUrl: null,
      pid: null,
      latencyMs: null
    };
  }

  const bindHost = config.bindHost;
  const port = config.port;

  const probe = await probeGatewayHealthAtHost(bindHost, port);

  if (!probe.running) {
    return {
      ok: false,
      code: "gateway_unavailable",
      message: `Gateway test preflight failed: ${probe.reason ?? "gateway is not responding"}`,
      sourcePath,
      sourceFile,
      bindHost,
      port,
      probeHost: probe.probe_host,
      healthUrl: buildLocalHttpUrl(probe.probe_host, port, "/health"),
      pid: probe.pid ?? null,
      latencyMs: probe.latency_ms ?? null
    };
  }

  return {
    ok: true,
    sourcePath,
    sourceFile,
    bindHost,
    port,
    probeHost: probe.probe_host,
    healthUrl: buildLocalHttpUrl(probe.probe_host, port, "/health"),
    pid: probe.pid ?? null,
    latencyMs: probe.latency_ms ?? null
  };
}

export async function buildBenchRunToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const args = parseBenchRunArgs(context.params);

  try {
    const prompt = args.prompt;
    const routeNames = args.routeNames;
    const iterations = args.iterations ?? 3;
    const warmup = args.warmup ?? 1;
    const concurrency = args.concurrency ?? 1;
    const pathModeValue = args.pathModeValue ?? "both";
    const timeoutMs = args.timeoutMs;
    const abortSignal = createBenchRunAbortSignal(context.sessionContext?.abortSignal);
    const storePath = resolveObservabilityStorePath();
    const ownsHandle = typeof context.sessionContext === "undefined";
    const benchmarkRuns = createOstrichBenchmarkRunPort({
      open: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: true }),
      close: (handle) => {
        if (ownsHandle) {
          closeObservabilityServiceHandle(handle);
        }
      }
    });
    const config = loadConfig(context.configPath);

    for (const routeName of routeNames) {
      if (!config.routes[routeName]) {
        return buildMcpErrorEnvelope("bench", MCP_ENTITY_STATE_ERROR_CODES.routeNotFound, `Route '${routeName}' was not found`);
      }
    }

    const benchmarkRunResult = await benchmarkRuns.run({
      dbPath: storePath,
      config,
      routeNames,
      prompt,
      iterations,
      warmup,
      concurrency,
      pathMode: pathModeValue,
      timeoutMs,
      preflightGateway: () => preflightGatewayBench(context.configPath),
      createdBy: "switchmaxxer mcp",
      objective: "route_benchmark",
      storePath,
      signal: abortSignal,
      statusForError: () => "failed",
      taskPlanCommandName: "bench_run",
      invalidInputFieldCode: APP_ERROR_CODES.invalidInputField
    });
    if (!benchmarkRunResult.storeFound || !benchmarkRunResult.result) {
      throw new Error("Unable to open observability store");
    }

    const runnerResult = benchmarkRunResult.result;
    if (!runnerResult.ok) {
      if (runnerResult.failure.kind === "usage") {
        return buildMcpErrorEnvelope(
          "bench",
          APP_ERROR_CODES.invalidInputField,
          runnerResult.failure.message
        );
      }

      return buildMcpErrorEnvelope(
        "bench",
        runnerResult.failure.code === "gateway_unavailable"
          ? APP_ERROR_CODES.gatewayUnavailable
          : APP_ERROR_CODES.invalidConfig,
        runnerResult.failure.message,
        {
          details: runnerResult.failure.details
        }
      );
    }

    return buildSuccessEnvelope("bench", runnerResult.report, {
      top_level: {
        sample_count: runnerResult.sampleViews.length
      }
    });
  } catch (error) {
    return toEnvelopeFromError("bench", error, APP_ERROR_CODES.benchError);
  }
}
