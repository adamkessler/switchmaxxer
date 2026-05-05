import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import {
  buildLatencyOptimizeReport,
  buildCostOptimizeExecution,
  persistCostOptimizeReport,
  persistLatencyOptimizeReport,
  reportFromOptimizationRunView,
  selectOptimizeCandidateRoutes
} from "../observability/optimize-report-builder";
import { BenchmarkCancelledError } from "../bench/bench-runtime";
import { runBenchmarkOperation } from "../observability/bench-runner";
import { loadConfig } from "../config/config";
import { loadCliReadModel } from "../config/read-model";
import { toOptimizationRunView } from "../observability/optimizations";
import {
  runOptimizeApplyMutation,
  runOptimizeRestoreMutation
} from "../observability/optimize-orchestrator";
import {
  buildOptimizeApplyWarnings,
  buildSkippedOptimizeReloadView,
  type OptimizeApplyVerificationView
} from "../observability/optimize-ledger-views";
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
    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false });
    const runs = handle?.service.optimizations.listRuns(limit) ?? [];
    const runViews = runs.map((run) => toOptimizationRunView(run));

    return buildSuccessEnvelope("optimize list", {
      store_path: dbPath,
      runs: runViews
    }, {
      count: runViews.length,
      warnings: handle ? undefined : ["No observability store was found yet."]
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
    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false });

    if (!handle) {
      return buildMcpErrorEnvelope("optimize show", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const run = handle.service.optimizations.getRun(runId);
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
    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false });
    if (!handle) {
      return buildMcpErrorEnvelope("optimize apply", APP_ERROR_CODES.optimizeNotFound, `Optimization run '${runId}' was not found`, {
        details: { store_path: dbPath, run_id: runId }
      });
    }

    const readModel = context.getReadModel();
    const requestedPostActions: Array<"reload" | "verify"> = [
      ...(args.reload ? ["reload" as const] : []),
      ...(args.verify ? ["verify" as const] : [])
    ];
    const postActionDeps = !args.dryRun && requestedPostActions.length > 0
      ? requireOptimizePostActionDeps(context, "optimize apply", requestedPostActions)
      : null;
    const result = runOptimizeApplyMutation({
      service: handle.service,
      dbPath,
      configPath: context.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(context.configPath),
      mutateConfigDocument,
      getMutableConfigSection: getMutableSection,
      sourceSurface: "mcp",
      createdBy: "switchmaxxer mcp optimize_apply",
      actorKind: "agent",
      sessionId: context.sessionContext?.sessionId ?? null,
      runId,
      targetRouteId: routeId,
      dryRun: args.dryRun,
      deferLedgerCompletion: !args.dryRun && (args.reload || args.verify),
      metadata: {
        reload_requested: args.reload,
        verify_requested: args.verify
      }
    });
    if (!result.ok) {
      return buildMcpErrorEnvelope("optimize apply", result.code, result.message, { details: result.details });
    }

    if (args.dryRun || (!args.reload && !args.verify)) {
      return buildSuccessEnvelope("optimize apply", result.view);
    }

    if (!result.deferred) {
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

    pendingLedgerCompletion = (message) => {
      result.complete({
        warnings: [message],
        includePostActionResult: true
      });
    };
    const reload = args.reload
      ? result.changed
        ? await postActionDeps!.runOptimizeApplyReload({ configPath: context.configPath })
        : buildSkippedOptimizeReloadView()
      : null;
    const verification: OptimizeApplyVerificationView | null = args.verify
      ? await postActionDeps!.runOptimizeApplyVerify({ configPath: context.configPath, routeId })
      : null;
    const warnings = buildOptimizeApplyWarnings({ reload, verification });
    const view = result.complete({
      reload,
      verification,
      warnings,
      includePostActionResult: true
    });
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
    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false });
    if (!handle) {
      return buildMcpErrorEnvelope("optimize restore", APP_ERROR_CODES.optimizeNotFound, "No optimize apply restore point was found", {
        details: {
          store_path: dbPath,
          ...(args.mode === "action"
            ? { action_id: args.actionId }
            : { run_id: args.runId, route_id: args.routeId })
        }
      });
    }

    const readModel = context.getReadModel();
    const requestedPostActions: Array<"reload" | "verify"> = [
      ...(args.reload ? ["reload" as const] : []),
      ...(args.verify ? ["verify" as const] : [])
    ];
    const postActionDeps = !args.dryRun && requestedPostActions.length > 0
      ? requireOptimizePostActionDeps(context, "optimize restore", requestedPostActions)
      : null;
    const result = runOptimizeRestoreMutation({
      service: handle.service,
      dbPath,
      configPath: context.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(context.configPath),
      mutateConfigDocument,
      getMutableConfigSection: getMutableSection,
      sourceSurface: "mcp",
      createdBy: "switchmaxxer mcp optimize_restore",
      actorKind: "agent",
      sessionId: context.sessionContext?.sessionId ?? null,
      selector: args.mode === "run_route"
        ? {
            mode: "run_route",
            runId: args.runId,
            routeId: args.routeId
          }
        : {
            mode: "action",
            actionId: args.actionId
          },
      dryRun: args.dryRun,
      deferLedgerCompletion: !args.dryRun && (args.reload || args.verify),
      metadata: {
        reload_requested: args.reload,
        verify_requested: args.verify
      }
    });
    if (!result.ok) {
      return buildMcpErrorEnvelope("optimize restore", result.code, result.message, { details: result.details });
    }

    if (args.dryRun || (!args.reload && !args.verify)) {
      return buildSuccessEnvelope("optimize restore", result.view);
    }

    if (!result.deferred) {
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

    pendingLedgerCompletion = (message) => {
      result.complete({
        warnings: [message],
        includePostActionResult: true
      });
    };
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
    const view = result.complete({
      reload,
      verification,
      warnings,
      includePostActionResult: true
    });
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
      const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: true });
      if (!handle) {
        return buildMcpErrorEnvelope(
          "optimize",
          APP_ERROR_CODES.optimizeError,
          `Observability store could not be opened at '${dbPath}'`,
          {
            details: { store_path: dbPath }
          }
        );
      }
      const abortSignal = createMcpBenchmarkOperationAbortSignal({
        sessionSignal: context.sessionContext?.abortSignal,
        timeoutMessage: "MCP optimize_run latency benchmark exceeded the wall-clock limit"
      });
      const runnerResult = await runBenchmarkOperation({
        service: handle.service,
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

      const report = persistLatencyOptimizeReport({
        report: reportResult.report,
        candidateRoutes: selectedCandidates.routes,
        requestedRoutes: args.requestedRoutes,
        service: handle.service,
        storePath: dbPath,
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

    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: true });
    if (!handle) {
      return buildMcpErrorEnvelope(
        "optimize",
        APP_ERROR_CODES.optimizeError,
        `Observability store could not be opened at '${dbPath}'`,
        {
          details: { store_path: dbPath }
        }
      );
    }

    const report = persistCostOptimizeReport({
      report: preparedReport.report,
      candidateRoutes: preparedReport.candidateRoutes,
      requestedRoutes: args.requestedRoutes,
      referenceTokens: args.referenceTokens,
      service: handle.service,
      storePath: dbPath,
      createdBy: "switchmaxxer mcp optimize"
    });

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
