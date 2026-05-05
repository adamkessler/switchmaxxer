import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  ObservabilityExternalOptimizeApplyCommand,
  ObservabilityExternalOptimizeRestoreCommand,
  ObservabilityIpcJsonValue
} from "./observability-ipc-contract";
import { assertIsoTimestampString, assertNullableIsoTimestampString } from "./timestamps";

export const OPTIMIZE_MUTATION_IDEMPOTENCY_OPERATIONS = [
  "optimizeMutations.apply",
  "optimizeMutations.restore"
] as const;
export const OPTIMIZE_MUTATION_IDEMPOTENCY_STATUSES = [
  "accepted",
  "completed",
  "failed",
  "unknown"
] as const;

export type OptimizeMutationIdempotencyOperation = typeof OPTIMIZE_MUTATION_IDEMPOTENCY_OPERATIONS[number];
export type OptimizeMutationIdempotencyStatus = typeof OPTIMIZE_MUTATION_IDEMPOTENCY_STATUSES[number];

export interface OptimizeMutationIdempotencyRecord {
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  operation: OptimizeMutationIdempotencyOperation;
  command_digest: string;
  status: OptimizeMutationIdempotencyStatus;
  control_plane_action_id: string | null;
  result_json: string;
  error_json: string;
}

export interface AcceptOptimizeMutationIdempotencyInput {
  idempotencyKey: string;
  operation: OptimizeMutationIdempotencyOperation;
  commandDigest: string;
  nowIso: string;
}

export type AcceptOptimizeMutationIdempotencyResult =
  | {
      readonly kind: "accepted";
      readonly record: OptimizeMutationIdempotencyRecord;
    }
  | {
      readonly kind: "replay_completed";
      readonly record: OptimizeMutationIdempotencyRecord;
    }
  | {
      readonly kind: "replay_failed";
      readonly record: OptimizeMutationIdempotencyRecord;
    }
  | {
      readonly kind: "unknown_completion";
      readonly record: OptimizeMutationIdempotencyRecord;
    }
  | {
      readonly kind: "digest_mismatch";
      readonly record: OptimizeMutationIdempotencyRecord;
    };

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Optimize mutation idempotency field '${fieldName}' must be a non-empty string.`);
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
      `Optimize mutation idempotency field '${fieldName}' must be one of ${allowedValues
        .map((entry) => `'${entry}'`)
        .join(", ")}.`
    );
  }
}

function assertJsonObjectString(value: string, fieldName: string): void {
  assertNonEmptyString(value, fieldName);
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Optimize mutation idempotency field '${fieldName}' must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Optimize mutation idempotency field '${fieldName}' must be a JSON object.`);
  }
}

function validateOptimizeMutationIdempotencyRecord(record: OptimizeMutationIdempotencyRecord): void {
  assertNonEmptyString(record.idempotency_key, "idempotency_key");
  assertIsoTimestampString(record.created_at, "created_at", "Optimize mutation idempotency");
  assertIsoTimestampString(record.updated_at, "updated_at", "Optimize mutation idempotency");
  assertNullableIsoTimestampString(record.finished_at, "finished_at", "Optimize mutation idempotency");
  assertKnownStringValue(record.operation, "operation", OPTIMIZE_MUTATION_IDEMPOTENCY_OPERATIONS);
  assertNonEmptyString(record.command_digest, "command_digest");
  assertKnownStringValue(record.status, "status", OPTIMIZE_MUTATION_IDEMPOTENCY_STATUSES);
  assertNullableNonEmptyString(record.control_plane_action_id, "control_plane_action_id");
  assertJsonObjectString(record.result_json, "result_json");
  assertJsonObjectString(record.error_json, "error_json");
}

function validateOptimizeMutationIdempotencyRow(row: unknown): OptimizeMutationIdempotencyRecord {
  if (typeof row !== "object" || row === null) {
    throw new Error("Optimize mutation idempotency row must be an object.");
  }

  const record = row as OptimizeMutationIdempotencyRecord;
  validateOptimizeMutationIdempotencyRecord(record);
  return record;
}

function canonicalJson(value: unknown, fieldPath: string): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Optimize mutation idempotency digest field '${fieldPath}' must be a finite number.`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalJson(entry, `${fieldPath}[${index}]`)).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as { readonly [key: string]: unknown };
    const parts: string[] = [];
    for (const key of Object.keys(objectValue).sort()) {
      const entry = objectValue[key];
      if (typeof entry === "undefined") {
        throw new Error(`Optimize mutation idempotency digest field '${fieldPath}.${key}' must be JSON-safe.`);
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry, `${fieldPath}.${key}`)}`);
    }
    return `{${parts.join(",")}}`;
  }

  throw new Error(`Optimize mutation idempotency digest field '${fieldPath}' must be JSON-safe.`);
}

export function canonicalizeOptimizeMutationCommandForDigest(
  command: ObservabilityExternalOptimizeApplyCommand | ObservabilityExternalOptimizeRestoreCommand
): string {
  const {
    idempotencyKey: _idempotencyKey,
    catalog: _catalog,
    ...commandWithoutKey
  } = command;
  return canonicalJson(commandWithoutKey, "command");
}

export function digestOptimizeMutationCommand(
  command: ObservabilityExternalOptimizeApplyCommand | ObservabilityExternalOptimizeRestoreCommand
): string {
  return createHash("sha256")
    .update(canonicalizeOptimizeMutationCommandForDigest(command))
    .digest("hex");
}

export function jsonObjectString(value: { readonly [key: string]: ObservabilityIpcJsonValue }): string {
  return JSON.stringify(value);
}

function replayKindForRecord(record: OptimizeMutationIdempotencyRecord): AcceptOptimizeMutationIdempotencyResult["kind"] {
  if (record.status === "completed") {
    return "replay_completed";
  }

  if (record.status === "failed") {
    return "replay_failed";
  }

  return "unknown_completion";
}

export class OptimizeMutationIdempotencyRepository {
  private readonly insertAcceptedStatement;
  private readonly getStatement;
  private readonly updateStatement;

  constructor(private readonly db: DatabaseSync) {
    this.insertAcceptedStatement = this.db.prepare(`
      INSERT OR IGNORE INTO optimize_mutation_idempotency (
        idempotency_key,
        created_at,
        updated_at,
        finished_at,
        operation,
        command_digest,
        status,
        control_plane_action_id,
        result_json,
        error_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getStatement = this.db.prepare("SELECT * FROM optimize_mutation_idempotency WHERE idempotency_key = ?");
    this.updateStatement = this.db.prepare(`
      UPDATE optimize_mutation_idempotency
      SET
        updated_at = ?,
        finished_at = ?,
        status = ?,
        control_plane_action_id = COALESCE(?, control_plane_action_id),
        result_json = ?,
        error_json = ?
      WHERE idempotency_key = ?
    `);
  }

  accept(input: AcceptOptimizeMutationIdempotencyInput): AcceptOptimizeMutationIdempotencyResult {
    assertNonEmptyString(input.idempotencyKey, "idempotency_key");
    assertKnownStringValue(input.operation, "operation", OPTIMIZE_MUTATION_IDEMPOTENCY_OPERATIONS);
    assertNonEmptyString(input.commandDigest, "command_digest");
    assertIsoTimestampString(input.nowIso, "nowIso", "Optimize mutation idempotency");

    const record: OptimizeMutationIdempotencyRecord = {
      idempotency_key: input.idempotencyKey,
      created_at: input.nowIso,
      updated_at: input.nowIso,
      finished_at: null,
      operation: input.operation,
      command_digest: input.commandDigest,
      status: "accepted",
      control_plane_action_id: null,
      result_json: "{}",
      error_json: "{}"
    };
    validateOptimizeMutationIdempotencyRecord(record);
    const insertResult = this.insertAcceptedStatement.run(
      record.idempotency_key,
      record.created_at,
      record.updated_at,
      record.finished_at,
      record.operation,
      record.command_digest,
      record.status,
      record.control_plane_action_id,
      record.result_json,
      record.error_json
    );
    if (insertResult.changes === 1) {
      return {
        kind: "accepted",
        record
      };
    }

    const existingRecord = this.get(input.idempotencyKey);
    if (existingRecord === null) {
      throw new Error(`Optimize mutation idempotency key '${input.idempotencyKey}' could not be accepted.`);
    }
    if (existingRecord.command_digest !== input.commandDigest || existingRecord.operation !== input.operation) {
      return {
        kind: "digest_mismatch",
        record: existingRecord
      };
    }

    return {
      kind: replayKindForRecord(existingRecord),
      record: existingRecord
    };
  }

  get(idempotencyKey: string): OptimizeMutationIdempotencyRecord | null {
    assertNonEmptyString(idempotencyKey, "idempotency_key");
    const row = this.getStatement.get(idempotencyKey);
    return typeof row === "undefined" ? null : validateOptimizeMutationIdempotencyRow(row);
  }

  linkAction(idempotencyKey: string, controlPlaneActionId: string, nowIso: string): OptimizeMutationIdempotencyRecord {
    const record = this.getRequired(idempotencyKey);
    assertNonEmptyString(controlPlaneActionId, "control_plane_action_id");
    assertIsoTimestampString(nowIso, "nowIso", "Optimize mutation idempotency");
    this.writeUpdatedRecord({
      ...record,
      updated_at: nowIso,
      control_plane_action_id: controlPlaneActionId
    });
    return this.getRequired(idempotencyKey);
  }

  complete(
    idempotencyKey: string,
    resultJson: string,
    nowIso: string,
    controlPlaneActionId?: string | null
  ): OptimizeMutationIdempotencyRecord {
    const record = this.getRequired(idempotencyKey);
    assertJsonObjectString(resultJson, "result_json");
    assertIsoTimestampString(nowIso, "nowIso", "Optimize mutation idempotency");
    this.writeUpdatedRecord({
      ...record,
      updated_at: nowIso,
      finished_at: nowIso,
      status: "completed",
      control_plane_action_id: controlPlaneActionId ?? record.control_plane_action_id,
      result_json: resultJson,
      error_json: "{}"
    });
    return this.getRequired(idempotencyKey);
  }

  fail(
    idempotencyKey: string,
    errorJson: string,
    nowIso: string,
    controlPlaneActionId?: string | null
  ): OptimizeMutationIdempotencyRecord {
    const record = this.getRequired(idempotencyKey);
    assertJsonObjectString(errorJson, "error_json");
    assertIsoTimestampString(nowIso, "nowIso", "Optimize mutation idempotency");
    this.writeUpdatedRecord({
      ...record,
      updated_at: nowIso,
      finished_at: nowIso,
      status: "failed",
      control_plane_action_id: controlPlaneActionId ?? record.control_plane_action_id,
      result_json: "{}",
      error_json: errorJson
    });
    return this.getRequired(idempotencyKey);
  }

  markUnknown(
    idempotencyKey: string,
    errorJson: string,
    nowIso: string,
    controlPlaneActionId?: string | null
  ): OptimizeMutationIdempotencyRecord {
    const record = this.getRequired(idempotencyKey);
    assertJsonObjectString(errorJson, "error_json");
    assertIsoTimestampString(nowIso, "nowIso", "Optimize mutation idempotency");
    this.writeUpdatedRecord({
      ...record,
      updated_at: nowIso,
      finished_at: null,
      status: "unknown",
      control_plane_action_id: controlPlaneActionId ?? record.control_plane_action_id,
      result_json: "{}",
      error_json: errorJson
    });
    return this.getRequired(idempotencyKey);
  }

  private getRequired(idempotencyKey: string): OptimizeMutationIdempotencyRecord {
    const record = this.get(idempotencyKey);
    if (record === null) {
      throw new Error(`Optimize mutation idempotency key '${idempotencyKey}' was not accepted.`);
    }

    return record;
  }

  private writeUpdatedRecord(record: OptimizeMutationIdempotencyRecord): void {
    validateOptimizeMutationIdempotencyRecord(record);
    this.updateStatement.run(
      record.updated_at,
      record.finished_at,
      record.status,
      record.control_plane_action_id,
      record.result_json,
      record.error_json,
      record.idempotency_key
    );
  }
}
