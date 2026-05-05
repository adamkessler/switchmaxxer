import type { DatabaseSync } from "node:sqlite";

import { isRecord } from "../../platform/type-guards";
import {
  applyObservationToExecution,
  assertRequestScopedObservation,
  createInitialRequestExecution
} from "./request-execution-materialization";
import {
  buildRequestExecutionListConditions,
  buildRequestExecutionListQuery,
  defaultRequestExecutionBatchSize,
  normalizeRequestExecutionBatchSize,
  type ListRequestExecutionOptions
} from "./request-execution-query";
import {
  buildFailingRequestExecutionsWhereClause,
  toRequestExecutionStats,
  type RequestExecutionSummaryRow
} from "./request-execution-stats";
import {
  createMissingSummaryVerification,
  createOrphanSummaryVerification,
  diffRequestExecutionRecords
} from "./request-execution-verification";
import { rowToObservationRecord } from "./repository";
import { assertIsoTimestampString } from "./timestamps";
import { isObservationOutcome, type ObservationOutcome, type ObservationRecord } from "./types";
import { buildWhereClause } from "./where-clause";

export type { ListRequestExecutionOptions } from "./request-execution-query";

export interface RequestExecutionStats {
  total_count: number;
  partial_output_count: number;
  average_gateway_residency_ms: number | null;
  average_upstream_ttft_ms: number | null;
  average_upstream_duration_ms: number | null;
  outcome_counts: Array<{
    outcome: ObservationOutcome;
    count: number;
  }>;
  top_failing_routes: Array<{
    route: string;
    count: number;
  }>;
}

export interface RequestExecutionFieldMismatch {
  field: keyof RequestExecutionRecord;
  expected: RequestExecutionRecord[keyof RequestExecutionRecord] | null;
  actual: RequestExecutionRecord[keyof RequestExecutionRecord] | null;
}

export interface RequestExecutionVerificationResult {
  request_id: string;
  status: "ok" | "drift" | "missing_summary" | "orphan_summary";
  observation_count: number;
  mismatch_count: number;
  mismatches: RequestExecutionFieldMismatch[];
}

export interface RequestExecutionRepairResult {
  request_id: string;
  action: "unchanged" | "created" | "updated" | "deleted";
  observation_count: number;
  verification: RequestExecutionVerificationResult;
}

export interface RequestExecutionRecord {
  id: string;
  request_id: string;
  started_at: string;
  completed_at: string | null;
  request_received_at: string;
  route_resolved_at: string | null;
  upstream_request_started_at: string | null;
  upstream_response_started_at: string | null;
  upstream_response_completed_at: string | null;
  client_response_started_at: string | null;
  client_response_completed_at: string | null;
  route_id: string | null;
  route_name: string | null;
  model_id: string | null;
  provider_id: string | null;
  provider_model_id: string | null;
  client_api_mode: string;
  upstream_api_mode: string | null;
  status_code: number | null;
  outcome: ObservationOutcome;
  failure_stage: string | null;
  failure_reason: string | null;
  observation_count: number;
  latency_ms: number | null;
  ttft_ms: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_micros: number | null;
  currency: string | null;
  switchmaxxer_pre_upstream_ms: number | null;
  upstream_ttft_ms: number | null;
  upstream_duration_ms: number | null;
  switchmaxxer_post_upstream_ms: number | null;
  client_write_ms: number | null;
  gateway_residency_ms: number | null;
  partial_output: number;
}

function rowRecord(row: unknown, rowName: string): Record<string, unknown> {
  if (!isRecord(row)) {
    throw new Error(`${rowName} row must be an object.`);
  }

  return row;
}

type RowFieldValidator<T> = (value: unknown, fieldName: string, rowName: string) => T;

function readRowField<T>(
  row: Record<string, unknown>,
  fieldName: string,
  rowName: string,
  validator: RowFieldValidator<T>
): T {
  if (!Object.prototype.hasOwnProperty.call(row, fieldName)) {
    throw new Error(`${rowName} row field '${fieldName}' is missing.`);
  }

  return validator(row[fieldName], fieldName, rowName);
}

function readOptionalRowField<T>(
  row: Record<string, unknown>,
  fieldName: string,
  rowName: string,
  validator: RowFieldValidator<T>
): T | undefined {
  if (!Object.prototype.hasOwnProperty.call(row, fieldName)) {
    return undefined;
  }

  return readRowField(row, fieldName, rowName, validator);
}

const nonEmptyStringField: RowFieldValidator<string> = (value, fieldName, rowName) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${rowName} row field '${fieldName}' must be a non-empty string.`);
  }

  return value;
};

const nullableStringField: RowFieldValidator<string | null> = (value, fieldName, rowName) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${rowName} row field '${fieldName}' must be a string or null.`);
  }

  return value;
};

const isoTimestampField: RowFieldValidator<string> = (value, fieldName, rowName) => {
  assertIsoTimestampString(value, fieldName, `${rowName} row`);
  return value;
};

const nullableIsoTimestampField: RowFieldValidator<string | null> = (value, fieldName, rowName) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${rowName} row field '${fieldName}' must be an ISO timestamp string or null.`);
  }

  assertIsoTimestampString(value, fieldName, `${rowName} row`);
  return value;
};

const nonNegativeIntegerField: RowFieldValidator<number> = (value, fieldName, rowName) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${rowName} row field '${fieldName}' must be a non-negative integer.`);
  }

  return value;
};

const nullableNonNegativeIntegerField: RowFieldValidator<number | null> = (value, fieldName, rowName) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${rowName} row field '${fieldName}' must be a non-negative integer or null.`);
  }

  return value;
};

const nullableNonNegativeNumberField: RowFieldValidator<number | null> = (value, fieldName, rowName) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${rowName} row field '${fieldName}' must be a non-negative number or null.`);
  }

  return value;
};

const observationOutcomeField: RowFieldValidator<ObservationOutcome> = (value, fieldName, rowName) => {
  if (!isObservationOutcome(value)) {
    throw new Error(`${rowName} row field '${fieldName}' has unsupported value '${String(value)}'.`);
  }

  return value;
};

const booleanIntegerField: RowFieldValidator<number> = (value, fieldName, rowName) => {
  const booleanInteger = nonNegativeIntegerField(value, fieldName, rowName);
  if (booleanInteger !== 0 && booleanInteger !== 1) {
    throw new Error(`${rowName} row field '${fieldName}' must be 0 or 1.`);
  }

  return booleanInteger;
};

function rowToRequestId(row: unknown): string {
  return readRowField(rowRecord(row, "Request id"), "request_id", "Request id", nonEmptyStringField);
}

export function rowToRequestExecutionRecord(row: unknown): RequestExecutionRecord {
  const record = rowRecord(row, "Request execution");

  return {
    id: readRowField(record, "id", "Request execution", nonEmptyStringField),
    request_id: readRowField(record, "request_id", "Request execution", nonEmptyStringField),
    started_at: readRowField(record, "started_at", "Request execution", isoTimestampField),
    completed_at: readRowField(record, "completed_at", "Request execution", nullableIsoTimestampField),
    request_received_at: readRowField(record, "request_received_at", "Request execution", isoTimestampField),
    route_resolved_at: readRowField(record, "route_resolved_at", "Request execution", nullableIsoTimestampField),
    upstream_request_started_at: readRowField(record, "upstream_request_started_at", "Request execution", nullableIsoTimestampField),
    upstream_response_started_at: readRowField(record, "upstream_response_started_at", "Request execution", nullableIsoTimestampField),
    upstream_response_completed_at: readRowField(record, "upstream_response_completed_at", "Request execution", nullableIsoTimestampField),
    client_response_started_at: readRowField(record, "client_response_started_at", "Request execution", nullableIsoTimestampField),
    client_response_completed_at: readRowField(record, "client_response_completed_at", "Request execution", nullableIsoTimestampField),
    route_id: readRowField(record, "route_id", "Request execution", nullableStringField),
    route_name: readRowField(record, "route_name", "Request execution", nullableStringField),
    model_id: readRowField(record, "model_id", "Request execution", nullableStringField),
    provider_id: readRowField(record, "provider_id", "Request execution", nullableStringField),
    provider_model_id: readRowField(record, "provider_model_id", "Request execution", nullableStringField),
    client_api_mode: readRowField(record, "client_api_mode", "Request execution", nonEmptyStringField),
    upstream_api_mode: readRowField(record, "upstream_api_mode", "Request execution", nullableStringField),
    status_code: readRowField(record, "status_code", "Request execution", nullableNonNegativeIntegerField),
    outcome: readRowField(record, "outcome", "Request execution", observationOutcomeField),
    failure_stage: readRowField(record, "failure_stage", "Request execution", nullableStringField),
    failure_reason: readRowField(record, "failure_reason", "Request execution", nullableStringField),
    observation_count: readRowField(record, "observation_count", "Request execution", nonNegativeIntegerField),
    latency_ms: readRowField(record, "latency_ms", "Request execution", nullableNonNegativeIntegerField),
    ttft_ms: readRowField(record, "ttft_ms", "Request execution", nullableNonNegativeIntegerField),
    duration_ms: readRowField(record, "duration_ms", "Request execution", nullableNonNegativeIntegerField),
    input_tokens: readRowField(record, "input_tokens", "Request execution", nullableNonNegativeIntegerField),
    output_tokens: readRowField(record, "output_tokens", "Request execution", nullableNonNegativeIntegerField),
    total_tokens: readRowField(record, "total_tokens", "Request execution", nullableNonNegativeIntegerField),
    estimated_cost_micros: readRowField(record, "estimated_cost_micros", "Request execution", nullableNonNegativeIntegerField),
    currency: readRowField(record, "currency", "Request execution", nullableStringField),
    switchmaxxer_pre_upstream_ms: readRowField(record, "switchmaxxer_pre_upstream_ms", "Request execution", nullableNonNegativeIntegerField),
    upstream_ttft_ms: readRowField(record, "upstream_ttft_ms", "Request execution", nullableNonNegativeIntegerField),
    upstream_duration_ms: readRowField(record, "upstream_duration_ms", "Request execution", nullableNonNegativeIntegerField),
    switchmaxxer_post_upstream_ms: readRowField(record, "switchmaxxer_post_upstream_ms", "Request execution", nullableNonNegativeIntegerField),
    client_write_ms: readRowField(record, "client_write_ms", "Request execution", nullableNonNegativeIntegerField),
    gateway_residency_ms: readRowField(record, "gateway_residency_ms", "Request execution", nullableNonNegativeIntegerField),
    partial_output: readRowField(record, "partial_output", "Request execution", booleanIntegerField)
  };
}

export function rowToRequestExecutionSummaryRow(row: unknown): RequestExecutionSummaryRow {
  const record = rowRecord(row, "Request execution summary");

  return {
    total_count: readOptionalRowField(record, "total_count", "Request execution summary", nullableNonNegativeNumberField) ?? undefined,
    partial_output_count: readOptionalRowField(record, "partial_output_count", "Request execution summary", nullableNonNegativeNumberField),
    average_gateway_residency_ms: readOptionalRowField(
      record,
      "average_gateway_residency_ms",
      "Request execution summary",
      nullableNonNegativeNumberField
    ),
    average_upstream_ttft_ms: readOptionalRowField(
      record,
      "average_upstream_ttft_ms",
      "Request execution summary",
      nullableNonNegativeNumberField
    ),
    average_upstream_duration_ms: readOptionalRowField(
      record,
      "average_upstream_duration_ms",
      "Request execution summary",
      nullableNonNegativeNumberField
    )
  };
}

function rowToOutcomeCount(row: unknown): { outcome: ObservationOutcome; count: number } {
  const record = rowRecord(row, "Request execution outcome count");
  return {
    outcome: readRowField(record, "outcome", "Request execution outcome count", observationOutcomeField),
    count: readRowField(record, "count", "Request execution outcome count", nonNegativeIntegerField)
  };
}

export function rowToTopFailingRoute(row: unknown): { route: string; count: number } {
  const record = rowRecord(row, "Top failing route");
  return {
    route: readRowField(record, "route", "Top failing route", nonEmptyStringField),
    count: readRowField(record, "count", "Top failing route", nonNegativeIntegerField)
  };
}

export class RequestExecutionMaterializer {
  private readonly selectByRequestId;
  private readonly deleteByRequestId;
  private readonly upsertStatement;

  constructor(private readonly db: DatabaseSync) {
    this.selectByRequestId = this.db.prepare(
      "SELECT * FROM request_executions WHERE request_id = ?"
    );
    this.deleteByRequestId = this.db.prepare("DELETE FROM request_executions WHERE request_id = ?");

    this.upsertStatement = this.db.prepare(`
      INSERT INTO request_executions (
        id,
        request_id,
        started_at,
        completed_at,
        request_received_at,
        route_resolved_at,
        upstream_request_started_at,
        upstream_response_started_at,
        upstream_response_completed_at,
        client_response_started_at,
        client_response_completed_at,
        route_id,
        route_name,
        model_id,
        provider_id,
        provider_model_id,
        client_api_mode,
        upstream_api_mode,
        status_code,
        outcome,
        failure_stage,
        failure_reason,
        observation_count,
        latency_ms,
        ttft_ms,
        duration_ms,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost_micros,
        currency,
        switchmaxxer_pre_upstream_ms,
        upstream_ttft_ms,
        upstream_duration_ms,
        switchmaxxer_post_upstream_ms,
        client_write_ms,
        gateway_residency_ms,
        partial_output
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(request_id) DO UPDATE SET
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        request_received_at = excluded.request_received_at,
        route_resolved_at = excluded.route_resolved_at,
        upstream_request_started_at = excluded.upstream_request_started_at,
        upstream_response_started_at = excluded.upstream_response_started_at,
        upstream_response_completed_at = excluded.upstream_response_completed_at,
        client_response_started_at = excluded.client_response_started_at,
        client_response_completed_at = excluded.client_response_completed_at,
        route_id = excluded.route_id,
        route_name = excluded.route_name,
        model_id = excluded.model_id,
        provider_id = excluded.provider_id,
        provider_model_id = excluded.provider_model_id,
        client_api_mode = excluded.client_api_mode,
        upstream_api_mode = excluded.upstream_api_mode,
        status_code = excluded.status_code,
        outcome = excluded.outcome,
        failure_stage = excluded.failure_stage,
        failure_reason = excluded.failure_reason,
        observation_count = excluded.observation_count,
        latency_ms = excluded.latency_ms,
        ttft_ms = excluded.ttft_ms,
        duration_ms = excluded.duration_ms,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        total_tokens = excluded.total_tokens,
        estimated_cost_micros = excluded.estimated_cost_micros,
        currency = excluded.currency,
        switchmaxxer_pre_upstream_ms = excluded.switchmaxxer_pre_upstream_ms,
        upstream_ttft_ms = excluded.upstream_ttft_ms,
        upstream_duration_ms = excluded.upstream_duration_ms,
        switchmaxxer_post_upstream_ms = excluded.switchmaxxer_post_upstream_ms,
        client_write_ms = excluded.client_write_ms,
        gateway_residency_ms = excluded.gateway_residency_ms,
        partial_output = excluded.partial_output
    `);
  }

  private listObservationsByRequestId(requestId: string): ObservationRecord[] {
    return this.db.prepare(
      `
        SELECT * FROM observations
        WHERE request_id = ?
        ORDER BY observed_at ASC, ingested_at ASC, id ASC
      `
    ).all(requestId).map((row) => rowToObservationRecord(row));
  }

  listKnownRequestIds(options?: { limit?: number; offset?: number }): string[] {
    const safeLimit =
      typeof options?.limit === "number"
        ? normalizeRequestExecutionBatchSize(options.limit)
        : defaultRequestExecutionBatchSize();
    const safeOffset =
      typeof options?.offset === "number" && Number.isFinite(options.offset)
        ? Math.max(0, Math.trunc(options.offset))
        : 0;

    const rows = this.db.prepare(
      `
        SELECT request_id
        FROM (
          SELECT request_id FROM observations WHERE request_id IS NOT NULL
          UNION
          SELECT request_id FROM request_executions
        )
        ORDER BY request_id ASC
        LIMIT ? OFFSET ?
      `
    ).all(safeLimit, safeOffset);

    return rows.map((row) => rowToRequestId(row));
  }

  listKnownRequestIdsAfter(options?: { limit?: number; afterRequestId?: string | null }): string[] {
    const safeLimit =
      typeof options?.limit === "number"
        ? normalizeRequestExecutionBatchSize(options.limit)
        : defaultRequestExecutionBatchSize();
    const afterRequestId =
      typeof options?.afterRequestId === "string" && options.afterRequestId.trim().length > 0
        ? options.afterRequestId
        : null;

    const rows = afterRequestId
      ? this.db.prepare(
          `
            SELECT request_id
            FROM (
              SELECT request_id FROM observations WHERE request_id IS NOT NULL
              UNION
              SELECT request_id FROM request_executions
            )
            WHERE request_id > ?
            ORDER BY request_id ASC
            LIMIT ?
          `
        ).all(afterRequestId, safeLimit)
      : this.db.prepare(
          `
            SELECT request_id
            FROM (
              SELECT request_id FROM observations WHERE request_id IS NOT NULL
              UNION
              SELECT request_id FROM request_executions
            )
            ORDER BY request_id ASC
            LIMIT ?
          `
        ).all(safeLimit);

    return rows.map((row) => rowToRequestId(row));
  }

  private persist(record: RequestExecutionRecord): void {
    this.upsertStatement.run(
      record.id,
      record.request_id,
      record.started_at,
      record.completed_at,
      record.request_received_at,
      record.route_resolved_at,
      record.upstream_request_started_at,
      record.upstream_response_started_at,
      record.upstream_response_completed_at,
      record.client_response_started_at,
      record.client_response_completed_at,
      record.route_id,
      record.route_name,
      record.model_id,
      record.provider_id,
      record.provider_model_id,
      record.client_api_mode,
      record.upstream_api_mode,
      record.status_code,
      record.outcome,
      record.failure_stage,
      record.failure_reason,
      record.observation_count,
      record.latency_ms,
      record.ttft_ms,
      record.duration_ms,
      record.input_tokens,
      record.output_tokens,
      record.total_tokens,
      record.estimated_cost_micros,
      record.currency,
      record.switchmaxxer_pre_upstream_ms,
      record.upstream_ttft_ms,
      record.upstream_duration_ms,
      record.switchmaxxer_post_upstream_ms,
      record.client_write_ms,
      record.gateway_residency_ms,
      record.partial_output
    );
  }

  private buildFromObservations(requestId: string): {
    execution: RequestExecutionRecord | null;
    observationCount: number;
  } {
    const observations = this.listObservationsByRequestId(requestId);

    if (observations.length === 0) {
      return {
        execution: null,
        observationCount: 0
      };
    }

    let next: RequestExecutionRecord | null = null;

    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index]!;

      next = applyObservationToExecution(
        next ? { ...next } : createInitialRequestExecution(observation),
        observation,
        index + 1
      );
    }

    return {
      execution: next,
      observationCount: observations.length
    };
  }

  materialize(record: ObservationRecord): RequestExecutionRecord {
    assertRequestScopedObservation(record);

    const existingRow = this.selectByRequestId.get(record.request_id);
    const existing = typeof existingRow === "undefined" ? null : rowToRequestExecutionRecord(existingRow);
    const observationCount = existing ? existing.observation_count + 1 : 1;

    const next = applyObservationToExecution(
      existing ? { ...existing } : createInitialRequestExecution(record),
      record,
      observationCount
    );

    this.persist(next);

    return next;
  }

  materializeFromObservations(requestId: string): RequestExecutionRecord | null {
    if (requestId.trim().length === 0) {
      throw new Error("requestId must be a non-empty string.");
    }

    const rebuilt = this.buildFromObservations(requestId);

    if (!rebuilt.execution) {
      return null;
    }

    this.persist(rebuilt.execution);
    return rebuilt.execution;
  }

  getByRequestId(requestId: string): RequestExecutionRecord | null {
    if (requestId.trim().length === 0) {
      throw new Error("requestId must be a non-empty string.");
    }

    const row = this.selectByRequestId.get(requestId);
    return typeof row === "undefined" ? null : rowToRequestExecutionRecord(row);
  }

  listRecent(options: ListRequestExecutionOptions = {}): RequestExecutionRecord[] {
    const safeLimit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const { whereClause, values } = buildRequestExecutionListQuery(options);
    const sql = `SELECT * FROM request_executions ${whereClause} ORDER BY started_at DESC LIMIT ?`;

    values.push(safeLimit);

    return this.db.prepare(sql).all(...values).map((row) => rowToRequestExecutionRecord(row));
  }

  stats(options: ListRequestExecutionOptions = {}): RequestExecutionStats {
    const conditions = buildRequestExecutionListConditions(options);
    const { whereClause, values } = buildWhereClause(conditions);
    const summarySql = `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN partial_output = 1 THEN 1 ELSE 0 END) AS partial_output_count,
        AVG(gateway_residency_ms) AS average_gateway_residency_ms,
        AVG(upstream_ttft_ms) AS average_upstream_ttft_ms,
        AVG(upstream_duration_ms) AS average_upstream_duration_ms
      FROM request_executions
      ${whereClause}
    `;
    const summaryRow = this.db.prepare(summarySql).get(...values);
    const summary = typeof summaryRow === "undefined" ? undefined : rowToRequestExecutionSummaryRow(summaryRow);

    const outcomeCounts = this.db.prepare(
      `
        SELECT outcome, COUNT(*) AS count
        FROM request_executions
        ${whereClause}
        GROUP BY outcome
        ORDER BY count DESC, outcome ASC
      `
    ).all(...values).map((row) => rowToOutcomeCount(row));

    const failingRequestExecutionsQuery = buildFailingRequestExecutionsWhereClause(conditions);
    const topFailingRoutes = this.db.prepare(
      `
        SELECT
          COALESCE(route_name, route_id, '-') AS route,
          COUNT(*) AS count
        FROM request_executions
        ${failingRequestExecutionsQuery.whereClause}
        GROUP BY COALESCE(route_name, route_id, '-')
        ORDER BY count DESC, route ASC
        LIMIT 5
      `
    ).all(...failingRequestExecutionsQuery.values).map((row) => rowToTopFailingRoute(row));

    return toRequestExecutionStats({
      summary,
      outcomeCounts,
      topFailingRoutes
    });
  }

  verify(requestId: string): RequestExecutionVerificationResult {
    if (requestId.trim().length === 0) {
      throw new Error("requestId must be a non-empty string.");
    }

    const existing = this.getByRequestId(requestId);
    const rebuilt = this.buildFromObservations(requestId);

    if (!rebuilt.execution && !existing) {
      return createMissingSummaryVerification(requestId, 0, null);
    }

    if (!rebuilt.execution && existing) {
      return createOrphanSummaryVerification(requestId, existing);
    }

    if (rebuilt.execution && !existing) {
      return createMissingSummaryVerification(requestId, rebuilt.observationCount, rebuilt.execution);
    }

    const mismatches = diffRequestExecutionRecords(rebuilt.execution!, existing!);

    return {
      request_id: requestId,
      status: mismatches.length === 0 ? "ok" : "drift",
      observation_count: rebuilt.observationCount,
      mismatch_count: mismatches.length,
      mismatches
    };
  }

  verifyAll(batchSize?: number): RequestExecutionVerificationResult[] {
    const results: RequestExecutionVerificationResult[] = [];
    const safeBatchSize = normalizeRequestExecutionBatchSize(batchSize);

    for (let offset = 0; ; offset += safeBatchSize) {
      const requestIds = this.listKnownRequestIds({ limit: safeBatchSize, offset });
      if (requestIds.length === 0) {
        break;
      }

      for (const requestId of requestIds) {
        results.push(this.verify(requestId));
      }

      if (requestIds.length < safeBatchSize) {
        break;
      }
    }

    return results;
  }

  repair(requestId: string): RequestExecutionRepairResult {
    const verificationBefore = this.verify(requestId);
    const rebuilt = this.buildFromObservations(requestId);
    let action: RequestExecutionRepairResult["action"] = "unchanged";
    let verificationAfter = verificationBefore;

    if (!rebuilt.execution) {
      if (this.getByRequestId(requestId)) {
        this.deleteByRequestId.run(requestId);
        action = "deleted";
        verificationAfter = {
          request_id: requestId,
          status: "missing_summary",
          observation_count: rebuilt.observationCount,
          mismatch_count: 0,
          mismatches: []
        };
      }
    } else if (verificationBefore.status !== "ok") {
      this.persist(rebuilt.execution);
      action = verificationBefore.status === "missing_summary" ? "created" : "updated";
      verificationAfter = {
        request_id: requestId,
        status: "ok",
        observation_count: rebuilt.observationCount,
        mismatch_count: 0,
        mismatches: []
      };
    }

    return {
      request_id: requestId,
      action,
      observation_count: rebuilt.observationCount,
      verification: verificationAfter
    };
  }

  repairAll(batchSize?: number): RequestExecutionRepairResult[] {
    const results: RequestExecutionRepairResult[] = [];
    const safeBatchSize = normalizeRequestExecutionBatchSize(batchSize);
    let afterRequestId: string | null = null;

    for (;;) {
      const requestIds = this.listKnownRequestIdsAfter({
        limit: safeBatchSize,
        afterRequestId
      });
      if (requestIds.length === 0) {
        break;
      }

      afterRequestId = requestIds[requestIds.length - 1] as string;

      for (const requestId of requestIds) {
        results.push(this.repair(requestId));
      }

      if (requestIds.length < safeBatchSize) {
        break;
      }
    }

    return results;
  }
}
