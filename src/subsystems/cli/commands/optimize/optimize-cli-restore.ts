import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  optimizeApplyExitCode
} from "../../../observability/optimize-ledger-views";
import { cliErrorMessage } from "../../observability-handle-lifecycle";
import { writeOptimizeCommandError } from "./optimize-errors";
import { renderOptimizeRestoreText } from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";

function buildOptimizeRestorePlan(options: {
  readModel: ReturnType<OptimizeCliDeps["loadCliReadModel"]>;
  restoreSelector: string;
  targetRouteId: string;
  dryRun: boolean;
  reload: boolean;
  verify: boolean;
}) {
  return {
    command: {
      command: "optimizeMutation.planRestore" as const,
      readModel: options.readModel as unknown as Record<string, unknown>,
      sourceSurface: "cli" as const,
      createdBy: "switchmaxxer cli optimize restore",
      actorKind: "operator" as const,
      dryRun: options.dryRun,
      metadata: {
        reload_requested: options.reload,
        verify_requested: options.verify
      },
      selector: options.targetRouteId.length > 0
        ? {
            mode: "run_route" as const,
            runId: options.restoreSelector,
            routeId: options.targetRouteId
          }
        : {
            mode: "action" as const,
            actionId: options.restoreSelector
          }
    },
    result: {
      ok: true as const,
      plan: {
        kind: "none" as const,
        reason: "Restore plan context is deferred to the mutation service."
      },
      warnings: []
    },
    reload: options.reload,
    verify: options.verify
  };
}

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
  const dbPath = deps.resolveObservabilityStorePath();

  try {
    const readModel = deps.loadCliReadModel(parsedArgs.configPath);
    const plan = buildOptimizeRestorePlan({
      readModel,
      restoreSelector,
      targetRouteId,
      dryRun: parsedArgs.dryRun,
      reload: parsedArgs.reload,
      verify: parsedArgs.verify
    });
    const mutationResponse = deps.beginOptimizeRestoreMutation({
      id: targetRouteId.length > 0
        ? `cli-optimize-restore-${restoreSelector}-${targetRouteId}`
        : `cli-optimize-restore-${restoreSelector}`,
      dbPath,
      configPath: parsedArgs.configPath,
      readModel,
      loadReadModel: () => deps.loadCliReadModel(parsedArgs.configPath),
      mutateConfigDocument: deps.mutateConfigDocument,
      getMutableConfigSection: deps.getMutableConfigSection,
      plan
    });
    if (!mutationResponse.ok) {
      return writeOptimizeCommandError({
        deps,
        json: parsedArgs.json,
        command: "optimize restore",
        prefix: "Optimize restore failed",
        code: mutationResponse.error.code,
        message: mutationResponse.error.message,
        details: mutationResponse.error.details
      });
    }

    const mutation = mutationResponse.result;
    if (!mutation.storeFound || !mutation.result) {
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

    const result = mutation.result;
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
      if (!mutationResponse.completeIdempotency) {
        const { view } = result;
        const warnings = view.warnings ?? [];
        const exitCode = optimizeApplyExitCode({
          reload: view.reload,
          verification: view.verification
        });
        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope("optimize restore", view, {
            ...(warnings.length === 0 ? {} : { warnings })
          });
          return exitCode;
        }

        deps.writeStdout(renderOptimizeRestoreText(view));
        return exitCode;
      }
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
      mutationResponse.completeIdempotency?.({
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
    const completedResponse = mutationResponse.completeIdempotency?.({
      reload,
      verification,
      warnings,
      includePostActionResult: true
    });
    const view = completedResponse?.ok
      ? completedResponse.result.result?.ok
        ? completedResponse.result.result.view
        : result.complete({ reload, verification, warnings, includePostActionResult: true })
      : result.complete({ reload, verification, warnings, includePostActionResult: true });
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
  } catch (error) {
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
}
