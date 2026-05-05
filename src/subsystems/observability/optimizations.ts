import type { DatabaseSync } from "node:sqlite";

import { parseJsonTextWithWarning, type StoredJsonParseWarning } from "./json-parse";
import { assertIsoTimestampString, assertNullableIsoTimestampString } from "./timestamps";

export type OptimizationRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface OptimizationRunRecord {
  id: string;
  created_at: string;
  finished_at: string | null;
  created_by: string;
  target_model: string;
  objective: string;
  status: OptimizationRunStatus;
  winner_route: string | null;
  benchmark_run_id: string | null;
  settings_json: string;
  candidate_snapshot_json: string;
  result_json: string;
  warnings_json: string;
}

export interface OptimizationRunView {
  run_id: string;
  created_at: string;
  finished_at: string | null;
  created_by: string;
  target_model: string;
  objective: string;
  status: OptimizationRunStatus;
  winner_route: string | null;
  benchmark_run_id: string | null;
  settings: unknown;
  candidate_snapshot: unknown;
  result: unknown;
  warnings: unknown;
  parse_warnings: StoredJsonParseWarning[];
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Optimization field '${fieldName}' must be a non-empty string.`);
  }
}

function assertNullableNonEmptyString(value: unknown, fieldName: string): asserts value is string | null {
  if (value === null) {
    return;
  }

  assertNonEmptyString(value, fieldName);
}

function validateOptimizationRun(record: OptimizationRunRecord): void {
  assertNonEmptyString(record.id, "id");
  assertIsoTimestampString(record.created_at, "created_at", "Optimization");
  assertNullableIsoTimestampString(record.finished_at, "finished_at", "Optimization");
  assertNonEmptyString(record.created_by, "created_by");
  assertNonEmptyString(record.target_model, "target_model");
  assertNonEmptyString(record.objective, "objective");
  assertNonEmptyString(record.status, "status");
  assertNullableNonEmptyString(record.winner_route, "winner_route");
  assertNullableNonEmptyString(record.benchmark_run_id, "benchmark_run_id");
  assertNonEmptyString(record.settings_json, "settings_json");
  assertNonEmptyString(record.candidate_snapshot_json, "candidate_snapshot_json");
  assertNonEmptyString(record.result_json, "result_json");
  assertNonEmptyString(record.warnings_json, "warnings_json");
}

function validateOptimizationRunRow(row: unknown): OptimizationRunRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Optimization run row must be an object.");
  }

  const record = row as OptimizationRunRecord;
  validateOptimizationRun(record);
  return record;
}

export function toOptimizationRunView(record: OptimizationRunRecord): OptimizationRunView {
  const settings = parseJsonTextWithWarning(record.settings_json, "optimization_runs.settings_json");
  const candidateSnapshot = parseJsonTextWithWarning(
    record.candidate_snapshot_json,
    "optimization_runs.candidate_snapshot_json"
  );
  const result = parseJsonTextWithWarning(record.result_json, "optimization_runs.result_json");
  const warnings = parseJsonTextWithWarning(record.warnings_json, "optimization_runs.warnings_json");

  return {
    run_id: record.id,
    created_at: record.created_at,
    finished_at: record.finished_at,
    created_by: record.created_by,
    target_model: record.target_model,
    objective: record.objective,
    status: record.status,
    winner_route: record.winner_route,
    benchmark_run_id: record.benchmark_run_id,
    settings: settings.value,
    candidate_snapshot: candidateSnapshot.value,
    result: result.value,
    warnings: warnings.value,
    parse_warnings: [
      ...settings.warnings,
      ...candidateSnapshot.warnings,
      ...result.warnings,
      ...warnings.warnings
    ]
  };
}

export class OptimizationRepository {
  private readonly insertRunStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertRunStatement = this.db.prepare(`
      INSERT INTO optimization_runs (
        id,
        created_at,
        finished_at,
        created_by,
        target_model,
        objective,
        status,
        winner_route,
        benchmark_run_id,
        settings_json,
        candidate_snapshot_json,
        result_json,
        warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  createRun(record: OptimizationRunRecord): void {
    validateOptimizationRun(record);
    this.insertRunStatement.run(
      record.id,
      record.created_at,
      record.finished_at,
      record.created_by,
      record.target_model,
      record.objective,
      record.status,
      record.winner_route,
      record.benchmark_run_id,
      record.settings_json,
      record.candidate_snapshot_json,
      record.result_json,
      record.warnings_json
    );
  }

  getRun(runId: string): OptimizationRunRecord | null {
    assertNonEmptyString(runId, "runId");
    return (this.db.prepare("SELECT * FROM optimization_runs WHERE id = ?").get(runId) as OptimizationRunRecord | undefined) ?? null;
  }

  listRuns(limit = 25): OptimizationRunRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return this.db
      .prepare("SELECT * FROM optimization_runs ORDER BY created_at DESC LIMIT ?")
      .all(safeLimit)
      .map((row) => validateOptimizationRunRow(row));
  }
}
