import { APP_ERROR_CODES, type AppErrorCode } from "../../../../platform/error-codes";
import { retentionDurationToCutoffIso } from "../../../../platform/retention-duration";
import type { ObservabilityRuntimeHandle } from "../../../observability/runtime-loader";
import {
  PRUNE_OLDER_THAN_MESSAGE,
  validatePruneOlderThan
} from "../../../observability/prune-validation";
import type { BenchmarkHistoryDeleteResult } from "../../../observability/service";
import {
  cliErrorMessage,
  withObservabilityHandle
} from "../../observability-handle-lifecycle";

type BenchMaintenanceArgs = {
  json: boolean;
  errorMessage?: string;
};

type BenchPruneArgs = BenchMaintenanceArgs & {
  olderThan?: string;
};

export type BenchMaintenanceCommandDeps = {
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
  openExistingObservabilityService: (dbPath: string) => ObservabilityRuntimeHandle | null;
  closeObservabilityServiceHandle: (handle: ObservabilityRuntimeHandle | null) => void;
  resolveObservabilityStorePath: () => string;
};

function emptyBenchmarkHistoryDeleteResult(): BenchmarkHistoryDeleteResult {
  return {
    benchmark_runs_deleted: 0,
    benchmark_samples_deleted: 0,
    total_deleted: 0
  };
}

function parseBenchPruneArgs(deps: BenchMaintenanceCommandDeps, argv: string[]): BenchPruneArgs {
  let olderThan: string | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    const parsedFlag = deps.readLongFlagValue(argv, index, "--older-than");
    if (parsedFlag) {
      if (parsedFlag.errorMessage) {
        return { olderThan, json, errorMessage: parsedFlag.errorMessage };
      }

      olderThan = parsedFlag.value as string;
      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { olderThan, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { olderThan, json };
}

function parseBenchMaintenanceArgs(argv: string[]): BenchMaintenanceArgs {
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

function renderBenchHistoryDeleteText(options: {
  title: string;
  storePath: string;
  scope: string;
  olderThan?: string;
  cutoffAt?: string;
  result: BenchmarkHistoryDeleteResult;
  warning?: string;
}): string {
  const lines = [
    options.title,
    `Store: ${options.storePath}`,
    `Scope: ${options.scope}`
  ];

  if (typeof options.olderThan === "string") {
    lines.push(`Older Than: ${options.olderThan}`);
  }

  if (typeof options.cutoffAt === "string") {
    lines.push(`Cutoff: ${options.cutoffAt}`);
  }

  if (typeof options.warning === "string" && options.warning.length > 0) {
    lines.push(`Warning: ${options.warning}`);
  }

  lines.push(
    "",
    `Benchmark Runs Deleted: ${options.result.benchmark_runs_deleted}`,
    `Benchmark Samples Deleted: ${options.result.benchmark_samples_deleted}`,
    `Total Deleted: ${options.result.total_deleted}`
  );

  return lines.join("\n");
}

export function createBenchMaintenanceCommands(deps: BenchMaintenanceCommandDeps) {
  function writeBenchHistoryDeleteSuccess(options: {
    command: "bench prune" | "bench delete" | "bench clear";
    title: string;
    json: boolean;
    storePath: string;
    scope: string;
    result: BenchmarkHistoryDeleteResult;
    olderThan?: string;
    cutoffAt?: string;
    warning?: string;
  }): number {
    if (options.json) {
      deps.writeJsonSuccessEnvelope(
        options.command,
        {
          store_path: options.storePath,
          scope: options.scope,
          ...(typeof options.olderThan === "string" ? { older_than: options.olderThan } : {}),
          ...(typeof options.cutoffAt === "string" ? { cutoff_at: options.cutoffAt } : {}),
          result: options.result
        },
        {
          count: options.result.total_deleted,
          ...(typeof options.warning === "string" ? { warnings: [options.warning] } : {})
        }
      );
      return 0;
    }

    deps.writeStdout(renderBenchHistoryDeleteText(options));
    return 0;
  }

  async function runBenchPrune(argv: string[]): Promise<number> {
    const parsedArgs = parseBenchPruneArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const olderThan = parsedArgs.olderThan?.trim() ?? "";
    if (olderThan.length === 0) {
      deps.printUsageError("Flag '--older-than' is required for 'bench prune'");
      return 2;
    }

    const validationError = validatePruneOlderThan(olderThan);
    if (validationError) {
      deps.printUsageError(`Flag '--older-than' must be a ${PRUNE_OLDER_THAN_MESSAGE}`);
      return 2;
    }

    return await withObservabilityHandle<ObservabilityRuntimeHandle>(
      deps,
      {
        openHandle: deps.openExistingObservabilityService,
        onError: ({ error, dbPath }) => {
          const message = cliErrorMessage(error, "Unknown bench prune error");
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench prune", APP_ERROR_CODES.benchError, message, {
              details: { store_path: dbPath || null, older_than: olderThan || null }
            });
            return 1;
          }

          deps.writeStderr(`Bench prune failed: ${message}`);
          return 1;
        }
      },
      ({ dbPath, handle }) => {
        const cutoffAt = retentionDurationToCutoffIso(olderThan);

        if (!handle) {
          return writeBenchHistoryDeleteSuccess({
            command: "bench prune",
            title: "Benchmark-history prune",
            json: parsedArgs.json,
            storePath: dbPath,
            scope: "older_than",
            olderThan,
            cutoffAt,
            result: emptyBenchmarkHistoryDeleteResult(),
            warning: "No observability store was found yet."
          });
        }

        const result = handle.service.pruneBenchmarkHistoryOlderThan(cutoffAt);
        return writeBenchHistoryDeleteSuccess({
          command: "bench prune",
          title: "Benchmark-history prune",
          json: parsedArgs.json,
          storePath: dbPath,
          scope: "older_than",
          olderThan,
          cutoffAt,
          result
        });
      }
    );
  }

  async function runBenchDelete(runId: string, argv: string[]): Promise<number> {
    const parsedArgs = parseBenchMaintenanceArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    if (runId.trim().length === 0) {
      deps.printUsageError("Argument '<run-id>' is required for 'bench delete'");
      return 2;
    }

    return await withObservabilityHandle<ObservabilityRuntimeHandle>(
      deps,
      {
        openHandle: deps.openExistingObservabilityService,
        onError: ({ error, dbPath }) => {
          const message = cliErrorMessage(error, "Unknown bench delete error");
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench delete", APP_ERROR_CODES.benchError, message, {
              details: { store_path: dbPath || null, run_id: runId }
            });
            return 1;
          }

          deps.writeStderr(`Bench delete failed: ${message}`);
          return 1;
        }
      },
      ({ dbPath, handle }) => {
        if (!handle) {
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench delete", APP_ERROR_CODES.benchNotFound, `Benchmark run '${runId}' was not found`, {
              details: { store_path: dbPath, run_id: runId }
            });
            return 1;
          }

          deps.writeStderr(`Benchmark run '${runId}' was not found.`);
          return 1;
        }

        const result = handle.service.deleteBenchmarkRun(runId);
        if (result.benchmark_runs_deleted === 0) {
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench delete", APP_ERROR_CODES.benchNotFound, `Benchmark run '${runId}' was not found`, {
              details: { store_path: dbPath, run_id: runId }
            });
            return 1;
          }

          deps.writeStderr(`Benchmark run '${runId}' was not found.`);
          return 1;
        }

        return writeBenchHistoryDeleteSuccess({
          command: "bench delete",
          title: "Benchmark-history delete",
          json: parsedArgs.json,
          storePath: dbPath,
          scope: runId,
          result
        });
      }
    );
  }

  async function runBenchClear(argv: string[]): Promise<number> {
    const parsedArgs = parseBenchMaintenanceArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    return await withObservabilityHandle<ObservabilityRuntimeHandle>(
      deps,
      {
        openHandle: deps.openExistingObservabilityService,
        onError: ({ error, dbPath }) => {
          const message = cliErrorMessage(error, "Unknown bench clear error");
          if (parsedArgs.json) {
            deps.writeJsonErrorEnvelope("bench clear", APP_ERROR_CODES.benchError, message, {
              details: { store_path: dbPath || null }
            });
            return 1;
          }

          deps.writeStderr(`Bench clear failed: ${message}`);
          return 1;
        }
      },
      ({ dbPath, handle }) => {
        if (!handle) {
          return writeBenchHistoryDeleteSuccess({
            command: "bench clear",
            title: "Benchmark-history clear",
            json: parsedArgs.json,
            storePath: dbPath,
            scope: "all",
            result: emptyBenchmarkHistoryDeleteResult(),
            warning: "No observability store was found yet."
          });
        }

        const result = handle.service.clearBenchmarkHistory();
        return writeBenchHistoryDeleteSuccess({
          command: "bench clear",
          title: "Benchmark-history clear",
          json: parsedArgs.json,
          storePath: dbPath,
          scope: "all",
          result
        });
      }
    );
  }

  return {
    runBenchPrune,
    runBenchDelete,
    runBenchClear
  };
}
