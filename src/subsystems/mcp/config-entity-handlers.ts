import {
  MCP_ENTITY_STATE_ERROR_CODES,
  buildModelFieldMetadata,
  buildProviderFieldMetadata,
  buildRouteFieldMetadata
} from "../config/config-metadata";
import { APP_ERROR_CODES, type AppErrorCode as McpErrorCode } from "../../platform/error-codes";
import { getNonEmptyEnvValue } from "../../platform/env";
import { loadConfig } from "../config/config";
import { loadCliReadModel } from "../config/read-model";
import { pickCostFields } from "../config/model-input-contract";
import { buildSuccessEnvelope, type ErrorEnvelope, type SuccessEnvelope } from "../../platform/response-envelope";
import { createEntityMutationRuntimes } from "../config/mutation";
import {
  type ModelsCreateArgs,
  type ModelsDeleteArgs,
  type ModelsShowArgs,
  type ModelsUpdateArgs,
  type ProvidersClearKeyArgs,
  type ProvidersCreateArgs,
  type ProvidersDeleteArgs,
  type ProvidersSetKeyArgs,
  type ProvidersSetKeyEnvArgs,
  type ProvidersShowArgs,
  type ProvidersUpdateArgs,
  type RoutesCreateArgs,
  type RoutesDeleteArgs,
  type RoutesShowArgs,
  type RoutesUpdateArgs
} from "./parsers";
import { McpToolError, entityStateError } from "./errors";
import { buildHandledResult, buildMcpErrorEnvelope } from "./envelope";
import {
  buildProviderView,
  buildRouteView,
  collectNormalizedFields
} from "./helpers";
import { getMutableSection, mutateConfigDocument } from "./config-runtime";
import { invalidInputFieldError } from "./errors";

type McpErrorEnvelope = ErrorEnvelope<McpErrorCode>;
type McpSuccessEnvelope = SuccessEnvelope;

function getConfigWarnings(configPath?: string): Array<{
  code: string;
  message: string;
  provider: string;
}> {
  const readModel = loadCliReadModel(configPath);

  return readModel.providers
    .filter((provider) => provider.auth_source === "inline override")
    .map((provider) => ({
      code: "inline_api_key_override",
      message: `Provider '${provider.name}' is using an inline api_key override that takes precedence over api_key_env.`,
      provider: provider.name
    }));
}

function getConfigMissingEnvDetails(configPath?: string): Array<{
  code: string;
  message: string;
  provider: string;
  env_var: string;
  affected_routes: string[];
}> {
  const readModel = loadCliReadModel(configPath);

  return readModel.providers
    .filter(
      (provider) =>
        provider.auth_source === "env var" &&
        typeof provider.api_key_env === "string" &&
        provider.api_key_env.trim().length > 0 &&
        getNonEmptyEnvValue(provider.api_key_env) === null
    )
    .map((provider) => ({
      code: "missing_env_var",
      message: `Provider '${provider.name}' depends on missing environment variable '${provider.api_key_env}'.`,
      provider: provider.name,
      env_var: provider.api_key_env as string,
      affected_routes: readModel.routes
        .filter((route) => route.service_provider === provider.name)
        .map((route) => route.name)
    }));
}

const {
  modelMutationRuntime,
  providerMutationRuntime,
  providerAuthMutationRuntime,
  routeMutationRuntime
} = createEntityMutationRuntimes({
  loadCliReadModel,
  mutateConfigDocument,
  getMutableModels: (document) => getMutableSection(document, "models"),
  getMutableProviders: (document) => getMutableSection(document, "service_providers"),
  getMutableRoutes: (document) => getMutableSection(document, "routes"),
  entityStateErrorCodes: MCP_ENTITY_STATE_ERROR_CODES,
  createEntityStateError: (code, message) => entityStateError(code, message),
  createInvalidInputMutationError: (message) => invalidInputFieldError(message),
  createInvalidConfigMutationError: (message: string) => new McpToolError("invalid_config_mutation" as McpErrorCode, message)
});

export function buildConfigValidatePayload(configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  try {
    const config = loadConfig(configPath);
    const warnings = getConfigWarnings(configPath);

    return buildSuccessEnvelope(
      "config validate",
      {
        valid: true,
        source_file: config.sourceFile,
        bind_host: config.bindHost,
        route_count: Object.keys(config.routes).length
      },
      { warnings }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    const warnings = (() => {
      try {
        return getConfigWarnings(configPath);
      } catch {
        return [];
      }
    })();
    const missingEnvDetails = (() => {
      try {
        return getConfigMissingEnvDetails(configPath);
      } catch {
        return [];
      }
    })();

    return buildMcpErrorEnvelope("config validate", APP_ERROR_CODES.invalidConfig, message, {
      warnings,
      details: {
        missing_env: missingEnvDetails
      }
    });
  }
}

export function buildRoutesExplainPayload(
  args: RoutesShowArgs,
  configPath?: string
): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("routes explain", APP_ERROR_CODES.routesExplainError, () => {
    const { routeId } = args;
    const readModel = loadCliReadModel(configPath);
    const route = readModel.routesByName[routeId];

    if (!route) {
      return buildMcpErrorEnvelope("routes explain", MCP_ENTITY_STATE_ERROR_CODES.routeNotFound, `Route '${routeId}' was not found`);
    }

    const explanationLines = [
      `Route Name Meaning: callers use '${route.name}' as the operator-facing route key.`,
      `Display Name Meaning: '${route.display_name || "(none)"}' is the human-facing label stored on this route.`,
      `Canonical Model Meaning: '${route.model || "(none)"}' is the canonical model key referenced by this route.`,
      `Service Provider Meaning: '${route.service_provider || "(none)"}' is the configured provider entry this route uses for upstream transport.`,
      `Provider Model ID Meaning: '${route.provider_model_id || "(none)"}' is the exact model identifier sent to the upstream provider.`,
      `API Mode Meaning: '${route.api_mode || "(unknown)"}' is the outbound API dialect configured on the selected provider.`,
      `Timeout Meaning: route timeout override is '${String(route.timeout_ms ?? "(inherit)")}', and the effective request timeout is '${String(route.effective_timeout_ms ?? "(unknown)")}' milliseconds.`
    ];

    return buildSuccessEnvelope("routes explain", {
      name: route.name,
      display_name: route.display_name,
      model: route.model,
      service_provider: route.service_provider,
      provider_model_id: route.provider_model_id,
      api_mode: route.api_mode,
      timeout_ms: route.timeout_ms,
      effective_timeout_ms: route.effective_timeout_ms,
      explanation_lines: explanationLines
    });
  });
}

export function buildModelsCreatePayload(args: ModelsCreateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("models create", APP_ERROR_CODES.modelsCreateError, () => {
    const { modelId, requestedModel } = args;
    const { model, normalizedModel } = modelMutationRuntime.createModel(configPath, modelId, {
      ...requestedModel,
      ...(typeof requestedModel["cost"] === "undefined"
        ? {}
        : { cost: pickCostFields(requestedModel["cost"] as Parameters<typeof pickCostFields>[0]) })
    });
    const normalizedFields = collectNormalizedFields(
      requestedModel,
      normalizedModel,
      Object.keys(requestedModel)
    );
    return buildSuccessEnvelope("models create", model, {
      ...(normalizedFields.length > 0 ? { normalized_fields: normalizedFields } : {})
    });
  });
}

export function buildModelsUpdatePayload(args: ModelsUpdateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("models update", APP_ERROR_CODES.modelsUpdateError, () => {
    const { modelId, displayName, modelCreator, cost } = args;
    const nextValue: Record<string, unknown> = {};

    if (typeof displayName !== "undefined") nextValue["display_name"] = displayName;
    if (typeof modelCreator !== "undefined") nextValue["model_creator"] = modelCreator;
    if (typeof cost !== "undefined") nextValue["cost"] = cost;

    const touchedFields = [
      ...(typeof displayName !== "undefined" ? ["display_name"] : []),
      ...(typeof modelCreator !== "undefined" ? ["model_creator"] : []),
      ...(typeof cost !== "undefined" ? ["cost"] : [])
    ];
    const { model, normalizedModel } = modelMutationRuntime.updateModel(configPath, modelId, {
      ...(typeof displayName !== "undefined" ? { display_name: displayName } : {}),
      ...(typeof modelCreator !== "undefined" ? { model_creator: modelCreator } : {}),
      ...(typeof cost !== "undefined"
        ? {
            cost: cost === null
              ? null
              : pickCostFields(cost)
          }
        : {})
    });
    const normalizedFields = collectNormalizedFields(nextValue, normalizedModel, touchedFields);
    return buildSuccessEnvelope("models update", model, {
      ...(normalizedFields.length > 0 ? { normalized_fields: normalizedFields } : {})
    });
  });
}

export function buildModelsDeletePayload(args: ModelsDeleteArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("models delete", APP_ERROR_CODES.modelsDeleteError, () => {
    const { modelId } = args;
    return buildSuccessEnvelope("models delete", modelMutationRuntime.deleteModel(configPath, modelId));
  });
}

export function buildProvidersCreatePayload(args: ProvidersCreateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers create", APP_ERROR_CODES.providersCreateError, () => {
    const {
      providerId,
      requestedProvider
    } = args;
    const { provider, normalizedProvider } = providerMutationRuntime.createProvider(configPath, providerId, requestedProvider);
    const normalizedFields = collectNormalizedFields(
      requestedProvider,
      normalizedProvider,
      Object.keys(requestedProvider)
    );
    return buildSuccessEnvelope("providers create", buildProviderView(provider), {
      ...(normalizedFields.length > 0 ? { normalized_fields: normalizedFields } : {})
    });
  });
}

export function buildProvidersUpdatePayload(args: ProvidersUpdateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers update", APP_ERROR_CODES.providersUpdateError, () => {
    const { providerId, endpoint, allowPrivateEndpoints, allowInsecureHttp, apiMode, anthropicVersion, modelIdFormat, apiKeyEnv, noAuth } = args;
    const nextValue: Record<string, unknown> = {};
    if (typeof endpoint !== "undefined") nextValue["endpoint"] = endpoint;
    if (typeof allowPrivateEndpoints !== "undefined") nextValue["allow_private_endpoints"] = allowPrivateEndpoints;
    if (typeof allowInsecureHttp !== "undefined") nextValue["allow_insecure_http"] = allowInsecureHttp;
    if (typeof apiMode !== "undefined") nextValue["api_mode"] = apiMode;
    if (typeof anthropicVersion !== "undefined") nextValue["anthropic_version"] = anthropicVersion;
    if (typeof modelIdFormat !== "undefined") nextValue["model_id_format"] = modelIdFormat;
    if (typeof apiKeyEnv !== "undefined") nextValue["api_key_env"] = apiKeyEnv;
    if (noAuth) {
      nextValue["api_key"] = null;
      nextValue["api_key_env"] = null;
    }
    const touchedFields = [
      ...(typeof endpoint !== "undefined" ? ["endpoint"] : []),
      ...(typeof allowPrivateEndpoints !== "undefined" ? ["allow_private_endpoints"] : []),
      ...(typeof allowInsecureHttp !== "undefined" ? ["allow_insecure_http"] : []),
      ...(typeof apiMode !== "undefined" ? ["api_mode"] : []),
      ...(typeof anthropicVersion !== "undefined" ? ["anthropic_version"] : []),
      ...(typeof modelIdFormat !== "undefined" ? ["model_id_format"] : []),
      ...(typeof apiKeyEnv !== "undefined" ? ["api_key_env"] : []),
      ...(noAuth ? ["api_key", "api_key_env"] : [])
    ];
    const { provider, normalizedProvider } = providerMutationRuntime.updateProvider(configPath, providerId, nextValue);
    const normalizedFields = collectNormalizedFields(nextValue, normalizedProvider, Array.from(new Set(touchedFields)));
    return buildSuccessEnvelope("providers update", buildProviderView(provider), {
      ...(normalizedFields.length > 0 ? { normalized_fields: normalizedFields } : {})
    });
  });
}

export function buildProvidersDeletePayload(args: ProvidersDeleteArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers delete", APP_ERROR_CODES.providersDeleteError, () => {
    const { providerId } = args;
    return buildSuccessEnvelope("providers delete", providerMutationRuntime.deleteProvider(configPath, providerId));
  });
}

export function buildProvidersSetKeyPayload(args: ProvidersSetKeyArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers set-key", APP_ERROR_CODES.providersSetKeyError, () => {
    const { providerId, apiKey } = args;
    const { provider } = providerAuthMutationRuntime.setProviderInlineApiKey(configPath, providerId, apiKey);
    return buildSuccessEnvelope("providers set-key", buildProviderView(provider));
  });
}

export function buildProvidersClearKeyPayload(args: ProvidersClearKeyArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers clear-key", APP_ERROR_CODES.providersClearKeyError, () => {
    const { providerId } = args;
    const { provider } = providerAuthMutationRuntime.clearProviderInlineApiKey(configPath, providerId);
    return buildSuccessEnvelope("providers clear-key", buildProviderView(provider));
  });
}

export function buildProvidersSetKeyEnvPayload(args: ProvidersSetKeyEnvArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("providers set-key-env", APP_ERROR_CODES.providersSetKeyEnvError, () => {
    const { providerId, apiKeyEnv } = args;
    const { provider } = providerAuthMutationRuntime.setProviderApiKeyEnv(configPath, providerId, apiKeyEnv);
    return buildSuccessEnvelope("providers set-key-env", buildProviderView(provider));
  });
}

export function buildRoutesCreatePayload(args: RoutesCreateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("routes create", APP_ERROR_CODES.routesCreateError, () => {
    const { routeId, model, serviceProvider, providerModelId, displayName, timeoutMs, cost } = args;
    const { route } = routeMutationRuntime.createRoute(configPath, routeId, {
      model,
      service_provider: serviceProvider,
      provider_model_id: providerModelId,
      display_name: displayName,
      ...(typeof timeoutMs === "number" ? { timeout_ms: timeoutMs } : {}),
      ...(typeof cost === "undefined" ? {} : { cost: pickCostFields(cost) })
    });
    return buildSuccessEnvelope("routes create", buildRouteView(route));
  });
}

export function buildRoutesUpdatePayload(args: RoutesUpdateArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("routes update", APP_ERROR_CODES.routesUpdateError, () => {
    const { routeId, model, serviceProvider, providerModelId, displayName, timeoutMs, cost } = args;
    const { route } = routeMutationRuntime.updateRoute(configPath, routeId, {
      ...(typeof model !== "undefined" ? { model } : {}),
      ...(typeof serviceProvider !== "undefined" ? { service_provider: serviceProvider } : {}),
      ...(typeof providerModelId !== "undefined" ? { provider_model_id: providerModelId } : {}),
      ...(typeof displayName !== "undefined" ? { display_name: displayName } : {}),
      ...(typeof timeoutMs !== "undefined" ? { timeout_ms: timeoutMs } : {}),
      ...(typeof cost !== "undefined"
        ? {
            cost: cost === null
              ? null
              : pickCostFields(cost)
          }
        : {})
    });
    return buildSuccessEnvelope("routes update", buildRouteView(route));
  });
}

export function buildRoutesDeletePayload(args: RoutesDeleteArgs, configPath?: string): McpSuccessEnvelope | McpErrorEnvelope {
  return buildHandledResult("routes delete", APP_ERROR_CODES.routesDeleteError, () => {
    const { routeId } = args;
    return buildSuccessEnvelope("routes delete", routeMutationRuntime.deleteRoute(configPath, routeId));
  });
}

export function buildModelsShowPayload(
  args: ModelsShowArgs,
  readModel: ReturnType<typeof loadCliReadModel>
): McpSuccessEnvelope | McpErrorEnvelope {
  const { modelId } = args;
  const model = readModel.modelsByName[modelId];

  if (!model) {
    return buildMcpErrorEnvelope("models show", MCP_ENTITY_STATE_ERROR_CODES.modelNotFound, `Model '${modelId}' was not found`);
  }

  return buildSuccessEnvelope("models show", model, {
    editability: buildModelFieldMetadata()
  });
}

export function buildProvidersShowPayload(
  args: ProvidersShowArgs,
  readModel: ReturnType<typeof loadCliReadModel>
): McpSuccessEnvelope | McpErrorEnvelope {
  const { providerId } = args;
  const provider = readModel.providersByName[providerId];

  if (!provider) {
    return buildMcpErrorEnvelope("providers show", MCP_ENTITY_STATE_ERROR_CODES.providerNotFound, `Provider '${providerId}' was not found`);
  }

  return buildSuccessEnvelope("providers show", buildProviderView(provider), {
    editability: buildProviderFieldMetadata()
  });
}

export function buildRoutesShowPayload(
  args: RoutesShowArgs,
  readModel: ReturnType<typeof loadCliReadModel>
): McpSuccessEnvelope | McpErrorEnvelope {
  const { routeId } = args;
  const route = readModel.routesByName[routeId];

  if (!route) {
    return buildMcpErrorEnvelope("routes show", MCP_ENTITY_STATE_ERROR_CODES.routeNotFound, `Route '${routeId}' was not found`);
  }

  return buildSuccessEnvelope("routes show", buildRouteView(route), {
    editability: buildRouteFieldMetadata()
  });
}
