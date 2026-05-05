import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { executeBenchmarkTask } from "../bench/bench-runtime";
import { loadConfig } from "../config/config";
import { writeConfigJsonDocumentAtomically } from "../config/config-file";
import { splitExistingConfigFileForTests } from "../config/config-file.test-support";
import { HARD_MAX_JSON_SERIALIZED_BYTES } from "../../platform/json-bounds";
import { loadCliReadModel } from "../config/read-model";
import { SecretString } from "../../platform/secret-string";
import type { AppConfig, RouteConfig } from "../../platform/types";
import type { BenchmarkSampleRecord } from "./benchmarks";
import {
  benchmarkExecutionViewFromSettings,
  buildBenchmarkReportView,
  summarizeBenchmarkSamplesByPath,
  toBenchmarkRunView,
  toBenchmarkSampleView,
  toTraceObservationView,
  toTraceSummaryView
} from "./contracts";
import { ObservabilityService } from "./service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import { makeObservation, seedSuccessfulRequest } from "./test-helpers";

function seedOrphanRequestExecutionSummary(db: DatabaseSync, requestId: string): void {
  db.prepare(
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
    `${requestId}-summary`,
    requestId,
    "2026-04-18T12:20:00.000Z",
    null,
    "2026-04-18T12:20:00.000Z",
    "openai-completions",
    "failed",
    0,
    0
  );
}

void test("trace contract serializers expose the supported v1 shape", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-cli-contract-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-trace-contract");

    service.benchmarks.createRun({
      id: "bench-run-contract",
      name: "contract-run",
      created_at: "2026-04-18T14:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        route_names: ["route-alpha"],
        path_mode: "gateway"
      }),
      status: "completed"
    });

    service.benchmarks.insertSample({
      id: "bench-sample-contract",
      benchmark_run_id: "bench-run-contract",
      request_execution_id: "req-trace-contract",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T14:00:00.000Z",
      completed_at: "2026-04-18T14:00:00.090Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 90,
      ttft_ms: 20,
      duration_ms: 90,
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      estimated_cost_micros: 1234,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: JSON.stringify({
        contract: true
      })
    });

    const trace = service.getRequestExecution("req-trace-contract");
    const observations = service.listObservationsByRequestId("req-trace-contract", 50);
    const benchmarkSamples = service.benchmarks.listSamplesByRequestExecutionId("req-trace-contract");

    assert.ok(trace);

    const traceView = toTraceSummaryView(trace);
    assert.deepEqual(Object.keys(traceView), [
      "trace_id",
      "request_id",
      "path",
      "started_at",
      "completed_at",
      "route_id",
      "route_name",
      "provider_id",
      "provider_model_id",
      "client_api_mode",
      "upstream_api_mode",
      "status_code",
      "outcome",
      "observation_count",
      "latency_ms",
      "ttft_ms",
      "duration_ms",
      "gateway_residency_ms",
      "partial_output",
      "failure_stage",
      "failure_reason"
    ]);

    const observationView = toTraceObservationView(observations[0]!);
    assert.deepEqual(Object.keys(observationView), [
      "observation_id",
      "request_id",
      "observed_at",
      "surface",
      "kind",
      "event",
      "stage",
      "outcome",
      "route_id",
      "route_name",
      "provider_id",
      "provider_model_id",
      "client_api_mode",
      "upstream_api_mode",
      "status_code",
      "latency_ms",
      "ttft_ms",
      "duration_ms",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "estimated_cost_micros",
      "currency",
      "message",
      "tags",
      "attributes",
      "attributes_truncated",
      "parse_warnings"
    ]);

    const benchmarkSampleView = toBenchmarkSampleView(benchmarkSamples[0]!);
    assert.deepEqual(Object.keys(benchmarkSampleView), [
      "sample_id",
      "benchmark_run_id",
      "request_execution_id",
      "route_id",
      "provider_id",
      "provider_model_id",
      "sample_index",
      "started_at",
      "completed_at",
      "status_code",
      "outcome",
      "latency_ms",
      "ttft_ms",
      "duration_ms",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "estimated_cost_micros",
      "is_warmup",
      "score",
      "parse_warnings"
    ]);
    assert.deepEqual(Object.keys(benchmarkSampleView["score"] as Record<string, unknown>), [
      "value",
      "scale",
      "direction",
      "source",
      "method",
      "scored_at",
      "details"
    ]);

    const stats = service.getRequestExecutionStats();
    assert.deepEqual(Object.keys(stats), [
      "total_count",
      "partial_output_count",
      "average_gateway_residency_ms",
      "average_upstream_ttft_ms",
      "average_upstream_duration_ms",
      "outcome_counts",
      "top_failing_routes"
    ]);

    const verification = service.verifyRequestExecution("req-trace-contract");
    assert.deepEqual(Object.keys(verification), [
      "request_id",
      "status",
      "observation_count",
      "mismatch_count",
      "mismatches"
    ]);
    assert.equal(verification.status, "ok");

    const repairResult = service.repairRequestExecution("req-trace-contract");
    assert.deepEqual(Object.keys(repairResult), [
      "request_id",
      "action",
      "observation_count",
      "verification"
    ]);
    assert.equal(repairResult.action, "unchanged");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("trace verify and repair contracts cover drifted summaries", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-cli-drift-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-trace-drift");
    store.db
      .prepare("UPDATE request_executions SET status_code = ?, gateway_residency_ms = ? WHERE request_id = ?")
      .run(503, 999, "req-trace-drift");

    const verifyResult = service.verifyRequestExecution("req-trace-drift");
    assert.equal(verifyResult.status, "drift");
    assert.ok(
      verifyResult.mismatches.some(
        (mismatch: { field: string }) => mismatch.field === "status_code"
      )
    );

    const repairResult = service.repairRequestExecution("req-trace-drift");
    assert.equal(repairResult.action, "updated");
    assert.equal(repairResult.verification.status, "ok");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("trace verify and repair support bounded batch processing", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-batch-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-trace-batch-a");
    seedSuccessfulRequest(service, "req-trace-batch-b");

    store.db
      .prepare("UPDATE request_executions SET status_code = ? WHERE request_id = ?")
      .run(503, "req-trace-batch-a");
    store.db
      .prepare("UPDATE request_executions SET gateway_residency_ms = ? WHERE request_id = ?")
      .run(999, "req-trace-batch-b");

    const verifyResults = service.verifyAllRequestExecutions({ batchSize: 1 });
    assert.equal(verifyResults.length, 2);
    assert.equal(verifyResults.filter((result) => result.status === "drift").length, 2);

    const repairResults = service.repairAllRequestExecutions({ batchSize: 1 });
    assert.equal(repairResults.length, 2);
    assert.equal(repairResults.filter((result) => result.verification.status === "ok").length, 2);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("trace repair all keyset pagination does not skip adjacent orphan-summary deletions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-repair-keyset-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    seedOrphanRequestExecutionSummary(store.db, "req-trace-orphan-a");
    seedOrphanRequestExecutionSummary(store.db, "req-trace-orphan-b");

    const materializerRepairResults = service.requestExecutions.repairAll(1);
    assert.equal(materializerRepairResults.length, 2);
    assert.deepEqual(
      materializerRepairResults.map((result) => result.action),
      ["deleted", "deleted"]
    );
    assert.equal(service.getRequestExecution("req-trace-orphan-a"), null);
    assert.equal(service.getRequestExecution("req-trace-orphan-b"), null);

    seedOrphanRequestExecutionSummary(store.db, "req-trace-orphan-c");
    seedOrphanRequestExecutionSummary(store.db, "req-trace-orphan-d");

    const serviceRepairResults = service.repairAllRequestExecutions({ batchSize: 1 });
    assert.equal(serviceRepairResults.length, 2);
    assert.deepEqual(
      serviceRepairResults.map((result) => result.action),
      ["deleted", "deleted"]
    );
    assert.equal(service.getRequestExecution("req-trace-orphan-c"), null);
    assert.equal(service.getRequestExecution("req-trace-orphan-d"), null);
    assert.deepEqual(service.requestExecutions.listKnownRequestIdsAfter({ limit: 10 }), []);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("known request id listing defaults to the bounded batch size when limit is omitted", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-trace-known-ids-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    for (let index = 0; index < 600; index += 1) {
      seedSuccessfulRequest(service, `req-known-${String(index).padStart(4, "0")}`);
    }

    const firstPage = service.requestExecutions.listKnownRequestIds();
    const secondPage = service.requestExecutions.listKnownRequestIds({ offset: firstPage.length });

    assert.equal(firstPage.length, 500);
    assert.equal(secondPage.length, 100);
    assert.equal(firstPage[0], "req-known-0000");
    assert.equal(firstPage.at(-1), "req-known-0499");
    assert.equal(secondPage[0], "req-known-0500");
    assert.equal(secondPage.at(-1), "req-known-0599");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("benchmark report contract serializers expose the supported v1 shape", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-bench-contract-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-bench-contract");

    service.benchmarks.createRun({
      id: "bench-run-shape",
      name: "bench-shape",
      created_at: "2026-04-18T15:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        requested_path_mode: "both",
        effective_path_mode: "direct",
        effective_paths: ["direct"],
        skipped_paths: ["gateway"],
        warnings: [
          {
            code: "gateway_unavailable",
            message: "Skipping gateway benchmark path: fetch failed",
            path: "gateway"
          }
        ]
      }),
      status: "completed"
    });

    service.benchmarks.insertSample({
      id: "bench-sample-shape",
      benchmark_run_id: "bench-run-shape",
      request_execution_id: "req-bench-contract",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T15:00:00.000Z",
      completed_at: "2026-04-18T15:00:00.090Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 90,
      ttft_ms: 20,
      duration_ms: 90,
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      estimated_cost_micros: 1234,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: JSON.stringify({
        path: "direct",
        reason: null
      })
    });

    const run = service.benchmarks.getRun("bench-run-shape");
    const summary = service.benchmarks.summarizeRun("bench-run-shape");
    const rawSamples = service.benchmarks.listSamplesByRun("bench-run-shape");
    assert.ok(run);

    const runView = toBenchmarkRunView(run, summary);
    const sampleViews = rawSamples.map((sample) => toBenchmarkSampleView(sample));
    const execution = benchmarkExecutionViewFromSettings(runView["settings"]);
    const byPath = summarizeBenchmarkSamplesByPath(rawSamples);
    const report = buildBenchmarkReportView({
      store_path: dbPath,
      run: runView,
      summary,
      rawSamples,
      samples: sampleViews
    });

    assert.deepEqual(Object.keys(execution), [
      "requested_path_mode",
      "effective_paths",
      "skipped_paths",
      "warnings"
    ]);
    assert.equal(execution.requested_path_mode, "both");
    assert.deepEqual(execution.effective_paths, ["direct"]);
    assert.deepEqual(execution.skipped_paths, ["gateway"]);

    assert.equal(byPath.length, 1);
    assert.deepEqual(Object.keys(byPath[0]!), [
      "path",
      "total_samples",
      "measured_samples",
      "warmup_samples",
      "success_count",
      "failed_count",
      "average_latency_ms",
      "average_ttft_ms",
      "average_duration_ms",
      "warmup_latency_ms",
      "warmup_median_latency_ms",
      "warmup_max_latency_ms",
      "last_warmup_latency_ms",
      "first_measured_latency_ms",
      "first_measured_suspect"
    ]);
    assert.equal(byPath[0]!.path, "direct");

    assert.deepEqual(Object.keys(report), [
      "run",
      "execution",
      "summary",
      "analysis",
      "samples",
      "store_path"
    ]);
    assert.deepEqual(Object.keys(report.execution), [
      "requested_path_mode",
      "effective_paths",
      "skipped_paths",
      "warnings"
    ]);
    assert.deepEqual(Object.keys(report.analysis), ["by_path"]);
    assert.equal(Array.isArray(report.analysis.by_path), true);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("benchmark report surfaces warmup latency details and flags a cold first measured sample", () => {
  const rawSamples: BenchmarkSampleRecord[] = [
    {
      id: "warmup-1",
      benchmark_run_id: "bench-warmup-visibility",
      request_execution_id: "req-warmup-1",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T16:00:00.000Z",
      completed_at: "2026-04-18T16:00:00.050Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 50,
      ttft_ms: null,
      duration_ms: 50,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_micros: null,
      is_warmup: 1,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: JSON.stringify({ path: "direct" })
    },
    {
      id: "warmup-2",
      benchmark_run_id: "bench-warmup-visibility",
      request_execution_id: "req-warmup-2",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 1,
      started_at: "2026-04-18T16:00:01.000Z",
      completed_at: "2026-04-18T16:00:01.030Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 30,
      ttft_ms: null,
      duration_ms: 30,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_micros: null,
      is_warmup: 1,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: JSON.stringify({ path: "direct" })
    },
    {
      id: "measured-1",
      benchmark_run_id: "bench-warmup-visibility",
      request_execution_id: "req-measured-1",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 2,
      started_at: "2026-04-18T16:00:02.000Z",
      completed_at: "2026-04-18T16:00:02.120Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 120,
      ttft_ms: null,
      duration_ms: 120,
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
      score_json: JSON.stringify({ path: "direct" })
    },
    {
      id: "measured-2",
      benchmark_run_id: "bench-warmup-visibility",
      request_execution_id: "req-measured-2",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 3,
      started_at: "2026-04-18T16:00:03.000Z",
      completed_at: "2026-04-18T16:00:03.040Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 40,
      ttft_ms: null,
      duration_ms: 40,
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
      score_json: JSON.stringify({ path: "direct" })
    },
    {
      id: "measured-3",
      benchmark_run_id: "bench-warmup-visibility",
      request_execution_id: "req-measured-3",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 4,
      started_at: "2026-04-18T16:00:04.000Z",
      completed_at: "2026-04-18T16:00:04.050Z",
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
      score_json: JSON.stringify({ path: "direct" })
    }
  ];

  const byPath = summarizeBenchmarkSamplesByPath(rawSamples);

  assert.equal(byPath.length, 1);
  assert.deepEqual(byPath[0]!.warmup_latency_ms, [50, 30]);
  assert.equal(byPath[0]!.warmup_median_latency_ms, 40);
  assert.equal(byPath[0]!.warmup_max_latency_ms, 50);
  assert.equal(byPath[0]!.last_warmup_latency_ms, 30);
  assert.equal(byPath[0]!.first_measured_latency_ms, 120);
  assert.equal(byPath[0]!.first_measured_suspect, true);
});

void test("benchmark report contract preserves degraded both-path warning metadata", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-bench-warning-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, "req-bench-warning");

    service.benchmarks.createRun({
      id: "bench-run-warning",
      name: "bench-warning",
      created_at: "2026-04-18T15:05:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({
        requested_path_mode: "both",
        effective_path_mode: "direct",
        effective_paths: ["direct"],
        skipped_paths: ["gateway"],
        warnings: [
          {
            code: "gateway_unavailable",
            message: "Skipping gateway benchmark path: Gateway test preflight failed: fetch failed",
            path: "gateway",
            details: {
              health_url: "http://127.0.0.1:4080/health"
            }
          }
        ]
      }),
      status: "completed"
    });

    service.benchmarks.insertSample({
      id: "bench-sample-warning",
      benchmark_run_id: "bench-run-warning",
      request_execution_id: "req-bench-warning",
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T15:05:00.000Z",
      completed_at: "2026-04-18T15:05:00.010Z",
      status_code: null,
      outcome: "failed",
      latency_ms: 10,
      ttft_ms: null,
      duration_ms: 10,
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
        path: "direct",
        reason: "fetch failed",
        failure_kind: "direct_transport_error"
      })
    });

    const run = service.benchmarks.getRun("bench-run-warning");
    const summary = service.benchmarks.summarizeRun("bench-run-warning");
    const rawSamples = service.benchmarks.listSamplesByRun("bench-run-warning");
    assert.ok(run);

    const report = buildBenchmarkReportView({
      run: toBenchmarkRunView(run, summary),
      summary,
      rawSamples
    });

    const execution = report.execution;
    assert.equal(execution.requested_path_mode, "both");
    assert.deepEqual(execution.effective_paths, ["direct"]);
    assert.deepEqual(execution.skipped_paths, ["gateway"]);
    assert.equal(execution.warnings.length, 1);
    assert.equal(execution.warnings[0]!.code, "gateway_unavailable");

    const samples = report.samples as Array<Record<string, unknown>>;
    const score = samples[0]!["score"] as Record<string, unknown>;
    assert.equal((score["details"] as Record<string, unknown>)["failure_kind"], "direct_transport_error");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability contracts surface malformed stored json as parse warnings without failing views", () => {
  const traceView = toTraceObservationView({
    ...makeObservation("2026-04-18T12:20:00.000Z", "request_received"),
    tags_json: "{",
    attributes_json: "[]"
  });
  const traceWarnings = traceView["parse_warnings"] as Array<Record<string, unknown>>;

  assert.equal(traceView["tags"], null);
  assert.deepEqual(traceView["attributes"], {});
  assert.deepEqual(traceWarnings.map((warning) => warning["code"]), [
    "invalid_stored_json",
    "invalid_stored_json_shape"
  ]);

  const runView = toBenchmarkRunView(
    {
      id: "bench-json-warning",
      name: "Bench JSON Warning",
      created_at: "2026-04-18T12:20:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: "{",
      status: "completed"
    },
    {
      total_samples: 0,
      measured_samples: 0,
      warmup_samples: 0,
      success_count: 0,
      failed_count: 0,
      average_latency_ms: null,
      min_latency_ms: null,
      max_latency_ms: null,
      average_ttft_ms: null,
      average_duration_ms: null
    }
  );
  const runWarnings = runView["parse_warnings"] as Array<Record<string, unknown>>;
  assert.equal(runView["settings"], null);
  assert.deepEqual(runWarnings.map((warning) => warning["code"]), ["invalid_stored_json"]);

  const sampleView = toBenchmarkSampleView({
    id: "bench-json-warning-sample",
    benchmark_run_id: "bench-json-warning",
    request_execution_id: "req-json-warning",
    route_id: "route-alpha",
    provider_id: "provider-main",
    provider_model_id: "provider-model-1",
    sample_index: 0,
    started_at: "2026-04-18T12:20:00.000Z",
    completed_at: "2026-04-18T12:20:01.000Z",
    status_code: 200,
    outcome: "succeeded",
    latency_ms: 100,
    ttft_ms: 50,
    duration_ms: 100,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    estimated_cost_micros: 40,
    is_warmup: 0,
    score_value: null,
    score_scale: null,
    score_direction: null,
    score_source: null,
    score_method: null,
    scored_at: null,
    score_json: "{"
  });
  const sampleWarnings = sampleView["parse_warnings"] as Array<Record<string, unknown>>;
  assert.equal((sampleView["score"] as Record<string, unknown>)["details"], null);
  assert.deepEqual(sampleWarnings.map((warning) => warning["code"]), ["invalid_stored_json"]);
});

void test("observability contracts route oversized stored json through the shared parse warning path", () => {
  const oversizedJson = `"${"x".repeat(HARD_MAX_JSON_SERIALIZED_BYTES + 1)}"`;
  const traceView = toTraceObservationView({
    ...makeObservation("2026-04-18T12:20:00.000Z", "request_received"),
    tags_json: oversizedJson
  });
  const traceWarnings = traceView["parse_warnings"] as Array<Record<string, unknown>>;

  assert.equal(traceView["tags"], null);
  assert.deepEqual(traceWarnings.map((warning) => warning["code"]), ["invalid_stored_json"]);
});

void test("observability service rejects malformed attributes json at write time for failure observations", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-attr-warning-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation({
      ...makeObservation("2026-04-18T12:25:00.000Z", "request_received"),
      request_id: "req-attr-warning",
      id: "req-attr-warning-request_received-2026-04-18T12:25:00.000Z"
    });
    assert.throws(
      () =>
        service.recordObservation({
          ...makeObservation("2026-04-18T12:25:01.000Z", "debug_error_context", {
            outcome: "failed"
          }),
          message: null,
          attributes_json: "{",
          request_id: "req-attr-warning",
          id: "req-attr-warning-debug_error_context-2026-04-18T12:25:01.000Z"
        }),
      /Observation field 'attributes_json' exceeds repository JSON bounds/
    );

    assert.equal(service.getRequestExecution("req-attr-warning")?.failure_reason, null);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service rejects malformed attributes json at write time for terminal observations", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-terminal-attr-warning-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation({
      ...makeObservation("2026-04-18T12:30:00.000Z", "request_received"),
      request_id: "req-terminal-attr-warning",
      id: "req-terminal-attr-warning-request_received-2026-04-18T12:30:00.000Z"
    });
    assert.throws(
      () =>
        service.recordObservation({
          ...makeObservation("2026-04-18T12:30:01.000Z", "client_response_completed", {
            outcome: "succeeded",
            statusCode: 200
          }),
          request_id: "req-terminal-attr-warning",
          id: "req-terminal-attr-warning-client_response_completed-2026-04-18T12:30:01.000Z",
          attributes_json: "{"
        }),
      /Observation field 'attributes_json' exceeds repository JSON bounds/
    );

    const requestExecution = service.getRequestExecution("req-terminal-attr-warning");
    assert.ok(requestExecution);
    assert.equal(requestExecution.failure_reason, null);
    assert.equal(requestExecution.partial_output, 0);
    assert.equal(requestExecution.outcome, "started");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("request execution materialization redacts secrets from persisted failure_reason text", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-failure-reason-redaction-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation({
      ...makeObservation("2026-04-18T12:35:00.000Z", "request_received"),
      request_id: "req-redacted-failure-reason",
      id: "req-redacted-failure-reason-request_received-2026-04-18T12:35:00.000Z"
    });
    service.recordObservation({
      ...makeObservation("2026-04-18T12:35:01.000Z", "debug_error_context", {
        outcome: "failed"
      }),
      message: "upstream rejected Bearer sk-secret-value at https://alice:supersecret@example.com/path",
      request_id: "req-redacted-failure-reason",
      id: "req-redacted-failure-reason-debug_error_context-2026-04-18T12:35:01.000Z"
    });

    const requestExecution = service.getRequestExecution("req-redacted-failure-reason");
    assert.ok(requestExecution);
    assert.equal(
      requestExecution.failure_reason,
      "upstream rejected Bearer ***redacted*** at https://***redacted***:***redacted***@example.com/path"
    );
    assert.doesNotMatch(requestExecution.failure_reason ?? "", /sk-secret-value/);
    assert.doesNotMatch(requestExecution.failure_reason ?? "", /supersecret/);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability bootstrap creates the standalone benchmark run id index", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-index-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const row = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_benchmark_samples_run_id") as { name?: string } | undefined;

    assert.equal(row?.name, "idx_benchmark_samples_run_id");

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config writes back up the previous config before replacement and tighten inline-secret configs and backups to 0600", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-mode-test-"));
  const existingConfigPath = path.join(tempDir, "existing-config.json");
  const backupDir = path.join(tempDir, ".switchmaxxer", "catalog-backups");
  const existingConfigBackupPath = path.join(backupDir, "existing-config.json.bak");
  const existingInlineConfigPath = path.join(tempDir, "existing-inline-config.json");
  const existingInlineConfigBackupPath = path.join(backupDir, "existing-inline-config.json.bak");
  const newInlineConfigPath = path.join(tempDir, "new-inline-config.json");
  const originalUmask = process.umask();
  let capturedTempPath: string | null = null;

  try {
    writeFileSync(
      existingConfigPath,
      JSON.stringify(
        {
          service_providers: {},
          routes: {},
          models: {}
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(existingConfigPath, 0o600);

    writeConfigJsonDocumentAtomically(existingConfigPath, {
      service_providers: {},
      routes: {},
      models: {
        mode_test_model: {
          display_name: "Mode Test Model",
          model_creator: "switchmaxxer"
        }
      }
    }, "tmp", (tempPath) => {
      capturedTempPath = tempPath;
    });

    assert.match(capturedTempPath ?? "", /existing-config\.json\.tmp-[0-9a-f]{16}$/);
    assert.doesNotMatch(capturedTempPath ?? "", new RegExp(`-${process.pid}-\\d+$`));

    assert.equal(statSync(existingConfigPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(existingConfigBackupPath, "utf8"), JSON.stringify(
      {
        service_providers: {},
        routes: {},
        models: {}
      },
      null,
      2
    ) + "\n");

    writeFileSync(
      existingInlineConfigPath,
      JSON.stringify(
        {
          service_providers: {},
          routes: {},
          models: {}
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(existingInlineConfigPath, 0o644);

    writeConfigJsonDocumentAtomically(existingInlineConfigPath, {
      service_providers: {
        inline_secret_provider: {
          endpoint: "https://example.invalid/v1",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      routes: {},
      models: {}
    });

    assert.equal(statSync(existingInlineConfigPath).mode & 0o777, 0o600);
    assert.equal(statSync(existingInlineConfigBackupPath).mode & 0o777, 0o644);

    process.umask(0);

    try {
      writeConfigJsonDocumentAtomically(existingInlineConfigPath, {
        service_providers: {
          inline_secret_provider: {
            endpoint: "https://example.invalid/v1",
            api_mode: "openai-completions",
            api_key: "sk-inline-secret-rotated"
          }
        },
        routes: {},
        models: {}
      });
    } finally {
      process.umask(originalUmask);
    }

    assert.equal(statSync(existingInlineConfigPath).mode & 0o777, 0o600);
    assert.equal(statSync(existingInlineConfigBackupPath).mode & 0o777, 0o600);

    writeConfigJsonDocumentAtomically(newInlineConfigPath, {
      service_providers: {
        inline_secret_provider: {
          endpoint: "https://example.invalid/v1",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      routes: {},
      models: {}
    });

    assert.equal(statSync(newInlineConfigPath).mode & 0o777, 0o600);
  } finally {
    process.umask(originalUmask);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("benchmark runtime uses config benchmark defaults for anthropic direct requests", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-benchmark-defaults-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);
  const originalFetch = globalThis.fetch;

  try {
    const config: AppConfig = {
      port: 4080,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
        window: "1s"
      },
      systemdUnit: "switchmaxxer.service",
      observability: {
        retentionOlderThan: null
      },
      benchmark: {
        defaultMaxTokens: 64,
        defaultAnthropicVersion: "2023-06-01"
      },
      sourceFile: "config.json",
      sourcePath: path.join(tempDir, "config.json"),
      routes: {}
    };
    const route: RouteConfig = {
      serviceProvider: "provider-bench-default",
      api_mode: "anthropic-messages",
      anthropicVersion: null,
      modelCreator: "anthropic",
      model: "claude-test-model",
      baseUrl: "https://bench-test.example/anthropic",
      allowPrivateEndpoints: false,
      apiKeyEnv: null,
      inlineApiKey: new SecretString("test-key"),
      routeTimeoutMs: null,
      timeoutMs: 5_000,
      cost: null,
      modelCost: null
    };

    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      assert.equal(headers.get("anthropic-version"), "2023-06-01");
      assert.equal(body["max_tokens"], 64);

      return new Response(
        `${JSON.stringify({
          id: "msg-bench-defaults",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-test-model"
        })}\n`,
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    service.benchmarks.createRun({
      id: "bench-defaults-run",
      name: "bench-defaults-run",
      created_at: "2026-04-18T12:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "direct" }),
      status: "running"
    });

    const { sample, requestExecution } = await executeBenchmarkTask({
      service,
      config,
      routeName: "route-bench-defaults",
      route,
      prompt: "hello",
      benchmarkRunId: "bench-defaults-run",
      task: {
        sampleIndex: 0,
        routeName: "route-bench-defaults",
        path: "direct",
        iteration: 1,
        isWarmup: false
      },
      bindHost: config.bindHost,
      port: config.port,
      createdBy: "test-suite"
    });

    assert.equal(sample.outcome, "succeeded");
    assert.ok(requestExecution);
    assert.equal(requestExecution?.provider_id, "provider-bench-default");
  } finally {
    globalThis.fetch = originalFetch;
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("benchmark runtime brackets IPv6 loopback gateway endpoints", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-benchmark-ipv6-gateway-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);
  const originalFetch = globalThis.fetch;
  let observedUrl: string | null = null;

  try {
    const config: AppConfig = {
      port: 4080,
      bindHost: "::1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
        window: "1s"
      },
      inboundApiKeyEnv: null,
      allowUnauthenticatedGateway: true,
      systemdUnit: "switchmaxxer.service",
      observability: {
        retentionOlderThan: null
      },
      benchmark: {
        defaultMaxTokens: 64,
        defaultAnthropicVersion: "2023-06-01"
      },
      sourceFile: "config.json",
      sourcePath: path.join(tempDir, "config.json"),
      routes: {}
    };
    const route: RouteConfig = {
      serviceProvider: "provider-bench-ipv6",
      api_mode: "openai-completions",
      anthropicVersion: null,
      modelCreator: "openai",
      model: "gpt-test-model",
      baseUrl: "https://bench-test.example/v1",
      allowPrivateEndpoints: false,
      apiKeyEnv: null,
      inlineApiKey: new SecretString("test-key"),
      routeTimeoutMs: null,
      timeoutMs: 5_000,
      cost: null,
      modelCost: null
    };

    globalThis.fetch = (async (input: URL | RequestInfo): Promise<Response> => {
      observedUrl = String(input);

      return new Response("{}\n", {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      });
    }) as typeof fetch;

    service.benchmarks.createRun({
      id: "bench-ipv6-gateway-run",
      name: "bench-ipv6-gateway-run",
      created_at: "2026-04-18T12:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "gateway" }),
      status: "running"
    });

    const { sample } = await executeBenchmarkTask({
      service,
      config,
      routeName: "route-bench-ipv6",
      route,
      prompt: "hello",
      benchmarkRunId: "bench-ipv6-gateway-run",
      task: {
        sampleIndex: 0,
        routeName: "route-bench-ipv6",
        path: "gateway",
        iteration: 1,
        isWarmup: false
      },
      bindHost: config.bindHost,
      port: config.port,
      createdBy: "test-suite"
    });

    assert.equal(observedUrl, "http://[::1]:4080/v1/chat/completions");
    assert.equal(sample.outcome, "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("benchmark runtime bounds gateway and direct response bodies", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-benchmark-response-limit-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const store = bootstrapObservabilityStore({ dbPath });
  const service = new ObservabilityService(store.db);
  const originalFetch = globalThis.fetch;

  try {
    const config: AppConfig = {
      port: 4080,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxBufferedUpstreamResponseBytes: 8,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
        window: "1s"
      },
      inboundApiKeyEnv: null,
      allowUnauthenticatedGateway: true,
      systemdUnit: "switchmaxxer.service",
      observability: {
        retentionOlderThan: null
      },
      benchmark: {
        defaultMaxTokens: 64,
        defaultAnthropicVersion: "2023-06-01"
      },
      sourceFile: "config.json",
      sourcePath: path.join(tempDir, "config.json"),
      routes: {}
    };
    const route: RouteConfig = {
      serviceProvider: "provider-bench-limit",
      api_mode: "openai-completions",
      anthropicVersion: null,
      modelCreator: "openai",
      model: "gpt-test-model",
      baseUrl: "https://bench-test.example/v1",
      allowPrivateEndpoints: false,
      apiKeyEnv: null,
      inlineApiKey: new SecretString("test-key"),
      routeTimeoutMs: null,
      timeoutMs: 5_000,
      cost: null,
      modelCost: null
    };

    globalThis.fetch = (async (): Promise<Response> => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-switchmaxxer-request-id": "req-bench-response-limit"
        }
      }
    )) as typeof fetch;

    service.benchmarks.createRun({
      id: "bench-response-limit-run",
      name: "bench-response-limit-run",
      created_at: "2026-04-18T12:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: JSON.stringify({ requested_path_mode: "both" }),
      status: "running"
    });

    const directResult = await executeBenchmarkTask({
      service,
      config,
      routeName: "route-bench-limit",
      route,
      prompt: "hello",
      benchmarkRunId: "bench-response-limit-run",
      task: {
        sampleIndex: 0,
        routeName: "route-bench-limit",
        path: "direct",
        iteration: 1,
        isWarmup: false
      },
      bindHost: config.bindHost,
      port: config.port,
      createdBy: "test-suite"
    });
    const gatewayResult = await executeBenchmarkTask({
      service,
      config,
      routeName: "route-bench-limit",
      route,
      prompt: "hello",
      benchmarkRunId: "bench-response-limit-run",
      task: {
        sampleIndex: 1,
        routeName: "route-bench-limit",
        path: "gateway",
        iteration: 1,
        isWarmup: false
      },
      bindHost: config.bindHost,
      port: config.port,
      createdBy: "test-suite"
    });

    for (const result of [directResult, gatewayResult]) {
      const details = JSON.parse(result.sample.score_json ?? "{}") as Record<string, unknown>;
      assert.equal(result.sample.outcome, "failed");
      assert.equal(result.sample.status_code, 200);
      assert.equal(details["failure_kind"], `${details["path"]}_response_too_large`);
      assert.equal(details["max_response_bytes"], 8);
      assert.equal(details["response_bytes_read"], 12);
      assert.match(String(details["reason"]), /Benchmark .* response exceeded 8 bytes/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    closeObservabilityStore(store);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadCliReadModel and loadConfig reject reserved config entity names", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-reserved-key-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(
      configPath,
      `{
  "port": 4080,
  "bind_host": "127.0.0.1",
  "timeout_ms": 15000,
  "stream_idle_timeout_ms": 120000,
  "shutdown_timeout_ms": 30000,
  "max_connections": 200,
  "max_payload_size": 4000000,
  "rate_limit": {
    "requests": 50,
    "window": "1s"
  },
  "allow_unauthenticated_gateway": true,
  "service_providers": {
    "__proto__": {
      "endpoint": "https://api.example.com/v1",
      "api_mode": "openai-completions",
      "api_key_env": "SWITCHMAXXER_EXAMPLE_API_KEY"
    }
  },
  "models": {
    "safe-model": {
      "display_name": "Safe Model",
      "model_creator": "example"
    }
  },
  "routes": {
    "safe-route": {
      "model": "safe-model",
      "service_provider": "__proto__",
      "provider_model_id": "safe-model",
      "display_name": "Safe Route"
    }
  }
}
`,
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    assert.throws(() => loadCliReadModel(configPath), /Provider name '__proto__' is reserved and cannot be used\./);
    assert.throws(() => loadConfig(configPath), /Provider name '__proto__' is reserved and cannot be used\./);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("loadConfig rejects unknown config keys and exposes benchmark defaults", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-unknown-key-"));
  const badConfigPath = path.join(tempDir, "bad-config.json");
  const goodConfigPath = path.join(tempDir, "good-config.json");

  try {
    writeFileSync(
      badConfigPath,
      `{
  "port": 4080,
  "bind_host": "127.0.0.1",
  "timeout_ms": 15000,
  "stream_idle_timeout_ms": 120000,
  "shutdown_timeout_ms": 30000,
  "max_connections": 200,
  "max_payload_siz": 4000000,
  "service_providers": {
    "example-provider": {
      "endpoint": "https://api.example.com/v1",
      "api_mode": "openai-completions",
      "api_key_env": "SWITCHMAXXER_EXAMPLE_API_KEY"
    }
  },
  "models": {
    "example-model": {
      "display_name": "Example Model",
      "model_creator": "example"
    }
  },
  "routes": {
    "example-route": {
      "model": "example-model",
      "service_provider": "example-provider",
      "provider_model_id": "example-model",
      "display_name": "Example Route"
    }
  }
}
`,
      "utf8"
    );
    chmodSync(badConfigPath, 0o600);
    splitExistingConfigFileForTests(badConfigPath);

    writeFileSync(
      goodConfigPath,
      `{
  "port": 4080,
  "bind_host": "127.0.0.1",
  "timeout_ms": 15000,
  "stream_idle_timeout_ms": 120000,
  "shutdown_timeout_ms": 30000,
  "max_connections": 200,
  "max_payload_size": 4000000,
  "rate_limit": {
    "requests": 50,
    "window": "1s"
  },
  "allow_unauthenticated_gateway": true,
  "benchmark": {
    "default_max_tokens": 64,
    "default_anthropic_version": "2023-06-01"
  },
  "service_providers": {
    "example-provider": {
      "endpoint": "https://api.example.com/v1",
      "api_mode": "anthropic-messages",
      "api_key": null,
      "api_key_env": null
    }
  },
  "models": {
    "example-model": {
      "display_name": "Example Model",
      "model_creator": "example"
    }
  },
  "routes": {
    "example-route": {
      "model": "example-model",
      "service_provider": "example-provider",
      "provider_model_id": "example-model",
      "display_name": "Example Route"
    }
  }
}
`,
      "utf8"
    );
    chmodSync(goodConfigPath, 0o600);
    splitExistingConfigFileForTests(goodConfigPath);

    assert.throws(() => loadConfig(badConfigPath), /contains unsupported field 'max_payload_siz'/);

    const config = loadConfig(goodConfigPath);
    assert.equal(config.benchmark.defaultMaxTokens, 64);
    assert.equal(config.benchmark.defaultAnthropicVersion, "2023-06-01");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
