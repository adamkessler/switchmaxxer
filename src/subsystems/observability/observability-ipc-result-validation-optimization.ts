import { validateBenchmarkRunSummary } from "./observability-ipc-result-validation-benchmark";
import type { ObservabilityIpcOperationResultValidationError } from "./observability-ipc-result-validation";
import {
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInteger,
  isNonNegativeNumber,
  isRecord,
  validateHistoryDeleteCounts,
  validateResultEnvelopeFields
} from "./observability-ipc-result-validation-shared";

export function validateOptimizationRunRecord(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const runField of [
    "id",
    "created_at",
    "created_by",
    "target_model",
    "objective",
    "status",
    "settings_json",
    "candidate_snapshot_json",
    "result_json",
    "warnings_json"
  ]) {
    if (!isNonEmptyString(value[runField])) {
      return {
        message: `Observability IPC ${field}.${runField} must be a non-empty string.`,
        field: `${field}.${runField}`
      };
    }
  }

  for (const nullableField of ["finished_at", "winner_route", "benchmark_run_id"]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }

  return null;
}

function validateOptimizeReportRun(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of ["status", "target_model", "objective"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  for (const nullableField of ["run_id", "created_at", "finished_at", "created_by"]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }
  if (typeof value["persisted"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.persisted must be a boolean.`,
      field: `${field}.persisted`
    };
  }

  return null;
}

function validateOptimizeReportCandidates(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  if (value["requested_routes"] !== null) {
    if (!Array.isArray(value["requested_routes"])) {
      return {
        message: `Observability IPC ${field}.requested_routes must be an array or null.`,
        field: `${field}.requested_routes`
      };
    }
    for (const [index, item] of value["requested_routes"].entries()) {
      if (!isNonEmptyString(item)) {
        return {
          message: `Observability IPC ${field}.requested_routes[${index}] must be a non-empty string.`,
          field: `${field}.requested_routes[${index}]`
        };
      }
    }
  }
  if (!Array.isArray(value["resolved_routes"])) {
    return {
      message: `Observability IPC ${field}.resolved_routes must be an array.`,
      field: `${field}.resolved_routes`
    };
  }
  for (const [index, item] of value["resolved_routes"].entries()) {
    if (!isNonEmptyString(item)) {
      return {
        message: `Observability IPC ${field}.resolved_routes[${index}] must be a non-empty string.`,
        field: `${field}.resolved_routes[${index}]`
      };
    }
  }
  if (!Array.isArray(value["disqualified"])) {
    return {
      message: `Observability IPC ${field}.disqualified must be an array.`,
      field: `${field}.disqualified`
    };
  }
  for (const [index, item] of value["disqualified"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC ${field}.disqualified[${index}] must be an object.`,
        field: `${field}.disqualified[${index}]`
      };
    }
    for (const stringField of ["route_id", "reason", "message"]) {
      if (!isNonEmptyString(item[stringField])) {
        return {
          message: `Observability IPC ${field}.disqualified[${index}].${stringField} must be a non-empty string.`,
          field: `${field}.disqualified[${index}].${stringField}`
        };
      }
    }
  }

  return null;
}

function validateOptimizeReferenceTokens(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const tokenField of ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"]) {
    if (!isNonNegativeInteger(value[tokenField])) {
      return {
        message: `Observability IPC ${field}.${tokenField} must be a non-negative integer.`,
        field: `${field}.${tokenField}`
      };
    }
  }

  return null;
}

function validateOptimizeReportBench(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  if (!isNonEmptyString(value["run_id"])) {
    return {
      message: `Observability IPC ${field}.run_id must be a non-empty string.`,
      field: `${field}.run_id`
    };
  }
  const summaryError = validateBenchmarkRunSummary(value["summary"], `${field}.summary`);
  if (summaryError !== null) {
    return summaryError;
  }
  if (!isRecord(value["execution"])) {
    return {
      message: `Observability IPC ${field}.execution must be an object.`,
      field: `${field}.execution`
    };
  }

  return null;
}

function validateOptimizeRankingEntry(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  if (!isNonEmptyString(value["route_id"])) {
    return {
      message: `Observability IPC ${field}.route_id must be a non-empty string.`,
      field: `${field}.route_id`
    };
  }
  if (!isFiniteNumber(value["score"])) {
    return {
      message: `Observability IPC ${field}.score must be a finite number.`,
      field: `${field}.score`
    };
  }

  return null;
}

function validateOptimizeReportWinner(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const stringField of ["route_id", "score_unit"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (!isFiniteNumber(value["score"])) {
    return {
      message: `Observability IPC ${field}.score must be a finite number.`,
      field: `${field}.score`
    };
  }
  if (!Array.isArray(value["tied_with"])) {
    return {
      message: `Observability IPC ${field}.tied_with must be an array.`,
      field: `${field}.tied_with`
    };
  }
  for (const [index, item] of value["tied_with"].entries()) {
    if (!isNonEmptyString(item)) {
      return {
        message: `Observability IPC ${field}.tied_with[${index}] must be a non-empty string.`,
        field: `${field}.tied_with[${index}]`
      };
    }
  }

  return null;
}

function validateOptimizeWarning(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const stringField of ["code", "message"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }

  return null;
}

function validateOptimizeReportView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  if (Object.hasOwn(value, "store_path") && !isNonEmptyString(value["store_path"])) {
    return {
      message: `Observability IPC ${field}.store_path must be a non-empty string when present.`,
      field: `${field}.store_path`
    };
  }

  const runError = validateOptimizeReportRun(value["run"], `${field}.run`);
  if (runError !== null) {
    return runError;
  }
  const candidatesError = validateOptimizeReportCandidates(value["candidates"], `${field}.candidates`);
  if (candidatesError !== null) {
    return candidatesError;
  }
  const tokenError = validateOptimizeReferenceTokens(value["reference_tokens"], `${field}.reference_tokens`);
  if (tokenError !== null) {
    return tokenError;
  }
  const benchError = validateOptimizeReportBench(value["bench"], `${field}.bench`);
  if (benchError !== null) {
    return benchError;
  }
  if (!Array.isArray(value["ranking"])) {
    return {
      message: `Observability IPC ${field}.ranking must be an array.`,
      field: `${field}.ranking`
    };
  }
  for (const [index, item] of value["ranking"].entries()) {
    const rankingError = validateOptimizeRankingEntry(item, `${field}.ranking[${index}]`);
    if (rankingError !== null) {
      return rankingError;
    }
  }
  const winnerError = validateOptimizeReportWinner(value["winner"], `${field}.winner`);
  if (winnerError !== null) {
    return winnerError;
  }
  if (!Array.isArray(value["warnings"])) {
    return {
      message: `Observability IPC ${field}.warnings must be an array.`,
      field: `${field}.warnings`
    };
  }
  for (const [index, item] of value["warnings"].entries()) {
    const warningError = validateOptimizeWarning(item, `${field}.warnings[${index}]`);
    if (warningError !== null) {
      return warningError;
    }
  }

  return null;
}

export function validateOptimizationReportPersistResult(
  value: unknown,
  operation: "optimizationReports.persistCost" | "optimizationReports.persistLatency"
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${operation} result must be an object.`,
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, operation);
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["report"] === null) {
    return null;
  }

  return validateOptimizeReportView(value["report"], "result.report");
}

function validateSerializedCostConfig(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  for (const costField of ["input", "output", "cache_read", "cache_write"]) {
    if (!isNonNegativeNumber(value[costField])) {
      return {
        message: `Observability IPC ${field}.${costField} must be a non-negative number.`,
        field: `${field}.${costField}`
      };
    }
  }

  return null;
}

function validateOptimizeRouteProviderStateView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const stringField of ["route_id", "service_provider", "provider_model_id", "api_mode"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (value["provider_endpoint"] !== null && !isNonEmptyString(value["provider_endpoint"])) {
    return {
      message: `Observability IPC ${field}.provider_endpoint must be a non-empty string or null.`,
      field: `${field}.provider_endpoint`
    };
  }

  return validateSerializedCostConfig(value["cost"], `${field}.cost`);
}

function validateOptimizeRouteFieldChange(
  value: unknown,
  field: string,
  validateEndpoint: (value: unknown, field: string) => ObservabilityIpcOperationResultValidationError | null
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  if (typeof value["changed"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.changed must be a boolean.`,
      field: `${field}.changed`
    };
  }

  return validateEndpoint(value["from"], `${field}.from`) ?? validateEndpoint(value["to"], `${field}.to`);
}

function validateOptimizeApplyMutationView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const stringField of ["field", "from", "to"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }

  const stringChangeError =
    validateOptimizeRouteFieldChange(value["service_provider"], `${field}.service_provider`, (item, itemField) =>
      isNonEmptyString(item)
        ? null
        : {
            message: `Observability IPC ${itemField} must be a non-empty string.`,
            field: itemField
          }) ??
    validateOptimizeRouteFieldChange(value["provider_model_id"], `${field}.provider_model_id`, (item, itemField) =>
      isNonEmptyString(item)
        ? null
        : {
            message: `Observability IPC ${itemField} must be a non-empty string.`,
            field: itemField
          });
  if (stringChangeError !== null) {
    return stringChangeError;
  }

  return validateOptimizeRouteFieldChange(value["cost"], `${field}.cost`, validateSerializedCostConfig);
}

function validateOptimizeSnapshotView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  for (const stringField of ["snapshot_id", "source_kind", "source_path", "content_sha256", "created_at"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (!isNonNegativeInteger(value["content_bytes"])) {
    return {
      message: `Observability IPC ${field}.content_bytes must be a non-negative integer.`,
      field: `${field}.content_bytes`
    };
  }
  if (value["retention_expires_at"] !== null && !isNonEmptyString(value["retention_expires_at"])) {
    return {
      message: `Observability IPC ${field}.retention_expires_at must be a non-empty string or null.`,
      field: `${field}.retention_expires_at`
    };
  }

  return null;
}

function validateOptimizeReloadView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  if (typeof value["requested"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.requested must be a boolean.`,
      field: `${field}.requested`
    };
  }
  if (!isNonEmptyString(value["status"])) {
    return {
      message: `Observability IPC ${field}.status must be a non-empty string.`,
      field: `${field}.status`
    };
  }
  if (value["exit_code"] !== null && !isNonNegativeInteger(value["exit_code"])) {
    return {
      message: `Observability IPC ${field}.exit_code must be a non-negative integer or null.`,
      field: `${field}.exit_code`
    };
  }
  for (const nullableField of ["command", "message"]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }

  return null;
}

function validateOptimizeVerificationView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  const baseError = validateOptimizeReloadView(value, field);
  if (baseError !== null || value === null) {
    return baseError;
  }
  if (!isRecord(value) || !isNonEmptyString(value["route_id"])) {
    return {
      message: `Observability IPC ${field}.route_id must be a non-empty string.`,
      field: `${field}.route_id`
    };
  }

  return null;
}

function validateOptimizeMutationWarnings(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!Array.isArray(value)) {
    return {
      message: `Observability IPC ${field} must be an array.`,
      field
    };
  }
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      return {
        message: `Observability IPC ${field}[${index}] must be a non-empty string.`,
        field: `${field}[${index}]`
      };
    }
  }

  return null;
}

function validateOptimizeApplyView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }
  for (const stringField of ["run_id", "objective", "target_model", "target_route", "winner_route"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  for (const booleanField of ["dry_run", "changed"]) {
    if (typeof value[booleanField] !== "boolean") {
      return {
        message: `Observability IPC ${field}.${booleanField} must be a boolean.`,
        field: `${field}.${booleanField}`
      };
    }
  }
  if (value["action_id"] !== null && !isNonEmptyString(value["action_id"])) {
    return {
      message: `Observability IPC ${field}.action_id must be a non-empty string or null.`,
      field: `${field}.action_id`
    };
  }

  return validateOptimizeSnapshotView(value["snapshot"], `${field}.snapshot`) ??
    validateOptimizeReloadView(value["reload"], `${field}.reload`) ??
    validateOptimizeVerificationView(value["verification"], `${field}.verification`) ??
    validateOptimizeMutationWarnings(value["warnings"], `${field}.warnings`) ??
    validateOptimizeApplyMutationView(value["mutation"], `${field}.mutation`) ??
    validateOptimizeRouteProviderStateView(value["before"], `${field}.before`) ??
    validateOptimizeRouteProviderStateView(value["after"], `${field}.after`);
}

function validateOptimizeRestorePointView(
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
    "action_id",
    "operation",
    "created_at",
    "run_id",
    "target_route",
    "source_kind",
    "source_path",
    "original_provider_model_id"
  ]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (!isRecord(value["mutation"])) {
    return {
      message: `Observability IPC ${field}.mutation must be an object.`,
      field: `${field}.mutation`
    };
  }
  for (const stringField of ["field", "from", "to"]) {
    if (!isNonEmptyString(value["mutation"][stringField])) {
      return {
        message: `Observability IPC ${field}.mutation.${stringField} must be a non-empty string.`,
        field: `${field}.mutation.${stringField}`
      };
    }
  }

  return validateOptimizeSnapshotView(value["snapshot"], `${field}.snapshot`) ??
    validateSerializedCostConfig(value["original_cost"], `${field}.original_cost`);
}

function validateOptimizeRestoreView(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  const baseError = validateOptimizeApplyView(
    typeof value === "object" && value !== null
      ? {
          ...value,
          winner_route: (value as Record<string, unknown>)["target_route"],
          objective: "cost",
          target_model: "unknown"
        }
      : value,
    field
  );
  if (baseError !== null) {
    return baseError;
  }
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  return validateOptimizeRestorePointView(value["restore_point"], `${field}.restore_point`);
}

function validateOptimizeMutationError(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  for (const stringField of ["code", "message"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (!isRecord(value["details"])) {
    return {
      message: `Observability IPC ${field}.details must be an object.`,
      field: `${field}.details`
    };
  }

  return null;
}

function validateOptimizeMutationServiceResult(
  value: unknown,
  field: string,
  kind: "apply" | "restore"
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }
  if (typeof value["ok"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.ok must be a boolean.`,
      field: `${field}.ok`
    };
  }
  if (!value["ok"]) {
    return validateOptimizeMutationError(value, field);
  }
  if (typeof value["deferred"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.deferred must be a boolean.`,
      field: `${field}.deferred`
    };
  }
  if (Object.hasOwn(value, "complete")) {
    return {
      message: `Observability IPC ${field}.complete must not be present on external transport results.`,
      field: `${field}.complete`
    };
  }
  if (typeof value["changed"] !== "boolean") {
    return {
      message: `Observability IPC ${field}.changed must be a boolean.`,
      field: `${field}.changed`
    };
  }
  for (const nullableField of ["actionId"]) {
    if (value[nullableField] !== null && !isNonEmptyString(value[nullableField])) {
      return {
        message: `Observability IPC ${field}.${nullableField} must be a non-empty string or null.`,
        field: `${field}.${nullableField}`
      };
    }
  }
  if (!isNonEmptyString(value["ledgerActionId"])) {
    return {
      message: `Observability IPC ${field}.ledgerActionId must be a non-empty string.`,
      field: `${field}.ledgerActionId`
    };
  }

  return kind === "apply"
    ? validateOptimizeApplyView(value["view"], `${field}.view`)
    : validateOptimizeRestoreView(value["view"], `${field}.view`);
}

export function validateOptimizeMutationResult(
  value: unknown,
  operation: "optimizeMutations.apply" | "optimizeMutations.restore"
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${operation} result must be an object.`,
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, operation);
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["result"] === null) {
    return null;
  }

  return validateOptimizeMutationServiceResult(
    value["result"],
    "result.result",
    operation === "optimizeMutations.apply" ? "apply" : "restore"
  );
}

export function validateOptimizationHistoryListResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC optimizationHistory.list result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "optimizationHistory.list");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!Array.isArray(value["runs"])) {
    return {
      message: "Observability IPC optimizationHistory.list result.runs must be an array.",
      field: "result.runs"
    };
  }

  for (const [index, item] of value["runs"].entries()) {
    const runError = validateOptimizationRunRecord(item, `result.runs[${index}]`);
    if (runError !== null) {
      return runError;
    }
  }

  return null;
}

export function validateOptimizationHistoryShowResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC optimizationHistory.show result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "optimizationHistory.show");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["run"] !== null) {
    return validateOptimizationRunRecord(value["run"], "result.run");
  }

  return null;
}

export function validateOptimizationHistoryDeleteResult(
  value: unknown,
  operation: "optimizationHistory.pruneOlderThan" | "optimizationHistory.deleteRun" | "optimizationHistory.clear"
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${operation} result must be an object.`,
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, operation);
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["result"] === null) {
    return null;
  }

  return validateHistoryDeleteCounts(value["result"], "result.result", [
    "optimization_runs_deleted",
    "config_mutation_events_deleted",
    "config_snapshots_deleted",
    "total_deleted"
  ]);
}
