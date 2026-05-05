export function isAllowedObservabilityFilterValue<T extends string>(
  value: string,
  allowedValues: readonly T[]
): value is T {
  return allowedValues.includes(value as T);
}

export function buildAllowedObservabilityFilterMessage(
  label: string,
  allowedValues: readonly string[]
): string {
  return `${label} must be one of: ${allowedValues.join(", ")}`;
}
