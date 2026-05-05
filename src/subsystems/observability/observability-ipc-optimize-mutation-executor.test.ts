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
import type {
  ObservabilityExternalOptimizeApplyCommand,
  ObservabilityExternalOptimizeRestoreCommand,
  ObservabilityIpcResultByOperation
} from "./observability-ipc-contract";
import { OBSERVABILITY_IPC_ERROR_CODES } from "./observability-ipc-contract";
import {
  beginPlannedExternalOptimizeApplyMutationAgainstModule,
  beginPlannedExternalOptimizeRestoreMutationAgainstModule,
  executeExternalOptimizeApplyMutationAgainstModule,
  executeExternalOptimizeMutationCommand,
  executeExternalOptimizeRestoreMutationAgainstModule,
  executePlannedExternalOptimizeMutationAgainstModule
} from "./observability-ipc-optimize-mutation-executor";
import {
  buildExternalOptimizeApplyCommandFromPlan,
  buildExternalOptimizeRestoreCommandFromPlan
} from "./observability-ipc-optimize-mutation-plan";
import { validateObservabilityIpcOperationResponseResult } from "./observability-ipc-result-validation";
import { defaultObservabilityModule, type ObservabilityModule } from "./observability-module";
import {
  digestOptimizeMutationCommand,
  OptimizeMutationIdempotencyRepository
} from "./optimize-mutation-idempotency";
import { runCostOptimizeAndPersist } from "./optimize-report-builder";
import { ObservabilityService } from "./service";
import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import type { CliReadModel } from "../../platform/types";
import { test } from "./observability.test-support";

const DB_PATH = "/tmp/switchmaxxer-ipc-optimize-mutation-executor.sqlite";
const REFERENCE_TOKENS = {
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_tokens: 0,
  cache_write_tokens: 0
};
const OPENAI_DIRECT_COST = {
  input: 1,
  output: 1,
  cache_read: 1,
  cache_write: 1
};
const OPENROUTER_COST = {
  input: 0.1,
  output: 0.1,
  cache_read: 0.1,
  cache_write: 0.1
};

function validExternalApplyCommand(
  overrides: Partial<ObservabilityExternalOptimizeApplyCommand> = {}
): ObservabilityExternalOptimizeApplyCommand {
  return {
    idempotencyKey: "apply:optimization-executor:route-executor:false:false:false",
    runId: "optimization-executor",
    targetRouteId: "route-executor",
    dryRun: false,
    reload: false,
    verify: false,
    createdBy: "executor test",
    sourceSurface: "cli",
    actorKind: "operator",
    actorId: null,
    sessionId: null,
    catalog: {
      kind: "narrowed_command_context",
      catalogRevision: "catalog-revision-executor",
      targetRoute: {
        route_id: "route-executor",
        service_provider: "provider-before"
      },
      winningRoute: {
        route_id: "route-executor",
        service_provider: "provider-after"
      }
    },
    ...overrides
  };
}

function successfulApplyResult(): ObservabilityIpcResultByOperation["optimizeMutations.apply"] {
  return {
    dbPath: DB_PATH,
    storeFound: false,
    result: null
  };
}

function minimalReadModel(): CliReadModel {
  return {
    sourceFile: "catalog.json",
    sourcePath: "/tmp/catalog.json",
    rawText: "{}",
    models: [],
    modelsByName: {},
    providers: [],
    providersByName: {},
    routes: [],
    routesByName: {}
  };
}

function runtimeDeps(
  dbPath: string,
  optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"]
) {
  const readModel = minimalReadModel();
  return {
    observabilityModule: {
      optimizeMutations
    },
    dbPath,
    configPath: "/tmp/catalog.json",
    readModel,
    loadReadModel: () => readModel,
    mutateConfigDocument: () => undefined,
    getMutableConfigSection: (
      document: Record<string, unknown>,
      sectionName: "models" | "service_providers" | "routes"
    ) => {
      const section = document[sectionName];
      if (typeof section === "object" && section !== null && !Array.isArray(section)) {
        return section as Record<string, unknown>;
      }
      const nextSection: Record<string, unknown> = {};
      document[sectionName] = nextSection;
      return nextSection;
    }
  };
}

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

function configureOptimizableCatalog(configPath: string): string {
  copyExampleConfigPairForTests(configPath);

  const catalogPath = catalogPathForConfigForTests(configPath);
  const catalog = readJsonForTests(catalogPath);
  const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
  routes["gpt-4o-mini"] = {
    ...(routes["gpt-4o-mini"] ?? {}),
    service_provider: "openai_direct",
    provider_model_id: "gpt-4o-mini",
    cost: OPENAI_DIRECT_COST
  };
  routes["openrouter-gpt-4o-mini"] = {
    ...(routes["openrouter-gpt-4o-mini"] ?? {}),
    service_provider: "openrouter",
    provider_model_id: "openai/gpt-4o-mini",
    cost: OPENROUTER_COST
  };
  writeSecureJsonForTests(catalogPath, catalog);
  chmodSync(configPath, 0o600);

  return catalogPath;
}

function createPlannedOptimizeRuntimeFixture(options: {
  readonly tempPrefix: string;
  readonly runId: string;
  readonly createdBy: string;
}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), options.tempPrefix));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  let store: ReturnType<typeof bootstrapObservabilityStore> | null = null;

  process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
  process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";

  try {
    const catalogPath = configureOptimizableCatalog(configPath);
    store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const optimizeResult = runCostOptimizeAndPersist({
      readModel: loadCliReadModel(configPath),
      modelId: "gpt-4o-mini",
      requestedRoutes: null,
      referenceTokens: REFERENCE_TOKENS,
      service,
      storePath: dbPath,
      createdBy: options.createdBy,
      runId: options.runId
    });
    if (!optimizeResult.ok) {
      throw new Error(optimizeResult.failure.message);
    }

    return {
      configPath,
      dbPath,
      catalogPath,
      repository: new OptimizeMutationIdempotencyRepository(store.db),
      readModel: loadCliReadModel(configPath),
      cleanup: () => {
        if (store !== null) {
          closeObservabilityStore(store);
          store = null;
        }
        restoreEnv("SWITCHMAXXER_OPENAI_API_KEY", previousOpenAiKey);
        restoreEnv("SWITCHMAXXER_OPENROUTER_API_KEY", previousOpenRouterKey);
        rmSync(tempDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (store !== null) {
      closeObservabilityStore(store);
    }
    restoreEnv("SWITCHMAXXER_OPENAI_API_KEY", previousOpenAiKey);
    restoreEnv("SWITCHMAXXER_OPENROUTER_API_KEY", previousOpenRouterKey);
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function plannedApplyRuntimePlan(readModel: CliReadModel) {
  return {
    command: {
      command: "optimizeMutation.planApply" as const,
      readModel: readModel as unknown as Record<string, unknown>,
      sourceSurface: "cli" as const,
      createdBy: "planned-runtime-test apply",
      actorKind: "operator" as const,
      dryRun: false,
      metadata: {
        request_id: "planned-runtime-request"
      },
      runId: "optimize-planned-runtime-run",
      targetRouteId: "gpt-4o-mini"
    },
    result: {
      ok: true as const,
      plan: {
        kind: "route_provider_target" as const,
        routeId: "gpt-4o-mini",
        from: {
          serviceProvider: "openai_direct",
          providerModelId: "gpt-4o-mini",
          cost: OPENAI_DIRECT_COST
        },
        to: {
          serviceProvider: "openrouter",
          providerModelId: "openai/gpt-4o-mini",
          cost: OPENROUTER_COST
        },
        reason: "planned external runtime test"
      },
      warnings: []
    },
    reload: false,
    verify: false,
    completion: {
      warnings: ["planned runtime warning"],
      includePostActionResult: true
    }
  };
}

function plannedRestoreRuntimePlan(readModel: CliReadModel, applyActionId: string) {
  return {
    command: {
      command: "optimizeMutation.planRestore" as const,
      readModel: readModel as unknown as Record<string, unknown>,
      sourceSurface: "mcp" as const,
      createdBy: "planned-restore-test restore",
      actorKind: "agent" as const,
      sessionId: "planned-restore-session",
      dryRun: false,
      metadata: {
        request_id: "planned-restore-request"
      },
      selector: {
        mode: "action" as const,
        actionId: applyActionId
      }
    },
    result: {
      ok: true as const,
      plan: {
        kind: "route_provider_target" as const,
        routeId: "gpt-4o-mini",
        from: {
          serviceProvider: "openrouter",
          providerModelId: "openai/gpt-4o-mini",
          cost: OPENROUTER_COST
        },
        to: {
          serviceProvider: "openai_direct",
          providerModelId: "gpt-4o-mini",
          cost: OPENAI_DIRECT_COST
        },
        reason: "planned external restore runtime test"
      },
      warnings: []
    },
    reload: false,
    verify: false,
    completion: {
      warnings: ["planned restore warning"],
      includePostActionResult: true
    }
  };
}

void test("external optimize mutation executor completes and replays accepted commands", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-replay-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const command = validExternalApplyCommand();
    let executeCount = 0;

    const firstResponse = await executeExternalOptimizeMutationCommand({
      id: "executor-first",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command,
      repository,
      nowIso: "2026-05-13T13:00:00.000Z",
      execute: () => {
        executeCount += 1;
        return successfulApplyResult();
      }
    });
    const replayResponse = await executeExternalOptimizeMutationCommand({
      id: "executor-replay",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command,
      repository,
      nowIso: "2026-05-13T13:00:01.000Z",
      execute: () => {
        executeCount += 1;
        throw new Error("replay should not execute");
      }
    });

    assert.equal(firstResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    assert.equal(executeCount, 1);
    assert.equal(repository.get(command.idempotencyKey)?.status, "completed");
    if (replayResponse.ok) {
      assert.deepEqual(replayResponse.result, successfulApplyResult());
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("planned external optimize apply executes through Ostrich once and replays from idempotency", async () => {
  const fixture = createPlannedOptimizeRuntimeFixture({
    tempPrefix: "switchmaxxer-optimize-executor-planned-runtime-",
    runId: "optimize-planned-runtime-run",
    createdBy: "planned-runtime-test"
  });

  try {
    const plan = plannedApplyRuntimePlan(fixture.readModel);

    const firstResponse = await executePlannedExternalOptimizeMutationAgainstModule({
      id: "planned-runtime-first",
      repository: fixture.repository,
      nowIso: "2026-05-13T14:10:00.000Z",
      plan,
      observabilityModule: defaultObservabilityModule,
      dbPath: fixture.dbPath,
      configPath: fixture.configPath,
      readModel: fixture.readModel,
      loadReadModel: () => loadCliReadModel(fixture.configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection
    });
    const replayResponse = await executePlannedExternalOptimizeMutationAgainstModule({
      id: "planned-runtime-replay",
      repository: fixture.repository,
      nowIso: "2026-05-13T14:10:01.000Z",
      plan,
      observabilityModule: defaultObservabilityModule,
      dbPath: fixture.dbPath,
      configPath: fixture.configPath,
      readModel: fixture.readModel,
      loadReadModel: () => loadCliReadModel(fixture.configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection
    });

    assert.equal(firstResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    if (!firstResponse.ok || !replayResponse.ok) {
      return;
    }

    assert.deepEqual(replayResponse.result, firstResponse.result);
    assert.equal(validateObservabilityIpcOperationResponseResult("optimizeMutations.apply", replayResponse), null);
    assert.equal(firstResponse.result.storeFound, true);
    assert.equal(firstResponse.result.result?.ok, true);
    assert.equal(firstResponse.result.result?.deferred, false);
    assert.deepEqual(firstResponse.result.result?.view.warnings, ["planned runtime warning"]);
    const afterApplyRoute = (readJsonForTests(fixture.catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.equal(afterApplyRoute?.["service_provider"], "openrouter");
    assert.equal(afterApplyRoute?.["provider_model_id"], "openai/gpt-4o-mini");

    const ledgerEvents = defaultObservabilityModule.ledger.list({
      dbPath: fixture.dbPath,
      filters: {
        operation: "optimize_apply",
        targetId: "gpt-4o-mini",
        limit: 10
      }
    }).events;
    assert.equal(ledgerEvents.length, 1);
    assert.equal(fixture.repository.get("apply:optimize-planned-runtime-run:gpt-4o-mini:false:false:false")?.status, "completed");
  } finally {
    fixture.cleanup();
  }
});

void test("planned external optimize apply can persist idempotency after caller completion", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-begin-apply-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const readModel = minimalReadModel();
    let applyCount = 0;
    let capturedForceDefer: boolean | undefined;
    let capturedCompletion: unknown = null;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: (options) => {
        applyCount += 1;
        capturedForceDefer = options.deferLedgerCompletion;
        return {
          dbPath,
          storeFound: true,
          result: {
            ok: true,
            deferred: true,
            changed: true,
            actionId: "config-mutation-begin",
            ledgerActionId: "ledger-begin",
            view: {
              phase: "deferred"
            } as never,
            complete: (completion = {}) => {
              capturedCompletion = completion;
              return {
                phase: "completed",
                completion
              } as never;
            }
          }
        };
      },
      restore: () => {
        throw new Error("restore should not execute");
      }
    };
    const deps = runtimeDeps(dbPath, optimizeMutations);
    const plan = plannedApplyRuntimePlan(readModel);

    const beginResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: "planned-begin-apply",
      repository,
      nowIso: "2026-05-13T14:30:00.000Z",
      plan,
      ...deps
    });

    assert.equal(beginResponse.ok, true);
    assert.equal(applyCount, 1);
    assert.equal(capturedForceDefer, true);
    assert.equal(repository.get("apply:optimize-planned-runtime-run:gpt-4o-mini:false:false:false")?.status, "accepted");
    assert.equal(typeof beginResponse.completeIdempotency, "function");
    if (!beginResponse.ok || !beginResponse.completeIdempotency) {
      return;
    }

    const completedResponse = beginResponse.completeIdempotency(
      {
        warnings: ["caller completion"],
        includePostActionResult: true
      },
      "2026-05-13T14:30:01.000Z"
    );
    const replayResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: "planned-begin-apply-replay",
      repository,
      nowIso: "2026-05-13T14:30:02.000Z",
      plan,
      ...deps
    });

    assert.deepEqual(capturedCompletion, {
      warnings: ["caller completion"],
      includePostActionResult: true
    });
    assert.equal(completedResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    assert.equal(applyCount, 1);
    assert.equal(repository.get("apply:optimize-planned-runtime-run:gpt-4o-mini:false:false:false")?.status, "completed");
    if (completedResponse.ok && replayResponse.ok) {
      assert.deepEqual(replayResponse.result, completedResponse.result);
      assert.equal(replayResponse.result.result?.ok, true);
      assert.equal(replayResponse.result.result?.deferred, false);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("planned external optimize apply replays failed and unknown idempotency outcomes", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-planned-errors-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const readModel = minimalReadModel();
    let applyCount = 0;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: () => {
        applyCount += 1;
        throw new Error("planned apply failed");
      },
      restore: () => {
        throw new Error("restore should not execute");
      }
    };
    const deps = runtimeDeps(dbPath, optimizeMutations);
    const failedPlan = plannedApplyRuntimePlan(readModel);

    const failedFirstResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: "planned-apply-failed-first",
      repository,
      nowIso: "2026-05-13T14:32:00.000Z",
      plan: failedPlan,
      ...deps
    });
    const failedReplayResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: "planned-apply-failed-replay",
      repository,
      nowIso: "2026-05-13T14:32:01.000Z",
      plan: failedPlan,
      ...deps
    });

    const unknownPlanBase = plannedApplyRuntimePlan(readModel);
    const unknownPlan = {
      ...unknownPlanBase,
      command: {
        ...unknownPlanBase.command,
        runId: "optimize-planned-unknown-run",
        targetRouteId: "route-unknown"
      },
      result: {
        ...unknownPlanBase.result,
        plan: {
          ...unknownPlanBase.result.plan,
          routeId: "route-unknown"
        }
      }
    };
    const unknownCommand = buildExternalOptimizeApplyCommandFromPlan({
      ...unknownPlan,
      command: unknownPlan.command
    });
    repository.accept({
      idempotencyKey: unknownCommand.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: digestOptimizeMutationCommand(unknownCommand),
      nowIso: "2026-05-13T14:33:00.000Z"
    });
    repository.markUnknown(
      unknownCommand.idempotencyKey,
      "{\"code\":\"observability_unknown_completion\",\"message\":\"completion unknown\"}",
      "2026-05-13T14:33:01.000Z"
    );
    const unknownReplayResponse = beginPlannedExternalOptimizeApplyMutationAgainstModule({
      id: "planned-apply-unknown-replay",
      repository,
      nowIso: "2026-05-13T14:33:02.000Z",
      plan: unknownPlan,
      ...deps
    });

    assert.equal(failedFirstResponse.ok, false);
    assert.equal(failedReplayResponse.ok, false);
    assert.equal(unknownReplayResponse.ok, false);
    assert.equal(applyCount, 1);
    assert.equal(repository.get("apply:optimize-planned-runtime-run:gpt-4o-mini:false:false:false")?.status, "failed");
    assert.equal(repository.get("apply:optimize-planned-unknown-run:route-unknown:false:false:false")?.status, "unknown");
    if (!failedReplayResponse.ok) {
      assert.equal(failedReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.operationFailed);
      assert.equal(failedReplayResponse.error.details?.["idempotencyKey"], "apply:optimize-planned-runtime-run:gpt-4o-mini:false:false:false");
    }
    if (!unknownReplayResponse.ok) {
      assert.equal(unknownReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.unknownCompletion);
      assert.equal(unknownReplayResponse.error.details?.["idempotencyKey"], "apply:optimize-planned-unknown-run:route-unknown:false:false:false");
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("planned external optimize restore executes through Ostrich once and replays from idempotency", async () => {
  const fixture = createPlannedOptimizeRuntimeFixture({
    tempPrefix: "switchmaxxer-optimize-executor-planned-restore-",
    runId: "optimize-planned-restore-run",
    createdBy: "planned-restore-test"
  });

  try {
    const applyResult = defaultObservabilityModule.optimizeMutations.apply({
      dbPath: fixture.dbPath,
      configPath: fixture.configPath,
      readModel: loadCliReadModel(fixture.configPath),
      loadReadModel: () => loadCliReadModel(fixture.configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection,
      sourceSurface: "cli",
      createdBy: "planned-restore-test apply",
      actorKind: "operator",
      runId: "optimize-planned-restore-run",
      targetRouteId: "gpt-4o-mini",
      dryRun: false
    });
    assert.equal(applyResult.result?.ok, true);
    if (!applyResult.result?.ok) {
      return;
    }

    const applyActionId = applyResult.result.view.action_id ?? "";
    assert.notEqual(applyActionId, "");
    const readModel = loadCliReadModel(fixture.configPath);
    const plan = plannedRestoreRuntimePlan(readModel, applyActionId);

    const firstResponse = await executePlannedExternalOptimizeMutationAgainstModule({
      id: "planned-restore-first",
      repository: fixture.repository,
      nowIso: "2026-05-13T14:20:00.000Z",
      plan,
      observabilityModule: defaultObservabilityModule,
      dbPath: fixture.dbPath,
      configPath: fixture.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(fixture.configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection
    });
    const replayResponse = await executePlannedExternalOptimizeMutationAgainstModule({
      id: "planned-restore-replay",
      repository: fixture.repository,
      nowIso: "2026-05-13T14:20:01.000Z",
      plan,
      observabilityModule: defaultObservabilityModule,
      dbPath: fixture.dbPath,
      configPath: fixture.configPath,
      readModel,
      loadReadModel: () => loadCliReadModel(fixture.configPath),
      mutateConfigDocument: mutateCatalogDocument,
      getMutableConfigSection
    });

    assert.equal(firstResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    if (!firstResponse.ok || !replayResponse.ok) {
      return;
    }

    assert.deepEqual(replayResponse.result, firstResponse.result);
    assert.equal(validateObservabilityIpcOperationResponseResult("optimizeMutations.restore", replayResponse), null);
    assert.equal(firstResponse.result.storeFound, true);
    assert.equal(firstResponse.result.result?.ok, true);
    assert.equal(firstResponse.result.result?.deferred, false);
    assert.deepEqual(firstResponse.result.result?.view.warnings, ["planned restore warning"]);
    const afterRestoreRoute = (readJsonForTests(fixture.catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.equal(afterRestoreRoute?.["service_provider"], "openai_direct");
    assert.equal(afterRestoreRoute?.["provider_model_id"], "gpt-4o-mini");

    const restoreLedgerEvents = defaultObservabilityModule.ledger.list({
      dbPath: fixture.dbPath,
      filters: {
        operation: "optimize_restore",
        targetId: "gpt-4o-mini",
        limit: 10
      }
    }).events;
    assert.equal(restoreLedgerEvents.length, 1);
    assert.equal(fixture.repository.get(`restore:action:${applyActionId}:false:false:false`)?.status, "completed");
  } finally {
    fixture.cleanup();
  }
});

void test("planned external optimize restore can persist idempotency after caller completion", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-begin-restore-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const readModel = minimalReadModel();
    const applyActionId = "apply-action-begin";
    let restoreCount = 0;
    let capturedForceDefer: boolean | undefined;
    let capturedCompletion: unknown = null;
    let capturedSelector: unknown = null;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: () => {
        throw new Error("apply should not execute");
      },
      restore: (options) => {
        restoreCount += 1;
        capturedForceDefer = options.deferLedgerCompletion;
        capturedSelector = options.selector;
        return {
          dbPath,
          storeFound: true,
          result: {
            ok: true,
            deferred: true,
            changed: true,
            actionId: "config-restore-begin",
            ledgerActionId: "ledger-restore-begin",
            view: {
              phase: "deferred"
            } as never,
            complete: (completion = {}) => {
              capturedCompletion = completion;
              return {
                phase: "completed",
                completion
              } as never;
            }
          }
        };
      }
    };
    const deps = runtimeDeps(dbPath, optimizeMutations);
    const plan = plannedRestoreRuntimePlan(readModel, applyActionId);

    const beginResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: "planned-begin-restore",
      repository,
      nowIso: "2026-05-13T14:35:00.000Z",
      plan,
      ...deps
    });

    assert.equal(beginResponse.ok, true);
    assert.equal(restoreCount, 1);
    assert.equal(capturedForceDefer, true);
    assert.deepEqual(capturedSelector, {
      mode: "action",
      actionId: applyActionId
    });
    assert.equal(repository.get(`restore:action:${applyActionId}:false:false:false`)?.status, "accepted");
    assert.equal(typeof beginResponse.completeIdempotency, "function");
    if (!beginResponse.ok || !beginResponse.completeIdempotency) {
      return;
    }

    const completedResponse = beginResponse.completeIdempotency(
      {
        warnings: ["caller restore completion"],
        includePostActionResult: true
      },
      "2026-05-13T14:35:01.000Z"
    );
    const replayResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: "planned-begin-restore-replay",
      repository,
      nowIso: "2026-05-13T14:35:02.000Z",
      plan,
      ...deps
    });

    assert.deepEqual(capturedCompletion, {
      warnings: ["caller restore completion"],
      includePostActionResult: true
    });
    assert.equal(completedResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    assert.equal(restoreCount, 1);
    assert.equal(repository.get(`restore:action:${applyActionId}:false:false:false`)?.status, "completed");
    if (completedResponse.ok && replayResponse.ok) {
      assert.deepEqual(replayResponse.result, completedResponse.result);
      assert.equal(replayResponse.result.result?.ok, true);
      assert.equal(replayResponse.result.result?.deferred, false);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("planned external optimize restore replays failed and unknown idempotency outcomes", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-planned-restore-errors-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const readModel = minimalReadModel();
    let restoreCount = 0;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: () => {
        throw new Error("apply should not execute");
      },
      restore: () => {
        restoreCount += 1;
        throw new Error("planned restore failed");
      }
    };
    const deps = runtimeDeps(dbPath, optimizeMutations);
    const failedApplyActionId = "apply-action-failed";
    const failedPlan = plannedRestoreRuntimePlan(readModel, failedApplyActionId);

    const failedFirstResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: "planned-restore-failed-first",
      repository,
      nowIso: "2026-05-13T14:36:00.000Z",
      plan: failedPlan,
      ...deps
    });
    const failedReplayResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: "planned-restore-failed-replay",
      repository,
      nowIso: "2026-05-13T14:36:01.000Z",
      plan: failedPlan,
      ...deps
    });

    const unknownApplyActionId = "apply-action-unknown";
    const unknownPlan = plannedRestoreRuntimePlan(readModel, unknownApplyActionId);
    const unknownCommand = buildExternalOptimizeRestoreCommandFromPlan({
      ...unknownPlan,
      command: unknownPlan.command
    });
    repository.accept({
      idempotencyKey: unknownCommand.idempotencyKey,
      operation: "optimizeMutations.restore",
      commandDigest: digestOptimizeMutationCommand(unknownCommand),
      nowIso: "2026-05-13T14:37:00.000Z"
    });
    repository.markUnknown(
      unknownCommand.idempotencyKey,
      "{\"code\":\"observability_unknown_completion\",\"message\":\"completion unknown\"}",
      "2026-05-13T14:37:01.000Z"
    );
    const unknownReplayResponse = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
      id: "planned-restore-unknown-replay",
      repository,
      nowIso: "2026-05-13T14:37:02.000Z",
      plan: unknownPlan,
      ...deps
    });

    assert.equal(failedFirstResponse.ok, false);
    assert.equal(failedReplayResponse.ok, false);
    assert.equal(unknownReplayResponse.ok, false);
    assert.equal(restoreCount, 1);
    assert.equal(repository.get(`restore:action:${failedApplyActionId}:false:false:false`)?.status, "failed");
    assert.equal(repository.get(`restore:action:${unknownApplyActionId}:false:false:false`)?.status, "unknown");
    if (!failedReplayResponse.ok) {
      assert.equal(failedReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.operationFailed);
      assert.equal(failedReplayResponse.error.details?.["idempotencyKey"], `restore:action:${failedApplyActionId}:false:false:false`);
    }
    if (!unknownReplayResponse.ok) {
      assert.equal(unknownReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.unknownCompletion);
      assert.equal(unknownReplayResponse.error.details?.["idempotencyKey"], `restore:action:${unknownApplyActionId}:false:false:false`);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("external optimize apply runtime adapter completes deferred module results before replay", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-apply-runtime-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const command = validExternalApplyCommand({
      idempotencyKey: "apply:optimization-runtime:route-runtime:false:true:true",
      runId: "optimization-runtime",
      targetRouteId: "route-runtime",
      reload: true,
      verify: true,
      metadata: {
        request_id: "request-runtime"
      },
      completion: {
        reload: {
          ok: true
        },
        verification: {
          ok: true
        },
        warnings: ["reload warning"],
        includePostActionResult: true
      }
    });
    let applyCount = 0;
    let capturedCompletion: unknown = null;
    let capturedDeferLedgerCompletion: boolean | undefined;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: (options) => {
        applyCount += 1;
        capturedDeferLedgerCompletion = options.deferLedgerCompletion;
        return {
          dbPath,
          storeFound: true,
          result: {
            ok: true,
            deferred: true,
            changed: true,
            actionId: "config-mutation-runtime",
            ledgerActionId: "ledger-runtime",
            view: {
              phase: "deferred"
            } as never,
            complete: (completion = {}) => {
              capturedCompletion = completion;
              return {
                phase: "completed",
                completion
              } as never;
            }
          }
        };
      },
      restore: () => {
        throw new Error("restore should not execute");
      }
    };

    const firstResponse = await executeExternalOptimizeApplyMutationAgainstModule({
      id: "executor-apply-runtime-first",
      command,
      repository,
      nowIso: "2026-05-13T14:00:00.000Z",
      ...runtimeDeps(dbPath, optimizeMutations)
    });
    const replayResponse = await executeExternalOptimizeApplyMutationAgainstModule({
      id: "executor-apply-runtime-replay",
      command,
      repository,
      nowIso: "2026-05-13T14:00:01.000Z",
      ...runtimeDeps(dbPath, optimizeMutations)
    });

    assert.equal(firstResponse.ok, true);
    assert.equal(replayResponse.ok, true);
    assert.equal(applyCount, 1);
    assert.equal(capturedDeferLedgerCompletion, true);
    assert.deepEqual(capturedCompletion, {
      reload: { ok: true },
      verification: { ok: true },
      warnings: ["reload warning"],
      includePostActionResult: true
    });
    if (firstResponse.ok) {
      assert.equal(firstResponse.result.result?.ok, true);
      assert.equal(firstResponse.result.result?.deferred, false);
      assert.equal("complete" in (firstResponse.result.result ?? {}), false);
    }
    if (replayResponse.ok) {
      assert.deepEqual(replayResponse.result, firstResponse.ok ? firstResponse.result : null);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("external optimize restore runtime adapter maps restore selectors", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-restore-runtime-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const command: ObservabilityExternalOptimizeRestoreCommand = {
      idempotencyKey: "restore:run_route:optimization-runtime:route-runtime:false:false:false",
      runId: "optimization-runtime",
      targetRouteId: "route-runtime",
      dryRun: false,
      reload: false,
      verify: false,
      createdBy: "executor test",
      sourceSurface: "cli",
      actorKind: "operator",
      actorId: null,
      sessionId: null,
      catalog: {
        kind: "narrowed_command_context",
        catalogRevision: "catalog-revision-executor",
        restorePoint: {
          action_id: "apply-action-executor",
          target_route: "route-runtime"
        }
      }
    };
    let restoreCount = 0;
    let capturedSelector: unknown = null;
    const optimizeMutations: Pick<ObservabilityModule, "optimizeMutations">["optimizeMutations"] = {
      apply: () => {
        throw new Error("apply should not execute");
      },
      restore: (options) => {
        restoreCount += 1;
        capturedSelector = options.selector;
        return {
          dbPath,
          storeFound: true,
          result: {
            ok: true,
            deferred: false,
            changed: false,
            actionId: null,
            ledgerActionId: "restore-ledger-runtime",
            view: {
              phase: "restore-completed"
            } as never
          }
        };
      }
    };

    const response = await executeExternalOptimizeRestoreMutationAgainstModule({
      id: "executor-restore-runtime",
      command,
      repository,
      nowIso: "2026-05-13T14:05:00.000Z",
      ...runtimeDeps(dbPath, optimizeMutations)
    });

    assert.equal(response.ok, true);
    assert.equal(restoreCount, 1);
    assert.deepEqual(capturedSelector, {
      mode: "run_route",
      runId: "optimization-runtime",
      routeId: "route-runtime"
    });

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("external optimize mutation executor rejects idempotency digest mismatches", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-mismatch-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const command = validExternalApplyCommand();
    repository.accept({
      idempotencyKey: command.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: digestOptimizeMutationCommand(command),
      nowIso: "2026-05-13T13:05:00.000Z"
    });

    const response = await executeExternalOptimizeMutationCommand({
      id: "executor-mismatch",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command: {
        ...command,
        verify: true
      },
      repository,
      nowIso: "2026-05-13T13:05:01.000Z",
      execute: () => {
        throw new Error("digest mismatch should not execute");
      }
    });

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
      assert.equal(response.error.details?.["idempotencyKey"], command.idempotencyKey);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("external optimize mutation executor replays failed and unknown outcomes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-executor-errors-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const failedCommand = validExternalApplyCommand({
      idempotencyKey: "apply:optimization-executor:route-failed:false:false:false",
      targetRouteId: "route-failed"
    });
    const unknownCommand = validExternalApplyCommand({
      idempotencyKey: "apply:optimization-executor:route-unknown:false:false:false",
      targetRouteId: "route-unknown"
    });
    let failedExecuteCount = 0;
    let unknownExecuteCount = 0;

    const failedFirstResponse = await executeExternalOptimizeMutationCommand({
      id: "executor-failed-first",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command: failedCommand,
      repository,
      nowIso: "2026-05-13T13:10:00.000Z",
      execute: () => {
        failedExecuteCount += 1;
        throw new Error("apply failed");
      }
    });
    const failedReplayResponse = await executeExternalOptimizeMutationCommand({
      id: "executor-failed-replay",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command: failedCommand,
      repository,
      nowIso: "2026-05-13T13:10:01.000Z",
      execute: () => {
        failedExecuteCount += 1;
        return successfulApplyResult();
      }
    });

    repository.accept({
      idempotencyKey: unknownCommand.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: digestOptimizeMutationCommand(unknownCommand),
      nowIso: "2026-05-13T13:11:00.000Z"
    });
    repository.markUnknown(
      unknownCommand.idempotencyKey,
      "{\"code\":\"observability_unknown_completion\",\"message\":\"completion unknown\"}",
      "2026-05-13T13:11:01.000Z"
    );
    const unknownReplayResponse = await executeExternalOptimizeMutationCommand({
      id: "executor-unknown-replay",
      dbPath: DB_PATH,
      operation: "optimizeMutations.apply",
      command: unknownCommand,
      repository,
      nowIso: "2026-05-13T13:11:02.000Z",
      execute: () => {
        unknownExecuteCount += 1;
        return successfulApplyResult();
      }
    });

    assert.equal(failedFirstResponse.ok, false);
    assert.equal(failedReplayResponse.ok, false);
    assert.equal(unknownReplayResponse.ok, false);
    assert.equal(failedExecuteCount, 1);
    assert.equal(unknownExecuteCount, 0);
    if (!failedReplayResponse.ok) {
      assert.equal(failedReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.operationFailed);
    }
    if (!unknownReplayResponse.ok) {
      assert.equal(unknownReplayResponse.error.code, OBSERVABILITY_IPC_ERROR_CODES.unknownCompletion);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
