import { APP_ERROR_CODES, type AppErrorCode } from "../../../../platform/error-codes";
import { parsePositiveIntegerFlagValue } from "../../command-arg-primitives";
import type { ObservabilityRuntimeHandle } from "../../../observability/runtime-loader";
import { validateTraceMaintenanceScope } from "../../../observability/trace-maintenance-validation";
import type {
  RequestExecutionRepairResult,
  RequestExecutionVerificationResult
} from "../../../observability/request-executions";
import type { BenchmarkSampleRecord } from "../../../observability/benchmarks";
import type { ObservationQueryOptions } from "../../../observability/repository";
import type {
  ListRequestExecutionOptions,
  RequestExecutionRecord,
  RequestExecutionStats
} from "../../../observability/request-executions";
import type { ObservationRecord } from "../../../observability/types";

interface TraceObservabilityService {
  benchmarks: {
    listSamplesByRequestExecutionId(requestExecutionId: string): BenchmarkSampleRecord[];
  };
  listRecentObservations(options?: ObservationQueryOptions): ObservationRecord[];
  listObservationsByRequestId(requestId: string, limit?: number): ObservationRecord[];
  getRequestExecution(requestId: string): RequestExecutionRecord | null;
  listRecentRequestExecutions(options?: ListRequestExecutionOptions): RequestExecutionRecord[];
  getRequestExecutionStats(options?: ListRequestExecutionOptions): RequestExecutionStats;
  verifyRequestExecution(requestId: string): RequestExecutionVerificationResult;
  verifyAllRequestExecutions(options?: { batchSize?: number }): RequestExecutionVerificationResult[];
  repairRequestExecution(requestId: string): RequestExecutionRepairResult;
  repairAllRequestExecutions(options?: { batchSize?: number }): RequestExecutionRepairResult[];
}

type TraceObservabilityHandle = ObservabilityRuntimeHandle & {
  service: TraceObservabilityService;
};

export type TraceMaintenanceCommandDeps = {
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
  openExistingObservabilityService: (dbPath: string) => TraceObservabilityHandle | null;
  closeObservabilityServiceHandle: (handle: ObservabilityRuntimeHandle | null) => void;
  resolveObservabilityStorePath: () => string;
};

function parseTraceMaintenanceArgs(deps: TraceMaintenanceCommandDeps, argv: string[]): {
  traceId?: string;
  all: boolean;
  batchSize?: number;
  json: boolean;
  errorMessage?: string;
} {
  let traceId: string | undefined;
  let all = false;
  let batchSize: number | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg === "undefined") {
      break;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--all") {
      all = true;
      continue;
    }

    const parsedFlag = deps.readLongFlagValue(argv, index, "--batch-size");
    if (parsedFlag) {
      if (parsedFlag.errorMessage) {
        return { traceId, all, batchSize, json, errorMessage: parsedFlag.errorMessage };
      }

      const parsed = parsePositiveIntegerFlagValue(parsedFlag.value as string | undefined, "--batch-size");
      if (parsed.errorMessage || typeof parsed.value !== "number") {
        return { traceId, all, batchSize, json, errorMessage: "Flag '--batch-size' must be a positive integer" };
      }

      batchSize = parsed.value;
      index += parsedFlag.consumed;
      continue;
    }

    if (arg.startsWith("-")) {
      return { traceId, all, batchSize, json, errorMessage: `Unknown flag '${arg}'` };
    }

    if (typeof traceId !== "undefined") {
      return { traceId, all, batchSize, json, errorMessage: "Only one optional '<trace-id>' argument is supported" };
    }

    traceId = arg;
  }

  const validationError = validateTraceMaintenanceScope({ traceId, all, batchSize });
  if (validationError) {
    return { traceId, all, batchSize, json, errorMessage: validationError };
  }

  return { traceId, all, batchSize, json };
}

function renderTraceVerifyText(
  results: RequestExecutionVerificationResult[],
  dbPath: string,
  scopeLabel: string,
  batchSize?: number
): string {
  const lines = ["Trace verification", `Store: ${dbPath}`, `Scope: ${scopeLabel}`];
  if (typeof batchSize === "number") {
    lines.push(`Batch Size: ${batchSize}`);
  }
  const drifted = results.filter((result) => result.status !== "ok");

  lines.push("", `Checked traces: ${results.length}`, `Healthy traces: ${results.length - drifted.length}`, `Trace summaries needing attention: ${drifted.length}`);

  if (results.length === 0) {
    lines.push("", "No trace summaries were found to verify.");
    return `${lines.join("\n")}\n`;
  }

  if (drifted.length === 0) {
    lines.push("", "All checked trace summaries match canonical observations.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "Drift details:");
  for (const result of drifted) {
    const mismatchPreview = result.mismatches
      .slice(0, 5)
      .map((mismatch) => `${mismatch.field}: expected=${String(mismatch.expected)} actual=${String(mismatch.actual)}`)
      .join("; ");
    lines.push(
      `${result.request_id} status=${result.status} observations=${result.observation_count} mismatches=${result.mismatch_count}`
    );
    if (mismatchPreview.length > 0) {
      lines.push(mismatchPreview);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderTraceRepairText(
  results: RequestExecutionRepairResult[],
  dbPath: string,
  scopeLabel: string,
  batchSize?: number
): string {
  const lines = ["Trace repair", `Store: ${dbPath}`, `Scope: ${scopeLabel}`];
  if (typeof batchSize === "number") {
    lines.push(`Batch Size: ${batchSize}`);
  }
  const byAction = {
    unchanged: results.filter((result) => result.action === "unchanged").length,
    created: results.filter((result) => result.action === "created").length,
    updated: results.filter((result) => result.action === "updated").length,
    deleted: results.filter((result) => result.action === "deleted").length
  };

  lines.push("", `Checked traces: ${results.length}`, `Unchanged: ${byAction.unchanged}`, `Created: ${byAction.created}`, `Updated: ${byAction.updated}`, `Deleted: ${byAction.deleted}`);

  if (results.length === 0) {
    lines.push("", "No trace summaries were found to repair.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "Results:");
  for (const result of results) {
    lines.push(
      `${result.request_id} action=${result.action} observations=${result.observation_count} verification=${result.verification.status}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function createTraceMaintenanceCommands(deps: TraceMaintenanceCommandDeps) {
  function runTraceVerify(argv: string[]): number {
    const parsedArgs = parseTraceMaintenanceArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let handle: TraceObservabilityHandle | null = null;
    let dbPath = "";
    const scopeLabel = parsedArgs.all ? "all" : parsedArgs.traceId!;

    try {
      dbPath = deps.resolveObservabilityStorePath();
      handle = deps.openExistingObservabilityService(dbPath);
      const results = !handle
        ? []
        : parsedArgs.all
          ? handle.service.verifyAllRequestExecutions({ batchSize: parsedArgs.batchSize })
          : [handle.service.verifyRequestExecution(parsedArgs.traceId!)];
      const driftedCount = results.filter((result) => result.status !== "ok").length;

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace verify",
          {
            store_path: dbPath,
            scope: parsedArgs.all ? "all" : "single",
            trace_id: parsedArgs.traceId ?? null,
            batch_size: parsedArgs.all ? (parsedArgs.batchSize ?? 500) : null,
            results
          },
          {
            top_level: {
              result_count: results.length
            },
            warnings: handle ? undefined : ["No observability store was found yet."],
            details: {
              drifted_count: driftedCount
            }
          }
        );
        return driftedCount > 0 ? 1 : 0;
      }

      deps.writeStdout(renderTraceVerifyText(results, dbPath, scopeLabel, parsedArgs.all ? (parsedArgs.batchSize ?? 500) : undefined));
      if (!handle) {
        deps.writeStderr("Note: no observability store was found yet.");
      }
      return driftedCount > 0 ? 1 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace verify error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace verify", APP_ERROR_CODES.traceVerifyError, message, {
          details: {
            store_path: dbPath || null,
            trace_id: parsedArgs.traceId ?? null
          }
        });
        return 1;
      }

      deps.writeStderr(`Trace verify failed: ${message}`);
      return 1;
    } finally {
      deps.closeObservabilityServiceHandle(handle);
    }
  }

  function runTraceRepair(argv: string[]): number {
    const parsedArgs = parseTraceMaintenanceArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let handle: TraceObservabilityHandle | null = null;
    let dbPath = "";
    const scopeLabel = parsedArgs.all ? "all" : parsedArgs.traceId!;

    try {
      dbPath = deps.resolveObservabilityStorePath();
      handle = deps.openExistingObservabilityService(dbPath);
      if (!handle) {
        const message = `Observability store was not found at '${dbPath}'; nothing can be repaired yet`;
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("trace repair", APP_ERROR_CODES.traceRepairError, message, {
            details: {
              store_path: dbPath,
              trace_id: parsedArgs.traceId ?? null
            }
          });
          return 1;
        }

        deps.writeStderr(`Trace repair failed: ${message}`);
        return 1;
      }

      const results = parsedArgs.all
        ? handle.service.repairAllRequestExecutions({ batchSize: parsedArgs.batchSize })
        : [handle.service.repairRequestExecution(parsedArgs.traceId!)];
      const unhealthyCount = results.filter((result) => result.verification.status !== "ok").length;

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace repair",
          {
            store_path: dbPath,
            scope: parsedArgs.all ? "all" : "single",
            trace_id: parsedArgs.traceId ?? null,
            batch_size: parsedArgs.all ? (parsedArgs.batchSize ?? 500) : null,
            results
          },
          {
            top_level: {
              result_count: results.length
            },
            details: {
              remaining_unhealthy_count: unhealthyCount
            }
          }
        );
        return unhealthyCount > 0 ? 1 : 0;
      }

      deps.writeStdout(renderTraceRepairText(results, dbPath, scopeLabel, parsedArgs.all ? (parsedArgs.batchSize ?? 500) : undefined));
      return unhealthyCount > 0 ? 1 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace repair error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace repair", APP_ERROR_CODES.traceRepairError, message, {
          details: {
            store_path: dbPath || null,
            trace_id: parsedArgs.traceId ?? null
          }
        });
        return 1;
      }

      deps.writeStderr(`Trace repair failed: ${message}`);
      return 1;
    } finally {
      deps.closeObservabilityServiceHandle(handle);
    }
  }

  return {
    runTraceVerify,
    runTraceRepair
  };
}
