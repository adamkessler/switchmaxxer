import assert from "node:assert/strict";

import type { RouteReadModel } from "../../platform/types";
import type { ObservabilityModule } from "./observability-module";
import type { OptimizeReportView } from "./optimize-report-builder";
import { test } from "./observability.test-support";

const MISSING_DB_PATH = "/tmp/missing-observability-contract.sqlite";
const SEEDED_REQUEST_ID = "req-module-contract-seeded";
const SEEDED_BENCHMARK_RUN_ID = "bench-module-contract-seeded";
const CUTOFF_ISO = "2026-05-01T00:00:00.000Z";

const SEEDED_CANDIDATE_ROUTE: RouteReadModel = {
  name: "route-alpha",
  model: "model-alpha",
  service_provider: "provider-main",
  provider_model_id: "provider-model-1",
  display_name: "Route Alpha",
  api_mode: "openai-completions",
  cost: null,
  model_cost: null,
  effective_cost: {
    input: 0.000001,
    output: 0.000002,
    cacheRead: 0,
    cacheWrite: 0
  },
  timeout_ms: null,
  effective_timeout_ms: 5_000
};

function minimalOptimizeReport(objective: "cost" | "latency"): OptimizeReportView {
  return {
    run: {
      run_id: null,
      persisted: false,
      created_at: null,
      finished_at: null,
      created_by: null,
      status: "completed",
      target_model: "module-contract-model",
      objective
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
      route_id: "module-contract-route",
      score: 1,
      score_unit: objective === "cost" ? "usd" : "ms",
      tied_with: []
    },
    warnings: []
  };
}

export function registerObservabilityModuleMissingStoreContractTests(options: {
  name: string;
  createModule: () => ObservabilityModule;
  getClosedHandleCount?: () => number;
  expectedClosedHandleCount?: number;
}): void {
  void test(`${options.name} satisfies the missing-store module contract`, async () => {
    const module = options.createModule();

    assert.deepEqual(await module.trace.list({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      traces: []
    });
    assert.deepEqual(await module.trace.listObservations({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      observations: []
    });
    assert.deepEqual(await module.trace.getStats({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
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
    assert.deepEqual(await module.trace.show({ dbPath: MISSING_DB_PATH, traceId: "trace-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      requestExecution: null,
      observations: [],
      benchmarkSamples: []
    });

    assert.deepEqual(await module.traceMaintenance.verify({ dbPath: MISSING_DB_PATH, all: true }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      results: []
    });
    assert.deepEqual(
      await module.traceMaintenance.repair({
        dbPath: MISSING_DB_PATH,
        all: false,
        traceId: "trace-missing"
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        results: []
      }
    );
    assert.deepEqual(
      await module.retention.pruneOlderThan({
        dbPath: MISSING_DB_PATH,
        cutoffIso: CUTOFF_ISO
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );

    assert.deepEqual(await module.ledger.list({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      events: []
    });
    assert.deepEqual(await module.ledger.show({ dbPath: MISSING_DB_PATH, ledgerEventId: "ledger-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      event: null
    });

    assert.deepEqual(
      await module.controlPlaneAudit.startConfigMutation({
        dbPath: MISSING_DB_PATH,
        sourceSurface: "cli",
        operation: "routes_update",
        targetKind: "route",
        targetId: "route-missing",
        createdBy: "switchmaxxer module contract test",
        actorKind: "operator"
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        actionId: null
      }
    );
    assert.deepEqual(
      await module.controlPlaneAudit.finishConfigMutation({
        dbPath: MISSING_DB_PATH,
        actionId: "audit-missing",
        status: "failed",
        targetId: "route-missing",
        error: {
          code: "route_not_found",
          message: "Route not found."
        }
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false
      }
    );

    assert.deepEqual(await module.benchmarkHistory.list({ dbPath: MISSING_DB_PATH, limit: 25 }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      runs: []
    });
    assert.deepEqual(await module.benchmarkHistory.show({ dbPath: MISSING_DB_PATH, runId: "bench-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      run: null,
      summary: null,
      samples: []
    });
    assert.deepEqual(
      await module.benchmarkHistory.pruneOlderThan({
        dbPath: MISSING_DB_PATH,
        cutoffIso: CUTOFF_ISO
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );
    assert.deepEqual(await module.benchmarkHistory.deleteRun({ dbPath: MISSING_DB_PATH, runId: "bench-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      result: null
    });
    assert.deepEqual(await module.benchmarkHistory.clear({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      result: null
    });
    assert.deepEqual(
      await module.benchmarkRuns.run({
        dbPath: MISSING_DB_PATH,
        config: {
          bindHost: "127.0.0.1",
          port: 8080,
          timeoutMs: 5_000,
          routes: {}
        } as never,
        routeNames: ["route-missing"],
        prompt: "hello",
        iterations: 1,
        warmup: 0,
        concurrency: 1,
        pathMode: "direct",
        preflightGateway: async () => ({ ok: true }) as never,
        createdBy: "switchmaxxer module contract test",
        objective: "route_benchmark",
        taskPlanCommandName: "bench"
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );

    assert.deepEqual(await module.optimizationHistory.list({ dbPath: MISSING_DB_PATH, limit: 25 }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      runs: []
    });
    assert.deepEqual(await module.optimizationHistory.show({ dbPath: MISSING_DB_PATH, runId: "opt-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      run: null
    });
    assert.deepEqual(
      await module.optimizationHistory.pruneOlderThan({
        dbPath: MISSING_DB_PATH,
        cutoffIso: CUTOFF_ISO
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );
    assert.deepEqual(await module.optimizationHistory.deleteRun({ dbPath: MISSING_DB_PATH, runId: "opt-missing" }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      result: null
    });
    assert.deepEqual(await module.optimizationHistory.clear({ dbPath: MISSING_DB_PATH }), {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      result: null
    });

    assert.deepEqual(
      await module.optimizationReports.persistCost({
        dbPath: MISSING_DB_PATH,
        report: minimalOptimizeReport("cost"),
        candidateRoutes: [],
        requestedRoutes: null,
        referenceTokens: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0
        },
        createdBy: "switchmaxxer module contract test"
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        report: null
      }
    );
    assert.deepEqual(
      await module.optimizationReports.persistLatency({
        dbPath: MISSING_DB_PATH,
        report: minimalOptimizeReport("latency"),
        candidateRoutes: [],
        requestedRoutes: null,
        createdBy: "switchmaxxer module contract test",
        benchmarkRunId: "bench-missing",
        settings: {}
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        report: null
      }
    );

    assert.deepEqual(
      await module.optimizeMutations.apply({
        dbPath: MISSING_DB_PATH,
        configPath: undefined,
        readModel: {} as never,
        loadReadModel: () => ({}) as never,
        mutateConfigDocument: () => {},
        getMutableConfigSection: () => ({}),
        sourceSurface: "cli",
        createdBy: "switchmaxxer module contract test",
        actorKind: "operator",
        runId: "opt-missing",
        targetRouteId: "route-missing",
        dryRun: true
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );
    assert.deepEqual(
      await module.optimizeMutations.restore({
        dbPath: MISSING_DB_PATH,
        configPath: undefined,
        readModel: {} as never,
        loadReadModel: () => ({}) as never,
        mutateConfigDocument: () => {},
        getMutableConfigSection: () => ({}),
        sourceSurface: "cli",
        createdBy: "switchmaxxer module contract test",
        actorKind: "operator",
        selector: {
          mode: "action",
          actionId: "action-missing"
        },
        dryRun: true
      }),
      {
        dbPath: MISSING_DB_PATH,
        storeFound: false,
        result: null
      }
    );

    if (options.getClosedHandleCount && options.expectedClosedHandleCount !== undefined) {
      assert.equal(options.getClosedHandleCount(), options.expectedClosedHandleCount);
    }
  });
}

export function registerObservabilityModuleSeededStoreContractTests(options: {
  name: string;
  createModule: () => ObservabilityModule;
  createSeededStore: (requestId: string) => {
    dbPath: string;
    cleanup: () => void;
  };
}): void {
  void test(`${options.name} satisfies the seeded trace and Ledger module contract`, async () => {
    const seededStore = options.createSeededStore(SEEDED_REQUEST_ID);

    try {
      const module = options.createModule();

      const traces = await module.trace.list({ dbPath: seededStore.dbPath });
      assert.equal(traces.dbPath, seededStore.dbPath);
      assert.equal(traces.storeFound, true);
      assert.equal(traces.traces.length, 1);
      assert.equal(traces.traces[0]?.request_id, SEEDED_REQUEST_ID);
      assert.equal(traces.traces[0]?.outcome, "succeeded");
      assert.equal(traces.traces[0]?.observation_count, 7);

      const observations = await module.trace.listObservations({
        dbPath: seededStore.dbPath,
        filters: {
          requestId: SEEDED_REQUEST_ID,
          limit: 20
        }
      });
      assert.equal(observations.dbPath, seededStore.dbPath);
      assert.equal(observations.storeFound, true);
      assert.deepEqual(
        observations.observations.map((observation) => observation.event),
        [
          "client_response_completed",
          "client_response_started",
          "upstream_response_completed",
          "upstream_response_started",
          "upstream_request_started",
          "route_resolved",
          "request_received"
        ]
      );

      const trace = await module.trace.show({
        dbPath: seededStore.dbPath,
        traceId: SEEDED_REQUEST_ID
      });
      assert.equal(trace.dbPath, seededStore.dbPath);
      assert.equal(trace.storeFound, true);
      assert.equal(trace.requestExecution?.request_id, SEEDED_REQUEST_ID);
      assert.equal(trace.requestExecution?.gateway_residency_ms, 90);
      assert.equal(trace.requestExecution?.switchmaxxer_pre_upstream_ms, 20);
      assert.equal(trace.requestExecution?.upstream_ttft_ms, 20);
      assert.equal(trace.requestExecution?.upstream_duration_ms, 30);
      assert.equal(trace.requestExecution?.client_write_ms, 30);
      assert.deepEqual(
        trace.observations.map((observation) => observation.event),
        [
          "request_received",
          "route_resolved",
          "upstream_request_started",
          "upstream_response_started",
          "upstream_response_completed",
          "client_response_started",
          "client_response_completed"
        ]
      );
      assert.equal(trace.benchmarkSamples.length, 1);
      assert.equal(trace.benchmarkSamples[0]?.benchmark_run_id, SEEDED_BENCHMARK_RUN_ID);
      assert.equal(trace.benchmarkSamples[0]?.route_id, "route-alpha");

      const stats = await module.trace.getStats({ dbPath: seededStore.dbPath });
      assert.equal(stats.dbPath, seededStore.dbPath);
      assert.equal(stats.storeFound, true);
      assert.equal(stats.stats.total_count, 1);
      assert.equal(stats.stats.partial_output_count, 0);
      assert.equal(stats.stats.average_gateway_residency_ms, 90);
      assert.deepEqual(
        stats.stats.outcome_counts.map((row) => ({
          outcome: row.outcome,
          count: row.count
        })),
        [{ outcome: "succeeded", count: 1 }]
      );

      const started = await module.controlPlaneAudit.startConfigMutation({
        dbPath: seededStore.dbPath,
        sourceSurface: "cli",
        operation: "routes_update",
        targetKind: "route",
        targetId: "route-alpha",
        createdBy: "switchmaxxer module contract test",
        actorKind: "operator",
        metadata: {
          contract_test: true
        }
      });
      assert.equal(started.dbPath, seededStore.dbPath);
      assert.equal(started.storeFound, true);
      assert.match(started.actionId ?? "", /^[0-9a-f-]{36}$/);

      const finished = await module.controlPlaneAudit.finishConfigMutation({
        dbPath: seededStore.dbPath,
        actionId: started.actionId,
        status: "succeeded",
        targetId: "route-alpha",
        result: {
          changed: true
        },
        metadata: {
          phase: "seeded-ledger"
        }
      });
      assert.deepEqual(finished, {
        dbPath: seededStore.dbPath,
        storeFound: true
      });

      const ledger = await module.ledger.list({
        dbPath: seededStore.dbPath,
        filters: {
          targetId: "route-alpha",
          operation: "routes_update",
          limit: 10
        }
      });
      assert.equal(ledger.dbPath, seededStore.dbPath);
      assert.equal(ledger.storeFound, true);
      assert.equal(ledger.events.length, 1);
      assert.equal(ledger.events[0]?.id, started.actionId);
      assert.equal(ledger.events[0]?.source_surface, "cli");
      assert.equal(ledger.events[0]?.actor_kind, "operator");
      assert.equal(ledger.events[0]?.operation, "routes_update");
      assert.equal(ledger.events[0]?.status, "succeeded");
      assert.equal(ledger.events[0]?.target_kind, "route");
      assert.equal(ledger.events[0]?.target_id, "route-alpha");
      assert.deepEqual(JSON.parse(ledger.events[0]?.result_json ?? "{}"), { changed: true });
      assert.deepEqual(JSON.parse(ledger.events[0]?.metadata_json ?? "{}"), { phase: "seeded-ledger" });

      const ledgerEvent = await module.ledger.show({
        dbPath: seededStore.dbPath,
        ledgerEventId: started.actionId!
      });
      assert.equal(ledgerEvent.dbPath, seededStore.dbPath);
      assert.equal(ledgerEvent.storeFound, true);
      assert.deepEqual(ledgerEvent.event, ledger.events[0]);

      const benchmarkRuns = await module.benchmarkHistory.list({
        dbPath: seededStore.dbPath,
        limit: 10
      });
      assert.equal(benchmarkRuns.dbPath, seededStore.dbPath);
      assert.equal(benchmarkRuns.storeFound, true);
      assert.equal(benchmarkRuns.runs.length, 1);
      assert.equal(benchmarkRuns.runs[0]?.run.id, SEEDED_BENCHMARK_RUN_ID);
      assert.deepEqual(benchmarkRuns.runs[0]?.summary, {
        total_samples: 1,
        measured_samples: 1,
        warmup_samples: 0,
        success_count: 1,
        failed_count: 0,
        average_latency_ms: 90,
        min_latency_ms: 90,
        max_latency_ms: 90,
        average_ttft_ms: 20,
        average_duration_ms: 90
      });

      const benchmarkRun = await module.benchmarkHistory.show({
        dbPath: seededStore.dbPath,
        runId: SEEDED_BENCHMARK_RUN_ID
      });
      assert.equal(benchmarkRun.dbPath, seededStore.dbPath);
      assert.equal(benchmarkRun.storeFound, true);
      assert.equal(benchmarkRun.run?.id, SEEDED_BENCHMARK_RUN_ID);
      assert.equal(benchmarkRun.summary?.success_count, 1);
      assert.equal(benchmarkRun.samples.length, 1);
      assert.equal(benchmarkRun.samples[0]?.request_execution_id, SEEDED_REQUEST_ID);
      assert.equal(benchmarkRun.samples[0]?.route_id, "route-alpha");
      assert.equal(benchmarkRun.samples[0]?.latency_ms, 90);

      const persistedCost = await module.optimizationReports.persistCost({
        dbPath: seededStore.dbPath,
        report: minimalOptimizeReport("cost"),
        candidateRoutes: [SEEDED_CANDIDATE_ROUTE],
        requestedRoutes: ["route-alpha"],
        referenceTokens: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0
        },
        createdBy: "switchmaxxer module contract test",
        runId: "opt-module-contract-cost",
        now: new Date("2026-05-12T12:00:00.000Z")
      });
      assert.equal(persistedCost.dbPath, seededStore.dbPath);
      assert.equal(persistedCost.storeFound, true);
      assert.equal(persistedCost.report?.run.run_id, "opt-module-contract-cost");
      assert.equal(persistedCost.report?.run.persisted, true);
      assert.equal(persistedCost.report?.store_path, seededStore.dbPath);

      const optimizationRuns = await module.optimizationHistory.list({
        dbPath: seededStore.dbPath,
        limit: 10
      });
      assert.equal(optimizationRuns.dbPath, seededStore.dbPath);
      assert.equal(optimizationRuns.storeFound, true);
      assert.equal(optimizationRuns.runs.length, 1);
      assert.equal(optimizationRuns.runs[0]?.id, "opt-module-contract-cost");
      assert.equal(optimizationRuns.runs[0]?.objective, "cost");
      assert.equal(optimizationRuns.runs[0]?.winner_route, "module-contract-route");
      assert.deepEqual(JSON.parse(optimizationRuns.runs[0]?.settings_json ?? "{}"), {
        requested_routes: ["route-alpha"],
        reference_tokens: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_write_tokens: 0
        }
      });

      const optimizationRun = await module.optimizationHistory.show({
        dbPath: seededStore.dbPath,
        runId: "opt-module-contract-cost"
      });
      assert.equal(optimizationRun.dbPath, seededStore.dbPath);
      assert.equal(optimizationRun.storeFound, true);
      assert.deepEqual(optimizationRun.run, optimizationRuns.runs[0]);

      const persistedLatency = await module.optimizationReports.persistLatency({
        dbPath: seededStore.dbPath,
        report: minimalOptimizeReport("latency"),
        candidateRoutes: [SEEDED_CANDIDATE_ROUTE],
        requestedRoutes: ["route-alpha"],
        createdBy: "switchmaxxer module contract test",
        benchmarkRunId: SEEDED_BENCHMARK_RUN_ID,
        settings: {
          path_mode: "direct",
          iterations: 1
        },
        runId: "opt-module-contract-latency",
        now: new Date("2026-05-12T12:01:00.000Z")
      });
      assert.equal(persistedLatency.dbPath, seededStore.dbPath);
      assert.equal(persistedLatency.storeFound, true);
      assert.equal(persistedLatency.report?.run.run_id, "opt-module-contract-latency");
      assert.equal(persistedLatency.report?.run.persisted, true);
      assert.equal(persistedLatency.report?.store_path, seededStore.dbPath);

      const optimizationRunsWithLatency = await module.optimizationHistory.list({
        dbPath: seededStore.dbPath,
        limit: 10
      });
      assert.equal(optimizationRunsWithLatency.runs.length, 2);
      assert.deepEqual(
        optimizationRunsWithLatency.runs.map((run) => ({
          id: run.id,
          objective: run.objective,
          benchmark_run_id: run.benchmark_run_id
        })),
        [
          {
            id: "opt-module-contract-latency",
            objective: "latency",
            benchmark_run_id: SEEDED_BENCHMARK_RUN_ID
          },
          {
            id: "opt-module-contract-cost",
            objective: "cost",
            benchmark_run_id: null
          }
        ]
      );
      assert.deepEqual(JSON.parse(optimizationRunsWithLatency.runs[0]?.settings_json ?? "{}"), {
        requested_routes: ["route-alpha"],
        path_mode: "direct",
        iterations: 1
      });

      const latencyRun = await module.optimizationHistory.show({
        dbPath: seededStore.dbPath,
        runId: "opt-module-contract-latency"
      });
      assert.equal(latencyRun.dbPath, seededStore.dbPath);
      assert.equal(latencyRun.storeFound, true);
      assert.deepEqual(latencyRun.run, optimizationRunsWithLatency.runs[0]);
      assert.equal(
        (await module.benchmarkHistory.show({
          dbPath: seededStore.dbPath,
          runId: SEEDED_BENCHMARK_RUN_ID
        })).run?.id,
        SEEDED_BENCHMARK_RUN_ID
      );

      const benchmarkDelete = await module.benchmarkHistory.deleteRun({
        dbPath: seededStore.dbPath,
        runId: SEEDED_BENCHMARK_RUN_ID
      });
      assert.deepEqual(benchmarkDelete, {
        dbPath: seededStore.dbPath,
        storeFound: true,
        result: {
          benchmark_runs_deleted: 1,
          benchmark_samples_deleted: 1,
          total_deleted: 2
        }
      });
      assert.equal(
        (await module.benchmarkHistory.show({
          dbPath: seededStore.dbPath,
          runId: SEEDED_BENCHMARK_RUN_ID
        })).run,
        null
      );
      const traceAfterBenchmarkDelete = await module.trace.show({
        dbPath: seededStore.dbPath,
        traceId: SEEDED_REQUEST_ID
      });
      assert.equal(traceAfterBenchmarkDelete.requestExecution?.request_id, SEEDED_REQUEST_ID);
      assert.deepEqual(traceAfterBenchmarkDelete.benchmarkSamples, []);

      const optimizationDelete = await module.optimizationHistory.deleteRun({
        dbPath: seededStore.dbPath,
        runId: "opt-module-contract-cost"
      });
      assert.deepEqual(optimizationDelete, {
        dbPath: seededStore.dbPath,
        storeFound: true,
        result: {
          optimization_runs_deleted: 1,
          config_mutation_events_deleted: 0,
          config_snapshots_deleted: 0,
          total_deleted: 1
        }
      });
      assert.equal(
        (await module.optimizationHistory.show({
          dbPath: seededStore.dbPath,
          runId: "opt-module-contract-cost"
        })).run,
        null
      );
      assert.equal(
        (await module.optimizationHistory.show({
          dbPath: seededStore.dbPath,
          runId: "opt-module-contract-latency"
        })).run?.id,
        "opt-module-contract-latency"
      );
      assert.equal(
        (await module.ledger.show({
          dbPath: seededStore.dbPath,
          ledgerEventId: started.actionId!
        })).event?.id,
        started.actionId
      );

      const retention = await module.retention.pruneOlderThan({
        dbPath: seededStore.dbPath,
        cutoffIso: CUTOFF_ISO
      });
      assert.deepEqual(retention, {
        dbPath: seededStore.dbPath,
        storeFound: true,
        result: {
          status: "completed",
          cutoff_at: CUTOFF_ISO,
          failure_stage: null,
          failure_message: null,
          observations_deleted: 7,
          request_executions_deleted: 1,
          benchmark_runs_deleted: 0,
          benchmark_samples_deleted: 0,
          cost_facts_deleted: 0,
          optimization_facts_deleted: 0,
          control_plane_action_events_deleted: 0,
          config_mutation_events_deleted: 0,
          config_snapshots_deleted: 0,
          total_deleted: 8
        }
      });
      assert.equal(
        (await module.trace.show({
          dbPath: seededStore.dbPath,
          traceId: SEEDED_REQUEST_ID
        })).requestExecution,
        null
      );
      assert.equal(
        (await module.ledger.show({
          dbPath: seededStore.dbPath,
          ledgerEventId: started.actionId!
        })).event?.id,
        started.actionId
      );
    } finally {
      seededStore.cleanup();
    }
  });
}
