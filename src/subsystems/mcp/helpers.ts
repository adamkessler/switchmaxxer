import { loadConfig } from "../config/config";
import { maskSemiSensitiveEnvVarName } from "../../platform/masked-secret";
import { isRecord } from "../../platform/type-guards";
export { resolveObservabilityStorePath } from "../observability/runtime-loader";
import { loadCliReadModel } from "../config/read-model";
import {
  validateModelConfig,
  validateServiceProviderConfig
} from "../config/config-validation";

export function getValidatedConfigEntities(
  document: Record<string, unknown>
): {
  providers: Record<string, ReturnType<typeof validateServiceProviderConfig>>;
  models: Record<string, ReturnType<typeof validateModelConfig>>;
} {
  const providersSection = getMutableSection(document, "service_providers");
  const modelsSection = getMutableSection(document, "models");
  const providers: Record<string, ReturnType<typeof validateServiceProviderConfig>> = {};
  const models: Record<string, ReturnType<typeof validateModelConfig>> = {};

  for (const [providerName, providerValue] of Object.entries(providersSection)) {
    providers[providerName] = validateServiceProviderConfig(providerName, providerValue);
  }

  for (const [modelName, modelValue] of Object.entries(modelsSection)) {
    models[modelName] = validateModelConfig(modelName, modelValue);
  }

  return { providers, models };
}

export function getRouteValidationContext(
  document: Record<string, unknown>,
  configPath?: string
): {
  providers: Record<string, ReturnType<typeof validateServiceProviderConfig>>;
  models: Record<string, ReturnType<typeof validateModelConfig>>;
  defaultTimeoutMs: number;
} {
  const { providers, models } = getValidatedConfigEntities(document);

  return {
    providers,
    models,
    defaultTimeoutMs: loadConfig(configPath).timeoutMs
  };
}

export function collectNormalizedFields(
  requestedValue: Record<string, unknown>,
  storedValue: Record<string, unknown>,
  touchedFields: string[]
): Array<{
  field: string;
  input: unknown;
  stored: unknown;
}> {
  return touchedFields.flatMap((field) => {
    const input = requestedValue[field];
    const stored = storedValue[field];
    return JSON.stringify(input) === JSON.stringify(stored)
      ? []
      : [
          {
            field,
            input,
            stored
          }
        ];
  });
}

export function buildProviderView(provider: ReturnType<typeof loadCliReadModel>["providers"][number]): Record<string, unknown> {
  return {
    name: provider.name,
    api_mode: provider.api_mode,
    endpoint: provider.endpoint,
    allow_private_endpoints: provider.allow_private_endpoints,
    allow_insecure_http: provider.allow_insecure_http,
    anthropic_version: provider.anthropic_version,
    model_id_format: provider.model_id_format,
    auth_source: provider.auth_source,
    api_key_env: maskSemiSensitiveEnvVarName(provider.api_key_env),
    api_key: provider.api_key_masked
  };
}

export function buildRouteView(route: ReturnType<typeof loadCliReadModel>["routes"][number]): Record<string, unknown> {
  return {
    name: route.name,
    display_name: route.display_name,
    model: route.model,
    service_provider: route.service_provider,
    provider_model_id: route.provider_model_id,
    api_mode: route.api_mode,
    timeout_ms: route.timeout_ms,
    effective_timeout_ms: route.effective_timeout_ms,
    cost: route.cost,
    model_cost: route.model_cost,
    effective_cost: route.effective_cost
  };
}

function getMutableSection(
  document: Record<string, unknown>,
  sectionName: "models" | "service_providers" | "routes"
): Record<string, unknown> {
  const candidate = document[sectionName];

  if (!isRecord(candidate)) {
    throw new Error(`config.json must contain a '${sectionName}' object.`);
  }

  return candidate;
}
