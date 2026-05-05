import { APP_ERROR_CODES } from "../../platform/error-codes";
import { loadConfig } from "../config/config";
import { resolveCliConfigPath } from "../config/read-model";
import {
  buildBenchmarkReportView,
  toControlPlaneActionDetailView,
  toControlPlaneActionSummaryView,
  toBenchmarkRunView,
  toBenchmarkSampleView,
  toTraceObservationView,
  toTraceSummaryView
} from "../observability/contracts";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { retentionDurationToCutoffIso } from "../../platform/retention-duration";
import { invalidInputFieldError } from "./errors";
import { buildMcpErrorEnvelope, toEnvelopeFromError, type McpErrorEnvelope, type McpSuccessEnvelope } from "./envelope";
import { resolveObservabilityStorePath } from "./helpers";
import {
  createOstrichBenchmarkHistoryPort,
  createOstrichLedgerPort,
  createOstrichRetentionPort,
  createOstrichTraceMaintenancePort,
  createOstrichTraceQueryPort
} from "../observability/observability-module";
import { closeObservabilityServiceHandle, type ObservabilityRuntimeHandle } from "../observability/runtime-loader";
import {
  parseBenchListArgs,
  parseBenchShowArgs,
  parseLedgerListArgs,
  parseLedgerShowArgs,
  parsePruneArgs,
  parseTraceListArgs,
  parseTraceObservationsArgs,
  parseTraceRepairArgs,
  parseTraceShowArgs,
  parseTraceStatsArgs,
  parseTraceVerifyArgs
} from "./parsers";
import { getSessionObservabilityHandle } from "./session";
import type { McpToolContext } from "./tool-context";

function closeMcpObservabilityPortHandle(
  context: McpToolContext,
  handle: ObservabilityRuntimeHandle | null
): void {
  if (!context.sessionContext) {
    closeObservabilityServiceHandle(handle);
  }
}

function createMcpTraceQueryPort(context: McpToolContext) {
  return createOstrichTraceQueryPort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpObservabilityPortHandle(context, handle)
  });
}

function createMcpTraceMaintenancePort(context: McpToolContext) {
  return createOstrichTraceMaintenancePort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpObservabilityPortHandle(context, handle)
  });
}

function createMcpBenchmarkHistoryPort(context: McpToolContext) {
  return createOstrichBenchmarkHistoryPort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpObservabilityPortHandle(context, handle)
  });
}

function createMcpLedgerPort(context: McpToolContext) {
  return createOstrichLedgerPort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpObservabilityPortHandle(context, handle)
  });
}

function createMcpRetentionPort(context: McpToolContext) {
  return createOstrichRetentionPort({
    openExisting: (dbPath) => getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: false }),
    close: (handle) => closeMcpObservabilityPortHandle(context, handle)
  });
}

export function buildTraceListToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceListArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const filters = {
      routeId: args.routeId,
      providerId: args.providerId,
      outcome: args.outcome,
      limit: args.limit ?? 25
    };
    const listResult = createMcpTraceQueryPort(context).list({ dbPath, filters });
    const { traces } = listResult;

    return buildSuccessEnvelope("trace list", {
      store_path: dbPath,
      filters,
      traces: traces.map((trace) => toTraceSummaryView(trace))
    }, {
      count: traces.length,
      warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("trace list", error, APP_ERROR_CODES.traceListError, {
      store_path: dbPath
    });
  }
}

export function buildTraceShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceShowArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const { traceId } = args;
    const showResult = createMcpTraceQueryPort(context).show({ dbPath, traceId });
    const {
      requestExecution,
      observations,
      benchmarkSamples
    } = showResult;

    if (!requestExecution && observations.length === 0) {
      return buildMcpErrorEnvelope("trace show", APP_ERROR_CODES.traceNotFound, `Trace '${traceId}' was not found`, {
        details: { store_path: dbPath }
      });
    }

    return buildSuccessEnvelope("trace show", {
      store_path: dbPath,
      trace_id: traceId,
      trace: requestExecution ? toTraceSummaryView(requestExecution) : null,
      milestones: requestExecution
        ? {
            request_received_at: requestExecution.request_received_at,
            route_resolved_at: requestExecution.route_resolved_at,
            upstream_request_started_at: requestExecution.upstream_request_started_at,
            upstream_response_started_at: requestExecution.upstream_response_started_at,
            upstream_response_completed_at: requestExecution.upstream_response_completed_at,
            client_response_started_at: requestExecution.client_response_started_at,
            client_response_completed_at: requestExecution.client_response_completed_at
          }
        : null,
      usage: requestExecution
        ? {
            input_tokens: requestExecution.input_tokens,
            output_tokens: requestExecution.output_tokens,
            total_tokens: requestExecution.total_tokens
          }
        : null,
      cost: requestExecution
        ? {
            estimated_cost_micros: requestExecution.estimated_cost_micros,
            currency: requestExecution.currency
          }
        : null,
      benchmark_samples: benchmarkSamples.map((sample) => toBenchmarkSampleView(sample)),
      observations: observations.map((observation) => toTraceObservationView(observation))
    }, {
      top_level: {
        observation_count: observations.length
      }
    });
  } catch (error) {
    return toEnvelopeFromError("trace show", error, APP_ERROR_CODES.traceShowError, {
      store_path: dbPath,
      trace_id: args.traceId
    });
  }
}

export function buildTraceStatsToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceStatsArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const filters = {
      routeId: args.routeId,
      providerId: args.providerId,
      outcome: args.outcome
    };
    const statsResult = createMcpTraceQueryPort(context).getStats({ dbPath, filters });
    const { stats } = statsResult;

    return buildSuccessEnvelope("trace stats", {
      store_path: dbPath,
      filters,
      stats
    }, {
      warnings: statsResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("trace stats", error, APP_ERROR_CODES.traceStatsError, {
      store_path: dbPath
    });
  }
}

export function buildTraceObservationsToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceObservationsArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const filters = {
      routeId: args.routeId,
      providerId: args.providerId,
      kind: args.kind,
      event: args.event,
      limit: args.limit ?? 25
    };
    const observationsResult = createMcpTraceQueryPort(context).listObservations({ dbPath, filters });
    const { observations } = observationsResult;

    return buildSuccessEnvelope("trace observations", {
      store_path: dbPath,
      filters,
      observations: observations.map((observation) => toTraceObservationView(observation))
    }, {
      count: observations.length,
      warnings: observationsResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("trace observations", error, APP_ERROR_CODES.traceObservationsError, {
      store_path: dbPath
    });
  }
}

export function buildTraceVerifyToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceVerifyArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const { traceId, all, batchSize } = args;
    const verifyResult = createMcpTraceMaintenancePort(context).verify({
      dbPath,
      all,
      traceId,
      batchSize
    });
    const { results } = verifyResult;
    const driftedCount = results.filter((result) => result.status !== "ok").length;

    return buildSuccessEnvelope("trace verify", {
      store_path: dbPath,
      scope: all ? "all" : "single",
      trace_id: traceId ?? null,
      batch_size: all ? (batchSize ?? 500) : null,
      results
    }, {
      top_level: {
        result_count: results.length
      },
      warnings: verifyResult.storeFound ? undefined : ["No observability store was found yet."],
      details: {
        drifted_count: driftedCount
      }
    });
  } catch (error) {
    return toEnvelopeFromError("trace verify", error, APP_ERROR_CODES.traceVerifyError, {
      store_path: dbPath,
      trace_id: args.traceId ?? null
    });
  }
}

export function buildBenchListToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseBenchListArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const limit = args.limit ?? 25;
    const listResult = createMcpBenchmarkHistoryPort(context).list({ dbPath, limit });
    const runViews = listResult.runs.map(({ run, summary }) => toBenchmarkRunView(run, summary));

    return buildSuccessEnvelope("bench list", {
      store_path: dbPath,
      runs: runViews
    }, {
      count: runViews.length,
      warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("bench list", error, APP_ERROR_CODES.benchListError, {
      store_path: dbPath
    });
  }
}

export function buildBenchShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseBenchShowArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const { runId } = args;
    const showResult = createMcpBenchmarkHistoryPort(context).show({ dbPath, runId });
    const { run, summary, samples: rawSamples } = showResult;

    if (!showResult.storeFound || !run || !summary) {
      return buildMcpErrorEnvelope("bench show", APP_ERROR_CODES.benchNotFound, `Benchmark run '${runId}' was not found`, {
        details: { store_path: dbPath }
      });
    }

    const samples = rawSamples.map((sample) => toBenchmarkSampleView(sample));
    const runView = toBenchmarkRunView(run, summary);
    const report = buildBenchmarkReportView({
      store_path: dbPath,
      run: runView,
      summary,
      rawSamples,
      samples
    });

    return buildSuccessEnvelope("bench show", report, {
      top_level: {
        sample_count: samples.length
      }
    });
  } catch (error) {
    return toEnvelopeFromError("bench show", error, APP_ERROR_CODES.benchShowError, {
      store_path: dbPath,
      run_id: args.runId
    });
  }
}

export function buildLedgerListToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseLedgerListArgs(context.params);
  const dbPath = resolveObservabilityStorePath();
  const cutoffAt = typeof args.since === "string" ? retentionDurationToCutoffIso(args.since) : undefined;
  const sessionId = args.ownSession ? context.sessionContext?.sessionId : args.sessionId;

  try {
    const filters = {
      route_id: args.routeId ?? null,
      target_id: args.targetId ?? null,
      target_kind: args.targetKind ?? null,
      operation: args.operation ?? null,
      status: args.status ?? null,
      source_surface: args.sourceSurface ?? null,
      session_id: sessionId ?? null,
      optimization_run_id: args.optimizationRunId ?? null,
      mutation_event_id: args.mutationEventId ?? null,
      since: args.since ?? null,
      cutoff_at: cutoffAt ?? null,
      limit: args.limit ?? 25,
      ...(args.ownSession ? { own_session: true } : {})
    };
    const listResult = createMcpLedgerPort(context).list({
      dbPath,
      filters: {
        routeId: args.routeId,
        targetId: args.targetId,
        targetKind: args.targetKind,
        operation: args.operation,
        status: args.status,
        sourceSurface: args.sourceSurface,
        sessionId,
        optimizationRunId: args.optimizationRunId,
        mutationEventId: args.mutationEventId,
        createdSince: cutoffAt,
        limit: args.limit ?? 25
      }
    });
    const events = listResult.events;
    const eventViews = events.map((event) => toControlPlaneActionSummaryView(event));

    return buildSuccessEnvelope("ledger list", {
      store_path: dbPath,
      filters,
      events: eventViews
    }, {
      count: eventViews.length,
      warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
    });
  } catch (error) {
    return toEnvelopeFromError("ledger list", error, APP_ERROR_CODES.ledgerListError, {
      store_path: dbPath
    });
  }
}

export function buildLedgerShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseLedgerShowArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const showResult = createMcpLedgerPort(context).show({
      dbPath,
      ledgerEventId: args.ledgerEventId
    });
    const { event } = showResult;

    if (!event) {
      return buildMcpErrorEnvelope("ledger show", APP_ERROR_CODES.ledgerNotFound, `Ledger event '${args.ledgerEventId}' was not found`, {
        details: { store_path: dbPath, ledger_event_id: args.ledgerEventId }
      });
    }

    return buildSuccessEnvelope("ledger show", {
      store_path: dbPath,
      event: toControlPlaneActionDetailView(event)
    });
  } catch (error) {
    return toEnvelopeFromError("ledger show", error, APP_ERROR_CODES.ledgerShowError, {
      store_path: dbPath,
      ledger_event_id: args.ledgerEventId
    });
  }
}

export function buildTraceRepairToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parseTraceRepairArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const { traceId, all, batchSize } = args;
    const repairResult = createMcpTraceMaintenancePort(context).repair({
      dbPath,
      all,
      traceId,
      batchSize
    });

    if (!repairResult.storeFound) {
      return buildMcpErrorEnvelope(
        "trace repair",
        APP_ERROR_CODES.traceRepairError,
        `Observability store was not found at '${dbPath}'; nothing can be repaired yet`,
        {
          details: {
            store_path: dbPath,
            trace_id: traceId ?? null
          }
        }
      );
    }

    const { results } = repairResult;
    const unhealthyCount = results.filter((result) => result.verification.status !== "ok").length;

    return buildSuccessEnvelope("trace repair", {
      store_path: dbPath,
      scope: all ? "all" : "single",
      trace_id: traceId ?? null,
      batch_size: all ? (batchSize ?? 500) : null,
      results
    }, {
      top_level: {
        result_count: results.length
      },
      details: {
        remaining_unhealthy_count: unhealthyCount
      }
    });
  } catch (error) {
    return toEnvelopeFromError("trace repair", error, APP_ERROR_CODES.traceRepairError, {
      store_path: dbPath,
      trace_id: args.traceId ?? null
    });
  }
}

function resolvePruneOlderThan(olderThan: string | undefined, configPath?: string): string {
  if (olderThan) {
    return olderThan;
  }

  const configuredOlderThan = loadConfig(configPath).observability.retentionOlderThan;
  if (configuredOlderThan) {
    return configuredOlderThan;
  }

  throw invalidInputFieldError(
    "Provide 'older_than' or set 'observability.retention.older_than' in config.json."
  );
}

export function buildPruneToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const args = parsePruneArgs(context.params);
  const dbPath = resolveObservabilityStorePath();

  try {
    const olderThan = resolvePruneOlderThan(args.olderThan, context.configPath);
    const cutoffAt = retentionDurationToCutoffIso(olderThan);
    const pruneResult = createMcpRetentionPort(context).pruneOlderThan({
      dbPath,
      cutoffIso: cutoffAt
    });

    if (!pruneResult.storeFound || !pruneResult.result) {
      return buildMcpErrorEnvelope(
        "prune",
        APP_ERROR_CODES.pruneError,
        `Observability store was not found at '${dbPath}'; nothing can be pruned yet`,
        {
          details: {
            store_path: dbPath,
            older_than: olderThan
          }
        }
      );
    }

    const { result } = pruneResult;

    return buildSuccessEnvelope(
      "prune",
      {
        store_path: dbPath,
        older_than: olderThan,
        result
      },
      {
        top_level: {
          deleted_count: result.total_deleted
        }
      }
    );
  } catch (error) {
    return toEnvelopeFromError("prune", error, APP_ERROR_CODES.pruneError, {
      store_path: dbPath,
      older_than: args.olderThan ?? null,
      config_path: context.configPath ? resolveCliConfigPath(context.configPath) : null
    });
  }
}
