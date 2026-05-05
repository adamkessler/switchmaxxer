export const MASKED_SECRET_SENTINEL = "***masked***";
export const MASKED_ENV_NAME_SENTINEL = "(configured)";

export function maskSecretValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return MASKED_SECRET_SENTINEL;
}

export function maskSemiSensitiveEnvVarName(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return MASKED_ENV_NAME_SENTINEL;
}
