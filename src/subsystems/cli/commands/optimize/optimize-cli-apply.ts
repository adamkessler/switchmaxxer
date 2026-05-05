import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  optimizeApplyExitCode
} from "../../../observability/optimize-ledger-views";
import { runOptimizeApplyMutation } from "../../../observability/optimize-orchestrator";
import type { ObservabilityRuntimeHandle } from "../../../observability/runtime-loader";
import {
  cliErrorMessage,
  withObservabilityHandle
} from "../../observability-handle-lifecycle";
import { writeOptimizeCommandError } from "./optimize-errors";
import { renderOptimizeApplyText } from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";

export async function runOptimizeApply(deps: OptimizeCliDeps, runId: string, argv: string[]): Promise<number> {
  const parsedArgs = deps.parseOptimizeApplyArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  const targetRouteId = parsedArgs.routeId?.trim() ?? "";
  if (targetRouteId.length === 0) {
    deps.printUsageError("Flag '--route' is required for 'optimize apply'");
    return 2;
  }

  let pendingLedgerCompletion: ((message: string) => void) | null = null;

  return await withObservabilityHandle<ObservabilityRuntimeHandle>(
    deps,
    {
      openHandle: deps.openExistingObservabilityService,
      onError: ({ error, dbPath }) => {
        const message = cliErrorMessage(error, "Unknown optimize apply error");
        if (pendingLedgerCompletion) {
          try {
            pendingLedgerCompletion(message);
          } catch {
            // Preserve the original optimize apply error for the operator.
          }
        }
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize apply",
          prefix: "Optimize apply failed",
          code: APP_ERROR_CODES.optimizeError,
          message,
          details: {
            store_path: dbPath || null,
            run_id: runId,
            route_id: targetRouteId
          }
        });
      }
    },
    async ({ dbPath, handle }) => {
      if (!handle) {
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize apply",
          prefix: "Optimize apply failed",
          code: APP_ERROR_CODES.optimizeNotFound,
          message: `Optimization run '${runId}' was not found`,
          details: { store_path: dbPath, run_id: runId }
        });
      }

      const readModel = deps.loadCliReadModel(parsedArgs.configPath);
      const result = runOptimizeApplyMutation({
        service: handle.service,
        dbPath,
        configPath: parsedArgs.configPath,
        readModel,
        loadReadModel: () => deps.loadCliReadModel(parsedArgs.configPath),
        mutateConfigDocument: deps.mutateConfigDocument,
        getMutableConfigSection: deps.getMutableConfigSection,
        sourceSurface: "cli",
        createdBy: "switchmaxxer cli optimize apply",
        actorKind: "operator",
        runId,
        targetRouteId,
        dryRun: parsedArgs.dryRun,
        deferLedgerCompletion: true,
        metadata: {
          reload_requested: parsedArgs.reload,
          verify_requested: parsedArgs.verify
        }
      });
      if (!result.ok) {
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize apply",
          prefix: "Optimize apply failed",
          code: result.code,
          message: result.message,
          details: result.details
        });
      }

      if (parsedArgs.dryRun) {
        const { view } = result;
        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope("optimize apply", view);
          return 0;
        }

        deps.writeStdout(renderOptimizeApplyText(view));
        return 0;
      }

      if (!result.deferred) {
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize apply",
          prefix: "Optimize apply failed",
          code: APP_ERROR_CODES.optimizeError,
          message: "Optimize apply completed before reload/verify results could be recorded.",
          details: {
            store_path: dbPath,
            run_id: runId,
            route_id: targetRouteId
          }
        });
      }

      pendingLedgerCompletion = (message) => {
        result.complete({
          warnings: [message],
          includePostActionResult: true
        });
      };
      const reload = parsedArgs.reload
        ? result.changed
          ? await deps.runOptimizeApplyReload({ configPath: parsedArgs.configPath })
          : buildSkippedOptimizeReloadView()
        : null;
      const verification = parsedArgs.verify
        ? await deps.runOptimizeApplyVerify({ configPath: parsedArgs.configPath, routeId: targetRouteId })
        : null;
      const warnings = buildOptimizeApplyWarnings({ reload, verification });
      const view = result.complete({
        reload,
        verification,
        warnings,
        includePostActionResult: true
      });
      pendingLedgerCompletion = null;
      const exitCode = optimizeApplyExitCode({ reload, verification });

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope("optimize apply", view, {
          ...(warnings.length === 0 ? {} : { warnings })
        });
        return exitCode;
      }

      deps.writeStdout(renderOptimizeApplyText(view));
      return exitCode;
    }
  );
}
