import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "./observability.test-support";
import { buildInClausePlaceholders, ObservabilityService } from "./service";
import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { makeObservation, makeObservationForRequest } from "./test-helpers";
import { type ObservationRecord } from "./types";

void test("buildInClausePlaceholders returns stable SQL fragments and rejects empty batches", () => {
  assert.equal(buildInClausePlaceholders(1), "(?)");
  assert.equal(buildInClausePlaceholders(3), "(?, ?, ?)");
  assert.throws(() => buildInClausePlaceholders(0), /zero placeholders/);
});

void test("observability service materializes request executions and stats", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    const observations: ObservationRecord[] = [
      makeObservation("2026-04-18T12:00:00.000Z", "request_received"),
      makeObservation("2026-04-18T12:00:00.010Z", "route_resolved"),
      makeObservation("2026-04-18T12:00:00.020Z", "upstream_request_started"),
      makeObservation("2026-04-18T12:00:00.080Z", "upstream_response_started", {
        statusCode: 200
      }),
      makeObservation("2026-04-18T12:00:00.085Z", "upstream_response_completed", {
        statusCode: 200
      }),
      makeObservation("2026-04-18T12:00:00.090Z", "client_response_started", {
        statusCode: 200
      }),
      makeObservation("2026-04-18T12:00:00.120Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    ];

    for (const observation of observations) {
      service.recordObservation(observation);
    }

    const requestExecution = service.getRequestExecution("req-observability-test");
    assert.ok(requestExecution, "expected a materialized request execution");
    assert.equal(requestExecution.outcome, "succeeded");
    assert.equal(requestExecution.observation_count, 7);
    assert.equal(requestExecution.switchmaxxer_pre_upstream_ms, 20);
    assert.equal(requestExecution.upstream_ttft_ms, 60);
    assert.equal(requestExecution.upstream_duration_ms, 65);
    assert.equal(requestExecution.client_write_ms, 30);
    assert.equal(requestExecution.gateway_residency_ms, 120);

    const stats = service.getRequestExecutionStats();
    assert.equal(stats.total_count, 1);
    assert.equal(stats.partial_output_count, 0);
    assert.equal(stats.average_gateway_residency_ms, 120);
    assert.deepEqual(
      stats.outcome_counts.map((row) => ({
        outcome: row.outcome,
        count: row.count
      })),
      [{ outcome: "succeeded", count: 1 }]
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service can defer request execution materialization until terminal observations", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-terminal-only-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestId = "req-terminal-only";

    const started = service.recordObservation(
      makeObservationForRequest(requestId, "2026-04-18T12:00:00.000Z", "request_received"),
      { requestExecutionMode: "terminal_only" }
    );
    assert.equal(started.requestExecution, null);
    assert.equal(service.getRequestExecution(requestId), null);

    service.recordObservation(
      makeObservationForRequest(requestId, "2026-04-18T12:00:00.010Z", "route_resolved"),
      { requestExecutionMode: "terminal_only" }
    );
    service.recordObservation(
      makeObservationForRequest(requestId, "2026-04-18T12:00:00.020Z", "upstream_request_started"),
      { requestExecutionMode: "terminal_only" }
    );

    const completed = service.recordObservation(
      makeObservationForRequest(requestId, "2026-04-18T12:00:00.090Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      }),
      { requestExecutionMode: "terminal_only" }
    );

    assert.ok(completed.requestExecution);
    assert.equal(completed.requestExecution?.request_id, requestId);
    assert.equal(completed.requestExecution?.outcome, "succeeded");
    assert.equal(completed.requestExecution?.observation_count, 4);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service batches observation writes in one transaction without changing materialization semantics", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-batch-write-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestId = "req-batch-write";
    const results = service.recordObservationBatch([
      {
        record: makeObservationForRequest(requestId, "2026-04-18T12:00:00.000Z", "request_received"),
        options: { requestExecutionMode: "terminal_only" }
      },
      {
        record: makeObservationForRequest(requestId, "2026-04-18T12:00:00.010Z", "route_resolved"),
        options: { requestExecutionMode: "terminal_only" }
      },
      {
        record: makeObservationForRequest(requestId, "2026-04-18T12:00:00.020Z", "upstream_request_started"),
        options: { requestExecutionMode: "terminal_only" }
      },
      {
        record: makeObservationForRequest(requestId, "2026-04-18T12:00:00.090Z", "client_response_completed", {
          outcome: "succeeded",
          statusCode: 200
        }),
        options: { requestExecutionMode: "terminal_only" }
      }
    ]);

    assert.equal(results.length, 4);
    assert.equal(results[0]?.requestExecution, null);
    assert.equal(results[1]?.requestExecution, null);
    assert.equal(results[2]?.requestExecution, null);
    assert.ok(results[3]?.requestExecution);
    assert.equal(results[3]?.requestExecution?.request_id, requestId);
    assert.equal(results[3]?.requestExecution?.outcome, "succeeded");
    assert.equal(results[3]?.requestExecution?.observation_count, 4);

    const persisted = service.listObservationsByRequestId(requestId, 20);
    assert.equal(persisted.length, 4);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
