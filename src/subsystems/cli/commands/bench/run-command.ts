import { BenchmarkCancelledError } from "../../../bench/bench-runtime";
import { assertBenchmarkTaskPlanSize } from "../../../observability/bench-limits";
import {
  BENCH_ROUTE_SELECTION_ISSUES,
  normalizeBenchRouteSelection
} from "../../../observability/bench-route-selection";
import { APP_ERROR_CODES, type AppErrorCode } from "../../../../platform/error-codes";
import { buildErrorEnvelope } from "../../../../platform/response-envelope";
import {
  type BenchmarkExecutionPlanResult,
  type BenchmarkRunnerDeps,
  type BenchmarkTaskResult
} from "../../../observability/bench-runner";
import { renderBenchReportText } from "./read-commands";
import {
  buildBenchmarkPrompt,
  parseBenchArgs,
  type BenchPathMode,
  validateBenchExecutionContract,
  waitForBenchDrainAfterAbort,
  writeBenchReportOutput
} from "./run-command-support";

import type { BenchmarkPreflightResult, BenchmarkRunTask } from "../../../bench/bench-runtime";
import type { BenchmarkReportView } from "../../../observability/contracts";
import type { BenchmarkRunRecord, BenchmarkRunSummary, BenchmarkSampleRecord } from "../../../observability/benchmarks";
import type { ObservabilityBenchmarkRunPort } from "../../../observability/observability-module";
import type { ObservabilityService } from "../../../observability/service";
import type { AppConfig } from "../../../../platform/types";

export type { BenchPathMode } from "./run-command-support";

const BENCH_CANCEL_DRAIN_TIMEOUT_MS = 5_000;

export type BenchRunCommandDeps = {
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonErrorEnvelope: (
    commandName: string,
    code: AppErrorCode,
    message: string,
    metadata?: Record<string, unknown>
  ) => void;
  writeJsonSuccessEnvelope: (
    commandName: string,
    payload: unknown,
    metadata?: Record<string, unknown>
  ) => void;
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string
  ) => { value?: unknown; consumed: number; errorMessage?: string } | null;
  assertBenchmarkPromptLength: (prompt: string, commandName: "bench" | "bench_run") => void;
  benchLimits: {
    maxConcurrency: number;
    maxIterations: number;
    maxPromptLength: number;
    maxRoutes: number;
  };
  defaultCliFetchTimeoutMs: number;
  benchmarkRuns: ObservabilityBenchmarkRunPort;
  resolveObservabilityStorePath: () => string;
  loadConfig: (configPath?: string) => AppConfig;
  preflightGatewayRouteTests: (configPath?: string) => Promise<BenchmarkPreflightResult>;
  resolveBenchmarkExecutionPlan: (
    pathMode: BenchPathMode,
    preflight: () => Promise<BenchmarkPreflightResult>
  ) => Promise<BenchmarkExecutionPlanResult>;
  buildBenchTasks: (
    routeNames: string[],
    effectivePathMode: BenchPathMode,
    warmup: number,
    iterations: number
  ) => BenchmarkRunTask[];
  executeBenchmarkTask: (options: {
    service: ObservabilityService;
    config: AppConfig;
    routeName: string;
    route: AppConfig["routes"][string];
    prompt: string;
    benchmarkRunId: string;
    task: BenchmarkRunTask;
    bindHost: string;
    port: number;
    createdBy: string;
    signal?: AbortSignal;
  }) => Promise<BenchmarkTaskResult>;
  runTasksWithConcurrency: <T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
    options?: {
      signal?: AbortSignal;
    }
  ) => Promise<T[]>;
  toBenchmarkRunView: (
    run: BenchmarkRunRecord,
    summary: BenchmarkRunSummary
  ) => Record<string, unknown> & { summary: BenchmarkRunSummary };
  toBenchmarkSampleView: (sample: BenchmarkSampleRecord) => Record<string, unknown>;
  buildBenchmarkReportView: (payload: {
    store_path?: string;
    run: Record<string, unknown>;
    summary: BenchmarkRunSummary;
    rawSamples: BenchmarkSampleRecord[];
    samples?: Array<Record<string, unknown>>;
  }) => BenchmarkReportView;
  classifyCliUsageFailure: (
    error: unknown,
    options: {
      usageFallbackCode: string;
      mutationFallbackCode: string;
      isUsageMessage: (message: string) => boolean;
    }
  ) => { message: string; code: string; exitCode: number };
  noUsageMessageMatch: (message: string) => boolean;
  mcpUsageErrorCodes: {
    missingRequiredField: string;
    invalidInputField: string;
    invalidFlagValue: string;
  };
  mcpEntityStateErrorCodes: {
    routeNotFound: string;
  };
  createCliUsageError: (code: string, message: string) => Error;
};

export function createBenchRunCommand(deps: BenchRunCommandDeps): {
  runBenchRun: (argv: string[]) => Promise<number>;
} {
  async function runBenchRun(argv: string[]): Promise<number> {
    const parsedArgs = parseBenchArgs(argv, {
      readLongFlagValue: deps.readLongFlagValue
    });
    const timeoutMs = parsedArgs.timeoutMs ?? deps.defaultCliFetchTimeoutMs;

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const abortController = new AbortController();
    const onSigint = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new BenchmarkCancelledError("Benchmark run cancelled by SIGINT", "SIGINT"));
      }
    };
    process.once("SIGINT", onSigint);
    let dbPath = "";

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const prompt = buildBenchmarkPrompt(parsedArgs, {
        assertBenchmarkPromptLength: deps.assertBenchmarkPromptLength,
        maxPromptLength: deps.benchLimits.maxPromptLength,
        createCliUsageError: deps.createCliUsageError,
        missingRequiredFieldCode: deps.mcpUsageErrorCodes.missingRequiredField,
        invalidInputFieldCode: deps.mcpUsageErrorCodes.invalidInputField
      });
      const normalizedSelection = normalizeBenchRouteSelection({
        routeName: parsedArgs.route,
        routeNames: typeof parsedArgs.routesCsv === "string" ? parsedArgs.routesCsv.split(",") : undefined,
        maxRoutes: deps.benchLimits.maxRoutes
      });
      if (!normalizedSelection.ok) {
        switch (normalizedSelection.issue) {
          case BENCH_ROUTE_SELECTION_ISSUES.conflictingSelectors:
            throw deps.createCliUsageError(
              deps.mcpUsageErrorCodes.invalidInputField,
              "Use either '--route' or '--routes', not both"
            );
          case BENCH_ROUTE_SELECTION_ISSUES.missingSelector:
            throw deps.createCliUsageError(
              deps.mcpUsageErrorCodes.missingRequiredField,
              "One of '--route' or '--routes' is required"
            );
          case BENCH_ROUTE_SELECTION_ISSUES.invalidRouteList:
            throw deps.createCliUsageError(
              deps.mcpUsageErrorCodes.missingRequiredField,
              "At least one route is required for 'bench'"
            );
          case BENCH_ROUTE_SELECTION_ISSUES.tooManyRoutes:
            throw deps.createCliUsageError(
              deps.mcpUsageErrorCodes.invalidInputField,
              `Flag '--routes' may include at most ${deps.benchLimits.maxRoutes} routes for 'bench'`
            );
        }
      }
      const routeNames = normalizedSelection.routeNames;
      const iterations = parsedArgs.iterations ?? 3;
      const warmup = parsedArgs.warmup ?? 1;
      const concurrency = parsedArgs.concurrency ?? 1;

      validateBenchExecutionContract({
        iterations,
        concurrency,
        prompt,
        maxPromptLength: deps.benchLimits.maxPromptLength,
        maxIterations: deps.benchLimits.maxIterations,
        maxConcurrency: deps.benchLimits.maxConcurrency,
        assertBenchmarkPromptLength: deps.assertBenchmarkPromptLength,
        createCliUsageError: deps.createCliUsageError,
        invalidInputFieldCode: deps.mcpUsageErrorCodes.invalidInputField,
        invalidFlagValueCode: deps.mcpUsageErrorCodes.invalidFlagValue
      });
      try {
        assertBenchmarkTaskPlanSize(
          {
            routeCount: routeNames.length,
            pathMode: parsedArgs.pathMode,
            warmup,
            iterations
          },
          "bench"
        );
      } catch (error) {
        throw deps.createCliUsageError(
          deps.mcpUsageErrorCodes.invalidInputField,
          error instanceof Error ? error.message : "Benchmark plan exceeds the supported task limit"
        );
      }

      const config = deps.loadConfig(parsedArgs.configPath);

      for (const routeName of routeNames) {
        if (!config.routes[routeName]) {
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope(
              "bench",
              deps.mcpEntityStateErrorCodes.routeNotFound as AppErrorCode,
              `Route '${routeName}' was not found`
            );
            return 1;
          }

          deps.writeStderr(`Bench failed: Route '${routeName}' was not found`);
          return 1;
        }
      }

      const runnerDeps: BenchmarkRunnerDeps = {
        resolveBenchmarkExecutionPlan: deps.resolveBenchmarkExecutionPlan,
        buildBenchTasks: deps.buildBenchTasks,
        executeBenchmarkTask: deps.executeBenchmarkTask,
        runTasksWithConcurrency: deps.runTasksWithConcurrency,
        toBenchmarkRunView: deps.toBenchmarkRunView,
        toBenchmarkSampleView: deps.toBenchmarkSampleView,
        buildBenchmarkReportView: deps.buildBenchmarkReportView
      };
      const benchmarkRunResult = await deps.benchmarkRuns.run({
        dbPath,
        config,
        routeNames,
        prompt,
        iterations,
        warmup,
        concurrency,
        pathMode: parsedArgs.pathMode,
        timeoutMs,
        preflightGateway: () => deps.preflightGatewayRouteTests(parsedArgs.configPath),
        createdBy: "switchmaxxer bench",
        objective: "route_benchmark",
        signal: abortController.signal,
        waitForDrainAfterAbort: (promise, signal) =>
          waitForBenchDrainAfterAbort(promise, signal, BENCH_CANCEL_DRAIN_TIMEOUT_MS),
        statusForError: (error) => (error instanceof BenchmarkCancelledError ? "cancelled" : "failed"),
        taskPlanCommandName: "bench",
        invalidInputFieldCode: deps.mcpUsageErrorCodes.invalidInputField,
        deps: runnerDeps
      });
      if (!benchmarkRunResult.storeFound || !benchmarkRunResult.result) {
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("bench", APP_ERROR_CODES.benchError, `Observability store could not be opened at '${dbPath}'`, {
            details: { store_path: dbPath }
          });
          return 1;
        }

        deps.writeStderr(`Bench failed: Observability store could not be opened at '${dbPath}'`);
        return 1;
      }

      const runnerResult = benchmarkRunResult.result;
      if (!runnerResult.ok) {
        if (runnerResult.failure.kind === "usage") {
          if (parsedArgs.json) {
            deps.writeJson(buildErrorEnvelope("bench", runnerResult.failure.code as AppErrorCode, runnerResult.failure.message));
            return 2;
          }

          deps.printUsageError(runnerResult.failure.message);
          return 2;
        }

        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("bench", runnerResult.failure.code as AppErrorCode, runnerResult.failure.message, {
            details: runnerResult.failure.details
          });
          return 1;
        }

        deps.writeStderr(`Bench failed: ${runnerResult.failure.message}`);
        return 1;
      }

      const report = runnerResult.report;
      const textReport = renderBenchReportText(report);
      writeBenchReportOutput(parsedArgs.outputPath, report, textReport, parsedArgs.json);

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope("bench", report, {
          top_level: {
            sample_count: runnerResult.sampleViews.length
          }
        });
        return runnerResult.summary.failed_count === 0 ? 0 : 1;
      }

      deps.writeStdout(textReport);
      return runnerResult.summary.failed_count === 0 ? 0 : 1;
    } catch (error) {
      if (error instanceof BenchmarkCancelledError) {
        if (parsedArgs.json) {
          deps.writeJson(
            buildErrorEnvelope("bench", APP_ERROR_CODES.benchError, error.message, {
              details: {
                cancel_reason: error.reason
              }
            })
          );
          return error.exitCode;
        }

        deps.writeStderr(`Bench cancelled: ${error.message}`);
        return error.exitCode;
      }

      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      const classified = deps.classifyCliUsageFailure(
        timedOut ? new Error(`Benchmark request timed out after ${timeoutMs}ms`) : error,
        {
          usageFallbackCode: APP_ERROR_CODES.benchError,
          mutationFallbackCode: APP_ERROR_CODES.benchError,
          isUsageMessage: deps.noUsageMessageMatch
        }
      );

      if (parsedArgs.json) {
        deps.writeJson(buildErrorEnvelope("bench", classified.code as AppErrorCode, classified.message));
        return classified.exitCode;
      }

      if (classified.exitCode === 2) {
        deps.printUsageError(classified.message);
        return 2;
      }

      deps.writeStderr(`Bench failed: ${classified.message}`);
      return classified.exitCode;
    } finally {
      process.removeListener("SIGINT", onSigint);
    }
  }

  return {
    runBenchRun
  };
}
