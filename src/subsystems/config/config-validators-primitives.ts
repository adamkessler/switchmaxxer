import { isLoopbackHostname } from "../../platform/net-utils";
export { isNonEmptyString, isPositiveInteger } from "../../platform/type-guards";
import { isNonEmptyString } from "../../platform/type-guards";

export const CONFIG_VALIDATION_ERROR_CODES = {
  invalidNullableStringField: "invalid_nullable_string_field"
} as const;

export class ConfigValidationError extends Error {
  constructor(
    readonly code: (typeof CONFIG_VALIDATION_ERROR_CODES)[keyof typeof CONFIG_VALIDATION_ERROR_CODES],
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function assertOnlyKnownKeys(
  candidate: Record<string, unknown>,
  allowedKeys: readonly string[],
  sourceName: string
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new Error(`${sourceName} contains unsupported field '${key}'.`);
    }
  }
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isLoopbackBindHost(value: string): boolean {
  return isLoopbackHostname(value);
}

const SYSTEMD_UNIT_NAME_PATTERN = /^[a-zA-Z0-9:_.-]+\.(service|socket|target|timer|mount|path|scope|slice)$/;
const SWITCHMAXXER_MANAGED_ENV_VAR_NAME_PATTERN = /^SWITCHMAXXER_[A-Z][A-Z0-9_]*$/;

export function isValidSystemdUnitName(value: string): boolean {
  if (value.startsWith("-")) {
    return false;
  }

  if (value.includes("\r") || value.includes("\n")) {
    return false;
  }

  if (value.includes("@")) {
    return false;
  }

  return SYSTEMD_UNIT_NAME_PATTERN.test(value);
}

export function assertValidSystemdUnitName(value: string, sourceName: string): void {
  if (!isValidSystemdUnitName(value)) {
    throw new Error(
      `${sourceName} must contain a valid 'systemd_unit' value like 'switchmaxxer.service'.`
    );
  }
}

export function isValidSwitchmaxxerManagedEnvVarName(value: string): boolean {
  return SWITCHMAXXER_MANAGED_ENV_VAR_NAME_PATTERN.test(value);
}

export function assertValidSwitchmaxxerManagedEnvVarName(
  value: string,
  fieldName: string,
  sourceName: string
): void {
  // Security invariant: callers interpolate this value into diagnostics, so
  // it must remain restricted to a newline-free Switchmaxxer-managed name.
  if (!isValidSwitchmaxxerManagedEnvVarName(value)) {
    throw new Error(
      `${sourceName} field '${fieldName}' must reference a Switchmaxxer-managed environment variable name like 'SWITCHMAXXER_OPENAI_API_KEY'.`
    );
  }
}

export function getNullableStringField(
  candidate: Record<string, unknown>,
  fieldName: string,
  sourceName: string
): string | null | undefined {
  const value = candidate[fieldName];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    throw new ConfigValidationError(
      CONFIG_VALIDATION_ERROR_CODES.invalidNullableStringField,
      `${sourceName} field '${fieldName}' must be a non-empty string when provided.`,
      {
        fieldName,
        sourceName
      }
    );
  }

  return value;
}
