import type { ApiMode, ModelIdFormat } from "../../platform/types";
import { PROVIDER_INPUT_SHAPES } from "../config/entity-input-shapes";
import { invalidInputFieldError } from "./errors";
import {
  getNullableStringField,
  getOptionalBooleanField,
  getProviderApiKeyEnv,
  getRequiredToolString,
  normalizeToolModelIdFormat,
  parseToolArgs,
  providerAuthInputContract,
  providerInputContract
} from "./parsers-shared";

export type ProvidersShowArgs = {
  providerId: string;
};

export type ProvidersCreateArgs = {
  providerId: string;
  endpoint: string;
  allowPrivateEndpoints?: boolean;
  allowInsecureHttp?: boolean;
  apiMode: ApiMode;
  anthropicVersion?: string | null;
  modelIdFormat?: ModelIdFormat;
  requestedProvider: Record<string, unknown>;
};

export type ProvidersUpdateArgs = {
  providerId: string;
  endpoint?: string;
  allowPrivateEndpoints?: boolean;
  allowInsecureHttp?: boolean;
  apiMode?: ApiMode;
  anthropicVersion?: string | null;
  modelIdFormat?: ModelIdFormat;
  apiKeyEnv: string | null | undefined;
  noAuth: boolean;
};

export type ProvidersDeleteArgs = {
  providerId: string;
};

export type ProvidersSetKeyArgs = {
  providerId: string;
  apiKey: string;
};

export type ProvidersClearKeyArgs = {
  providerId: string;
};

export type ProvidersSetKeyEnvArgs = {
  providerId: string;
  apiKeyEnv: string;
};

export function parseProvidersShowArgs(params: unknown): ProvidersShowArgs {
  return parseToolArgs(params, {
    toolName: "providers_show",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.show,
    validate: (objectParams) => ({ providerId: getRequiredToolString(objectParams, "provider_id", "providers_show") })
  });
}

export function parseProvidersCreateArgs(params: unknown): ProvidersCreateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "providers_create",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.create,
    validate: (validatedParams) => validatedParams
  });
  const allowPrivateEndpoints = getOptionalBooleanField(objectParams, "allow_private_endpoints");
  const allowInsecureHttp = getOptionalBooleanField(objectParams, "allow_insecure_http");
  const anthropicVersion = getNullableStringField(objectParams, "anthropic_version");
  const modelIdFormat = typeof objectParams["model_id_format"] === "undefined" ? undefined : normalizeToolModelIdFormat(objectParams["model_id_format"], "model_id_format");
  if (Object.hasOwn(objectParams, "no_auth")) {
    const explicitNoAuth = objectParams["no_auth"];
    if (explicitNoAuth !== true) {
      throw invalidInputFieldError(
        "field 'no_auth' for 'providers_create' must be true when provided (providers_create always creates a no-auth provider; use providers_set_key or providers_set_key_env afterward for provider auth)"
      );
    }
  }
  const normalized = providerInputContract.validateProviderCreateInput({
    name: objectParams["provider_id"],
    endpoint: objectParams["endpoint"],
    allowPrivateEndpoints,
    allowInsecureHttp,
    apiMode: objectParams["api_mode"],
    apiKey: undefined,
    apiKeyEnv: undefined,
    noAuth: true,
    anthropicVersion,
    modelIdFormat,
    missingNameMessage: "Tool 'providers_create' requires non-empty 'provider_id'.",
    invalidNameMessage: "Tool 'providers_create' requires non-empty 'provider_id'.",
    missingEndpointMessage: "Tool 'providers_create' requires non-empty 'endpoint'.",
    invalidEndpointMessage: "Tool 'providers_create' requires non-empty 'endpoint'.",
    identifierLabel: "field 'provider_id'",
    apiModeFieldLabel: "api_mode",
    invalidApiModeMessage: "field '%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'",
    invalidAllowPrivateEndpointsMessage: "field 'allow_private_endpoints' must be a boolean",
    invalidAllowInsecureHttpMessage: "field 'allow_insecure_http' must be a boolean",
    invalidApiKeyMessage: "field 'api_key' must be a non-empty string or null",
    invalidApiKeyEnvMessage: "field 'api_key_env' must be a non-empty string or null",
    invalidAnthropicVersionMessage: "field 'anthropic_version' must be a non-empty string or null",
    invalidModelIdFormatMessage: "field 'model_id_format' must be one of: passthrough, creator/model",
    conflictingAuthMessage: "field 'no_auth' cannot be combined with 'api_key' or 'api_key_env'",
    missingAuthMessage: "MCP providers_create creates a no-auth provider; use providers_set_key or providers_set_key_env afterward for provider auth"
  });

  const requestedProvider: Record<string, unknown> = {
    endpoint: normalized.endpoint,
    ...(typeof normalized.allow_private_endpoints === "undefined" ? {} : { allow_private_endpoints: normalized.allow_private_endpoints }),
    ...(typeof normalized.allow_insecure_http === "undefined" ? {} : { allow_insecure_http: normalized.allow_insecure_http }),
    api_mode: normalized.api_mode,
    ...(typeof normalized.anthropic_version === "undefined" ? {} : { anthropic_version: normalized.anthropic_version }),
    ...(typeof normalized.model_id_format === "undefined" ? {} : { model_id_format: normalized.model_id_format }),
    api_key_env: null
  };

  return {
    providerId: normalized.name,
    endpoint: normalized.endpoint,
    allowPrivateEndpoints: normalized.allow_private_endpoints,
    allowInsecureHttp: normalized.allow_insecure_http,
    apiMode: normalized.api_mode,
    anthropicVersion: normalized.anthropic_version,
    modelIdFormat: normalized.model_id_format,
    requestedProvider
  };
}

export function parseProvidersUpdateArgs(params: unknown): ProvidersUpdateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "providers_update",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.update,
    validate: (validatedParams) => validatedParams
  });
  const allowPrivateEndpoints = getOptionalBooleanField(objectParams, "allow_private_endpoints");
  const allowInsecureHttp = getOptionalBooleanField(objectParams, "allow_insecure_http");
  const anthropicVersion = getNullableStringField(objectParams, "anthropic_version");
  const modelIdFormat = typeof objectParams["model_id_format"] === "undefined" ? undefined : normalizeToolModelIdFormat(objectParams["model_id_format"], "model_id_format");
  const apiKeyEnv = getProviderApiKeyEnv(objectParams);
  const noAuth = objectParams["no_auth"] === true;
  const normalized = providerInputContract.validateProviderUpdateInput({
    name: objectParams["provider_id"],
    endpoint: objectParams["endpoint"],
    allowPrivateEndpoints,
    allowInsecureHttp,
    apiMode: objectParams["api_mode"],
    apiKeyEnv,
    noAuth,
    anthropicVersion,
    modelIdFormat,
    missingNameMessage: "Tool 'providers_update' requires non-empty 'provider_id'.",
    identifierLabel: "field 'provider_id'",
    invalidEndpointMessage: "field 'endpoint' must be a non-empty string",
    invalidAllowPrivateEndpointsMessage: "field 'allow_private_endpoints' must be a boolean",
    invalidAllowInsecureHttpMessage: "field 'allow_insecure_http' must be a boolean",
    apiModeFieldLabel: "api_mode",
    invalidApiModeMessage: "field '%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'",
    invalidApiKeyEnvMessage: "field 'api_key_env' must be a non-empty string or null",
    invalidAnthropicVersionMessage: "field 'anthropic_version' must be a non-empty string or null",
    invalidModelIdFormatMessage: "field 'model_id_format' must be one of: passthrough, creator/model",
    conflictingAuthMessage: "field 'no_auth' cannot be combined with 'api_key_env'",
    missingUpdateFieldsMessage:
      "Provide at least one update field for 'providers update': 'endpoint', 'allow_private_endpoints', 'allow_insecure_http', 'api_mode', 'anthropic_version', 'model_id_format', 'api_key_env', or 'no_auth'"
  });

  return {
    providerId: normalized.name,
    endpoint: normalized.endpoint,
    allowPrivateEndpoints: normalized.allow_private_endpoints,
    allowInsecureHttp: normalized.allow_insecure_http,
    apiMode: normalized.api_mode,
    anthropicVersion: normalized.anthropic_version,
    modelIdFormat: normalized.model_id_format,
    apiKeyEnv: normalized.api_key_env,
    noAuth: normalized.api_key_env === null
  };
}

export function parseProvidersDeleteArgs(params: unknown): ProvidersDeleteArgs {
  return parseToolArgs(params, {
    toolName: "providers_delete",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.delete,
    validate: (objectParams) => ({ providerId: getRequiredToolString(objectParams, "provider_id", "providers_delete") })
  });
}

export function parseProvidersSetKeyArgs(params: unknown): ProvidersSetKeyArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "providers_set_key",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.setKey,
    validate: (validatedParams) => validatedParams
  });
  const normalized = providerAuthInputContract.validateProviderSetKeyInput({
    providerId: objectParams["provider_id"],
    apiKey: objectParams["api_key"],
    missingProviderIdMessage: "Tool 'providers_set_key' requires non-empty 'provider_id'.",
    invalidProviderIdMessage: "Tool 'providers_set_key' requires non-empty 'provider_id'.",
    missingApiKeyMessage: "Tool 'providers_set_key' requires non-empty 'api_key'.",
    invalidApiKeyMessage: "Tool 'providers_set_key' requires non-empty 'api_key'.",
    identifierLabel: "field 'provider_id'",
    apiKeyFieldLabel: "api_key"
  });
  return { providerId: normalized.provider_id, apiKey: normalized.api_key };
}

export function parseProvidersClearKeyArgs(params: unknown): ProvidersClearKeyArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "providers_clear_key",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.clearKey,
    validate: (validatedParams) => validatedParams
  });
  const normalized = providerAuthInputContract.validateProviderClearKeyInput({
    providerId: objectParams["provider_id"],
    missingProviderIdMessage: "Tool 'providers_clear_key' requires non-empty 'provider_id'.",
    invalidProviderIdMessage: "Tool 'providers_clear_key' requires non-empty 'provider_id'.",
    identifierLabel: "field 'provider_id'"
  });
  return { providerId: normalized.provider_id };
}

export function parseProvidersSetKeyEnvArgs(params: unknown): ProvidersSetKeyEnvArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "providers_set_key_env",
    allowedFields: PROVIDER_INPUT_SHAPES.mcp.setKeyEnv,
    validate: (validatedParams) => validatedParams
  });
  const normalized = providerAuthInputContract.validateProviderSetKeyEnvInput({
    providerId: objectParams["provider_id"],
    apiKeyEnv: objectParams["api_key_env"],
    missingProviderIdMessage: "Tool 'providers_set_key_env' requires non-empty 'provider_id'.",
    invalidProviderIdMessage: "Tool 'providers_set_key_env' requires non-empty 'provider_id'.",
    missingApiKeyEnvMessage: "Tool 'providers_set_key_env' requires non-empty 'api_key_env'.",
    invalidApiKeyEnvMessage: "Tool 'providers_set_key_env' requires non-empty 'api_key_env'.",
    identifierLabel: "field 'provider_id'"
  });
  return { providerId: normalized.provider_id, apiKeyEnv: normalized.api_key_env };
}
