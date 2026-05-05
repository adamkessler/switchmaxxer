import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { MASKED_SECRET_SENTINEL } from "../../platform/masked-secret";
import { invalidInputFieldError, missingRequiredFieldError, McpToolError } from "./errors";
import {
  buildAllowedObservabilityFilterMessage,
  isAllowedObservabilityFilterValue
} from "../observability/filter-value-validation";
import {
  CONFIG_VALIDATION_ERROR_CODES,
  ConfigValidationError,
  getNullableStringField as getNullableConfigStringField,
  validateCostConfig
} from "../config/config-validation";
import { assertSafeObjectKey } from "../../platform/object-key-policy";
import { createProviderInputContract } from "../config/provider-input-contract";
import { createProviderAuthInputContract } from "../config/provider-auth-input-contract";
import { createRouteInputContract } from "../config/route-input-contract";
import { isNonEmptyString, isRecord } from "../../platform/type-guards";
import { createModelInputContract } from "../config/model-input-contract";
import {
  OBSERVATION_EVENTS,
  OBSERVATION_KINDS,
  OBSERVATION_OUTCOMES,
  type ObservationEvent,
  type ObservationKind,
  type ObservationOutcome
} from "../observability/types";
import { normalizeApiMode, normalizeModelIdFormat, type CostConfig, type ModelIdFormat } from "../../platform/types";

export function getOptionalString(params: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = params?.[field];
  return typeof value === "undefined" ? undefined : typeof value === "string" ? value : undefined;
}

function expectToolParamsObject(params: unknown): Record<string, unknown> {
  if (typeof params === "undefined") {
    return {};
  }
  if (!isRecord(params)) {
    throw invalidInputFieldError("tool arguments must be a JSON object");
  }
  return params;
}

function rejectUnknownToolFields(
  params: Record<string, unknown>,
  allowedFields: readonly string[],
  toolName: string
): void {
  for (const field of Object.keys(params)) {
    if (!allowedFields.includes(field)) {
      throw invalidInputFieldError(`Tool '${toolName}' does not support field '${field}'.`);
    }
  }
}

type ToolArgsValidator<TArgs> = (params: Record<string, unknown>) => TArgs;

export function parseToolArgs<TArgs>(
  params: unknown,
  options: {
    toolName: string;
    allowedFields: readonly string[];
    validate: ToolArgsValidator<TArgs>;
  }
): TArgs;
export function parseToolArgs<
  TContract extends Record<TMethod, ToolArgsValidator<TArgs>>,
  TMethod extends keyof TContract,
  TArgs = ReturnType<TContract[TMethod]>
>(
  params: unknown,
  options: {
    toolName: string;
    allowedFields: readonly string[];
    contract: TContract;
    method: TMethod;
  }
): TArgs;
export function parseToolArgs<TArgs>(
  params: unknown,
  options:
    | {
        toolName: string;
        allowedFields: readonly string[];
        validate: ToolArgsValidator<TArgs>;
      }
    | {
        toolName: string;
        allowedFields: readonly string[];
        contract: Record<string, ToolArgsValidator<TArgs>>;
        method: keyof Record<string, ToolArgsValidator<TArgs>>;
      }
): TArgs {
  const objectParams = expectToolParamsObject(params);
  rejectUnknownToolFields(objectParams, options.allowedFields, options.toolName);

  if ("validate" in options) {
    return options.validate(objectParams);
  }

  const validate = options.contract[options.method];
  if (typeof validate !== "function") {
    throw invalidInputFieldError(`Tool '${options.toolName}' parser is misconfigured.`);
  }
  return validate(objectParams);
}

export function hasOwnToolField(params: Record<string, unknown> | undefined, field: string): boolean {
  return typeof params !== "undefined" && Object.hasOwn(params, field);
}

export function getOptionalBooleanField(params: Record<string, unknown> | undefined, field: string): boolean | undefined {
  return hasOwnToolField(params, field) ? params?.[field] === true : undefined;
}

export function getOptionalPositiveInteger(
  params: Record<string, unknown> | undefined,
  field: string
): number | undefined {
  const value = params?.[field];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalidInputFieldError(`field '${field}' must be a positive integer`);
  }
  return value;
}

export function getOptionalNonNegativeInteger(
  params: Record<string, unknown> | undefined,
  field: string
): number | undefined {
  const value = params?.[field];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw invalidInputFieldError(`field '${field}' must be a non-negative integer`);
  }
  return value;
}

function normalizeCostInput(candidate: unknown, allowNull: boolean): CostConfig | null | undefined {
  if (typeof candidate === "undefined") {
    return undefined;
  }
  if (candidate === null) {
    return allowNull ? null : undefined;
  }
  try {
    return validateCostConfig(candidate, "field 'cost'");
  } catch (error) {
    throw invalidInputFieldError(error instanceof Error ? error.message : "field 'cost' is invalid");
  }
}

export function getRequiredToolString(
  params: Record<string, unknown> | undefined,
  field: string,
  toolName: string
): string {
  const value = params?.[field];
  if (!isNonEmptyString(value)) {
    throw missingRequiredFieldError(`Tool '${toolName}' requires non-empty '${field}'.`);
  }
  if (field === "model_id" || field === "provider_id" || field === "route_id") {
    try {
      assertSafeObjectKey(value, `field '${field}'`);
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }
  }
  return value;
}

export function normalizeToolModelIdFormat(value: unknown, field: string): ModelIdFormat {
  const modelIdFormat = normalizeModelIdFormat(value);
  if (modelIdFormat === null) {
    throw invalidInputFieldError(`field '${field}' must be one of: passthrough, creator/model`);
  }
  return modelIdFormat;
}

function rejectMaskedSecretSentinel(value: string | null | undefined, field: string): void {
  if (typeof value === "string" && value === MASKED_SECRET_SENTINEL) {
    throw invalidInputFieldError(`field '${field}' looks like the masked sentinel returned by providers_show; pass the real secret`);
  }
}

export function getProviderApiKey(params: Record<string, unknown> | undefined): string | null | undefined {
  const value = params?.["api_key"];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isNonEmptyString(value)) {
    throw invalidInputFieldError("field 'api_key' must be a non-empty string or null");
  }
  rejectMaskedSecretSentinel(value, "api_key");
  return value;
}

export function getProviderApiKeyEnv(params: Record<string, unknown> | undefined): string | null | undefined {
  const value = params?.["api_key_env"];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isNonEmptyString(value)) {
    throw invalidInputFieldError("field 'api_key_env' must be a non-empty string or null");
  }
  return value;
}

export function getNullableStringField(params: Record<string, unknown> | undefined, field: string): string | null | undefined {
  try {
    return getNullableConfigStringField(params ?? {}, field, "field");
  } catch (error) {
    if (
      error instanceof ConfigValidationError &&
      error.code === CONFIG_VALIDATION_ERROR_CODES.invalidNullableStringField
    ) {
      throw invalidInputFieldError(`field '${field}' must be a non-empty string or null`);
    }

    const message = error instanceof Error ? error.message : `field '${field}' must be a non-empty string or null`;
    throw invalidInputFieldError(message);
  }
}

export function getOptionalObservationOutcome(
  params: Record<string, unknown> | undefined,
  field: string
): ObservationOutcome | undefined {
  const value = getOptionalString(params, field);
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!isAllowedObservabilityFilterValue(value, OBSERVATION_OUTCOMES)) {
    throw invalidInputFieldError(buildAllowedObservabilityFilterMessage(`field '${field}'`, OBSERVATION_OUTCOMES));
  }
  return value;
}

export function getOptionalObservationKind(
  params: Record<string, unknown> | undefined,
  field: string
): ObservationKind | undefined {
  const value = getOptionalString(params, field);
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!isAllowedObservabilityFilterValue(value, OBSERVATION_KINDS)) {
    throw invalidInputFieldError(buildAllowedObservabilityFilterMessage(`field '${field}'`, OBSERVATION_KINDS));
  }
  return value;
}

export function getOptionalObservationEvent(
  params: Record<string, unknown> | undefined,
  field: string
): ObservationEvent | undefined {
  const value = getOptionalString(params, field);
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!isAllowedObservabilityFilterValue(value, OBSERVATION_EVENTS)) {
    throw invalidInputFieldError(buildAllowedObservabilityFilterMessage(`field '${field}'`, OBSERVATION_EVENTS));
  }
  return value;
}

export const modelInputContract = createModelInputContract({
  isNonEmptyString,
  assertSafeIdentifier: (value, label) => {
    try {
      assertSafeObjectKey(value, label);
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }
  },
  normalizeCost: (value, options) => normalizeCostInput(value, options.allowNull),
  missingRequiredField: (message) => {
    throw missingRequiredFieldError(message);
  },
  invalidInputField: (message) => {
    throw invalidInputFieldError(message);
  },
  missingUpdateFields: (message) => {
    throw new McpToolError(MCP_USAGE_ERROR_CODES.missingUpdateFields, message);
  }
});

export const providerInputContract = createProviderInputContract({
  isNonEmptyString,
  assertSafeIdentifier: (value, label) => {
    try {
      assertSafeObjectKey(value, label);
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }
  },
  normalizeApiMode,
  normalizeModelIdFormat,
  missingRequiredField: (message) => {
    throw missingRequiredFieldError(message);
  },
  invalidInputField: (message) => {
    throw invalidInputFieldError(message);
  },
  invalidFlagValue: (message) => {
    throw invalidInputFieldError(message);
  },
  conflictingInputModes: (message) => {
    throw new McpToolError(MCP_USAGE_ERROR_CODES.conflictingInputModes, message);
  },
  missingUpdateFields: (message) => {
    throw new McpToolError(MCP_USAGE_ERROR_CODES.missingUpdateFields, message);
  }
});

export const routeInputContract = createRouteInputContract({
  isNonEmptyString,
  assertSafeIdentifier: (value, label) => {
    try {
      assertSafeObjectKey(value, label);
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }
  },
  normalizeCost: (value, options) => normalizeCostInput(value, options.allowNull),
  missingRequiredField: (message) => {
    throw missingRequiredFieldError(message);
  },
  invalidInputField: (message) => {
    throw invalidInputFieldError(message);
  },
  missingUpdateFields: (message) => {
    throw new McpToolError(MCP_USAGE_ERROR_CODES.missingUpdateFields, message);
  }
});

export const providerAuthInputContract = createProviderAuthInputContract({
  isNonEmptyString,
  assertSafeIdentifier: (value, label) => {
    try {
      assertSafeObjectKey(value, label);
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }
  },
  invalidInputField: (message) => {
    throw invalidInputFieldError(message);
  },
  missingRequiredField: (message) => {
    throw missingRequiredFieldError(message);
  },
  rejectMaskedSecretSentinel
});
