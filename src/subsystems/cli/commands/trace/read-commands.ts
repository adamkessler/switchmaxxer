import { APP_ERROR_CODES, type AppErrorCode } from "../../../../platform/error-codes";
import { parsePositiveIntegerFlagValue } from "../../command-arg-primitives";
import {
  buildAllowedObservabilityFilterMessage,
  isAllowedObservabilityFilterValue
} from "../../../observability/filter-value-validation";
import type { BenchmarkSampleRecord } from "../../../observability/benchmarks";
import type { ObservabilityTraceQueryPort } from "../../../observability/observability-module";
import type {
  RequestExecutionRecord,
  RequestExecutionStats
} from "../../../observability/request-executions";
import type {
  ObservationEvent,
  ObservationKind,
  ObservationOutcome,
  ObservationRecord
} from "../../../observability/types";

export type TraceReadCommandDeps = {
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
  traceQueries: ObservabilityTraceQueryPort;
  toTraceSummaryView: (trace: RequestExecutionRecord) => Record<string, unknown>;
  toTraceObservationView: (observation: ObservationRecord) => Record<string, unknown>;
  toBenchmarkSampleView: (sample: BenchmarkSampleRecord) => Record<string, unknown>;
  resolveObservabilityStorePath: () => string;
  observationOutcomes: readonly ObservationOutcome[];
  observationKinds: readonly ObservationKind[];
  observationEvents: readonly ObservationEvent[];
};

function parseTraceArgs(deps: TraceReadCommandDeps, argv: string[]): {
  routeId?: string;
  providerId?: string;
  outcome?: ObservationOutcome;
  limit?: number;
  json: boolean;
  errorMessage?: string;
} {
  let routeId: string | undefined;
  let providerId: string | undefined;
  let outcome: ObservationOutcome | undefined;
  let limit: number | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    for (const flagName of ["--route", "--provider", "--outcome", "--limit"] as const) {
      const parsedFlag = deps.readLongFlagValue(argv, index, flagName);
      if (!parsedFlag) {
        continue;
      }

      if (parsedFlag.errorMessage) {
        return { routeId, providerId, outcome, limit, json, errorMessage: parsedFlag.errorMessage };
      }

      const nextArg = parsedFlag.value as string;

      if (flagName === "--route") {
        routeId = nextArg;
      } else if (flagName === "--provider") {
        providerId = nextArg;
      } else if (flagName === "--outcome") {
        if (!isAllowedObservabilityFilterValue(nextArg, deps.observationOutcomes)) {
          return {
            routeId,
            providerId,
            outcome,
            limit,
            json,
            errorMessage: buildAllowedObservabilityFilterMessage("Flag '--outcome'", deps.observationOutcomes).replace(
              "must be one of:",
              "must be one of"
            )
          };
        }

        outcome = nextArg;
      } else {
        const parsed = parsePositiveIntegerFlagValue(nextArg, "--limit");
        if (parsed.errorMessage || typeof parsed.value !== "number") {
          return {
            routeId,
            providerId,
            outcome,
            limit,
            json,
            errorMessage: "Flag '--limit' requires a positive integer value"
          };
        }

        limit = parsed.value;
      }

      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { routeId, providerId, outcome, limit, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { routeId, providerId, outcome, limit, json };
}

function parseTraceObservationArgs(deps: TraceReadCommandDeps, argv: string[]): {
  routeId?: string;
  providerId?: string;
  kind?: ObservationKind;
  event?: ObservationEvent;
  limit?: number;
  json: boolean;
  errorMessage?: string;
} {
  let routeId: string | undefined;
  let providerId: string | undefined;
  let kind: ObservationKind | undefined;
  let event: ObservationEvent | undefined;
  let limit: number | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    for (const flagName of ["--route", "--provider", "--kind", "--event", "--limit"] as const) {
      const parsedFlag = deps.readLongFlagValue(argv, index, flagName);
      if (!parsedFlag) {
        continue;
      }

      if (parsedFlag.errorMessage) {
        return { routeId, providerId, kind, event, limit, json, errorMessage: parsedFlag.errorMessage };
      }

      const nextArg = parsedFlag.value as string;

      if (flagName === "--route") {
        routeId = nextArg;
      } else if (flagName === "--provider") {
        providerId = nextArg;
      } else if (flagName === "--kind") {
        if (!isAllowedObservabilityFilterValue(nextArg, deps.observationKinds)) {
          return {
            routeId,
            providerId,
            kind,
            event,
            limit,
            json,
            errorMessage: buildAllowedObservabilityFilterMessage("Flag '--kind'", deps.observationKinds).replace(
              "must be one of:",
              "must be one of"
            )
          };
        }

        kind = nextArg;
      } else if (flagName === "--event") {
        if (!isAllowedObservabilityFilterValue(nextArg, deps.observationEvents)) {
          return {
            routeId,
            providerId,
            kind,
            event,
            limit,
            json,
            errorMessage: buildAllowedObservabilityFilterMessage("Flag '--event'", deps.observationEvents).replace(
              "must be one of:",
              "must be one of"
            )
          };
        }

        event = nextArg;
      } else {
        const parsed = parsePositiveIntegerFlagValue(nextArg, "--limit");
        if (parsed.errorMessage || typeof parsed.value !== "number") {
          return {
            routeId,
            providerId,
            kind,
            event,
            limit,
            json,
            errorMessage: "Flag '--limit' requires a positive integer value"
          };
        }

        limit = parsed.value;
      }

      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { routeId, providerId, kind, event, limit, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { routeId, providerId, kind, event, limit, json };
}

function parseTraceStatsArgs(deps: TraceReadCommandDeps, argv: string[]): {
  routeId?: string;
  providerId?: string;
  outcome?: ObservationOutcome;
  json: boolean;
  errorMessage?: string;
} {
  const parsed = parseTraceArgs(deps, argv);

  if (parsed.errorMessage) {
    return parsed;
  }

  if (typeof parsed.limit !== "undefined") {
    return {
      routeId: parsed.routeId,
      providerId: parsed.providerId,
      outcome: parsed.outcome,
      json: parsed.json,
      errorMessage: "Flag '--limit' is not supported for 'trace stats'"
    };
  }

  return {
    routeId: parsed.routeId,
    providerId: parsed.providerId,
    outcome: parsed.outcome,
    json: parsed.json
  };
}

function renderTraceListText(
  deps: TraceReadCommandDeps,
  traces: RequestExecutionRecord[],
  dbPath: string,
  filters: Record<string, unknown>
): string {
  const lines = [`Traces (${traces.length})`, `Store: ${dbPath}`];
  const activeFilters = [
    filters["routeId"] ? `route=${filters["routeId"]}` : null,
    filters["providerId"] ? `provider=${filters["providerId"]}` : null,
    filters["outcome"] ? `outcome=${filters["outcome"]}` : null,
    `limit=${String(filters["limit"])}`
  ].filter((value): value is string => Boolean(value));

  lines.push(`Filters: ${activeFilters.join(" ")}`);

  if (traces.length === 0) {
    lines.push("", "No recorded traces yet.");
    return `${lines.join("\n")}\n`;
  }

  for (const trace of traces) {
    const view = deps.toTraceSummaryView(trace);
    lines.push(
      "",
      `${String(view["trace_id"])}  path=${String(view["path"])} outcome=${String(view["outcome"])} route=${String(
        view["route_name"] ?? view["route_id"] ?? "-"
      )} provider=${String(view["provider_id"] ?? "-")} status=${String(view["status_code"] ?? "-")} latency_ms=${String(
        view["latency_ms"] ?? "-"
      )}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderTraceShowText(
  deps: TraceReadCommandDeps,
  traceId: string,
  requestExecution: RequestExecutionRecord | null,
  observations: ObservationRecord[],
  benchmarkSamples: BenchmarkSampleRecord[],
  dbPath: string
): string {
  const lines = [`Trace ${traceId}`, `Store: ${dbPath}`];

  if (requestExecution) {
    const view = deps.toTraceSummaryView(requestExecution);
    lines.push(
      "",
      `Path: ${String(view["path"])}`,
      `Outcome: ${String(view["outcome"])}`,
      `Route: ${String(view["route_name"] ?? view["route_id"] ?? "-")}`,
      `Provider: ${String(view["provider_id"] ?? "-")}`,
      `Status: ${String(view["status_code"] ?? "-")}`,
      `Latency Ms: ${String(view["latency_ms"] ?? "-")}`,
      `Observations: ${String(view["observation_count"])}`
    );

    if (requestExecution.failure_stage || requestExecution.failure_reason) {
      lines.push(`Failure stage: ${requestExecution.failure_stage ?? "-"}`, `Failure reason: ${requestExecution.failure_reason ?? "-"}`);
    }
  } else {
    lines.push("", "No request execution summary is currently available for this trace.");
  }

  if (benchmarkSamples.length > 0) {
    lines.push("", `Benchmark samples (${benchmarkSamples.length})`);
    for (const sample of benchmarkSamples) {
      lines.push(
        `${sample.benchmark_run_id} sample=${sample.sample_index} warmup=${sample.is_warmup === 1} outcome=${sample.outcome} latency_ms=${sample.latency_ms ?? "-"}`
      );
    }
  }

  lines.push("", `Observation timeline (${observations.length})`);
  for (const observation of observations) {
    const view = deps.toTraceObservationView(observation);
    const truncationBadge = view["attributes_truncated"] === true ? " [attributes truncated]" : "";
    lines.push(
      `${String(view["observed_at"])}  ${String(view["kind"])}/${String(view["event"])} stage=${String(view["stage"] ?? "-")} outcome=${String(
        view["outcome"] ?? "-"
      )}${truncationBadge}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderTraceStatsText(stats: RequestExecutionStats, dbPath: string, filters: Record<string, unknown>): string {
  const lines = ["Trace stats", `Store: ${dbPath}`];
  const activeFilters = [
    filters["routeId"] ? `route=${filters["routeId"]}` : null,
    filters["providerId"] ? `provider=${filters["providerId"]}` : null,
    filters["outcome"] ? `outcome=${filters["outcome"]}` : null
  ].filter((value): value is string => Boolean(value));

  lines.push(`Filters: ${activeFilters.length > 0 ? activeFilters.join(" ") : "none"}`);
  lines.push(
    "",
    `Total traces: ${stats.total_count}`,
    `Partial output traces: ${stats.partial_output_count}`,
    `Average latency ms: ${stats.average_gateway_residency_ms ?? "-"}`,
    `Average TTFT ms: ${stats.average_upstream_ttft_ms ?? "-"}`,
    `Average duration ms: ${stats.average_upstream_duration_ms ?? "-"}`
  );

  lines.push("", "Outcome counts:");
  if (stats.outcome_counts.length === 0) {
    lines.push("none");
  } else {
    for (const row of stats.outcome_counts) {
      lines.push(`${row.outcome}: ${row.count}`);
    }
  }

  lines.push("", "Top failing routes:");
  if (stats.top_failing_routes.length === 0) {
    lines.push("none");
  } else {
    for (const row of stats.top_failing_routes) {
      lines.push(`${row.route}: ${row.count}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderTraceObservationsText(
  deps: TraceReadCommandDeps,
  observations: ObservationRecord[],
  dbPath: string,
  filters: Record<string, unknown>
): string {
  const lines = [`Recent observations (${observations.length})`, `Store: ${dbPath}`];
  const activeFilters = [
    filters["routeId"] ? `route=${filters["routeId"]}` : null,
    filters["providerId"] ? `provider=${filters["providerId"]}` : null,
    filters["kind"] ? `kind=${filters["kind"]}` : null,
    filters["event"] ? `event=${filters["event"]}` : null,
    `limit=${String(filters["limit"])}`
  ].filter((value): value is string => Boolean(value));

  lines.push(`Filters: ${activeFilters.join(" ")}`);

  if (observations.length === 0) {
    lines.push("", "No recorded observations yet.");
    return `${lines.join("\n")}\n`;
  }

  for (const observation of observations) {
    const view = deps.toTraceObservationView(observation);
    const truncationBadge = view["attributes_truncated"] === true ? " [attributes truncated]" : "";
    lines.push(
      "",
      `${String(view["observed_at"])}  ${String(view["kind"])}/${String(view["event"])} request=${String(
        view["request_id"] ?? "-"
      )} route=${String(view["route_name"] ?? view["route_id"] ?? "-")} stage=${String(view["stage"] ?? "-")} outcome=${String(
        view["outcome"] ?? "-"
      )}${truncationBadge}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function createTraceReadCommands(deps: TraceReadCommandDeps) {
  function runTraceList(argv: string[]): number {
    const parsedArgs = parseTraceArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const filters = {
        routeId: parsedArgs.routeId,
        providerId: parsedArgs.providerId,
        outcome: parsedArgs.outcome,
        limit: parsedArgs.limit ?? 25
      };
      const listResult = deps.traceQueries.list({
        dbPath,
        filters
      });
      const { traces } = listResult;
      const traceViews = traces.map((trace) => deps.toTraceSummaryView(trace));

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace list",
          {
            store_path: dbPath,
            filters,
            traces: traceViews
          },
          {
            count: traceViews.length,
            warnings: listResult.storeFound ? undefined : ["No observability store was found yet."]
          }
        );
        return 0;
      }

      deps.writeStdout(renderTraceListText(deps, traces, dbPath, filters));
      if (!listResult.storeFound) {
        deps.writeStderr("Note: no observability store was found yet.");
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace list error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace list", APP_ERROR_CODES.traceListError, message, {
          details: { store_path: dbPath || null }
        });
        return 1;
      }

      deps.writeStderr(`Trace list failed: ${message}`);
      return 1;
    }
  }

  function runTraceShow(traceId: string, argv: string[]): number {
    const parsedArgs = parseTraceArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const showResult = deps.traceQueries.show({ dbPath, traceId });

      if (!showResult.storeFound) {
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("trace show", APP_ERROR_CODES.traceNotFound, `Trace '${traceId}' was not found`, {
            details: { store_path: dbPath }
          });
          return 1;
        }

        deps.writeStderr(`Trace '${traceId}' was not found.`);
        return 1;
      }

      const { requestExecution, observations, benchmarkSamples } = showResult;

      if (!requestExecution && observations.length === 0) {
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("trace show", APP_ERROR_CODES.traceNotFound, `Trace '${traceId}' was not found`, {
            details: { store_path: dbPath }
          });
          return 1;
        }

        deps.writeStderr(`Trace '${traceId}' was not found.`);
        return 1;
      }

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace show",
          {
            store_path: dbPath,
            trace_id: traceId,
            trace: requestExecution ? deps.toTraceSummaryView(requestExecution) : null,
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
            benchmark_samples: benchmarkSamples.map((sample) => deps.toBenchmarkSampleView(sample)),
            observations: observations.map((observation) => deps.toTraceObservationView(observation))
          },
          {
            top_level: {
              observation_count: observations.length
            }
          }
        );
        return 0;
      }

      deps.writeStdout(renderTraceShowText(deps, traceId, requestExecution, observations, benchmarkSamples, dbPath));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace show error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace show", APP_ERROR_CODES.traceShowError, message, {
          details: {
            store_path: dbPath || null,
            trace_id: traceId
          }
        });
        return 1;
      }

      deps.writeStderr(`Trace show failed: ${message}`);
      return 1;
    }
  }

  function runTraceStats(argv: string[]): number {
    const parsedArgs = parseTraceStatsArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";
    const filters = {
      routeId: parsedArgs.routeId,
      providerId: parsedArgs.providerId,
      outcome: parsedArgs.outcome
    };

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const statsResult = deps.traceQueries.getStats({
        dbPath,
        filters
      });
      const { stats } = statsResult;

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace stats",
          {
            store_path: dbPath,
            filters,
            stats
          },
          {
            warnings: statsResult.storeFound ? undefined : ["No observability store was found yet."]
          }
        );
        return 0;
      }

      deps.writeStdout(renderTraceStatsText(stats, dbPath, filters));
      if (!statsResult.storeFound) {
        deps.writeStderr("Note: no observability store was found yet.");
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace stats error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace stats", APP_ERROR_CODES.traceStatsError, message, {
          details: { store_path: dbPath || null }
        });
        return 1;
      }

      deps.writeStderr(`Trace stats failed: ${message}`);
      return 1;
    }
  }

  function runTraceObservations(argv: string[]): number {
    const parsedArgs = parseTraceObservationArgs(deps, argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";
    const filters = {
      routeId: parsedArgs.routeId,
      providerId: parsedArgs.providerId,
      kind: parsedArgs.kind,
      event: parsedArgs.event,
      limit: parsedArgs.limit ?? 25
    };

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const observationsResult = deps.traceQueries.listObservations({
        dbPath,
        filters
      });
      const { observations } = observationsResult;
      const observationViews = observations.map((observation) => deps.toTraceObservationView(observation));

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "trace observations",
          {
            store_path: dbPath,
            filters,
            observations: observationViews
          },
          {
            count: observationViews.length,
            warnings: observationsResult.storeFound ? undefined : ["No observability store was found yet."]
          }
        );
        return 0;
      }

      deps.writeStdout(renderTraceObservationsText(deps, observations, dbPath, filters));
      if (!observationsResult.storeFound) {
        deps.writeStderr("Note: no observability store was found yet.");
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown trace observations error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("trace observations", APP_ERROR_CODES.traceObservationsError, message, {
          details: { store_path: dbPath || null }
        });
        return 1;
      }

      deps.writeStderr(`Trace observations failed: ${message}`);
      return 1;
    }
  }

  return {
    runTraceList,
    runTraceShow,
    runTraceStats,
    runTraceObservations
  };
}
