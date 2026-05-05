import { assertNoStructuredInputMix, loadStructuredInputPayload, resolveStructuredInputMode, withStructuredInputMode } from "./structured-input-detect";
import { createProviderInputContract } from "../config/provider-input-contract";
import { PROVIDER_INPUT_SHAPES, rejectUnknownStructuredInputFields } from "../config/entity-input-shapes";
import type { CliTextReadOptions } from "./input-utils";
import type { ApiMode, ModelIdFormat } from "../../platform/types";

export function createCliProviderInputNormalization(deps: {
  readCliStdinSync: (options?: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string }) => string;
  readTextFileWithinCliLimit: (sourcePath: string, options?: CliTextReadOptions) => string;
  readJsonObjectFromString: (
    rawText: string,
    sourceName: string,
    options?: { maxSerializedBytes?: number }
  ) => Record<string, unknown>;
  isNonEmptyCliString: (value: unknown) => value is string;
  assertSafeCliConfigIdentifier: (value: string, label: string) => void;
  normalizeCliApiMode: (value: unknown) => ApiMode | null;
  normalizeModelIdFormat: (value: unknown) => ModelIdFormat | null;
  throwCliInvalidInputField: (message: string) => never;
  createCliUsageError: (code: string, message: string) => Error;
  assertAtLeastOneUpdateField: (options: {
    commandName: string;
    source: "stdin payload" | "json input" | "cli";
    fieldNames: string[];
    hasAnyField: boolean;
  }) => void;
  mcpUsageErrorCodes: {
    missingRequiredField: string;
    conflictingInputModes: string;
    invalidInputField: string;
    invalidFlagValue: string;
    conflictingStructuredInput: string;
    missingUpdateFields: string;
  };
}) {
  const providerInputContract = createProviderInputContract({
    isNonEmptyString: deps.isNonEmptyCliString,
    assertSafeIdentifier: deps.assertSafeCliConfigIdentifier,
    normalizeApiMode: deps.normalizeCliApiMode,
    normalizeModelIdFormat: deps.normalizeModelIdFormat,
    missingRequiredField: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.missingRequiredField, message);
    },
    invalidInputField: deps.throwCliInvalidInputField,
    invalidFlagValue: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.invalidFlagValue, message);
    },
    conflictingInputModes: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.conflictingInputModes, message);
    },
    missingUpdateFields: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.missingUpdateFields, message);
    }
  });

  function normalizeProviderAuthFields(payload: Record<string, unknown>, sourceName: string): {
    api_key?: string | null;
    api_key_env?: string | null;
    anthropic_version?: string | null;
    model_id_format?: ModelIdFormat;
  } {
    const normalized: {
      api_key?: string | null;
      api_key_env?: string | null;
      anthropic_version?: string | null;
      model_id_format?: ModelIdFormat;
    } = {};

    if (typeof payload["api_key"] !== "undefined") {
      if (payload["api_key"] !== null && !deps.isNonEmptyCliString(payload["api_key"])) {
        deps.throwCliInvalidInputField(`${sourceName} field 'api_key' must be a non-empty string or null`);
      }

      normalized.api_key = (payload["api_key"] as string | null) ?? null;
    }

    if (typeof payload["api_key_env"] !== "undefined") {
      if (payload["api_key_env"] !== null && !deps.isNonEmptyCliString(payload["api_key_env"])) {
        deps.throwCliInvalidInputField(`${sourceName} field 'api_key_env' must be a non-empty string or null`);
      }

      normalized.api_key_env = (payload["api_key_env"] as string | null) ?? null;
    }

    if (typeof payload["anthropic_version"] !== "undefined") {
      if (payload["anthropic_version"] !== null && !deps.isNonEmptyCliString(payload["anthropic_version"])) {
        deps.throwCliInvalidInputField(`${sourceName} field 'anthropic_version' must be a non-empty string or null`);
      }

      normalized.anthropic_version = (payload["anthropic_version"] as string | null) ?? null;
    }

    if (typeof payload["model_id_format"] !== "undefined") {
      const modelIdFormat = deps.normalizeModelIdFormat(payload["model_id_format"]);

      if (modelIdFormat === null) {
        deps.throwCliInvalidInputField(`${sourceName} field 'model_id_format' must be one of: passthrough, creator/model`);
      }

      normalized.model_id_format = modelIdFormat;
    }

    return normalized;
  }

  function rejectUnknownProviderUpdateStructuredInputFields(
    payload: Record<string, unknown>,
    sourceLabel: "stdin payload" | "json input"
  ): void {
    const allowedUpdateFields = new Set<string>(PROVIDER_INPUT_SHAPES.cliStructured.update);

    for (const field of Object.keys(payload)) {
      if (field === "api_key") {
        deps.throwCliInvalidInputField(
          `${sourceLabel} field 'api_key' is not supported by 'providers update'; use 'providers set-key' or 'providers clear-key'`
        );
      }

      if (!allowedUpdateFields.has(field)) {
        deps.throwCliInvalidInputField(`${sourceLabel} does not support field '${field}'`);
      }
    }
  }

  function normalizeProviderCreateInput(args: {
    stdin: boolean;
    jsonInputPath?: string;
    apiKeyStdin: boolean;
    noAuth: boolean;
    allowPrivateEndpoints: boolean;
    allowInsecureHttp: boolean;
    name?: string;
    endpoint?: string;
    apiMode?: string;
    apiKeyEnv?: string;
    anthropicVersion?: string;
    modelIdFormat?: string;
  }): {
    name: string;
    endpoint: string;
    allow_private_endpoints?: boolean;
    allow_insecure_http?: boolean;
    api_mode: ApiMode;
    api_key?: string | null;
    api_key_env?: string | null;
    anthropic_version?: string | null;
    model_id_format?: ModelIdFormat;
  } {
    const commandName = "providers create";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      Boolean(args.apiKeyStdin || args.noAuth || args.endpoint || args.apiMode || args.apiKeyEnv || args.anthropicVersion || args.modelIdFormat || args.name),
      "with positional or flag-sugar provider fields",
      deps
    );

    return withStructuredInputMode(commandName, args, deps, {
      stdin: () => {
        const structuredInput = loadStructuredInputPayload("stdin", args, deps) as {
          payload: Record<string, unknown>;
          sourceLabel: "stdin payload";
        };
        const { payload, sourceLabel } = structuredInput;
        rejectUnknownStructuredInputFields(
          payload,
          PROVIDER_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        const authFields = normalizeProviderAuthFields(payload, sourceLabel);

        return providerInputContract.validateProviderCreateInput({
          name: payload["name"],
          endpoint: payload["endpoint"],
          allowPrivateEndpoints: payload["allow_private_endpoints"],
          allowInsecureHttp: payload["allow_insecure_http"],
          apiMode: payload["api_mode"],
          apiKey: authFields.api_key,
          apiKeyEnv: authFields.api_key_env,
          noAuth: authFields.api_key === null || authFields.api_key_env === null,
          anthropicVersion: authFields.anthropic_version,
          modelIdFormat: authFields.model_id_format,
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingEndpointMessage: `${sourceLabel} must include a non-empty 'endpoint'`,
          invalidEndpointMessage: `${sourceLabel} must include a non-empty 'endpoint'`,
          identifierLabel: "Provider name",
          apiModeFieldLabel: "api_mode",
          invalidApiModeMessage: `${sourceLabel} must include a valid '%FIELD%' such as 'openai-completions' or 'anthropic-messages'`,
          invalidAllowPrivateEndpointsMessage: `${sourceLabel} field 'allow_private_endpoints' must be a boolean`,
          invalidAllowInsecureHttpMessage: `${sourceLabel} field 'allow_insecure_http' must be a boolean`,
          invalidApiKeyMessage: `${sourceLabel} field 'api_key' must be a non-empty string or null`,
          invalidApiKeyEnvMessage: `${sourceLabel} field 'api_key_env' must be a non-empty string or null`,
          invalidAnthropicVersionMessage: `${sourceLabel} field 'anthropic_version' must be a non-empty string or null`,
          invalidModelIdFormatMessage: `${sourceLabel} field 'model_id_format' must be one of: passthrough, creator/model`,
          conflictingAuthMessage: `${sourceLabel} field 'no_auth' cannot be combined with 'api_key' or 'api_key_env'`,
          missingAuthMessage: `${sourceLabel} must define 'api_key', 'api_key_env', or null for a no-auth provider`
        });
      },
      jsonInput: () => {
        const structuredInput = loadStructuredInputPayload("json-input", args, deps) as {
          payload: Record<string, unknown>;
          sourceLabel: "json input";
        };
        const { payload, sourceLabel } = structuredInput;
        rejectUnknownStructuredInputFields(
          payload,
          PROVIDER_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        const authFields = normalizeProviderAuthFields(payload, sourceLabel);

        return providerInputContract.validateProviderCreateInput({
          name: payload["name"],
          endpoint: payload["endpoint"],
          allowPrivateEndpoints: payload["allow_private_endpoints"],
          allowInsecureHttp: payload["allow_insecure_http"],
          apiMode: payload["api_mode"],
          apiKey: authFields.api_key,
          apiKeyEnv: authFields.api_key_env,
          noAuth: authFields.api_key === null || authFields.api_key_env === null,
          anthropicVersion: authFields.anthropic_version,
          modelIdFormat: authFields.model_id_format,
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingEndpointMessage: `${sourceLabel} must include a non-empty 'endpoint'`,
          invalidEndpointMessage: `${sourceLabel} must include a non-empty 'endpoint'`,
          identifierLabel: "Provider name",
          apiModeFieldLabel: "api_mode",
          invalidApiModeMessage: `${sourceLabel} must include a valid '%FIELD%' such as 'openai-completions' or 'anthropic-messages'`,
          invalidAllowPrivateEndpointsMessage: `${sourceLabel} field 'allow_private_endpoints' must be a boolean`,
          invalidAllowInsecureHttpMessage: `${sourceLabel} field 'allow_insecure_http' must be a boolean`,
          invalidApiKeyMessage: `${sourceLabel} field 'api_key' must be a non-empty string or null`,
          invalidApiKeyEnvMessage: `${sourceLabel} field 'api_key_env' must be a non-empty string or null`,
          invalidAnthropicVersionMessage: `${sourceLabel} field 'anthropic_version' must be a non-empty string or null`,
          invalidModelIdFormatMessage: `${sourceLabel} field 'model_id_format' must be one of: passthrough, creator/model`,
          conflictingAuthMessage: `${sourceLabel} field 'no_auth' cannot be combined with 'api_key' or 'api_key_env'`,
          missingAuthMessage: `${sourceLabel} must define 'api_key', 'api_key_env', or null for a no-auth provider`
        });
      },
      cli: () => {
        const apiKey =
          args.apiKeyStdin
            ? (() => {
                const value = deps.readCliStdinSync({ trimTrailingNewlines: true });
                if (!deps.isNonEmptyCliString(value)) {
                  throw deps.createCliUsageError(
                    deps.mcpUsageErrorCodes.missingRequiredField,
                    "No api key was provided on stdin"
                  );
                }
                return value;
              })()
            : undefined;

        return providerInputContract.validateProviderCreateInput({
          name: args.name,
          endpoint: args.endpoint,
          allowPrivateEndpoints: args.allowPrivateEndpoints ? true : undefined,
          allowInsecureHttp: args.allowInsecureHttp ? true : undefined,
          apiMode: args.apiMode,
          apiKey,
          apiKeyEnv: deps.isNonEmptyCliString(args.apiKeyEnv) ? args.apiKeyEnv : undefined,
          noAuth: args.noAuth,
          anthropicVersion: args.anthropicVersion,
          modelIdFormat: args.modelIdFormat,
          missingNameMessage: "Missing required argument '<name>' for 'providers create'",
          invalidNameMessage: "Missing required argument '<name>' for 'providers create'",
          missingEndpointMessage: "Flag '--endpoint' is required when not using '--stdin' or '--json-input'",
          invalidEndpointMessage: "Flag '--endpoint' is required when not using '--stdin' or '--json-input'",
          identifierLabel: "Provider name",
          apiModeFieldLabel: "api-mode",
          invalidApiModeMessage: "Flag '--%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'",
          invalidAllowPrivateEndpointsMessage: "Flag '--allow-private-endpoints' must be a boolean",
          invalidAllowInsecureHttpMessage: "Flag '--allow-insecure-http' must be a boolean",
          invalidApiKeyMessage: "field 'api_key' must be a non-empty string or null",
          invalidApiKeyEnvMessage: "Flag '--api-key-env' must be a non-empty string",
          invalidAnthropicVersionMessage: "Flag '--anthropic-version' must be a non-empty string",
          invalidModelIdFormatMessage: "Flag '--model-id-format' must be one of: passthrough, creator/model",
          conflictingAuthMessage: "Flag '--no-auth' cannot be combined with '--api-key-stdin' or '--api-key-env'",
          missingAuthMessage: "Provide provider auth for 'providers create' using '--api-key-env', '--api-key-stdin', '--no-auth', '--stdin', or '--json-input'"
        });
      }
    });
  }

  function normalizeProviderUpdateInput(args: {
    stdin: boolean;
    jsonInputPath?: string;
    apiKeyStdin: boolean;
    noAuth: boolean;
    allowPrivateEndpoints: boolean;
    allowInsecureHttp: boolean;
    name?: string;
    endpoint?: string;
    apiMode?: string;
    apiKeyEnv?: string;
    anthropicVersion?: string;
    modelIdFormat?: string;
  }): {
    name: string;
    endpoint?: string;
    allow_private_endpoints?: boolean;
    allow_insecure_http?: boolean;
    api_mode?: ApiMode;
    api_key_env?: string | null;
    anthropic_version?: string | null;
    model_id_format?: ModelIdFormat;
  } {
    const commandName = "providers update";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);

    if (!deps.isNonEmptyCliString(args.name)) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.missingRequiredField,
        "Missing required argument '<name>' for 'providers update'"
      );
    }

    deps.assertSafeCliConfigIdentifier(args.name, "Provider name");

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      Boolean(args.noAuth || args.endpoint || args.apiMode || args.apiKeyEnv || args.anthropicVersion || args.modelIdFormat),
      "with flag-sugar provider fields",
      deps
    );

    if (args.apiKeyStdin) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.invalidInputField,
        "Flag '--api-key-stdin' is not supported by 'providers update'; use 'providers set-key' or 'providers clear-key'"
      );
    }

    return withStructuredInputMode(commandName, args, deps, {
      stdin: () => {
        const structuredInput = loadStructuredInputPayload("stdin", args, deps) as {
          payload: Record<string, unknown>;
          sourceLabel: "stdin payload";
        };
        const { payload, sourceLabel } = structuredInput;
        rejectUnknownProviderUpdateStructuredInputFields(payload, sourceLabel);

        if (typeof payload["endpoint"] !== "undefined" && !deps.isNonEmptyCliString(payload["endpoint"])) {
          deps.throwCliInvalidInputField(`${sourceLabel} field 'endpoint' must be a non-empty string`);
        }

        const authFields = normalizeProviderAuthFields(payload, sourceLabel);

        return providerInputContract.validateProviderUpdateInput({
          name: args.name,
          endpoint: payload["endpoint"],
          allowPrivateEndpoints: payload["allow_private_endpoints"],
          allowInsecureHttp: payload["allow_insecure_http"],
          apiMode: payload["api_mode"],
          apiKeyEnv: authFields.api_key_env,
          noAuth: authFields.api_key_env === null,
          anthropicVersion: authFields.anthropic_version,
          modelIdFormat: authFields.model_id_format,
          missingNameMessage: "Missing required argument '<name>' for 'providers update'",
          identifierLabel: "Provider name",
          invalidEndpointMessage: `${sourceLabel} field 'endpoint' must be a non-empty string`,
          invalidAllowPrivateEndpointsMessage: `${sourceLabel} field 'allow_private_endpoints' must be a boolean`,
          invalidAllowInsecureHttpMessage: `${sourceLabel} field 'allow_insecure_http' must be a boolean`,
          apiModeFieldLabel: "api_mode",
          invalidApiModeMessage: `${sourceLabel} field '%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'`,
          invalidApiKeyEnvMessage: `${sourceLabel} field 'api_key_env' must be a non-empty string or null`,
          invalidAnthropicVersionMessage: `${sourceLabel} field 'anthropic_version' must be a non-empty string or null`,
          invalidModelIdFormatMessage: `${sourceLabel} field 'model_id_format' must be one of: passthrough, creator/model`,
          conflictingAuthMessage: "Flag '--no-auth' cannot be combined with '--api-key-env'",
          missingUpdateFieldsMessage:
            "Provide at least one update field for 'providers update': 'endpoint', 'allow_private_endpoints', 'allow_insecure_http', 'api_mode', 'api_key_env', 'anthropic_version', 'model_id_format', or 'no_auth'"
        });
      },
      jsonInput: () => {
        const structuredInput = loadStructuredInputPayload("json-input", args, deps) as {
          payload: Record<string, unknown>;
          sourceLabel: "json input";
        };
        const { payload, sourceLabel } = structuredInput;
        rejectUnknownProviderUpdateStructuredInputFields(payload, sourceLabel);

        if (typeof payload["endpoint"] !== "undefined" && !deps.isNonEmptyCliString(payload["endpoint"])) {
          deps.throwCliInvalidInputField(`${sourceLabel} field 'endpoint' must be a non-empty string`);
        }

        const authFields = normalizeProviderAuthFields(payload, sourceLabel);

        return providerInputContract.validateProviderUpdateInput({
          name: args.name,
          endpoint: payload["endpoint"],
          allowPrivateEndpoints: payload["allow_private_endpoints"],
          allowInsecureHttp: payload["allow_insecure_http"],
          apiMode: payload["api_mode"],
          apiKeyEnv: authFields.api_key_env,
          noAuth: authFields.api_key_env === null,
          anthropicVersion: authFields.anthropic_version,
          modelIdFormat: authFields.model_id_format,
          missingNameMessage: "Missing required argument '<name>' for 'providers update'",
          identifierLabel: "Provider name",
          invalidEndpointMessage: `${sourceLabel} field 'endpoint' must be a non-empty string`,
          invalidAllowPrivateEndpointsMessage: `${sourceLabel} field 'allow_private_endpoints' must be a boolean`,
          invalidAllowInsecureHttpMessage: `${sourceLabel} field 'allow_insecure_http' must be a boolean`,
          apiModeFieldLabel: "api_mode",
          invalidApiModeMessage: `${sourceLabel} field '%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'`,
          invalidApiKeyEnvMessage: `${sourceLabel} field 'api_key_env' must be a non-empty string or null`,
          invalidAnthropicVersionMessage: `${sourceLabel} field 'anthropic_version' must be a non-empty string or null`,
          invalidModelIdFormatMessage: `${sourceLabel} field 'model_id_format' must be one of: passthrough, creator/model`,
          conflictingAuthMessage: "Flag '--no-auth' cannot be combined with '--api-key-env'",
          missingUpdateFieldsMessage:
            "Provide at least one update field for 'providers update': 'endpoint', 'allow_private_endpoints', 'allow_insecure_http', 'api_mode', 'api_key_env', 'anthropic_version', 'model_id_format', or 'no_auth'"
        });
      },
      cli: () =>
        providerInputContract.validateProviderUpdateInput({
          name: args.name,
          endpoint: deps.isNonEmptyCliString(args.endpoint) ? args.endpoint : undefined,
          allowPrivateEndpoints: args.allowPrivateEndpoints ? true : undefined,
          allowInsecureHttp: args.allowInsecureHttp ? true : undefined,
          apiMode: args.apiMode,
          apiKeyEnv: deps.isNonEmptyCliString(args.apiKeyEnv) ? args.apiKeyEnv : undefined,
          noAuth: args.noAuth,
          anthropicVersion: args.anthropicVersion,
          modelIdFormat: args.modelIdFormat,
          missingNameMessage: "Missing required argument '<name>' for 'providers update'",
          identifierLabel: "Provider name",
          invalidEndpointMessage: "Flag '--endpoint' must be a non-empty string",
          invalidAllowPrivateEndpointsMessage: "Flag '--allow-private-endpoints' must be a boolean",
          invalidAllowInsecureHttpMessage: "Flag '--allow-insecure-http' must be a boolean",
          apiModeFieldLabel: "api-mode",
          invalidApiModeMessage: "Flag '--%FIELD%' must be a valid API mode such as 'openai-completions' or 'anthropic-messages'",
          invalidApiKeyEnvMessage: "Flag '--api-key-env' must be a non-empty string",
          invalidAnthropicVersionMessage: "Flag '--anthropic-version' must be a non-empty string",
          invalidModelIdFormatMessage: "Flag '--model-id-format' must be one of: passthrough, creator/model",
          conflictingAuthMessage: "Flag '--no-auth' cannot be combined with '--api-key-env'",
          missingUpdateFieldsMessage:
            "Provide at least one update field for 'providers update': '--endpoint', '--allow-private-endpoints', '--allow-insecure-http', '--api-mode', '--api-key-env', '--anthropic-version', '--model-id-format', '--no-auth', '--stdin', '--json-input'"
        })
    });
  }

  return {
    normalizeProviderCreateInput,
    normalizeProviderUpdateInput
  };
}
