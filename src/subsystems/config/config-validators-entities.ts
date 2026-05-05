import { validateProviderEndpointPolicy } from "../proxy/provider-endpoint-policy";
import { getEnvValue } from "../../platform/env";
import { SecretString } from "../../platform/secret-string";
import { isRecord } from "../../platform/type-guards";
import {
  normalizeApiMode,
  normalizeModelIdFormat,
  type ApiMode,
  type CostConfig,
  type ModelIdFormat,
  type RouteConfig
} from "../../platform/types";
import { hasSafeHttpHeaderValueCharset, hasSafeProviderApiKeySecretCharset } from "./provider-auth";
import {
  assertOnlyKnownKeys,
  assertValidSwitchmaxxerManagedEnvVarName,
  getNullableStringField,
  isNonEmptyString,
  isNonNegativeNumber,
  isPositiveInteger
} from "./config-validators-primitives";

export function validateCostConfig(candidate: unknown, sourceName: string): CostConfig {
  if (!isRecord(candidate)) {
    throw new Error(`${sourceName} must be an object.`);
  }

  const cost = candidate;
  assertOnlyKnownKeys(cost, ["input", "output", "cache_read", "cache_write"], sourceName);

  if (!isNonNegativeNumber(cost["input"])) {
    throw new Error(`${sourceName} must contain a non-negative numeric 'input'.`);
  }

  if (!isNonNegativeNumber(cost["output"])) {
    throw new Error(`${sourceName} must contain a non-negative numeric 'output'.`);
  }

  if (!isNonNegativeNumber(cost["cache_read"])) {
    throw new Error(`${sourceName} must contain a non-negative numeric 'cache_read'.`);
  }

  if (!isNonNegativeNumber(cost["cache_write"])) {
    throw new Error(`${sourceName} must contain a non-negative numeric 'cache_write'.`);
  }

  return {
    input: cost["input"],
    output: cost["output"],
    cacheRead: cost["cache_read"],
    cacheWrite: cost["cache_write"]
  };
}

export interface ValidatedServiceProviderConfig {
  endpoint: string;
  api_key: SecretString | null;
  api_key_env: string | null;
  api_mode: ApiMode;
  anthropic_version: string | null;
  model_id_format: ModelIdFormat;
  allow_private_endpoints: boolean;
  allow_insecure_http: boolean;
}

export function validateServiceProviderConfig(
  name: string,
  provider: unknown
): ValidatedServiceProviderConfig {
  if (!isRecord(provider)) {
    throw new Error(`Service provider '${name}' must be an object.`);
  }

  const candidate = provider;
  assertOnlyKnownKeys(
    candidate,
    [
      "endpoint",
      "api_key",
      "api_key_env",
      "api_mode",
      "anthropic_version",
      "model_id_format",
      "allow_private_endpoints",
      "allow_insecure_http"
    ],
    `Service provider '${name}'`
  );

  if (!isNonEmptyString(candidate["endpoint"])) {
    throw new Error(`Service provider '${name}' is missing a valid 'endpoint' value.`);
  }

  if (
    typeof candidate["allow_private_endpoints"] !== "undefined" &&
    typeof candidate["allow_private_endpoints"] !== "boolean"
  ) {
    throw new Error(`Service provider '${name}' field 'allow_private_endpoints' must be a boolean.`);
  }

  if (
    typeof candidate["allow_insecure_http"] !== "undefined" &&
    typeof candidate["allow_insecure_http"] !== "boolean"
  ) {
    throw new Error(`Service provider '${name}' field 'allow_insecure_http' must be a boolean.`);
  }

  const allowPrivateEndpoints = candidate["allow_private_endpoints"] === true;
  const allowInsecureHttp = candidate["allow_insecure_http"] === true;
  validateProviderEndpointPolicy(name, candidate["endpoint"], {
    allowPrivateEndpoints,
    allowInsecureHttp
  });

  const rawApiKey = getNullableStringField(candidate, "api_key", `Service provider '${name}'`) ?? null;
  const apiKeyEnv = getNullableStringField(candidate, "api_key_env", `Service provider '${name}'`) ?? null;
  const apiKey = rawApiKey === null ? null : new SecretString(rawApiKey);

  if (rawApiKey !== null && !hasSafeHttpHeaderValueCharset(rawApiKey)) {
    throw new Error(`Service provider '${name}' field 'api_key' contains invalid HTTP header characters.`);
  }

  if (apiKeyEnv !== null) {
    assertValidSwitchmaxxerManagedEnvVarName(apiKeyEnv, "api_key_env", `Service provider '${name}'`);
  }

  if (typeof candidate["api_key"] === "undefined" && typeof candidate["api_key_env"] === "undefined") {
    throw new Error(
      `Service provider '${name}' must define either 'api_key' or 'api_key_env' (or null for no-auth providers).`
    );
  }

  const apiMode = normalizeApiMode(candidate["api_mode"]);

  if (apiMode === null) {
    throw new Error(`Service provider '${name}' is missing a valid 'api_mode' value.`);
  }

  const anthropicVersion =
    getNullableStringField(candidate, "anthropic_version", `Service provider '${name}'`) ?? null;
  const modelIdFormat =
    typeof candidate["model_id_format"] === "undefined"
      ? "passthrough"
      : normalizeModelIdFormat(candidate["model_id_format"]);

  if (modelIdFormat === null) {
    throw new Error(`Service provider '${name}' field 'model_id_format' must be one of: passthrough, creator/model.`);
  }

  return {
    endpoint: candidate["endpoint"],
    api_key: apiKey,
    api_key_env: apiKeyEnv,
    api_mode: apiMode,
    anthropic_version: anthropicVersion,
    model_id_format: modelIdFormat,
    allow_private_endpoints: allowPrivateEndpoints,
    allow_insecure_http: allowInsecureHttp
  };
}

export interface ValidatedModelConfig {
  model_creator: string;
  display_name: string;
  cost: CostConfig | null;
}

export function validateModelConfig(name: string, model: unknown): ValidatedModelConfig {
  if (!isRecord(model)) {
    throw new Error(`Model '${name}' must be an object.`);
  }

  const candidate = model;
  assertOnlyKnownKeys(candidate, ["model_creator", "display_name", "cost"], `Model '${name}'`);

  if (!isNonEmptyString(candidate["model_creator"])) {
    throw new Error(`Model '${name}' is missing a valid 'model_creator' value.`);
  }

  if (!isNonEmptyString(candidate["display_name"])) {
    throw new Error(`Model '${name}' is missing a valid 'display_name' value.`);
  }

  return {
    model_creator: candidate["model_creator"],
    display_name: candidate["display_name"],
    cost:
      typeof candidate["cost"] === "undefined" ? null : validateCostConfig(candidate["cost"], `Model '${name}' field 'cost'`)
  };
}

export function validateRouteConfig(
  routeName: string,
  route: unknown,
  providers: Record<string, ValidatedServiceProviderConfig>,
  models: Record<string, ValidatedModelConfig>,
  defaultTimeoutMs: number,
  options: {
    requireResolvedProviderAuth?: boolean;
    providerApiKeyOverrides?: Record<string, SecretString> | null;
  } = {}
): RouteConfig {
  if (!isRecord(route)) {
    throw new Error(`Route '${routeName}' must be an object.`);
  }

  const candidate = route;
  assertOnlyKnownKeys(
    candidate,
    ["model", "provider_model_id", "service_provider", "display_name", "cost", "timeout_ms"],
    `Route '${routeName}'`
  );

  if (!isNonEmptyString(candidate["model"])) {
    throw new Error(`Route '${routeName}' is missing a valid 'model' value.`);
  }

  if (!isNonEmptyString(candidate["provider_model_id"])) {
    throw new Error(`Route '${routeName}' is missing a valid 'provider_model_id' value.`);
  }

  if (!isNonEmptyString(candidate["service_provider"])) {
    throw new Error(`Route '${routeName}' is missing a valid 'service_provider' value.`);
  }

  if (!isNonEmptyString(candidate["display_name"])) {
    throw new Error(`Route '${routeName}' is missing a valid 'display_name' value.`);
  }

  if (
    typeof candidate["timeout_ms"] !== "undefined" &&
    candidate["timeout_ms"] !== null &&
    !isPositiveInteger(candidate["timeout_ms"])
  ) {
    throw new Error(`Route '${routeName}' field 'timeout_ms' must be a positive integer when provided.`);
  }

  const modelName = candidate["model"];
  const model = models[modelName];

  if (!model) {
    throw new Error(`Route '${routeName}' references unknown model '${modelName}'.`);
  }

  const providerName = candidate["service_provider"];
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Route '${routeName}' references unknown service provider '${providerName}'.`);
  }

  const requireResolvedProviderAuth = options.requireResolvedProviderAuth !== false;
  const apiKeyOverride = provider.api_key !== null || provider.api_key_env === null
    ? null
    : options.providerApiKeyOverrides?.[provider.api_key_env] ?? null;

  if (provider.api_key === null && provider.api_key_env) {
    if (apiKeyOverride !== null) {
      if (requireResolvedProviderAuth && !hasSafeProviderApiKeySecretCharset(apiKeyOverride)) {
        throw new Error(
          `Route '${routeName}' requires secrets override for environment variable '${provider.api_key_env}', but it contains invalid HTTP header characters.`
        );
      }
    } else {
      const envValue = getEnvValue(provider.api_key_env);

      if (!isNonEmptyString(envValue)) {
        if (requireResolvedProviderAuth) {
          throw new Error(
            `Route '${routeName}' requires environment variable '${provider.api_key_env}', but it is not set or is empty.`
          );
        }
      } else if (!hasSafeHttpHeaderValueCharset(envValue)) {
        if (requireResolvedProviderAuth) {
          throw new Error(
            `Route '${routeName}' requires environment variable '${provider.api_key_env}', but it contains invalid HTTP header characters.`
          );
        }
      }
    }
  }

  return {
    serviceProvider: providerName,
    api_mode: provider.api_mode,
    anthropicVersion: provider.anthropic_version,
    upstreamModelIdFormat: provider.model_id_format,
    modelCreator: model.model_creator,
    model: candidate["provider_model_id"],
    baseUrl: provider.endpoint,
    allowPrivateEndpoints: provider.allow_private_endpoints,
    apiKeyEnv: provider.api_key_env,
    inlineApiKey: provider.api_key,
    apiKeyOverride,
    cost:
      typeof candidate["cost"] === "undefined" ? null : validateCostConfig(candidate["cost"], `Route '${routeName}' field 'cost'`),
    modelCost: model.cost,
    routeTimeoutMs: typeof candidate["timeout_ms"] === "number" ? candidate["timeout_ms"] : null,
    timeoutMs: typeof candidate["timeout_ms"] === "number" ? candidate["timeout_ms"] : defaultTimeoutMs
  };
}
