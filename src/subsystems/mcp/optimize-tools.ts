import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import {
  buildLatencyOptimizeReport,
  buildCostOptimizeExecution,
  reportFromOptimizationRunView,
  selectOptimizeCandidateRoutes
} from "../observability/optimize-report-builder";
import { BenchmarkCancelledError } from "../bench/bench-runtime";
import { loadConfig } from "../config/config";
import { loadCliReadModel } from "../config/read-model";
import { toOptimizationRunView } from "../observability/optimizations";
import {
  createOstrichBenchmarkRunPort,
  createOstrichOptimizeMutationPort,
  createOstrichOptimizationReportPort,
  createOstrichOptimizationHistoryPort
} from "../observability/observability-module";
import {
  closeObservabilityServiceHandle,
  type ObservabilityRuntimeHandle
} from "../observability/runtime-loader";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  findOptimizeWinnerEntry,
  serializeOptionalCostConfig,
  type OptimizeApplyVerificationView
} from "../observability/optimize-ledger-views";
import {
  beginPlannedExternalOptimizeApplyMutationAgainstModule,
  beginPlannedExternalOptimizeRestoreMutationAgainstModule,
  type PendingExternalOptimizeApplyMutationCompletion,
  type PendingExternalOptimizeRestoreMutationCompletion
} from "../observability/observability-ipc-optimize-mutation-executor";
import { createOptimizeMutationIdempotencyRepository } from "../observability/optimize-mutation-idempotency-runtime";
import { buildMcpErrorEnvelope, toEnvelopeFromError, type McpErrorEnvelope, type McpSuccessEnvelope } from "./envelope";
import { McpToolError } from "./errors";
import { resolveObservabilityStorePath } from "./helpers";
import {
  parseOptimizeApplyArgs,
  parseOptimizeListArgs,
  parseOptimizeRestoreArgs,
  parseOptimizeRunArgs,
  parseOptimizeShowArgs
} from "./parsers";
import { getMutableSection, mutateConfigDocument } from "./config-runtime";
import { getSessionObservabilityHandle } from "./session";
import type { McpToolContext } from "./tool-context";
import {
  createMcpBenchmarkOperationAbortSignal,
  preflightGatewayBench
} from "./bench-run-tool";

function closeMcpOptimizationHistoryPortHandle(
  context: McpToolContext,
  handle: ObservabilityRuntimeHandle | null
): void {
  if (!context.sessionContext) {
    closeObservabilityServiceHandle(handle);
  }
}

function createMcpOptimizationHistoryPort(context: McpToolContext) {
  return createOstrichOptimizationHistoryPort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpOptimizationHistoryPortHandle(context, handle)
  });
}

function closeMcpOptimizeMutationHandle(
  context: McpToolContext,
  handle: ObservabilityRuntimeHandle | null
): void {
  if (!context.sessionContext) {
    closeObservabilityServiceHandle(handle);
  }
}

function openMcpOptimizeMutationRuntime(context: McpToolContext, dbPath: string) {
  const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false });
  if (handle === null) {
    return null;
  }

  return {
    observabilityModule: {
      optimizeMutations: createOstrichOptimizeMutationPort({
        openExisting: () => handle,
        close: () => {}
      })
    },
    repository: createOptimizeMutationIdempotencyRepository(handle),
    close: () => closeMcpOptimizeMutationHandle(context, handle)
  };
}

function closeAfterMcpOptimizeCompletion(
  close: () => void,
  completeIdempotency:
    | PendingExternalOptimizeApplyMutationCompletion
    | PendingExternalOptimizeRestoreMutationCompletion
) {
  return (message: string): void => {
    try {
      completeIdempotency({
        warnings: [message],
        includePostActionResult: true
      });
    } finally {
      close();
    }
  };
}

function buildMcpOptimizeApplyPlan(options: {
  context: McpToolContext;
  dbPath: string;
  readModel: ReturnType<McpToolContext["getReadModel"]>;
  runId: string;
  routeId: string;
  dryRun: boolean;
  reload: boolean;
  verify: boolean;
}) {
  const history = createMcpOptimizationHistoryPort(options.context).show({
    dbPath: options.dbPath,
    runId: options.runId
  });
  if (!history.storeFound || history.run === null) {
    return null;
  }

  const report = JSON.parse(history.run.result_json) as ReturnType<typeof reportFromOptimizationRunView>;
  const winnerEntry = findOptimizeWinnerEntry(report);
  const targetRoute = options.readModel.routesByName[options.routeId];
  const winnerRoute = winnerEntry === null ? null : options.readModel.routesByName[winnerEntry.route_id];
  const plan = targetRoute && winnerEntry && winnerRoute
    ? {
        kind: "route_provider_target" as const,
        routeId: options.routeId,
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
        reason: `Apply optimize run '${options.runId}' winner '${winnerEntry.route_id}' to route '${options.routeId}'.`
      }
    : {
        kind: "none" as const,
        reason: "Apply plan context is incomplete; mutation service will return the canonical validation result."
      };

  return {
    command: {
      command: "optimizeMutation.planApply" as const,
      readModel: options.readModel as unknown as Record<string, unknown>,
      sourceSurface: "mcp" as const,
      createdBy: "switchmaxxer mcp optimize_apply",
      actorKind: "agent" as const,
      sessionId: options.context.sessionContext?.sessionId ?? null,
      dryRun: options.dryRun,
      metadata: {
        reload_requested: options.reload,
        verify_requested: options.verify
      },
      runId: options.runId,
      targetRouteId: options.routeId
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

function buildMcpOptimizeRestorePlan(options: {
  context: McpToolContext;
  readModel: ReturnType<McpToolContext["getReadModel"]>;
  args: ReturnType<typeof parseOptimizeRestoreArgs>;
}) {
  return {
    command: {
      command: "optimizeMutation.planRestore" as const,
      readModel: options.readModel as unknown as Record<string, unknown>,
      sourceSurface: "mcp" as const,
      createdBy: "switchmaxxer mcp optimize_restore",
      actorKind: "agent" as const,
      sessionId: options.context.sessionContext?.sessionId ?? null,
      dryRun: options.args.dryRun,
      metadata: {
        reload_requested: options.args.reload,
        verify_requested: options.args.verify
      },
      selector: options.args.mode === "run_route"
        ? {
            mode: "run_route" as const,
            runId: options.args.runId,
            routeId: options.args.routeId
          }
        : {
            mode: "action" as const,
            actionId: options.args.actionId
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
    reload: options.args.reload,
    verify: options.args.verify
  };
}

function requireOptimizePostActionDeps(
  context: McpToolContext,
  command: "optimize apply" | "optimize restore",
  requestedActions: Array<"reload" | "verify">
) {
  const deps = context.runtimeDeps?.optimizePostActions;
  if (!deps) {
    const actionList = requestedActions.join(" and ");
    throw new McpToolError(
      APP_ERROR_CODES.optimizePostActionsUnavailable,
      `${command} ${actionList} requested, but this MCP server was not started with optimizePostActions runtime dependencies.`,
      {
        command,
        requested_actions: requestedActions,
        required_dependency: "optimizePostActions"
      }
    );
  }

  return deps;
}

export function buildOptimizeListToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseOptimizeListArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const limit = args.limit ?? 25;
    const listResult = createMcpOptimizationHistoryPort(context).list({ dbPath, limit });
    const runViews = listResult.runs.map((run) => toOptimizationRunView(run));

    return buildSuccessEnvelope("optimize list", {
      store_path: dbPath,
      runs: runViews
    }, {
      count: runViews.length,
      warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("optimize list", error, APP_ERROR_CODES.optimizeListError, {
      store_path: dbPath
    });
  }
}

export function buildOptimizeShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseOptimizeShowArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const { runId } = args;
    const showResult = createMcpOptimizationHistoryPort(context).show({ dbPath, runId });
    const { run } = showResult;

    if (!run) {
      return buildMcpErrorEnvelope("optimize show", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const report = reportFromOptimizationRunView(toOptimizationRunView(run), dbPath);
    return buildSuccessEnvelope("optimize show", report, {
      count: report.ranking.length
    });
  } catch (error) {
    return toEnvelopeFromError("optimize show", error, APP_ERROR_CODES.optimizeShowError, {
      store_path: dbPath,
      run_id: args.runId
    });
  }
}

export async function buildOptimizeApplyToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const args = parseOptimizeApplyArgs(context.params);
  const dbPath = resolveObservabilityStorePath();
  let pendingLedgerCompletion: ((message: string) => void) | null = null;

  try {
    const { runId, routeId } = args;
    const readModel = context.getReadModel();
    const requestedPostActions: Array<"reload" | "verify"> = [
      ...(args.reload ? ["reload" as const] : []),
      ...(args.verify ? ["verify" as const] : [])
    ];
    const postActionDeps = !args.dryRun && requestedPostActions.length > 0
      ? requireOptimizePostActionDeps(context, "optimize apply", requestedPostActions)
      : null;
    const plan = buildMcpOptimizeApplyPlan({
      context,
      dbPath,
      readModel,
      runId,
      routeId,
      dryRun: args.dryRun,
      reload: args.reload,
      verify: args.verify
    });
    if (plan === null) {
      return buildMcpErrorEnvelope("optimize apply", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const runtime = openMcpOptimizeMutationRuntime(context, dbPath);
    if (runtime === null) {
      return buildMcpErrorEnvelope("optimize apply", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    let shouldCloseHandle = true;
    const mutationResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: `mcp-optimize-apply-${runId}-${routeId}`,
      dbPath,
      configPath: context.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(context.configPath),
      mutateConfigDocument,
      getMutableConfigSection: getMutableSection,
      plan,
      observabilityModule: runtime.observabilityModule,
      repository: runtime.repository,
      nowIso: new Date().toISOString()
    });
    if (mutationResponse.ok && mutationResponse.completeIdempotency) {
      shouldCloseHandle = false;
    } else {
      runtime.close();
    }
    if (!mutationResponse.ok) {
      return buildMcpErrorEnvelope("optimize apply", APP_ERROR_CODES.optimizeError, mutationResponse.error.message, {
        details: {
          ...mutationResponse.error.details,
          ipc_code: mutationResponse.error.code
        }
      });
    }

    const mutation = mutationResponse.result;
    if (!mutation.storeFound || !mutation.result) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildMcpErrorEnvelope("optimize apply", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const result = mutation.result;
    if (!result.ok) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildMcpErrorEnvelope("optimize apply", result.code, result.message, { details: result.details });
    }

    if (args.dryRun || (!args.reload && !args.verify)) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildSuccessEnvelope("optimize apply", result.view);
    }

    if (!result.deferred) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      if (!mutationResponse.completeIdempotency) {
        return buildSuccessEnvelope("optimize apply", result.view, {
          ...((result.view.warnings ?? []).length === 0 ? {} : { warnings: result.view.warnings })
        });
      }
      return buildMcpErrorEnvelope(
        "optimize apply",
        APP_ERROR_CODES.optimizeError,
        "Optimize apply completed before reload/verify results could be recorded.",
        {
          details: {
            store_path: dbPath,
            run_id: runId,
            route_id: routeId
          }
        }
      );
    }

    pendingLedgerCompletion = closeAfterMcpOptimizeCompletion(runtime.close, mutationResponse.completeIdempotency!);
    const reload = args.reload
      ? result.changed
        ? await postActionDeps!.runOptimizeApplyReload({ configPath: context.configPath })
        : buildSkippedOptimizeReloadView()
      : null;
    const verification: OptimizeApplyVerificationView | null = args.verify
      ? await postActionDeps!.runOptimizeApplyVerify({ configPath: context.configPath, routeId })
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
    runtime.close();
    pendingLedgerCompletion = null;

    return buildSuccessEnvelope("optimize apply", view, {
      ...(warnings.length === 0 ? {} : { warnings })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown optimize apply error";
    if (pendingLedgerCompletion) {
      try {
        pendingLedgerCompletion(message);
      } catch {
        // Preserve the original optimize apply error for the MCP client.
      }
    }
    return toEnvelopeFromError("optimize apply", error, APP_ERROR_CODES.optimizeError, {
      store_path: dbPath,
      run_id: args.runId,
      route_id: args.routeId
    });
  }
}

export async function buildOptimizeRestoreToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const args = parseOptimizeRestoreArgs(context.params);
  const dbPath = resolveObservabilityStorePath();
  let pendingLedgerCompletion: ((message: string) => void) | null = null;

  try {
    const readModel = context.getReadModel();
    const requestedPostActions: Array<"reload" | "verify"> = [
      ...(args.reload ? ["reload" as const] : []),
      ...(args.verify ? ["verify" as const] : [])
    ];
    const postActionDeps = !args.dryRun && requestedPostActions.length > 0
      ? requireOptimizePostActionDeps(context, "optimize restore", requestedPostActions)
      : null;
    const plan = buildMcpOptimizeRestorePlan({
      context,
      readModel,
      args
    });
    const runtime = openMcpOptimizeMutationRuntime(context, dbPath);
    if (runtime === null) {
      return buildMcpErrorEnvelope("optimize restore", APP_ERROR_CODES.optimizeNotFound, "No optimize apply restore point was found", {
        details: {
          store_path: dbPath,
          ...(args.mode === "action"
            ? { action_id: args.actionId }
            : { run_id: args.runId, route_id: args.routeId })
        }
      });
    }

    let shouldCloseHandle = true;
    const mutationResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: args.mode === "action"
        ? `mcp-optimize-restore-${args.actionId}`
        : `mcp-optimize-restore-${args.runId}-${args.routeId}`,
      dbPath,
      configPath: context.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(context.configPath),
      mutateConfigDocument,
      getMutableConfigSection: getMutableSection,
      plan,
      observabilityModule: runtime.observabilityModule,
      repository: runtime.repository,
      nowIso: new Date().toISOString()
    });
    if (mutationResponse.ok && mutationResponse.completeIdempotency) {
      shouldCloseHandle = false;
    } else {
      runtime.close();
    }
    if (!mutationResponse.ok) {
      return buildMcpErrorEnvelope("optimize restore", APP_ERROR_CODES.optimizeError, mutationResponse.error.message, {
        details: {
          ...mutationResponse.error.details,
          ipc_code: mutationResponse.error.code
        }
      });
    }

    const mutation = mutationResponse.result;
    if (!mutation.storeFound || !mutation.result) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildMcpErrorEnvelope("optimize restore", APP_ERROR_CODES.optimizeNotFound, "No optimize apply restore point was found", {
        details: {
          store_path: dbPath,
          ...(args.mode === "action"
            ? { action_id: args.actionId }
            : { run_id: args.runId, route_id: args.routeId })
        }
      });
    }

    const result = mutation.result;
    if (!result.ok) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildMcpErrorEnvelope("optimize restore", result.code, result.message, { details: result.details });
    }

    if (args.dryRun || (!args.reload && !args.verify)) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      return buildSuccessEnvelope("optimize restore", result.view);
    }

    if (!result.deferred) {
      if (!shouldCloseHandle) {
        runtime.close();
      }
      if (!mutationResponse.completeIdempotency) {
        return buildSuccessEnvelope("optimize restore", result.view, {
          ...((result.view.warnings ?? []).length === 0 ? {} : { warnings: result.view.warnings })
        });
      }
      return buildMcpErrorEnvelope(
        "optimize restore",
        APP_ERROR_CODES.optimizeError,
        "Optimize restore completed before reload/verify results could be recorded.",
        {
          details: {
            store_path: dbPath,
            selector: args.mode,
            route_id: args.mode === "run_route" ? args.routeId : null
          }
        }
      );
    }

    pendingLedgerCompletion = closeAfterMcpOptimizeCompletion(runtime.close, mutationResponse.completeIdempotency!);
    const reload = args.reload
      ? result.changed
        ? await postActionDeps!.runOptimizeApplyReload({ configPath: context.configPath, operation: "restore" })
        : buildSkippedOptimizeReloadView()
      : null;
    const verification: OptimizeApplyVerificationView | null = args.verify
      ? await postActionDeps!.runOptimizeApplyVerify({
        configPath: context.configPath,
        routeId: result.view.target_route,
        operation: "restore"
        })
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
    runtime.close();
    pendingLedgerCompletion = null;

    return buildSuccessEnvelope("optimize restore", view, {
      ...(warnings.length === 0 ? {} : { warnings })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown optimize restore error";
    if (pendingLedgerCompletion) {
      try {
        pendingLedgerCompletion(message);
      } catch {
        // Preserve the original optimize restore error for the MCP client.
      }
    }
    return toEnvelopeFromError("optimize restore", error, APP_ERROR_CODES.optimizeError, {
      store_path: dbPath,
      ...(args.mode === "action"
        ? { action_id: args.actionId }
        : { run_id: args.runId, route_id: args.routeId })
    });
  }
}

export async function buildOptimizeRunToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const args = parseOptimizeRunArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    if (args.objective === "latency") {
      const readModel = context.getReadModel();
      const selectedCandidates = selectOptimizeCandidateRoutes(
        readModel,
        args.modelId,
        args.requestedRoutes
      );
      if (!selectedCandidates.ok) {
        return buildMcpErrorEnvelope("optimize", selectedCandidates.failure.code, selectedCandidates.failure.message, {
          details: selectedCandidates.failure.details
        });
      }

      const iterations = args.iterations ?? 3;
      const warmup = args.warmup ?? 1;
      const concurrency = args.concurrency ?? 1;
      const pathMode = args.pathModeValue ?? "both";
      const timeoutMs = args.timeoutMs;
      const config = loadConfig(context.configPath);
      const ownsHandle = typeof context.sessionContext === "undefined";
      const benchmarkRuns = createOstrichBenchmarkRunPort({
        open: (storePath) => getSessionObservabilityHandle(context.sessionContext, storePath, { createIfMissing: true }),
        close: (handle) => {
          if (ownsHandle) {
            closeObservabilityServiceHandle(handle);
          }
        }
      });
      const abortSignal = createMcpBenchmarkOperationAbortSignal({
        sessionSignal: context.sessionContext?.abortSignal,
        timeoutMessage: "MCP optimize_run latency benchmark exceeded the wall-clock limit"
      });
      const benchmarkRunResult = await benchmarkRuns.run({
        dbPath,
        config,
        routeNames: selectedCandidates.routes.map((route) => route.name),
        prompt: args.prompt,
        iterations,
        warmup,
        concurrency,
        pathMode,
        timeoutMs,
        preflightGateway: () => preflightGatewayBench(context.configPath),
        createdBy: "switchmaxxer mcp optimize",
        objective: "route_optimization",
        storePath: dbPath,
        signal: abortSignal,
        statusForError: (error) => (error instanceof BenchmarkCancelledError ? "cancelled" : "failed"),
        taskPlanCommandName: "optimize_run",
        invalidInputFieldCode: APP_ERROR_CODES.invalidInputField
      });
      if (!benchmarkRunResult.storeFound || !benchmarkRunResult.result) {
        return buildMcpErrorEnvelope(
          "optimize",
          APP_ERROR_CODES.optimizeError,
          `Observability store could not be opened at '${dbPath}'`,
          {
            details: { store_path: dbPath }
          }
        );
      }

      const runnerResult = benchmarkRunResult.result;
      if (!runnerResult.ok) {
        if (runnerResult.failure.kind === "usage") {
          return buildMcpErrorEnvelope("optimize", APP_ERROR_CODES.invalidInputField, runnerResult.failure.message);
        }

        return buildMcpErrorEnvelope(
          "optimize",
          runnerResult.failure.code === "gateway_unavailable"
            ? APP_ERROR_CODES.gatewayUnavailable
            : APP_ERROR_CODES.invalidConfig,
          runnerResult.failure.message,
          {
            details: runnerResult.failure.details
          }
        );
      }

      const reportResult = buildLatencyOptimizeReport({
        modelId: args.modelId,
        requestedRoutes: args.requestedRoutes,
        candidateRoutes: selectedCandidates.routes,
        benchmarkRunId: runnerResult.benchmarkRunId,
        benchmarkSummary: runnerResult.summary,
        benchmarkExecution: runnerResult.report.execution,
        samples: runnerResult.samples
      });
      if (!reportResult.ok) {
        return buildMcpErrorEnvelope("optimize", reportResult.failure.code, reportResult.failure.message, {
          details: reportResult.failure.details
        });
      }

      const optimizationReports = createOstrichOptimizationReportPort({
        open: (storePath) => getSessionObservabilityHandle(context.sessionContext, storePath, { createIfMissing: true }),
        close: (handle) => {
          if (ownsHandle) {
            closeObservabilityServiceHandle(handle);
          }
        }
      });
      const persisted = optimizationReports.persistLatency({
        dbPath,
        report: reportResult.report,
        candidateRoutes: selectedCandidates.routes,
        requestedRoutes: args.requestedRoutes,
        createdBy: "switchmaxxer mcp optimize",
        benchmarkRunId: runnerResult.benchmarkRunId,
        settings: {
          prompt_chars: args.prompt.length,
          iterations,
          warmup,
          concurrency,
          timeout_ms: timeoutMs,
          path_mode: pathMode
        }
      });
      if (!persisted.storeFound || !persisted.report) {
        return buildMcpErrorEnvelope(
          "optimize",
          APP_ERROR_CODES.optimizeError,
          `Observability store could not be opened at '${dbPath}'`,
          {
            details: { store_path: dbPath }
          }
        );
      }

      const report = persisted.report;
      return buildSuccessEnvelope("optimize", report, {
        count: report.ranking.length
      });
    }

    const preparedReport = buildCostOptimizeExecution({
      readModel: context.getReadModel(),
      modelId: args.modelId,
      requestedRoutes: args.requestedRoutes,
      referenceTokens: args.referenceTokens
    });
    if (!preparedReport.ok) {
      return buildMcpErrorEnvelope("optimize", preparedReport.failure.code, preparedReport.failure.message, {
        details: preparedReport.failure.details
      });
    }

    const ownsHandle = typeof context.sessionContext === "undefined";
    const optimizationReports = createOstrichOptimizationReportPort({
      open: (storePath) => getSessionObservabilityHandle(context.sessionContext, storePath, { createIfMissing: true }),
      close: (handle) => {
        if (ownsHandle) {
          closeObservabilityServiceHandle(handle);
        }
      }
    });
    const persisted = optimizationReports.persistCost({
      dbPath,
      report: preparedReport.report,
      candidateRoutes: preparedReport.candidateRoutes,
      requestedRoutes: args.requestedRoutes,
      referenceTokens: args.referenceTokens,
      createdBy: "switchmaxxer mcp optimize"
    });
    if (!persisted.storeFound || !persisted.report) {
      return buildMcpErrorEnvelope(
        "optimize",
        APP_ERROR_CODES.optimizeError,
        `Observability store could not be opened at '${dbPath}'`,
        {
          details: { store_path: dbPath }
        }
      );
    }

    const report = persisted.report;
    return buildSuccessEnvelope("optimize", report, {
      count: report.ranking.length
    });
  } catch (error) {
    if (error instanceof BenchmarkCancelledError) {
      return buildMcpErrorEnvelope("optimize", APP_ERROR_CODES.optimizeError, error.message, {
        details: { store_path: dbPath, cancel_reason: error.reason }
      });
    }

    return toEnvelopeFromError("optimize", error, APP_ERROR_CODES.optimizeError, {
      store_path: dbPath
    });
  }
}
