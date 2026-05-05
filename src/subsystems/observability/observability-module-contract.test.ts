import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  catalogPathForConfigForTests,
  copyExampleConfigPairForTests,
  readJsonForTests,
  writeSecureJsonForTests
} from "../config/config-file.test-support";
import { loadCliReadModel } from "../config/read-model";
import {
  createOstrichBenchmarkHistoryPort,
  createOstrichBenchmarkRunPort,
  createOstrichControlPlaneAuditPort,
  createOstrichLedgerPort,
  createOstrichObservabilityModule,
  createOstrichOptimizeMutationPort,
  createOstrichOptimizationHistoryPort,
  createOstrichOptimizationReportPort,
  createOstrichRetentionPort,
  createOstrichTraceMaintenancePort,
  createOstrichTraceQueryPort,
  defaultObservabilityModule,
  type ObservabilityModule
} from "./observability-module";
import { dispatchObservabilityIpcRequest } from "./observability-ipc-dispatcher";
import {
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  type ObservabilityIpcOperation,
  type ObservabilityIpcRequest
} from "./observability-ipc-contract";
import { ObservabilityService } from "./service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import type { ObservabilityRuntimeHandle } from "./runtime-loader";
import { seedSuccessfulRequest } from "./test-helpers";
import {
  registerObservabilityModuleMissingStoreContractTests,
  registerObservabilityModuleSeededStoreContractTests
} from "./observability-module-contract.test-support";
import { runCostOptimizeAndPersist } from "./optimize-report-builder";
import { test } from "./observability.test-support";

const closedHandles: Array<ObservabilityRuntimeHandle | null> = [];

const REFERENCE_TOKENS = {
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_tokens: 0,
  cache_write_tokens: 0
};

function mutateCatalogDocument(configPath: string | undefined, mutator: (document: Record<string, unknown>) => void): void {
  if (typeof configPath !== "string") {
    throw new Error("Test config path is required.");
  }

  const catalogPath = catalogPathForConfigForTests(configPath);
  const document = readJsonForTests(catalogPath);
  mutator(document);
  writeSecureJsonForTests(catalogPath, document);
}

function getMutableConfigSection(
  document: Record<string, unknown>,
  sectionName: "models" | "service_providers" | "routes"
): Record<string, unknown> {
  const section = document[sectionName];
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    throw new Error(`Test catalog must contain a '${sectionName}' object.`);
  }

  return section as Record<string, unknown>;
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (typeof previousValue === "string") {
    process.env[name] = previousValue;
  } else {
    delete process.env[name];
  }
}

async function dispatchContractPort(
  targetModule: ObservabilityModule,
  operation: ObservabilityIpcOperation,
  options: { readonly dbPath: string } & Record<string, unknown>
): Promise<unknown> {
  const { dbPath, ...payload } = options;
  const response = await dispatchObservabilityIpcRequest(targetModule, {
    id: `module-contract-ipc-${operation}`,
    operation,
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath
    },
    payload
  } as ObservabilityIpcRequest);

  if (!response.ok) {
    throw new Error(`IPC contract dispatch failed for ${operation}: ${response.error.message}`);
  }

  return response.result;
}

function createIpcDispatchObservabilityModule(targetModule: ObservabilityModule): ObservabilityModule {
  const unwrap = <T>(operation: ObservabilityIpcOperation, options: { readonly dbPath: string } & Record<string, unknown>) =>
    dispatchContractPort(targetModule, operation, options) as T;

  return createOstrichObservabilityModule({
    configure: (options) => targetModule.configure(options),
    bootstrap: () => targetModule.bootstrap(),
    pruneRetentionNow: (source) => targetModule.pruneRetentionNow(source),
    getService: () => targetModule.getService(),
    getDbPath: () => targetModule.getDbPath(),
    recordGatewayObservation: (input) => targetModule.recordGatewayObservation(input),
    recordGatewayFailureObservation: (stage, context, reason, route, attributes) =>
      targetModule.recordGatewayFailureObservation(stage, context, reason, route, attributes),
    shutdown: async () => await targetModule.shutdown(),
    trace: {
      list: (options) => unwrap("trace.list", options),
      listObservations: (options) => unwrap("trace.listObservations", options),
      getStats: (options) => unwrap("trace.getStats", options),
      show: (options) => unwrap("trace.show", options)
    },
    traceMaintenance: {
      verify: (options) => unwrap("trace.verify", options),
      repair: (options) => unwrap("trace.repair", options)
    },
    retention: {
      pruneOlderThan: (options) => unwrap("retention.pruneOlderThan", options)
    },
    ledger: {
      list: (options) => unwrap("ledger.list", options),
      show: (options) => unwrap("ledger.show", options)
    },
    controlPlaneAudit: {
      startConfigMutation: (options) => unwrap("controlPlaneAudit.startConfigMutation", options),
      finishConfigMutation: (options) => unwrap("controlPlaneAudit.finishConfigMutation", options)
    },
    benchmarkRuns: {
      run: async (options) => await dispatchContractPort(targetModule, "benchmarkRuns.run", options) as never
    },
    benchmarkHistory: {
      list: (options) => unwrap("benchmarkHistory.list", options),
      show: (options) => unwrap("benchmarkHistory.show", options),
      pruneOlderThan: (options) => unwrap("benchmarkHistory.pruneOlderThan", options),
      deleteRun: (options) => unwrap("benchmarkHistory.deleteRun", options),
      clear: (options) => unwrap("benchmarkHistory.clear", options)
    },
    optimizationReports: {
      persistCost: (options) => unwrap("optimizationReports.persistCost", options),
      persistLatency: (options) => unwrap("optimizationReports.persistLatency", options)
    },
    optimizeMutations: {
      apply: (options) => unwrap("optimizeMutations.apply", options),
      restore: (options) => unwrap("optimizeMutations.restore", options)
    },
    optimizationHistory: {
      list: (options) => unwrap("optimizationHistory.list", options),
      show: (options) => unwrap("optimizationHistory.show", options),
      pruneOlderThan: (options) => unwrap("optimizationHistory.pruneOlderThan", options),
      deleteRun: (options) => unwrap("optimizationHistory.deleteRun", options),
      clear: (options) => unwrap("optimizationHistory.clear", options)
    }
  });
}

const missingStoreDeps = {
  open: () => null,
  openExisting: () => null,
  close: (handle: ObservabilityRuntimeHandle | null) => {
    closedHandles.push(handle);
  }
};

function createModuleContractSeededStore(requestId: string, tempPrefix: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), tempPrefix));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });

  try {
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, requestId);
    service.benchmarks.createRun({
      id: "bench-module-contract-seeded",
      name: "module-contract-benchmark",
      created_at: "2026-05-12T11:00:00.000Z",
      created_by: "switchmaxxer module contract test",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        requested_path_mode: "direct",
        effective_paths: ["direct"],
        skipped_paths: [],
        warnings: []
      }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-sample-module-contract-seeded",
      benchmark_run_id: "bench-module-contract-seeded",
      request_execution_id: requestId,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-05-12T11:00:00.000Z",
      completed_at: "2026-05-12T11:00:00.090Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 90,
      ttft_ms: 20,
      duration_ms: 90,
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      estimated_cost_micros: 1234,
      is_warmup: 0,
      score_value: 90,
      score_scale: "ms",
      score_direction: "lower_is_better",
      score_source: "benchmark",
      score_method: "latency_ms",
      scored_at: "2026-05-12T11:00:00.090Z",
      score_json: JSON.stringify({
        path: "direct"
      })
    });
  } finally {
    closeObservabilityStore(store);
  }

  return {
    dbPath,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

registerObservabilityModuleMissingStoreContractTests({
  name: "Ostrich",
  createModule: () => {
    closedHandles.length = 0;

    return createOstrichObservabilityModule({
      configure: () => {},
      bootstrap: () => {},
      pruneRetentionNow: () => {},
      getService: () => null,
      getDbPath: () => null,
      recordGatewayObservation: () => {},
      recordGatewayFailureObservation: () => {},
      shutdown: async () => {},
      trace: createOstrichTraceQueryPort(missingStoreDeps),
      traceMaintenance: createOstrichTraceMaintenancePort(missingStoreDeps),
      retention: createOstrichRetentionPort(missingStoreDeps),
      ledger: createOstrichLedgerPort(missingStoreDeps),
      controlPlaneAudit: createOstrichControlPlaneAuditPort(missingStoreDeps),
      benchmarkRuns: createOstrichBenchmarkRunPort(missingStoreDeps),
      benchmarkHistory: createOstrichBenchmarkHistoryPort(missingStoreDeps),
      optimizationReports: createOstrichOptimizationReportPort(missingStoreDeps),
      optimizeMutations: createOstrichOptimizeMutationPort(missingStoreDeps),
      optimizationHistory: createOstrichOptimizationHistoryPort(missingStoreDeps)
    });
  },
  getClosedHandleCount: () => closedHandles.length,
  expectedClosedHandleCount: 26
});

registerObservabilityModuleMissingStoreContractTests({
  name: "Ostrich IPC dispatcher",
  createModule: () => {
    closedHandles.length = 0;

    return createIpcDispatchObservabilityModule(
      createOstrichObservabilityModule({
        configure: () => {},
        bootstrap: () => {},
        pruneRetentionNow: () => {},
        getService: () => null,
        getDbPath: () => null,
        recordGatewayObservation: () => {},
        recordGatewayFailureObservation: () => {},
        shutdown: async () => {},
        trace: createOstrichTraceQueryPort(missingStoreDeps),
        traceMaintenance: createOstrichTraceMaintenancePort(missingStoreDeps),
        retention: createOstrichRetentionPort(missingStoreDeps),
        ledger: createOstrichLedgerPort(missingStoreDeps),
        controlPlaneAudit: createOstrichControlPlaneAuditPort(missingStoreDeps),
        benchmarkRuns: createOstrichBenchmarkRunPort(missingStoreDeps),
        benchmarkHistory: createOstrichBenchmarkHistoryPort(missingStoreDeps),
        optimizationReports: createOstrichOptimizationReportPort(missingStoreDeps),
        optimizeMutations: createOstrichOptimizeMutationPort(missingStoreDeps),
        optimizationHistory: createOstrichOptimizationHistoryPort(missingStoreDeps)
      })
    );
  },
  getClosedHandleCount: () => closedHandles.length,
  expectedClosedHandleCount: 26
});

registerObservabilityModuleSeededStoreContractTests({
  name: "Ostrich",
  createModule: () => defaultObservabilityModule,
  createSeededStore: (requestId) =>
    createModuleContractSeededStore(requestId, "switchmaxxer-observability-module-contract-")
});

registerObservabilityModuleSeededStoreContractTests({
  name: "Ostrich IPC dispatcher",
  createModule: () => createIpcDispatchObservabilityModule(defaultObservabilityModule),
  createSeededStore: (requestId) =>
    createModuleContractSeededStore(requestId, "switchmaxxer-observability-ipc-module-contract-")
});

void test("Ostrich module contract applies and restores optimize mutations with Ledger links", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-module-mutation-contract-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  let store: ReturnType<typeof bootstrapObservabilityStore> | null = null;

  try {
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    copyExampleConfigPairForTests(configPath);

    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    routes["gpt-4o-mini"] = {
      ...(routes["gpt-4o-mini"] ?? {}),
      service_provider: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      cost: {
        input: 1,
        output: 1,
        cache_read: 1,
        cache_write: 1
      }
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      service_provider: "openrouter",
      provider_model_id: "openai/gpt-4o-mini",
      cost: {
        input: 0.1,
        output: 0.1,
        cache_read: 0.1,
        cache_write: 0.1
      }
    };
    const originalTargetRoute = structuredClone(routes["gpt-4o-mini"]);
    writeSecureJsonForTests(catalogPath, catalog);
    chmodSync(configPath, 0o600);

    store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const optimizeResult = runCostOptimizeAndPersist({
      readModel: loadCliReadModel(configPath),
      modelId: "gpt-4o-mini",
      requestedRoutes: null,
      referenceTokens: REFERENCE_TOKENS,
      service,
      storePath: dbPath,
      createdBy: "test-suite",
      runId: "optimize-module-contract-run"
    });
    if (!optimizeResult.ok) {
      throw new Error(optimizeResult.failure.message);
    }
    assert.equal(optimizeResult.report.winner.route_id, "openrouter-gpt-4o-mini");
    closeObservabilityStore(store);
    store = null;

    const applyResult = defaultObservabilityModule.optimizeMutations.apply({
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection,
      sourceSurface: "cli",
      createdBy: "test-suite apply",
      actorKind: "operator",
      runId: "optimize-module-contract-run",
      targetRouteId: "gpt-4o-mini",
      dryRun: false,
      deferLedgerCompletion: true
    });
    assert.equal(applyResult.dbPath, dbPath);
    assert.equal(applyResult.storeFound, true);
    assert.equal(applyResult.result?.ok, true);
    if (!applyResult.result?.ok) {
      return;
    }
    assert.equal(applyResult.result.deferred, true);
    const applyView = applyResult.result.complete({
      warnings: ["module contract warning"],
      includePostActionResult: true
    });
    assert.equal(applyView.changed, true);
    assert.equal(applyView.target_route, "gpt-4o-mini");
    assert.equal(applyView.run_id, "optimize-module-contract-run");
    assert.equal(applyView.mutation.service_provider.from, "openai_direct");
    assert.equal(applyView.mutation.service_provider.to, "openrouter");
    assert.equal(applyView.mutation.provider_model_id.from, "gpt-4o-mini");
    assert.equal(applyView.mutation.provider_model_id.to, "openai/gpt-4o-mini");
    assert.deepEqual(applyView.warnings, ["module contract warning"]);

    const applyActionId = applyView.action_id ?? "";
    const afterApplyRoute = (readJsonForTests(catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.equal(afterApplyRoute?.["service_provider"], "openrouter");
    assert.equal(afterApplyRoute?.["provider_model_id"], "openai/gpt-4o-mini");

    const applyLedger = defaultObservabilityModule.ledger
      .list({
        dbPath,
        filters: {
          operation: "optimize_apply",
          targetId: "gpt-4o-mini",
          limit: 10
        }
      })
      .events.find((entry) => entry.mutation_event_id === applyActionId);
    assert.equal(applyLedger?.status, "succeeded");
    assert.equal(applyLedger?.optimization_run_id, "optimize-module-contract-run");

    const restoreResult = defaultObservabilityModule.optimizeMutations.restore({
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection,
      sourceSurface: "mcp",
      createdBy: "test-suite restore",
      actorKind: "agent",
      sessionId: "test-session",
      selector: {
        mode: "action",
        actionId: applyActionId
      },
      dryRun: false
    });
    assert.equal(restoreResult.dbPath, dbPath);
    assert.equal(restoreResult.storeFound, true);
    assert.equal(restoreResult.result?.ok, true);
    if (!restoreResult.result?.ok) {
      return;
    }
    assert.equal(restoreResult.result.deferred, false);
    assert.equal(restoreResult.result.view.changed, true);
    assert.equal(restoreResult.result.view.target_route, "gpt-4o-mini");
    assert.equal(restoreResult.result.view.run_id, "optimize-module-contract-run");
    assert.equal(restoreResult.result.view.mutation.service_provider.from, "openrouter");
    assert.equal(restoreResult.result.view.mutation.service_provider.to, "openai_direct");
    assert.equal(restoreResult.result.view.mutation.provider_model_id.from, "openai/gpt-4o-mini");
    assert.equal(restoreResult.result.view.mutation.provider_model_id.to, "gpt-4o-mini");

    const restoreActionId = restoreResult.result.view.action_id ?? "";
    const restoreLedger = defaultObservabilityModule.ledger
      .list({
        dbPath,
        filters: {
          operation: "optimize_restore",
          targetId: "gpt-4o-mini",
          limit: 10
        }
      })
      .events.find((entry) => entry.mutation_event_id === restoreActionId);
    assert.equal(restoreLedger?.status, "succeeded");
    assert.equal(restoreLedger?.source_surface, "mcp");
    assert.equal(restoreLedger?.optimization_run_id, "optimize-module-contract-run");

    const afterRestoreRoute = (readJsonForTests(catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.deepEqual(afterRestoreRoute, originalTargetRoute);
  } finally {
    if (store) {
      closeObservabilityStore(store);
    }
    restoreEnv("SWITCHMAXXER_OPENAI_API_KEY", previousOpenAiKey);
    restoreEnv("SWITCHMAXXER_OPENROUTER_API_KEY", previousOpenRouterKey);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
