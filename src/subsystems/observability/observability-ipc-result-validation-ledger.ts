import type { ObservabilityIpcOperationResultValidationError } from "./observability-ipc-result-validation";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  validateResultEnvelopeFields
} from "./observability-ipc-result-validation-shared";

export function validateRetentionPruneCounts(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }

  for (const stringField of ["status", "cutoff_at"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  for (const nullableField of ["failure_stage", "failure_message"]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }
  for (const countField of [
    "observations_deleted",
    "request_executions_deleted",
    "benchmark_runs_deleted",
    "benchmark_samples_deleted",
    "cost_facts_deleted",
    "optimization_facts_deleted",
    "control_plane_action_events_deleted",
    "config_mutation_events_deleted",
    "config_snapshots_deleted",
    "total_deleted"
  ]) {
    if (!isNonNegativeInteger(value[countField])) {
      return {
        message: `Observability IPC ${field}.${countField} must be a non-negative integer.`,
        field: `${field}.${countField}`
      };
    }
  }

  return null;
}

export function validateRetentionPruneResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC retention.pruneOlderThan result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "retention.pruneOlderThan");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["result"] === null) {
    return null;
  }

  return validateRetentionPruneCounts(value["result"], "result.result");
}

function validateControlPlaneActionEventRecord(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of [
    "id",
    "created_at",
    "created_by",
    "source_surface",
    "actor_kind",
    "operation",
    "status",
    "target_kind",
    "correlation_ids_json",
    "result_json",
    "error_json",
    "metadata_json"
  ]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }

  for (const nullableField of [
    "finished_at",
    "actor_id",
    "session_id",
    "target_id",
    "optimization_run_id",
    "mutation_event_id"
  ]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }

  return null;
}

export function validateLedgerListResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC ledger.list result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "ledger.list");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!Array.isArray(value["events"])) {
    return {
      message: "Observability IPC ledger.list result.events must be an array.",
      field: "result.events"
    };
  }

  for (const [index, item] of value["events"].entries()) {
    const eventError = validateControlPlaneActionEventRecord(item, `result.events[${index}]`);
    if (eventError !== null) {
      return eventError;
    }
  }

  return null;
}

export function validateLedgerShowResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC ledger.show result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "ledger.show");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["event"] !== null) {
    return validateControlPlaneActionEventRecord(value["event"], "result.event");
  }

  return null;
}

export function validateControlPlaneAuditStartResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC controlPlaneAudit.startConfigMutation result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "controlPlaneAudit.startConfigMutation");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["actionId"] !== null && !isNonEmptyString(value["actionId"])) {
    return {
      message: "Observability IPC controlPlaneAudit.startConfigMutation result.actionId must be a non-empty string or null.",
      field: "result.actionId"
    };
  }

  return null;
}

export function validateControlPlaneAuditFinishResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC controlPlaneAudit.finishConfigMutation result must be an object.",
      field: "result"
    };
  }

  return validateResultEnvelopeFields(value, "controlPlaneAudit.finishConfigMutation");
}
