import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { test } from "./observability.test-support";

const schemaPath = path.join(
  process.cwd(),
  "src/subsystems/observability/ipc-schemas/observability-ipc.schema.json"
);

function loadSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
}

function compileSchema() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  return ajv.compile(loadSchema());
}

function validTraceListRequest(): Record<string, unknown> {
  return {
    id: "schema-trace-list-request",
    operation: "trace.list",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      filters: {
        routeId: "route-schema",
        providerId: "provider-schema",
        outcome: "success",
        limit: 5
      }
    }
  };
}

function validTraceListSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-trace-list-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      traces: [
        {
          id: "execution-schema",
          request_id: "request-schema",
          started_at: "2026-05-13T00:00:00.000Z",
          completed_at: null,
          request_received_at: "2026-05-13T00:00:00.000Z",
          route_resolved_at: null,
          upstream_request_started_at: null,
          upstream_response_started_at: null,
          upstream_response_completed_at: null,
          client_response_started_at: null,
          client_response_completed_at: null,
          route_id: "route-schema",
          route_name: "route schema",
          model_id: "model-schema",
          provider_id: "provider-schema",
          provider_model_id: "provider-model-schema",
          client_api_mode: "openai-completions",
          upstream_api_mode: null,
          status_code: 200,
          outcome: "success",
          failure_stage: null,
          failure_reason: null,
          observation_count: 3,
          latency_ms: 42,
          ttft_ms: null,
          duration_ms: 42,
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          estimated_cost_micros: 12,
          currency: "USD",
          switchmaxxer_pre_upstream_ms: 1,
          upstream_ttft_ms: null,
          upstream_duration_ms: 40,
          switchmaxxer_post_upstream_ms: 1,
          client_write_ms: 0,
          gateway_residency_ms: 42,
          partial_output: 0
        }
      ]
    },
    warnings: []
  };
}

function validTraceListObservationsRequest(): Record<string, unknown> {
  return {
    id: "schema-trace-list-observations-request",
    operation: "trace.listObservations",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      filters: {
        requestId: "request-schema",
        routeId: "route-schema",
        providerId: "provider-schema",
        kind: "measurement",
        event: "request_received",
        limit: 5
      }
    }
  };
}

function validTraceListObservationsSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-trace-list-observations-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      observations: [
        {
          id: "observation-schema",
          observed_at: "2026-05-13T00:00:00.000Z",
          ingested_at: "2026-05-13T00:00:01.000Z",
          request_id: "request-schema",
          trace_id: "trace-schema",
          span_id: "span-schema",
          parent_span_id: null,
          surface: "gateway",
          kind: "measurement",
          event: "request_received",
          stage: "ingress",
          severity: null,
          outcome: "started",
          route_id: "route-schema",
          route_name: "route schema",
          model_id: "model-schema",
          provider_id: "provider-schema",
          provider_model_id: "provider-model-schema",
          client_api_mode: "openai-completions",
          upstream_api_mode: null,
          listener: "http",
          actor: "client",
          status_code: 200,
          latency_ms: 42,
          ttft_ms: null,
          duration_ms: 42,
          request_bytes: 128,
          response_bytes: 256,
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          estimated_cost_micros: 12,
          currency: "USD",
          billing_source: "usage",
          benchmark_run_id: null,
          benchmark_case_id: null,
          optimization_profile_id: null,
          tags_json: "[\"schema\"]",
          attributes_json: "{\"schema\":true}",
          attributes_truncated: 0,
          message: "schema observation"
        }
      ]
    },
    warnings: []
  };
}

function validTraceGetStatsRequest(): Record<string, unknown> {
  return {
    id: "schema-trace-get-stats-request",
    operation: "trace.getStats",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      filters: {
        routeId: "route-schema",
        providerId: "provider-schema",
        outcome: "success",
        limit: 5
      }
    }
  };
}

function validTraceGetStatsSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-trace-get-stats-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      stats: {
        total_count: 3,
        partial_output_count: 1,
        average_gateway_residency_ms: 42.5,
        average_upstream_ttft_ms: null,
        average_upstream_duration_ms: 40,
        outcome_counts: [
          {
            outcome: "success",
            count: 2
          }
        ],
        top_failing_routes: [
          {
            route: "route-schema",
            count: 1
          }
        ]
      }
    },
    warnings: []
  };
}

function validTraceShowRequest(): Record<string, unknown> {
  return {
    id: "schema-trace-show-request",
    operation: "trace.show",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      traceId: "request-schema"
    }
  };
}

function validTraceShowSuccessResponse(): Record<string, unknown> {
  const traceListResponse = validTraceListSuccessResponse();
  const traceListResult = traceListResponse["result"] as Record<string, unknown>;
  const requestExecution = (traceListResult["traces"] as unknown[])[0];
  const traceListObservationsResponse = validTraceListObservationsSuccessResponse();
  const traceListObservationsResult = traceListObservationsResponse["result"] as Record<string, unknown>;
  const observation = (traceListObservationsResult["observations"] as unknown[])[0];

  return {
    id: "schema-trace-show-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      requestExecution,
      observations: [observation],
      benchmarkSamples: [
        {
          id: "sample-schema",
          benchmark_run_id: "benchmark-schema",
          request_execution_id: "request-schema",
          route_id: "route-schema",
          provider_id: "provider-schema",
          provider_model_id: "provider-model-schema",
          sample_index: 0,
          started_at: "2026-05-13T00:00:00.000Z",
          completed_at: "2026-05-13T00:00:01.000Z",
          status_code: 200,
          outcome: "success",
          latency_ms: 42,
          ttft_ms: null,
          duration_ms: 42,
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          estimated_cost_micros: 12,
          is_warmup: 0,
          score_value: 0.98,
          score_scale: "unit",
          score_direction: "higher",
          score_source: "schema",
          score_method: "manual",
          scored_at: "2026-05-13T00:00:02.000Z",
          score_json: "{\"score\":0.98}"
        }
      ]
    },
    warnings: []
  };
}

function validLedgerEvent(): Record<string, unknown> {
  return {
    id: "ledger-schema",
    created_at: "2026-05-13T00:00:00.000Z",
    finished_at: "2026-05-13T00:00:01.000Z",
    created_by: "schema test",
    source_surface: "cli",
    actor_kind: "operator",
    actor_id: "operator-schema",
    session_id: null,
    operation: "optimize_apply",
    status: "succeeded",
    target_kind: "route",
    target_id: "route-schema",
    optimization_run_id: "optimization-schema",
    mutation_event_id: "mutation-schema",
    correlation_ids_json: "{\"requestId\":\"request-schema\"}",
    result_json: "{\"ok\":true}",
    error_json: "{}",
    metadata_json: "{}"
  };
}

function validLedgerListRequest(): Record<string, unknown> {
  return {
    id: "schema-ledger-list-request",
    operation: "ledger.list",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      filters: {
        routeId: "route-schema",
        targetId: "route-schema",
        targetKind: "route",
        operation: "optimize_apply",
        status: "succeeded",
        sourceSurface: "cli",
        sessionId: "session-schema",
        optimizationRunId: "optimization-schema",
        mutationEventId: "mutation-schema",
        createdSince: "2026-05-13T00:00:00.000Z",
        limit: 5
      }
    }
  };
}

function validLedgerListSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-ledger-list-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      events: [validLedgerEvent()]
    },
    warnings: []
  };
}

function validLedgerShowRequest(): Record<string, unknown> {
  return {
    id: "schema-ledger-show-request",
    operation: "ledger.show",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      ledgerEventId: "ledger-schema"
    }
  };
}

function validLedgerShowSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-ledger-show-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      event: validLedgerEvent()
    },
    warnings: []
  };
}

function validRetentionPruneOlderThanRequest(): Record<string, unknown> {
  return {
    id: "schema-retention-prune-request",
    operation: "retention.pruneOlderThan",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }
  };
}

function validRetentionPruneOlderThanSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-retention-prune-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        status: "completed",
        cutoff_at: "2026-05-01T00:00:00.000Z",
        failure_stage: null,
        failure_message: null,
        observations_deleted: 1,
        request_executions_deleted: 1,
        benchmark_runs_deleted: 0,
        benchmark_samples_deleted: 0,
        cost_facts_deleted: 0,
        optimization_facts_deleted: 0,
        control_plane_action_events_deleted: 0,
        config_mutation_events_deleted: 0,
        config_snapshots_deleted: 0,
        total_deleted: 2
      }
    },
    warnings: []
  };
}

function validBenchmarkRun(): Record<string, unknown> {
  return {
    id: "benchmark-schema",
    name: "schema benchmark",
    created_at: "2026-05-13T00:00:00.000Z",
    created_by: "schema test",
    objective: "latency",
    notes: null,
    settings_json: "{\"iterations\":1}",
    status: "completed"
  };
}

function validBenchmarkSummary(): Record<string, unknown> {
  return {
    total_samples: 2,
    measured_samples: 1,
    warmup_samples: 1,
    success_count: 1,
    failed_count: 0,
    average_latency_ms: 42.5,
    min_latency_ms: 42,
    max_latency_ms: 43,
    average_ttft_ms: null,
    average_duration_ms: 40
  };
}

function validBenchmarkSample(): Record<string, unknown> {
  return {
    id: "sample-schema",
    benchmark_run_id: "benchmark-schema",
    request_execution_id: "request-schema",
    route_id: "route-schema",
    provider_id: "provider-schema",
    provider_model_id: "provider-model-schema",
    sample_index: 0,
    started_at: "2026-05-13T00:00:00.000Z",
    completed_at: "2026-05-13T00:00:01.000Z",
    status_code: 200,
    outcome: "success",
    latency_ms: 42,
    ttft_ms: null,
    duration_ms: 42,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    estimated_cost_micros: 12,
    is_warmup: 0,
    score_value: 0.98,
    score_scale: "unit",
    score_direction: "higher",
    score_source: "schema",
    score_method: "manual",
    scored_at: "2026-05-13T00:00:02.000Z",
    score_json: "{\"score\":0.98}"
  };
}

function validBenchmarkGatewayPreflight(): Record<string, unknown> {
  return {
    ok: true,
    sourceFile: "config.json",
    sourcePath: "/tmp/schema-config.json",
    bindHost: "127.0.0.1",
    port: 8080,
    probeHost: "127.0.0.1",
    healthUrl: "http://127.0.0.1:8080/health",
    pid: null,
    latencyMs: 5
  };
}

function validBenchmarkReport(): Record<string, unknown> {
  return {
    store_path: "/tmp/schema-observability.sqlite",
    run: {
      id: "benchmark-schema",
      name: "schema benchmark"
    },
    execution: {
      path_mode: "gateway",
      iterations: 1
    },
    summary: validBenchmarkSummary(),
    analysis: {
      by_path: [
        {
          path: "gateway",
          sample_count: 1
        }
      ]
    },
    samples: [
      {
        id: "sample-schema",
        path: "gateway"
      }
    ]
  };
}

function validBenchmarkRunsRunRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-runs-run-request",
    operation: "benchmarkRuns.run",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      config: {
        bindHost: "127.0.0.1",
        port: 8080,
        timeoutMs: 5000,
        routes: {}
      },
      routeNames: ["route-schema"],
      prompt: "hello",
      iterations: 1,
      warmup: 0,
      concurrency: 1,
      pathMode: "gateway",
      gatewayPreflight: validBenchmarkGatewayPreflight(),
      createdBy: "schema test",
      objective: "route_benchmark",
      taskPlanCommandName: "bench"
    }
  };
}

function validBenchmarkRunsRunSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-runs-run-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        ok: true,
        benchmarkRunId: "benchmark-schema",
        run: validBenchmarkRun(),
        summary: validBenchmarkSummary(),
        samples: [validBenchmarkSample()],
        sampleViews: [
          {
            id: "sample-schema",
            path: "gateway"
          }
        ],
        report: validBenchmarkReport()
      }
    },
    warnings: []
  };
}

function validExternalOptimizeCommandCommon(): Record<string, unknown> {
  return {
    idempotencyKey: "external-optimize-idempotency-schema",
    dryRun: true,
    reload: false,
    verify: false,
    createdBy: "schema test",
    sourceSurface: "cli",
    actorKind: "operator",
    actorId: null,
    sessionId: null,
    metadata: {
      phase: "schema"
    },
    catalog: {
      kind: "narrowed_command_context",
      catalogRevision: "catalog-revision-schema",
      targetRoute: {
        name: "route-schema",
        service_provider: "provider-before",
        provider_model_id: "provider-model-before",
        cost: null
      },
      winningRoute: {
        name: "route-winner-schema",
        service_provider: "provider-after",
        provider_model_id: "provider-model-after",
        cost: null
      },
      providerAuth: {
        provider_after: {
          auth_source: "env var",
          api_key_env: "SWITCHMAXXER_PROVIDER_AFTER_API_KEY"
        }
      }
    },
    completion: {
      reload: null,
      verification: null,
      warnings: [],
      includePostActionResult: false
    }
  };
}

function validExternalOptimizeApplyCommand(): Record<string, unknown> {
  return {
    ...validExternalOptimizeCommandCommon(),
    runId: "optimization-schema",
    targetRouteId: "route-schema"
  };
}

function validExternalOptimizeRestoreByActionCommand(): Record<string, unknown> {
  return {
    ...validExternalOptimizeCommandCommon(),
    actionId: "action-schema",
    catalog: {
      ...(validExternalOptimizeCommandCommon()["catalog"] as Record<string, unknown>),
      restorePoint: {
        action_id: "action-schema",
        target_route: "route-schema",
        from_provider: "provider-before",
        to_provider: "provider-after"
      }
    }
  };
}

function validExternalOptimizeRestoreByRunRouteCommand(): Record<string, unknown> {
  return {
    ...validExternalOptimizeCommandCommon(),
    runId: "optimization-schema",
    targetRouteId: "route-schema",
    catalog: {
      ...(validExternalOptimizeCommandCommon()["catalog"] as Record<string, unknown>),
      restorePoint: {
        run_id: "optimization-schema",
        target_route: "route-schema",
        from_provider: "provider-before",
        to_provider: "provider-after"
      }
    }
  };
}

function validExternalOptimizeApplyCommandWithCatalogSnapshot(): Record<string, unknown> {
  return {
    ...validExternalOptimizeApplyCommand(),
    catalog: {
      kind: "catalog_snapshot",
      catalogRevision: "catalog-revision-schema",
      document: {
        catalog_version: 1,
        service_providers: {},
        routes: {},
        models: {}
      }
    },
    completion: {
      warnings: ["reload skipped for dry-run"]
    }
  };
}

function validBenchmarkHistoryListRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-list-request",
    operation: "benchmarkHistory.list",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      limit: 5
    }
  };
}

function validBenchmarkHistoryListSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-list-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      runs: [
        {
          run: validBenchmarkRun(),
          summary: validBenchmarkSummary()
        }
      ]
    },
    warnings: []
  };
}

function validBenchmarkHistoryShowRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-show-request",
    operation: "benchmarkHistory.show",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      runId: "benchmark-schema"
    }
  };
}

function validBenchmarkHistoryShowSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-show-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: validBenchmarkRun(),
      summary: validBenchmarkSummary(),
      samples: [validBenchmarkSample()]
    },
    warnings: []
  };
}

function validBenchmarkHistoryDeleteCounts(): Record<string, unknown> {
  return {
    benchmark_runs_deleted: 1,
    benchmark_samples_deleted: 2,
    total_deleted: 3
  };
}

function validBenchmarkHistoryPruneOlderThanRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-prune-request",
    operation: "benchmarkHistory.pruneOlderThan",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }
  };
}

function validBenchmarkHistoryPruneOlderThanSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-prune-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validBenchmarkHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validBenchmarkHistoryDeleteRunRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-delete-run-request",
    operation: "benchmarkHistory.deleteRun",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      runId: "benchmark-schema"
    }
  };
}

function validBenchmarkHistoryDeleteRunSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-delete-run-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validBenchmarkHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validBenchmarkHistoryClearRequest(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-clear-request",
    operation: "benchmarkHistory.clear",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {}
  };
}

function validBenchmarkHistoryClearSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-benchmark-history-clear-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validBenchmarkHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validOptimizationRun(): Record<string, unknown> {
  return {
    id: "optimization-schema",
    created_at: "2026-05-13T00:00:00.000Z",
    finished_at: "2026-05-13T00:00:01.000Z",
    created_by: "schema test",
    target_model: "model-schema",
    objective: "cost",
    status: "completed",
    winner_route: "route-schema",
    benchmark_run_id: "benchmark-schema",
    settings_json: "{\"objective\":\"cost\"}",
    candidate_snapshot_json: "[]",
    result_json: "{\"winner\":\"route-schema\"}",
    warnings_json: "[]"
  };
}

function validOptimizationHistoryListRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-list-request",
    operation: "optimizationHistory.list",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      limit: 5
    }
  };
}

function validOptimizationHistoryListSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-list-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      runs: [validOptimizationRun()]
    },
    warnings: []
  };
}

function validOptimizationHistoryShowRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-show-request",
    operation: "optimizationHistory.show",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      runId: "optimization-schema"
    }
  };
}

function validOptimizationHistoryShowSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-show-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: validOptimizationRun()
    },
    warnings: []
  };
}

function validOptimizationHistoryDeleteCounts(): Record<string, unknown> {
  return {
    optimization_runs_deleted: 1,
    config_mutation_events_deleted: 2,
    config_snapshots_deleted: 3,
    total_deleted: 6
  };
}

function validOptimizationHistoryPruneOlderThanRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-prune-request",
    operation: "optimizationHistory.pruneOlderThan",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }
  };
}

function validOptimizationHistoryPruneOlderThanSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-prune-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validOptimizationHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validOptimizationHistoryDeleteRunRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-delete-run-request",
    operation: "optimizationHistory.deleteRun",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      runId: "optimization-schema"
    }
  };
}

function validOptimizationHistoryDeleteRunSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-delete-run-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validOptimizationHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validOptimizationHistoryClearRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-clear-request",
    operation: "optimizationHistory.clear",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {}
  };
}

function validOptimizationHistoryClearSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-history-clear-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: validOptimizationHistoryDeleteCounts()
    },
    warnings: []
  };
}

function validOptimizeReferenceTokens(): Record<string, unknown> {
  return {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_write_tokens: 0
  };
}

function validOptimizeCostConfig(): Record<string, unknown> {
  return {
    input: 1,
    output: 2,
    cache_read: 0.1,
    cache_write: 0.2
  };
}

function validOptimizeCandidateRoute(): Record<string, unknown> {
  return {
    name: "route-schema",
    model: "model-schema",
    service_provider: "provider-schema",
    provider_model_id: "provider-model-schema",
    display_name: "Route Schema",
    api_mode: "openai-completions",
    cost: validOptimizeCostConfig(),
    model_cost: null,
    effective_cost: validOptimizeCostConfig(),
    timeout_ms: null,
    effective_timeout_ms: 5000
  };
}

function validOptimizeReport(objective: "cost" | "latency"): Record<string, unknown> {
  return {
    store_path: "/tmp/schema-observability.sqlite",
    run: {
      run_id: "optimization-schema",
      persisted: true,
      created_at: "2026-05-13T00:00:00.000Z",
      finished_at: "2026-05-13T00:00:01.000Z",
      created_by: "schema test",
      status: "completed",
      target_model: "model-schema",
      objective
    },
    candidates: {
      requested_routes: ["route-schema"],
      resolved_routes: ["route-schema"],
      disqualified: [
        {
          route_id: "route-disqualified-schema",
          reason: "missing_cost",
          message: "missing cost"
        }
      ]
    },
    reference_tokens: validOptimizeReferenceTokens(),
    bench: null,
    ranking: [
      {
        route_id: "route-schema",
        score: objective === "cost" ? 0.001 : 42
      }
    ],
    winner: {
      route_id: "route-schema",
      score: objective === "cost" ? 0.001 : 42,
      score_unit: objective === "cost" ? "usd" : "ms",
      tied_with: []
    },
    warnings: [
      {
        code: "schema_warning",
        message: "schema warning"
      }
    ]
  };
}

function validOptimizationReportsPersistCostRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-report-persist-cost-request",
    operation: "optimizationReports.persistCost",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      report: validOptimizeReport("cost"),
      candidateRoutes: [validOptimizeCandidateRoute()],
      requestedRoutes: ["route-schema"],
      referenceTokens: validOptimizeReferenceTokens(),
      createdBy: "schema test",
      runId: "optimization-schema"
    }
  };
}

function validOptimizationReportsPersistCostSuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-report-persist-cost-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      report: validOptimizeReport("cost")
    },
    warnings: []
  };
}

function validOptimizationReportsPersistLatencyRequest(): Record<string, unknown> {
  return {
    id: "schema-optimization-report-persist-latency-request",
    operation: "optimizationReports.persistLatency",
    contract_version: "observability-module-v1",
    store: {
      dbPath: "/tmp/schema-observability.sqlite"
    },
    payload: {
      report: validOptimizeReport("latency"),
      candidateRoutes: [validOptimizeCandidateRoute()],
      requestedRoutes: ["route-schema"],
      createdBy: "schema test",
      benchmarkRunId: "benchmark-schema",
      settings: {
        path_mode: "direct",
        iterations: 1
      },
      runId: "optimization-schema"
    }
  };
}

function validOptimizationReportsPersistLatencySuccessResponse(): Record<string, unknown> {
  return {
    id: "schema-optimization-report-persist-latency-response",
    ok: true,
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      report: validOptimizeReport("latency")
    },
    warnings: []
  };
}

void test("observability IPC generated schema validates trace.list request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validTraceListRequest()), true);
  assert.equal(validate(validTraceListSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed trace.list frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validTraceListRequest(),
    payload: {
      filters: {
        limit: 0
      }
    }
  };
  const invalidResponse = {
    ...validTraceListSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      traces: [
        {
          id: "execution-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates ledger.list request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validLedgerListRequest()), true);
  assert.equal(validate(validLedgerListSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed ledger.list frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validLedgerListRequest(),
    payload: {
      filters: {
        limit: 0
      }
    }
  };
  const invalidResponse = {
    ...validLedgerListSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      events: [
        {
          id: "ledger-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates ledger.show request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validLedgerShowRequest()), true);
  assert.equal(validate(validLedgerShowSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed ledger.show frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validLedgerShowRequest(),
    payload: {
      ledgerEventId: ""
    }
  };
  const invalidResponse = {
    ...validLedgerShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      event: {
        id: "ledger-schema"
      }
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates retention.pruneOlderThan request and success frames", () => {
  const validate = compileSchema();
  const missingStoreResponse = {
    ...validRetentionPruneOlderThanSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: false,
      result: null
    }
  };

  assert.equal(validate(validRetentionPruneOlderThanRequest()), true);
  assert.equal(validate(validRetentionPruneOlderThanSuccessResponse()), true);
  assert.equal(validate(missingStoreResponse), true);
});

void test("observability IPC generated schema rejects malformed retention.pruneOlderThan frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validRetentionPruneOlderThanRequest(),
    payload: {
      cutoffIso: ""
    }
  };
  const invalidResponse = {
    ...validRetentionPruneOlderThanSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        status: "completed",
        cutoff_at: "2026-05-01T00:00:00.000Z",
        failure_stage: null,
        failure_message: null,
        observations_deleted: -1,
        request_executions_deleted: 1,
        benchmark_runs_deleted: 0,
        benchmark_samples_deleted: 0,
        cost_facts_deleted: 0,
        optimization_facts_deleted: 0,
        control_plane_action_events_deleted: 0,
        config_mutation_events_deleted: 0,
        config_snapshots_deleted: 0,
        total_deleted: 2
      }
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates standalone external optimize mutation commands", () => {
  const validate = compileSchema();

  assert.equal(validate(validExternalOptimizeApplyCommand()), true);
  assert.equal(validate(validExternalOptimizeApplyCommandWithCatalogSnapshot()), true);
  assert.equal(validate(validExternalOptimizeRestoreByActionCommand()), true);
  assert.equal(validate(validExternalOptimizeRestoreByRunRouteCommand()), true);
});

void test("observability IPC generated schema rejects malformed standalone external optimize mutation commands", () => {
  const validate = compileSchema();
  const invalidApplyWithLocalCallback = {
    ...validExternalOptimizeApplyCommand(),
    loadReadModel: "local-only"
  };
  const invalidApplyWithoutIdempotencyKey = {
    ...validExternalOptimizeApplyCommand(),
    idempotencyKey: ""
  };
  const invalidApplyWithoutCatalogDocument = {
    ...validExternalOptimizeApplyCommandWithCatalogSnapshot(),
    catalog: {
      kind: "catalog_snapshot"
    }
  };
  const invalidApplyWithoutTargetRoute = {
    ...validExternalOptimizeApplyCommand(),
    catalog: {
      kind: "narrowed_command_context"
    }
  };
  const invalidApplyWithMalformedCompletion = {
    ...validExternalOptimizeApplyCommand(),
    completion: {
      warnings: ["ok", 1]
    }
  };
  const invalidMixedRestoreSelector = {
    ...validExternalOptimizeRestoreByActionCommand(),
    runId: "optimization-schema",
    targetRouteId: "route-schema"
  };
  const invalidRestoreRunRouteSelector = {
    ...validExternalOptimizeRestoreByRunRouteCommand(),
    targetRouteId: ""
  };

  assert.equal(validate(invalidApplyWithLocalCallback), false);
  assert.equal(validate(invalidApplyWithoutIdempotencyKey), false);
  assert.equal(validate(invalidApplyWithoutCatalogDocument), false);
  assert.equal(validate(invalidApplyWithoutTargetRoute), false);
  assert.equal(validate(invalidApplyWithMalformedCompletion), false);
  assert.equal(validate(invalidMixedRestoreSelector), false);
  assert.equal(validate(invalidRestoreRunRouteSelector), false);
});

void test("observability IPC generated schema validates benchmarkRuns.run request and success frames", () => {
  const validate = compileSchema();
  const failedRunResponse = {
    ...validBenchmarkRunsRunSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        ok: false,
        failure: {
          kind: "preflight",
          code: "gateway_unavailable",
          message: "gateway unavailable",
          details: {
            status: 503
          }
        }
      }
    }
  };
  const missingStoreResponse = {
    ...validBenchmarkRunsRunSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: false,
      result: null
    }
  };

  assert.equal(validate(validBenchmarkRunsRunRequest()), true);
  assert.equal(validate(validBenchmarkRunsRunSuccessResponse()), true);
  assert.equal(validate(failedRunResponse), true);
  assert.equal(validate(missingStoreResponse), true);
});

void test("observability IPC generated schema rejects malformed benchmarkRuns.run frames", () => {
  const validate = compileSchema();

  const invalidLocalOnlyRequest = {
    ...validBenchmarkRunsRunRequest(),
    payload: {
      ...(validBenchmarkRunsRunRequest()["payload"] as Record<string, unknown>),
      preflightGateway: "local-only"
    }
  };
  const invalidPreflightRequest = {
    ...validBenchmarkRunsRunRequest(),
    payload: {
      ...(validBenchmarkRunsRunRequest()["payload"] as Record<string, unknown>),
      gatewayPreflight: {
        ...validBenchmarkGatewayPreflight(),
        port: 0
      }
    }
  };
  const invalidResponse = {
    ...validBenchmarkRunsRunSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        ok: true,
        benchmarkRunId: "benchmark-schema",
        run: validBenchmarkRun(),
        summary: validBenchmarkSummary(),
        samples: [
          {
            id: "sample-schema"
          }
        ],
        sampleViews: [],
        report: validBenchmarkReport()
      }
    }
  };

  assert.equal(validate(invalidLocalOnlyRequest), false);
  assert.equal(validate(invalidPreflightRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates benchmarkHistory.list request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validBenchmarkHistoryListRequest()), true);
  assert.equal(validate(validBenchmarkHistoryListSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed benchmarkHistory.list frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validBenchmarkHistoryListRequest(),
    payload: {
      limit: 0
    }
  };
  const invalidResponse = {
    ...validBenchmarkHistoryListSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      runs: [
        {
          run: {
            id: "benchmark-schema"
          },
          summary: validBenchmarkSummary()
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates benchmarkHistory.show request and success frames", () => {
  const validate = compileSchema();
  const missingRunResponse = {
    ...validBenchmarkHistoryShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: null,
      summary: null,
      samples: []
    }
  };

  assert.equal(validate(validBenchmarkHistoryShowRequest()), true);
  assert.equal(validate(validBenchmarkHistoryShowSuccessResponse()), true);
  assert.equal(validate(missingRunResponse), true);
});

void test("observability IPC generated schema rejects malformed benchmarkHistory.show frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validBenchmarkHistoryShowRequest(),
    payload: {
      runId: ""
    }
  };
  const invalidResponse = {
    ...validBenchmarkHistoryShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: validBenchmarkRun(),
      summary: validBenchmarkSummary(),
      samples: [
        {
          id: "sample-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates benchmarkHistory cleanup request and success frames", () => {
  const validate = compileSchema();
  const missingStoreResponse = {
    ...validBenchmarkHistoryPruneOlderThanSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: false,
      result: null
    }
  };

  assert.equal(validate(validBenchmarkHistoryPruneOlderThanRequest()), true);
  assert.equal(validate(validBenchmarkHistoryPruneOlderThanSuccessResponse()), true);
  assert.equal(validate(validBenchmarkHistoryDeleteRunRequest()), true);
  assert.equal(validate(validBenchmarkHistoryDeleteRunSuccessResponse()), true);
  assert.equal(validate(validBenchmarkHistoryClearRequest()), true);
  assert.equal(validate(validBenchmarkHistoryClearSuccessResponse()), true);
  assert.equal(validate(missingStoreResponse), true);
});

void test("observability IPC generated schema rejects malformed benchmarkHistory cleanup frames", () => {
  const validate = compileSchema();

  const invalidPruneRequest = {
    ...validBenchmarkHistoryPruneOlderThanRequest(),
    payload: {
      cutoffIso: ""
    }
  };
  const invalidDeleteRunRequest = {
    ...validBenchmarkHistoryDeleteRunRequest(),
    payload: {
      runId: ""
    }
  };
  const invalidClearRequest = {
    ...validBenchmarkHistoryClearRequest(),
    payload: {
      unexpected: true
    }
  };
  const invalidResponse = {
    ...validBenchmarkHistoryClearSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        benchmark_runs_deleted: -1,
        benchmark_samples_deleted: 2,
        total_deleted: 3
      }
    }
  };

  assert.equal(validate(invalidPruneRequest), false);
  assert.equal(validate(invalidDeleteRunRequest), false);
  assert.equal(validate(invalidClearRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates optimizationHistory.list request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validOptimizationHistoryListRequest()), true);
  assert.equal(validate(validOptimizationHistoryListSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed optimizationHistory.list frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validOptimizationHistoryListRequest(),
    payload: {
      limit: 0
    }
  };
  const invalidResponse = {
    ...validOptimizationHistoryListSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      runs: [
        {
          id: "optimization-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates optimizationHistory.show request and success frames", () => {
  const validate = compileSchema();
  const missingRunResponse = {
    ...validOptimizationHistoryShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: null
    }
  };

  assert.equal(validate(validOptimizationHistoryShowRequest()), true);
  assert.equal(validate(validOptimizationHistoryShowSuccessResponse()), true);
  assert.equal(validate(missingRunResponse), true);
});

void test("observability IPC generated schema rejects malformed optimizationHistory.show frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validOptimizationHistoryShowRequest(),
    payload: {
      runId: ""
    }
  };
  const invalidResponse = {
    ...validOptimizationHistoryShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      run: {
        id: "optimization-schema"
      }
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates optimizationHistory cleanup request and success frames", () => {
  const validate = compileSchema();
  const missingStoreResponse = {
    ...validOptimizationHistoryPruneOlderThanSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: false,
      result: null
    }
  };

  assert.equal(validate(validOptimizationHistoryPruneOlderThanRequest()), true);
  assert.equal(validate(validOptimizationHistoryPruneOlderThanSuccessResponse()), true);
  assert.equal(validate(validOptimizationHistoryDeleteRunRequest()), true);
  assert.equal(validate(validOptimizationHistoryDeleteRunSuccessResponse()), true);
  assert.equal(validate(validOptimizationHistoryClearRequest()), true);
  assert.equal(validate(validOptimizationHistoryClearSuccessResponse()), true);
  assert.equal(validate(missingStoreResponse), true);
});

void test("observability IPC generated schema rejects malformed optimizationHistory cleanup frames", () => {
  const validate = compileSchema();

  const invalidPruneRequest = {
    ...validOptimizationHistoryPruneOlderThanRequest(),
    payload: {
      cutoffIso: ""
    }
  };
  const invalidDeleteRunRequest = {
    ...validOptimizationHistoryDeleteRunRequest(),
    payload: {
      runId: ""
    }
  };
  const invalidClearRequest = {
    ...validOptimizationHistoryClearRequest(),
    payload: {
      unexpected: true
    }
  };
  const invalidResponse = {
    ...validOptimizationHistoryClearSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      result: {
        optimization_runs_deleted: -1,
        config_mutation_events_deleted: 2,
        config_snapshots_deleted: 3,
        total_deleted: 6
      }
    }
  };

  assert.equal(validate(invalidPruneRequest), false);
  assert.equal(validate(invalidDeleteRunRequest), false);
  assert.equal(validate(invalidClearRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates optimizationReports persist request and success frames", () => {
  const validate = compileSchema();
  const missingStoreResponse = {
    ...validOptimizationReportsPersistCostSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: false,
      report: null
    }
  };

  assert.equal(validate(validOptimizationReportsPersistCostRequest()), true);
  assert.equal(validate(validOptimizationReportsPersistCostSuccessResponse()), true);
  assert.equal(validate(validOptimizationReportsPersistLatencyRequest()), true);
  assert.equal(validate(validOptimizationReportsPersistLatencySuccessResponse()), true);
  assert.equal(validate(missingStoreResponse), true);
});

void test("observability IPC generated schema rejects malformed optimizationReports persist frames", () => {
  const validate = compileSchema();

  const invalidCostRequest = {
    ...validOptimizationReportsPersistCostRequest(),
    payload: {
      ...(validOptimizationReportsPersistCostRequest()["payload"] as Record<string, unknown>),
      report: validOptimizeReport("latency")
    }
  };
  const invalidLatencyRequest = {
    ...validOptimizationReportsPersistLatencyRequest(),
    payload: {
      ...(validOptimizationReportsPersistLatencyRequest()["payload"] as Record<string, unknown>),
      benchmarkRunId: ""
    }
  };
  const invalidResponse = {
    ...validOptimizationReportsPersistCostSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      report: {
        ...validOptimizeReport("cost"),
        winner: {
          route_id: "route-schema",
          score: 0.001,
          score_unit: "tokens",
          tied_with: []
        }
      }
    }
  };

  assert.equal(validate(invalidCostRequest), false);
  assert.equal(validate(invalidLatencyRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates trace.getStats request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validTraceGetStatsRequest()), true);
  assert.equal(validate(validTraceGetStatsSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed trace.getStats frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validTraceGetStatsRequest(),
    payload: {
      filters: {
        limit: 0
      }
    }
  };
  const invalidResponse = {
    ...validTraceGetStatsSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      stats: {
        total_count: -1,
        partial_output_count: 0,
        average_gateway_residency_ms: null,
        average_upstream_ttft_ms: null,
        average_upstream_duration_ms: null,
        outcome_counts: [],
        top_failing_routes: []
      }
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates trace.show request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validTraceShowRequest()), true);
  assert.equal(validate(validTraceShowSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed trace.show frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validTraceShowRequest(),
    payload: {
      traceId: ""
    }
  };
  const invalidResponse = {
    ...validTraceShowSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      requestExecution: null,
      observations: [],
      benchmarkSamples: [
        {
          id: "sample-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});

void test("observability IPC generated schema validates trace.listObservations request and success frames", () => {
  const validate = compileSchema();

  assert.equal(validate(validTraceListObservationsRequest()), true);
  assert.equal(validate(validTraceListObservationsSuccessResponse()), true);
});

void test("observability IPC generated schema rejects malformed trace.listObservations frames", () => {
  const validate = compileSchema();

  const invalidRequest = {
    ...validTraceListObservationsRequest(),
    payload: {
      filters: {
        limit: 0
      }
    }
  };
  const invalidResponse = {
    ...validTraceListObservationsSuccessResponse(),
    result: {
      dbPath: "/tmp/schema-observability.sqlite",
      storeFound: true,
      observations: [
        {
          id: "observation-schema"
        }
      ]
    }
  };

  assert.equal(validate(invalidRequest), false);
  assert.equal(validate(invalidResponse), false);
});
