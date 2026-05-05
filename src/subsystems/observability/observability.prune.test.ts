import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ObservabilityService } from "./service";
import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { makeObservationForRequest, seedSuccessfulRequest } from "./test-helpers";
import { type ObservationRecord } from "./types";
import { test } from "./observability.test-support";

void test("observability service prune returns clean zero totals on an empty store", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-empty-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");
    assert.deepEqual(result, {
      status: "completed",
      cutoff_at: "2026-04-10T00:00:00.000Z",
      failure_stage: null,
      failure_message: null,
      observations_deleted: 0,
      request_executions_deleted: 0,
      benchmark_runs_deleted: 0,
      benchmark_samples_deleted: 0,
      cost_facts_deleted: 0,
      optimization_facts_deleted: 0,
      control_plane_action_events_deleted: 0,
      config_mutation_events_deleted: 0,
      config_snapshots_deleted: 0,
      total_deleted: 0
    });

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation repository rejects unknown event contract values", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-config-mutation-contract-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const baseEvent = {
      id: "event-contract-test",
      created_at: "2026-04-18T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      operation: "optimize_apply",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      snapshot_id: null,
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openrouter\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    } as const;

    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, source_surface: "http" } as never),
      /source_surface/
    );
    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, operation: "config_import" } as never),
      /operation/
    );
    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, status: "pending" } as never),
      /status/
    );
    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, status: "failed" } as never),
      /status/
    );
    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, status: "noop" } as never),
      /status/
    );
    assert.throws(
      () => service.configMutations.createEvent({ ...baseEvent, target_kind: "provider" } as never),
      /target_kind/
    );
    assert.throws(
      () => {
        store.db
          .prepare(
            `
              INSERT INTO config_mutation_events (
                id,
                created_at,
                created_by,
                source_surface,
                operation,
                status,
                target_kind,
                target_id,
                optimization_run_id,
                snapshot_id,
                parent_event_id,
                before_json,
                after_json,
                metadata_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            "event-contract-test-sqlite",
            "2026-04-18T10:00:01.000Z",
            "test-suite",
            "cli",
            "optimize_apply",
            "failed",
            "route",
            "gpt-4o-mini",
            null,
            null,
            null,
            "{\"service_provider\":\"openai_direct\"}",
            "{\"service_provider\":\"openrouter\"}",
            "{\"schema_version\":\"1\"}"
          );
      },
      /constraint|CHECK/i
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("control-plane action repository rejects unknown event contract values", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-control-plane-action-contract-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const baseEvent = {
      id: "ledger-contract-test",
      created_at: "2026-04-18T10:00:01.000Z",
      finished_at: null,
      created_by: "test-suite",
      source_surface: "cli",
      actor_kind: "operator",
      actor_id: null,
      session_id: null,
      operation: "optimize_apply",
      status: "started",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      mutation_event_id: null,
      correlation_ids_json: "{\"schema_version\":\"1\"}",
      result_json: "{}",
      error_json: "{}",
      metadata_json: "{}"
    } as const;

    assert.throws(
      () => service.controlPlaneActions.createEvent({ ...baseEvent, source_surface: "http" } as never),
      /source_surface/
    );
    assert.throws(
      () => service.controlPlaneActions.createEvent({ ...baseEvent, actor_kind: "robot" } as never),
      /actor_kind/
    );
    assert.throws(
      () => service.controlPlaneActions.createEvent({ ...baseEvent, operation: "gateway_restart" } as never),
      /operation/
    );
    assert.throws(
      () => service.controlPlaneActions.createEvent({ ...baseEvent, status: "pending" } as never),
      /status/
    );
    assert.throws(
      () => service.controlPlaneActions.createEvent({ ...baseEvent, target_kind: "unknown" } as never),
      /target_kind/
    );
    service.controlPlaneActions.createEvent({
      ...baseEvent,
      id: "ledger-provider-mutation",
      operation: "providers_update",
      target_kind: "provider",
      target_id: "provider-alpha"
    });
    const providerEvents = service.controlPlaneActions.listEvents({
      targetKind: "provider",
      targetId: "provider-alpha",
      operation: "providers_update"
    });
    assert.equal(providerEvents.length, 1);
    assert.equal(providerEvents[0]?.target_kind, "provider");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service prunes old control-plane action events", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-control-plane-actions-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.controlPlaneActions.createEvent({
      id: "ledger-old-prune",
      created_at: "2026-04-01T10:00:00.000Z",
      finished_at: "2026-04-01T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      actor_kind: "operator",
      actor_id: null,
      session_id: null,
      operation: "optimize_apply",
      status: "dry_run_succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: "optimize-old",
      mutation_event_id: null,
      correlation_ids_json: "{\"schema_version\":\"1\"}",
      result_json: "{\"schema_version\":\"1\",\"dry_run\":true}",
      error_json: "{}",
      metadata_json: "{}"
    });
    service.controlPlaneActions.createEvent({
      id: "ledger-new-prune",
      created_at: "2026-04-18T10:00:00.000Z",
      finished_at: "2026-04-18T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "mcp",
      actor_kind: "agent",
      actor_id: null,
      session_id: "test-session",
      operation: "optimize_restore",
      status: "failed",
      target_kind: "route",
      target_id: null,
      optimization_run_id: null,
      mutation_event_id: null,
      correlation_ids_json: "{\"schema_version\":\"1\"}",
      result_json: "{}",
      error_json: "{\"schema_version\":\"1\",\"code\":\"optimize_not_found\"}",
      metadata_json: "{}"
    });

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");

    assert.equal(result.control_plane_action_events_deleted, 1);
    assert.equal(result.total_deleted, 1);
    assert.equal(service.controlPlaneActions.getEvent("ledger-old-prune"), null);
    assert.ok(service.controlPlaneActions.getEvent("ledger-new-prune"));
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service prunes old config mutation events and managed snapshots", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-config-mutations-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.configMutations.createSnapshot({
      id: "snapshot-old-prune",
      created_at: "2026-04-01T10:00:00.000Z",
      created_by: "test-suite",
      source_kind: "catalog",
      source_path: path.join(tempDir, "catalog.json"),
      content_sha256: "abc123",
      content_json: "{\"catalog_version\":1}",
      content_bytes: 21,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: "event-old-prune",
      created_at: "2026-04-01T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      operation: "optimize_apply",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      snapshot_id: "snapshot-old-prune",
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openrouter\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    });
    service.configMutations.createSnapshot({
      id: "snapshot-new-prune",
      created_at: "2026-04-18T10:00:00.000Z",
      created_by: "test-suite",
      source_kind: "catalog",
      source_path: path.join(tempDir, "catalog.json"),
      content_sha256: "def456",
      content_json: "{\"catalog_version\":1}",
      content_bytes: 21,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: "event-new-prune",
      created_at: "2026-04-18T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      operation: "optimize_apply",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      snapshot_id: "snapshot-new-prune",
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openrouter\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    });

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");

    assert.equal(result.config_mutation_events_deleted, 1);
    assert.equal(result.config_snapshots_deleted, 1);
    assert.equal(result.total_deleted, 2);
    assert.equal(service.configMutations.getEvent("event-old-prune"), null);
    assert.equal(service.configMutations.getSnapshot("snapshot-old-prune"), null);
    assert.ok(service.configMutations.getEvent("event-new-prune"));
    assert.ok(service.configMutations.getSnapshot("snapshot-new-prune"));
    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service prunes old observations, request executions, and benchmark data by cutoff", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    const recordLifecycle = (requestId: string, timestamps: string[]): void => {
      const [receivedAt, resolvedAt, upstreamStartedAt, upstreamResponseStartedAt, upstreamCompletedAt, clientStartedAt, clientCompletedAt] =
        timestamps;
      if (
        typeof receivedAt === "undefined" ||
        typeof resolvedAt === "undefined" ||
        typeof upstreamStartedAt === "undefined" ||
        typeof upstreamResponseStartedAt === "undefined" ||
        typeof upstreamCompletedAt === "undefined" ||
        typeof clientStartedAt === "undefined" ||
        typeof clientCompletedAt === "undefined"
      ) {
        throw new Error("recordLifecycle requires seven timestamps");
      }
      const observations: ObservationRecord[] = [
        makeObservationForRequest(requestId, receivedAt, "request_received"),
        makeObservationForRequest(requestId, resolvedAt, "route_resolved"),
        makeObservationForRequest(requestId, upstreamStartedAt, "upstream_request_started"),
        makeObservationForRequest(requestId, upstreamResponseStartedAt, "upstream_response_started", {
          statusCode: 200
        }),
        makeObservationForRequest(requestId, upstreamCompletedAt, "upstream_response_completed", {
          statusCode: 200
        }),
        makeObservationForRequest(requestId, clientStartedAt, "client_response_started", {
          statusCode: 200
        }),
        makeObservationForRequest(requestId, clientCompletedAt, "client_response_completed", {
          outcome: "succeeded",
          statusCode: 200
        })
      ];

      for (const observation of observations) {
        service.recordObservation(observation);
      }
    };

    recordLifecycle("req-old-prune", [
      "2026-04-01T10:00:00.000Z",
      "2026-04-01T10:00:00.010Z",
      "2026-04-01T10:00:00.020Z",
      "2026-04-01T10:00:00.040Z",
      "2026-04-01T10:00:00.050Z",
      "2026-04-01T10:00:00.060Z",
      "2026-04-01T10:00:00.090Z"
    ]);
    recordLifecycle("req-new-prune", [
      "2026-04-18T10:00:00.000Z",
      "2026-04-18T10:00:00.010Z",
      "2026-04-18T10:00:00.020Z",
      "2026-04-18T10:00:00.040Z",
      "2026-04-18T10:00:00.050Z",
      "2026-04-18T10:00:00.060Z",
      "2026-04-18T10:00:00.090Z"
    ]);

    const oldRequestExecution = service.getRequestExecution("req-old-prune");
    const newRequestExecution = service.getRequestExecution("req-new-prune");
    assert.ok(oldRequestExecution);
    assert.ok(newRequestExecution);

    service.benchmarks.createRun({
      id: "bench-old-prune",
      name: "bench-old-prune",
      created_at: "2026-04-01T10:05:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-old-prune-sample",
      benchmark_run_id: "bench-old-prune",
      request_execution_id: "req-old-prune",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-01T10:05:01.000Z",
      completed_at: "2026-04-01T10:05:01.100Z",
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
    });
    service.benchmarks.createRun({
      id: "bench-new-prune",
      name: "bench-new-prune",
      created_at: "2026-04-18T10:05:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-new-prune-sample",
      benchmark_run_id: "bench-new-prune",
      request_execution_id: "req-new-prune",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T10:05:01.000Z",
      completed_at: "2026-04-18T10:05:01.100Z",
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
    });

    store.db.prepare(
      `
        INSERT INTO cost_facts (
          id,
          request_execution_id,
          observed_at,
          currency,
          estimated_cost_micros,
          cost_fact_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run("cost-old-prune", oldRequestExecution.id, "2026-04-01T10:06:00.000Z", "USD", 1000, "estimated");
    store.db.prepare(
      `
        INSERT INTO cost_facts (
          id,
          request_execution_id,
          observed_at,
          currency,
          estimated_cost_micros,
          cost_fact_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run("cost-new-prune", newRequestExecution.id, "2026-04-18T10:06:00.000Z", "USD", 1000, "estimated");
    store.db.prepare(
      `
        INSERT INTO optimization_facts (
          id,
          observed_at,
          request_execution_id,
          outcome
        ) VALUES (?, ?, ?, ?)
      `
    ).run("optimization-old-prune", "2026-04-01T10:06:00.000Z", oldRequestExecution.id, "accepted");
    store.db.prepare(
      `
        INSERT INTO optimization_facts (
          id,
          observed_at,
          request_execution_id,
          outcome
        ) VALUES (?, ?, ?, ?)
      `
    ).run("optimization-new-prune", "2026-04-18T10:06:00.000Z", newRequestExecution.id, "accepted");

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");
    assert.deepEqual(result, {
      status: "completed",
      cutoff_at: "2026-04-10T00:00:00.000Z",
      failure_stage: null,
      failure_message: null,
      observations_deleted: 7,
      request_executions_deleted: 1,
      benchmark_runs_deleted: 1,
      benchmark_samples_deleted: 1,
      cost_facts_deleted: 1,
      optimization_facts_deleted: 1,
      control_plane_action_events_deleted: 0,
      config_mutation_events_deleted: 0,
      config_snapshots_deleted: 0,
      total_deleted: 12
    });

    assert.equal(service.getRequestExecution("req-old-prune"), null);
    assert.ok(service.getRequestExecution("req-new-prune"));
    assert.equal(service.listObservationsByRequestId("req-old-prune", 20).length, 0);
    assert.equal(service.listObservationsByRequestId("req-new-prune", 20).length, 7);
    assert.equal(service.benchmarks.getRun("bench-old-prune"), null);
    assert.ok(service.benchmarks.getRun("bench-new-prune"));

    const remainingCostFacts = store.db.prepare("SELECT COUNT(*) AS count FROM cost_facts").get() as { count: number };
    const remainingOptimizationFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM optimization_facts")
      .get() as { count: number };
    const remainingBenchmarkSamples = store.db
      .prepare("SELECT COUNT(*) AS count FROM benchmark_samples")
      .get() as { count: number };

    assert.equal(remainingCostFacts.count, 1);
    assert.equal(remainingOptimizationFacts.count, 1);
    assert.equal(remainingBenchmarkSamples.count, 1);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service prune totals stay exact when request-execution dependents are explicitly deleted before cascade", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-exact-dependents-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(
      makeObservationForRequest("req-old-prune-exact", "2026-04-01T10:00:00.000Z", "request_received")
    );
    service.recordObservation(
      makeObservationForRequest("req-old-prune-exact", "2026-04-01T10:00:00.100Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );
    service.recordObservation(
      makeObservationForRequest("req-new-prune-exact", "2026-04-18T10:00:00.000Z", "request_received")
    );
    service.recordObservation(
      makeObservationForRequest("req-new-prune-exact", "2026-04-18T10:00:00.100Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );

    const oldRequestExecution = service.getRequestExecution("req-old-prune-exact");
    const newRequestExecution = service.getRequestExecution("req-new-prune-exact");
    assert.ok(oldRequestExecution);
    assert.ok(newRequestExecution);

    service.benchmarks.createRun({
      id: "bench-shared-prune-exact",
      name: "bench-shared-prune-exact",
      created_at: "2026-04-18T10:05:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });

    for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
      service.benchmarks.insertSample({
        id: `bench-old-prune-exact-sample-${sampleIndex}`,
        benchmark_run_id: "bench-shared-prune-exact",
        request_execution_id: oldRequestExecution.id,
        route_id: "route-alpha",
        provider_id: "provider-main",
        provider_model_id: "provider-model-1",
        sample_index: sampleIndex,
        started_at: `2026-04-01T10:05:0${sampleIndex}.000Z`,
        completed_at: `2026-04-01T10:05:0${sampleIndex}.100Z`,
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
      });
    }

    service.benchmarks.insertSample({
      id: "bench-new-prune-exact-sample",
      benchmark_run_id: "bench-shared-prune-exact",
      request_execution_id: newRequestExecution.id,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 3,
      started_at: "2026-04-18T10:05:03.000Z",
      completed_at: "2026-04-18T10:05:03.100Z",
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
    });

    for (let factIndex = 0; factIndex < 2; factIndex += 1) {
      store.db.prepare(
        `
          INSERT INTO cost_facts (
            id,
            request_execution_id,
            observed_at,
            currency,
            estimated_cost_micros,
            cost_fact_kind
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(
        `cost-old-prune-exact-${factIndex}`,
        oldRequestExecution.id,
        `2026-04-01T10:06:0${factIndex}.000Z`,
        "USD",
        1000 + factIndex,
        "estimated"
      );
      store.db.prepare(
        `
          INSERT INTO optimization_facts (
            id,
            observed_at,
            request_execution_id,
            outcome
          ) VALUES (?, ?, ?, ?)
        `
      ).run(
        `optimization-old-prune-exact-${factIndex}`,
        `2026-04-01T10:07:0${factIndex}.000Z`,
        oldRequestExecution.id,
        "accepted"
      );
    }

    store.db.prepare(
      `
        INSERT INTO cost_facts (
          id,
          request_execution_id,
          observed_at,
          currency,
          estimated_cost_micros,
          cost_fact_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run("cost-new-prune-exact", newRequestExecution.id, "2026-04-18T10:06:00.000Z", "USD", 1000, "estimated");
    store.db.prepare(
      `
        INSERT INTO optimization_facts (
          id,
          observed_at,
          request_execution_id,
          outcome
        ) VALUES (?, ?, ?, ?)
      `
    ).run("optimization-new-prune-exact", "2026-04-18T10:07:00.000Z", newRequestExecution.id, "accepted");

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");
    assert.deepEqual(result, {
      status: "completed",
      cutoff_at: "2026-04-10T00:00:00.000Z",
      failure_stage: null,
      failure_message: null,
      observations_deleted: 2,
      request_executions_deleted: 1,
      benchmark_runs_deleted: 0,
      benchmark_samples_deleted: 3,
      cost_facts_deleted: 2,
      optimization_facts_deleted: 2,
      control_plane_action_events_deleted: 0,
      config_mutation_events_deleted: 0,
      config_snapshots_deleted: 0,
      total_deleted: 10
    });

    assert.equal(service.getRequestExecution("req-old-prune-exact"), null);
    assert.ok(service.getRequestExecution("req-new-prune-exact"));
    assert.ok(service.benchmarks.getRun("bench-shared-prune-exact"));

    const remainingCostFacts = store.db.prepare("SELECT COUNT(*) AS count FROM cost_facts").get() as { count: number };
    const remainingOptimizationFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM optimization_facts")
      .get() as { count: number };
    const remainingBenchmarkSamples = store.db
      .prepare("SELECT COUNT(*) AS count FROM benchmark_samples")
      .get() as { count: number };

    assert.equal(remainingCostFacts.count, 1);
    assert.equal(remainingOptimizationFacts.count, 1);
    assert.equal(remainingBenchmarkSamples.count, 1);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service prunes retained data in bounded batches", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-batches-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    for (let index = 0; index < 3; index += 1) {
      const oldRequestId = `req-old-prune-batch-${index}`;
      const oldObservedAt = `2026-04-0${index + 1}T10:00:00.000Z`;

      service.recordObservation(makeObservationForRequest(oldRequestId, oldObservedAt, "request_received"));
      service.recordObservation(
        makeObservationForRequest(oldRequestId, `2026-04-0${index + 1}T10:00:00.100Z`, "client_response_completed", {
          outcome: "succeeded",
          statusCode: 200
        })
      );

      const oldRequestExecution = service.getRequestExecution(oldRequestId);
      assert.ok(oldRequestExecution);

      service.benchmarks.createRun({
        id: `bench-old-prune-batch-${index}`,
        name: `bench-old-prune-batch-${index}`,
        created_at: `2026-04-0${index + 1}T10:05:00.000Z`,
        created_by: "test-suite",
        objective: "route_benchmark",
        notes: null,
        settings_json: JSON.stringify({ requested_path_mode: "direct" }),
        status: "completed"
      });
      service.benchmarks.insertSample({
        id: `bench-old-prune-batch-sample-${index}`,
        benchmark_run_id: `bench-old-prune-batch-${index}`,
        request_execution_id: oldRequestExecution.id,
        route_id: "route-alpha",
        provider_id: "provider-main",
        provider_model_id: "provider-model-1",
        sample_index: 0,
        started_at: `2026-04-0${index + 1}T10:05:01.000Z`,
        completed_at: `2026-04-0${index + 1}T10:05:01.100Z`,
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
      });
    }

    service.recordObservation(makeObservationForRequest("req-new-prune-batch", "2026-04-18T10:00:00.000Z", "request_received"));
    service.recordObservation(
      makeObservationForRequest("req-new-prune-batch", "2026-04-18T10:00:00.100Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );

    const deleteCallCounts = {
      observations: 0,
      requestExecutions: 0,
      benchmarkRuns: 0
    };
    const originalDeleteRows = (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows;
    (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows = (sql: string, ...parameters: unknown[]) => {
      if (sql.includes("DELETE FROM observations")) {
        deleteCallCounts.observations += 1;
      }

      if (sql.includes("DELETE FROM request_executions")) {
        deleteCallCounts.requestExecutions += 1;
      }

      if (sql.includes("DELETE FROM benchmark_runs")) {
        deleteCallCounts.benchmarkRuns += 1;
      }

      return originalDeleteRows.call(service, sql, ...parameters);
    };

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z", {
      batchSize: 1
    });

    (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows = originalDeleteRows;

    assert.deepEqual(result, {
      status: "completed",
      cutoff_at: "2026-04-10T00:00:00.000Z",
      failure_stage: null,
      failure_message: null,
      observations_deleted: 6,
      request_executions_deleted: 3,
      benchmark_runs_deleted: 3,
      benchmark_samples_deleted: 3,
      cost_facts_deleted: 0,
      optimization_facts_deleted: 0,
      control_plane_action_events_deleted: 0,
      config_mutation_events_deleted: 0,
      config_snapshots_deleted: 0,
      total_deleted: 15
    });
    assert.equal(deleteCallCounts.observations, 6);
    assert.equal(deleteCallCounts.requestExecutions, 3);
    assert.equal(deleteCallCounts.benchmarkRuns, 3);

    assert.equal(service.listRecentObservations({ limit: 20 }).length, 2);
    assert.equal(service.getRequestExecution("req-new-prune-batch")?.request_id, "req-new-prune-batch");
    const remainingBenchmarkRunCount = (
      store.db.prepare("SELECT COUNT(*) as count FROM benchmark_runs").get() as { count?: number } | undefined
    )?.count;
    assert.equal(remainingBenchmarkRunCount, 0);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability prune rolls back all deletions when a later phase fails inside one transaction", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-partial-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(makeObservationForRequest("req-old-partial-prune", "2026-04-01T10:00:00.000Z", "request_received"));
    service.recordObservation(
      makeObservationForRequest("req-old-partial-prune", "2026-04-01T10:00:00.100Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );

    const oldRequestExecution = service.getRequestExecution("req-old-partial-prune");
    assert.ok(oldRequestExecution);

    service.benchmarks.createRun({
      id: "bench-old-partial-prune",
      name: "bench-old-partial-prune",
      created_at: "2026-04-01T10:05:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-old-partial-prune-sample",
      benchmark_run_id: "bench-old-partial-prune",
      request_execution_id: oldRequestExecution.id,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-01T10:05:01.000Z",
      completed_at: "2026-04-01T10:05:01.100Z",
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
    });

    const originalDeleteRows = (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows;
    (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows = (sql: string, ...parameters: unknown[]) => {
      if (sql.includes("DELETE FROM observations")) {
        throw new Error("synthetic_observation_prune_failure");
      }

      return originalDeleteRows.call(service, sql, ...parameters);
    };

    const result = service.pruneOlderThan("2026-04-10T00:00:00.000Z");

    (service as unknown as {
      deleteRows: (sql: string, ...parameters: unknown[]) => number;
    }).deleteRows = originalDeleteRows;

    assert.equal(result.status, "partial");
    assert.equal(result.failure_stage, "observations");
    assert.equal(result.failure_message, "synthetic_observation_prune_failure");
    assert.equal(result.request_executions_deleted, 0);
    assert.equal(result.benchmark_runs_deleted, 0);
    assert.equal(result.observations_deleted, 0);
    assert.equal(service.getRequestExecution("req-old-partial-prune")?.request_id, "req-old-partial-prune");
    assert.ok(service.benchmarks.getRun("bench-old-partial-prune"));
    assert.equal(service.listObservationsByRequestId("req-old-partial-prune", 20).length, 2);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store cascades direct request execution deletes into dependent tables", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-cascade-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    seedSuccessfulRequest(service, "req-cascade");
    const requestExecution = service.getRequestExecution("req-cascade");
    assert.ok(requestExecution);

    service.benchmarks.createRun({
      id: "bench-cascade",
      name: "bench-cascade",
      created_at: "2026-04-18T10:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-cascade-sample",
      benchmark_run_id: "bench-cascade",
      request_execution_id: requestExecution.id,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T10:00:01.000Z",
      completed_at: "2026-04-18T10:00:01.100Z",
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
    });
    store.db.prepare(
      `
        INSERT INTO cost_facts (
          id,
          request_execution_id,
          observed_at,
          currency,
          estimated_cost_micros,
          cost_fact_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run("cost-cascade", requestExecution.id, "2026-04-18T10:00:02.000Z", "USD", 1000, "estimated");
    store.db.prepare(
      `
        INSERT INTO optimization_facts (
          id,
          observed_at,
          request_execution_id,
          outcome
        ) VALUES (?, ?, ?, ?)
      `
    ).run("optimization-cascade", "2026-04-18T10:00:03.000Z", requestExecution.id, "accepted");

    store.db.prepare("DELETE FROM request_executions WHERE id = ?").run(requestExecution.id);

    const remainingBenchmarkSamples = store.db
      .prepare("SELECT COUNT(*) AS count FROM benchmark_samples WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingCostFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM cost_facts WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingOptimizationFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM optimization_facts WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };

    assert.equal(remainingBenchmarkSamples.count, 0);
    assert.equal(remainingCostFacts.count, 0);
    assert.equal(remainingOptimizationFacts.count, 0);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability prune explicitly deletes benchmark samples linked by request execution id", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-cascade-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    seedSuccessfulRequest(service, "req-prune-cascade");
    const requestExecution = service.getRequestExecution("req-prune-cascade");
    assert.ok(requestExecution);

    service.benchmarks.createRun({
      id: "bench-prune-cascade",
      name: "bench-prune-cascade",
      created_at: "2026-04-01T00:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-prune-cascade-sample",
      benchmark_run_id: "bench-prune-cascade",
      request_execution_id: requestExecution.id,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T10:00:01.000Z",
      completed_at: "2026-04-18T10:00:01.100Z",
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
    });

    const pruneResult = service.pruneOlderThan("2026-04-19T00:00:00.000Z");
    const remainingSampleCount = (
      store.db.prepare("SELECT COUNT(*) AS count FROM benchmark_samples WHERE request_execution_id = ?").get(requestExecution.id) as
        | { count?: number }
        | undefined
    )?.count;

    assert.equal(pruneResult.request_executions_deleted, 1);
    assert.equal(pruneResult.benchmark_samples_deleted, 1);
    assert.equal(remainingSampleCount, 0);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability prune still removes retained rows when foreign-key cascade is disabled on the connection", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-prune-no-fk-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    seedSuccessfulRequest(service, "req-prune-no-fk");
    const requestExecution = service.getRequestExecution("req-prune-no-fk");
    assert.ok(requestExecution);

    service.benchmarks.createRun({
      id: "bench-prune-no-fk",
      name: "bench-prune-no-fk",
      created_at: "2026-04-01T00:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "bench-prune-no-fk-sample",
      benchmark_run_id: "bench-prune-no-fk",
      request_execution_id: requestExecution.id,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-01T10:00:01.000Z",
      completed_at: "2026-04-01T10:00:01.100Z",
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
    });

    store.db.prepare(
      `
        INSERT INTO cost_facts (
          id,
          request_execution_id,
          observed_at,
          currency,
          estimated_cost_micros,
          cost_fact_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run("cost-prune-no-fk", requestExecution.id, "2026-04-01T10:00:02.000Z", "USD", 1000, "estimated");

    store.db.prepare(
      `
        INSERT INTO optimization_facts (
          id,
          observed_at,
          request_execution_id,
          outcome
        ) VALUES (?, ?, ?, ?)
      `
    ).run("optimization-prune-no-fk", "2026-04-01T10:00:03.000Z", requestExecution.id, "accepted");

    store.db.exec("PRAGMA foreign_keys = OFF");

    const result = service.pruneOlderThan("2026-04-19T00:00:00.000Z");
    assert.equal(result.status, "completed");
    assert.equal(result.failure_stage, null);
    assert.equal(result.failure_message, null);
    assert.equal(result.request_executions_deleted, 1);
    assert.equal(result.benchmark_runs_deleted, 1);
    assert.equal(result.benchmark_samples_deleted, 1);
    assert.equal(result.cost_facts_deleted, 1);
    assert.equal(result.optimization_facts_deleted, 1);
    assert.equal(result.observations_deleted, 7);

    const remainingRequestExecutions = store.db
      .prepare("SELECT COUNT(*) AS count FROM request_executions WHERE id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingBenchmarkRuns = store.db
      .prepare("SELECT COUNT(*) AS count FROM benchmark_runs WHERE id = ?")
      .get("bench-prune-no-fk") as { count: number };
    const remainingBenchmarkSamples = store.db
      .prepare("SELECT COUNT(*) AS count FROM benchmark_samples WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingCostFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM cost_facts WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingOptimizationFacts = store.db
      .prepare("SELECT COUNT(*) AS count FROM optimization_facts WHERE request_execution_id = ?")
      .get(requestExecution.id) as { count: number };
    const remainingObservations = store.db
      .prepare("SELECT COUNT(*) AS count FROM observations WHERE request_id = ?")
      .get("req-prune-no-fk") as { count: number };

    assert.equal(remainingRequestExecutions.count, 0);
    assert.equal(remainingBenchmarkRuns.count, 0);
    assert.equal(remainingBenchmarkSamples.count, 0);
    assert.equal(remainingCostFacts.count, 0);
    assert.equal(remainingOptimizationFacts.count, 0);
    assert.equal(remainingObservations.count, 0);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
