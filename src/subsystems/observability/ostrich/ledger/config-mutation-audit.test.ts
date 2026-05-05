import assert from "node:assert/strict";
import test from "node:test";

import {
  finishConfigMutationControlPlaneAudit,
  startConfigMutationControlPlaneAudit
} from "./config-mutation-audit";
import type {
  ControlPlaneActionEventRecord,
  ControlPlaneActionRepository,
  FinishControlPlaneActionEventOptions
} from "./control-plane-actions";
import { captureStderr } from "../../test-helpers";

type FakeRepository = Pick<ControlPlaneActionRepository, "createEvent" | "finishEvent">;

function asRepository(repository: FakeRepository): ControlPlaneActionRepository {
  return repository as unknown as ControlPlaneActionRepository;
}

function requireValue<T>(value: T): NonNullable<T> {
  assert.notEqual(value, null);
  return value as NonNullable<T>;
}

function makeStartOptions(repository: FakeRepository) {
  return {
    repository: asRepository(repository),
    sourceSurface: "cli" as const,
    operation: "routes_update" as const,
    targetKind: "route" as const,
    targetId: "route-a",
    createdBy: "test-operator",
    actorKind: "operator" as const,
    sessionId: "session-a",
    metadata: { dry_run: false }
  };
}

void test("config mutation audit start records a started control-plane event", () => {
  const created: ControlPlaneActionEventRecord[] = [];
  const actionId = startConfigMutationControlPlaneAudit(
    makeStartOptions({
      createEvent: (record) => {
        created.push(record);
      },
      finishEvent: () => {
        throw new Error("finishEvent should not be called");
      }
    })
  );

  assert.equal(typeof actionId, "string");
  const createdRecord = requireValue(created[0]);
  assert.equal(createdRecord.id, actionId);
  assert.equal(createdRecord.status, "started");
  assert.equal(createdRecord.operation, "routes_update");
  assert.equal(createdRecord.target_id, "route-a");
  assert.equal(createdRecord.session_id, "session-a");
  assert.deepEqual(JSON.parse(createdRecord.metadata_json), { dry_run: false });
});

void test("config mutation audit start degrades to warning when persistence fails", async () => {
  const { result, output } = await captureStderr(() =>
    startConfigMutationControlPlaneAudit(
      makeStartOptions({
        createEvent: () => {
          throw new Error("database is busy");
        },
        finishEvent: () => {
          throw new Error("finishEvent should not be called");
        }
      })
    )
  );

  assert.equal(result, null);
  assert.match(output, /Unable to record config mutation audit start event: database is busy/);
});

void test("config mutation audit finish records sanitized result and error payloads", () => {
  const finishCalls: Array<[string, FinishControlPlaneActionEventOptions]> = [];

  finishConfigMutationControlPlaneAudit({
    repository: asRepository({
      createEvent: () => {
        throw new Error("createEvent should not be called");
      },
      finishEvent: (...args) => {
        finishCalls.push(args as [string, FinishControlPlaneActionEventOptions]);
      }
    }),
    actionId: "action-finish",
    status: "failed",
    targetId: "route-a",
    result: { changed: false },
    error: {
      code: "config_write_failed",
      message: "failed with sk-test-secret",
      details: { attempt: 1 }
    },
    metadata: { source: "test" }
  });

  const [finishedActionId, finishOptions] = requireValue(finishCalls[0]);
  assert.equal(finishedActionId, "action-finish");
  assert.equal(finishOptions.status, "failed");
  assert.equal(finishOptions.targetId, "route-a");
  assert.deepEqual(JSON.parse(finishOptions.resultJson ?? "{}"), { changed: false });
  assert.deepEqual(JSON.parse(finishOptions.metadataJson ?? "{}"), { source: "test" });

  const errorPayload = JSON.parse(finishOptions.errorJson ?? "{}") as {
    code: string;
    message: string;
    details: unknown;
  };
  assert.equal(errorPayload.code, "config_write_failed");
  assert.match(errorPayload.message, /\*\*\*redacted\*\*\*/);
  assert.deepEqual(errorPayload.details, { attempt: 1 });
});

void test("config mutation audit finish skips missing actions and warns on persistence failure", async () => {
  let finishCalls = 0;
  const repository = asRepository({
    createEvent: () => {
      throw new Error("createEvent should not be called");
    },
    finishEvent: () => {
      finishCalls += 1;
      throw new Error("finish failed");
    }
  });

  finishConfigMutationControlPlaneAudit({
    repository,
    actionId: null,
    status: "succeeded"
  });
  assert.equal(finishCalls, 0);

  const { output } = await captureStderr(() =>
    finishConfigMutationControlPlaneAudit({
      repository,
      actionId: "action-finish-fail",
      status: "succeeded"
    })
  );

  assert.equal(finishCalls, 1);
  assert.match(output, /Unable to record config mutation audit finish event: finish failed/);
});
