import { createHash, timingSafeEqual } from "node:crypto";

import { getEnvValue } from "../../../../platform/env";
import type { SecretString } from "../../../../platform/secret-string";

export const MIN_INBOUND_API_KEY_LENGTH = 32;

export type InboundApiKeyOverrides = Record<string, SecretString> | null | undefined;

export type InboundApiKeyResolution =
  | { kind: "value"; value: string }
  | { kind: "missing" }
  | { kind: "empty" };

/**
 * Resolves the inbound API key for `envName` from the secrets-file override
 * map first, then from `process.env`. Distinguishes "missing" (no value
 * provided by either path) from "empty" (a value is provided but it is empty
 * or whitespace). This is the single boundary in the codebase that is
 * permitted to call `.reveal()` on an inbound-auth `SecretString`.
 */
export function resolveInboundApiKey(
  envName: string,
  apiKeyOverrides?: InboundApiKeyOverrides
): InboundApiKeyResolution {
  const override = apiKeyOverrides?.[envName];
  if (override) {
    const revealed = override.reveal();
    if (typeof revealed !== "string") {
      return { kind: "missing" };
    }
    if (revealed.trim().length === 0) {
      return { kind: "empty" };
    }
    return { kind: "value", value: revealed };
  }
  const envValue = getEnvValue(envName);
  if (typeof envValue !== "string") {
    return { kind: "missing" };
  }
  if (envValue.trim().length === 0) {
    return { kind: "empty" };
  }
  return { kind: "value", value: envValue };
}

/**
 * Convenience wrapper that returns the resolved value or null when the key is
 * missing or empty, for callers that do not need to distinguish those cases
 * (e.g. the production config validator).
 */
export function resolveInboundApiKeyValue(
  envName: string,
  apiKeyOverrides?: InboundApiKeyOverrides
): string | null {
  const result = resolveInboundApiKey(envName, apiKeyOverrides);
  return result.kind === "value" ? result.value : null;
}
export const LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER = "x-switchmaxxer-local-client";
export const LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE = "1";

export type LocalGatewayInboundAuthState =
  | { kind: "disabled_explicit" }
  | { kind: "token"; token: string; envVar: string }
  | { kind: "misconfigured"; reason: "missing_env_name" | "missing_token" | "empty_token" | "short_token"; envVar?: string };

export type LocalGatewayInboundAuthStatus = "enabled" | "disabled_explicit" | "misconfigured";
export type LocalGatewayInboundAuthMisconfigurationReason = Extract<
  LocalGatewayInboundAuthState,
  { kind: "misconfigured" }
>["reason"];
export type LocalGatewayInboundAuthStateView = {
  status: LocalGatewayInboundAuthStatus;
  env_var: string | null;
  reason: LocalGatewayInboundAuthMisconfigurationReason | null;
};

export function timingSafeTokenMatches(candidate: string, expected: string): boolean {
  // Hash first so timingSafeEqual always compares fixed-length buffers instead
  // of leaking raw token length through a mismatch path.
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function resolveLocalGatewayInboundAuthToken(
  inboundApiKeyEnv?: string | null,
  allowUnauthenticatedGateway = false,
  apiKeyOverrides?: InboundApiKeyOverrides
): string | null {
  const authState = resolveLocalGatewayInboundAuthState(
    inboundApiKeyEnv,
    allowUnauthenticatedGateway,
    apiKeyOverrides
  );

  if (authState.kind === "disabled_explicit") {
    return null;
  }

  if (authState.kind === "misconfigured") {
    if (authState.reason === "missing_env_name") {
      throw new Error(
        "Gateway inbound auth requires either a non-empty 'inbound_api_key_env' or 'allow_unauthenticated_gateway: true'."
      );
    }

    if (authState.reason === "short_token") {
      throw new Error(
        `Gateway inbound auth env var '${authState.envVar}' must be at least ${MIN_INBOUND_API_KEY_LENGTH} characters long.`
      );
    }

    throw new Error(`Gateway inbound auth env var '${authState.envVar}' is not set or is empty.`);
  }

  return authState.token;
}

export function resolveLocalGatewayInboundAuthState(
  inboundApiKeyEnv?: string | null,
  allowUnauthenticatedGateway = false,
  apiKeyOverrides?: InboundApiKeyOverrides
): LocalGatewayInboundAuthState {
  if (typeof inboundApiKeyEnv !== "string" || inboundApiKeyEnv.trim().length === 0) {
    if (allowUnauthenticatedGateway) {
      return { kind: "disabled_explicit" };
    }

    return { kind: "misconfigured", reason: "missing_env_name" };
  }

  const resolution = resolveInboundApiKey(inboundApiKeyEnv, apiKeyOverrides);

  if (resolution.kind === "missing") {
    return { kind: "misconfigured", reason: "missing_token", envVar: inboundApiKeyEnv };
  }

  if (resolution.kind === "empty") {
    return { kind: "misconfigured", reason: "empty_token", envVar: inboundApiKeyEnv };
  }

  const token = resolution.value;

  if (token.length < MIN_INBOUND_API_KEY_LENGTH) {
    return { kind: "misconfigured", reason: "short_token", envVar: inboundApiKeyEnv };
  }

  return { kind: "token", token, envVar: inboundApiKeyEnv };
}

export function describeLocalGatewayInboundAuthState(authState: LocalGatewayInboundAuthState): {
  status: "enabled" | "disabled_explicit" | "misconfigured";
  envVar: string | null;
} {
  if (authState.kind === "disabled_explicit") {
    return {
      status: "disabled_explicit",
      envVar: null
    };
  }

  if (authState.kind === "misconfigured") {
    return {
      status: "misconfigured",
      envVar: authState.envVar ?? null
    };
  }

  return {
    status: "enabled",
    envVar: authState.envVar
  };
}

export function buildLocalGatewayInboundAuthStateView(
  authState: LocalGatewayInboundAuthState,
  options: {
    formatEnvVarName?: (value: string | null) => string | null;
  } = {}
): LocalGatewayInboundAuthStateView {
  const description = describeLocalGatewayInboundAuthState(authState);
  const envVar = options.formatEnvVarName
    ? options.formatEnvVarName(description.envVar)
    : description.envVar;

  return {
    status: description.status,
    env_var: envVar,
    reason: authState.kind === "misconfigured" ? authState.reason : null
  };
}

export function buildLocalGatewayInboundAuthTokenFingerprint(token: string): string {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12)}`;
}

export function buildLocalGatewayAuthHeaders(
  inboundApiKeyEnv?: string | null,
  allowUnauthenticatedGateway = false,
  oneTrustedOperatorBoundary = false,
  apiKeyOverrides?: InboundApiKeyOverrides
): Headers {
  const headers = new Headers();
  const authState = resolveLocalGatewayInboundAuthState(
    inboundApiKeyEnv,
    allowUnauthenticatedGateway,
    apiKeyOverrides
  );

  if (authState.kind === "disabled_explicit") {
    if (oneTrustedOperatorBoundary) {
      return headers;
    }

    headers.set(
      LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER,
      LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
    );
    return headers;
  }

  if (authState.kind === "misconfigured") {
    resolveLocalGatewayInboundAuthToken(inboundApiKeyEnv, allowUnauthenticatedGateway, apiKeyOverrides);
    return headers;
  }

  headers.set("authorization", `Bearer ${authState.token}`);
  return headers;
}
