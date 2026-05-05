import type { DatabaseSync } from "node:sqlite";

import { sanitizeStructuredSensitiveData } from "../../../../platform/error-detail-sanitizer";
import { parseJsonWithinBounds } from "../../../../platform/json-bounds";
import { redactSensitiveText } from "../../../../platform/logger";
import {
  OBSERVABILITY_MAX_JSON_BYTES,
  OBSERVABILITY_MAX_JSON_DEPTH,
  OBSERVABILITY_MAX_JSON_NODE_COUNT,
  MAX_OBSERVATION_MESSAGE_LENGTH,
  isObservationEvent,
  isObservationKind,
  isObservationOutcome,
  isObservationStage,
  type ObservationEvent,
  type ObservationKind,
  type ObservationRecord
} from "../../types";
import { assertIsoTimestampString } from "../../timestamps";
import { buildWhereClause, whereNonEmptyString } from "./where-clause";

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Observation field '${fieldName}' must be a non-empty string.`);
  }
}

function assertNullableNonNegativeInteger(value: unknown, fieldName: string): void {
  if (typeof value === "undefined" || value === null) {
    return;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Observation field '${fieldName}' must be a non-negative integer when present.`);
  }
}

function sanitizeStoredObservationMessage(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return redactSensitiveText(value).slice(0, MAX_OBSERVATION_MESSAGE_LENGTH);
}

function assertStoredObservationJsonWithinBounds(
  value: string | null | undefined,
  fieldName: "attributes_json"
): void {
  if (typeof value !== "string") {
    return;
  }

  try {
    parseJsonWithinBounds(value, {
      maxNodeCount: OBSERVABILITY_MAX_JSON_NODE_COUNT,
      maxDepth: OBSERVABILITY_MAX_JSON_DEPTH,
      maxSerializedBytes: OBSERVABILITY_MAX_JSON_BYTES
    });
  } catch (error) {
    const suffix = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Observation field '${fieldName}' exceeds repository JSON bounds${suffix}`);
  }
}

function sanitizeStoredObservationAttributesJson(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(value, {
      maxNodeCount: OBSERVABILITY_MAX_JSON_NODE_COUNT,
      maxDepth: OBSERVABILITY_MAX_JSON_DEPTH,
      maxSerializedBytes: OBSERVABILITY_MAX_JSON_BYTES
    });
  } catch (error) {
    const suffix = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Observation field 'attributes_json' exceeds repository JSON bounds${suffix}`);
  }

  const sanitized = sanitizeStructuredSensitiveData(parsed, {
    maxDepth: OBSERVABILITY_MAX_JSON_DEPTH,
    redactStrings: true,
    dropSensitiveKeys: true
  });
  const serialized = JSON.stringify(sanitized);
  assertStoredObservationJsonWithinBounds(serialized, "attributes_json");
  return serialized;
}

function validateObservation(record: ObservationRecord): void {
  assertNonEmptyString(record.id, "id");
  assertIsoTimestampString(record.observed_at, "observed_at", "Observation");
  assertNonEmptyString(record.surface, "surface");

  if (!isObservationKind(record.kind)) {
    throw new Error(`Observation field 'kind' has unsupported value '${String(record.kind)}'.`);
  }

  if (!isObservationEvent(record.event)) {
    throw new Error(`Observation field 'event' has unsupported value '${String(record.event)}'.`);
  }

  if (typeof record.stage !== "undefined" && record.stage !== null && !isObservationStage(record.stage)) {
    throw new Error(`Observation field 'stage' has unsupported value '${String(record.stage)}'.`);
  }

  if (
    typeof record.outcome !== "undefined" &&
    record.outcome !== null &&
    !isObservationOutcome(record.outcome)
  ) {
    throw new Error(`Observation field 'outcome' has unsupported value '${String(record.outcome)}'.`);
  }

  assertNullableNonNegativeInteger(record.status_code, "status_code");
  assertNullableNonNegativeInteger(record.latency_ms, "latency_ms");
  assertNullableNonNegativeInteger(record.ttft_ms, "ttft_ms");
  assertNullableNonNegativeInteger(record.duration_ms, "duration_ms");
  assertNullableNonNegativeInteger(record.request_bytes, "request_bytes");
  assertNullableNonNegativeInteger(record.response_bytes, "response_bytes");
  assertNullableNonNegativeInteger(record.input_tokens, "input_tokens");
  assertNullableNonNegativeInteger(record.output_tokens, "output_tokens");
  assertNullableNonNegativeInteger(record.total_tokens, "total_tokens");
  assertNullableNonNegativeInteger(record.estimated_cost_micros, "estimated_cost_micros");

  if (record.request_id && typeof record.client_api_mode !== "string") {
    throw new Error("Request-scoped observations must include 'client_api_mode'.");
  }

  assertStoredObservationJsonWithinBounds(record.attributes_json, "attributes_json");
}

export function rowToObservationRecord(row: unknown): ObservationRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Observation row must be an object.");
  }

  const record = row as ObservationRecord;
  validateObservation(record);
  return record;
}

export interface ObservationQueryOptions {
  limit?: number;
  requestId?: string;
  routeId?: string;
  providerId?: string;
  kind?: ObservationKind;
  event?: ObservationEvent;
}

export class ObservationRepository {
  private readonly insertStatement;
  private readonly listByRequestIdAscendingStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertStatement = this.db.prepare(`
      INSERT INTO observations (
        id,
        observed_at,
        ingested_at,
        request_id,
        trace_id,
        span_id,
        parent_span_id,
        surface,
        kind,
        event,
        stage,
        severity,
        outcome,
        route_id,
        route_name,
        model_id,
        provider_id,
        provider_model_id,
        client_api_mode,
        upstream_api_mode,
        listener,
        actor,
        status_code,
        latency_ms,
        ttft_ms,
        duration_ms,
        request_bytes,
        response_bytes,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost_micros,
        currency,
        billing_source,
        benchmark_run_id,
        benchmark_case_id,
        optimization_profile_id,
        tags_json,
        attributes_json,
        attributes_truncated,
        message
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    this.listByRequestIdAscendingStatement = this.db.prepare(`
      SELECT *
      FROM observations
      WHERE request_id = ?
      ORDER BY observed_at ASC, ingested_at ASC, id ASC
      LIMIT ?
    `);
  }

  insert(record: ObservationRecord): void {
    const sanitizedRecord: ObservationRecord = {
      ...record,
      attributes_json: sanitizeStoredObservationAttributesJson(record.attributes_json),
      message: sanitizeStoredObservationMessage(record.message)
    };
    validateObservation(sanitizedRecord);

    const ingestedAt = sanitizedRecord.ingested_at ?? new Date().toISOString();

    this.insertStatement.run(
      sanitizedRecord.id,
      sanitizedRecord.observed_at,
      ingestedAt,
      sanitizedRecord.request_id ?? null,
      sanitizedRecord.trace_id ?? null,
      sanitizedRecord.span_id ?? null,
      sanitizedRecord.parent_span_id ?? null,
      sanitizedRecord.surface,
      sanitizedRecord.kind,
      sanitizedRecord.event,
      sanitizedRecord.stage ?? null,
      sanitizedRecord.severity ?? null,
      sanitizedRecord.outcome ?? null,
      sanitizedRecord.route_id ?? null,
      sanitizedRecord.route_name ?? null,
      sanitizedRecord.model_id ?? null,
      sanitizedRecord.provider_id ?? null,
      sanitizedRecord.provider_model_id ?? null,
      sanitizedRecord.client_api_mode ?? null,
      sanitizedRecord.upstream_api_mode ?? null,
      sanitizedRecord.listener ?? null,
      sanitizedRecord.actor ?? null,
      sanitizedRecord.status_code ?? null,
      sanitizedRecord.latency_ms ?? null,
      sanitizedRecord.ttft_ms ?? null,
      sanitizedRecord.duration_ms ?? null,
      sanitizedRecord.request_bytes ?? null,
      sanitizedRecord.response_bytes ?? null,
      sanitizedRecord.input_tokens ?? null,
      sanitizedRecord.output_tokens ?? null,
      sanitizedRecord.total_tokens ?? null,
      sanitizedRecord.estimated_cost_micros ?? null,
      sanitizedRecord.currency ?? null,
      sanitizedRecord.billing_source ?? null,
      sanitizedRecord.benchmark_run_id ?? null,
      sanitizedRecord.benchmark_case_id ?? null,
      sanitizedRecord.optimization_profile_id ?? null,
      sanitizedRecord.tags_json ?? null,
      sanitizedRecord.attributes_json ?? null,
      sanitizedRecord.attributes_truncated ?? 0,
      sanitizedRecord.message ?? null
    );
  }

  private buildObservationQuery(options: ObservationQueryOptions): {
    whereClause: string;
    values: Array<string | number>;
  } {
    return buildWhereClause([
      whereNonEmptyString("request_id = ?", options.requestId),
      whereNonEmptyString("(route_id = ? OR route_name = ?)", options.routeId, (routeId) => [routeId, routeId]),
      whereNonEmptyString("provider_id = ?", options.providerId),
      whereNonEmptyString("kind = ?", options.kind),
      whereNonEmptyString("event = ?", options.event)
    ]);
  }

  listRecent(options: ObservationQueryOptions = {}): ObservationRecord[] {
    const safeLimit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const { whereClause, values } = this.buildObservationQuery(options);
    const sql = `SELECT * FROM observations ${whereClause} ORDER BY observed_at DESC, ingested_at DESC LIMIT ?`;

    values.push(safeLimit);

    return this.db.prepare(sql).all(...values).map((row) => rowToObservationRecord(row));
  }

  listByRequestId(requestId: string, limit = 200): ObservationRecord[] {
    assertNonEmptyString(requestId, "requestId");
    const safeLimit = Math.max(1, Math.min(limit, 1000));

    return this.listByRequestIdAscendingStatement.all(requestId, safeLimit).map((row) => rowToObservationRecord(row));
  }
}
