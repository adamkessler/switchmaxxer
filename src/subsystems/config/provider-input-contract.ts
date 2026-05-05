import type { ApiMode, ModelIdFormat } from "../../platform/types";

export type ProviderCreateInput = {
  name: string;
  endpoint: string;
  allow_private_endpoints?: boolean;
  allow_insecure_http?: boolean;
  api_mode: ApiMode;
  api_key?: string | null;
  api_key_env?: string | null;
  anthropic_version?: string | null;
  model_id_format?: ModelIdFormat;
};

export type ProviderUpdateInput = {
  name: string;
  endpoint?: string;
  allow_private_endpoints?: boolean;
  allow_insecure_http?: boolean;
  api_mode?: ApiMode;
  api_key_env?: string | null;
  anthropic_version?: string | null;
  model_id_format?: ModelIdFormat;
};

export function createProviderInputContract(deps: {
  isNonEmptyString: (value: unknown) => value is string;
  assertSafeIdentifier: (value: string, label: string) => void;
  normalizeApiMode: (value: unknown) => ApiMode | null;
  normalizeModelIdFormat: (value: unknown) => ModelIdFormat | null;
  missingRequiredField: (message: string) => never;
  invalidInputField: (message: string) => never;
  invalidFlagValue: (message: string) => never;
  conflictingInputModes: (message: string) => never;
  missingUpdateFields: (message: string) => never;
}) {
  function readOptionalString(value: unknown, invalidMessage: string): string | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readOptionalNullableString(value: unknown, invalidMessage: string): string | null | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readOptionalBoolean(value: unknown, invalidMessage: string): boolean | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (typeof value !== "boolean") {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readRequiredString(value: unknown, missingMessage: string, invalidMessage: string): string {
    if (typeof value === "undefined") {
      deps.missingRequiredField(missingMessage);
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readApiMode(value: unknown, fieldLabel: string, errorMessage: string): ApiMode {
    const normalized = deps.normalizeApiMode(value);
    if (normalized === null) {
      deps.invalidFlagValue(errorMessage.replace("%FIELD%", fieldLabel));
    }

    return normalized;
  }

  function readOptionalApiMode(value: unknown, fieldLabel: string, errorMessage: string): ApiMode | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    return readApiMode(value, fieldLabel, errorMessage);
  }

  function readOptionalModelIdFormat(value: unknown, errorMessage: string): ModelIdFormat | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    const normalized = deps.normalizeModelIdFormat(value);
    if (normalized === null) {
      deps.invalidFlagValue(errorMessage);
    }

    return normalized;
  }

  function validateProviderCreateInput(options: {
    name: unknown;
    endpoint: unknown;
    allowPrivateEndpoints: unknown;
    allowInsecureHttp: unknown;
    apiMode: unknown;
    apiKey: unknown;
    apiKeyEnv: unknown;
    noAuth: boolean;
    anthropicVersion: unknown;
    modelIdFormat: unknown;
    missingNameMessage: string;
    invalidNameMessage: string;
    missingEndpointMessage: string;
    invalidEndpointMessage: string;
    identifierLabel: string;
    apiModeFieldLabel: string;
    invalidApiModeMessage: string;
    invalidAllowPrivateEndpointsMessage: string;
    invalidAllowInsecureHttpMessage: string;
    invalidApiKeyMessage: string;
    invalidApiKeyEnvMessage: string;
    invalidAnthropicVersionMessage: string;
    invalidModelIdFormatMessage: string;
    conflictingAuthMessage: string;
    missingAuthMessage: string;
  }): ProviderCreateInput {
    const name = readRequiredString(options.name, options.missingNameMessage, options.invalidNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);
    const endpoint = readRequiredString(options.endpoint, options.missingEndpointMessage, options.invalidEndpointMessage);
    const apiMode = readApiMode(options.apiMode, options.apiModeFieldLabel, options.invalidApiModeMessage);
    const allowPrivateEndpoints = readOptionalBoolean(
      options.allowPrivateEndpoints,
      options.invalidAllowPrivateEndpointsMessage
    );
    const allowInsecureHttp = readOptionalBoolean(
      options.allowInsecureHttp,
      options.invalidAllowInsecureHttpMessage
    );
    const apiKey = readOptionalNullableString(options.apiKey, options.invalidApiKeyMessage);
    const apiKeyEnv = readOptionalNullableString(options.apiKeyEnv, options.invalidApiKeyEnvMessage);
    const anthropicVersion = readOptionalNullableString(options.anthropicVersion, options.invalidAnthropicVersionMessage);
    const modelIdFormat = readOptionalModelIdFormat(options.modelIdFormat, options.invalidModelIdFormatMessage);

    if (options.noAuth && (typeof apiKey !== "undefined" || typeof apiKeyEnv !== "undefined")) {
      deps.conflictingInputModes(options.conflictingAuthMessage);
    }

    const normalizedApiKeyEnv = options.noAuth ? null : apiKeyEnv;
    if (!options.noAuth && typeof apiKey === "undefined" && typeof normalizedApiKeyEnv === "undefined") {
      deps.missingRequiredField(options.missingAuthMessage);
    }

    return {
      name,
      endpoint: endpoint,
      ...(typeof allowPrivateEndpoints === "undefined" ? {} : { allow_private_endpoints: allowPrivateEndpoints }),
      ...(typeof allowInsecureHttp === "undefined" ? {} : { allow_insecure_http: allowInsecureHttp }),
      api_mode: apiMode,
      ...(typeof apiKey === "undefined" ? {} : { api_key: apiKey }),
      ...(typeof normalizedApiKeyEnv === "undefined" ? {} : { api_key_env: normalizedApiKeyEnv }),
      ...(typeof anthropicVersion === "undefined" ? {} : { anthropic_version: anthropicVersion }),
      ...(typeof modelIdFormat === "undefined" ? {} : { model_id_format: modelIdFormat })
    };
  }

  function validateProviderUpdateInput(options: {
    name: unknown;
    endpoint: unknown;
    allowPrivateEndpoints: unknown;
    allowInsecureHttp: unknown;
    apiMode: unknown;
    apiKeyEnv: unknown;
    noAuth: boolean;
    anthropicVersion: unknown;
    modelIdFormat: unknown;
    missingNameMessage: string;
    identifierLabel: string;
    invalidEndpointMessage: string;
    invalidAllowPrivateEndpointsMessage: string;
    invalidAllowInsecureHttpMessage: string;
    apiModeFieldLabel: string;
    invalidApiModeMessage: string;
    invalidApiKeyEnvMessage: string;
    invalidAnthropicVersionMessage: string;
    invalidModelIdFormatMessage: string;
    conflictingAuthMessage: string;
    missingUpdateFieldsMessage: string;
  }): ProviderUpdateInput {
    const name = readRequiredString(options.name, options.missingNameMessage, options.missingNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);
    const endpoint = readOptionalString(options.endpoint, options.invalidEndpointMessage);
    const allowPrivateEndpoints = readOptionalBoolean(
      options.allowPrivateEndpoints,
      options.invalidAllowPrivateEndpointsMessage
    );
    const allowInsecureHttp = readOptionalBoolean(
      options.allowInsecureHttp,
      options.invalidAllowInsecureHttpMessage
    );
    const apiMode = readOptionalApiMode(options.apiMode, options.apiModeFieldLabel, options.invalidApiModeMessage);
    const apiKeyEnv = readOptionalNullableString(options.apiKeyEnv, options.invalidApiKeyEnvMessage);
    const anthropicVersion = readOptionalNullableString(options.anthropicVersion, options.invalidAnthropicVersionMessage);
    const modelIdFormat = readOptionalModelIdFormat(options.modelIdFormat, options.invalidModelIdFormatMessage);

    if (options.noAuth && typeof apiKeyEnv !== "undefined") {
      deps.conflictingInputModes(options.conflictingAuthMessage);
    }

    const normalizedApiKeyEnv = options.noAuth ? null : apiKeyEnv;
    if (
      typeof endpoint === "undefined" &&
      typeof allowPrivateEndpoints === "undefined" &&
      typeof allowInsecureHttp === "undefined" &&
      typeof apiMode === "undefined" &&
      typeof normalizedApiKeyEnv === "undefined" &&
      typeof anthropicVersion === "undefined" &&
      typeof modelIdFormat === "undefined"
    ) {
      deps.missingUpdateFields(options.missingUpdateFieldsMessage);
    }

    return {
      name,
      ...(typeof endpoint === "undefined" ? {} : { endpoint: endpoint }),
      ...(typeof allowPrivateEndpoints === "undefined" ? {} : { allow_private_endpoints: allowPrivateEndpoints }),
      ...(typeof allowInsecureHttp === "undefined" ? {} : { allow_insecure_http: allowInsecureHttp }),
      ...(typeof apiMode === "undefined" ? {} : { api_mode: apiMode }),
      ...(typeof normalizedApiKeyEnv === "undefined" ? {} : { api_key_env: normalizedApiKeyEnv }),
      ...(typeof anthropicVersion === "undefined" ? {} : { anthropic_version: anthropicVersion }),
      ...(typeof modelIdFormat === "undefined" ? {} : { model_id_format: modelIdFormat })
    };
  }

  return {
    validateProviderCreateInput,
    validateProviderUpdateInput
  };
}
