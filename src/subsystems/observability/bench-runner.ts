import { randomUUID } from "node:crypto";

import { runTasksWithConcurrency } from "../../platform/concurrency";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import type { AppConfig } from "../../platform/types";
import { assertBenchmarkTaskPlanSize } from "./bench-limits";
import type { BenchmarkRunRecord, BenchmarkRunSummary, BenchmarkSampleRecord } from "./benchmarks";
import type { BenchmarkReportView } from "./contracts";
import {
  buildBenchmarkReportView,
  toBenchmarkRunView,
  toBenchmarkSampleView
} from "./contracts";
import {
  buildBenchTasks,
  executeBenchmarkTask,
  resolveBenchmarkExecutionPlan,
  type BenchmarkExecutionPlan,
  type BenchmarkPreflightResult,
  type BenchmarkRunTask
} from "../bench/bench-runtime";
import type { ObservabilityService } from "./service";
import type { BenchmarkRunStatus } from "./types";

export type BenchmarkPathMode = "gateway" | "direct" | "both";

export type BenchmarkExecutionPlanResult =
  | {
      ok: true;
      plan: BenchmarkExecutionPlan;
    }
  | {
      ok: false;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

export type BenchmarkTaskResult = {
  sample: BenchmarkSampleRecord;
  requestExecution: ReturnType<ObservabilityService["getRequestExecution"]>;
};

export type BenchmarkRunnerFailure =
  | {
      kind: "execution_plan";
      code: string;
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      kind: "usage";
      code: string;
      message: string;
    };

export type BenchmarkRunnerResult =
  | {
      ok: true;
      benchmarkRunId: string;
      run: BenchmarkRunRecord;
      summary: BenchmarkRunSummary;
      samples: BenchmarkSampleRecord[];
      sampleViews: Array<Record<string, unknown>>;
      report: BenchmarkReportView;
    }
  | {
      ok: false;
      failure: BenchmarkRunnerFailure;
    };

export type BenchmarkRunnerDeps = {
  resolveBenchmarkExecutionPlan: (
    pathMode: BenchmarkPathMode,
    preflight: () => Promise<BenchmarkPreflightResult>
  ) => Promise<BenchmarkExecutionPlanResult>;
  buildBenchTasks: (
    routeNames: string[],
    effectivePathMode: BenchmarkPathMode,
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
};

export const DEFAULT_BENCHMARK_RUNNER_DEPS: BenchmarkRunnerDeps = {
  resolveBenchmarkExecutionPlan,
  buildBenchTasks,
  executeBenchmarkTask,
  runTasksWithConcurrency,
  toBenchmarkRunView,
  toBenchmarkSampleView,
  buildBenchmarkReportView
};

function effectivePathModeFromPlan(plan: BenchmarkExecutionPlan): BenchmarkPathMode {
  if (plan.effectivePaths.length === 2) {
    return "both";
  }

  return plan.effectivePaths[0] === "direct" ? "direct" : "gateway";
}

function defaultFailureStatus(error: unknown): BenchmarkRunStatus {
  return error instanceof Error && error.name === "BenchmarkCancelledError" ? "cancelled" : "failed";
}

export async function runBenchmarkOperation(options: {
  service: ObservabilityService;
  config: AppConfig;
  routeNames: string[];
  prompt: string;
  iterations: number;
  warmup: number;
  concurrency: number;
  pathMode: BenchmarkPathMode;
  timeoutMs?: number;
  preflightGateway: () => Promise<BenchmarkPreflightResult>;
  createdBy: string;
  objective: string;
  storePath?: string;
  signal?: AbortSignal;
  waitForDrainAfterAbort?: (
    promise: Promise<BenchmarkTaskResult[]>,
    signal: AbortSignal
  ) => Promise<BenchmarkTaskResult[]>;
  statusForError?: (error: unknown) => BenchmarkRunStatus;
  taskPlanCommandName: "bench" | "bench_run" | "optimize" | "optimize_run";
  invalidInputFieldCode?: string;
  deps?: BenchmarkRunnerDeps;
}): Promise<BenchmarkRunnerResult> {
  const deps = options.deps ?? DEFAULT_BENCHMARK_RUNNER_DEPS;
  const executionPlanResult = await deps.resolveBenchmarkExecutionPlan(options.pathMode, options.preflightGateway);

  if (!executionPlanResult.ok) {
    return {
      ok: false,
      failure: {
        kind: "execution_plan",
        code: executionPlanResult.code,
        message: executionPlanResult.message,
        details: executionPlanResult.details
      }
    };
  }

  const executionPlan = executionPlanResult.plan;
  const effectivePathMode = effectivePathModeFromPlan(executionPlan);

  try {
    assertBenchmarkTaskPlanSize(
      {
        routeCount: options.routeNames.length,
        pathMode: effectivePathMode,
        warmup: options.warmup,
        iterations: options.iterations
      },
      options.taskPlanCommandName
    );
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: "usage",
        code: options.invalidInputFieldCode ?? APP_ERROR_CODES.invalidInputField,
        message: error instanceof Error ? error.message : "Benchmark plan exceeds the supported task limit"
      }
    };
  }

  const benchmarkRunId = randomUUID();
  const createdAt = new Date().toISOString();
  const effectiveConfig =
    typeof options.timeoutMs === "number" ? { ...options.config, timeoutMs: options.timeoutMs } : options.config;
  const tasks = deps.buildBenchTasks(options.routeNames, effectivePathMode, options.warmup, options.iterations);
  const runRecord: BenchmarkRunRecord = {
    id: benchmarkRunId,
    name: `bench-${createdAt}`,
    created_at: createdAt,
    created_by: options.createdBy,
    objective: options.objective,
    notes: null,
    settings_json: JSON.stringify({
      route_names: options.routeNames,
      prompt_chars: options.prompt.length,
      iterations: options.iterations,
      warmup: options.warmup,
      concurrency: options.concurrency,
      timeout_ms: effectiveConfig.timeoutMs,
      requested_path_mode: options.pathMode,
      effective_path_mode: effectivePathMode,
      effective_paths: executionPlan.effectivePaths,
      skipped_paths: executionPlan.skippedPaths,
      warnings: executionPlan.warnings
    }),
    status: "running"
  };
  options.service.benchmarks.createRun(runRecord);

  const taskFns = tasks.map((task) => async () => {
    const route = effectiveConfig.routes[task.routeName];
    if (typeof route === "undefined") {
      throw new Error(`Route '${task.routeName}' was not found during benchmark execution`);
    }

    return await deps.executeBenchmarkTask({
      service: options.service,
      config: effectiveConfig,
      routeName: task.routeName,
      route,
      prompt: options.prompt,
      benchmarkRunId,
      task,
      bindHost: effectiveConfig.bindHost,
      port: effectiveConfig.port,
      createdBy: options.createdBy,
      signal: options.signal
    });
  });

  let results: BenchmarkTaskResult[];
  try {
    const runPromise = deps.runTasksWithConcurrency(taskFns, options.concurrency, {
      signal: options.signal
    });
    results =
      options.signal && options.waitForDrainAfterAbort
        ? await options.waitForDrainAfterAbort(runPromise, options.signal)
        : await runPromise;
    options.service.benchmarks.updateRunStatus(benchmarkRunId, "completed");
  } catch (error) {
    const statusForError = options.statusForError ?? defaultFailureStatus;
    options.service.benchmarks.updateRunStatus(benchmarkRunId, statusForError(error));
    throw error;
  }

  const summary = options.service.benchmarks.summarizeRun(benchmarkRunId);
  const run = options.service.benchmarks.getRun(benchmarkRunId);
  if (!run) {
    throw new Error(`Benchmark run '${benchmarkRunId}' was not found after execution`);
  }

  const runView = deps.toBenchmarkRunView(run, summary);
  const samples = results
    .map(({ sample }) => sample)
    .sort((left, right) => left.sample_index - right.sample_index);
  const sampleViews = samples.map((sample) => deps.toBenchmarkSampleView(sample));
  const report = deps.buildBenchmarkReportView({
    ...(typeof options.storePath === "string" ? { store_path: options.storePath } : {}),
    run: runView,
    summary,
    rawSamples: samples,
    samples: sampleViews
  });

  return {
    ok: true,
    benchmarkRunId,
    run,
    summary,
    samples,
    sampleViews,
    report
  };
}
