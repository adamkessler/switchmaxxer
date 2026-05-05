import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ObservabilityService } from "../../service";
import { closeObservabilityStore, bootstrapObservabilityStore } from "../../store";
import { test } from "../../observability.test-support";

function withService(fn: (service: ObservabilityService) => void): void {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-history-services-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });

  try {
    fn(new ObservabilityService(store.db));
  } finally {
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void test("benchmark history delete removes a run and reports zero for missing runs", () => {
  withService((service) => {
    service.benchmarks.createRun({
      id: "bench-history-delete",
      name: "bench history delete",
      created_at: "2026-05-13T10:00:00.000Z",
      created_by: "test",
      objective: "latency",
      notes: null,
      settings_json: "{}",
      status: "completed"
    });

    assert.deepEqual(service.benchmarkHistory.deleteBenchmarkRun("missing"), {
      benchmark_runs_deleted: 0,
      benchmark_samples_deleted: 0,
      total_deleted: 0
    });

    assert.deepEqual(service.benchmarkHistory.deleteBenchmarkRun("bench-history-delete"), {
      benchmark_runs_deleted: 1,
      benchmark_samples_deleted: 0,
      total_deleted: 1
    });
    assert.equal(service.benchmarks.getRun("bench-history-delete"), null);
  });
});

void test("optimization history delete removes optimize events and orphaned snapshots", () => {
  withService((service) => {
    service.optimizations.createRun({
      id: "opt-history-delete",
      created_at: "2026-05-13T10:00:00.000Z",
      finished_at: "2026-05-13T10:01:00.000Z",
      created_by: "test",
      target_model: "gpt-4o-mini",
      objective: "cost",
      status: "completed",
      winner_route: "route-a",
      benchmark_run_id: null,
      settings_json: "{}",
      candidate_snapshot_json: "[]",
      result_json: "{}",
      warnings_json: "[]"
    });
    service.configMutations.createSnapshot({
      id: "snapshot-history-delete",
      created_at: "2026-05-13T09:59:00.000Z",
      created_by: "test",
      source_kind: "file",
      source_path: "config.json",
      content_sha256: "sha256",
      content_json: "{}",
      content_bytes: 2,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: "event-history-delete",
      created_at: "2026-05-13T10:01:00.000Z",
      created_by: "test",
      source_surface: "cli",
      operation: "optimize_apply",
      status: "succeeded",
      target_kind: "route",
      target_id: "route-a",
      optimization_run_id: "opt-history-delete",
      snapshot_id: "snapshot-history-delete",
      parent_event_id: null,
      before_json: "{}",
      after_json: "{}",
      metadata_json: "{}"
    });

    assert.deepEqual(service.optimizationHistory.deleteOptimizationRun("opt-history-delete"), {
      optimization_runs_deleted: 1,
      config_mutation_events_deleted: 1,
      config_snapshots_deleted: 1,
      total_deleted: 3
    });
    assert.equal(service.optimizations.getRun("opt-history-delete"), null);
    assert.equal(service.configMutations.getSnapshot("snapshot-history-delete"), null);
  });
});
