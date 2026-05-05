import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  catalogPathForConfigForTests,
  copyExampleConfigPairForTests,
  readJsonForTests,
  writeSecureJsonForTests
} from "../../../config/config-file.test-support";
import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import { loadCliReadModel } from "../../../config/read-model";
import { closeObservabilityStore, bootstrapObservabilityStore } from "../../store";
import { ObservabilityService } from "../../service";
import { runCostOptimizeAndPersist } from "./optimize-report-builder";
import {
  runOptimizeApplyMutation,
  runOptimizeRestoreMutation
} from "./optimize-orchestrator";
import { test } from "../../observability.test-support";

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

function throwConfigWriteFailure(): never {
  throw new Error("simulated config write failure");
}

function countConfigSnapshots(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM config_snapshots").get() as { count: number | bigint };
  return Number(row.count);
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

void test("shared optimize mutation service applies and restores provider changes with Ledger links", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-orchestrator-"));
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
    const optimizeReadModel = loadCliReadModel(configPath);
    const optimizeResult = runCostOptimizeAndPersist({
      readModel: optimizeReadModel,
      modelId: "gpt-4o-mini",
      requestedRoutes: null,
      referenceTokens: REFERENCE_TOKENS,
      service,
      storePath: dbPath,
      createdBy: "test-suite",
      runId: "optimize-service-run"
    });
    if (!optimizeResult.ok) {
      throw new Error(optimizeResult.failure.message);
    }
    assert.equal(optimizeResult.report.winner.route_id, "openrouter-gpt-4o-mini");

    const dryRunResult = runOptimizeApplyMutation({
      service,
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection,
      sourceSurface: "cli",
      createdBy: "test-suite apply",
      actorKind: "operator",
      runId: "optimize-service-run",
      targetRouteId: "gpt-4o-mini",
      dryRun: true
    });
    assert.equal(dryRunResult.ok, true);
    if (!dryRunResult.ok) {
      return;
    }
    assert.equal(dryRunResult.deferred, false);
    assert.equal("complete" in dryRunResult, false);
    assert.equal(dryRunResult.view.changed, true);
    assert.equal(dryRunResult.view.action_id, null);
    assert.deepEqual((readJsonForTests(catalogPath)["routes"] as Record<string, unknown>)["gpt-4o-mini"], originalTargetRoute);
    const dryRunLedger = service.controlPlaneActions
      .listRecent(10)
      .find((entry) => entry.operation === "optimize_apply" && entry.status === "dry_run_succeeded");
    assert.equal(dryRunLedger?.target_id, "gpt-4o-mini");
    assert.equal(dryRunLedger?.optimization_run_id, "optimize-service-run");
    assert.equal(dryRunLedger?.mutation_event_id, null);

    const failedApplyResult = runOptimizeApplyMutation({
      service,
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: throwConfigWriteFailure,
      getMutableConfigSection,
      sourceSurface: "cli",
      createdBy: "test-suite apply",
      actorKind: "operator",
      runId: "optimize-service-run",
      targetRouteId: "gpt-4o-mini",
      dryRun: false
    });
    assert.equal(failedApplyResult.ok, false);
    if (failedApplyResult.ok) {
      return;
    }
    assert.equal(failedApplyResult.code, APP_ERROR_CODES.optimizeError);
    assert.match(failedApplyResult.message, /simulated config write failure/);
    assert.equal(countConfigSnapshots(store.db), 0);
    assert.deepEqual((readJsonForTests(catalogPath)["routes"] as Record<string, unknown>)["gpt-4o-mini"], originalTargetRoute);
    const failedApplyLedger = service.controlPlaneActions
      .listRecent(10)
      .find((entry) => entry.operation === "optimize_apply" && entry.status === "failed");
    assert.equal(failedApplyLedger?.target_id, "gpt-4o-mini");
    assert.equal(failedApplyLedger?.mutation_event_id, null);

    const applyResult = runOptimizeApplyMutation({
      service,
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection,
      sourceSurface: "cli",
      createdBy: "test-suite apply",
      actorKind: "operator",
      runId: "optimize-service-run",
      targetRouteId: "gpt-4o-mini",
      dryRun: false,
      deferLedgerCompletion: true
    });
    assert.equal(applyResult.ok, true);
    if (!applyResult.ok) {
      return;
    }
    assert.equal(applyResult.deferred, true);
    const applyView = applyResult.complete({
      warnings: ["post-action warning for test"],
      includePostActionResult: true
    });
    assert.equal(applyView.changed, true);
    assert.equal(applyView.action_id !== null, true);
    assert.equal(applyView.mutation.from, "openai_direct");
    assert.equal(applyView.mutation.to, "openrouter");
    assert.equal(applyView.mutation.service_provider.changed, true);
    assert.equal(applyView.mutation.service_provider.from, "openai_direct");
    assert.equal(applyView.mutation.service_provider.to, "openrouter");
    assert.equal(applyView.mutation.provider_model_id.changed, true);
    assert.equal(applyView.mutation.provider_model_id.from, "gpt-4o-mini");
    assert.equal(applyView.mutation.provider_model_id.to, "openai/gpt-4o-mini");
    assert.equal(applyView.mutation.cost.changed, true);
    assert.deepEqual(applyView.mutation.cost.from, {
      input: 1,
      output: 1,
      cache_read: 1,
      cache_write: 1
    });
    assert.deepEqual(applyView.mutation.cost.to, {
      input: 0.1,
      output: 0.1,
      cache_read: 0.1,
      cache_write: 0.1
    });
    assert.equal(applyView.after.service_provider, "openrouter");
    assert.equal(applyView.after.provider_model_id, "openai/gpt-4o-mini");
    assert.deepEqual(applyView.after.cost, {
      input: 0.1,
      output: 0.1,
      cache_read: 0.1,
      cache_write: 0.1
    });
    assert.deepEqual(applyView.warnings, ["post-action warning for test"]);
    const applyActionId = applyView.action_id ?? "";
    const applyEvent = service.configMutations.getEvent(applyActionId);
    const applyLedger = service.controlPlaneActions
      .listRecent(10)
      .find((entry) => entry.mutation_event_id === applyActionId);
    assert.equal(applyEvent?.event.operation, "optimize_apply");
    assert.equal(applyEvent?.event.target_id, "gpt-4o-mini");
    assert.equal(applyEvent?.event.optimization_run_id, "optimize-service-run");
    assert.equal(applyEvent?.event.parent_event_id, null);
    assert.equal(applyEvent?.event.snapshot_id, applyView.snapshot?.snapshot_id);
    assert.equal(applyLedger?.operation, "optimize_apply");
    assert.equal(applyLedger?.status, "succeeded");
    assert.equal(applyLedger?.target_id, "gpt-4o-mini");
    assert.equal(applyLedger?.optimization_run_id, "optimize-service-run");

    const afterApplyRoute = (readJsonForTests(catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.equal(afterApplyRoute?.["service_provider"], "openrouter");
    assert.equal(afterApplyRoute?.["provider_model_id"], "openai/gpt-4o-mini");
    assert.deepEqual(afterApplyRoute?.["cost"], {
      input: 0.1,
      output: 0.1,
      cache_read: 0.1,
      cache_write: 0.1
    });
    assert.equal(countConfigSnapshots(store.db), 1);

    const failedRestoreResult = runOptimizeRestoreMutation({
      service,
      dbPath,
      configPath,
      readModel: loadCliReadModel(configPath),
      loadReadModel: () => loadCliReadModel(configPath),
      mutateConfigDocument: throwConfigWriteFailure,
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
    assert.equal(failedRestoreResult.ok, false);
    if (failedRestoreResult.ok) {
      return;
    }
    assert.equal(failedRestoreResult.code, APP_ERROR_CODES.optimizeError);
    assert.match(failedRestoreResult.message, /simulated config write failure/);
    assert.equal(countConfigSnapshots(store.db), 1);
    const failedRestoreLedger = service.controlPlaneActions
      .listRecent(10)
      .find((entry) => entry.operation === "optimize_restore" && entry.status === "failed");
    assert.equal(failedRestoreLedger?.target_id, "gpt-4o-mini");
    assert.equal(failedRestoreLedger?.mutation_event_id, null);
    assert.equal(
      (readJsonForTests(catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"]?.["service_provider"],
      "openrouter"
    );

    const restoreResult = runOptimizeRestoreMutation({
      service,
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
    assert.equal(restoreResult.ok, true);
    if (!restoreResult.ok) {
      return;
    }
    assert.equal(restoreResult.deferred, false);
    assert.equal("complete" in restoreResult, false);
    assert.equal(restoreResult.view.changed, true);
    assert.equal(restoreResult.view.target_route, "gpt-4o-mini");
    assert.equal(restoreResult.view.run_id, "optimize-service-run");
    assert.equal(restoreResult.view.mutation.from, "openrouter");
    assert.equal(restoreResult.view.mutation.to, "openai_direct");
    assert.equal(restoreResult.view.mutation.provider_model_id.from, "openai/gpt-4o-mini");
    assert.equal(restoreResult.view.mutation.provider_model_id.to, "gpt-4o-mini");
    assert.deepEqual(restoreResult.view.mutation.cost.from, {
      input: 0.1,
      output: 0.1,
      cache_read: 0.1,
      cache_write: 0.1
    });
    assert.deepEqual(restoreResult.view.mutation.cost.to, {
      input: 1,
      output: 1,
      cache_read: 1,
      cache_write: 1
    });
    assert.equal(restoreResult.view.restore_point.original_provider_model_id, "gpt-4o-mini");
    assert.deepEqual(restoreResult.view.restore_point.original_cost, {
      input: 1,
      output: 1,
      cache_read: 1,
      cache_write: 1
    });
    const restoreActionId = restoreResult.view.action_id ?? "";
    const restoreEvent = service.configMutations.getEvent(restoreActionId);
    const restoreLedger = service.controlPlaneActions
      .listRecent(10)
      .find((entry) => entry.mutation_event_id === restoreActionId);
    assert.equal(restoreEvent?.event.operation, "optimize_restore");
    assert.equal(restoreEvent?.event.target_id, "gpt-4o-mini");
    assert.equal(restoreEvent?.event.optimization_run_id, "optimize-service-run");
    assert.equal(restoreEvent?.event.parent_event_id, applyActionId);
    assert.equal(restoreLedger?.operation, "optimize_restore");
    assert.equal(restoreLedger?.status, "succeeded");
    assert.equal(restoreLedger?.source_surface, "mcp");
    assert.equal(restoreLedger?.target_id, "gpt-4o-mini");
    assert.equal(restoreLedger?.optimization_run_id, "optimize-service-run");

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
