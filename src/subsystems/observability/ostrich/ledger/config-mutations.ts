import type { DatabaseSync } from "node:sqlite";

import { assertIsoTimestampString, assertNullableIsoTimestampString } from "../../timestamps";

const CONFIG_MUTATION_SOURCE_SURFACES = ["cli", "mcp"] as const;
const CONFIG_MUTATION_OPERATIONS = ["optimize_apply", "optimize_restore", "manual_config_edit"] as const;
const CONFIG_MUTATION_STATUSES = ["succeeded"] as const;
const CONFIG_MUTATION_TARGET_KINDS = ["route"] as const;

export type ConfigMutationSourceSurface = typeof CONFIG_MUTATION_SOURCE_SURFACES[number];
export type ConfigMutationOperation = typeof CONFIG_MUTATION_OPERATIONS[number];
export type ConfigMutationStatus = typeof CONFIG_MUTATION_STATUSES[number];
export type ConfigMutationTargetKind = typeof CONFIG_MUTATION_TARGET_KINDS[number];

export interface ConfigSnapshotRecord {
  id: string;
  created_at: string;
  created_by: string;
  source_kind: string;
  source_path: string;
  content_sha256: string;
  content_json: string;
  content_bytes: number;
  retention_expires_at: string | null;
}

export interface ConfigMutationEventRecord {
  id: string;
  created_at: string;
  created_by: string;
  source_surface: ConfigMutationSourceSurface;
  operation: ConfigMutationOperation;
  status: ConfigMutationStatus;
  target_kind: ConfigMutationTargetKind;
  target_id: string;
  optimization_run_id: string | null;
  snapshot_id: string | null;
  parent_event_id: string | null;
  before_json: string;
  after_json: string;
  metadata_json: string;
}

export interface ConfigMutationEventWithSnapshot {
  event: ConfigMutationEventRecord;
  snapshot: ConfigSnapshotRecord | null;
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Config mutation field '${fieldName}' must be a non-empty string.`);
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
      `Config mutation field '${fieldName}' must be one of ${allowedValues.map((entry) => `'${entry}'`).join(", ")}.`
    );
  }
}

function validateConfigSnapshot(record: ConfigSnapshotRecord): void {
  assertNonEmptyString(record.id, "id");
  assertIsoTimestampString(record.created_at, "created_at", "Config mutation snapshot");
  assertNonEmptyString(record.created_by, "created_by");
  assertNonEmptyString(record.source_kind, "source_kind");
  assertNonEmptyString(record.source_path, "source_path");
  assertNonEmptyString(record.content_sha256, "content_sha256");
  assertNonEmptyString(record.content_json, "content_json");
  if (!Number.isInteger(record.content_bytes) || record.content_bytes < 0) {
    throw new Error("Config mutation snapshot field 'content_bytes' must be a non-negative integer.");
  }
  assertNullableIsoTimestampString(record.retention_expires_at, "retention_expires_at", "Config mutation snapshot");
}

function validateConfigMutationEvent(record: ConfigMutationEventRecord): void {
  assertNonEmptyString(record.id, "id");
  assertIsoTimestampString(record.created_at, "created_at", "Config mutation event");
  assertNonEmptyString(record.created_by, "created_by");
  assertKnownStringValue(record.source_surface, "source_surface", CONFIG_MUTATION_SOURCE_SURFACES);
  assertKnownStringValue(record.operation, "operation", CONFIG_MUTATION_OPERATIONS);
  assertKnownStringValue(record.status, "status", CONFIG_MUTATION_STATUSES);
  assertKnownStringValue(record.target_kind, "target_kind", CONFIG_MUTATION_TARGET_KINDS);
  assertNonEmptyString(record.target_id, "target_id");
  assertNullableNonEmptyString(record.optimization_run_id, "optimization_run_id");
  assertNullableNonEmptyString(record.snapshot_id, "snapshot_id");
  assertNullableNonEmptyString(record.parent_event_id, "parent_event_id");
  assertNonEmptyString(record.before_json, "before_json");
  assertNonEmptyString(record.after_json, "after_json");
  assertNonEmptyString(record.metadata_json, "metadata_json");
}

function validateConfigSnapshotRow(row: unknown): ConfigSnapshotRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Config snapshot row must be an object.");
  }

  const record = row as ConfigSnapshotRecord;
  validateConfigSnapshot(record);
  return record;
}

function validateConfigMutationEventRow(row: unknown): ConfigMutationEventRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Config mutation event row must be an object.");
  }

  const record = row as ConfigMutationEventRecord;
  validateConfigMutationEvent(record);
  return record;
}

export class ConfigMutationRepository {
  private readonly insertSnapshotStatement;
  private readonly insertEventStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertSnapshotStatement = this.db.prepare(`
      INSERT INTO config_snapshots (
        id,
        created_at,
        created_by,
        source_kind,
        source_path,
        content_sha256,
        content_json,
        content_bytes,
        retention_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertEventStatement = this.db.prepare(`
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
    `);
  }

  createSnapshot(record: ConfigSnapshotRecord): void {
    validateConfigSnapshot(record);
    this.insertSnapshotStatement.run(
      record.id,
      record.created_at,
      record.created_by,
      record.source_kind,
      record.source_path,
      record.content_sha256,
      record.content_json,
      record.content_bytes,
      record.retention_expires_at
    );
  }

  createEvent(record: ConfigMutationEventRecord): void {
    validateConfigMutationEvent(record);
    this.insertEventStatement.run(
      record.id,
      record.created_at,
      record.created_by,
      record.source_surface,
      record.operation,
      record.status,
      record.target_kind,
      record.target_id,
      record.optimization_run_id,
      record.snapshot_id,
      record.parent_event_id,
      record.before_json,
      record.after_json,
      record.metadata_json
    );
  }

  getSnapshot(snapshotId: string): ConfigSnapshotRecord | null {
    assertNonEmptyString(snapshotId, "snapshotId");
    const row = this.db.prepare("SELECT * FROM config_snapshots WHERE id = ?").get(snapshotId);
    return typeof row === "undefined" ? null : validateConfigSnapshotRow(row);
  }

  deleteSnapshot(snapshotId: string): number {
    assertNonEmptyString(snapshotId, "snapshotId");
    return Number(this.db.prepare("DELETE FROM config_snapshots WHERE id = ?").run(snapshotId).changes);
  }

  getEvent(eventId: string): ConfigMutationEventWithSnapshot | null {
    assertNonEmptyString(eventId, "eventId");
    const row = this.db.prepare("SELECT * FROM config_mutation_events WHERE id = ?").get(eventId);
    if (typeof row === "undefined") {
      return null;
    }

    const event = validateConfigMutationEventRow(row);
    return {
      event,
      snapshot: event.snapshot_id === null ? null : this.getSnapshot(event.snapshot_id)
    };
  }

  listEventsForOptimization(options: {
    operation: string;
    optimizationRunId: string;
    targetKind: string;
    targetId: string;
  }): ConfigMutationEventWithSnapshot[] {
    assertNonEmptyString(options.operation, "operation");
    assertNonEmptyString(options.optimizationRunId, "optimizationRunId");
    assertNonEmptyString(options.targetKind, "targetKind");
    assertNonEmptyString(options.targetId, "targetId");

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM config_mutation_events
          WHERE operation = ?
            AND optimization_run_id = ?
            AND target_kind = ?
            AND target_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(options.operation, options.optimizationRunId, options.targetKind, options.targetId);

    return rows.map((row) => {
      const event = validateConfigMutationEventRow(row);
      return {
        event,
        snapshot: event.snapshot_id === null ? null : this.getSnapshot(event.snapshot_id)
      };
    });
  }
}
