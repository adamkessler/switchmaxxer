import assert from "node:assert/strict";

import {
  createOstrichBenchmarkHistoryPort,
  createOstrichBenchmarkRunPort,
  createOstrichControlPlaneAuditPort,
  createOstrichOptimizeMutationPort,
  createOstrichOptimizationHistoryPort,
  createOstrichOptimizationReportPort,
  createOstrichRetentionPort,
  createOstrichLedgerPort,
  createOstrichTraceQueryPort,
  createOstrichTraceMaintenancePort,
  createOstrichObservabilityModule,
  defaultObservabilityModule,
  OSTRICH_OBSERVABILITY_MODULE_DESCRIPTOR
} from "./observability-module";
import { test } from "./observability.test-support";
import type { GatewayObservationInput } from "./ostrich/ingestion/gateway-observation-records";
import type { ProxyRequestContext, RouteConfig } from "../../platform/types";
import { SecretString } from "../../platform/secret-string";

function makeContext(): ProxyRequestContext {
  return {
    requestId: "req-observability-module",
    apiMode: "openai-completions",
    bareModel: "module-route",
    caller: "module-test",
    stream: false,
    requestStartedAt: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function makeRoute(): RouteConfig {
  return {
    serviceProvider: "module-provider",
    model: "module-provider-model",
    api_mode: "openai-completions",
    anthropicVersion: null,
    modelCreator: "openai",
    baseUrl: "https://example.test/v1/chat/completions",
    allowPrivateEndpoints: false,
    apiKeyEnv: null,
    inlineApiKey: new SecretString("module-test-key"),
    routeTimeoutMs: null,
    timeoutMs: 5_000,
    cost: null,
    modelCost: null
  };
}

void test("Ostrich observability module exposes the in-process TypeScript descriptor", () => {
  assert.deepEqual(OSTRICH_OBSERVABILITY_MODULE_DESCRIPTOR, {
    id: "ostrich",
    runtime: "in_process_typescript",
    displayName: "Ostrich",
    capabilities: {
      gatewayObservationWrites: true,
      localReadModel: true,
      retentionPruning: true,
      gracefulShutdownDrain: true
    }
  });
  assert.deepEqual(defaultObservabilityModule.descriptor, OSTRICH_OBSERVABILITY_MODULE_DESCRIPTOR);
});

void test("Ostrich observability module delegates lifecycle, read model, and gateway writes", async () => {
  const calls: string[] = [];
  const context = makeContext();
  const route = makeRoute();
  const observation: GatewayObservationInput = {
    context,
    route,
    kind: "measurement",
    event: "request_received",
    stage: "ingress"
  };

  const module = createOstrichObservabilityModule({
    configure: (options) => {
      calls.push(`configure:${options.retentionOlderThan}:${options.disabled}:${options.dbPath}`);
    },
    bootstrap: () => {
      calls.push("bootstrap");
    },
    pruneRetentionNow: (source = "interval") => {
      calls.push(`prune:${source}`);
    },
    getService: () => {
      calls.push("getService");
      return null;
    },
    getDbPath: () => {
      calls.push("getDbPath");
      return "/tmp/observability-module.sqlite";
    },
    recordGatewayObservation: (input) => {
      calls.push(`record:${input.event}:${input.context.requestId}`);
    },
    recordGatewayFailureObservation: (stage, failureContext, reason, failureRoute, attributes) => {
      calls.push(
        `failure:${stage}:${failureContext.requestId}:${reason}:${failureRoute?.serviceProvider}:${attributes?.["kind"]}`
      );
    },
    shutdown: async () => {
      calls.push("shutdown");
    },
    trace: {
      list: ({ dbPath }) => {
        calls.push(`traceList:${dbPath}`);
        return {
          dbPath,
          storeFound: false,
          traces: []
        };
      },
      listObservations: ({ dbPath }) => {
        calls.push(`traceObservations:${dbPath}`);
        return {
          dbPath,
          storeFound: false,
          observations: []
        };
      },
      show: ({ dbPath, traceId }) => {
        calls.push(`traceShow:${dbPath}:${traceId}`);
        return {
          dbPath,
          storeFound: false,
          requestExecution: null,
          observations: [],
          benchmarkSamples: []
        };
      },
      getStats: ({ dbPath }) => {
        calls.push(`traceStats:${dbPath}`);
        return {
          dbPath,
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
        };
      }
    },
    traceMaintenance: {
      verify: ({ dbPath, all, traceId, batchSize }) => {
        calls.push(`traceVerify:${dbPath}:${all}:${traceId ?? "none"}:${batchSize ?? "none"}`);
        return {
          dbPath,
          storeFound: false,
          results: []
        };
      },
      repair: ({ dbPath, all, traceId, batchSize }) => {
        calls.push(`traceRepair:${dbPath}:${all}:${traceId ?? "none"}:${batchSize ?? "none"}`);
        return {
          dbPath,
          storeFound: false,
          results: []
        };
      }
    },
    retention: {
      pruneOlderThan: ({ dbPath, cutoffIso }) => {
        calls.push(`retentionPrune:${dbPath}:${cutoffIso}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      }
    },
    ledger: {
      list: ({ dbPath }) => {
        calls.push(`ledgerList:${dbPath}`);
        return {
          dbPath,
          storeFound: false,
          events: []
        };
      },
      show: ({ dbPath, ledgerEventId }) => {
        calls.push(`ledgerShow:${dbPath}:${ledgerEventId}`);
        return {
          dbPath,
          storeFound: false,
          event: null
        };
      }
    },
    controlPlaneAudit: {
      startConfigMutation: ({ dbPath, operation, targetKind, targetId }) => {
        calls.push(`auditStart:${dbPath}:${operation}:${targetKind}:${targetId ?? "none"}`);
        return {
          dbPath,
          storeFound: true,
          actionId: "audit-observability-module"
        };
      },
      finishConfigMutation: ({ dbPath, actionId, status, targetId }) => {
        calls.push(`auditFinish:${dbPath}:${actionId ?? "none"}:${status}:${targetId ?? "none"}`);
        return {
          dbPath,
          storeFound: true
        };
      }
    },
    benchmarkRuns: {
      run: async ({ dbPath, routeNames }) => {
        calls.push(`benchmarkRun:${dbPath}:${routeNames.join(",")}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      }
    },
    benchmarkHistory: {
      list: ({ dbPath, limit }) => {
        calls.push(`benchmarkList:${dbPath}:${limit}`);
        return {
          dbPath,
          storeFound: false,
          runs: []
        };
      },
      show: ({ dbPath, runId }) => {
        calls.push(`benchmarkShow:${dbPath}:${runId}`);
        return {
          dbPath,
          storeFound: false,
          run: null,
          summary: null,
          samples: []
        };
      },
      pruneOlderThan: ({ dbPath, cutoffIso }) => {
        calls.push(`benchmarkPrune:${dbPath}:${cutoffIso}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      },
      deleteRun: ({ dbPath, runId }) => {
        calls.push(`benchmarkDelete:${dbPath}:${runId}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      },
      clear: ({ dbPath }) => {
        calls.push(`benchmarkClear:${dbPath}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      }
    },
    optimizationReports: {
      persistCost: ({ dbPath, report }) => {
        calls.push(`optimizePersistCost:${dbPath}:${report.run.objective}`);
        return {
          dbPath,
          storeFound: true,
          report
        };
      },
      persistLatency: ({ dbPath, report }) => {
        calls.push(`optimizePersistLatency:${dbPath}:${report.run.objective}`);
        return {
          dbPath,
          storeFound: true,
          report
        };
      }
    },
    optimizeMutations: {
      apply: ({ dbPath, runId, targetRouteId }) => {
        calls.push(`optimizeApply:${dbPath}:${runId}:${targetRouteId}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      },
      restore: ({ dbPath, selector }) => {
        calls.push(`optimizeRestore:${dbPath}:${selector.mode}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      }
    },
    optimizationHistory: {
      list: ({ dbPath, limit }) => {
        calls.push(`optimizeList:${dbPath}:${limit}`);
        return {
          dbPath,
          storeFound: false,
          runs: []
        };
      },
      show: ({ dbPath, runId }) => {
        calls.push(`optimizeShow:${dbPath}:${runId}`);
        return {
          dbPath,
          storeFound: false,
          run: null
        };
      },
      pruneOlderThan: ({ dbPath, cutoffIso }) => {
        calls.push(`optimizePrune:${dbPath}:${cutoffIso}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      },
      deleteRun: ({ dbPath, runId }) => {
        calls.push(`optimizeDelete:${dbPath}:${runId}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      },
      clear: ({ dbPath }) => {
        calls.push(`optimizeClear:${dbPath}`);
        return {
          dbPath,
          storeFound: false,
          result: null
        };
      }
    }
  });

  module.configure({
    retentionOlderThan: "7d",
    disabled: false,
    dbPath: "/tmp/observability-module.sqlite"
  });
  module.bootstrap();
  module.pruneRetentionNow("startup");
  assert.equal(module.getService(), null);
  assert.equal(module.getDbPath(), "/tmp/observability-module.sqlite");
  module.recordGatewayObservation(observation);
  module.recordGatewayFailureObservation("upstream_fetch", context, "provider_timeout", route, {
    kind: "timeout"
  });
  module.trace.list({ dbPath: "/tmp/observability-module.sqlite" });
  module.trace.listObservations({ dbPath: "/tmp/observability-module.sqlite" });
  module.trace.show({ dbPath: "/tmp/observability-module.sqlite", traceId: "req-observability-module" });
  module.trace.getStats({ dbPath: "/tmp/observability-module.sqlite" });
  module.traceMaintenance.verify({
    dbPath: "/tmp/observability-module.sqlite",
    all: false,
    traceId: "req-observability-module"
  });
  module.traceMaintenance.repair({
    dbPath: "/tmp/observability-module.sqlite",
    all: true,
    batchSize: 25
  });
  module.retention.pruneOlderThan({
    dbPath: "/tmp/observability-module.sqlite",
    cutoffIso: "2026-05-01T00:00:00.000Z"
  });
  module.ledger.list({ dbPath: "/tmp/observability-module.sqlite" });
  module.ledger.show({
    dbPath: "/tmp/observability-module.sqlite",
    ledgerEventId: "ledger-observability-module"
  });
  const auditStarted = module.controlPlaneAudit.startConfigMutation({
    dbPath: "/tmp/observability-module.sqlite",
    sourceSurface: "cli",
    operation: "routes_update",
    targetKind: "route",
    targetId: "module-route",
    createdBy: "switchmaxxer test",
    actorKind: "operator"
  });
  module.controlPlaneAudit.finishConfigMutation({
    dbPath: "/tmp/observability-module.sqlite",
    actionId: auditStarted.actionId,
    status: "succeeded",
    targetId: "module-route"
  });
  await module.benchmarkRuns.run({
    dbPath: "/tmp/observability-module.sqlite",
    config: {
      bindHost: "127.0.0.1",
      port: 8080,
      timeoutMs: 5_000,
      routes: {}
    } as never,
    routeNames: ["module-route"],
    prompt: "hello",
    iterations: 1,
    warmup: 0,
    concurrency: 1,
    pathMode: "direct",
    preflightGateway: async () => ({ ok: true }) as never,
    createdBy: "switchmaxxer test",
    objective: "route_benchmark",
    taskPlanCommandName: "bench"
  });
  module.benchmarkHistory.list({
    dbPath: "/tmp/observability-module.sqlite",
    limit: 10
  });
  module.benchmarkHistory.show({
    dbPath: "/tmp/observability-module.sqlite",
    runId: "bench-observability-module"
  });
  module.benchmarkHistory.pruneOlderThan({
    dbPath: "/tmp/observability-module.sqlite",
    cutoffIso: "2026-05-01T00:00:00.000Z"
  });
  module.benchmarkHistory.deleteRun({
    dbPath: "/tmp/observability-module.sqlite",
    runId: "bench-observability-module"
  });
  module.benchmarkHistory.clear({ dbPath: "/tmp/observability-module.sqlite" });
  module.optimizationReports.persistCost({
    dbPath: "/tmp/observability-module.sqlite",
    report: {
      run: {
        run_id: null,
        persisted: false,
        created_at: null,
        finished_at: null,
        created_by: null,
        status: "completed",
        target_model: "module-model",
        objective: "cost"
      },
      candidates: {
        requested_routes: null,
        resolved_routes: [],
        disqualified: []
      },
      reference_tokens: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_write_tokens: 0
      },
      bench: null,
      ranking: [],
      winner: {
        route_id: "module-route",
        score: 1,
        score_unit: "usd",
        tied_with: []
      },
      warnings: []
    },
    candidateRoutes: [],
    requestedRoutes: null,
    referenceTokens: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0
    },
    createdBy: "switchmaxxer test"
  });
  module.optimizeMutations.apply({
    dbPath: "/tmp/observability-module.sqlite",
    configPath: undefined,
    readModel: {} as never,
    loadReadModel: () => ({}) as never,
    mutateConfigDocument: () => {},
    getMutableConfigSection: () => ({}),
    sourceSurface: "cli",
    createdBy: "switchmaxxer test",
    actorKind: "operator",
    runId: "opt-observability-module",
    targetRouteId: "module-route",
    dryRun: true
  });
  module.optimizationHistory.list({
    dbPath: "/tmp/observability-module.sqlite",
    limit: 10
  });
  module.optimizationHistory.show({
    dbPath: "/tmp/observability-module.sqlite",
    runId: "opt-observability-module"
  });
  module.optimizationHistory.pruneOlderThan({
    dbPath: "/tmp/observability-module.sqlite",
    cutoffIso: "2026-05-01T00:00:00.000Z"
  });
  module.optimizationHistory.deleteRun({
    dbPath: "/tmp/observability-module.sqlite",
    runId: "opt-observability-module"
  });
  module.optimizationHistory.clear({ dbPath: "/tmp/observability-module.sqlite" });
  await module.shutdown();

  assert.deepEqual(calls, [
    "configure:7d:false:/tmp/observability-module.sqlite",
    "bootstrap",
    "prune:startup",
    "getService",
    "getDbPath",
    "record:request_received:req-observability-module",
    "failure:upstream_fetch:req-observability-module:provider_timeout:module-provider:timeout",
    "traceList:/tmp/observability-module.sqlite",
    "traceObservations:/tmp/observability-module.sqlite",
    "traceShow:/tmp/observability-module.sqlite:req-observability-module",
    "traceStats:/tmp/observability-module.sqlite",
    "traceVerify:/tmp/observability-module.sqlite:false:req-observability-module:none",
    "traceRepair:/tmp/observability-module.sqlite:true:none:25",
    "retentionPrune:/tmp/observability-module.sqlite:2026-05-01T00:00:00.000Z",
    "ledgerList:/tmp/observability-module.sqlite",
    "ledgerShow:/tmp/observability-module.sqlite:ledger-observability-module",
    "auditStart:/tmp/observability-module.sqlite:routes_update:route:module-route",
    "auditFinish:/tmp/observability-module.sqlite:audit-observability-module:succeeded:module-route",
    "benchmarkRun:/tmp/observability-module.sqlite:module-route",
    "benchmarkList:/tmp/observability-module.sqlite:10",
    "benchmarkShow:/tmp/observability-module.sqlite:bench-observability-module",
    "benchmarkPrune:/tmp/observability-module.sqlite:2026-05-01T00:00:00.000Z",
    "benchmarkDelete:/tmp/observability-module.sqlite:bench-observability-module",
    "benchmarkClear:/tmp/observability-module.sqlite",
    "optimizePersistCost:/tmp/observability-module.sqlite:cost",
    "optimizeApply:/tmp/observability-module.sqlite:opt-observability-module:module-route",
    "optimizeList:/tmp/observability-module.sqlite:10",
    "optimizeShow:/tmp/observability-module.sqlite:opt-observability-module",
    "optimizePrune:/tmp/observability-module.sqlite:2026-05-01T00:00:00.000Z",
    "optimizeDelete:/tmp/observability-module.sqlite:opt-observability-module",
    "optimizeClear:/tmp/observability-module.sqlite",
    "shutdown"
  ]);
});

void test("Ostrich trace query port returns empty stats when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const trace = createOstrichTraceQueryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(trace.getStats({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
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
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization history port returns empty runs when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationHistory = createOstrichOptimizationHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(optimizationHistory.list({ dbPath: "/tmp/missing-observability.sqlite", limit: 25 }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    runs: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization report port skips persistence when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationReports = createOstrichOptimizationReportPort({
    open: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    optimizationReports.persistCost({
      dbPath: "/tmp/missing-observability.sqlite",
      report: {
        run: {
          run_id: null,
          persisted: false,
          created_at: null,
          finished_at: null,
          created_by: null,
          status: "completed",
          target_model: "module-model",
          objective: "cost"
        },
        candidates: {
          requested_routes: null,
          resolved_routes: [],
          disqualified: []
        },
        reference_tokens: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0
        },
        bench: null,
        ranking: [],
        winner: {
          route_id: "module-route",
          score: 1,
          score_unit: "usd",
          tied_with: []
        },
        warnings: []
      },
      candidateRoutes: [],
      requestedRoutes: null,
      referenceTokens: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_write_tokens: 0
      },
      createdBy: "switchmaxxer test"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      report: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimize mutation port skips apply when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizeMutations = createOstrichOptimizeMutationPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    optimizeMutations.apply({
      dbPath: "/tmp/missing-observability.sqlite",
      configPath: undefined,
      readModel: {} as never,
      loadReadModel: () => ({}) as never,
      mutateConfigDocument: () => {},
      getMutableConfigSection: () => ({}),
      sourceSurface: "cli",
      createdBy: "switchmaxxer test",
      actorKind: "operator",
      runId: "missing-opt-run",
      targetRouteId: "missing-route",
      dryRun: true
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization history port returns no run details when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationHistory = createOstrichOptimizationHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    optimizationHistory.show({
      dbPath: "/tmp/missing-observability.sqlite",
      runId: "opt-missing"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      run: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization history port returns no prune result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationHistory = createOstrichOptimizationHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    optimizationHistory.pruneOlderThan({
      dbPath: "/tmp/missing-observability.sqlite",
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization history port returns no delete result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationHistory = createOstrichOptimizationHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    optimizationHistory.deleteRun({
      dbPath: "/tmp/missing-observability.sqlite",
      runId: "opt-missing"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich optimization history port returns no clear result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const optimizationHistory = createOstrichOptimizationHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(optimizationHistory.clear({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    result: null
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark history port returns no prune result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const benchmarkHistory = createOstrichBenchmarkHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    benchmarkHistory.pruneOlderThan({
      dbPath: "/tmp/missing-observability.sqlite",
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark history port returns no delete result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const benchmarkHistory = createOstrichBenchmarkHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    benchmarkHistory.deleteRun({
      dbPath: "/tmp/missing-observability.sqlite",
      runId: "bench-missing"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark history port returns no clear result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const benchmarkHistory = createOstrichBenchmarkHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(benchmarkHistory.clear({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    result: null
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark history port returns empty runs when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const benchmarkHistory = createOstrichBenchmarkHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(benchmarkHistory.list({ dbPath: "/tmp/missing-observability.sqlite", limit: 25 }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    runs: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark run port skips execution when the store is missing and closes handles", async () => {
  const closed: unknown[] = [];
  const benchmarkRuns = createOstrichBenchmarkRunPort({
    open: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    await benchmarkRuns.run({
      dbPath: "/tmp/missing-observability.sqlite",
      config: {
        bindHost: "127.0.0.1",
        port: 8080,
        timeoutMs: 5_000,
        routes: {}
      } as never,
      routeNames: ["missing-route"],
      prompt: "hello",
      iterations: 1,
      warmup: 0,
      concurrency: 1,
      pathMode: "direct",
      preflightGateway: async () => ({ ok: true }) as never,
      createdBy: "switchmaxxer test",
      objective: "route_benchmark",
      taskPlanCommandName: "bench"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich benchmark history port returns no run details when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const benchmarkHistory = createOstrichBenchmarkHistoryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    benchmarkHistory.show({
      dbPath: "/tmp/missing-observability.sqlite",
      runId: "bench-missing"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      run: null,
      summary: null,
      samples: []
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich ledger port returns empty events when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const ledger = createOstrichLedgerPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(ledger.list({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    events: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich ledger port returns no event when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const ledger = createOstrichLedgerPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    ledger.show({
      dbPath: "/tmp/missing-observability.sqlite",
      ledgerEventId: "ledger-missing"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      event: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich control-plane audit port skips start when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const audit = createOstrichControlPlaneAuditPort({
    open: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    audit.startConfigMutation({
      dbPath: "/tmp/missing-observability.sqlite",
      sourceSurface: "cli",
      operation: "routes_update",
      targetKind: "route",
      targetId: "missing-route",
      createdBy: "switchmaxxer test",
      actorKind: "operator"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      actionId: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich control-plane audit port skips finish when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const audit = createOstrichControlPlaneAuditPort({
    open: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    audit.finishConfigMutation({
      dbPath: "/tmp/missing-observability.sqlite",
      actionId: "audit-missing",
      status: "failed",
      targetId: "missing-route",
      error: {
        code: "route_not_found",
        message: "Route not found."
      }
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich retention port returns no prune result when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const retention = createOstrichRetentionPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(
    retention.pruneOlderThan({
      dbPath: "/tmp/missing-observability.sqlite",
      cutoffIso: "2026-05-01T00:00:00.000Z"
    }),
    {
      dbPath: "/tmp/missing-observability.sqlite",
      storeFound: false,
      result: null
    }
  );
  assert.deepEqual(closed, [null]);
});

void test("Ostrich trace maintenance port returns empty verification results when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const traceMaintenance = createOstrichTraceMaintenancePort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(traceMaintenance.verify({ dbPath: "/tmp/missing-observability.sqlite", all: true }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    results: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich trace maintenance port returns empty repair results when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const traceMaintenance = createOstrichTraceMaintenancePort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(traceMaintenance.repair({ dbPath: "/tmp/missing-observability.sqlite", all: false, traceId: "req-missing" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    results: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich trace query port returns empty trace details when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const trace = createOstrichTraceQueryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(trace.show({ dbPath: "/tmp/missing-observability.sqlite", traceId: "req-missing" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    requestExecution: null,
    observations: [],
    benchmarkSamples: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich trace query port returns empty trace lists when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const trace = createOstrichTraceQueryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(trace.list({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    traces: []
  });
  assert.deepEqual(closed, [null]);
});

void test("Ostrich trace query port returns empty observations when the store is missing and closes handles", () => {
  const closed: unknown[] = [];
  const trace = createOstrichTraceQueryPort({
    openExisting: () => null,
    close: (handle) => {
      closed.push(handle);
    }
  });

  assert.deepEqual(trace.listObservations({ dbPath: "/tmp/missing-observability.sqlite" }), {
    dbPath: "/tmp/missing-observability.sqlite",
    storeFound: false,
    observations: []
  });
  assert.deepEqual(closed, [null]);
});
