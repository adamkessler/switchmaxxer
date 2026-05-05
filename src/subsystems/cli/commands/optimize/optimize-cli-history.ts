import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import { retentionDurationToCutoffIso } from "../../../../platform/retention-duration";
import { toOptimizationRunView } from "../../../observability/optimizations";
import {
  reportFromOptimizationRunView
} from "../../../observability/optimize-report-builder";
import {
  PRUNE_OLDER_THAN_MESSAGE,
  validatePruneOlderThan
} from "../../../observability/prune-validation";
import type { OptimizeHistoryDeleteResult } from "../../../observability/service";
import { cliErrorMessage } from "../../observability-handle-lifecycle";
import {
  renderOptimizeHistoryDeleteText,
  renderOptimizeListText,
  renderOptimizeReportText
} from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";

function emptyOptimizeHistoryDeleteResult(): OptimizeHistoryDeleteResult {
  return {
    optimization_runs_deleted: 0,
    config_mutation_events_deleted: 0,
    config_snapshots_deleted: 0,
    total_deleted: 0
  };
}

function writeOptimizeHistoryDeleteSuccess(
  deps: Pick<OptimizeCliDeps, "writeJsonSuccessEnvelope" | "writeStdout">,
  options: {
    command: "optimize prune" | "optimize delete" | "optimize clear";
    title: string;
    json: boolean;
    storePath: string;
    scope: string;
    result: OptimizeHistoryDeleteResult;
    olderThan?: string;
    cutoffAt?: string;
    warning?: string;
  }
): number {
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

  deps.writeStdout(renderOptimizeHistoryDeleteText(options));
  return 0;
}

export async function runOptimizeList(deps: OptimizeCliDeps, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeListArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const listResult = deps.optimizationHistory.list({
      dbPath,
      limit: parsedArgs.limit
    });
    const { runs } = listResult;
    const runViews = runs.map((run) => toOptimizationRunView(run));

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope(
        "optimize list",
        {
          store_path: dbPath,
          runs: runViews
        },
        {
          count: runViews.length,
          warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
        }
      );
      return 0;
    }

    deps.writeStdout(renderOptimizeListText({ storePath: dbPath, runs: runViews }));
    return 0;
  } catch (error) {
    const message = cliErrorMessage(error, "Unknown optimize list error");
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize list", APP_ERROR_CODES.optimizeListError, message, {
        details: { store_path: dbPath || null }
      });
      return 1;
    }

    deps.writeStderr(`Optimize list failed: ${message}`);
    return 1;
  }
}

export async function runOptimizeShow(deps: OptimizeCliDeps, runId: string, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeShowArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const showResult = deps.optimizationHistory.show({
      dbPath,
      runId
    });

    if (!showResult.storeFound) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("optimize show", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
          details: { store_path: dbPath, run_id: runId }
        });
        return 1;
      }

      deps.writeStderr(`Optimization run '${runId}' was not found.`);
      return 1;
    }

    const { run } = showResult;
    if (!run) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("optimize show", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
          details: { store_path: dbPath, run_id: runId }
        });
        return 1;
      }

      deps.writeStderr(`Optimization run '${runId}' was not found.`);
      return 1;
    }

    const runView = toOptimizationRunView(run);
    const report = reportFromOptimizationRunView(runView, dbPath);

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("optimize show", report, {
        count: report.ranking.length
      });
      return 0;
    }

    deps.writeStdout(renderOptimizeReportText(report));
    return 0;
  } catch (error) {
    const message = cliErrorMessage(error, "Unknown optimize show error");
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize show", APP_ERROR_CODES.optimizeShowError, message, {
        details: { store_path: dbPath || null, run_id: runId }
      });
      return 1;
    }

    deps.writeStderr(`Optimize show failed: ${message}`);
    return 1;
  }
}

export async function runOptimizePrune(deps: OptimizeCliDeps, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizePruneArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  const olderThan = parsedArgs.olderThan?.trim() ?? "";
  if (olderThan.length === 0) {
    deps.printUsageError("Flag '--older-than' is required for 'optimize prune'");
    return 2;
  }

  const validationError = validatePruneOlderThan(olderThan);
  if (validationError) {
    deps.printUsageError(`Flag '--older-than' must be a ${PRUNE_OLDER_THAN_MESSAGE}`);
    return 2;
  }

  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const cutoffAt = retentionDurationToCutoffIso(olderThan);
    const pruneResult = deps.optimizationHistory.pruneOlderThan({
      dbPath,
      cutoffIso: cutoffAt
    });

    if (!pruneResult.storeFound || !pruneResult.result) {
      return writeOptimizeHistoryDeleteSuccess(deps, {
        command: "optimize prune",
        title: "Optimize-history prune",
        json: parsedArgs.json,
        storePath: dbPath,
        scope: "older_than",
        olderThan,
        cutoffAt,
        result: emptyOptimizeHistoryDeleteResult(),
        warning: "No observability store was found yet."
      });
    }

    return writeOptimizeHistoryDeleteSuccess(deps, {
      command: "optimize prune",
      title: "Optimize-history prune",
      json: parsedArgs.json,
      storePath: dbPath,
      scope: "older_than",
      olderThan,
      cutoffAt,
      result: pruneResult.result
    });
  } catch (error) {
    const message = cliErrorMessage(error, "Unknown optimize prune error");
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize prune", APP_ERROR_CODES.optimizeError, message, {
        details: { store_path: dbPath || null, older_than: olderThan || null }
      });
      return 1;
    }

    deps.writeStderr(`Optimize prune failed: ${message}`);
    return 1;
  }
}

export async function runOptimizeDelete(deps: OptimizeCliDeps, runId: string, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeShowArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  if (runId.trim().length === 0) {
    deps.printUsageError("Argument '<run-id>' is required for 'optimize delete'");
    return 2;
  }

  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const deleteResult = deps.optimizationHistory.deleteRun({
      dbPath,
      runId
    });
    const result = deleteResult.result;

    if (!deleteResult.storeFound || !result) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("optimize delete", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
          details: { store_path: dbPath, run_id: runId }
        });
        return 1;
      }

      deps.writeStderr(`Optimization run '${runId}' was not found.`);
      return 1;
    }

    if (result.optimization_runs_deleted === 0) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("optimize delete", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
          details: { store_path: dbPath, run_id: runId }
        });
        return 1;
      }

      deps.writeStderr(`Optimization run '${runId}' was not found.`);
      return 1;
    }

    return writeOptimizeHistoryDeleteSuccess(deps, {
      command: "optimize delete",
      title: "Optimize-history delete",
      json: parsedArgs.json,
      storePath: dbPath,
      scope: runId,
      result
    });
  } catch (error) {
    const message = cliErrorMessage(error, "Unknown optimize delete error");
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize delete", APP_ERROR_CODES.optimizeError, message, {
        details: { store_path: dbPath || null, run_id: runId }
      });
      return 1;
    }

    deps.writeStderr(`Optimize delete failed: ${message}`);
    return 1;
  }
}

export async function runOptimizeClear(deps: OptimizeCliDeps, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeShowArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const clearResult = deps.optimizationHistory.clear({ dbPath });

    if (!clearResult.storeFound || !clearResult.result) {
      return writeOptimizeHistoryDeleteSuccess(deps, {
        command: "optimize clear",
        title: "Optimize-history clear",
        json: parsedArgs.json,
        storePath: dbPath,
        scope: "all",
        result: emptyOptimizeHistoryDeleteResult(),
        warning: "No observability store was found yet."
      });
    }

    return writeOptimizeHistoryDeleteSuccess(deps, {
      command: "optimize clear",
      title: "Optimize-history clear",
      json: parsedArgs.json,
      storePath: dbPath,
      scope: "all",
      result: clearResult.result
    });
  } catch (error) {
    const message = cliErrorMessage(error, "Unknown optimize clear error");
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope("optimize clear", APP_ERROR_CODES.optimizeError, message, {
        details: { store_path: dbPath || null }
      });
      return 1;
    }

    deps.writeStderr(`Optimize clear failed: ${message}`);
    return 1;
  }
}
