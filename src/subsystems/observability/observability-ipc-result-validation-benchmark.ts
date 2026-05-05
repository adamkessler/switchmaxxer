import type { ObservabilityIpcOperationResultValidationError } from "./observability-ipc-result-validation";
import {
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  validateHistoryDeleteCounts,
  validateOptionalNullableNonNegativeNumber,
  validateResultEnvelopeFields
} from "./observability-ipc-result-validation-shared";

function validateBenchmarkRunRecord(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const runField of ["id", "name", "created_at", "objective", "settings_json", "status"]) {
    if (!isNonEmptyString(value[runField])) {
      return {
        message: `Observability IPC ${field}.${runField} must be a non-empty string.`,
        field: `${field}.${runField}`
      };
    }
  }

  if (value["created_by"] !== null && !isNonEmptyString(value["created_by"])) {
    return {
      message: `Observability IPC ${field}.created_by must be a non-empty string or null.`,
      field: `${field}.created_by`
    };
  }
  if (value["notes"] !== null && !isNonEmptyString(value["notes"])) {
    return {
      message: `Observability IPC ${field}.notes must be a non-empty string or null.`,
      field: `${field}.notes`
    };
  }

  return null;
}

export function validateBenchmarkRunSummary(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const summaryField of ["total_samples", "measured_samples", "warmup_samples", "success_count", "failed_count"]) {
    if (!isNonNegativeInteger(value[summaryField])) {
      return {
        message: `Observability IPC ${field}.${summaryField} must be a non-negative integer.`,
        field: `${field}.${summaryField}`
      };
    }
  }

  for (const summaryField of [
    "average_latency_ms",
    "min_latency_ms",
    "max_latency_ms",
    "average_ttft_ms",
    "average_duration_ms"
  ]) {
    const message = validateOptionalNullableNonNegativeNumber(value, summaryField);
    if (message !== null) {
      return {
        message: `Observability IPC ${field}.${message}`,
        field: `${field}.${summaryField}`
      };
    }
  }

  return null;
}

export function validateBenchmarkSampleRecord(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const sampleField of ["id", "benchmark_run_id", "request_execution_id", "started_at", "outcome"]) {
    if (!isNonEmptyString(value[sampleField])) {
      return {
        message: `Observability IPC ${field}.${sampleField} must be a non-empty string.`,
        field: `${field}.${sampleField}`
      };
    }
  }

  for (const nullableStringField of [
    "route_id",
    "provider_id",
    "provider_model_id",
    "completed_at",
    "score_scale",
    "score_direction",
    "score_source",
    "score_method",
    "scored_at",
    "score_json"
  ]) {
    if (value[nullableStringField] !== null && !isNonEmptyString(value[nullableStringField])) {
      return {
        message: `Observability IPC ${field}.${nullableStringField} must be a non-empty string or null.`,
        field: `${field}.${nullableStringField}`
      };
    }
  }

  for (const integerField of [
    "sample_index",
    "status_code",
    "latency_ms",
    "ttft_ms",
    "duration_ms",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "estimated_cost_micros",
    "is_warmup"
  ]) {
    if (value[integerField] !== null && !isNonNegativeInteger(value[integerField])) {
      return {
        message: `Observability IPC ${field}.${integerField} must be a non-negative integer or null.`,
        field: `${field}.${integerField}`
      };
    }
  }

  if (value["score_value"] !== null && !isFiniteNumber(value["score_value"])) {
    return {
      message: `Observability IPC ${field}.score_value must be a finite number or null.`,
      field: `${field}.score_value`
    };
  }

  return null;
}

function validateBenchmarkReportView(
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
  if (!isRecord(value["run"])) {
    return {
      message: `Observability IPC ${field}.run must be an object.`,
      field: `${field}.run`
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
  if (!isRecord(value["analysis"])) {
    return {
      message: `Observability IPC ${field}.analysis must be an object.`,
      field: `${field}.analysis`
    };
  }
  if (!Array.isArray(value["analysis"]["by_path"])) {
    return {
      message: `Observability IPC ${field}.analysis.by_path must be an array.`,
      field: `${field}.analysis.by_path`
    };
  }
  if (!Array.isArray(value["samples"])) {
    return {
      message: `Observability IPC ${field}.samples must be an array.`,
      field: `${field}.samples`
    };
  }
  for (const [index, item] of value["samples"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC ${field}.samples[${index}] must be an object.`,
        field: `${field}.samples[${index}]`
      };
    }
  }

  return null;
}

function validateBenchmarkRunnerFailure(
  value: unknown,
  field: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object.`,
      field
    };
  }

  for (const stringField of ["kind", "code", "message"]) {
    if (!isNonEmptyString(value[stringField])) {
      return {
        message: `Observability IPC ${field}.${stringField} must be a non-empty string.`,
        field: `${field}.${stringField}`
      };
    }
  }
  if (Object.hasOwn(value, "details") && !isRecord(value["details"])) {
    return {
      message: `Observability IPC ${field}.details must be an object when present.`,
      field: `${field}.details`
    };
  }

  return null;
}

export function validateBenchmarkRunnerResult(
  value: unknown,
  field: string
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
    return validateBenchmarkRunnerFailure(value["failure"], `${field}.failure`);
  }

  if (!isNonEmptyString(value["benchmarkRunId"])) {
    return {
      message: `Observability IPC ${field}.benchmarkRunId must be a non-empty string.`,
      field: `${field}.benchmarkRunId`
    };
  }

  const runError = validateBenchmarkRunRecord(value["run"], `${field}.run`);
  if (runError !== null) {
    return runError;
  }
  const summaryError = validateBenchmarkRunSummary(value["summary"], `${field}.summary`);
  if (summaryError !== null) {
    return summaryError;
  }
  if (!Array.isArray(value["samples"])) {
    return {
      message: `Observability IPC ${field}.samples must be an array.`,
      field: `${field}.samples`
    };
  }
  for (const [index, item] of value["samples"].entries()) {
    const sampleError = validateBenchmarkSampleRecord(item, `${field}.samples[${index}]`);
    if (sampleError !== null) {
      return sampleError;
    }
  }
  if (!Array.isArray(value["sampleViews"])) {
    return {
      message: `Observability IPC ${field}.sampleViews must be an array.`,
      field: `${field}.sampleViews`
    };
  }
  for (const [index, item] of value["sampleViews"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC ${field}.sampleViews[${index}] must be an object.`,
        field: `${field}.sampleViews[${index}]`
      };
    }
  }

  return validateBenchmarkReportView(value["report"], `${field}.report`);
}

export function validateBenchmarkRunResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC benchmarkRuns.run result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "benchmarkRuns.run");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["result"] === null) {
    return null;
  }

  return validateBenchmarkRunnerResult(value["result"], "result.result");
}

export function validateBenchmarkHistoryListResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC benchmarkHistory.list result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "benchmarkHistory.list");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (!Array.isArray(value["runs"])) {
    return {
      message: "Observability IPC benchmarkHistory.list result.runs must be an array.",
      field: "result.runs"
    };
  }

  for (const [index, item] of value["runs"].entries()) {
    if (!isRecord(item)) {
      return {
        message: `Observability IPC benchmarkHistory.list result.runs[${index}] must be an object.`,
        field: `result.runs[${index}]`
      };
    }

    const runError = validateBenchmarkRunRecord(item["run"], `result.runs[${index}].run`);
    if (runError !== null) {
      return runError;
    }
    const summaryError = validateBenchmarkRunSummary(item["summary"], `result.runs[${index}].summary`);
    if (summaryError !== null) {
      return summaryError;
    }
  }

  return null;
}

export function validateBenchmarkHistoryShowResult(value: unknown): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC benchmarkHistory.show result must be an object.",
      field: "result"
    };
  }

  const envelopeError = validateResultEnvelopeFields(value, "benchmarkHistory.show");
  if (envelopeError !== null) {
    return envelopeError;
  }
  if (value["run"] !== null) {
    const runError = validateBenchmarkRunRecord(value["run"], "result.run");
    if (runError !== null) {
      return runError;
    }
  }
  if (value["summary"] !== null) {
    const summaryError = validateBenchmarkRunSummary(value["summary"], "result.summary");
    if (summaryError !== null) {
      return summaryError;
    }
  }
  if (!Array.isArray(value["samples"])) {
    return {
      message: "Observability IPC benchmarkHistory.show result.samples must be an array.",
      field: "result.samples"
    };
  }

  for (const [index, item] of value["samples"].entries()) {
    const sampleError = validateBenchmarkSampleRecord(item, `result.samples[${index}]`);
    if (sampleError !== null) {
      return sampleError;
    }
  }

  return null;
}

export function validateBenchmarkHistoryDeleteResult(
  value: unknown,
  operation: "benchmarkHistory.pruneOlderThan" | "benchmarkHistory.deleteRun" | "benchmarkHistory.clear"
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
    "benchmark_runs_deleted",
    "benchmark_samples_deleted",
    "total_deleted"
  ]);
}
