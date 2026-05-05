import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS,
  OBSERVABILITY_SCHEMA_TABLE_NAMES,
  OBSERVABILITY_SCHEMA_VERSION
} from "./schema";
import { ObservabilityService } from "../../service";
import { ControlPlaneActionRepository } from "../ledger/control-plane-actions";
import { assertAllowedObservabilitySchemaTableName, closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { makeObservation, makeObservationForRequest, seedSuccessfulRequest } from "../../test-helpers";
import { test } from "../../observability.test-support";
import {
  rowToRequestExecutionRecord,
  rowToRequestExecutionSummaryRow,
  rowToTopFailingRoute
} from "../query/request-executions";

void test("benchmark repository rejects malformed sample timestamps", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-bad-benchmark-timestamp-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(makeObservationForRequest("req-bad-benchmark-timestamp", "2026-04-18T12:10:00.000Z", "request_received"));
    service.recordObservation(
      makeObservationForRequest("req-bad-benchmark-timestamp", "2026-04-18T12:10:00.090Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );

    service.benchmarks.createRun({
      id: "bench-bad-timestamp",
      name: "bench-bad-timestamp",
      created_at: "2026-04-18T12:10:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        route_names: ["route-alpha"],
        path_mode: "direct"
      }),
      status: "completed"
    });

    assert.throws(
      () =>
        service.benchmarks.insertSample({
          id: "bench-bad-timestamp-sample",
          benchmark_run_id: "bench-bad-timestamp",
          request_execution_id: "req-bad-benchmark-timestamp",
          route_id: "route-alpha",
          provider_id: "provider-main",
          provider_model_id: "provider-model-1",
          sample_index: 0,
          started_at: "not-a-timestamp",
          completed_at: null,
          status_code: 200,
          outcome: "succeeded",
          latency_ms: 100,
          ttft_ms: 50,
          duration_ms: 100,
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          estimated_cost_micros: 1000,
          is_warmup: 0,
          score_value: null,
          score_scale: null,
          score_direction: null,
          score_source: null,
          score_method: null,
          scored_at: null,
          score_json: null
        }),
      /Benchmark field 'started_at' must be an ISO-8601 timestamp\./
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service persists benchmark runs and samples with summary stats", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-bench-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(makeObservation("2026-04-18T12:10:00.000Z", "request_received"));
    service.recordObservation(makeObservation("2026-04-18T12:10:00.010Z", "route_resolved"));
    service.recordObservation(makeObservation("2026-04-18T12:10:00.020Z", "upstream_request_started"));
    service.recordObservation(makeObservation("2026-04-18T12:10:00.060Z", "upstream_response_completed", {
      statusCode: 200
    }));
    service.recordObservation(makeObservation("2026-04-18T12:10:00.060Z", "client_response_started", {
      statusCode: 200
    }));
    service.recordObservation(makeObservation("2026-04-18T12:10:00.090Z", "client_response_completed", {
      outcome: "succeeded",
      statusCode: 200
    }));

    service.benchmarks.createRun({
      id: "bench-run-1",
      name: "bench-1",
      created_at: "2026-04-18T12:10:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        route_names: ["route-alpha"],
        path_mode: "direct"
      }),
      status: "completed"
    });

    service.benchmarks.insertSample({
      id: "bench-sample-1",
      benchmark_run_id: "bench-run-1",
      request_execution_id: "req-observability-test",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T12:10:00.000Z",
      completed_at: "2026-04-18T12:10:00.090Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 90,
      ttft_ms: null,
      duration_ms: 90,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_micros: null,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: JSON.stringify({
        path: "direct"
      })
    });

    const run = service.benchmarks.getRun("bench-run-1");
    const samples = service.benchmarks.listSamplesByRun("bench-run-1");
    const summary = service.benchmarks.summarizeRun("bench-run-1");

    assert.ok(run, "expected persisted benchmark run");
    assert.equal(samples.length, 1);
    assert.equal(samples[0]?.request_execution_id, "req-observability-test");
    assert.equal(summary.measured_samples, 1);
    assert.equal(summary.failed_count, 0);
    assert.equal(summary.success_count, 1);
    assert.equal(summary.average_latency_ms, 90);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability repository read paths fail loudly on drifted observation rows", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observation-row-shape-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observation = makeObservation("2026-04-18T12:14:00.000Z", "request_received");

    service.recordObservation(observation);
    store.db.prepare("UPDATE observations SET kind = ? WHERE id = ?").run("not-a-kind", observation.id);

    assert.throws(
      () => service.observations.listRecent(),
      /Observation field 'kind' has unsupported value 'not-a-kind'/
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("request execution read paths fail loudly on drifted summary rows", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-request-execution-row-shape-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestId = "req-request-execution-row-shape";

    seedSuccessfulRequest(service, requestId);
    store.db.prepare("UPDATE request_executions SET outcome = ? WHERE request_id = ?").run("not-an-outcome", requestId);

    assert.throws(
      () => service.getRequestExecution(requestId),
      /Request execution row field 'outcome' has unsupported value 'not-an-outcome'/
    );
    assert.throws(
      () => service.listRecentRequestExecutions({ limit: 10 }),
      /Request execution row field 'outcome' has unsupported value 'not-an-outcome'/
    );
    assert.throws(
      () => service.getRequestExecutionStats(),
      /Request execution outcome count row field 'outcome' has unsupported value 'not-an-outcome'/
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("request execution row converter rejects undefined nullable timestamps", () => {
  assert.throws(
    () =>
      rowToRequestExecutionRecord({
        id: "request-execution-id",
        request_id: "request-id",
        started_at: "2025-01-01T00:00:00.000Z",
        completed_at: undefined
      }),
    /Request execution row field 'completed_at' must be an ISO timestamp string or null/
  );
});

void test("request execution summary row converter fails loudly on drifted aggregate rows", () => {
  assert.throws(
    () =>
      rowToRequestExecutionSummaryRow({
        total_count: 1,
        partial_output_count: 0,
        average_gateway_residency_ms: -1,
        average_upstream_ttft_ms: null,
        average_upstream_duration_ms: null
      }),
    /Request execution summary row field 'average_gateway_residency_ms' must be a non-negative number or null/
  );
});

void test("top failing route row converter fails loudly on drifted rows", () => {
  assert.throws(
    () => rowToTopFailingRoute({ route: "", count: 1 }),
    /Top failing route row field 'route' must be a non-empty string/
  );
});

void test("benchmark repository read paths fail loudly on drifted sample rows", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-benchmark-row-shape-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestExecutionId = "req-observability-test";

    service.benchmarks.createRun({
      id: "bench-run-row-shape",
      name: "bench-row-shape",
      created_at: "2026-04-18T12:20:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        route_names: ["route-alpha"],
        path_mode: "direct"
      }),
      status: "completed"
    });
    seedSuccessfulRequest(service, requestExecutionId);

    service.benchmarks.insertSample({
      id: "bench-sample-row-shape",
      benchmark_run_id: "bench-run-row-shape",
      request_execution_id: requestExecutionId,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T12:20:00.000Z",
      completed_at: "2026-04-18T12:20:00.050Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 50,
      ttft_ms: null,
      duration_ms: 50,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_micros: null,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: null
    });

    store.db.prepare("UPDATE benchmark_samples SET completed_at = ? WHERE id = ?").run("not-a-timestamp", "bench-sample-row-shape");

    assert.throws(
      () => service.benchmarks.listSamplesByRun("bench-run-row-shape"),
      /Benchmark field 'completed_at' must be an ISO-8601 timestamp\./
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service verifies and repairs drifted request executions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-repair-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(makeObservation("2026-04-18T12:15:00.000Z", "request_received"));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.010Z", "route_resolved"));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.020Z", "upstream_request_started"));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.040Z", "upstream_response_started", {
      statusCode: 200
    }));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.050Z", "upstream_response_completed", {
      statusCode: 200
    }));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.060Z", "client_response_started", {
      statusCode: 200
    }));
    service.recordObservation(makeObservation("2026-04-18T12:15:00.090Z", "client_response_completed", {
      outcome: "succeeded",
      statusCode: 200
    }));

    store.db
      .prepare("UPDATE request_executions SET status_code = ?, gateway_residency_ms = ? WHERE request_id = ?")
      .run(500, 999, "req-observability-test");

    const verificationBefore = service.verifyRequestExecution("req-observability-test");
    assert.equal(verificationBefore.status, "drift");
    assert.ok(verificationBefore.mismatches.some((mismatch) => mismatch.field === "status_code"));
    assert.ok(verificationBefore.mismatches.some((mismatch) => mismatch.field === "gateway_residency_ms"));

    const repairResult = service.repairRequestExecution("req-observability-test");
    assert.equal(repairResult.action, "updated");
    assert.equal(repairResult.verification.status, "ok");

    const repaired = service.getRequestExecution("req-observability-test");
    assert.ok(repaired);
    assert.equal(repaired.status_code, 200);
    assert.equal(repaired.gateway_residency_ms, 90);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store refuses to open incompatible schema versions without deleting local data", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-migration-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE request_executions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        request_received_at TEXT NOT NULL,
        route_resolved_at TEXT,
        upstream_request_started_at TEXT,
        upstream_response_started_at TEXT,
        upstream_response_completed_at TEXT,
        client_response_started_at TEXT,
        client_response_completed_at TEXT,
        route_id TEXT,
        route_name TEXT,
        model_id TEXT,
        provider_id TEXT,
        provider_model_id TEXT,
        client_api_mode TEXT NOT NULL,
        upstream_api_mode TEXT,
        status_code INTEGER,
        outcome TEXT NOT NULL,
        failure_stage TEXT,
        failure_reason TEXT,
        observation_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        ttft_ms INTEGER,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_micros INTEGER,
        currency TEXT,
        switchmaxxer_pre_upstream_ms INTEGER,
        upstream_ttft_ms INTEGER,
        upstream_duration_ms INTEGER,
        switchmaxxer_post_upstream_ms INTEGER,
        client_write_ms INTEGER,
        gateway_residency_ms INTEGER,
        partial_output INTEGER NOT NULL DEFAULT 0
      );
    `);

    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 1, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare(
        `
          INSERT INTO request_executions (
            id,
            request_id,
            started_at,
            request_received_at,
            client_api_mode,
            outcome,
            observation_count,
            switchmaxxer_pre_upstream_ms,
            switchmaxxer_post_upstream_ms,
            partial_output
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "legacy-request",
        "legacy-request",
        "2026-04-18T12:00:00.000Z",
        "2026-04-18T12:00:00.000Z",
        "openai-completions",
        "succeeded",
        1,
        20,
        15,
        0
      );
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    assert.throws(
      () => {
        bootstrapObservabilityStore({ dbPath });
      },
      new RegExp(
        `Observability store schema version 1 is incompatible with expected schema version ${OBSERVABILITY_SCHEMA_VERSION}; refusing to open`
      )
    );

    const reopenedLegacyDb = new DatabaseSync(dbPath);
    const legacyColumns = reopenedLegacyDb.prepare("PRAGMA table_info(request_executions)").all() as Array<{ name?: string }>;
    assert.ok(legacyColumns.some((column) => column.name === "switchmaxxer_pre_upstream_ms"));
    assert.ok(legacyColumns.some((column) => column.name === "switchmaxxer_post_upstream_ms"));

    const legacyCount = reopenedLegacyDb
      .prepare("SELECT COUNT(*) AS count FROM request_executions WHERE request_id = ?")
      .get("legacy-request") as { count?: number } | undefined;
    assert.equal(legacyCount?.count, 1);
    reopenedLegacyDb.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 2 in place to add attributes_truncated", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v2-migration-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE observations (
        id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        ingested_at TEXT,
        request_id TEXT,
        trace_id TEXT,
        span_id TEXT,
        parent_span_id TEXT,
        surface TEXT NOT NULL,
        kind TEXT NOT NULL,
        event TEXT NOT NULL,
        stage TEXT,
        severity TEXT,
        outcome TEXT,
        route_id TEXT,
        route_name TEXT,
        model_id TEXT,
        provider_id TEXT,
        provider_model_id TEXT,
        client_api_mode TEXT,
        upstream_api_mode TEXT,
        listener TEXT,
        actor TEXT,
        status_code INTEGER,
        latency_ms INTEGER,
        ttft_ms INTEGER,
        duration_ms INTEGER,
        request_bytes INTEGER,
        response_bytes INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_micros INTEGER,
        currency TEXT,
        billing_source TEXT,
        benchmark_run_id TEXT,
        benchmark_case_id TEXT,
        optimization_profile_id TEXT,
        tags_json TEXT,
        attributes_json TEXT,
        message TEXT
      );
    `);

    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "2", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 2, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare(
        `
          INSERT INTO observations (
            id,
            observed_at,
            surface,
            kind,
            event,
            attributes_json,
            message
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "obs-v2-migration",
        "2026-04-18T00:00:00.000Z",
        "gateway",
        "measurement",
        "request_received",
        "{\"before\":true}",
        "legacy observation"
      );
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const migratedColumns = store.db.prepare("PRAGMA table_info(observations)").all() as Array<{ name?: string }>;
    const optimizationRunTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'optimization_runs'")
      .get() as { name?: string } | undefined;
    const configMutationEventsTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'config_mutation_events'")
      .get() as { name?: string } | undefined;
    const migratedObservation = store.db
      .prepare("SELECT attributes_truncated, attributes_json, message FROM observations WHERE id = ?")
      .get("obs-v2-migration") as { attributes_truncated?: number; attributes_json?: string | null; message?: string | null };

    assert.ok(migratedColumns.some((column) => column.name === "attributes_truncated"));
    assert.equal(optimizationRunTable?.name, "optimization_runs");
    assert.equal(configMutationEventsTable?.name, "config_mutation_events");
    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    assert.equal(migratedObservation.attributes_truncated, 0);
    assert.equal(migratedObservation.attributes_json, "{\"before\":true}");
    assert.equal(migratedObservation.message, "legacy observation");
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 3 in place to add optimization_runs", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v3-migration-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE observations (
        id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        surface TEXT NOT NULL,
        kind TEXT NOT NULL,
        event TEXT NOT NULL,
        attributes_json TEXT,
        attributes_truncated INTEGER NOT NULL DEFAULT 0 CHECK (attributes_truncated IN (0, 1)),
        message TEXT
      );
    `);

    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "3", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 3, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0003_observations_attributes_truncated_v3", 3, "observations_attributes_truncated_v3", "2026-04-18T00:00:00.000Z");
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const optimizationRunTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'optimization_runs'")
      .get() as { name?: string } | undefined;
    const optimizationRunIndex = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_optimization_runs_created_at'")
      .get() as { name?: string } | undefined;
    const configSnapshotTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'config_snapshots'")
      .get() as { name?: string } | undefined;
    const configMutationEventsTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'config_mutation_events'")
      .get() as { name?: string } | undefined;

    assert.equal(optimizationRunTable?.name, "optimization_runs");
    assert.equal(optimizationRunIndex?.name, "idx_optimization_runs_created_at");
    assert.equal(configSnapshotTable?.name, "config_snapshots");
    assert.equal(configMutationEventsTable?.name, "config_mutation_events");
    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 4 in place to add config mutation history", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v4-migration-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE optimization_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        created_by TEXT NOT NULL,
        target_model TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        winner_route TEXT,
        benchmark_run_id TEXT,
        settings_json TEXT NOT NULL,
        candidate_snapshot_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL
      );
    `);

    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "4", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 4, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0004_optimization_runs_v4", 4, "optimization_runs_v4", "2026-04-18T00:00:00.000Z");
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const configSnapshotTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'config_snapshots'")
      .get() as { name?: string } | undefined;
    const configMutationEventsTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'config_mutation_events'")
      .get() as { name?: string } | undefined;
    const configMutationEventsIndex = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_config_mutation_events_operation_target'")
      .get() as { name?: string } | undefined;
    const controlPlaneActionEventsTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'control_plane_action_events'")
      .get() as { name?: string } | undefined;

    assert.equal(configSnapshotTable?.name, "config_snapshots");
    assert.equal(configMutationEventsTable?.name, "config_mutation_events");
    assert.equal(configMutationEventsIndex?.name, "idx_config_mutation_events_operation_target");
    assert.equal(controlPlaneActionEventsTable?.name, "control_plane_action_events");
    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 5 in place to add control-plane action history", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v5-migration-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE optimization_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        created_by TEXT NOT NULL,
        target_model TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        winner_route TEXT,
        benchmark_run_id TEXT,
        settings_json TEXT NOT NULL,
        candidate_snapshot_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL
      );

      CREATE TABLE config_snapshots (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_path TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_bytes INTEGER NOT NULL,
        retention_expires_at TEXT
      );

      CREATE TABLE config_mutation_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        optimization_run_id TEXT,
        snapshot_id TEXT,
        parent_event_id TEXT,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
    `);

    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "5", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 5, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0005_config_mutation_events_v5", 5, "config_mutation_events_v5", "2026-04-18T00:00:00.000Z");
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const controlPlaneActionEventsTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'control_plane_action_events'")
      .get() as { name?: string } | undefined;
    const controlPlaneActionEventsIndex = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_control_plane_action_events_operation_target'")
      .get() as { name?: string } | undefined;

    assert.equal(controlPlaneActionEventsTable?.name, "control_plane_action_events");
    assert.equal(controlPlaneActionEventsIndex?.name, "idx_control_plane_action_events_operation_target");
    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 6 control-plane constraints for config mutation audit", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v6-migration-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE config_mutation_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        optimization_run_id TEXT,
        snapshot_id TEXT,
        parent_event_id TEXT,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE control_plane_action_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        created_by TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        session_id TEXT,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT,
        optimization_run_id TEXT,
        mutation_event_id TEXT,
        correlation_ids_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        error_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        CHECK (source_surface IN ('cli', 'mcp')),
        CHECK (actor_kind IN ('operator', 'agent', 'system', 'unknown')),
        CHECK (operation IN ('optimize_apply', 'optimize_restore')),
        CHECK (status IN ('started', 'succeeded', 'failed', 'noop', 'dry_run_succeeded', 'dry_run_failed')),
        CHECK (target_kind IN ('route'))
      );
    `);
    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "6", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 6, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0006_control_plane_action_events_v6", 6, "control_plane_action_events_v6", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare(`
        INSERT INTO control_plane_action_events (
          id, created_at, finished_at, created_by, source_surface, actor_kind, actor_id, session_id,
          operation, status, target_kind, target_id, optimization_run_id, mutation_event_id,
          correlation_ids_json, result_json, error_json, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "legacy-apply",
        "2026-04-18T00:00:00.000Z",
        "2026-04-18T00:00:01.000Z",
        "test-suite",
        "cli",
        "operator",
        null,
        null,
        "optimize_apply",
        "succeeded",
        "route",
        "route-alpha",
        null,
        null,
        "{}",
        "{}",
        "{}",
        "{}"
      );
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const controlPlaneActions = new ControlPlaneActionRepository(store.db);
    controlPlaneActions.createEvent({
      id: "provider-update-after-v7",
      created_at: "2026-04-18T00:00:02.000Z",
      finished_at: "2026-04-18T00:00:03.000Z",
      created_by: "test-suite",
      source_surface: "mcp",
      actor_kind: "agent",
      actor_id: null,
      session_id: "session-a",
      operation: "providers_update",
      status: "failed",
      target_kind: "provider",
      target_id: "provider-alpha",
      optimization_run_id: null,
      mutation_event_id: null,
      correlation_ids_json: "{}",
      result_json: "{}",
      error_json: "{\"code\":\"invalid_config_mutation\"}",
      metadata_json: "{}"
    });

    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    assert.equal(controlPlaneActions.getEvent("legacy-apply")?.operation, "optimize_apply");
    assert.equal(controlPlaneActions.getEvent("provider-update-after-v7")?.target_kind, "provider");
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store migrates schema version 7 to add optimize mutation idempotency", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-v7-migration-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        migration_name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE control_plane_action_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        created_by TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        session_id TEXT,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT,
        optimization_run_id TEXT,
        mutation_event_id TEXT,
        correlation_ids_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        error_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        CHECK (source_surface IN ('cli', 'mcp')),
        CHECK (actor_kind IN ('operator', 'agent', 'system', 'unknown')),
        CHECK (operation IN (
          'optimize_apply',
          'optimize_restore',
          'models_create',
          'models_update',
          'models_delete',
          'providers_create',
          'providers_update',
          'providers_delete',
          'providers_set_key',
          'providers_clear_key',
          'providers_set_key_env',
          'routes_create',
          'routes_update',
          'routes_delete'
        )),
        CHECK (status IN ('started', 'succeeded', 'failed', 'noop', 'dry_run_succeeded', 'dry_run_failed')),
        CHECK (target_kind IN ('model', 'provider', 'route'))
      );
    `);
    legacyDb
      .prepare("INSERT INTO store_metadata (key, value, updated_at) VALUES (?, ?, ?)")
      .run("schema_version", "7", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run("0001_observability_store_v1", 7, "observability_store_v1", "2026-04-18T00:00:00.000Z");
    legacyDb
      .prepare("INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at) VALUES (?, ?, ?, ?)")
      .run(
        "0007_control_plane_action_events_mutation_audit_v7",
        7,
        "control_plane_action_events_mutation_audit_v7",
        "2026-04-18T00:00:00.000Z"
      );
    legacyDb.close();
    chmodSync(dbPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const idempotencyTable = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'optimize_mutation_idempotency'")
      .get() as { name?: string } | undefined;
    const idempotencyIndex = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_optimize_mutation_idempotency_status_updated'"
      )
      .get() as { name?: string } | undefined;

    assert.equal(idempotencyTable?.name, "optimize_mutation_idempotency");
    assert.equal(idempotencyIndex?.name, "idx_optimize_mutation_idempotency_status_updated");
    assert.equal(store.schemaVersion, OBSERVABILITY_SCHEMA_VERSION);
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability schema table guard rejects unknown or unsafe table names before PRAGMA inspection", () => {
  assert.deepEqual(
    OBSERVABILITY_SCHEMA_TABLE_NAMES,
    OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS.map((definition) => definition.name)
  );

  for (const definition of OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS) {
    assert.match(
      definition.createSql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${definition.name}\\s*\\(`)
    );
    assert.doesNotThrow(() => {
      assertAllowedObservabilitySchemaTableName(definition.name);
    });
  }

  assert.throws(
    () => {
      assertAllowedObservabilitySchemaTableName("request_executions); DROP TABLE observations; --");
    },
    /Unknown table: request_executions\); DROP TABLE observations; --/
  );
  assert.throws(
    () => {
      assertAllowedObservabilitySchemaTableName("users");
    },
    /Unknown table: users/
  );
});

void test("observability service deletes orphan request executions during repair", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-orphan-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    store.db.prepare(
      `
        INSERT INTO request_executions (
          id,
          request_id,
          started_at,
          completed_at,
          request_received_at,
          client_api_mode,
          outcome,
          observation_count,
          partial_output
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      "orphan-request",
      "orphan-request",
      "2026-04-18T12:20:00.000Z",
      null,
      "2026-04-18T12:20:00.000Z",
      "openai",
      "failed",
      0,
      0
    );

    const verificationBefore = service.verifyRequestExecution("orphan-request");
    assert.equal(verificationBefore.status, "orphan_summary");

    const repairResult = service.repairRequestExecution("orphan-request");
    assert.equal(repairResult.action, "deleted");
    assert.equal(repairResult.verification.status, "missing_summary");
    assert.equal(service.getRequestExecution("orphan-request"), null);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
