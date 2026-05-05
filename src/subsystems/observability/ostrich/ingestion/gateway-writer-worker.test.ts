import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { GatewayObservationWriterResponseMessage } from "./gateway-writer-protocol";
import { createGatewayWriterWorkerRuntime } from "./gateway-writer-worker";
import { makeObservation } from "../../test-helpers";

function createRuntimeWithMessages() {
  const messages: GatewayObservationWriterResponseMessage[] = [];
  const runtime = createGatewayWriterWorkerRuntime({
    postMessage: (message) => {
      messages.push(message);
    }
  });

  return { runtime, messages };
}

void test("gateway writer worker runtime rejects writes before initialization", async () => {
  const { runtime, messages } = createRuntimeWithMessages();

  await assert.rejects(
    runtime.handleMessage({
      type: "write_batch",
      sequence: 1,
      batch: []
    }),
    /not initialized/
  );

  assert.deepEqual(messages, []);
});

void test("gateway writer worker runtime initializes, writes a batch, and closes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-gateway-writer-runtime-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const { runtime, messages } = createRuntimeWithMessages();

  try {
    await runtime.handleMessage({ type: "init", dbPath });

    assert.deepEqual(messages, [{ type: "ready" }]);

    await runtime.handleMessage({
      type: "write_batch",
      sequence: 7,
      batch: [
        {
          record: makeObservation("2026-05-12T00:00:00.000Z", "request_received")
        }
      ]
    });

    assert.equal(messages[1]?.type, "batch_written");
    assert.equal(messages[1]?.type === "batch_written" ? messages[1].sequence : null, 7);
    assert.equal(messages[1]?.type === "batch_written" ? messages[1].droppedCount : null, 0);
    assert.deepEqual(messages[1]?.type === "batch_written" ? messages[1].warnings : [], []);

    await runtime.handleMessage({ type: "close" });

    assert.deepEqual(messages.at(-1), { type: "closed" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway writer worker runtime rejects writes after close is requested", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-gateway-writer-runtime-closed-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const { runtime } = createRuntimeWithMessages();

  try {
    await runtime.handleMessage({ type: "init", dbPath });
    await runtime.handleMessage({ type: "close" });

    await assert.rejects(
      runtime.handleMessage({
        type: "write_batch",
        sequence: 2,
        batch: []
      }),
      /shutting down/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway writer worker runtime reports batch normalization failures", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-gateway-writer-runtime-bad-batch-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const { runtime } = createRuntimeWithMessages();

  try {
    await runtime.handleMessage({ type: "init", dbPath });

    await assert.rejects(
      runtime.handleMessage({
        type: "write_batch",
        sequence: 3,
        batch: { not: "an array" } as never
      }),
      /batch payload must be an array/
    );
  } finally {
    await runtime.handleMessage({ type: "close" }).catch(() => undefined);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
