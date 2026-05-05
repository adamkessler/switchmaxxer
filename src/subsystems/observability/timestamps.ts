function isIsoTimestampShape(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

export function assertIsoTimestampString(value: unknown, fieldName: string, entityName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${entityName} field '${fieldName}' must be a non-empty string.`);
  }

  if (!isIsoTimestampShape(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${entityName} field '${fieldName}' must be an ISO-8601 timestamp.`);
  }
}

export function assertNullableIsoTimestampString(
  value: unknown,
  fieldName: string,
  entityName: string
): asserts value is string | null | undefined {
  if (typeof value === "undefined" || value === null) {
    return;
  }

  assertIsoTimestampString(value, fieldName, entityName);
}
