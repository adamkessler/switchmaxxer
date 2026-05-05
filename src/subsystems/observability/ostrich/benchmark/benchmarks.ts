import type { DatabaseSync } from "node:sqlite";

import type { BenchmarkRunStatus, ObservationOutcome } from "../../types";
import { assertIsoTimestampString, assertNullableIsoTimestampString } from "../../timestamps";

export interface BenchmarkRunRecord {
  id: string;
  name: string;
  created_at: string;
  created_by: string | null;
  objective: string;
  notes: string | null;
  settings_json: string;
  status: BenchmarkRunStatus;
}

export interface BenchmarkSampleRecord {
  id: string;
  benchmark_run_id: string;
  request_execution_id: string;
  route_id: string | null;
  provider_id: string | null;
  provider_model_id: string | null;
  sample_index: number;
  started_at: string;
  completed_at: string | null;
  status_code: number | null;
  outcome: ObservationOutcome;
  latency_ms: number | null;
  ttft_ms: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_micros: number | null;
  is_warmup: number;
  score_value: number | null;
  score_scale: string | null;
  score_direction: string | null;
  score_source: string | null;
  score_method: string | null;
  scored_at: string | null;
  score_json: string | null;
}

export interface BenchmarkRunSummary {
  total_samples: number;
  measured_samples: number;
  warmup_samples: number;
  success_count: number;
  failed_count: number;
  average_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  average_ttft_ms: number | null;
  average_duration_ms: number | null;
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Benchmark field '${fieldName}' must be a non-empty string.`);
  }
}

function assertNullableNonNegativeInteger(value: unknown, fieldName: string): void {
  if (typeof value === "undefined" || value === null) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Benchmark field '${fieldName}' must be a non-negative integer when present.`);
  }
}

function validateRun(record: BenchmarkRunRecord): void {
  assertNonEmptyString(record.id, "id");
  assertNonEmptyString(record.name, "name");
  assertIsoTimestampString(record.created_at, "created_at", "Benchmark");
  assertNonEmptyString(record.objective, "objective");
  assertNonEmptyString(record.settings_json, "settings_json");
  assertNonEmptyString(record.status, "status");
}

function validateBenchmarkRunRow(row: unknown): BenchmarkRunRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Benchmark run row must be an object.");
  }

  const record = row as BenchmarkRunRecord;
  validateRun(record);
  return record;
}

function validateSample(record: BenchmarkSampleRecord): void {
  assertNonEmptyString(record.id, "id");
  assertNonEmptyString(record.benchmark_run_id, "benchmark_run_id");
  assertNonEmptyString(record.request_execution_id, "request_execution_id");
  assertIsoTimestampString(record.started_at, "started_at", "Benchmark");
  assertNullableIsoTimestampString(record.completed_at, "completed_at", "Benchmark");
  assertNullableIsoTimestampString(record.scored_at, "scored_at", "Benchmark");
  assertNonEmptyString(record.outcome, "outcome");
  assertNullableNonNegativeInteger(record.sample_index, "sample_index");
  assertNullableNonNegativeInteger(record.status_code, "status_code");
  assertNullableNonNegativeInteger(record.latency_ms, "latency_ms");
  assertNullableNonNegativeInteger(record.ttft_ms, "ttft_ms");
  assertNullableNonNegativeInteger(record.duration_ms, "duration_ms");
  assertNullableNonNegativeInteger(record.input_tokens, "input_tokens");
  assertNullableNonNegativeInteger(record.output_tokens, "output_tokens");
  assertNullableNonNegativeInteger(record.total_tokens, "total_tokens");
  assertNullableNonNegativeInteger(record.estimated_cost_micros, "estimated_cost_micros");
}

function validateBenchmarkSampleRow(row: unknown): BenchmarkSampleRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Benchmark sample row must be an object.");
  }

  const record = row as BenchmarkSampleRecord;
  validateSample(record);
  return record;
}

export class BenchmarkRepository {
  private readonly insertRunStatement;
  private readonly insertSampleStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertRunStatement = this.db.prepare(`
      INSERT INTO benchmark_runs (
        id,
        name,
        created_at,
        created_by,
        objective,
        notes,
        settings_json,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertSampleStatement = this.db.prepare(`
      INSERT INTO benchmark_samples (
        id,
        benchmark_run_id,
        request_execution_id,
        route_id,
        provider_id,
        provider_model_id,
        sample_index,
        started_at,
        completed_at,
        status_code,
        outcome,
        latency_ms,
        ttft_ms,
        duration_ms,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost_micros,
        is_warmup,
        score_value,
        score_scale,
        score_direction,
        score_source,
        score_method,
        scored_at,
        score_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  createRun(record: BenchmarkRunRecord): void {
    validateRun(record);
    this.insertRunStatement.run(
      record.id,
      record.name,
      record.created_at,
      record.created_by,
      record.objective,
      record.notes,
      record.settings_json,
      record.status
    );
  }

  updateRunStatus(runId: string, status: BenchmarkRunStatus): void {
    assertNonEmptyString(runId, "runId");
    assertNonEmptyString(status, "status");
    this.db.prepare("UPDATE benchmark_runs SET status = ? WHERE id = ?").run(status, runId);
  }

  insertSample(record: BenchmarkSampleRecord): void {
    validateSample(record);
    this.insertSampleStatement.run(
      record.id,
      record.benchmark_run_id,
      record.request_execution_id,
      record.route_id,
      record.provider_id,
      record.provider_model_id,
      record.sample_index,
      record.started_at,
      record.completed_at,
      record.status_code,
      record.outcome,
      record.latency_ms,
      record.ttft_ms,
      record.duration_ms,
      record.input_tokens,
      record.output_tokens,
      record.total_tokens,
      record.estimated_cost_micros,
      record.is_warmup,
      record.score_value,
      record.score_scale,
      record.score_direction,
      record.score_source,
      record.score_method,
      record.scored_at,
      record.score_json
    );
  }

  getRun(runId: string): BenchmarkRunRecord | null {
    assertNonEmptyString(runId, "runId");
    return (this.db.prepare("SELECT * FROM benchmark_runs WHERE id = ?").get(runId) as BenchmarkRunRecord | undefined) ?? null;
  }

  listRuns(limit = 25): BenchmarkRunRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return this.db
      .prepare("SELECT * FROM benchmark_runs ORDER BY created_at DESC LIMIT ?")
      .all(safeLimit)
      .map((row) => validateBenchmarkRunRow(row));
  }

  listSamplesByRun(runId: string): BenchmarkSampleRecord[] {
    assertNonEmptyString(runId, "runId");
    return this.db
      .prepare("SELECT * FROM benchmark_samples WHERE benchmark_run_id = ? ORDER BY sample_index ASC")
      .all(runId)
      .map((row) => validateBenchmarkSampleRow(row));
  }

  listSamplesByRequestExecutionId(requestExecutionId: string): BenchmarkSampleRecord[] {
    assertNonEmptyString(requestExecutionId, "requestExecutionId");
    return this.db
      .prepare("SELECT * FROM benchmark_samples WHERE request_execution_id = ? ORDER BY sample_index ASC")
      .all(requestExecutionId)
      .map((row) => validateBenchmarkSampleRow(row));
  }

  summarizeRun(runId: string): BenchmarkRunSummary {
    assertNonEmptyString(runId, "runId");
    const row = this.db.prepare(
      `
        SELECT
          COUNT(*) AS total_samples,
          SUM(CASE WHEN is_warmup = 0 THEN 1 ELSE 0 END) AS measured_samples,
          SUM(CASE WHEN is_warmup = 1 THEN 1 ELSE 0 END) AS warmup_samples,
          SUM(CASE WHEN is_warmup = 0 AND outcome = 'succeeded' THEN 1 ELSE 0 END) AS success_count,
          SUM(CASE WHEN is_warmup = 0 AND outcome != 'succeeded' THEN 1 ELSE 0 END) AS failed_count,
          AVG(CASE WHEN is_warmup = 0 THEN latency_ms END) AS average_latency_ms,
          MIN(CASE WHEN is_warmup = 0 THEN latency_ms END) AS min_latency_ms,
          MAX(CASE WHEN is_warmup = 0 THEN latency_ms END) AS max_latency_ms,
          AVG(CASE WHEN is_warmup = 0 THEN ttft_ms END) AS average_ttft_ms,
          AVG(CASE WHEN is_warmup = 0 THEN duration_ms END) AS average_duration_ms
        FROM benchmark_samples
        WHERE benchmark_run_id = ?
      `
    ).get(runId) as
      | {
          total_samples?: number | null;
          measured_samples?: number | null;
          warmup_samples?: number | null;
          success_count?: number | null;
          failed_count?: number | null;
          average_latency_ms?: number | null;
          min_latency_ms?: number | null;
          max_latency_ms?: number | null;
          average_ttft_ms?: number | null;
          average_duration_ms?: number | null;
        }
      | undefined;

    return {
      total_samples: row?.total_samples ?? 0,
      measured_samples: row?.measured_samples ?? 0,
      warmup_samples: row?.warmup_samples ?? 0,
      success_count: row?.success_count ?? 0,
      failed_count: row?.failed_count ?? 0,
      average_latency_ms: row?.average_latency_ms ?? null,
      min_latency_ms: row?.min_latency_ms ?? null,
      max_latency_ms: row?.max_latency_ms ?? null,
      average_ttft_ms: row?.average_ttft_ms ?? null,
      average_duration_ms: row?.average_duration_ms ?? null
    };
  }
}
