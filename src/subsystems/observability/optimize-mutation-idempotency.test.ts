import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ObservabilityExternalOptimizeApplyCommand } from "./observability-ipc-contract";
import { ControlPlaneActionRepository } from "./control-plane-actions";
import {
  canonicalizeOptimizeMutationCommandForDigest,
  digestOptimizeMutationCommand,
  OptimizeMutationIdempotencyRepository
} from "./optimize-mutation-idempotency";
import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { test } from "./observability.test-support";

function validExternalApplyCommand(
  overrides: Partial<ObservabilityExternalOptimizeApplyCommand> = {}
): ObservabilityExternalOptimizeApplyCommand {
  return {
    idempotencyKey: "apply:optimization-idempotency:route-idempotency:false:false:false",
    runId: "optimization-idempotency",
    targetRouteId: "route-idempotency",
    dryRun: false,
    reload: false,
    verify: false,
    createdBy: "idempotency test",
    sourceSurface: "cli",
    actorKind: "operator",
    actorId: null,
    sessionId: null,
    catalog: {
      kind: "narrowed_command_context",
      catalogRevision: "catalog-revision-idempotency",
      targetRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-before"
      },
      winningRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-after"
      }
    },
    ...overrides
  };
}

function createLedgerAction(repository: ControlPlaneActionRepository, id: string, routeId: string): void {
  repository.createEvent({
    id,
    created_at: "2026-05-13T12:00:00.000Z",
    finished_at: null,
    created_by: "idempotency test",
    source_surface: "cli",
    actor_kind: "operator",
    actor_id: null,
    session_id: null,
    operation: "optimize_apply",
    status: "started",
    target_kind: "route",
    target_id: routeId,
    optimization_run_id: "optimization-idempotency",
    mutation_event_id: null,
    correlation_ids_json: "{}",
    result_json: "{}",
    error_json: "{}",
    metadata_json: "{}"
  });
}

void test("optimize mutation idempotency digest is stable and excludes volatile context", () => {
  const command = validExternalApplyCommand();
  const sameIntentWithDifferentKey = {
    ...command,
    idempotencyKey: "different-key"
  };
  const sameIntentWithDifferentCatalogContext = {
    ...command,
    catalog: {
      kind: "narrowed_command_context" as const,
      catalogRevision: "catalog-revision-after-mutation",
      targetRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-after"
      },
      winningRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-after"
      }
    }
  };
  const sameIntentWithDifferentPropertyOrder = {
    targetRouteId: command.targetRouteId,
    runId: command.runId,
    idempotencyKey: command.idempotencyKey,
    dryRun: command.dryRun,
    reload: command.reload,
    verify: command.verify,
    createdBy: command.createdBy,
    sourceSurface: command.sourceSurface,
    actorKind: command.actorKind,
    catalog: {
      winningRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-after"
      },
      targetRoute: {
        route_id: "route-idempotency",
        service_provider: "provider-before"
      },
      catalogRevision: "catalog-revision-idempotency",
      kind: "narrowed_command_context"
    },
    actorId: command.actorId,
    sessionId: command.sessionId
  } satisfies ObservabilityExternalOptimizeApplyCommand;

  assert.equal(
    canonicalizeOptimizeMutationCommandForDigest(command).includes("idempotencyKey"),
    false
  );
  assert.equal(
    canonicalizeOptimizeMutationCommandForDigest(command).includes("catalogRevision"),
    false
  );
  assert.equal(digestOptimizeMutationCommand(command), digestOptimizeMutationCommand(sameIntentWithDifferentKey));
  assert.equal(digestOptimizeMutationCommand(command), digestOptimizeMutationCommand(sameIntentWithDifferentCatalogContext));
  assert.equal(digestOptimizeMutationCommand(command), digestOptimizeMutationCommand(sameIntentWithDifferentPropertyOrder));
  assert.notEqual(digestOptimizeMutationCommand(command), digestOptimizeMutationCommand({
    ...command,
    verify: true
  }));
});

void test("optimize mutation idempotency repository records replay decisions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-idempotency-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const actionRepository = new ControlPlaneActionRepository(store.db);
    const command = validExternalApplyCommand();
    const commandDigest = digestOptimizeMutationCommand(command);

    const accepted = repository.accept({
      idempotencyKey: command.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest,
      nowIso: "2026-05-13T12:00:00.000Z"
    });
    assert.equal(accepted.kind, "accepted");
    assert.equal(accepted.record.status, "accepted");

    const duplicateAccepted = repository.accept({
      idempotencyKey: command.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest,
      nowIso: "2026-05-13T12:00:01.000Z"
    });
    assert.equal(duplicateAccepted.kind, "unknown_completion");

    createLedgerAction(actionRepository, "ledger-action-idempotency", command.targetRouteId);
    repository.linkAction(command.idempotencyKey, "ledger-action-idempotency", "2026-05-13T12:00:02.000Z");
    const completed = repository.complete(
      command.idempotencyKey,
      "{\"ok\":true,\"actionId\":\"ledger-action-idempotency\"}",
      "2026-05-13T12:00:03.000Z"
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.control_plane_action_id, "ledger-action-idempotency");

    const duplicateCompleted = repository.accept({
      idempotencyKey: command.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest,
      nowIso: "2026-05-13T12:00:04.000Z"
    });
    assert.equal(duplicateCompleted.kind, "replay_completed");
    assert.equal(
      (JSON.parse(duplicateCompleted.record.result_json) as { actionId?: string }).actionId,
      "ledger-action-idempotency"
    );

    const digestMismatch = repository.accept({
      idempotencyKey: command.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: digestOptimizeMutationCommand({
        ...command,
        verify: true
      }),
      nowIso: "2026-05-13T12:00:05.000Z"
    });
    assert.equal(digestMismatch.kind, "digest_mismatch");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("optimize mutation idempotency repository replays failed and unknown outcomes", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-idempotency-outcomes-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const repository = new OptimizeMutationIdempotencyRepository(store.db);
    const actionRepository = new ControlPlaneActionRepository(store.db);
    const failedCommand = validExternalApplyCommand({
      idempotencyKey: "apply:optimization-idempotency:route-failed:false:false:false",
      targetRouteId: "route-failed"
    });
    const unknownCommand = validExternalApplyCommand({
      idempotencyKey: "apply:optimization-idempotency:route-unknown:false:false:false",
      targetRouteId: "route-unknown"
    });
    const failedDigest = digestOptimizeMutationCommand(failedCommand);
    const unknownDigest = digestOptimizeMutationCommand(unknownCommand);

    repository.accept({
      idempotencyKey: failedCommand.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: failedDigest,
      nowIso: "2026-05-13T12:10:00.000Z"
    });
    repository.fail(
      failedCommand.idempotencyKey,
      "{\"code\":\"observability_operation_failed\"}",
      "2026-05-13T12:10:01.000Z"
    );

    repository.accept({
      idempotencyKey: unknownCommand.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: unknownDigest,
      nowIso: "2026-05-13T12:11:00.000Z"
    });
    createLedgerAction(actionRepository, "ledger-action-unknown", unknownCommand.targetRouteId);
    repository.markUnknown(
      unknownCommand.idempotencyKey,
      "{\"code\":\"observability_unknown_completion\"}",
      "2026-05-13T12:11:01.000Z",
      "ledger-action-unknown"
    );

    assert.equal(
      repository.accept({
        idempotencyKey: failedCommand.idempotencyKey,
        operation: "optimizeMutations.apply",
        commandDigest: failedDigest,
        nowIso: "2026-05-13T12:10:02.000Z"
      }).kind,
      "replay_failed"
    );
    const unknownReplay = repository.accept({
      idempotencyKey: unknownCommand.idempotencyKey,
      operation: "optimizeMutations.apply",
      commandDigest: unknownDigest,
      nowIso: "2026-05-13T12:11:02.000Z"
    });
    assert.equal(unknownReplay.kind, "unknown_completion");
    assert.equal(unknownReplay.record.control_plane_action_id, "ledger-action-unknown");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
