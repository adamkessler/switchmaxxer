import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGatewayObservationRuntimeState } from "./gateway-observation-runtime-state";
import type { GatewayObservationWorkerDeps } from "./gateway-observation-worker";
import { makeObservation } from "./test-helpers";

function createTestWorkerDeps(
  workerScriptPath: string,
  overrides: Partial<GatewayObservationWorkerDeps> = {}
): GatewayObservationWorkerDeps {
  return {
    workerScriptPath,
    closeTimeoutMs: 500,
    writeTimeoutMs: 500,
    onDroppedCount: () => {},
    onWorkerCloseTimeout: (error) => {
      throw error;
    },
    onWorkerFailure: (error) => {
      throw error;
    },
    ...overrides
  };
}

function readTextFileIfPresent(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

void test("createGatewayObservationRuntimeState isolates queue state per runtime instance", () => {
  const firstRuntime = createGatewayObservationRuntimeState();
  const secondRuntime = createGatewayObservationRuntimeState();

  const firstResult = firstRuntime.queue.enqueueGatewayObservation(
    makeObservation("2026-04-24T12:00:00.000Z", "request_received"),
    { requestExecutionMode: "terminal_only" }
  );
  const secondResult = secondRuntime.queue.enqueueGatewayObservation(
    makeObservation("2026-04-24T12:00:01.000Z", "route_resolved"),
    { requestExecutionMode: "terminal_only" }
  );

  assert.equal(firstResult, "delayed");
  assert.equal(secondResult, "delayed");
  assert.equal(firstRuntime.queue.pendingGatewayObservationQueueLength(), 1);
  assert.equal(secondRuntime.queue.pendingGatewayObservationQueueLength(), 1);

  const firstBatch = firstRuntime.queue.drainPendingGatewayObservationBatch(10);

  assert.equal(firstBatch.length, 1);
  assert.equal(firstRuntime.queue.pendingGatewayObservationQueueLength(), 0);
  assert.equal(secondRuntime.queue.pendingGatewayObservationQueueLength(), 1);
});

void test("createGatewayObservationRuntimeState isolates worker pending writes per runtime instance", async () => {
  const firstRuntime = createGatewayObservationRuntimeState();
  const secondRuntime = createGatewayObservationRuntimeState();

  const firstPendingWrite = firstRuntime.worker.createPendingGatewayObservationWorkerWriteForTests(1, 5);
  const secondPendingWrite = secondRuntime.worker.createPendingGatewayObservationWorkerWriteForTests(2, 5);

  assert.equal(firstRuntime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 1);
  assert.equal(secondRuntime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 1);

  await assert.rejects(firstPendingWrite, /timed out/);
  assert.equal(firstRuntime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 0);
  assert.equal(secondRuntime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 1);

  await assert.rejects(secondPendingWrite, /timed out/);
  assert.equal(secondRuntime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 0);
});

void test("gateway observation worker re-init waits for the old worker to close", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-worker-reinit-"));
  const workerScriptPath = path.join(tempDir, "delayed-close-worker.js");

  writeFileSync(
    workerScriptPath,
    `
const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("missing parent port");
}

parentPort.on("message", (message) => {
  if (message.type === "init") {
    parentPort.postMessage({ type: "ready" });
    return;
  }

  if (message.type === "close") {
    setTimeout(() => {
      parentPort.postMessage({ type: "closed" });
    }, 75);
  }
});
`
  );

  const runtime = createGatewayObservationRuntimeState();
  const deps = createTestWorkerDeps(workerScriptPath);

  try {
    await runtime.worker.ensureGatewayObservationWorker(path.join(tempDir, "first.sqlite"), deps);

    let secondInitSettled = false;
    const startedAt = Date.now();
    const secondInit = runtime.worker
      .ensureGatewayObservationWorker(path.join(tempDir, "second.sqlite"), deps)
      .then(() => {
        secondInitSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(secondInitSettled, false);

    await secondInit;

    assert.equal(secondInitSettled, true);
    assert.ok(Date.now() - startedAt >= 50);
  } finally {
    await runtime.worker.disposeGatewayObservationWorker(deps);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observation worker generation guard ignores stale worker messages", async () => {
  const runtime = createGatewayObservationRuntimeState();
  const deps = createTestWorkerDeps("unused-worker-script.js");
  const currentGeneration = runtime.worker.getGatewayObservationWorkerGenerationForTests();
  const pendingWrite = runtime.worker.createPendingGatewayObservationWorkerWriteForTests(7, 25);

  runtime.worker.handleGatewayObservationWorkerMessageForTests(
    currentGeneration - 1,
    {
      type: "batch_written",
      sequence: 7,
      durationMs: 1,
      droppedCount: 0,
      warnings: []
    },
    deps
  );

  assert.equal(runtime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 1);
  await assert.rejects(pendingWrite, /timed out/);
  assert.equal(runtime.worker.getPendingGatewayObservationWorkerWriteCountForTests(), 0);
});

void test("gateway observation worker close timeout force-terminates the old worker", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-worker-timeout-"));
  const markerPath = path.join(tempDir, "worker-ticks.log");
  const workerScriptPath = path.join(tempDir, "hanging-close-worker.js");

  writeFileSync(
    workerScriptPath,
    `
const { appendFileSync } = require("node:fs");
const { parentPort } = require("node:worker_threads");
const markerPath = ${JSON.stringify(markerPath)};

if (!parentPort) {
  throw new Error("missing parent port");
}

parentPort.on("message", (message) => {
  if (message.type === "init") {
    parentPort.postMessage({ type: "ready" });
    return;
  }

  if (message.type === "close") {
    setInterval(() => {
      appendFileSync(markerPath, "tick\\n");
    }, 5);
  }
});
`
  );

  const runtime = createGatewayObservationRuntimeState();
  const closeTimeoutErrors: Error[] = [];
  const deps = createTestWorkerDeps(workerScriptPath, {
    closeTimeoutMs: 25,
    onWorkerCloseTimeout: (error) => {
      closeTimeoutErrors.push(error);
    }
  });

  try {
    await runtime.worker.ensureGatewayObservationWorker(path.join(tempDir, "observability.sqlite"), deps);
    const pendingWrite = runtime.worker.createPendingGatewayObservationWorkerWriteForTests(9, 500);
    const pendingWriteRejection = assert.rejects(pendingWrite, /force-terminated/);

    await runtime.worker.disposeGatewayObservationWorker(deps);
    await pendingWriteRejection;

    assert.equal(closeTimeoutErrors.length, 1);
    assert.match(closeTimeoutErrors[0]?.message ?? "", /close timed out/);

    const ticksAfterDispose = readTextFileIfPresent(markerPath);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(readTextFileIfPresent(markerPath), ticksAfterDispose);
  } finally {
    await runtime.worker.disposeGatewayObservationWorker(deps);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
