import {
  assertOnlyKnownKeys,
  isNonEmptyString,
  isPositiveInteger,
  validateCostConfig,
  validateModelConfig,
  validateServiceProviderConfig
} from "../config-validation";
import { pickCostFields } from "../model-input-contract";
import { revealValidProviderApiKeySecret } from "../provider-auth";

export function validateMutableModelEntity(
  modelId: string,
  candidate: Record<string, unknown>
): Record<string, unknown> {
  const validated = validateModelConfig(modelId, candidate);
  return {
    model_creator: validated.model_creator,
    display_name: validated.display_name,
    cost: validated.cost === null ? null : pickCostFields(validated.cost)
  };
}

export function validateMutableProviderEntity(
  providerId: string,
  candidate: Record<string, unknown>
): Record<string, unknown> {
  const validated = validateServiceProviderConfig(providerId, candidate);
  const normalized: Record<string, unknown> = {
    endpoint: validated.endpoint,
    api_mode: validated.api_mode,
    model_id_format: validated.model_id_format,
    allow_private_endpoints: validated.allow_private_endpoints,
    allow_insecure_http: validated.allow_insecure_http
  };

  if (typeof candidate["api_key"] !== "undefined") {
    normalized["api_key"] = validated.api_key === null ? null : revealValidProviderApiKeySecret(validated.api_key, null);
  }

  if (typeof candidate["api_key_env"] !== "undefined") {
    normalized["api_key_env"] = validated.api_key_env;
  }

  if (typeof candidate["anthropic_version"] !== "undefined" || validated.anthropic_version !== null) {
    normalized["anthropic_version"] = validated.anthropic_version;
  }

  return normalized;
}

export function validateMutableRouteEntity(
  routeId: string,
  candidate: Record<string, unknown>
): Record<string, unknown> {
  assertOnlyKnownKeys(
    candidate,
    ["model", "provider_model_id", "service_provider", "display_name", "cost", "timeout_ms"],
    `Route '${routeId}'`
  );

  if (!isNonEmptyString(candidate["model"])) {
    throw new Error(`Route '${routeId}' is missing a valid 'model' value.`);
  }

  if (!isNonEmptyString(candidate["provider_model_id"])) {
    throw new Error(`Route '${routeId}' is missing a valid 'provider_model_id' value.`);
  }

  if (!isNonEmptyString(candidate["service_provider"])) {
    throw new Error(`Route '${routeId}' is missing a valid 'service_provider' value.`);
  }

  if (!isNonEmptyString(candidate["display_name"])) {
    throw new Error(`Route '${routeId}' is missing a valid 'display_name' value.`);
  }

  if (
    typeof candidate["timeout_ms"] !== "undefined" &&
    candidate["timeout_ms"] !== null &&
    !isPositiveInteger(candidate["timeout_ms"])
  ) {
    throw new Error(`Route '${routeId}' field 'timeout_ms' must be a positive integer when provided.`);
  }

  const normalized: Record<string, unknown> = {
    model: candidate["model"],
    service_provider: candidate["service_provider"],
    provider_model_id: candidate["provider_model_id"],
    display_name: candidate["display_name"]
  };

  if (typeof candidate["timeout_ms"] === "number") {
    normalized["timeout_ms"] = candidate["timeout_ms"];
  }

  if (typeof candidate["cost"] !== "undefined") {
    normalized["cost"] = pickCostFields(validateCostConfig(candidate["cost"], `Route '${routeId}' field 'cost'`));
  }

  return normalized;
}
