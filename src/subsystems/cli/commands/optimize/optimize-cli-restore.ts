import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  optimizeApplyExitCode
} from "../../../observability/optimize-ledger-views";
import { runOptimizeRestoreMutation } from "../../../observability/optimize-orchestrator";
import type { ObservabilityRuntimeHandle } from "../../../observability/runtime-loader";
import {
  cliErrorMessage,
  withObservabilityHandle
} from "../../observability-handle-lifecycle";
import { writeOptimizeCommandError } from "./optimize-errors";
import { renderOptimizeRestoreText } from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";

export async function runOptimizeRestore(
  deps: OptimizeCliDeps,
  restoreSelector: string,
  argv: string[]
): Promise<number> {
  const parsedArgs = deps.parseOptimizeApplyArgs(argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  const targetRouteId = parsedArgs.routeId?.trim() ?? "";
  let pendingLedgerCompletion: ((message: string) => void) | null = null;

  return await withObservabilityHandle<ObservabilityRuntimeHandle>(
    deps,
    {
      openHandle: deps.openExistingObservabilityService,
      onError: ({ error, dbPath }) => {
        const message = cliErrorMessage(error, "Unknown optimize restore error");
        if (pendingLedgerCompletion) {
          try {
            pendingLedgerCompletion(message);
          } catch {
            // Preserve the original optimize restore error for the operator.
          }
        }
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize restore",
          prefix: "Optimize restore failed",
          code: APP_ERROR_CODES.optimizeError,
          message,
          details: {
            store_path: dbPath || null,
            selector: restoreSelector,
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
          command: "optimize restore",
          prefix: "Optimize restore failed",
          code: APP_ERROR_CODES.optimizeNotFound,
          message: `Optimize restore point '${restoreSelector}' was not found`,
          details: { store_path: dbPath, selector: restoreSelector, route_id: targetRouteId || null }
        });
      }

      const readModel = deps.loadCliReadModel(parsedArgs.configPath);
      const result = runOptimizeRestoreMutation({
        service: handle.service,
        dbPath,
        configPath: parsedArgs.configPath,
        readModel,
        loadReadModel: () => deps.loadCliReadModel(parsedArgs.configPath),
        mutateConfigDocument: deps.mutateConfigDocument,
        getMutableConfigSection: deps.getMutableConfigSection,
        sourceSurface: "cli",
        createdBy: "switchmaxxer cli optimize restore",
        actorKind: "operator",
        selector: targetRouteId.length > 0
          ? {
              mode: "run_route",
              runId: restoreSelector,
              routeId: targetRouteId
            }
          : {
              mode: "action",
              actionId: restoreSelector
            },
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
          command: "optimize restore",
          prefix: "Optimize restore failed",
          code: result.code,
          message: result.message,
          details: result.details
        });
      }

      if (parsedArgs.dryRun) {
        const { view } = result;
        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope("optimize restore", view);
          return 0;
        }

        deps.writeStdout(renderOptimizeRestoreText(view));
        return 0;
      }

      if (!result.deferred) {
        return writeOptimizeCommandError({
          deps,
          json: parsedArgs.json,
          command: "optimize restore",
          prefix: "Optimize restore failed",
          code: APP_ERROR_CODES.optimizeError,
          message: "Optimize restore completed before reload/verify results could be recorded.",
          details: {
            store_path: dbPath,
            selector: restoreSelector,
            route_id: targetRouteId || null
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
          ? await deps.runOptimizeApplyReload({ configPath: parsedArgs.configPath, operation: "restore" })
          : buildSkippedOptimizeReloadView()
        : null;
      const verification = parsedArgs.verify
        ? await deps.runOptimizeApplyVerify({ configPath: parsedArgs.configPath, routeId: result.view.target_route, operation: "restore" })
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
        deps.writeJsonSuccessEnvelope("optimize restore", view, {
          ...(warnings.length === 0 ? {} : { warnings })
        });
        return exitCode;
      }

      deps.writeStdout(renderOptimizeRestoreText(view));
      return exitCode;
    }
  );
}
