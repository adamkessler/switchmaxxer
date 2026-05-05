import { validateBenchmarkSampleRecord } from "./observability-ipc-result-validation-benchmark";
import type { ObservabilityIpcOperationResultValidationError } from "./observability-ipc-result-validation";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  validateOptionalNullableNonNegativeNumber,
  validateResultEnvelopeFields
} from "./observability-ipc-result-validation-shared";

export function validateTraceStatsResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC trace.getStats result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "trace.getStats");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!isRecord(value["stats"])) {
    return {
      message: "Observability IPC trace.getStats result.stats must be an object.",
      field: "result.stats"
    };
  }

  const stats = value["stats"];
  for (const countField of ["total_count", "partial_output_count"]) {
    if (!isNonNegativeInteger(stats[countField])) {
      return {
        message: `Observability IPC trace.getStats result.stats.${countField} must be a non-negative integer.`,
        field: `result.stats.${countField}`
      };
    }
  }
  for (const averageField of [
    "average_gateway_residency_ms",
    "average_upstream_ttft_ms",
    "average_upstream_duration_ms"
  ]) {
    const message = validateOptionalNullableNonNegativeNumber(stats, averageField);
    if (message !== null) {
      return {
        message: `Observability IPC trace.getStats result.stats.${message}`,
        field: `result.stats.${averageField}`
      };
    }
  }
  if (!Array.isArray(stats["outcome_counts"])) {
    return {
      message: "Observability IPC trace.getStats result.stats.outcome_counts must be an array.",
      field: "result.stats.outcome_counts"
    };
  }
  for (const [index, item] of stats["outcome_counts"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC trace.getStats result.stats.outcome_counts[${index}] must be an object.`,
        field: `result.stats.outcome_counts[${index}]`
      };
    }
    if (!isNonEmptyString(item["outcome"])) {
      return {
        message: `Observability IPC trace.getStats result.stats.outcome_counts[${index}].outcome must be a non-empty string.`,
        field: `result.stats.outcome_counts[${index}].outcome`
      };
    }
    if (!isNonNegativeInteger(item["count"])) {
      return {
        message: `Observability IPC trace.getStats result.stats.outcome_counts[${index}].count must be a non-negative integer.`,
        field: `result.stats.outcome_counts[${index}].count`
      };
    }
  }
  if (!Array.isArray(stats["top_failing_routes"])) {
    return {
      message: "Observability IPC trace.getStats result.stats.top_failing_routes must be an array.",
      field: "result.stats.top_failing_routes"
    };
  }
  for (const [index, item] of stats["top_failing_routes"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC trace.getStats result.stats.top_failing_routes[${index}] must be an object.`,
        field: `result.stats.top_failing_routes[${index}]`
      };
    }
    if (!isNonEmptyString(item["route"])) {
      return {
        message: `Observability IPC trace.getStats result.stats.top_failing_routes[${index}].route must be a non-empty string.`,
        field: `result.stats.top_failing_routes[${index}].route`
      };
    }
    if (!isNonNegativeInteger(item["count"])) {
      return {
        message: `Observability IPC trace.getStats result.stats.top_failing_routes[${index}].count must be a non-negative integer.`,
        field: `result.stats.top_failing_routes[${index}].count`
      };
    }
  }

  return null;
}
function validateRequestExecutionRecord(
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
    "request_id",
    "started_at",
    "request_received_at",
    "client_api_mode",
    "outcome"
  ]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }

  for (const nullableStringField of [
    "completed_at",
    "route_resolved_at",
    "upstream_request_started_at",
    "upstream_response_started_at",
    "upstream_response_completed_at",
    "client_response_started_at",
    "client_response_completed_at",
    "route_id",
    "route_name",
    "model_id",
    "provider_id",
    "provider_model_id",
    "upstream_api_mode",
    "failure_stage",
    "failure_reason",
    "currency"
  ]) {
    if (value[nullableStringField] !== null && !isNonEmptyString(value[nullableStringField])) {
      return {
        message: `Observability IPC ${field}.${nullableStringField} must be a non-empty string or null.`,
        field: `${field}.${nullableStringField}`
      };
    }
  }

  if (!isNonNegativeInteger(value["observation_count"])) {
    return {
      message: `Observability IPC ${field}.observation_count must be a non-negative integer.`,
      field: `${field}.observation_count`
    };
  }

  for (const nullableIntegerField of [
    "status_code",
    "latency_ms",
    "ttft_ms",
    "duration_ms",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "estimated_cost_micros",
    "switchmaxxer_pre_upstream_ms",
    "upstream_ttft_ms",
    "upstream_duration_ms",
    "switchmaxxer_post_upstream_ms",
    "client_write_ms",
    "gateway_residency_ms"
  ]) {
    if (value[nullableIntegerField] !== null && !isNonNegativeInteger(value[nullableIntegerField])) {
      return {
        message: `Observability IPC ${field}.${nullableIntegerField} must be a non-negative integer or null.`,
        field: `${field}.${nullableIntegerField}`
      };
    }
  }

  if (value["partial_output"] !== 0 && value["partial_output"] !== 1) {
    return {
      message: `Observability IPC ${field}.partial_output must be 0 or 1.`,
      field: `${field}.partial_output`
    };
  }

  return null;
}

export function validateTraceListResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC trace.list result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "trace.list");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!Array.isArray(value["traces"])) {
    return {
      message: "Observability IPC trace.list result.traces must be an array.",
      field: "result.traces"
    };
  }

  for (const [index, item] of value["traces"].entries()) {
    const traceError = validateRequestExecutionRecord(item, `result.traces[${index}]`);
    if (traceError !== null) {
      return traceError;
    }
  }

  return null;
}

function validateObservationRecord(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of ["id", "observed_at", "surface", "kind", "event"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }

  for (const nullableStringField of [
    "ingested_at",
    "request_id",
    "trace_id",
    "span_id",
    "parent_span_id",
    "stage",
    "severity",
    "outcome",
    "route_id",
    "route_name",
    "model_id",
    "provider_id",
    "provider_model_id",
    "client_api_mode",
    "upstream_api_mode",
    "listener",
    "actor",
    "currency",
    "billing_source",
    "benchmark_run_id",
    "benchmark_case_id",
    "optimization_profile_id",
    "tags_json",
    "attributes_json",
    "message"
  ]) {
    if (value[nullableStringField] !== null && !isNonEmptyString(value[nullableStringField])) {
      return {
        message: `Observability IPC ${field}.${nullableStringField} must be a non-empty string or null.`,
        field: `${field}.${nullableStringField}`
      };
    }
  }

  for (const nullableIntegerField of [
    "status_code",
    "latency_ms",
    "ttft_ms",
    "duration_ms",
    "request_bytes",
    "response_bytes",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "estimated_cost_micros"
  ]) {
    if (value[nullableIntegerField] !== null && !isNonNegativeInteger(value[nullableIntegerField])) {
      return {
        message: `Observability IPC ${field}.${nullableIntegerField} must be a non-negative integer or null.`,
        field: `${field}.${nullableIntegerField}`
      };
    }
  }

  if (
    Object.hasOwn(value, "attributes_truncated") &&
    !isNonNegativeInteger(value["attributes_truncated"])
  ) {
    return {
      message: `Observability IPC ${field}.attributes_truncated must be a non-negative integer when present.`,
      field: `${field}.attributes_truncated`
    };
  }

  return null;
}

export function validateTraceShowResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC trace.show result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "trace.show");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["requestExecution"] !== null) {
    const requestExecutionError = validateRequestExecutionRecord(value["requestExecution"], "result.requestExecution");
    if (requestExecutionError !== null) {
      return requestExecutionError;
    }
  }
  if (!Array.isArray(value["observations"])) {
    return {
      message: "Observability IPC trace.show result.observations must be an array.",
      field: "result.observations"
    };
  }
  for (const [index, item] of value["observations"].entries()) {
    const observationError = validateObservationRecord(item, `result.observations[${index}]`);
    if (observationError !== null) {
      return observationError;
    }
  }
  if (!Array.isArray(value["benchmarkSamples"])) {
    return {
      message: "Observability IPC trace.show result.benchmarkSamples must be an array.",
      field: "result.benchmarkSamples"
    };
  }
  for (const [index, item] of value["benchmarkSamples"].entries()) {
    const sampleError = validateBenchmarkSampleRecord(item, `result.benchmarkSamples[${index}]`);
    if (sampleError !== null) {
      return sampleError;
    }
  }

  return null;
}

export function validateTraceObservationsResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC trace.listObservations result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "trace.listObservations");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!Array.isArray(value["observations"])) {
    return {
      message: "Observability IPC trace.listObservations result.observations must be an array.",
      field: "result.observations"
    };
  }
  for (const [index, item] of value["observations"].entries()) {
    const observationError = validateObservationRecord(item, `result.observations[${index}]`);
    if (observationError !== null) {
      return observationError;
    }
  }

  return null;
}

export function validateTraceMismatchValue(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "number";
}

export function validateTraceVerificationResult(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of ["request_id", "status"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  for (const countField of ["observation_count", "mismatch_count"]) {
    if (!isNonNegativeInteger(value[countField])) {
      return {
        message: `Observability IPC ${field}.${countField} must be a non-negative integer.`,
        field: `${field}.${countField}`
      };
    }
  }
  if (!Array.isArray(value["mismatches"])) {
    return {
      message: `Observability IPC ${field}.mismatches must be an array.`,
      field: `${field}.mismatches`
    };
  }

  for (const [index, item] of value["mismatches"].entries()) {
    const mismatchField = `${field}.mismatches[${index}]`;
    if (!isRecord(item)) {
      return {
        message: `Observability IPC ${mismatchField} must be an object.`,
        field: mismatchField
      };
    }
    if (!isNonEmptyString(item["field"])) {
      return {
        message: `Observability IPC ${mismatchField}.field must be a non-empty string.`,
        field: `${mismatchField}.field`
      };
    }
    if (!validateTraceMismatchValue(item["expected"])) {
      return {
        message: `Observability IPC ${mismatchField}.expected must be a string, number, or null.`,
        field: `${mismatchField}.expected`
      };
    }
    if (!validateTraceMismatchValue(item["actual"])) {
      return {
        message: `Observability IPC ${mismatchField}.actual must be a string, number, or null.`,
        field: `${mismatchField}.actual`
      };
    }
  }

  return null;
}

export function validateTraceRepairResult(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of ["request_id", "action"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (!isNonNegativeInteger(value["observation_count"])) {
    return {
      message: `Observability IPC ${field}.observation_count must be a non-negative integer.`,
      field: `${field}.observation_count`
    };
  }

  return validateTraceVerificationResult(value["verification"], `${field}.verification`);
}

export function validateTraceMaintenanceResult(
  value: unknown,
  operation: "trace.verify" | "trace.repair"
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
  if (!Array.isArray(value["results"])) {
    return {
      message: `Observability IPC ${operation} result.results must be an array.`,
      field: "result.results"
    };
  }

  for (const [index, item] of value["results"].entries()) {
    const resultError = operation === "trace.verify"
      ? validateTraceVerificationResult(item, `result.results[${index}]`)
      : validateTraceRepairResult(item, `result.results[${index}]`);
    if (resultError !== null) {
      return resultError;
    }
  }

  return null;
}
