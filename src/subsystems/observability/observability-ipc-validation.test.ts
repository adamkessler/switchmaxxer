import assert from "node:assert/strict";

import {
  buildObservabilityIpcErrorResponse,
  buildObservabilityIpcSuccessResponse,
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityIpcRequest
} from "./observability-ipc-contract";
import {
  validateObservabilityExternalOptimizeApplyCommand,
  validateObservabilityExternalOptimizeRestoreCommand,
  validateObservabilityIpcRequest,
  validateObservabilityIpcResponse
} from "./observability-ipc-validation";
import { test } from "./observability.test-support";

const VALID_REQUEST: ObservabilityIpcRequest<"trace.list"> = {
  id: "ipc-validation-request",
  operation: "trace.list",
  contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
  store: {
    dbPath: "/tmp/observability-ipc-validation.sqlite"
  },
  payload: {
    filters: {
      limit: 5
    }
  }
};

const VALID_BENCHMARK_RUN_PAYLOAD = {
  config: {
    bindHost: "127.0.0.1",
    port: 8080,
    timeoutMs: 5000,
    routes: {}
  },
  routeNames: ["route-ipc-validation"],
  prompt: "hello",
  iterations: 1,
  warmup: 0,
  concurrency: 1,
  pathMode: "direct",
  preflightGateway: async () => ({ ok: true }),
  createdBy: "switchmaxxer IPC validation test",
  objective: "route_benchmark",
  taskPlanCommandName: "bench"
};

const VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD = {
  config: VALID_BENCHMARK_RUN_PAYLOAD.config,
  routeNames: VALID_BENCHMARK_RUN_PAYLOAD.routeNames,
  prompt: VALID_BENCHMARK_RUN_PAYLOAD.prompt,
  iterations: VALID_BENCHMARK_RUN_PAYLOAD.iterations,
  warmup: VALID_BENCHMARK_RUN_PAYLOAD.warmup,
  concurrency: VALID_BENCHMARK_RUN_PAYLOAD.concurrency,
  pathMode: VALID_BENCHMARK_RUN_PAYLOAD.pathMode,
  gatewayPreflight: {
    ok: true,
    sourceFile: "config.json",
    sourcePath: "/tmp/config.json",
    bindHost: "127.0.0.1",
    port: 8080,
    probeHost: "127.0.0.1",
    healthUrl: "http://127.0.0.1:8080/health",
    pid: null,
    latencyMs: 5
  },
  createdBy: VALID_BENCHMARK_RUN_PAYLOAD.createdBy,
  objective: VALID_BENCHMARK_RUN_PAYLOAD.objective,
  taskPlanCommandName: VALID_BENCHMARK_RUN_PAYLOAD.taskPlanCommandName
};

const VALID_OPTIMIZE_REFERENCE_TOKENS = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_tokens: 0,
  cache_write_tokens: 0
};

const VALID_OPTIMIZE_CANDIDATE_ROUTE = {
  name: "route-ipc-validation",
  model: "model-ipc-validation",
  service_provider: "provider-ipc-validation",
  provider_model_id: "provider-model-ipc-validation",
  display_name: "Route IPC Validation",
  api_mode: "openai-completions",
  cost: null,
  model_cost: null,
  effective_cost: null,
  timeout_ms: null,
  effective_timeout_ms: 5000
};

function makeOptimizeReport(objective: "cost" | "latency") {
  return {
    run: {
      run_id: null,
      persisted: false,
      created_at: null,
      finished_at: null,
      created_by: null,
      status: "completed",
      target_model: "model-ipc-validation",
      objective
    },
    candidates: {
      requested_routes: null,
      resolved_routes: [],
      disqualified: []
    },
    reference_tokens: VALID_OPTIMIZE_REFERENCE_TOKENS,
    bench: null,
    ranking: [],
    winner: {
      route_id: "route-ipc-validation",
      score: 1,
      score_unit: objective === "cost" ? "usd" : "ms",
      tied_with: []
    },
    warnings: []
  };
}

const VALID_COST_OPTIMIZE_REPORT_PAYLOAD = {
  report: makeOptimizeReport("cost"),
  candidateRoutes: [VALID_OPTIMIZE_CANDIDATE_ROUTE],
  requestedRoutes: ["route-ipc-validation"],
  referenceTokens: VALID_OPTIMIZE_REFERENCE_TOKENS,
  createdBy: "switchmaxxer IPC validation test",
  runId: "opt-ipc-validation-cost",
  now: new Date("2026-05-12T12:00:00.000Z")
};

const VALID_LATENCY_OPTIMIZE_REPORT_PAYLOAD = {
  report: makeOptimizeReport("latency"),
  candidateRoutes: [VALID_OPTIMIZE_CANDIDATE_ROUTE],
  requestedRoutes: ["route-ipc-validation"],
  createdBy: "switchmaxxer IPC validation test",
  benchmarkRunId: "bench-ipc-validation",
  settings: {
    path_mode: "direct",
    iterations: 1
  },
  runId: "opt-ipc-validation-latency",
  now: new Date("2026-05-12T12:01:00.000Z")
};

const VALID_OPTIMIZE_MUTATION_COMMON_PAYLOAD = {
  configPath: undefined,
  readModel: {},
  loadReadModel: () => ({}),
  mutateConfigDocument: () => {},
  getMutableConfigSection: () => ({}),
  sourceSurface: "cli",
  createdBy: "switchmaxxer IPC validation test",
  actorKind: "operator",
  actorId: null,
  sessionId: null,
  dryRun: true,
  metadata: {
    phase: "ipc-validation"
  },
  deferLedgerCompletion: false
};

const VALID_OPTIMIZE_APPLY_PAYLOAD = {
  ...VALID_OPTIMIZE_MUTATION_COMMON_PAYLOAD,
  runId: "opt-ipc-validation",
  targetRouteId: "route-ipc-validation"
};

const VALID_OPTIMIZE_RESTORE_PAYLOAD = {
  ...VALID_OPTIMIZE_MUTATION_COMMON_PAYLOAD,
  selector: {
    mode: "action",
    actionId: "action-ipc-validation"
  }
};

const VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND = {
  idempotencyKey: "external-optimize-idempotency-ipc-validation",
  dryRun: true,
  reload: false,
  verify: false,
  createdBy: "switchmaxxer IPC validation test",
  sourceSurface: "cli",
  actorKind: "operator",
  actorId: null,
  sessionId: null,
  metadata: {
    phase: "external-ipc-validation"
  },
  catalog: {
    kind: "narrowed_command_context",
    catalogRevision: "catalog-revision-ipc-validation",
    targetRoute: {
      name: "route-ipc-validation",
      service_provider: "provider-before",
      provider_model_id: "provider-model-before",
      cost: null
    },
    winningRoute: {
      name: "route-winner-ipc-validation",
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

const VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND = {
  ...VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND,
  runId: "opt-ipc-validation",
  targetRouteId: "route-ipc-validation"
};

const VALID_EXTERNAL_OPTIMIZE_RESTORE_ACTION_COMMAND = {
  ...VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND,
  actionId: "action-ipc-validation",
  catalog: {
    ...VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND.catalog,
    restorePoint: {
      action_id: "action-ipc-validation",
      target_route: "route-ipc-validation",
      from_provider: "provider-before",
      to_provider: "provider-after"
    }
  }
};

const VALID_EXTERNAL_OPTIMIZE_RESTORE_RUN_ROUTE_COMMAND = {
  ...VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND,
  runId: "opt-ipc-validation",
  targetRouteId: "route-ipc-validation",
  catalog: {
    ...VALID_EXTERNAL_OPTIMIZE_MUTATION_COMMON_COMMAND.catalog,
    restorePoint: {
      run_id: "opt-ipc-validation",
      target_route: "route-ipc-validation",
      from_provider: "provider-before",
      to_provider: "provider-after"
    }
  }
};

void test("observability IPC request validation accepts a supported framed request", () => {
  const result = validateObservabilityIpcRequest(VALID_REQUEST);

  assert.equal(result.ok, true);
  assert.deepEqual(result, {
    ok: true,
    request: VALID_REQUEST
  });
});

void test("observability IPC request validation rejects malformed envelopes before dispatch", () => {
  const malformedFrames: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly id: string;
    readonly field: string;
  }> = [
    {
      name: "non-object request",
      frame: null,
      id: "unknown",
      field: "request"
    },
    {
      name: "missing id",
      frame: {
        ...VALID_REQUEST,
        id: ""
      },
      id: "unknown",
      field: "id"
    },
    {
      name: "unknown operation",
      frame: {
        ...VALID_REQUEST,
        operation: "trace.nope"
      },
      id: VALID_REQUEST.id,
      field: "operation"
    },
    {
      name: "contract mismatch",
      frame: {
        ...VALID_REQUEST,
        contract_version: "observability-module-v0"
      },
      id: VALID_REQUEST.id,
      field: "contract_version"
    },
    {
      name: "missing store object",
      frame: {
        ...VALID_REQUEST,
        store: null
      },
      id: VALID_REQUEST.id,
      field: "store"
    },
    {
      name: "relative store path",
      frame: {
        ...VALID_REQUEST,
        store: {
          dbPath: "observability.sqlite"
        }
      },
      id: VALID_REQUEST.id,
      field: "store.dbPath"
    },
    {
      name: "array payload",
      frame: {
        ...VALID_REQUEST,
        payload: []
      },
      id: VALID_REQUEST.id,
      field: "payload"
    }
  ];

  for (const { name, frame, id, field } of malformedFrames) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation rejects malformed read and maintenance payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly field: string;
  }> = [
    {
      name: "trace list filters must be an object",
      frame: {
        ...VALID_REQUEST,
        payload: {
          filters: "not-filters"
        }
      },
      field: "payload.filters"
    },
    {
      name: "trace show requires traceId",
      frame: {
        ...VALID_REQUEST,
        operation: "trace.show",
        payload: {}
      },
      field: "payload.traceId"
    },
    {
      name: "trace verify requires boolean all",
      frame: {
        ...VALID_REQUEST,
        operation: "trace.verify",
        payload: {
          traceId: "req-ipc-validation"
        }
      },
      field: "payload.all"
    },
    {
      name: "trace repair rejects contradictory scope",
      frame: {
        ...VALID_REQUEST,
        operation: "trace.repair",
        payload: {
          all: true,
          traceId: "req-ipc-validation"
        }
      },
      field: "payload"
    },
    {
      name: "retention prune requires cutoffIso",
      frame: {
        ...VALID_REQUEST,
        operation: "retention.pruneOlderThan",
        payload: {}
      },
      field: "payload.cutoffIso"
    },
    {
      name: "ledger show requires ledgerEventId",
      frame: {
        ...VALID_REQUEST,
        operation: "ledger.show",
        payload: {}
      },
      field: "payload.ledgerEventId"
    },
    {
      name: "benchmark history list requires positive limit",
      frame: {
        ...VALID_REQUEST,
        operation: "benchmarkHistory.list",
        payload: {
          limit: 0
        }
      },
      field: "payload.limit"
    },
    {
      name: "benchmark history clear requires empty payload",
      frame: {
        ...VALID_REQUEST,
        operation: "benchmarkHistory.clear",
        payload: {
          limit: 1
        }
      },
      field: "payload"
    },
    {
      name: "optimization history delete requires runId",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizationHistory.deleteRun",
        payload: {}
      },
      field: "payload.runId"
    }
  ];

  for (const { name, frame, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, VALID_REQUEST.id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation accepts supported read and maintenance payloads", () => {
  const supportedPayloads: unknown[] = [
    VALID_REQUEST,
    {
      ...VALID_REQUEST,
      operation: "trace.show",
      payload: {
        traceId: "req-ipc-validation"
      }
    },
    {
      ...VALID_REQUEST,
      operation: "trace.verify",
      payload: {
        all: true,
        batchSize: 25
      }
    },
    {
      ...VALID_REQUEST,
      operation: "trace.repair",
      payload: {
        all: false,
        traceId: "req-ipc-validation"
      }
    },
    {
      ...VALID_REQUEST,
      operation: "retention.pruneOlderThan",
      payload: {
        cutoffIso: "2026-05-01T00:00:00.000Z"
      }
    },
    {
      ...VALID_REQUEST,
      operation: "ledger.show",
      payload: {
        ledgerEventId: "ledger-ipc-validation"
      }
    },
    {
      ...VALID_REQUEST,
      operation: "optimizationHistory.list",
      payload: {
        limit: 25
      }
    },
    {
      ...VALID_REQUEST,
      operation: "optimizationHistory.clear",
      payload: {}
    }
  ];

  for (const frame of supportedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, true);
  }
});

void test("observability IPC request validation rejects malformed benchmark run payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly payload: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "benchmark run requires config",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        config: undefined
      },
      field: "payload.config"
    },
    {
      name: "benchmark run requires routeNames",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        routeNames: []
      },
      field: "payload.routeNames"
    },
    {
      name: "benchmark run rejects blank route names",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        routeNames: ["route-ipc-validation", ""]
      },
      field: "payload.routeNames"
    },
    {
      name: "benchmark run requires prompt",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        prompt: ""
      },
      field: "payload.prompt"
    },
    {
      name: "benchmark run requires positive iterations",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        iterations: 0
      },
      field: "payload.iterations"
    },
    {
      name: "benchmark run rejects negative warmup",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        warmup: -1
      },
      field: "payload.warmup"
    },
    {
      name: "benchmark run requires positive concurrency",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        concurrency: 0
      },
      field: "payload.concurrency"
    },
    {
      name: "benchmark run requires known path mode",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        pathMode: "sideways"
      },
      field: "payload.pathMode"
    },
    {
      name: "benchmark run requires local preflight function",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        preflightGateway: undefined
      },
      field: "payload.preflightGateway"
    },
    {
      name: "benchmark run requires createdBy",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        createdBy: ""
      },
      field: "payload.createdBy"
    },
    {
      name: "benchmark run requires objective",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        objective: ""
      },
      field: "payload.objective"
    },
    {
      name: "benchmark run requires known task plan command",
      payload: {
        ...VALID_BENCHMARK_RUN_PAYLOAD,
        taskPlanCommandName: "benchmark"
      },
      field: "payload.taskPlanCommandName"
    }
  ];

  for (const { name, payload, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest({
      ...VALID_REQUEST,
      operation: "benchmarkRuns.run",
      payload
    });

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, VALID_REQUEST.id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation accepts benchmark run payloads", () => {
  const result = validateObservabilityIpcRequest({
    ...VALID_REQUEST,
    operation: "benchmarkRuns.run",
    payload: VALID_BENCHMARK_RUN_PAYLOAD
  });

  assert.equal(result.ok, true);
});

void test("observability IPC request validation accepts external benchmark preflight payloads", () => {
  const successResult = validateObservabilityIpcRequest(
    {
      ...VALID_REQUEST,
      operation: "benchmarkRuns.run",
      payload: VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD
    },
    {
      transport: "external"
    }
  );
  const failureResult = validateObservabilityIpcRequest(
    {
      ...VALID_REQUEST,
      operation: "benchmarkRuns.run",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        gatewayPreflight: {
          ok: false,
          code: "gateway_unavailable",
          message: "Gateway is unavailable.",
          sourceFile: "config.json",
          sourcePath: "/tmp/config.json",
          bindHost: "127.0.0.1",
          port: null,
          probeHost: "127.0.0.1",
          healthUrl: null,
          pid: null,
          latencyMs: null
        }
      }
    },
    {
      transport: "external"
    }
  );

  assert.equal(successResult.ok, true);
  assert.equal(failureResult.ok, true);
});

void test("observability IPC request validation rejects malformed external benchmark preflight payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly payload: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "external benchmark rejects local preflight function",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        preflightGateway: async () => ({ ok: true })
      },
      field: "payload.preflightGateway"
    },
    {
      name: "external benchmark requires gatewayPreflight",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        gatewayPreflight: undefined
      },
      field: "payload.gatewayPreflight"
    },
    {
      name: "external benchmark validates preflight ok",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        gatewayPreflight: {
          ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD.gatewayPreflight,
          ok: "yes"
        }
      },
      field: "payload.gatewayPreflight.ok"
    },
    {
      name: "external benchmark validates successful preflight port",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        gatewayPreflight: {
          ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD.gatewayPreflight,
          port: 0
        }
      },
      field: "payload.gatewayPreflight.port"
    },
    {
      name: "external benchmark validates failed preflight code",
      payload: {
        ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD,
        gatewayPreflight: {
          ...VALID_EXTERNAL_BENCHMARK_RUN_PAYLOAD.gatewayPreflight,
          ok: false,
          code: "gateway_nope",
          message: "Gateway is unavailable."
        }
      },
      field: "payload.gatewayPreflight.code"
    }
  ];

  for (const { name, payload, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest(
      {
        ...VALID_REQUEST,
        operation: "benchmarkRuns.run",
        payload
      },
      {
        transport: "external"
      }
    );

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation rejects malformed optimize report payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly operation: "optimizationReports.persistCost" | "optimizationReports.persistLatency";
    readonly payload: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "cost report requires report",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        report: null
      },
      field: "payload.report"
    },
    {
      name: "cost report requires matching objective",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        report: makeOptimizeReport("latency")
      },
      field: "payload.report.run.objective"
    },
    {
      name: "cost report requires target model",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        report: {
          ...makeOptimizeReport("cost"),
          run: {
            ...makeOptimizeReport("cost").run,
            target_model: ""
          }
        }
      },
      field: "payload.report.run.target_model"
    },
    {
      name: "cost report requires known status",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        report: {
          ...makeOptimizeReport("cost"),
          run: {
            ...makeOptimizeReport("cost").run,
            status: "done"
          }
        }
      },
      field: "payload.report.run.status"
    },
    {
      name: "cost report requires candidate routes array",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        candidateRoutes: "not-routes"
      },
      field: "payload.candidateRoutes"
    },
    {
      name: "cost report validates candidate route shape",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        candidateRoutes: [
          {
            ...VALID_OPTIMIZE_CANDIDATE_ROUTE,
            provider_model_id: ""
          }
        ]
      },
      field: "payload.candidateRoutes"
    },
    {
      name: "cost report validates requested routes",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        requestedRoutes: []
      },
      field: "payload.requestedRoutes"
    },
    {
      name: "cost report requires reference tokens",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        referenceTokens: {
          ...VALID_OPTIMIZE_REFERENCE_TOKENS,
          input_tokens: -1
        }
      },
      field: "payload.referenceTokens"
    },
    {
      name: "cost report requires createdBy",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        createdBy: ""
      },
      field: "payload.createdBy"
    },
    {
      name: "cost report validates now",
      operation: "optimizationReports.persistCost",
      payload: {
        ...VALID_COST_OPTIMIZE_REPORT_PAYLOAD,
        now: "2026-05-12T12:00:00.000Z"
      },
      field: "payload.now"
    },
    {
      name: "latency report requires matching objective",
      operation: "optimizationReports.persistLatency",
      payload: {
        ...VALID_LATENCY_OPTIMIZE_REPORT_PAYLOAD,
        report: makeOptimizeReport("cost")
      },
      field: "payload.report.run.objective"
    },
    {
      name: "latency report requires benchmark run id",
      operation: "optimizationReports.persistLatency",
      payload: {
        ...VALID_LATENCY_OPTIMIZE_REPORT_PAYLOAD,
        benchmarkRunId: ""
      },
      field: "payload.benchmarkRunId"
    },
    {
      name: "latency report requires settings object",
      operation: "optimizationReports.persistLatency",
      payload: {
        ...VALID_LATENCY_OPTIMIZE_REPORT_PAYLOAD,
        settings: null
      },
      field: "payload.settings"
    }
  ];

  for (const { name, operation, payload, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest({
      ...VALID_REQUEST,
      operation,
      payload
    });

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, VALID_REQUEST.id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation accepts optimize report payloads", () => {
  const supportedPayloads: unknown[] = [
    {
      ...VALID_REQUEST,
      operation: "optimizationReports.persistCost",
      payload: VALID_COST_OPTIMIZE_REPORT_PAYLOAD
    },
    {
      ...VALID_REQUEST,
      operation: "optimizationReports.persistLatency",
      payload: VALID_LATENCY_OPTIMIZE_REPORT_PAYLOAD
    }
  ];

  for (const frame of supportedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, true);
  }
});

void test("observability IPC request validation rejects malformed optimize mutation payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly operation: "optimizeMutations.apply" | "optimizeMutations.restore";
    readonly payload: Record<string, unknown>;
    readonly field: string;
  }> = [
    {
      name: "apply requires read model object",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        readModel: null
      },
      field: "payload.readModel"
    },
    {
      name: "apply requires load read model function",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        loadReadModel: undefined
      },
      field: "payload.loadReadModel"
    },
    {
      name: "apply requires config mutator function",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        mutateConfigDocument: undefined
      },
      field: "payload.mutateConfigDocument"
    },
    {
      name: "apply requires config section function",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        getMutableConfigSection: undefined
      },
      field: "payload.getMutableConfigSection"
    },
    {
      name: "apply requires known source surface",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        sourceSurface: "http"
      },
      field: "payload.sourceSurface"
    },
    {
      name: "apply requires createdBy",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        createdBy: ""
      },
      field: "payload.createdBy"
    },
    {
      name: "apply requires known actor kind",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        actorKind: "service"
      },
      field: "payload.actorKind"
    },
    {
      name: "apply validates metadata object",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        metadata: "not-metadata"
      },
      field: "payload.metadata"
    },
    {
      name: "apply requires dryRun",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        dryRun: undefined
      },
      field: "payload.dryRun"
    },
    {
      name: "apply validates deferred completion flag",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        deferLedgerCompletion: "yes"
      },
      field: "payload.deferLedgerCompletion"
    },
    {
      name: "apply requires runId",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        runId: ""
      },
      field: "payload.runId"
    },
    {
      name: "apply requires targetRouteId",
      operation: "optimizeMutations.apply",
      payload: {
        ...VALID_OPTIMIZE_APPLY_PAYLOAD,
        targetRouteId: ""
      },
      field: "payload.targetRouteId"
    },
    {
      name: "restore requires selector",
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: null
      },
      field: "payload.selector"
    },
    {
      name: "restore requires known selector mode",
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: {
          mode: "latest"
        }
      },
      field: "payload.selector.mode"
    },
    {
      name: "restore action selector requires actionId",
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: {
          mode: "action",
          actionId: ""
        }
      },
      field: "payload.selector.actionId"
    },
    {
      name: "restore run route selector requires runId",
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: {
          mode: "run_route",
          runId: "",
          routeId: "route-ipc-validation"
        }
      },
      field: "payload.selector.runId"
    },
    {
      name: "restore run route selector requires routeId",
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: {
          mode: "run_route",
          runId: "opt-ipc-validation",
          routeId: ""
        }
      },
      field: "payload.selector.routeId"
    }
  ];

  for (const { name, operation, payload, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest({
      ...VALID_REQUEST,
      operation,
      payload
    });

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, VALID_REQUEST.id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation accepts optimize mutation payloads", () => {
  const supportedPayloads: unknown[] = [
    {
      ...VALID_REQUEST,
      operation: "optimizeMutations.apply",
      payload: VALID_OPTIMIZE_APPLY_PAYLOAD
    },
    {
      ...VALID_REQUEST,
      operation: "optimizeMutations.restore",
      payload: VALID_OPTIMIZE_RESTORE_PAYLOAD
    },
    {
      ...VALID_REQUEST,
      operation: "optimizeMutations.restore",
      payload: {
        ...VALID_OPTIMIZE_RESTORE_PAYLOAD,
        selector: {
          mode: "run_route",
          runId: "opt-ipc-validation",
          routeId: "route-ipc-validation"
        }
      }
    }
  ];

  for (const frame of supportedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, true);
  }
});

void test("observability IPC standalone validators accept JSON-safe external optimize mutation commands", () => {
  const applyResult = validateObservabilityExternalOptimizeApplyCommand(VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND);
  const restoreActionResult = validateObservabilityExternalOptimizeRestoreCommand(
    VALID_EXTERNAL_OPTIMIZE_RESTORE_ACTION_COMMAND
  );
  const restoreRunRouteResult = validateObservabilityExternalOptimizeRestoreCommand(
    VALID_EXTERNAL_OPTIMIZE_RESTORE_RUN_ROUTE_COMMAND
  );
  const catalogSnapshotResult = validateObservabilityExternalOptimizeApplyCommand({
    ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
    catalog: {
      kind: "catalog_snapshot",
      catalogRevision: "catalog-revision-ipc-validation",
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
  });

  assert.equal(applyResult.ok, true);
  assert.equal(restoreActionResult.ok, true);
  assert.equal(restoreRunRouteResult.ok, true);
  assert.equal(catalogSnapshotResult.ok, true);
});

void test("observability IPC standalone validators reject malformed external optimize mutation commands", () => {
  const malformedCommands: Array<{
    readonly name: string;
    readonly kind: "apply" | "restore";
    readonly command: unknown;
    readonly field: string;
  }> = [
    {
      name: "apply rejects callback fields",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        loadReadModel: () => ({})
      },
      field: "payload.loadReadModel"
    },
    {
      name: "apply requires idempotency key",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        idempotencyKey: ""
      },
      field: "payload.idempotencyKey"
    },
    {
      name: "apply requires reload boolean",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        reload: "no"
      },
      field: "payload.reload"
    },
    {
      name: "apply requires catalog",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        catalog: null
      },
      field: "payload.catalog"
    },
    {
      name: "catalog snapshot requires document",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        catalog: {
          kind: "catalog_snapshot"
        }
      },
      field: "payload.catalog.document"
    },
    {
      name: "narrowed context requires target route",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        catalog: {
          kind: "narrowed_command_context"
        }
      },
      field: "payload.catalog.targetRoute"
    },
    {
      name: "catalog rejects Date values",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        catalog: {
          ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND.catalog,
          targetRoute: {
            name: "route-ipc-validation",
            updated_at: new Date("2026-05-12T12:00:00.000Z")
          }
        }
      },
      field: "payload.catalog.targetRoute.updated_at"
    },
    {
      name: "apply requires run id",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        runId: ""
      },
      field: "payload.runId"
    },
    {
      name: "restore rejects mixed selectors",
      kind: "restore",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_RESTORE_ACTION_COMMAND,
        runId: "opt-ipc-validation",
        targetRouteId: "route-ipc-validation"
      },
      field: "payload.actionId"
    },
    {
      name: "restore requires complete run route selector",
      kind: "restore",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_RESTORE_RUN_ROUTE_COMMAND,
        targetRouteId: ""
      },
      field: "payload.targetRouteId"
    },
    {
      name: "completion warnings must be strings",
      kind: "apply",
      command: {
        ...VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND,
        completion: {
          warnings: ["ok", 1]
        }
      },
      field: "payload.completion.warnings"
    }
  ];

  for (const { name, kind, command, field } of malformedCommands) {
    const result =
      kind === "apply"
        ? validateObservabilityExternalOptimizeApplyCommand(command)
        : validateObservabilityExternalOptimizeRestoreCommand(command);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.field, field, name);
  }
});

void test("observability IPC request validation rejects external optimize mutation operations", () => {
  const frames: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly operation: "optimizeMutations.apply" | "optimizeMutations.restore";
  }> = [
    {
      name: "apply local callback payload",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizeMutations.apply",
        payload: VALID_OPTIMIZE_APPLY_PAYLOAD
      },
      operation: "optimizeMutations.apply"
    },
    {
      name: "apply JSON-safe command payload",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizeMutations.apply",
        payload: VALID_EXTERNAL_OPTIMIZE_APPLY_COMMAND
      },
      operation: "optimizeMutations.apply"
    },
    {
      name: "restore JSON-safe command payload",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizeMutations.restore",
        payload: VALID_EXTERNAL_OPTIMIZE_RESTORE_ACTION_COMMAND
      },
      operation: "optimizeMutations.restore"
    }
  ];

  for (const { name, frame, operation } of frames) {
    const result = validateObservabilityIpcRequest(frame, {
      transport: "external"
    });

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.details["field"], "operation", name);
    assert.equal(result.error.details["operation"], operation, name);
    assert.equal(result.error.details["transport"], "external", name);
  }
});

void test("observability IPC request validation rejects in-process-only fields for external transport", () => {
  const externalOnlyRejections: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly field: string;
  }> = [
    {
      name: "benchmark preflight function",
      frame: {
        ...VALID_REQUEST,
        operation: "benchmarkRuns.run",
        payload: VALID_BENCHMARK_RUN_PAYLOAD
      },
      field: "payload.preflightGateway"
    },
    {
      name: "optimize apply operation",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizeMutations.apply",
        payload: VALID_OPTIMIZE_APPLY_PAYLOAD
      },
      field: "operation"
    },
    {
      name: "optimize restore operation",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizeMutations.restore",
        payload: VALID_OPTIMIZE_RESTORE_PAYLOAD
      },
      field: "operation"
    },
    {
      name: "local Date injection",
      frame: {
        ...VALID_REQUEST,
        operation: "optimizationReports.persistCost",
        payload: VALID_COST_OPTIMIZE_REPORT_PAYLOAD
      },
      field: "payload.now"
    }
  ];

  for (const { name, frame, field } of externalOnlyRejections) {
    assert.equal(validateObservabilityIpcRequest(frame).ok, true, name);

    const result = validateObservabilityIpcRequest(frame, {
      transport: "external"
    });

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation rejects malformed Control Plane Audit payloads", () => {
  const malformedPayloads: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly field: string;
  }> = [
    {
      name: "audit start requires known source surface",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.startConfigMutation",
        payload: {
          sourceSurface: "http",
          operation: "routes_update",
          targetKind: "route",
          targetId: "route-alpha",
          createdBy: "switchmaxxer IPC validation test",
          actorKind: "operator"
        }
      },
      field: "payload.sourceSurface"
    },
    {
      name: "audit start requires known operation",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.startConfigMutation",
        payload: {
          sourceSurface: "cli",
          operation: "routes_nope",
          targetKind: "route",
          targetId: "route-alpha",
          createdBy: "switchmaxxer IPC validation test",
          actorKind: "operator"
        }
      },
      field: "payload.operation"
    },
    {
      name: "audit start requires createdBy",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.startConfigMutation",
        payload: {
          sourceSurface: "cli",
          operation: "routes_update",
          targetKind: "route",
          targetId: "route-alpha",
          createdBy: "",
          actorKind: "operator"
        }
      },
      field: "payload.createdBy"
    },
    {
      name: "audit start rejects non-object metadata",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.startConfigMutation",
        payload: {
          sourceSurface: "cli",
          operation: "routes_update",
          targetKind: "route",
          targetId: "route-alpha",
          createdBy: "switchmaxxer IPC validation test",
          actorKind: "operator",
          metadata: "not-metadata"
        }
      },
      field: "payload.metadata"
    },
    {
      name: "audit finish requires known status",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.finishConfigMutation",
        payload: {
          actionId: "audit-ipc-validation",
          status: "started"
        }
      },
      field: "payload.status"
    },
    {
      name: "audit finish rejects non-object result",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.finishConfigMutation",
        payload: {
          actionId: "audit-ipc-validation",
          status: "succeeded",
          result: "not-result"
        }
      },
      field: "payload.result"
    },
    {
      name: "audit finish error requires code",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.finishConfigMutation",
        payload: {
          actionId: "audit-ipc-validation",
          status: "failed",
          error: {
            message: "Synthetic failure."
          }
        }
      },
      field: "payload.error.code"
    },
    {
      name: "audit finish error requires message",
      frame: {
        ...VALID_REQUEST,
        operation: "controlPlaneAudit.finishConfigMutation",
        payload: {
          actionId: "audit-ipc-validation",
          status: "failed",
          error: {
            code: "synthetic_failure",
            message: ""
          }
        }
      },
      field: "payload.error.message"
    }
  ];

  for (const { name, frame, field } of malformedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.id, VALID_REQUEST.id, name);
    assert.equal(result.error.details["field"], field, name);
  }
});

void test("observability IPC request validation accepts Control Plane Audit payloads", () => {
  const supportedPayloads: unknown[] = [
    {
      ...VALID_REQUEST,
      operation: "controlPlaneAudit.startConfigMutation",
      payload: {
        sourceSurface: "cli",
        operation: "routes_update",
        targetKind: "route",
        targetId: "route-alpha",
        createdBy: "switchmaxxer IPC validation test",
        actorKind: "operator",
        sessionId: null,
        metadata: {
          contract_test: true
        }
      }
    },
    {
      ...VALID_REQUEST,
      operation: "controlPlaneAudit.finishConfigMutation",
      payload: {
        actionId: "audit-ipc-validation",
        status: "succeeded",
        targetId: "route-alpha",
        result: {
          changed: true
        },
        metadata: {
          phase: "ipc-validation"
        }
      }
    },
    {
      ...VALID_REQUEST,
      operation: "controlPlaneAudit.finishConfigMutation",
      payload: {
        actionId: null,
        status: "failed",
        error: {
          code: "synthetic_failure",
          message: "Synthetic failure.",
          details: {
            reason: "test"
          }
        }
      }
    }
  ];

  for (const frame of supportedPayloads) {
    const result = validateObservabilityIpcRequest(frame);

    assert.equal(result.ok, true);
  }
});

void test("observability IPC response validation accepts success and error envelopes", () => {
  const successResponse = buildObservabilityIpcSuccessResponse(VALID_REQUEST, {
    dbPath: VALID_REQUEST.store.dbPath,
    storeFound: false,
    traces: []
  });
  const errorResponse = buildObservabilityIpcErrorResponse({
    id: VALID_REQUEST.id,
    code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
    message: "Synthetic failure.",
    details: {
      operation: VALID_REQUEST.operation
    }
  });

  assert.deepEqual(validateObservabilityIpcResponse(successResponse), {
    ok: true,
    response: successResponse
  });
  assert.deepEqual(validateObservabilityIpcResponse(errorResponse), {
    ok: true,
    response: errorResponse
  });
});

void test("observability IPC response validation rejects malformed success and error envelopes", () => {
  const malformedResponses: Array<{
    readonly name: string;
    readonly frame: unknown;
    readonly field: string;
  }> = [
    {
      name: "missing success result",
      frame: {
        id: "ipc-response-missing-result",
        ok: true,
        warnings: []
      },
      field: "result"
    },
    {
      name: "non-string warning",
      frame: {
        id: "ipc-response-bad-warning",
        ok: true,
        result: {},
        warnings: [1]
      },
      field: "warnings"
    },
    {
      name: "unknown error code",
      frame: {
        id: "ipc-response-bad-code",
        ok: false,
        error: {
          code: "observability_nope",
          message: "Synthetic failure.",
          retryable: false
        },
        warnings: []
      },
      field: "error.code"
    },
    {
      name: "missing retryable",
      frame: {
        id: "ipc-response-missing-retryable",
        ok: false,
        error: {
          code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
          message: "Synthetic failure."
        },
        warnings: []
      },
      field: "error.retryable"
    }
  ];

  for (const { name, frame, field } of malformedResponses) {
    const result = validateObservabilityIpcResponse(frame);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.error.details["field"], field, name);
  }
});
