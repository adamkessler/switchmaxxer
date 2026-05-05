import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import type { CliReadModel } from "../../platform/types";
import type { ObservabilityService } from "./service";
import { toOptimizationRunView } from "./optimizations";
import {
  reportFromOptimizationRunView,
  type OptimizeReportView
} from "./optimize-report-builder";
import {
  buildOptimizeApplyView,
  buildOptimizeRestoreView,
  createOptimizeConfigSnapshot,
  findOptimizeApplyRestorePoints,
  findOptimizeWinnerEntry,
  finishOptimizeControlPlaneAction,
  getOptimizeApplyRestorePointByActionId,
  providerMissingDetectableAuth,
  recordOptimizeApplyMutationEvent,
  recordOptimizeControlPlaneActionStarted,
  recordOptimizeRestoreMutationEvent,
  serializeOptionalCostConfig,
  updateRouteProviderTarget,
  type OptimizeApplyReloadView,
  type OptimizeApplySnapshotView,
  type OptimizeApplyVerificationView,
  type OptimizeApplyView,
  type OptimizeRestoreView
} from "./optimize-ledger-views";
import type { SerializedCostConfig } from "../config/model-input-contract";

type OptimizeMutationSourceSurface = "cli" | "mcp";
type OptimizeMutationActorKind = "operator" | "agent";
type MutableConfigSectionName = "models" | "service_providers" | "routes";

type MutateConfigDocument = (
  configPath: string | undefined,
  mutator: (document: Record<string, unknown>) => void
) => void;

type GetMutableConfigSection = (
  document: Record<string, unknown>,
  sectionName: MutableConfigSectionName
) => Record<string, unknown>;

export type OptimizeMutationCompletionOptions = {
  reload?: OptimizeApplyReloadView | null;
  verification?: OptimizeApplyVerificationView | null;
  warnings?: string[];
  includePostActionResult?: boolean;
};

export type OptimizeMutationServiceError = {
  ok: false;
  code: AppErrorCode;
  message: string;
  details: Record<string, unknown>;
};

type OptimizeMutationServiceSuccessBase<View> = {
  ok: true;
  changed: boolean;
  actionId: string | null;
  ledgerActionId: string;
  view: View;
};

type CompletedOptimizeMutationServiceSuccess<View> = OptimizeMutationServiceSuccessBase<View> & {
  deferred: false;
};

type DeferredOptimizeMutationServiceSuccess<View> = OptimizeMutationServiceSuccessBase<View> & {
  deferred: true;
  complete: (completion?: OptimizeMutationCompletionOptions) => View;
};

export type OptimizeApplyMutationServiceSuccess =
  | CompletedOptimizeMutationServiceSuccess<OptimizeApplyView>
  | DeferredOptimizeMutationServiceSuccess<OptimizeApplyView>;

export type OptimizeApplyMutationServiceResult =
  | OptimizeMutationServiceError
  | OptimizeApplyMutationServiceSuccess;

export type OptimizeRestoreMutationSelector =
  | {
      mode: "action";
      actionId: string;
    }
  | {
      mode: "run_route";
      runId: string;
      routeId: string;
    };

export type OptimizeRestoreMutationServiceSuccess =
  | CompletedOptimizeMutationServiceSuccess<OptimizeRestoreView>
  | DeferredOptimizeMutationServiceSuccess<OptimizeRestoreView>;

export type OptimizeRestoreMutationServiceResult =
  | OptimizeMutationServiceError
  | OptimizeRestoreMutationServiceSuccess;

type OptimizeMutationCommonOptions = {
  service: ObservabilityService;
  dbPath: string;
  configPath: string | undefined;
  readModel: CliReadModel;
  loadReadModel: () => CliReadModel;
  mutateConfigDocument: MutateConfigDocument;
  getMutableConfigSection: GetMutableConfigSection;
  sourceSurface: OptimizeMutationSourceSurface;
  createdBy: string;
  actorKind: OptimizeMutationActorKind;
  actorId?: string | null;
  sessionId?: string | null;
  dryRun: boolean;
  metadata?: Record<string, unknown>;
  deferLedgerCompletion?: boolean;
};

export type RunOptimizeApplyMutationOptions = OptimizeMutationCommonOptions & {
  runId: string;
  targetRouteId: string;
};

export type RunOptimizeRestoreMutationOptions = OptimizeMutationCommonOptions & {
  selector: OptimizeRestoreMutationSelector;
};

function errorMessageFromUnknown(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function finishLedgerAction(options: {
  service: ObservabilityService;
  actionId: string | null;
  status: Parameters<typeof finishOptimizeControlPlaneAction>[0]["status"];
  targetRouteId?: string | null;
  runId?: string | null;
  mutationEventId?: string | null;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): void {
  finishOptimizeControlPlaneAction({
    repository: options.service.controlPlaneActions,
    actionId: options.actionId,
    status: options.status,
    targetRouteId: options.targetRouteId ?? null,
    runId: options.runId ?? null,
    mutationEventId: options.mutationEventId,
    result: options.result,
    error: options.error,
    metadata: options.metadata
  });
}

function buildPostActionResult(options: {
  dryRun: boolean;
  changed: boolean;
  mutation: OptimizeApplyView["mutation"] | OptimizeRestoreView["mutation"];
  completion?: OptimizeMutationCompletionOptions;
  restorePointActionId?: string;
}): Record<string, unknown> {
  const includePostActionResult = options.completion?.includePostActionResult === true;
  return {
    dry_run: options.dryRun,
    changed: options.changed,
    mutation: options.mutation,
    ...(typeof options.restorePointActionId === "string"
      ? { restore_point_action_id: options.restorePointActionId }
      : {}),
    ...(includePostActionResult
      ? {
          reload: options.completion?.reload ?? null,
          verification: options.completion?.verification ?? null,
          warnings: options.completion?.warnings ?? []
        }
      : {})
  };
}

function failMutation(options: {
  service: ObservabilityService;
  ledgerActionId: string | null;
  code: AppErrorCode;
  message: string;
  details: Record<string, unknown>;
  targetRouteId?: string | null;
  runId?: string | null;
  metadata?: Record<string, unknown>;
}): OptimizeMutationServiceError {
  finishLedgerAction({
    service: options.service,
    actionId: options.ledgerActionId,
    status: "failed",
    targetRouteId: options.targetRouteId,
    runId: options.runId,
    error: {
      code: options.code,
      message: options.message,
      details: options.details
    },
    metadata: options.metadata
  });
  return {
    ok: false,
    code: options.code,
    message: options.message,
    details: options.details
  };
}

function requireCompletedOptimizeReport(options: {
  service: ObservabilityService;
  dbPath: string;
  runId: string;
}): { ok: true; report: OptimizeReportView } | OptimizeMutationServiceError {
  const run = options.service.optimizations.getRun(options.runId);
  if (!run) {
    return {
      ok: false,
      code: APP_ERROR_CODES.optimizeNotFound,
      message: `Optimization run '${options.runId}' was not found`,
      details: { store_path: options.dbPath, run_id: options.runId }
    };
  }

  const report = reportFromOptimizationRunView(toOptimizationRunView(run), options.dbPath);
  if (report.run.status !== "completed") {
    return {
      ok: false,
      code: APP_ERROR_CODES.optimizeError,
      message: `Optimization run '${options.runId}' cannot be applied because its status is '${report.run.status}'`,
      details: { run_id: options.runId, status: report.run.status }
    };
  }

  return { ok: true, report };
}

function completeApplyLedger(options: {
  service: ObservabilityService;
  ledgerActionId: string;
  runId: string;
  targetRouteId: string;
  changed: boolean;
  actionId: string | null;
  view: OptimizeApplyView;
  completion?: OptimizeMutationCompletionOptions;
}): void {
  finishLedgerAction({
    service: options.service,
    actionId: options.ledgerActionId,
    status: options.changed ? "succeeded" : "noop",
    targetRouteId: options.targetRouteId,
    runId: options.runId,
    mutationEventId: options.actionId,
    result: buildPostActionResult({
      dryRun: false,
      changed: options.changed,
      mutation: options.view.mutation,
      completion: options.completion
    })
  });
}

function completeRestoreLedger(options: {
  service: ObservabilityService;
  ledgerActionId: string;
  runId: string;
  targetRouteId: string;
  changed: boolean;
  actionId: string | null;
  view: OptimizeRestoreView;
  completion?: OptimizeMutationCompletionOptions;
}): void {
  finishLedgerAction({
    service: options.service,
    actionId: options.ledgerActionId,
    status: options.changed ? "succeeded" : "noop",
    targetRouteId: options.targetRouteId,
    runId: options.runId,
    mutationEventId: options.actionId,
    result: buildPostActionResult({
      dryRun: false,
      changed: options.changed,
      mutation: options.view.mutation,
      completion: options.completion,
      restorePointActionId: options.view.restore_point.action_id
    }),
    metadata: {
      run_id: options.runId,
      target_route: options.targetRouteId
    }
  });
}

export function runOptimizeApplyMutation(
  options: RunOptimizeApplyMutationOptions
): OptimizeApplyMutationServiceResult {
  const ledgerActionId = recordOptimizeControlPlaneActionStarted({
    repository: options.service.controlPlaneActions,
    sourceSurface: options.sourceSurface,
    createdBy: options.createdBy,
    actorKind: options.actorKind,
    actorId: options.actorId,
    sessionId: options.sessionId,
    operation: "optimize_apply",
    runId: options.runId,
    targetRouteId: options.targetRouteId,
    metadata: {
      dry_run: options.dryRun,
      ...(options.metadata ?? {})
    }
  });

  try {
    const reportResult = requireCompletedOptimizeReport({
      service: options.service,
      dbPath: options.dbPath,
      runId: options.runId
    });
    if (!reportResult.ok) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: reportResult.code,
        message: reportResult.message,
        details: reportResult.details,
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const { report } = reportResult;
    const winnerEntry = findOptimizeWinnerEntry(report);
    if (!winnerEntry) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.optimizeError,
        message: `Optimization run '${options.runId}' has no qualified winner to apply`,
        details: { run_id: options.runId, winner_route: report.winner.route_id },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const targetRoute = options.readModel.routesByName[options.targetRouteId];
    if (!targetRoute) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.routeNotFound,
        message: `Route '${options.targetRouteId}' was not found`,
        details: { route_id: options.targetRouteId },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    if (targetRoute.model !== report.run.target_model) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.optimizeRouteModelMismatch,
        message: `Route '${options.targetRouteId}' targets model '${targetRoute.model}', not optimize target model '${report.run.target_model}'`,
        details: {
          route_id: options.targetRouteId,
          route_model: targetRoute.model,
          target_model: report.run.target_model
        },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const currentWinnerRoute = options.readModel.routesByName[report.winner.route_id];
    if (!currentWinnerRoute) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.routeNotFound,
        message: `Winner route '${report.winner.route_id}' was not found in the current catalog`,
        details: { winner_route: report.winner.route_id },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    if (
      currentWinnerRoute.model !== winnerEntry.model ||
      currentWinnerRoute.service_provider !== winnerEntry.service_provider ||
      currentWinnerRoute.provider_model_id !== winnerEntry.provider_model_id
    ) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.optimizeError,
        message: `Optimization run '${options.runId}' is stale: winner route '${report.winner.route_id}' no longer matches the persisted recommendation`,
        details: {
          run_id: options.runId,
          winner_route: report.winner.route_id,
          expected: {
            model: winnerEntry.model,
            service_provider: winnerEntry.service_provider,
            provider_model_id: winnerEntry.provider_model_id
          },
          current: {
            model: currentWinnerRoute.model,
            service_provider: currentWinnerRoute.service_provider,
            provider_model_id: currentWinnerRoute.provider_model_id
          }
        },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const winnerProvider = options.readModel.providersByName[winnerEntry.service_provider];
    if (!winnerProvider) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.providerNotFound,
        message: `Winner provider '${winnerEntry.service_provider}' was not found in the current catalog`,
        details: { provider_id: winnerEntry.service_provider },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const missingAuthEnv = providerMissingDetectableAuth(winnerProvider);
    if (missingAuthEnv !== null) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.missingEnvVar,
        message: `Winner provider '${winnerEntry.service_provider}' requires environment variable '${missingAuthEnv}', but it is not set or is empty.`,
        details: { provider_id: winnerEntry.service_provider, api_key_env: missingAuthEnv },
        targetRouteId: options.targetRouteId,
        runId: options.runId
      });
    }

    const winnerCost = serializeOptionalCostConfig(currentWinnerRoute.cost);

    if (options.dryRun) {
      const view = buildOptimizeApplyView({
        report,
        targetRouteId: options.targetRouteId,
        winnerRouteId: report.winner.route_id,
        dryRun: true,
        readModel: options.readModel
      });
      finishLedgerAction({
        service: options.service,
        actionId: ledgerActionId,
        status: "dry_run_succeeded",
        targetRouteId: options.targetRouteId,
        runId: options.runId,
        result: buildPostActionResult({
          dryRun: true,
          changed: view.changed,
          mutation: view.mutation
        })
      });
      return {
        ok: true,
        deferred: false,
        view,
        changed: view.changed,
        actionId: null,
        ledgerActionId
      };
    }

    const targetCost = serializeOptionalCostConfig(targetRoute.cost);
    const changed =
      targetRoute.service_provider !== winnerEntry.service_provider ||
      targetRoute.provider_model_id !== currentWinnerRoute.provider_model_id ||
      !serializedCostsEqual(targetCost, winnerCost);
    const snapshot = changed
      ? createOptimizeConfigSnapshot({
          repository: options.service.configMutations,
          configSourcePath: options.readModel.sourcePath,
          createdBy: options.createdBy
        })
      : null;

    if (changed && snapshot) {
      updateRouteProviderTargetWithSnapshotRollback({
        snapshot,
        service: options.service,
        configPath: options.configPath,
        routeId: options.targetRouteId,
        serviceProvider: winnerEntry.service_provider,
        providerModelId: currentWinnerRoute.provider_model_id,
        cost: winnerCost,
        mutateConfigDocument: options.mutateConfigDocument,
        getMutableConfigSection: options.getMutableConfigSection
      });
    }

    const afterReadModel = options.loadReadModel();
    const mutationView = buildOptimizeApplyView({
      report,
      targetRouteId: options.targetRouteId,
      winnerRouteId: report.winner.route_id,
      dryRun: false,
      readModel: options.readModel,
      afterReadModel,
      snapshot
    });
    const actionId = changed && snapshot
      ? recordOptimizeApplyMutationEvent({
          repository: options.service.configMutations,
          sourceSurface: options.sourceSurface,
          createdBy: options.createdBy,
          runId: options.runId,
          objective: report.run.objective,
          targetModel: report.run.target_model,
          targetRouteId: options.targetRouteId,
          winnerRouteId: report.winner.route_id,
          snapshot,
          mutation: mutationView.mutation,
          before: mutationView.before,
          after: mutationView.after
        })
      : null;
    let completed = false;
    let view = buildOptimizeApplyView({
      report,
      targetRouteId: options.targetRouteId,
      winnerRouteId: report.winner.route_id,
      dryRun: false,
      readModel: options.readModel,
      afterReadModel,
      actionId,
      snapshot
    });
    const complete = (completion: OptimizeMutationCompletionOptions = {}): OptimizeApplyView => {
      if (completed) {
        return view;
      }

      view = buildOptimizeApplyView({
        report,
        targetRouteId: options.targetRouteId,
        winnerRouteId: report.winner.route_id,
        dryRun: false,
        readModel: options.readModel,
        afterReadModel,
        actionId,
        snapshot,
        reload: completion.reload ?? null,
        verification: completion.verification ?? null,
        warnings: completion.warnings ?? []
      });
      completeApplyLedger({
        service: options.service,
        ledgerActionId,
        runId: options.runId,
        targetRouteId: options.targetRouteId,
        changed,
        actionId,
        view,
        completion
      });
      completed = true;
      return view;
    };

    if (options.deferLedgerCompletion) {
      return {
        ok: true,
        deferred: true,
        view,
        changed,
        actionId,
        ledgerActionId,
        complete
      };
    }

    view = complete();

    return {
      ok: true,
      deferred: false,
      view,
      changed,
      actionId,
      ledgerActionId
    };
  } catch (error) {
    return failMutation({
      service: options.service,
      ledgerActionId,
      code: APP_ERROR_CODES.optimizeError,
      message: errorMessageFromUnknown(error, "Unknown optimize apply error"),
      details: {
        store_path: options.dbPath,
        run_id: options.runId,
        route_id: options.targetRouteId
      },
      targetRouteId: options.targetRouteId,
      runId: options.runId
    });
  }
}

function selectorDetails(selector: OptimizeRestoreMutationSelector): Record<string, unknown> {
  return selector.mode === "run_route"
    ? { run_id: selector.runId, route_id: selector.routeId }
    : { action_id: selector.actionId };
}

function selectorDisplay(selector: OptimizeRestoreMutationSelector): string {
  return selector.mode === "run_route" ? selector.runId : selector.actionId;
}

function updateRouteProviderTargetWithSnapshotRollback(options: {
  snapshot: OptimizeApplySnapshotView;
  service: ObservabilityService;
  configPath: string | undefined;
  routeId: string;
  serviceProvider: string;
  providerModelId: string;
  cost: SerializedCostConfig | null;
  mutateConfigDocument: MutateConfigDocument;
  getMutableConfigSection: GetMutableConfigSection;
}): void {
  try {
    updateRouteProviderTarget({
      configPath: options.configPath,
      routeId: options.routeId,
      serviceProvider: options.serviceProvider,
      providerModelId: options.providerModelId,
      cost: options.cost,
      mutateConfigDocument: options.mutateConfigDocument,
      getMutableConfigSection: options.getMutableConfigSection
    });
  } catch (error) {
    options.service.configMutations.deleteSnapshot(options.snapshot.snapshot_id);
    throw error;
  }
}

function serializedCostsEqual(left: SerializedCostConfig | null, right: SerializedCostConfig | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cache_read === right.cache_read &&
    left.cache_write === right.cache_write
  );
}

function resolveRestorePoint(options: {
  service: ObservabilityService;
  readModel: CliReadModel;
  selector: OptimizeRestoreMutationSelector;
}) {
  if (options.selector.mode === "run_route") {
    const restorePoints = findOptimizeApplyRestorePoints({
      repository: options.service.configMutations,
      configSourcePath: options.readModel.sourcePath,
      runId: options.selector.runId,
      targetRouteId: options.selector.routeId
    });

    if (restorePoints.length === 0) {
      return null;
    }

    if (restorePoints.length > 1) {
      throw new Error(
        `Multiple optimize apply restore points were found for run '${options.selector.runId}' and route '${options.selector.routeId}': ` +
          restorePoints.map((entry) => entry.action_id).join(", ")
      );
    }

    return restorePoints[0] ?? null;
  }

  return getOptimizeApplyRestorePointByActionId({
    repository: options.service.configMutations,
    configSourcePath: options.readModel.sourcePath,
    actionId: options.selector.actionId
  });
}

export function runOptimizeRestoreMutation(
  options: RunOptimizeRestoreMutationOptions
): OptimizeRestoreMutationServiceResult {
  const initialRunId = options.selector.mode === "run_route" ? options.selector.runId : null;
  const initialTargetRouteId = options.selector.mode === "run_route" ? options.selector.routeId : null;
  let resolvedRunId: string | null = initialRunId;
  let resolvedTargetRouteId: string | null = initialTargetRouteId;
  const ledgerActionId = recordOptimizeControlPlaneActionStarted({
    repository: options.service.controlPlaneActions,
    sourceSurface: options.sourceSurface,
    createdBy: options.createdBy,
    actorKind: options.actorKind,
    actorId: options.actorId,
    sessionId: options.sessionId,
    operation: "optimize_restore",
    runId: initialRunId,
    targetRouteId: initialTargetRouteId,
    metadata: {
      selector: selectorDisplay(options.selector),
      selector_mode: options.selector.mode,
      dry_run: options.dryRun,
      ...(options.metadata ?? {})
    }
  });

  try {
    const restorePoint = resolveRestorePoint({
      service: options.service,
      readModel: options.readModel,
      selector: options.selector
    });

    if (!restorePoint) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.optimizeNotFound,
        message: options.selector.mode === "run_route"
          ? `No optimize apply restore point was found for run '${options.selector.runId}' and route '${options.selector.routeId}'`
          : `No optimize apply restore point was found for action '${options.selector.actionId}'`,
        details: {
          store_path: options.dbPath,
          ...selectorDetails(options.selector)
        },
        targetRouteId: resolvedTargetRouteId,
        runId: resolvedRunId
      });
    }

    resolvedRunId = restorePoint.run_id;
    resolvedTargetRouteId = restorePoint.target_route;
    const targetRoute = options.readModel.routesByName[restorePoint.target_route];
    if (!targetRoute) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.routeNotFound,
        message: `Route '${restorePoint.target_route}' was not found`,
        details: { route_id: restorePoint.target_route },
        targetRouteId: restorePoint.target_route,
        runId: restorePoint.run_id
      });
    }

    if (targetRoute.service_provider !== restorePoint.mutation.to) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.optimizeError,
        message: `Route '${restorePoint.target_route}' currently uses provider '${targetRoute.service_provider}', not restore point provider '${restorePoint.mutation.to}'`,
        details: {
          run_id: restorePoint.run_id,
          route_id: restorePoint.target_route,
          current_provider: targetRoute.service_provider,
          expected_current_provider: restorePoint.mutation.to,
          restore_provider: restorePoint.mutation.from,
          action_id: restorePoint.action_id
        },
        targetRouteId: restorePoint.target_route,
        runId: restorePoint.run_id
      });
    }

    const restoredProvider = options.readModel.providersByName[restorePoint.mutation.from];
    if (!restoredProvider) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.providerNotFound,
        message: `Restore provider '${restorePoint.mutation.from}' was not found in the current catalog`,
        details: { provider_id: restorePoint.mutation.from },
        targetRouteId: restorePoint.target_route,
        runId: restorePoint.run_id
      });
    }

    const missingAuthEnv = providerMissingDetectableAuth(restoredProvider);
    if (missingAuthEnv !== null) {
      return failMutation({
        service: options.service,
        ledgerActionId,
        code: APP_ERROR_CODES.missingEnvVar,
        message: `Restore provider '${restorePoint.mutation.from}' requires environment variable '${missingAuthEnv}', but it is not set or is empty.`,
        details: { provider_id: restorePoint.mutation.from, api_key_env: missingAuthEnv },
        targetRouteId: restorePoint.target_route,
        runId: restorePoint.run_id
      });
    }

    if (options.dryRun) {
      const view = buildOptimizeRestoreView({
        runId: restorePoint.run_id,
        targetRouteId: restorePoint.target_route,
        restorePoint,
        restoredProviderId: restorePoint.mutation.from,
        dryRun: true,
        readModel: options.readModel
      });
      finishLedgerAction({
        service: options.service,
        actionId: ledgerActionId,
        status: "dry_run_succeeded",
        targetRouteId: restorePoint.target_route,
        runId: restorePoint.run_id,
        result: buildPostActionResult({
          dryRun: true,
          changed: view.changed,
          mutation: view.mutation,
          restorePointActionId: restorePoint.action_id
        }),
        metadata: {
          run_id: restorePoint.run_id,
          target_route: restorePoint.target_route
        }
      });
      return {
        ok: true,
        deferred: false,
        view,
        changed: view.changed,
        actionId: null,
        ledgerActionId
      };
    }

    const targetCost = serializeOptionalCostConfig(targetRoute.cost);
    const changed =
      targetRoute.service_provider !== restorePoint.mutation.from ||
      targetRoute.provider_model_id !== restorePoint.original_provider_model_id ||
      !serializedCostsEqual(targetCost, restorePoint.original_cost);
    const snapshot: OptimizeApplySnapshotView | null = changed
      ? createOptimizeConfigSnapshot({
          repository: options.service.configMutations,
          configSourcePath: options.readModel.sourcePath,
          createdBy: options.createdBy
        })
      : null;

    if (changed && snapshot) {
      updateRouteProviderTargetWithSnapshotRollback({
        snapshot,
        service: options.service,
        configPath: options.configPath,
        routeId: restorePoint.target_route,
        serviceProvider: restorePoint.mutation.from,
        providerModelId: restorePoint.original_provider_model_id,
        cost: restorePoint.original_cost,
        mutateConfigDocument: options.mutateConfigDocument,
        getMutableConfigSection: options.getMutableConfigSection
      });
    }

    const afterReadModel = options.loadReadModel();
    const mutationView = buildOptimizeRestoreView({
      runId: restorePoint.run_id,
      targetRouteId: restorePoint.target_route,
      restorePoint,
      restoredProviderId: restorePoint.mutation.from,
      dryRun: false,
      readModel: options.readModel,
      afterReadModel,
      snapshot
    });
    const actionId = changed && snapshot
      ? recordOptimizeRestoreMutationEvent({
          repository: options.service.configMutations,
          sourceSurface: options.sourceSurface,
          createdBy: options.createdBy,
          restorePoint,
          snapshot,
          mutation: mutationView.mutation,
          before: mutationView.before,
          after: mutationView.after
        })
      : null;
    let completed = false;
    let view = buildOptimizeRestoreView({
      runId: restorePoint.run_id,
      targetRouteId: restorePoint.target_route,
      restorePoint,
      restoredProviderId: restorePoint.mutation.from,
      dryRun: false,
      readModel: options.readModel,
      afterReadModel,
      actionId,
      snapshot
    });
    const complete = (completion: OptimizeMutationCompletionOptions = {}): OptimizeRestoreView => {
      if (completed) {
        return view;
      }

      view = buildOptimizeRestoreView({
        runId: restorePoint.run_id,
        targetRouteId: restorePoint.target_route,
        restorePoint,
        restoredProviderId: restorePoint.mutation.from,
        dryRun: false,
        readModel: options.readModel,
        afterReadModel,
        actionId,
        snapshot,
        reload: completion.reload ?? null,
        verification: completion.verification ?? null,
        warnings: completion.warnings ?? []
      });
      completeRestoreLedger({
        service: options.service,
        ledgerActionId,
        runId: restorePoint.run_id,
        targetRouteId: restorePoint.target_route,
        changed,
        actionId,
        view,
        completion
      });
      completed = true;
      return view;
    };

    if (options.deferLedgerCompletion) {
      return {
        ok: true,
        deferred: true,
        view,
        changed,
        actionId,
        ledgerActionId,
        complete
      };
    }

    view = complete();

    return {
      ok: true,
      deferred: false,
      view,
      changed,
      actionId,
      ledgerActionId
    };
  } catch (error) {
    return failMutation({
      service: options.service,
      ledgerActionId,
      code: APP_ERROR_CODES.optimizeError,
      message: errorMessageFromUnknown(error, "Unknown optimize restore error"),
      details: {
        config_path: options.readModel.sourcePath,
        store_path: options.dbPath,
        selector: selectorDisplay(options.selector),
        route_id: resolvedTargetRouteId
      },
      targetRouteId: resolvedTargetRouteId,
      runId: resolvedRunId
    });
  }
}
