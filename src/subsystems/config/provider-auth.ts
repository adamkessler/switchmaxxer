import type { RouteConfig } from "../../platform/types";
import type { SecretString } from "../../platform/secret-string";
import { getEnvValue } from "../../platform/env";
import { isNonEmptyString } from "../../platform/type-guards";

const SAFE_HTTP_HEADER_VALUE_PATTERN = /^[\x09\x20-\x7e]*$/;

export function hasSafeHttpHeaderValueCharset(value: string): boolean {
  return SAFE_HTTP_HEADER_VALUE_PATTERN.test(value);
}

export class ProviderAuthMisconfiguredError extends Error {
  readonly envVar: string | null;
  readonly code: "missing_or_empty" | "invalid_api_key_charset";

  constructor(options: { envVar?: string | null; code: "missing_or_empty" | "invalid_api_key_charset" }) {
    const envVar = options.envVar ?? null;
    const message =
      options.code === "missing_or_empty"
        ? `Provider auth env var '${envVar}' is not set or is empty.`
        : envVar === null
          ? "Provider inline api_key contains invalid header characters."
          : `Provider auth env var '${envVar}' contains invalid header characters.`;

    super(message);
    this.name = "ProviderAuthMisconfiguredError";
    this.code = options.code;
    this.envVar = envVar;
  }
}

export function routeHasConfiguredProviderAuth(route: RouteConfig): boolean {
  return route.inlineApiKey !== null || (route.apiKeyOverride ?? null) !== null || route.apiKeyEnv !== null;
}

function assertValidResolvedProviderApiKey(apiKey: string, envVar: string | null): string {
  if (!hasSafeHttpHeaderValueCharset(apiKey)) {
    throw new ProviderAuthMisconfiguredError({
      envVar,
      code: "invalid_api_key_charset"
    });
  }

  return apiKey;
}

export function revealValidProviderApiKeySecret(apiKey: SecretString, envVar: string | null): string {
  return assertValidResolvedProviderApiKey(apiKey.reveal(), envVar);
}

export function hasSafeProviderApiKeySecretCharset(apiKey: SecretString): boolean {
  return hasSafeHttpHeaderValueCharset(apiKey.reveal());
}

export function resolveRouteApiKey(route: RouteConfig): string | null {
  if (route.inlineApiKey !== null) {
    return revealValidProviderApiKeySecret(route.inlineApiKey, null);
  }

  if (route.apiKeyEnv === null) {
    return null;
  }

  if (route.apiKeyOverride !== null && typeof route.apiKeyOverride !== "undefined") {
    return revealValidProviderApiKeySecret(route.apiKeyOverride, route.apiKeyEnv);
  }

  const envValue = getEnvValue(route.apiKeyEnv);

  if (!isNonEmptyString(envValue)) {
    throw new ProviderAuthMisconfiguredError({
      envVar: route.apiKeyEnv,
      code: "missing_or_empty"
    });
  }

  return assertValidResolvedProviderApiKey(envValue, route.apiKeyEnv);
}
