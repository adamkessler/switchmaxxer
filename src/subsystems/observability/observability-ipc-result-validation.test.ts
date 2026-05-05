import assert from "node:assert/strict";

import {
  buildObservabilityIpcErrorResponse,
  buildObservabilityIpcSuccessResponse,
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_OPERATIONS,
  type ObservabilityIpcOperation,
  type ObservabilityIpcRequest
} from "./observability-ipc-contract";
import {
  OBSERVABILITY_IPC_RESULT_VALIDATED_OPERATIONS,
  validateObservabilityIpcOperationResponseResult
} from "./observability-ipc-result-validation";
import { test } from "./observability.test-support";

const DB_PATH = "/tmp/observability-ipc-result-validation.sqlite";

const TRACE_LIST_REQUEST: ObservabilityIpcRequest<"trace.list"> = {
  id: "ipc-result-validation-trace-list",
  operation: "trace.list",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const TRACE_LIST_OBSERVATIONS_REQUEST: ObservabilityIpcRequest<"trace.listObservations"> = {
  id: "ipc-result-validation-trace-list-observations",
  operation: "trace.listObservations",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const TRACE_GET_STATS_REQUEST: ObservabilityIpcRequest<"trace.getStats"> = {
  id: "ipc-result-validation-trace-get-stats",
  operation: "trace.getStats",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const TRACE_SHOW_REQUEST: ObservabilityIpcRequest<"trace.show"> = {
  id: "ipc-result-validation-trace-show",
  operation: "trace.show",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    traceId: "request-result-validation"
  }
};

const TRACE_VERIFY_REQUEST: ObservabilityIpcRequest<"trace.verify"> = {
  id: "ipc-result-validation-trace-verify",
  operation: "trace.verify",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    all: false,
    traceId: "request-result-validation"
  }
};

const TRACE_REPAIR_REQUEST: ObservabilityIpcRequest<"trace.repair"> = {
  id: "ipc-result-validation-trace-repair",
  operation: "trace.repair",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    all: false,
    traceId: "request-result-validation"
  }
};

const RETENTION_PRUNE_REQUEST: ObservabilityIpcRequest<"retention.pruneOlderThan"> = {
  id: "ipc-result-validation-retention-prune",
  operation: "retention.pruneOlderThan",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    cutoffIso: "2026-05-12T12:00:00.000Z"
  }
};

const CONTROL_PLANE_AUDIT_START_REQUEST: ObservabilityIpcRequest<"controlPlaneAudit.startConfigMutation"> = {
  id: "ipc-result-validation-control-plane-audit-start",
  operation: "controlPlaneAudit.startConfigMutation",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    sourceSurface: "cli",
    operation: "routes_update",
    targetKind: "route",
    targetId: "route-result-validation",
    createdBy: "switchmaxxer IPC result validation test",
    actorKind: "operator",
    sessionId: "session-result-validation",
    metadata: {}
  }
};

const CONTROL_PLANE_AUDIT_FINISH_REQUEST: ObservabilityIpcRequest<"controlPlaneAudit.finishConfigMutation"> = {
  id: "ipc-result-validation-control-plane-audit-finish",
  operation: "controlPlaneAudit.finishConfigMutation",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    actionId: "audit-result-validation",
    status: "succeeded",
    targetId: "route-result-validation",
    result: {},
    metadata: {}
  }
};

const BENCHMARK_RUN_REQUEST: ObservabilityIpcRequest<"benchmarkRuns.run"> = {
  id: "ipc-result-validation-benchmark-run",
  operation: "benchmarkRuns.run",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    config: {
      bindHost: "127.0.0.1",
      port: 8080,
      timeoutMs: 5000,
      routes: {}
    },
    routeNames: ["route-result-validation"],
    prompt: "hello",
    iterations: 1,
    warmup: 0,
    concurrency: 1,
    pathMode: "gateway",
    preflightGateway: async () => ({ ok: true }),
    createdBy: "switchmaxxer IPC result validation test",
    objective: "route_benchmark",
    taskPlanCommandName: "bench"
  } as never
};

const LEDGER_LIST_REQUEST: ObservabilityIpcRequest<"ledger.list"> = {
  id: "ipc-result-validation-ledger-list",
  operation: "ledger.list",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const LEDGER_SHOW_REQUEST: ObservabilityIpcRequest<"ledger.show"> = {
  id: "ipc-result-validation-ledger-show",
  operation: "ledger.show",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    ledgerEventId: "ledger-result-validation"
  }
};

const BENCHMARK_HISTORY_LIST_REQUEST: ObservabilityIpcRequest<"benchmarkHistory.list"> = {
  id: "ipc-result-validation-benchmark-history-list",
  operation: "benchmarkHistory.list",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    limit: 10
  }
};

const BENCHMARK_HISTORY_SHOW_REQUEST: ObservabilityIpcRequest<"benchmarkHistory.show"> = {
  id: "ipc-result-validation-benchmark-history-show",
  operation: "benchmarkHistory.show",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    runId: "bench-result-validation"
  }
};

const BENCHMARK_HISTORY_PRUNE_REQUEST: ObservabilityIpcRequest<"benchmarkHistory.pruneOlderThan"> = {
  id: "ipc-result-validation-benchmark-history-prune",
  operation: "benchmarkHistory.pruneOlderThan",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    cutoffIso: "2026-05-12T12:00:00.000Z"
  }
};

const BENCHMARK_HISTORY_DELETE_REQUEST: ObservabilityIpcRequest<"benchmarkHistory.deleteRun"> = {
  id: "ipc-result-validation-benchmark-history-delete",
  operation: "benchmarkHistory.deleteRun",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    runId: "bench-result-validation"
  }
};

const BENCHMARK_HISTORY_CLEAR_REQUEST: ObservabilityIpcRequest<"benchmarkHistory.clear"> = {
  id: "ipc-result-validation-benchmark-history-clear",
  operation: "benchmarkHistory.clear",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const OPTIMIZATION_HISTORY_LIST_REQUEST: ObservabilityIpcRequest<"optimizationHistory.list"> = {
  id: "ipc-result-validation-optimization-history-list",
  operation: "optimizationHistory.list",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    limit: 10
  }
};

const OPTIMIZATION_HISTORY_SHOW_REQUEST: ObservabilityIpcRequest<"optimizationHistory.show"> = {
  id: "ipc-result-validation-optimization-history-show",
  operation: "optimizationHistory.show",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    runId: "opt-result-validation"
  }
};

const OPTIMIZATION_HISTORY_PRUNE_REQUEST: ObservabilityIpcRequest<"optimizationHistory.pruneOlderThan"> = {
  id: "ipc-result-validation-optimization-history-prune",
  operation: "optimizationHistory.pruneOlderThan",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    cutoffIso: "2026-05-12T12:00:00.000Z"
  }
};

const OPTIMIZATION_HISTORY_DELETE_REQUEST: ObservabilityIpcRequest<"optimizationHistory.deleteRun"> = {
  id: "ipc-result-validation-optimization-history-delete",
  operation: "optimizationHistory.deleteRun",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    runId: "opt-result-validation"
  }
};

const OPTIMIZATION_HISTORY_CLEAR_REQUEST: ObservabilityIpcRequest<"optimizationHistory.clear"> = {
  id: "ipc-result-validation-optimization-history-clear",
  operation: "optimizationHistory.clear",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {}
};

const OPTIMIZATION_REPORT_PERSIST_COST_REQUEST: ObservabilityIpcRequest<"optimizationReports.persistCost"> = {
  id: "ipc-result-validation-optimization-report-persist-cost",
  operation: "optimizationReports.persistCost",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    report: {},
    candidateRoutes: [],
    requestedRoutes: null,
    referenceTokens: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0
    },
    createdBy: "switchmaxxer IPC result validation test"
  } as never
};

const OPTIMIZATION_REPORT_PERSIST_LATENCY_REQUEST: ObservabilityIpcRequest<"optimizationReports.persistLatency"> = {
  id: "ipc-result-validation-optimization-report-persist-latency",
  operation: "optimizationReports.persistLatency",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    report: {},
    candidateRoutes: [],
    requestedRoutes: null,
    createdBy: "switchmaxxer IPC result validation test",
    benchmarkRunId: "bench-result-validation",
    settings: {}
  } as never
};

const OPTIMIZE_MUTATION_APPLY_REQUEST: ObservabilityIpcRequest<"optimizeMutations.apply"> = {
  id: "ipc-result-validation-optimize-mutation-apply",
  operation: "optimizeMutations.apply",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    runId: "opt-result-validation",
    targetRouteId: "route-result-validation",
    dryRun: true,
    readModel: {},
    loadReadModel: () => ({}),
    mutateConfigDocument: () => undefined,
    getMutableConfigSection: () => ({}),
    sourceSurface: "cli",
    createdBy: "switchmaxxer IPC result validation test",
    actorKind: "operator"
  } as never
};

const OPTIMIZE_MUTATION_RESTORE_REQUEST: ObservabilityIpcRequest<"optimizeMutations.restore"> = {
  id: "ipc-result-validation-optimize-mutation-restore",
  operation: "optimizeMutations.restore",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: DB_PATH
  },
  payload: {
    selector: {
      mode: "run_route",
      runId: "opt-result-validation",
      routeId: "route-result-validation"
    },
    dryRun: true,
    readModel: {},
    loadReadModel: () => ({}),
    mutateConfigDocument: () => undefined,
    getMutableConfigSection: () => ({}),
    sourceSurface: "cli",
    createdBy: "switchmaxxer IPC result validation test",
    actorKind: "operator"
  } as never
};

const VALID_TRACE_STATS = {
  total_count: 3,
  partial_output_count: 1,
  average_gateway_residency_ms: 20,
  average_upstream_ttft_ms: null,
  average_upstream_duration_ms: 15,
  outcome_counts: [
    {
      outcome: "succeeded" as const,
      count: 2
    },
    {
      outcome: "failed" as const,
      count: 1
    }
  ],
  top_failing_routes: [
    {
      route: "route-result-validation",
      count: 1
    }
  ]
};

const VALID_REQUEST_EXECUTION = {
  id: "request-execution-result-validation",
  request_id: "request-result-validation",
  started_at: "2026-05-12T12:00:00.000Z",
  completed_at: "2026-05-12T12:00:01.000Z",
  request_received_at: "2026-05-12T12:00:00.000Z",
  route_resolved_at: "2026-05-12T12:00:00.100Z",
  upstream_request_started_at: "2026-05-12T12:00:00.200Z",
  upstream_response_started_at: "2026-05-12T12:00:00.500Z",
  upstream_response_completed_at: "2026-05-12T12:00:00.900Z",
  client_response_started_at: "2026-05-12T12:00:00.600Z",
  client_response_completed_at: "2026-05-12T12:00:01.000Z",
  route_id: "route-result-validation",
  route_name: "Route Result Validation",
  model_id: "model-result-validation",
  provider_id: "provider-result-validation",
  provider_model_id: "provider-model-result-validation",
  client_api_mode: "openai-completions",
  upstream_api_mode: "openai-completions",
  status_code: 200,
  outcome: "succeeded" as const,
  failure_stage: null,
  failure_reason: null,
  observation_count: 4,
  latency_ms: 100,
  ttft_ms: 30,
  duration_ms: 100,
  input_tokens: 4,
  output_tokens: 8,
  total_tokens: 12,
  estimated_cost_micros: 34,
  currency: "USD",
  switchmaxxer_pre_upstream_ms: 5,
  upstream_ttft_ms: 25,
  upstream_duration_ms: 80,
  switchmaxxer_post_upstream_ms: 10,
  client_write_ms: 5,
  gateway_residency_ms: 100,
  partial_output: 0
};

const VALID_OBSERVATION = {
  id: "observation-result-validation",
  observed_at: "2026-05-12T12:00:00.000Z",
  ingested_at: "2026-05-12T12:00:00.010Z",
  request_id: "request-result-validation",
  trace_id: "trace-result-validation",
  span_id: "span-result-validation",
  parent_span_id: null,
  surface: "gateway",
  kind: "measurement" as const,
  event: "request_received" as const,
  stage: "ingress" as const,
  severity: null,
  outcome: "started" as const,
  route_id: "route-result-validation",
  route_name: "Route Result Validation",
  model_id: "model-result-validation",
  provider_id: "provider-result-validation",
  provider_model_id: "provider-model-result-validation",
  client_api_mode: "openai-completions",
  upstream_api_mode: null,
  listener: "http",
  actor: "proxy-test-client",
  status_code: null,
  latency_ms: null,
  ttft_ms: null,
  duration_ms: null,
  request_bytes: 128,
  response_bytes: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  estimated_cost_micros: null,
  currency: null,
  billing_source: null,
  benchmark_run_id: null,
  benchmark_case_id: null,
  optimization_profile_id: null,
  tags_json: "[]",
  attributes_json: "{}",
  attributes_truncated: 0,
  message: "received request"
};

const VALID_TRACE_VERIFICATION_RESULT = {
  request_id: "request-result-validation",
  status: "drift" as const,
  observation_count: 4,
  mismatch_count: 1,
  mismatches: [
    {
      field: "latency_ms",
      expected: 100,
      actual: 110
    }
  ]
};

const VALID_TRACE_REPAIR_RESULT = {
  request_id: "request-result-validation",
  action: "updated" as const,
  observation_count: 4,
  verification: VALID_TRACE_VERIFICATION_RESULT
};

const VALID_LEDGER_EVENT = {
  id: "ledger-result-validation",
  created_at: "2026-05-12T12:00:00.000Z",
  finished_at: "2026-05-12T12:00:01.000Z",
  created_by: "switchmaxxer IPC result validation test",
  source_surface: "cli" as const,
  actor_kind: "operator" as const,
  actor_id: "operator-result-validation",
  session_id: "session-result-validation",
  operation: "routes_update" as const,
  status: "succeeded" as const,
  target_kind: "route" as const,
  target_id: "route-result-validation",
  optimization_run_id: null,
  mutation_event_id: "mutation-result-validation",
  correlation_ids_json: "{}",
  result_json: "{}",
  error_json: "{}",
  metadata_json: "{}"
};

const VALID_RETENTION_PRUNE_RESULT = {
  status: "completed" as const,
  cutoff_at: "2026-05-12T12:00:00.000Z",
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
};

const VALID_BENCHMARK_RUN = {
  id: "bench-result-validation",
  name: "Benchmark Result Validation",
  created_at: "2026-05-12T12:00:00.000Z",
  created_by: "switchmaxxer IPC result validation test",
  objective: "route_benchmark",
  notes: null,
  settings_json: "{}",
  status: "completed" as const
};

const VALID_BENCHMARK_SUMMARY = {
  total_samples: 2,
  measured_samples: 1,
  warmup_samples: 1,
  success_count: 1,
  failed_count: 0,
  average_latency_ms: 20,
  min_latency_ms: 20,
  max_latency_ms: 20,
  average_ttft_ms: null,
  average_duration_ms: null
};

const VALID_BENCHMARK_SAMPLE = {
  id: "sample-result-validation",
  benchmark_run_id: "bench-result-validation",
  request_execution_id: "request-result-validation",
  route_id: "route-result-validation",
  provider_id: "provider-result-validation",
  provider_model_id: "model-result-validation",
  sample_index: 0,
  started_at: "2026-05-12T12:00:01.000Z",
  completed_at: "2026-05-12T12:00:02.000Z",
  status_code: 200,
  outcome: "succeeded" as const,
  latency_ms: 20,
  ttft_ms: null,
  duration_ms: 20,
  input_tokens: 4,
  output_tokens: 8,
  total_tokens: 12,
  estimated_cost_micros: 34,
  is_warmup: 0,
  score_value: null,
  score_scale: null,
  score_direction: null,
  score_source: null,
  score_method: null,
  scored_at: null,
  score_json: null
};

const VALID_BENCHMARK_SAMPLE_VIEW = {
  sample_id: "sample-result-validation",
  benchmark_run_id: "bench-result-validation",
  sample_index: 0,
  outcome: "succeeded",
  latency_ms: 20
};

const VALID_BENCHMARK_REPORT = {
  store_path: DB_PATH,
  run: {
    run_id: "bench-result-validation",
    name: "Benchmark Result Validation",
    created_at: "2026-05-12T12:00:00.000Z",
    created_by: "switchmaxxer IPC result validation test",
    objective: "route_benchmark",
    notes: null,
    status: "completed",
    settings: {},
    parse_warnings: [],
    summary: VALID_BENCHMARK_SUMMARY
  },
  execution: {
    requested_path_mode: "gateway",
    effective_paths: ["gateway"],
    skipped_paths: [],
    warnings: []
  },
  summary: VALID_BENCHMARK_SUMMARY,
  analysis: {
    by_path: []
  },
  samples: [VALID_BENCHMARK_SAMPLE_VIEW]
};

const VALID_BENCHMARK_RUNNER_RESULT = {
  ok: true as const,
  benchmarkRunId: "bench-result-validation",
  run: VALID_BENCHMARK_RUN,
  summary: VALID_BENCHMARK_SUMMARY,
  samples: [VALID_BENCHMARK_SAMPLE],
  sampleViews: [VALID_BENCHMARK_SAMPLE_VIEW],
  report: VALID_BENCHMARK_REPORT
};

const VALID_BENCHMARK_RUNNER_FAILURE = {
  ok: false as const,
  failure: {
    kind: "execution_plan",
    code: "benchmark_gateway_unavailable",
    message: "gateway unavailable",
    details: {
      route: "route-result-validation"
    }
  }
};

const VALID_BENCHMARK_DELETE_RESULT = {
  benchmark_runs_deleted: 1,
  benchmark_samples_deleted: 2,
  total_deleted: 3
};

const VALID_OPTIMIZATION_RUN = {
  id: "opt-result-validation",
  created_at: "2026-05-12T12:00:00.000Z",
  finished_at: "2026-05-12T12:01:00.000Z",
  created_by: "switchmaxxer IPC result validation test",
  target_model: "model-result-validation",
  objective: "cost",
  status: "completed" as const,
  winner_route: "route-result-validation",
  benchmark_run_id: null,
  settings_json: "{}",
  candidate_snapshot_json: "[]",
  result_json: "{}",
  warnings_json: "[]"
};

const VALID_OPTIMIZE_REPORT = {
  store_path: DB_PATH,
  run: {
    run_id: "opt-result-validation",
    persisted: true,
    created_at: "2026-05-12T12:00:00.000Z",
    finished_at: "2026-05-12T12:01:00.000Z",
    created_by: "switchmaxxer IPC result validation test",
    status: "completed" as const,
    target_model: "model-result-validation",
    objective: "cost" as const
  },
  candidates: {
    requested_routes: null,
    resolved_routes: ["route-result-validation"],
    disqualified: [
      {
        route_id: "route-disqualified",
        reason: "missing_cost",
        message: "missing cost"
      }
    ]
  },
  reference_tokens: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_write_tokens: 0
  },
  bench: null,
  ranking: [
    {
      route_id: "route-result-validation",
      score: 1.23
    }
  ],
  winner: {
    route_id: "route-result-validation",
    score: 1.23,
    score_unit: "usd" as const,
    tied_with: []
  },
  warnings: [
    {
      code: "cost_estimate",
      message: "cost estimate"
    }
  ]
};

const VALID_LATENCY_OPTIMIZE_REPORT = {
  ...VALID_OPTIMIZE_REPORT,
  run: {
    ...VALID_OPTIMIZE_REPORT.run,
    objective: "latency" as const
  },
  bench: {
    run_id: "bench-result-validation",
    summary: VALID_BENCHMARK_SUMMARY,
    execution: {
      requested_path_mode: "gateway",
      effective_paths: ["gateway"],
      skipped_paths: [],
      warnings: []
    }
  },
  winner: {
    ...VALID_OPTIMIZE_REPORT.winner,
    score_unit: "ms" as const
  }
};

const VALID_SERIALIZED_COST = {
  input: 0.000001,
  output: 0.000002,
  cache_read: 0,
  cache_write: 0
};

const VALID_OPTIMIZE_ROUTE_STATE = {
  route_id: "route-result-validation",
  service_provider: "provider-result-validation",
  provider_model_id: "provider-model-result-validation",
  cost: VALID_SERIALIZED_COST,
  api_mode: "openai-completions",
  provider_endpoint: null
};

const VALID_OPTIMIZE_MUTATION = {
  field: "service_provider",
  from: "provider-old",
  to: "provider-result-validation",
  service_provider: {
    changed: true,
    from: "provider-old",
    to: "provider-result-validation"
  },
  provider_model_id: {
    changed: true,
    from: "provider-model-old",
    to: "provider-model-result-validation"
  },
  cost: {
    changed: true,
    from: null,
    to: VALID_SERIALIZED_COST
  }
};

const VALID_OPTIMIZE_SNAPSHOT = {
  snapshot_id: "snapshot-result-validation",
  source_kind: "catalog",
  source_path: "/tmp/catalog.json",
  content_sha256: "abc123",
  content_bytes: 123,
  created_at: "2026-05-12T12:00:00.000Z",
  retention_expires_at: null
};

const VALID_OPTIMIZE_APPLY_VIEW = {
  run_id: "opt-result-validation",
  objective: "cost" as const,
  target_model: "model-result-validation",
  target_route: "route-result-validation",
  winner_route: "winner-route-result-validation",
  dry_run: false,
  changed: true,
  action_id: "mutation-result-validation",
  snapshot: VALID_OPTIMIZE_SNAPSHOT,
  reload: null,
  verification: null,
  warnings: ["reload skipped"],
  mutation: VALID_OPTIMIZE_MUTATION,
  before: {
    ...VALID_OPTIMIZE_ROUTE_STATE,
    service_provider: "provider-old",
    provider_model_id: "provider-model-old",
    cost: null
  },
  after: VALID_OPTIMIZE_ROUTE_STATE
};

const VALID_OPTIMIZE_RESTORE_POINT = {
  action_id: "apply-action-result-validation",
  operation: "optimize_apply",
  created_at: "2026-05-12T12:00:00.000Z",
  run_id: "opt-result-validation",
  target_route: "route-result-validation",
  source_kind: "catalog",
  source_path: "/tmp/catalog.json",
  snapshot: VALID_OPTIMIZE_SNAPSHOT,
  mutation: {
    field: "service_provider",
    from: "provider-old",
    to: "provider-result-validation"
  },
  original_provider_model_id: "provider-model-old",
  original_cost: null
};

const VALID_OPTIMIZE_RESTORE_VIEW = {
  run_id: "opt-result-validation",
  target_route: "route-result-validation",
  dry_run: false,
  changed: true,
  action_id: "restore-mutation-result-validation",
  restore_point: VALID_OPTIMIZE_RESTORE_POINT,
  snapshot: VALID_OPTIMIZE_SNAPSHOT,
  reload: null,
  verification: null,
  warnings: [],
  mutation: VALID_OPTIMIZE_MUTATION,
  before: VALID_OPTIMIZE_ROUTE_STATE,
  after: {
    ...VALID_OPTIMIZE_ROUTE_STATE,
    service_provider: "provider-old",
    provider_model_id: "provider-model-old",
    cost: null
  }
};

const VALID_OPTIMIZE_APPLY_MUTATION_RESULT = {
  ok: true as const,
  deferred: false,
  changed: true,
  actionId: "mutation-result-validation",
  ledgerActionId: "ledger-action-result-validation",
  view: VALID_OPTIMIZE_APPLY_VIEW
};

const VALID_OPTIMIZE_RESTORE_MUTATION_RESULT = {
  ok: true as const,
  deferred: false,
  changed: true,
  actionId: "restore-mutation-result-validation",
  ledgerActionId: "restore-ledger-action-result-validation",
  view: VALID_OPTIMIZE_RESTORE_VIEW
};

const VALID_OPTIMIZE_MUTATION_ERROR = {
  ok: false as const,
  code: "optimize_error",
  message: "optimization mutation failed",
  details: {
    route_id: "route-result-validation"
  }
};

const VALID_OPTIMIZATION_DELETE_RESULT = {
  optimization_runs_deleted: 1,
  config_mutation_events_deleted: 2,
  config_snapshots_deleted: 3,
  total_deleted: 6
};

const BENCHMARK_HISTORY_DELETE_REQUESTS = [
  BENCHMARK_HISTORY_PRUNE_REQUEST,
  BENCHMARK_HISTORY_DELETE_REQUEST,
  BENCHMARK_HISTORY_CLEAR_REQUEST
] as const;

const OPTIMIZATION_HISTORY_DELETE_REQUESTS = [
  OPTIMIZATION_HISTORY_PRUNE_REQUEST,
  OPTIMIZATION_HISTORY_DELETE_REQUEST,
  OPTIMIZATION_HISTORY_CLEAR_REQUEST
] as const;

function validateResultForRequest<T extends ObservabilityIpcOperation>(
  request: ObservabilityIpcRequest<T>,
  result: unknown
) {
  return validateObservabilityIpcOperationResponseResult(
    request.operation,
    buildObservabilityIpcSuccessResponse(request, result as never)
  );
}

void test("observability IPC result validation has explicit coverage for every operation", () => {
  assert.deepEqual(
    new Set(OBSERVABILITY_IPC_RESULT_VALIDATED_OPERATIONS),
    new Set(OBSERVABILITY_IPC_OPERATIONS)
  );
});

void test("observability IPC result validation accepts trace list results", () => {
  const emptyResult = validateResultForRequest(TRACE_LIST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    traces: []
  });
  const populatedResult = validateResultForRequest(TRACE_LIST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    traces: [VALID_REQUEST_EXECUTION]
  });

  assert.equal(emptyResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts trace observation list results", () => {
  const emptyResult = validateResultForRequest(TRACE_LIST_OBSERVATIONS_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    observations: []
  });
  const populatedResult = validateResultForRequest(TRACE_LIST_OBSERVATIONS_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    observations: [VALID_OBSERVATION]
  });

  assert.equal(emptyResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts trace stats results", () => {
  const emptyResult = validateResultForRequest(TRACE_GET_STATS_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    stats: {
      total_count: 0,
      partial_output_count: 0,
      average_gateway_residency_ms: null,
      average_upstream_ttft_ms: null,
      average_upstream_duration_ms: null,
      outcome_counts: [],
      top_failing_routes: []
    }
  });
  const populatedResult = validateResultForRequest(TRACE_GET_STATS_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    stats: VALID_TRACE_STATS
  });

  assert.equal(emptyResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts trace show results", () => {
  const missingResult = validateResultForRequest(TRACE_SHOW_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    requestExecution: null,
    observations: [],
    benchmarkSamples: []
  });
  const populatedResult = validateResultForRequest(TRACE_SHOW_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    requestExecution: VALID_REQUEST_EXECUTION,
    observations: [VALID_OBSERVATION],
    benchmarkSamples: [VALID_BENCHMARK_SAMPLE]
  });

  assert.equal(missingResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts trace maintenance results", () => {
  const emptyVerifyResult = validateResultForRequest(TRACE_VERIFY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    results: []
  });
  const populatedVerifyResult = validateResultForRequest(TRACE_VERIFY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    results: [VALID_TRACE_VERIFICATION_RESULT]
  });
  const emptyRepairResult = validateResultForRequest(TRACE_REPAIR_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    results: []
  });
  const populatedRepairResult = validateResultForRequest(TRACE_REPAIR_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    results: [VALID_TRACE_REPAIR_RESULT]
  });

  assert.equal(emptyVerifyResult, null);
  assert.equal(populatedVerifyResult, null);
  assert.equal(emptyRepairResult, null);
  assert.equal(populatedRepairResult, null);
});

void test("observability IPC result validation accepts retention prune results", () => {
  const missingStoreResult = validateResultForRequest(RETENTION_PRUNE_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    result: null
  });
  const completedResult = validateResultForRequest(RETENTION_PRUNE_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_RETENTION_PRUNE_RESULT
  });
  const partialResult = validateResultForRequest(RETENTION_PRUNE_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: {
      ...VALID_RETENTION_PRUNE_RESULT,
      status: "partial",
      failure_stage: "benchmark_runs",
      failure_message: "synthetic prune failure"
    }
  });

  assert.equal(missingStoreResult, null);
  assert.equal(completedResult, null);
  assert.equal(partialResult, null);
});

void test("observability IPC result validation accepts control-plane audit results", () => {
  const missingStartResult = validateResultForRequest(CONTROL_PLANE_AUDIT_START_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    actionId: null
  });
  const populatedStartResult = validateResultForRequest(CONTROL_PLANE_AUDIT_START_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    actionId: "audit-result-validation"
  });
  const finishResult = validateResultForRequest(CONTROL_PLANE_AUDIT_FINISH_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true
  });

  assert.equal(missingStartResult, null);
  assert.equal(populatedStartResult, null);
  assert.equal(finishResult, null);
});

void test("observability IPC result validation accepts ledger read results", () => {
  const emptyListResult = validateResultForRequest(LEDGER_LIST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    events: []
  });
  const populatedListResult = validateResultForRequest(LEDGER_LIST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    events: [VALID_LEDGER_EVENT]
  });
  const missingShowResult = validateResultForRequest(LEDGER_SHOW_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    event: null
  });
  const populatedShowResult = validateResultForRequest(LEDGER_SHOW_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    event: VALID_LEDGER_EVENT
  });

  assert.equal(emptyListResult, null);
  assert.equal(populatedListResult, null);
  assert.equal(missingShowResult, null);
  assert.equal(populatedShowResult, null);
});

void test("observability IPC result validation accepts benchmark run results", () => {
  const missingStoreResult = validateResultForRequest(BENCHMARK_RUN_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    result: null
  });
  const completedResult = validateResultForRequest(BENCHMARK_RUN_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_BENCHMARK_RUNNER_RESULT
  });
  const failureResult = validateResultForRequest(BENCHMARK_RUN_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_BENCHMARK_RUNNER_FAILURE
  });

  assert.equal(missingStoreResult, null);
  assert.equal(completedResult, null);
  assert.equal(failureResult, null);
});

void test("observability IPC result validation accepts benchmark history list results", () => {
  const emptyResult = validateObservabilityIpcOperationResponseResult(
    "benchmarkHistory.list",
    buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_LIST_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      runs: []
    })
  );
  const populatedResult = validateObservabilityIpcOperationResponseResult(
    "benchmarkHistory.list",
    buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_LIST_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      runs: [
        {
          run: VALID_BENCHMARK_RUN,
          summary: VALID_BENCHMARK_SUMMARY
        }
      ]
    })
  );

  assert.equal(emptyResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts benchmark history show results", () => {
  const missingRunResult = validateObservabilityIpcOperationResponseResult(
    "benchmarkHistory.show",
    buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_SHOW_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      run: null,
      summary: null,
      samples: []
    })
  );
  const populatedResult = validateObservabilityIpcOperationResponseResult(
    "benchmarkHistory.show",
    buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_SHOW_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      run: VALID_BENCHMARK_RUN,
      summary: VALID_BENCHMARK_SUMMARY,
      samples: [VALID_BENCHMARK_SAMPLE]
    })
  );

  assert.equal(missingRunResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts benchmark history maintenance results", () => {
  for (const request of BENCHMARK_HISTORY_DELETE_REQUESTS) {
    const missingStoreResult = validateResultForRequest(request, {
      dbPath: DB_PATH,
      storeFound: false,
      result: null
    });
    const populatedResult = validateResultForRequest(request, {
      dbPath: DB_PATH,
      storeFound: true,
      result: VALID_BENCHMARK_DELETE_RESULT
    });

    assert.equal(missingStoreResult, null, request.operation);
    assert.equal(populatedResult, null, request.operation);
  }
});

void test("observability IPC result validation accepts optimization history list results", () => {
  const emptyResult = validateObservabilityIpcOperationResponseResult(
    "optimizationHistory.list",
    buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_LIST_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      runs: []
    })
  );
  const populatedResult = validateObservabilityIpcOperationResponseResult(
    "optimizationHistory.list",
    buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_LIST_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      runs: [VALID_OPTIMIZATION_RUN]
    })
  );

  assert.equal(emptyResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts optimization history maintenance results", () => {
  for (const request of OPTIMIZATION_HISTORY_DELETE_REQUESTS) {
    const missingStoreResult = validateResultForRequest(request, {
      dbPath: DB_PATH,
      storeFound: false,
      result: null
    });
    const populatedResult = validateResultForRequest(request, {
      dbPath: DB_PATH,
      storeFound: true,
      result: VALID_OPTIMIZATION_DELETE_RESULT
    });

    assert.equal(missingStoreResult, null, request.operation);
    assert.equal(populatedResult, null, request.operation);
  }
});

void test("observability IPC result validation accepts optimization history show results", () => {
  const missingRunResult = validateObservabilityIpcOperationResponseResult(
    "optimizationHistory.show",
    buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_SHOW_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      run: null
    })
  );
  const populatedResult = validateObservabilityIpcOperationResponseResult(
    "optimizationHistory.show",
    buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_SHOW_REQUEST, {
      dbPath: DB_PATH,
      storeFound: true,
      run: VALID_OPTIMIZATION_RUN
    })
  );

  assert.equal(missingRunResult, null);
  assert.equal(populatedResult, null);
});

void test("observability IPC result validation accepts optimization report persist results", () => {
  const missingCostResult = validateResultForRequest(OPTIMIZATION_REPORT_PERSIST_COST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    report: null
  });
  const persistedCostResult = validateResultForRequest(OPTIMIZATION_REPORT_PERSIST_COST_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    report: VALID_OPTIMIZE_REPORT
  });
  const missingLatencyResult = validateResultForRequest(OPTIMIZATION_REPORT_PERSIST_LATENCY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    report: null
  });
  const persistedLatencyResult = validateResultForRequest(OPTIMIZATION_REPORT_PERSIST_LATENCY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    report: VALID_LATENCY_OPTIMIZE_REPORT
  });

  assert.equal(missingCostResult, null);
  assert.equal(persistedCostResult, null);
  assert.equal(missingLatencyResult, null);
  assert.equal(persistedLatencyResult, null);
});

void test("observability IPC result validation accepts optimize mutation results", () => {
  const missingApplyResult = validateResultForRequest(OPTIMIZE_MUTATION_APPLY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    result: null
  });
  const populatedApplyResult = validateResultForRequest(OPTIMIZE_MUTATION_APPLY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_OPTIMIZE_APPLY_MUTATION_RESULT
  });
  const errorApplyResult = validateResultForRequest(OPTIMIZE_MUTATION_APPLY_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_OPTIMIZE_MUTATION_ERROR
  });
  const missingRestoreResult = validateResultForRequest(OPTIMIZE_MUTATION_RESTORE_REQUEST, {
    dbPath: DB_PATH,
    storeFound: false,
    result: null
  });
  const populatedRestoreResult = validateResultForRequest(OPTIMIZE_MUTATION_RESTORE_REQUEST, {
    dbPath: DB_PATH,
    storeFound: true,
    result: VALID_OPTIMIZE_RESTORE_MUTATION_RESULT
  });

  assert.equal(missingApplyResult, null);
  assert.equal(populatedApplyResult, null);
  assert.equal(errorApplyResult, null);
  assert.equal(missingRestoreResult, null);
  assert.equal(populatedRestoreResult, null);
});

void test("observability IPC result validation skips error responses", () => {
  const errorResult = validateObservabilityIpcOperationResponseResult(
    "benchmarkHistory.list",
    buildObservabilityIpcErrorResponse({
      id: BENCHMARK_HISTORY_LIST_REQUEST.id,
      code: "observability_protocol_mismatch",
      message: "synthetic protocol mismatch"
    })
  );

  assert.equal(errorResult, null);
});

void test("observability IPC result validation rejects malformed trace list results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        traces: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid traces collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: "not-traces"
      },
      field: "result.traces"
    },
    {
      name: "invalid trace object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: ["not-a-trace"]
      },
      field: "result.traces[0]"
    },
    {
      name: "invalid request id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: [
          {
            ...VALID_REQUEST_EXECUTION,
            request_id: ""
          }
        ]
      },
      field: "result.traces[0].request_id"
    },
    {
      name: "invalid nullable route id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: [
          {
            ...VALID_REQUEST_EXECUTION,
            route_id: ""
          }
        ]
      },
      field: "result.traces[0].route_id"
    },
    {
      name: "invalid observation count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: [
          {
            ...VALID_REQUEST_EXECUTION,
            observation_count: -1
          }
        ]
      },
      field: "result.traces[0].observation_count"
    },
    {
      name: "invalid nullable latency",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: [
          {
            ...VALID_REQUEST_EXECUTION,
            latency_ms: 1.5
          }
        ]
      },
      field: "result.traces[0].latency_ms"
    },
    {
      name: "invalid partial output",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        traces: [
          {
            ...VALID_REQUEST_EXECUTION,
            partial_output: 2
          }
        ]
      },
      field: "result.traces[0].partial_output"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(TRACE_LIST_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed trace observation list results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        observations: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid observations collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        observations: "not-observations"
      },
      field: "result.observations"
    },
    {
      name: "invalid observation object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        observations: ["not-observation"]
      },
      field: "result.observations[0]"
    },
    {
      name: "invalid observation kind",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        observations: [
          {
            ...VALID_OBSERVATION,
            kind: ""
          }
        ]
      },
      field: "result.observations[0].kind"
    },
    {
      name: "invalid observation numeric field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        observations: [
          {
            ...VALID_OBSERVATION,
            response_bytes: 1.5
          }
        ]
      },
      field: "result.observations[0].response_bytes"
    },
    {
      name: "invalid observation truncation flag",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        observations: [
          {
            ...VALID_OBSERVATION,
            attributes_truncated: -1
          }
        ]
      },
      field: "result.observations[0].attributes_truncated"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(TRACE_LIST_OBSERVATIONS_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed trace stats results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        stats: VALID_TRACE_STATS
      },
      field: "result.dbPath"
    },
    {
      name: "invalid stats object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: "not-stats"
      },
      field: "result.stats"
    },
    {
      name: "invalid total count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: {
          ...VALID_TRACE_STATS,
          total_count: -1
        }
      },
      field: "result.stats.total_count"
    },
    {
      name: "invalid average",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: {
          ...VALID_TRACE_STATS,
          average_upstream_duration_ms: "slow"
        }
      },
      field: "result.stats.average_upstream_duration_ms"
    },
    {
      name: "invalid outcome count collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: {
          ...VALID_TRACE_STATS,
          outcome_counts: "not-counts"
        }
      },
      field: "result.stats.outcome_counts"
    },
    {
      name: "invalid outcome value",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: {
          ...VALID_TRACE_STATS,
          outcome_counts: [
            {
              outcome: "",
              count: 1
            }
          ]
        }
      },
      field: "result.stats.outcome_counts[0].outcome"
    },
    {
      name: "invalid failing route count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        stats: {
          ...VALID_TRACE_STATS,
          top_failing_routes: [
            {
              route: "route-result-validation",
              count: 1.5
            }
          ]
        }
      },
      field: "result.stats.top_failing_routes[0].count"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(TRACE_GET_STATS_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed trace show results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid store found flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "true",
        requestExecution: null,
        observations: [],
        benchmarkSamples: []
      },
      field: "result.storeFound"
    },
    {
      name: "invalid request execution",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: {
          ...VALID_REQUEST_EXECUTION,
          partial_output: 2
        },
        observations: [],
        benchmarkSamples: []
      },
      field: "result.requestExecution.partial_output"
    },
    {
      name: "invalid observations collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: "not-observations",
        benchmarkSamples: []
      },
      field: "result.observations"
    },
    {
      name: "invalid observation event",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: [
          {
            ...VALID_OBSERVATION,
            event: ""
          }
        ],
        benchmarkSamples: []
      },
      field: "result.observations[0].event"
    },
    {
      name: "invalid observation nullable field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: [
          {
            ...VALID_OBSERVATION,
            route_id: ""
          }
        ],
        benchmarkSamples: []
      },
      field: "result.observations[0].route_id"
    },
    {
      name: "invalid observation numeric field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: [
          {
            ...VALID_OBSERVATION,
            request_bytes: -1
          }
        ],
        benchmarkSamples: []
      },
      field: "result.observations[0].request_bytes"
    },
    {
      name: "invalid benchmark samples collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: [],
        benchmarkSamples: "not-samples"
      },
      field: "result.benchmarkSamples"
    },
    {
      name: "invalid benchmark sample",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        requestExecution: null,
        observations: [],
        benchmarkSamples: [
          {
            ...VALID_BENCHMARK_SAMPLE,
            outcome: ""
          }
        ]
      },
      field: "result.benchmarkSamples[0].outcome"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(TRACE_SHOW_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed trace maintenance results", () => {
  const malformedVerifyResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid results collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: "not-results"
      },
      field: "result.results"
    },
    {
      name: "invalid verification request id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_VERIFICATION_RESULT,
            request_id: ""
          }
        ]
      },
      field: "result.results[0].request_id"
    },
    {
      name: "invalid mismatch count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_VERIFICATION_RESULT,
            mismatch_count: -1
          }
        ]
      },
      field: "result.results[0].mismatch_count"
    },
    {
      name: "invalid mismatch field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_VERIFICATION_RESULT,
            mismatches: [
              {
                field: "",
                expected: null,
                actual: 1
              }
            ]
          }
        ]
      },
      field: "result.results[0].mismatches[0].field"
    },
    {
      name: "invalid mismatch expected value",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_VERIFICATION_RESULT,
            mismatches: [
              {
                field: "latency_ms",
                expected: { nested: true },
                actual: 1
              }
            ]
          }
        ]
      },
      field: "result.results[0].mismatches[0].expected"
    }
  ];

  const malformedRepairResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid repair action",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_REPAIR_RESULT,
            action: ""
          }
        ]
      },
      field: "result.results[0].action"
    },
    {
      name: "invalid repair observation count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_REPAIR_RESULT,
            observation_count: 1.5
          }
        ]
      },
      field: "result.results[0].observation_count"
    },
    {
      name: "invalid nested verification",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        results: [
          {
            ...VALID_TRACE_REPAIR_RESULT,
            verification: {
              ...VALID_TRACE_VERIFICATION_RESULT,
              status: ""
            }
          }
        ]
      },
      field: "result.results[0].verification.status"
    }
  ];

  for (const { name, result, field } of malformedVerifyResults) {
    const validationResult = validateResultForRequest(TRACE_VERIFY_REQUEST, result);

    assert.notEqual(validationResult, null, `verify: ${name}`);
    assert.equal(validationResult?.field, field, `verify: ${name}`);
  }
  for (const { name, result, field } of malformedRepairResults) {
    const validationResult = validateResultForRequest(TRACE_REPAIR_REQUEST, result);

    assert.notEqual(validationResult, null, `repair: ${name}`);
    assert.equal(validationResult?.field, field, `repair: ${name}`);
  }
});

void test("observability IPC result validation rejects malformed retention prune results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        result: VALID_RETENTION_PRUNE_RESULT
      },
      field: "result.dbPath"
    },
    {
      name: "invalid result object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: "not-result"
      },
      field: "result.result"
    },
    {
      name: "invalid status",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_RETENTION_PRUNE_RESULT,
          status: ""
        }
      },
      field: "result.result.status"
    },
    {
      name: "invalid nullable failure stage",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_RETENTION_PRUNE_RESULT,
          failure_stage: ""
        }
      },
      field: "result.result.failure_stage"
    },
    {
      name: "invalid deleted count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_RETENTION_PRUNE_RESULT,
          observations_deleted: -1
        }
      },
      field: "result.result.observations_deleted"
    },
    {
      name: "invalid total count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_RETENTION_PRUNE_RESULT,
          total_deleted: 1.5
        }
      },
      field: "result.result.total_deleted"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(RETENTION_PRUNE_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed control-plane audit results", () => {
  const malformedStartResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid start db path",
      result: {
        dbPath: "",
        storeFound: true,
        actionId: "audit-result-validation"
      },
      field: "result.dbPath"
    },
    {
      name: "invalid start store flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "true",
        actionId: "audit-result-validation"
      },
      field: "result.storeFound"
    },
    {
      name: "invalid action id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        actionId: ""
      },
      field: "result.actionId"
    }
  ];
  const malformedFinishResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid finish db path",
      result: {
        dbPath: "",
        storeFound: true
      },
      field: "result.dbPath"
    },
    {
      name: "invalid finish store flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "true"
      },
      field: "result.storeFound"
    }
  ];

  for (const { name, result, field } of malformedStartResults) {
    const validationResult = validateResultForRequest(CONTROL_PLANE_AUDIT_START_REQUEST, result);

    assert.notEqual(validationResult, null, `start: ${name}`);
    assert.equal(validationResult?.field, field, `start: ${name}`);
  }
  for (const { name, result, field } of malformedFinishResults) {
    const validationResult = validateResultForRequest(CONTROL_PLANE_AUDIT_FINISH_REQUEST, result);

    assert.notEqual(validationResult, null, `finish: ${name}`);
    assert.equal(validationResult?.field, field, `finish: ${name}`);
  }
});

void test("observability IPC result validation rejects malformed ledger list results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        events: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid events collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        events: "not-events"
      },
      field: "result.events"
    },
    {
      name: "invalid event object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        events: ["not-event"]
      },
      field: "result.events[0]"
    },
    {
      name: "invalid event id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        events: [
          {
            ...VALID_LEDGER_EVENT,
            id: ""
          }
        ]
      },
      field: "result.events[0].id"
    },
    {
      name: "invalid nullable actor id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        events: [
          {
            ...VALID_LEDGER_EVENT,
            actor_id: ""
          }
        ]
      },
      field: "result.events[0].actor_id"
    },
    {
      name: "invalid json payload field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        events: [
          {
            ...VALID_LEDGER_EVENT,
            result_json: ""
          }
        ]
      },
      field: "result.events[0].result_json"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(LEDGER_LIST_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed ledger show results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid store flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "true",
        event: null
      },
      field: "result.storeFound"
    },
    {
      name: "invalid event object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        event: "not-event"
      },
      field: "result.event"
    },
    {
      name: "invalid event status",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        event: {
          ...VALID_LEDGER_EVENT,
          status: ""
        }
      },
      field: "result.event.status"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(LEDGER_SHOW_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed benchmark run results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        result: VALID_BENCHMARK_RUNNER_RESULT
      },
      field: "result.dbPath"
    },
    {
      name: "invalid result object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: "not-result"
      },
      field: "result.result"
    },
    {
      name: "invalid ok flag",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          ok: "true"
        }
      },
      field: "result.result.ok"
    },
    {
      name: "invalid benchmark run id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          benchmarkRunId: ""
        }
      },
      field: "result.result.benchmarkRunId"
    },
    {
      name: "invalid run record",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          run: {
            ...VALID_BENCHMARK_RUN,
            name: ""
          }
        }
      },
      field: "result.result.run.name"
    },
    {
      name: "invalid samples collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          samples: "not-samples"
        }
      },
      field: "result.result.samples"
    },
    {
      name: "invalid sample view",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          sampleViews: ["not-sample-view"]
        }
      },
      field: "result.result.sampleViews[0]"
    },
    {
      name: "invalid report object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          report: "not-report"
        }
      },
      field: "result.result.report"
    },
    {
      name: "invalid report analysis",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_RESULT,
          report: {
            ...VALID_BENCHMARK_REPORT,
            analysis: {
              by_path: "not-paths"
            }
          }
        }
      },
      field: "result.result.report.analysis.by_path"
    },
    {
      name: "invalid failure code",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_FAILURE,
          failure: {
            ...VALID_BENCHMARK_RUNNER_FAILURE.failure,
            code: ""
          }
        }
      },
      field: "result.result.failure.code"
    },
    {
      name: "invalid failure details",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_RUNNER_FAILURE,
          failure: {
            ...VALID_BENCHMARK_RUNNER_FAILURE.failure,
            details: "not-details"
          }
        }
      },
      field: "result.result.failure.details"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(BENCHMARK_RUN_REQUEST, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed optimization report persist results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly request: typeof OPTIMIZATION_REPORT_PERSIST_COST_REQUEST | typeof OPTIMIZATION_REPORT_PERSIST_LATENCY_REQUEST;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: "",
        storeFound: true,
        report: VALID_OPTIMIZE_REPORT
      },
      field: "result.dbPath"
    },
    {
      name: "invalid report object",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: "not-report"
      },
      field: "result.report"
    },
    {
      name: "invalid persisted flag",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          run: {
            ...VALID_OPTIMIZE_REPORT.run,
            persisted: "true"
          }
        }
      },
      field: "result.report.run.persisted"
    },
    {
      name: "invalid requested routes",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          candidates: {
            ...VALID_OPTIMIZE_REPORT.candidates,
            requested_routes: ["route-result-validation", ""]
          }
        }
      },
      field: "result.report.candidates.requested_routes[1]"
    },
    {
      name: "invalid reference token count",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          reference_tokens: {
            ...VALID_OPTIMIZE_REPORT.reference_tokens,
            input_tokens: -1
          }
        }
      },
      field: "result.report.reference_tokens.input_tokens"
    },
    {
      name: "invalid bench summary",
      request: OPTIMIZATION_REPORT_PERSIST_LATENCY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_LATENCY_OPTIMIZE_REPORT,
          bench: {
            ...VALID_LATENCY_OPTIMIZE_REPORT.bench,
            summary: {
              ...VALID_BENCHMARK_SUMMARY,
              total_samples: -1
            }
          }
        }
      },
      field: "result.report.bench.summary.total_samples"
    },
    {
      name: "invalid ranking collection",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          ranking: "not-ranking"
        }
      },
      field: "result.report.ranking"
    },
    {
      name: "invalid winner score",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          winner: {
            ...VALID_OPTIMIZE_REPORT.winner,
            score: Number.POSITIVE_INFINITY
          }
        }
      },
      field: "result.report.winner.score"
    },
    {
      name: "invalid warning",
      request: OPTIMIZATION_REPORT_PERSIST_COST_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        report: {
          ...VALID_OPTIMIZE_REPORT,
          warnings: [
            {
              code: "",
              message: "missing code"
            }
          ]
        }
      },
      field: "result.report.warnings[0].code"
    }
  ];

  for (const { name, request, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(request, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed optimize mutation results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly request: typeof OPTIMIZE_MUTATION_APPLY_REQUEST | typeof OPTIMIZE_MUTATION_RESTORE_REQUEST;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: "",
        storeFound: true,
        result: VALID_OPTIMIZE_APPLY_MUTATION_RESULT
      },
      field: "result.dbPath"
    },
    {
      name: "invalid result object",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: "not-result"
      },
      field: "result.result"
    },
    {
      name: "invalid ok flag",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          ok: "true"
        }
      },
      field: "result.result.ok"
    },
    {
      name: "external leaked complete function",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          deferred: true,
          complete: () => VALID_OPTIMIZE_APPLY_VIEW
        }
      },
      field: "result.result.complete"
    },
    {
      name: "invalid ledger action id",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          ledgerActionId: ""
        }
      },
      field: "result.result.ledgerActionId"
    },
    {
      name: "invalid apply view route",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          view: {
            ...VALID_OPTIMIZE_APPLY_VIEW,
            target_route: ""
          }
        }
      },
      field: "result.result.view.target_route"
    },
    {
      name: "invalid mutation provider change",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          view: {
            ...VALID_OPTIMIZE_APPLY_VIEW,
            mutation: {
              ...VALID_OPTIMIZE_MUTATION,
              service_provider: {
                ...VALID_OPTIMIZE_MUTATION.service_provider,
                changed: "true"
              }
            }
          }
        }
      },
      field: "result.result.view.mutation.service_provider.changed"
    },
    {
      name: "invalid route state cost",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_APPLY_MUTATION_RESULT,
          view: {
            ...VALID_OPTIMIZE_APPLY_VIEW,
            after: {
              ...VALID_OPTIMIZE_ROUTE_STATE,
              cost: {
                ...VALID_SERIALIZED_COST,
                input: -1
              }
            }
          }
        }
      },
      field: "result.result.view.after.cost.input"
    },
    {
      name: "invalid restore point action id",
      request: OPTIMIZE_MUTATION_RESTORE_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_RESTORE_MUTATION_RESULT,
          view: {
            ...VALID_OPTIMIZE_RESTORE_VIEW,
            restore_point: {
              ...VALID_OPTIMIZE_RESTORE_POINT,
              action_id: ""
            }
          }
        }
      },
      field: "result.result.view.restore_point.action_id"
    },
    {
      name: "invalid error code",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_MUTATION_ERROR,
          code: ""
        }
      },
      field: "result.result.code"
    },
    {
      name: "invalid error details",
      request: OPTIMIZE_MUTATION_APPLY_REQUEST,
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZE_MUTATION_ERROR,
          details: "not-details"
        }
      },
      field: "result.result.details"
    }
  ];

  for (const { name, request, result, field } of malformedResults) {
    const validationResult = validateResultForRequest(request, result);

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed optimization history list results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "missing db path",
      result: {
        dbPath: "",
        storeFound: true,
        runs: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid runs collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: "not-runs"
      },
      field: "result.runs"
    },
    {
      name: "invalid run id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            ...VALID_OPTIMIZATION_RUN,
            id: ""
          }
        ]
      },
      field: "result.runs[0].id"
    },
    {
      name: "invalid nullable finished timestamp",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            ...VALID_OPTIMIZATION_RUN,
            finished_at: ""
          }
        ]
      },
      field: "result.runs[0].finished_at"
    },
    {
      name: "invalid settings json field",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            ...VALID_OPTIMIZATION_RUN,
            settings_json: ""
          }
        ]
      },
      field: "result.runs[0].settings_json"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateObservabilityIpcOperationResponseResult(
      "optimizationHistory.list",
      buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_LIST_REQUEST, result as never)
    );

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed optimization history show results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid store found flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "yes",
        run: null
      },
      field: "result.storeFound"
    },
    {
      name: "invalid run payload",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: {
          ...VALID_OPTIMIZATION_RUN,
          winner_route: ""
        }
      },
      field: "result.run.winner_route"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateObservabilityIpcOperationResponseResult(
      "optimizationHistory.show",
      buildObservabilityIpcSuccessResponse(OPTIMIZATION_HISTORY_SHOW_REQUEST, result as never)
    );

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed optimization history maintenance results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        result: VALID_OPTIMIZATION_DELETE_RESULT
      },
      field: "result.dbPath"
    },
    {
      name: "invalid result object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: "not-counts"
      },
      field: "result.result"
    },
    {
      name: "invalid config snapshot count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_OPTIMIZATION_DELETE_RESULT,
          config_snapshots_deleted: -1
        }
      },
      field: "result.result.config_snapshots_deleted"
    }
  ];

  for (const request of OPTIMIZATION_HISTORY_DELETE_REQUESTS) {
    for (const { name, result, field } of malformedResults) {
      const validationResult = validateResultForRequest(request, result);

      assert.notEqual(validationResult, null, `${request.operation}: ${name}`);
      assert.equal(validationResult?.field, field, `${request.operation}: ${name}`);
    }
  }
});

void test("observability IPC result validation rejects malformed benchmark history list results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "missing db path",
      result: {
        dbPath: "",
        storeFound: true,
        runs: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid runs collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: "not-runs"
      },
      field: "result.runs"
    },
    {
      name: "invalid run id",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            run: {
              ...VALID_BENCHMARK_RUN,
              id: ""
            },
            summary: VALID_BENCHMARK_SUMMARY
          }
        ]
      },
      field: "result.runs[0].run.id"
    },
    {
      name: "invalid measured sample count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            run: VALID_BENCHMARK_RUN,
            summary: {
              ...VALID_BENCHMARK_SUMMARY,
              measured_samples: -1
            }
          }
        ]
      },
      field: "result.runs[0].summary.measured_samples"
    },
    {
      name: "invalid nullable timing",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        runs: [
          {
            run: VALID_BENCHMARK_RUN,
            summary: {
              ...VALID_BENCHMARK_SUMMARY,
              average_duration_ms: "slow"
            }
          }
        ]
      },
      field: "result.runs[0].summary.average_duration_ms"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateObservabilityIpcOperationResponseResult(
      "benchmarkHistory.list",
      buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_LIST_REQUEST, result as never)
    );

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});

void test("observability IPC result validation rejects malformed benchmark history maintenance results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid store found flag",
      result: {
        dbPath: DB_PATH,
        storeFound: "true",
        result: VALID_BENCHMARK_DELETE_RESULT
      },
      field: "result.storeFound"
    },
    {
      name: "invalid result object",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: "not-counts"
      },
      field: "result.result"
    },
    {
      name: "invalid benchmark sample count",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        result: {
          ...VALID_BENCHMARK_DELETE_RESULT,
          benchmark_samples_deleted: 1.5
        }
      },
      field: "result.result.benchmark_samples_deleted"
    }
  ];

  for (const request of BENCHMARK_HISTORY_DELETE_REQUESTS) {
    for (const { name, result, field } of malformedResults) {
      const validationResult = validateResultForRequest(request, result);

      assert.notEqual(validationResult, null, `${request.operation}: ${name}`);
      assert.equal(validationResult?.field, field, `${request.operation}: ${name}`);
    }
  }
});

void test("observability IPC result validation rejects malformed benchmark history show results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly result: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "invalid db path",
      result: {
        dbPath: "",
        storeFound: true,
        run: null,
        summary: null,
        samples: []
      },
      field: "result.dbPath"
    },
    {
      name: "invalid run payload",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: {
          ...VALID_BENCHMARK_RUN,
          status: ""
        },
        summary: VALID_BENCHMARK_SUMMARY,
        samples: []
      },
      field: "result.run.status"
    },
    {
      name: "invalid summary payload",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: VALID_BENCHMARK_RUN,
        summary: {
          ...VALID_BENCHMARK_SUMMARY,
          total_samples: -1
        },
        samples: []
      },
      field: "result.summary.total_samples"
    },
    {
      name: "invalid samples collection",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: VALID_BENCHMARK_RUN,
        summary: VALID_BENCHMARK_SUMMARY,
        samples: "not-samples"
      },
      field: "result.samples"
    },
    {
      name: "invalid sample route",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: VALID_BENCHMARK_RUN,
        summary: VALID_BENCHMARK_SUMMARY,
        samples: [
          {
            ...VALID_BENCHMARK_SAMPLE,
            route_id: ""
          }
        ]
      },
      field: "result.samples[0].route_id"
    },
    {
      name: "invalid sample latency",
      result: {
        dbPath: DB_PATH,
        storeFound: true,
        run: VALID_BENCHMARK_RUN,
        summary: VALID_BENCHMARK_SUMMARY,
        samples: [
          {
            ...VALID_BENCHMARK_SAMPLE,
            latency_ms: -1
          }
        ]
      },
      field: "result.samples[0].latency_ms"
    }
  ];

  for (const { name, result, field } of malformedResults) {
    const validationResult = validateObservabilityIpcOperationResponseResult(
      "benchmarkHistory.show",
      buildObservabilityIpcSuccessResponse(BENCHMARK_HISTORY_SHOW_REQUEST, result as never)
    );

    assert.notEqual(validationResult, null, name);
    assert.equal(validationResult?.field, field, name);
  }
});
