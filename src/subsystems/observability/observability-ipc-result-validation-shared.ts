import type { ObservabilityIpcOperationResultValidationError } from "./observability-ipc-result-validation";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateResultEnvelopeFields(
  value: Record<string, unknown>,
  operation: string
): ObservabilityIpcOperationResultValidationError | null {
  if (!isNonEmptyString(value["dbPath"])) {
    return {
      message: `Observability IPC ${operation} result.dbPath must be a non-empty string.`,
      field: "result.dbPath"
    };
  }
  if (typeof value["storeFound"] !== "boolean") {
    return {
      message: `Observability IPC ${operation} result.storeFound must be a boolean.`,
      field: "result.storeFound"
    };
  }

  return null;
}

export function validateOptionalNullableNonNegativeNumber(value: Record<string, unknown>, field: string): string | null {
  if (value[field] === null || !Object.hasOwn(value, field)) {
    return null;
  }

  return isNonNegativeNumber(value[field]) ? null : `${field} must be a non-negative number or null.`;
}

export function validateHistoryDeleteCounts(
  value: unknown,
  field: string,
  countFields: readonly string[]
): ObservabilityIpcOperationResultValidationError | null {
  if (!isRecord(value)) {
    return {
      message: `Observability IPC ${field} must be an object or null.`,
      field
    };
  }

  for (const countField of countFields) {
    if (!isNonNegativeInteger(value[countField])) {
      return {
        message: `Observability IPC ${field}.${countField} must be a non-negative integer.`,
        field: `${field}.${countField}`
      };
    }
  }

  return null;
}
