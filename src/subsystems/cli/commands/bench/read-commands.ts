import { APP_ERROR_CODES, type AppErrorCode } from "../../../../platform/error-codes";
import { parsePositiveIntegerFlagValue } from "../../command-arg-primitives";

import type {
  BenchmarkPathSummaryView,
  BenchmarkExecutionView,
  BenchmarkReportView
} from "../../../observability/contracts";
import type { BenchmarkRunRecord, BenchmarkRunSummary, BenchmarkSampleRecord } from "../../../observability/benchmarks";
import type { ObservabilityRuntimeHandle } from "../../../observability/runtime-loader";
import {
  cliErrorMessage,
  withObservabilityHandle
} from "../../observability-handle-lifecycle";

export interface BenchObservabilityService {
  benchmarks: {
    listRuns(limit: number): BenchmarkRunRecord[];
    summarizeRun(runId: string): BenchmarkRunSummary;
    getRun(runId: string): BenchmarkRunRecord | null;
    listSamplesByRun(runId: string): BenchmarkSampleRecord[];
  };
}

export type BenchObservabilityHandle = ObservabilityRuntimeHandle & {
  service: BenchObservabilityService;
};

export type BenchReadCommandDeps = {
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
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
  openExistingObservabilityService: (dbPath: string) => BenchObservabilityHandle | null;
  closeObservabilityServiceHandle: (handle: ObservabilityRuntimeHandle | null) => void;
  resolveObservabilityStorePath: () => string;
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

function parseBenchListArgs(deps: BenchReadCommandDeps, argv: string[]): {
  limit?: number;
  json: boolean;
  errorMessage?: string;
} {
  let limit: number | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    const parsedFlag = deps.readLongFlagValue(argv, index, "--limit");
    if (parsedFlag) {
      if (parsedFlag.errorMessage) {
        return { limit, json, errorMessage: parsedFlag.errorMessage };
      }

      const parsed = parsePositiveIntegerFlagValue(parsedFlag.value as string | undefined, "--limit");
      if (parsed.errorMessage || typeof parsed.value !== "number") {
        return { limit, json, errorMessage: "Flag '--limit' must be a positive integer" };
      }

      limit = parsed.value;
      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { limit, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { limit, json };
}

function parseBenchShowArgs(argv: string[]): {
  json: boolean;
  errorMessage?: string;
} {
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    return { json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { json };
}

export function renderBenchReportText(report: {
  run: Record<string, unknown> & { summary?: BenchmarkRunSummary };
  execution?: BenchmarkExecutionView;
  summary: BenchmarkRunSummary;
  analysis?: {
    by_path?: BenchmarkPathSummaryView[];
  };
  samples: Array<Record<string, unknown>>;
}): string {
  const lines = [
    `Benchmark Run: ${String(report.run["run_id"])}`,
    `Name: ${String(report.run["name"])}`,
    `Status: ${String(report.run["status"])}`,
    `Created At: ${String(report.run["created_at"])}`,
    `Measured Samples: ${report.summary.measured_samples}`,
    `Warmup Samples: ${report.summary.warmup_samples}`,
    `Success Count: ${report.summary.success_count}`,
    `Failed Count: ${report.summary.failed_count}`,
    `Average Latency Ms: ${report.summary.average_latency_ms ?? "-"}`,
    `Average TTFT Ms: ${report.summary.average_ttft_ms ?? "-"}`,
    `Average Duration Ms: ${report.summary.average_duration_ms ?? "-"}`
  ];

  if (report.execution) {
    lines.push(
      `Requested Path Mode: ${String(report.execution.requested_path_mode ?? "-")}`,
      `Effective Paths: ${Array.isArray(report.execution.effective_paths) ? report.execution.effective_paths.join(", ") : "-"}`,
      `Skipped Paths: ${
        Array.isArray(report.execution.skipped_paths) && report.execution.skipped_paths.length > 0
          ? report.execution.skipped_paths.join(", ")
          : "none"
      }`
    );

    if (Array.isArray(report.execution.warnings) && report.execution.warnings.length > 0) {
      lines.push("", "Warnings:");
      for (const warning of report.execution.warnings) {
        lines.push(
          `${String(warning.path ?? "-")} ${String(warning.code ?? "warning")}: ${String(
            warning.message ?? "unknown warning"
          )}`
        );
      }
    }
  }

  if (report.analysis?.by_path && report.analysis.by_path.length > 0) {
    lines.push("", "By Path:");
    for (const pathSummary of report.analysis.by_path) {
      lines.push(
        `${String(pathSummary.path)} measured=${String(pathSummary.measured_samples ?? "-")} success=${String(
          pathSummary.success_count ?? "-"
        )} failed=${String(pathSummary.failed_count ?? "-")} avg_latency_ms=${String(
          pathSummary.average_latency_ms ?? "-"
        )} warmup_median_latency_ms=${String(pathSummary.warmup_median_latency_ms ?? "-")} warmup_max_latency_ms=${String(
          pathSummary.warmup_max_latency_ms ?? "-"
        )} first_measured_latency_ms=${String(pathSummary.first_measured_latency_ms ?? "-")} first_measured_suspect=${String(
          pathSummary.first_measured_suspect ?? false
        )}`
      );
      if (Array.isArray(pathSummary.warmup_latency_ms) && pathSummary.warmup_latency_ms.length > 0) {
        lines.push(`warmup_latency_ms=${pathSummary.warmup_latency_ms.join(",")}`);
      }
    }
  }

  if (report.samples.length > 0) {
    lines.push("", "Samples:");
    for (const sample of report.samples) {
      lines.push(
        `${String(sample["sample_index"])}  run=${String(sample["benchmark_run_id"])}  outcome=${String(
          sample["outcome"]
        )}  latency_ms=${String(sample["latency_ms"] ?? "-")}  warmup=${String(sample["is_warmup"])}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createBenchReadCommands(deps: BenchReadCommandDeps): {
  runBenchList: (argv: string[]) => Promise<number>;
  runBenchShow: (runId: string, argv: string[]) => Promise<number>;
} {
  async function runBenchList(argv: string[]): Promise<number> {
    const parsedArgs = parseBenchListArgs(deps, argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    return await withObservabilityHandle<BenchObservabilityHandle>(
      deps,
      {
        openHandle: deps.openExistingObservabilityService,
        onError: ({ error, dbPath }) => {
          const message = cliErrorMessage(error, "Unknown bench list error");
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench list", APP_ERROR_CODES.benchListError, message, {
              details: { store_path: dbPath || null }
            });
            return 1;
          }

          deps.writeStderr(`Bench list failed: ${message}`);
          return 1;
        }
      },
      ({ dbPath, handle }) => {
        const runs = handle?.service.benchmarks.listRuns(parsedArgs.limit ?? 25) ?? [];
        const runViews = runs.map((run) => deps.toBenchmarkRunView(run, handle!.service.benchmarks.summarizeRun(run.id)));

        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope(
            "bench list",
            {
              store_path: dbPath,
              runs: runViews
            },
            {
              count: runViews.length,
              warnings: handle ? undefined : ["No observability store was found yet."]
            }
          );
          return 0;
        }

        if (!handle || runViews.length === 0) {
          deps.writeStdout(`Benchmark runs (0)\nStore: ${dbPath}\n\nNo benchmark runs yet.\n`);
          return 0;
        }

        const lines = [`Benchmark runs (${runViews.length})`, `Store: ${dbPath}`];
        for (const runView of runViews) {
          const summary = runView.summary;
          lines.push(
            "",
            `${String(runView["run_id"])}  status=${String(runView["status"])} measured=${summary.measured_samples} avg_latency_ms=${String(
              summary.average_latency_ms ?? "-"
            )}`
          );
        }
        deps.writeStdout(`${lines.join("\n")}\n`);
        return 0;
      }
    );
  }

  async function runBenchShow(runId: string, argv: string[]): Promise<number> {
    const parsedArgs = parseBenchShowArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    return await withObservabilityHandle<BenchObservabilityHandle>(
      deps,
      {
        openHandle: deps.openExistingObservabilityService,
        onError: ({ error, dbPath }) => {
          const message = cliErrorMessage(error, "Unknown bench show error");
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench show", APP_ERROR_CODES.benchShowError, message, {
              details: { store_path: dbPath || null, run_id: runId }
            });
            return 1;
          }

          deps.writeStderr(`Bench show failed: ${message}`);
          return 1;
        }
      },
      ({ dbPath, handle }) => {
        if (!handle) {
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench show", APP_ERROR_CODES.benchNotFound, `Benchmark run '${runId}' was not found`, {
              details: { store_path: dbPath }
            });
            return 1;
          }

          deps.writeStderr(`Benchmark run '${runId}' was not found.`);
          return 1;
        }

        const run = handle.service.benchmarks.getRun(runId);
        if (!run) {
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench show", APP_ERROR_CODES.benchNotFound, `Benchmark run '${runId}' was not found`, {
              details: { store_path: dbPath }
            });
            return 1;
          }

          deps.writeStderr(`Benchmark run '${runId}' was not found.`);
          return 1;
        }

        const summary = handle.service.benchmarks.summarizeRun(runId);
        const rawSamples = handle.service.benchmarks.listSamplesByRun(runId);
        const samples = rawSamples.map((sample) => deps.toBenchmarkSampleView(sample));
        const runView = deps.toBenchmarkRunView(run, summary);
        const report = deps.buildBenchmarkReportView({
          store_path: dbPath,
          run: runView,
          summary,
          rawSamples,
          samples
        });

        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope("bench show", report, {
            top_level: {
              sample_count: samples.length
            }
          });
          return 0;
        }

        deps.writeStdout(
          renderBenchReportText({
            run: runView,
            execution: report.execution,
            summary,
            analysis: report.analysis,
            samples
          })
        );
        return 0;
      }
    );
  }

  return {
    runBenchList,
    runBenchShow
  };
}
