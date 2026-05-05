import type { DatabaseSync } from "node:sqlite";

import { assertIsoTimestampString, assertNullableIsoTimestampString } from "./timestamps";

export const CONTROL_PLANE_ACTION_SOURCE_SURFACES = ["cli", "mcp"] as const;
const CONTROL_PLANE_ACTION_ACTOR_KINDS = ["operator", "agent", "system", "unknown"] as const;
export const CONTROL_PLANE_ACTION_OPERATIONS = [
  "optimize_apply",
  "optimize_restore",
  "models_create",
  "models_update",
  "models_delete",
  "providers_create",
  "providers_update",
  "providers_delete",
  "providers_set_key",
  "providers_clear_key",
  "providers_set_key_env",
  "routes_create",
  "routes_update",
  "routes_delete"
] as const;
export const CONTROL_PLANE_ACTION_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "noop",
  "dry_run_succeeded",
  "dry_run_failed"
] as const;
export const CONTROL_PLANE_ACTION_TARGET_KINDS = ["model", "provider", "route"] as const;

export type ControlPlaneActionSourceSurface = typeof CONTROL_PLANE_ACTION_SOURCE_SURFACES[number];
export type ControlPlaneActionActorKind = typeof CONTROL_PLANE_ACTION_ACTOR_KINDS[number];
export type ControlPlaneActionOperation = typeof CONTROL_PLANE_ACTION_OPERATIONS[number];
export type ControlPlaneActionStatus = typeof CONTROL_PLANE_ACTION_STATUSES[number];
export type ControlPlaneActionTargetKind = typeof CONTROL_PLANE_ACTION_TARGET_KINDS[number];

export interface ControlPlaneActionEventRecord {
  id: string;
  created_at: string;
  finished_at: string | null;
  created_by: string;
  source_surface: ControlPlaneActionSourceSurface;
  actor_kind: ControlPlaneActionActorKind;
  actor_id: string | null;
  session_id: string | null;
  operation: ControlPlaneActionOperation;
  status: ControlPlaneActionStatus;
  target_kind: ControlPlaneActionTargetKind;
  target_id: string | null;
  optimization_run_id: string | null;
  mutation_event_id: string | null;
  correlation_ids_json: string;
  result_json: string;
  error_json: string;
  metadata_json: string;
}

export interface FinishControlPlaneActionEventOptions {
  status: Exclude<ControlPlaneActionStatus, "started">;
  targetId?: string | null;
  optimizationRunId?: string | null;
  mutationEventId?: string | null;
  resultJson?: string;
  errorJson?: string;
  metadataJson?: string;
}

export interface ListControlPlaneActionEventsOptions {
  routeId?: string;
  targetId?: string;
  targetKind?: ControlPlaneActionTargetKind;
  operation?: ControlPlaneActionOperation;
  status?: ControlPlaneActionStatus;
  sourceSurface?: ControlPlaneActionSourceSurface;
  sessionId?: string;
  optimizationRunId?: string;
  mutationEventId?: string;
  createdSince?: string;
  limit?: number;
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Control-plane action field '${fieldName}' must be a non-empty string.`);
  }
}

function assertNullableNonEmptyString(value: unknown, fieldName: string): asserts value is string | null {
  if (value === null) {
    return;
  }

  assertNonEmptyString(value, fieldName);
}

function assertKnownStringValue<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[]
): asserts value is T {
  assertNonEmptyString(value, fieldName);
  if (!allowedValues.includes(value as T)) {
    throw new Error(
      `Control-plane action field '${fieldName}' must be one of ${allowedValues.map((entry) => `'${entry}'`).join(", ")}.`
    );
  }
}

function assertJsonObjectString(value: string, fieldName: string): void {
  assertNonEmptyString(value, fieldName);
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Control-plane action field '${fieldName}' must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Control-plane action field '${fieldName}' must be a JSON object.`);
  }
}

function validateControlPlaneActionEvent(record: ControlPlaneActionEventRecord): void {
  assertNonEmptyString(record.id, "id");
  assertIsoTimestampString(record.created_at, "created_at", "Control-plane action event");
  assertNullableIsoTimestampString(record.finished_at, "finished_at", "Control-plane action event");
  assertNonEmptyString(record.created_by, "created_by");
  assertKnownStringValue(record.source_surface, "source_surface", CONTROL_PLANE_ACTION_SOURCE_SURFACES);
  assertKnownStringValue(record.actor_kind, "actor_kind", CONTROL_PLANE_ACTION_ACTOR_KINDS);
  assertNullableNonEmptyString(record.actor_id, "actor_id");
  assertNullableNonEmptyString(record.session_id, "session_id");
  assertKnownStringValue(record.operation, "operation", CONTROL_PLANE_ACTION_OPERATIONS);
  assertKnownStringValue(record.status, "status", CONTROL_PLANE_ACTION_STATUSES);
  assertKnownStringValue(record.target_kind, "target_kind", CONTROL_PLANE_ACTION_TARGET_KINDS);
  assertNullableNonEmptyString(record.target_id, "target_id");
  assertNullableNonEmptyString(record.optimization_run_id, "optimization_run_id");
  assertNullableNonEmptyString(record.mutation_event_id, "mutation_event_id");
  assertJsonObjectString(record.correlation_ids_json, "correlation_ids_json");
  assertJsonObjectString(record.result_json, "result_json");
  assertJsonObjectString(record.error_json, "error_json");
  assertJsonObjectString(record.metadata_json, "metadata_json");
}

function validateControlPlaneActionEventRow(row: unknown): ControlPlaneActionEventRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Control-plane action row must be an object.");
  }

  const record = row as ControlPlaneActionEventRecord;
  validateControlPlaneActionEvent(record);
  return record;
}

export class ControlPlaneActionRepository {
  private readonly insertActionStatement;
  private readonly finishActionStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertActionStatement = this.db.prepare(`
      INSERT INTO control_plane_action_events (
        id,
        created_at,
        finished_at,
        created_by,
        source_surface,
        actor_kind,
        actor_id,
        session_id,
        operation,
        status,
        target_kind,
        target_id,
        optimization_run_id,
        mutation_event_id,
        correlation_ids_json,
        result_json,
        error_json,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.finishActionStatement = this.db.prepare(`
      UPDATE control_plane_action_events
      SET
        finished_at = ?,
        status = ?,
        target_id = COALESCE(?, target_id),
        optimization_run_id = COALESCE(?, optimization_run_id),
        mutation_event_id = ?,
        result_json = ?,
        error_json = ?,
        metadata_json = ?
      WHERE id = ?
    `);
  }

  createEvent(record: ControlPlaneActionEventRecord): void {
    validateControlPlaneActionEvent(record);
    this.insertActionStatement.run(
      record.id,
      record.created_at,
      record.finished_at,
      record.created_by,
      record.source_surface,
      record.actor_kind,
      record.actor_id,
      record.session_id,
      record.operation,
      record.status,
      record.target_kind,
      record.target_id,
      record.optimization_run_id,
      record.mutation_event_id,
      record.correlation_ids_json,
      record.result_json,
      record.error_json,
      record.metadata_json
    );
  }

  finishEvent(actionId: string, options: FinishControlPlaneActionEventOptions): void {
    assertNonEmptyString(actionId, "actionId");
    assertKnownStringValue(options.status, "status", CONTROL_PLANE_ACTION_STATUSES);

    const resultJson = options.resultJson ?? "{}";
    const errorJson = options.errorJson ?? "{}";
    const metadataJson = options.metadataJson ?? "{}";
    assertJsonObjectString(resultJson, "result_json");
    assertJsonObjectString(errorJson, "error_json");
    assertJsonObjectString(metadataJson, "metadata_json");
    assertNullableNonEmptyString(options.targetId ?? null, "target_id");
    assertNullableNonEmptyString(options.optimizationRunId ?? null, "optimization_run_id");
    assertNullableNonEmptyString(options.mutationEventId ?? null, "mutation_event_id");

    this.finishActionStatement.run(
      new Date().toISOString(),
      options.status,
      options.targetId ?? null,
      options.optimizationRunId ?? null,
      options.mutationEventId ?? null,
      resultJson,
      errorJson,
      metadataJson,
      actionId
    );
  }

  getEvent(actionId: string): ControlPlaneActionEventRecord | null {
    assertNonEmptyString(actionId, "actionId");
    const row = this.db.prepare("SELECT * FROM control_plane_action_events WHERE id = ?").get(actionId);
    return typeof row === "undefined" ? null : validateControlPlaneActionEventRow(row);
  }

  listEvents(options: ListControlPlaneActionEventsOptions = {}): ControlPlaneActionEventRecord[] {
    if (typeof options.routeId !== "undefined") {
      assertNonEmptyString(options.routeId, "routeId");
    }
    if (typeof options.targetId !== "undefined") {
      assertNonEmptyString(options.targetId, "targetId");
    }
    if (typeof options.targetKind !== "undefined") {
      assertKnownStringValue(options.targetKind, "target_kind", CONTROL_PLANE_ACTION_TARGET_KINDS);
    }
    if (typeof options.operation !== "undefined") {
      assertKnownStringValue(options.operation, "operation", CONTROL_PLANE_ACTION_OPERATIONS);
    }
    if (typeof options.status !== "undefined") {
      assertKnownStringValue(options.status, "status", CONTROL_PLANE_ACTION_STATUSES);
    }
    if (typeof options.sourceSurface !== "undefined") {
      assertKnownStringValue(options.sourceSurface, "source_surface", CONTROL_PLANE_ACTION_SOURCE_SURFACES);
    }
    if (typeof options.sessionId !== "undefined") {
      assertNonEmptyString(options.sessionId, "sessionId");
    }
    if (typeof options.optimizationRunId !== "undefined") {
      assertNonEmptyString(options.optimizationRunId, "optimizationRunId");
    }
    if (typeof options.mutationEventId !== "undefined") {
      assertNonEmptyString(options.mutationEventId, "mutationEventId");
    }
    if (typeof options.createdSince !== "undefined") {
      assertIsoTimestampString(options.createdSince, "createdSince", "Control-plane action event list");
    }

    const whereClauses: string[] = [];
    const values: Array<string | number> = [];

    if (typeof options.routeId === "string") {
      whereClauses.push("target_id = ?");
      values.push(options.routeId);
    }
    if (typeof options.targetId === "string") {
      whereClauses.push("target_id = ?");
      values.push(options.targetId);
    }
    if (typeof options.targetKind === "string") {
      whereClauses.push("target_kind = ?");
      values.push(options.targetKind);
    }
    if (typeof options.operation === "string") {
      whereClauses.push("operation = ?");
      values.push(options.operation);
    }
    if (typeof options.status === "string") {
      whereClauses.push("status = ?");
      values.push(options.status);
    }
    if (typeof options.sourceSurface === "string") {
      whereClauses.push("source_surface = ?");
      values.push(options.sourceSurface);
    }
    if (typeof options.sessionId === "string") {
      whereClauses.push("session_id = ?");
      values.push(options.sessionId);
    }
    if (typeof options.optimizationRunId === "string") {
      whereClauses.push("optimization_run_id = ?");
      values.push(options.optimizationRunId);
    }
    if (typeof options.mutationEventId === "string") {
      whereClauses.push("mutation_event_id = ?");
      values.push(options.mutationEventId);
    }
    if (typeof options.createdSince === "string") {
      whereClauses.push("created_at >= ?");
      values.push(options.createdSince);
    }

    const safeLimit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 25)));
    values.push(safeLimit);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM control_plane_action_events
          ${whereSql}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(...values);

    return rows.map((row) => validateControlPlaneActionEventRow(row));
  }

  listRecent(limit = 25): ControlPlaneActionEventRecord[] {
    return this.listEvents({ limit });
  }
}
