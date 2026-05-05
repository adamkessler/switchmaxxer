import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  BENCH_MAX_CONCURRENCY,
  BENCH_MAX_ITERATIONS,
  BENCH_MAX_PROMPT_LENGTH
} from "../../../observability/bench-limits";
import { BenchmarkCancelledError } from "../../../bench/bench-runtime";
import type { BenchmarkRunnerResult } from "../../../observability/bench-runner";
import {
  buildCostOptimizeExecution,
  buildLatencyOptimizeReport,
  normalizeOptimizeRoutesCsv,
  selectOptimizeCandidateRoutes,
  type OptimizeReportView
} from "../../../observability/optimize-report-builder";
import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import type { OptimizeRunArgs } from "../../command-args-optimize";
import { waitForBenchDrainAfterAbort } from "../bench/run-command-support";
import { writeOptimizeFailure } from "./optimize-errors";
import { renderOptimizeReportText } from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";

function writeOptimizeReportOutput(parsedArgs: OptimizeRunArgs, report: OptimizeReportView, text: string): void {
  if (!parsedArgs.outputPath) {
    return;
  }

  const resolvedPath = path.resolve(parsedArgs.outputPath);
  writeFileSync(resolvedPath, parsedArgs.json ? `${JSON.stringify(report, null, 2)}\n` : `${text}\n`, "utf8");
}

function buildOptimizeBenchmarkPrompt(
  deps: Pick<OptimizeCliDeps, "printUsageError">,
  parsedArgs: OptimizeRunArgs
): { ok: true; prompt: string } | { ok: false; exitCode: 2 } {
  if (typeof parsedArgs.prompt === "string" && typeof parsedArgs.filePath === "string") {
    deps.printUsageError("Use either '--prompt' or '--file', not both");
    return { ok: false, exitCode: 2 };
  }

  let prompt: string;
  if (typeof parsedArgs.prompt === "string") {
    prompt = parsedArgs.prompt;
  } else if (typeof parsedArgs.filePath === "string") {
    prompt = readFileSync(parsedArgs.filePath, "utf8");
  } else {
    deps.printUsageError("One of '--prompt' or '--file' is required for latency optimization");
    return { ok: false, exitCode: 2 };
  }

  if (prompt.length > BENCH_MAX_PROMPT_LENGTH) {
    deps.printUsageError(`Benchmark prompt must be at most ${BENCH_MAX_PROMPT_LENGTH} characters for 'optimize'`);
    return { ok: false, exitCode: 2 };
  }

  return { ok: true, prompt };
}

function validateLatencyOptimizeExecution(
  deps: Pick<OptimizeCliDeps, "printUsageError">,
  iterations: number,
  concurrency: number
): boolean {
  if (iterations > BENCH_MAX_ITERATIONS) {
    deps.printUsageError(`Flag '--iterations' must be at most ${BENCH_MAX_ITERATIONS} for 'optimize'`);
    return false;
  }

  if (concurrency > BENCH_MAX_CONCURRENCY) {
    deps.printUsageError(`Flag '--concurrency' must be at most ${BENCH_MAX_CONCURRENCY} for 'optimize'`);
    return false;
  }

  return true;
}

function writeOptimizeRunnerFailure(
  deps: Pick<OptimizeCliDeps, "printUsageError" | "writeJsonErrorEnvelope" | "writeStderr">,
  json: boolean,
  runnerResult: Extract<BenchmarkRunnerResult, { ok: false }>
): number {
  if (runnerResult.failure.kind === "usage") {
    if (json) {
      deps.writeJsonErrorEnvelope("optimize", runnerResult.failure.code, runnerResult.failure.message);
      return 2;
    }

    deps.printUsageError(runnerResult.failure.message);
    return 2;
  }

  if (json) {
    deps.writeJsonErrorEnvelope("optimize", runnerResult.failure.code, runnerResult.failure.message, {
      details: runnerResult.failure.details
    });
    return 1;
  }

  deps.writeStderr(`Optimize failed: ${runnerResult.failure.message}`);
  return 1;
}

function runCostOptimize(deps: OptimizeCliDeps, parsedArgs: OptimizeRunArgs, requestedRoutes: string[] | null): number {
  try {
    const readModel = deps.loadCliReadModel(parsedArgs.configPath);
    const referenceTokens = {
      input_tokens: parsedArgs.inputTokens,
      output_tokens: parsedArgs.outputTokens,
      cache_read_tokens: parsedArgs.cacheReadTokens,
      cache_write_tokens: parsedArgs.cacheWriteTokens
    };
    const preparedReport = buildCostOptimizeExecution({
      readModel,
      modelId: parsedArgs.modelId ?? "",
      requestedRoutes,
      referenceTokens
    });
    if (!preparedReport.ok) {
      return writeOptimizeFailure(deps, parsedArgs.json, preparedReport.failure);
    }

    const dbPath = deps.resolveObservabilityStorePath();
    const persisted = deps.optimizationReports.persistCost({
      dbPath,
      report: preparedReport.report,
      candidateRoutes: preparedReport.candidateRoutes,
      requestedRoutes,
      referenceTokens,
      createdBy: "switchmaxxer optimize"
    });
    if (!persisted.storeFound || !persisted.report) {
      return writeOptimizeFailure(deps, parsedArgs.json, {
        code: APP_ERROR_CODES.optimizeError,
        message: `Observability store could not be opened at '${dbPath}'`,
        details: { store_path: dbPath }
      });
    }

    const persistedReport = persisted.report;
    const text = renderOptimizeReportText(persistedReport);
    writeOptimizeReportOutput(parsedArgs, persistedReport, text);

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("optimize", persistedReport, {
        count: persistedReport.ranking.length
      });
      return 0;
    }

    deps.writeStdout(text);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown optimize error";
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize", APP_ERROR_CODES.optimizeError, message);
      return 1;
    }

    deps.writeStderr(`Optimize failed: ${message}`);
    return 1;
  }
}

async function runLatencyOptimize(
  deps: OptimizeCliDeps,
  parsedArgs: OptimizeRunArgs,
  requestedRoutes: string[] | null
): Promise<number> {
  let promptResult: ReturnType<typeof buildOptimizeBenchmarkPrompt>;
  try {
    promptResult = buildOptimizeBenchmarkPrompt(deps, parsedArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown optimize error";
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize", APP_ERROR_CODES.optimizeError, message);
      return 1;
    }

    deps.writeStderr(`Optimize failed: ${message}`);
    return 1;
  }
  if (!promptResult.ok) {
    return promptResult.exitCode;
  }

  const iterations = parsedArgs.iterations ?? 3;
  const warmup = parsedArgs.warmup ?? 1;
  const concurrency = parsedArgs.concurrency ?? 1;
  const timeoutMs = parsedArgs.timeoutMs ?? deps.defaultCliFetchTimeoutMs;
  if (!validateLatencyOptimizeExecution(deps, iterations, concurrency)) {
    return 2;
  }

  const abortController = new AbortController();
  const onSigint = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new BenchmarkCancelledError("Optimize latency benchmark cancelled by SIGINT", "SIGINT"));
    }
  };
  process.once("SIGINT", onSigint);
  let dbPath = "";

  try {
    const readModel = deps.loadCliReadModel(parsedArgs.configPath);
    const selectedCandidates = selectOptimizeCandidateRoutes(readModel, parsedArgs.modelId ?? "", requestedRoutes);
    if (!selectedCandidates.ok) {
      return writeOptimizeFailure(deps, parsedArgs.json, selectedCandidates.failure);
    }

    dbPath = deps.resolveObservabilityStorePath();
    const config = deps.loadConfig(parsedArgs.configPath);
    const benchmarkRunResult = await deps.benchmarkRuns.run({
      dbPath,
      config,
      routeNames: selectedCandidates.routes.map((route) => route.name),
      prompt: promptResult.prompt,
      iterations,
      warmup,
      concurrency,
      pathMode: parsedArgs.pathMode,
      timeoutMs,
      preflightGateway: () => deps.preflightGatewayRouteTests(parsedArgs.configPath),
      createdBy: "switchmaxxer optimize",
      objective: "route_optimization",
      storePath: dbPath,
      signal: abortController.signal,
      waitForDrainAfterAbort: (promise, signal) => waitForBenchDrainAfterAbort(promise, signal, 5_000),
      statusForError: (error) => (error instanceof BenchmarkCancelledError ? "cancelled" : "failed"),
      taskPlanCommandName: "bench",
      invalidInputFieldCode: APP_ERROR_CODES.invalidInputField
    });
    if (!benchmarkRunResult.storeFound || !benchmarkRunResult.result) {
      return writeOptimizeFailure(deps, parsedArgs.json, {
        code: APP_ERROR_CODES.optimizeError,
        message: `Observability store could not be opened at '${dbPath}'`,
        details: { store_path: dbPath }
      });
    }

    const runnerResult = benchmarkRunResult.result;
    if (!runnerResult.ok) {
      return writeOptimizeRunnerFailure(deps, parsedArgs.json, runnerResult);
    }

    const reportResult = buildLatencyOptimizeReport({
      modelId: parsedArgs.modelId ?? "",
      requestedRoutes,
      candidateRoutes: selectedCandidates.routes,
      benchmarkRunId: runnerResult.benchmarkRunId,
      benchmarkSummary: runnerResult.summary,
      benchmarkExecution: runnerResult.report.execution,
      samples: runnerResult.samples
    });
    if (!reportResult.ok) {
      return writeOptimizeFailure(deps, parsedArgs.json, reportResult.failure);
    }

    const persisted = deps.optimizationReports.persistLatency({
      dbPath,
      report: reportResult.report,
      candidateRoutes: selectedCandidates.routes,
      requestedRoutes,
      createdBy: "switchmaxxer optimize",
      benchmarkRunId: runnerResult.benchmarkRunId,
      settings: {
        prompt_chars: promptResult.prompt.length,
        iterations,
        warmup,
        concurrency,
        timeout_ms: timeoutMs,
        path_mode: parsedArgs.pathMode
      }
    });
    if (!persisted.storeFound || !persisted.report) {
      return writeOptimizeFailure(deps, parsedArgs.json, {
        code: APP_ERROR_CODES.optimizeError,
        message: `Observability store could not be opened at '${dbPath}'`,
        details: { store_path: dbPath }
      });
    }

    const persistedReport = persisted.report;
    const text = renderOptimizeReportText(persistedReport);
    writeOptimizeReportOutput(parsedArgs, persistedReport, text);

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("optimize", persistedReport, {
        count: persistedReport.ranking.length
      });
      return runnerResult.summary.failed_count === 0 ? 0 : 1;
    }

    deps.writeStdout(text);
    return runnerResult.summary.failed_count === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof BenchmarkCancelledError) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("optimize", APP_ERROR_CODES.optimizeError, error.message, {
          details: { cancel_reason: error.reason }
        });
        return error.exitCode;
      }

      deps.writeStderr(`Optimize cancelled: ${error.message}`);
      return error.exitCode;
    }

    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    const message = timedOut
      ? `Optimize benchmark request timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : "Unknown optimize error";
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize", APP_ERROR_CODES.optimizeError, message, {
        details: { store_path: dbPath || null }
      });
      return 1;
    }

    deps.writeStderr(`Optimize failed: ${message}`);
    return 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

export async function runOptimize(deps: OptimizeCliDeps, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeRunArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  if (typeof parsedArgs.modelId !== "string" || parsedArgs.modelId.trim().length === 0) {
    deps.printUsageError("Flag '--model' is required");
    return 2;
  }

  if (typeof parsedArgs.objective !== "string" || parsedArgs.objective.trim().length === 0) {
    deps.printUsageError("Flag '--objective' is required");
    return 2;
  }

  if (parsedArgs.objective !== "cost" && parsedArgs.objective !== "latency") {
    deps.printUsageError("Flag '--objective' must be one of cost or latency");
    return 2;
  }

  const requestedRoutesResult = normalizeOptimizeRoutesCsv(parsedArgs.routesCsv);
  if (requestedRoutesResult.errorMessage) {
    deps.printUsageError(requestedRoutesResult.errorMessage);
    return 2;
  }

  const requestedRoutes = requestedRoutesResult.routes ?? null;
  if (parsedArgs.objective === "latency") {
    return await runLatencyOptimize(deps, parsedArgs, requestedRoutes);
  }

  return runCostOptimize(deps, parsedArgs, requestedRoutes);
}
