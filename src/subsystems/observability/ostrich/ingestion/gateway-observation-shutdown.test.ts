import assert from "node:assert/strict";
import test from "node:test";

import { drainGatewayObservationQueueForShutdown } from "./gateway-observation-shutdown";

function createShutdownDrainOptions(overrides: Partial<Parameters<typeof drainGatewayObservationQueueForShutdown>[0]> = {}) {
  let pendingQueueLength = 2;
  let flushActive = false;
  let clearedQueue = false;
  const warnings: string[] = [];

  return {
    options: {
      clearFlushTimer: () => {},
      clearDrainHandle: () => {},
      pendingQueueLength: () => pendingQueueLength,
      isFlushActive: () => flushActive,
      getObservabilityService: () => ({}) as never,
      getDbPath: () => "/tmp/observability.sqlite",
      flushQueueNow: async () => {
        pendingQueueLength = 0;
      },
      shutdownDrainTimeoutMs: () => 100,
      clearPendingQueue: () => {
        clearedQueue = true;
        pendingQueueLength = 0;
      },
      logWarning: (message: string) => {
        warnings.push(message);
      },
      ...overrides
    },
    state: {
      setPendingQueueLength: (value: number) => {
        pendingQueueLength = value;
      },
      setFlushActive: (value: boolean) => {
        flushActive = value;
      },
      wasQueueCleared: () => clearedQueue,
      warnings
    }
  };
}

void test("drainGatewayObservationQueueForShutdown returns immediately when no flush or queue is active", async () => {
  const { options, state } = createShutdownDrainOptions();
  state.setPendingQueueLength(0);

  const result = await drainGatewayObservationQueueForShutdown(options);

  assert.deepEqual(result, { drained: 0, lost: 0 });
  assert.equal(state.wasQueueCleared(), false);
  assert.deepEqual(state.warnings, []);
});

void test("drainGatewayObservationQueueForShutdown reports lost observations when no store is available", async () => {
  const { options, state } = createShutdownDrainOptions({
    getObservabilityService: () => null
  });

  const result = await drainGatewayObservationQueueForShutdown(options);

  assert.deepEqual(result, { drained: 0, lost: 2 });
  assert.equal(state.wasQueueCleared(), true);
  assert.deepEqual(state.warnings, []);
});

void test("drainGatewayObservationQueueForShutdown logs and clears pending observations when flushing fails", async () => {
  const { options, state } = createShutdownDrainOptions({
    flushQueueNow: async () => {
      throw new Error("synthetic flush failure");
    }
  });

  const result = await drainGatewayObservationQueueForShutdown(options);

  assert.deepEqual(result, { drained: 0, lost: 2 });
  assert.equal(state.wasQueueCleared(), true);
  assert.equal(state.warnings.length, 1);
  assert.match(state.warnings[0] ?? "", /synthetic flush failure/);
});

void test("drainGatewayObservationQueueForShutdown reports drained observations when a flush completes", async () => {
  const { options, state } = createShutdownDrainOptions();
  state.setPendingQueueLength(3);
  state.setFlushActive(true);

  const result = await drainGatewayObservationQueueForShutdown(options);

  assert.deepEqual(result, { drained: 3, lost: 0 });
  assert.equal(state.wasQueueCleared(), false);
  assert.deepEqual(state.warnings, []);
});
