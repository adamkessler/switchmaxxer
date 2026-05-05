import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  findOptimizeWinnerEntry,
  optimizeApplyExitCode,
  serializeOptionalCostConfig
} from "../../../observability/optimize-ledger-views";
import { cliErrorMessage } from "../../observability-handle-lifecycle";
import { writeOptimizeCommandError } from "./optimize-errors";
import { renderOptimizeApplyText } from "./optimize-rendering";
import type { OptimizeCliDeps } from "./optimize-types";
import type { OptimizeReportView } from "../../../observability/optimize-report-builder";

function buildOptimizeApplyPlan(options: {
  deps: OptimizeCliDeps;
  dbPath: string;
  configPath: string | undefined;
  readModel: ReturnType<OptimizeCliDeps["loadCliReadModel"]>;
  runId: string;
  targetRouteId: string;
  dryRun: boolean;
  reload: boolean;
  verify: boolean;
}) {
  const history = options.deps.optimizationHistory.show({
    dbPath: options.dbPath,
    runId: options.runId
  });
  if (!history.storeFound || history.run === null) {
    return null;
  }

  const report = JSON.parse(history.run.result_json) as OptimizeReportView;
  const winnerEntry = findOptimizeWinnerEntry(report);
  const targetRoute = options.readModel.routesByName[options.targetRouteId];
  const winnerRoute = winnerEntry === null ? null : options.readModel.routesByName[winnerEntry.route_id];
  const plan = targetRoute && winnerEntry && winnerRoute
    ? {
        kind: "route_provider_target" as const,
        routeId: options.targetRouteId,
        from: {
          serviceProvider: targetRoute.service_provider,
          providerModelId: targetRoute.provider_model_id,
          cost: serializeOptionalCostConfig(targetRoute.cost)
        },
        to: {
          serviceProvider: winnerEntry.service_provider,
          providerModelId: winnerRoute.provider_model_id,
          cost: serializeOptionalCostConfig(winnerRoute.cost)
        },
        reason: `Apply optimize run '${options.runId}' winner '${winnerEntry.route_id}' to route '${options.targetRouteId}'.`
      }
    : {
        kind: "none" as const,
        reason: "Apply plan context is incomplete; mutation service will return the canonical validation result."
      };

  return {
    command: {
      command: "optimizeMutation.planApply" as const,
      readModel: options.readModel as unknown as Record<string, unknown>,
      sourceSurface: "cli" as const,
      createdBy: "switchmaxxer cli optimize apply",
      actorKind: "operator" as const,
      dryRun: options.dryRun,
      metadata: {
        reload_requested: options.reload,
        verify_requested: options.verify
      },
      runId: options.runId,
      targetRouteId: options.targetRouteId
    },
    result: {
      ok: true as const,
      plan,
      warnings: []
    },
    reload: options.reload,
    verify: options.verify
  };
}

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
  const dbPath = deps.resolveObservabilityStorePath();

  try {
    const readModel = deps.loadCliReadModel(parsedArgs.configPath);
    const plan = buildOptimizeApplyPlan({
      deps,
      dbPath,
      configPath: parsedArgs.configPath,
      readModel,
      runId,
      targetRouteId,
      dryRun: parsedArgs.dryRun,
      reload: parsedArgs.reload,
      verify: parsedArgs.verify
    });
    if (plan === null) {
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

    const mutationResponse = deps.beginOptimizeApplyMutation({
      id: `cli-optimize-apply-${runId}-${targetRouteId}`,
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
        command: "optimize apply",
        prefix: "Optimize apply failed",
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
        command: "optimize apply",
        prefix: "Optimize apply failed",
        code: APP_ERROR_CODES.optimizeNotFound,
        message: `Optimization run '${runId}' was not found`,
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const result = mutation.result;
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
      if (!mutationResponse.completeIdempotency) {
        const { view } = result;
        const warnings = view.warnings ?? [];
        const exitCode = optimizeApplyExitCode({
          reload: view.reload,
          verification: view.verification
        });
        if (parsedArgs.json) {
          deps.writeJsonSuccessEnvelope("optimize apply", view, {
            ...(warnings.length === 0 ? {} : { warnings })
          });
          return exitCode;
        }

        deps.writeStdout(renderOptimizeApplyText(view));
        return exitCode;
      }
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
      mutationResponse.completeIdempotency?.({
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
      deps.writeJsonSuccessEnvelope("optimize apply", view, {
        ...(warnings.length === 0 ? {} : { warnings })
      });
      return exitCode;
    }

    deps.writeStdout(renderOptimizeApplyText(view));
    return exitCode;
  } catch (error) {
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
}
