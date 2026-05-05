import type { CostConfig } from "../../platform/types";

export type RouteCreateInput = {
  name: string;
  model: string;
  service_provider: string;
  provider_model_id: string;
  display_name: string;
  timeout_ms?: number;
  cost?: CostConfig;
};

export type RouteUpdateInput = {
  name: string;
  model?: string;
  service_provider?: string;
  provider_model_id?: string;
  display_name?: string;
  timeout_ms?: number | null;
  cost?: CostConfig | null;
};

export function createRouteInputContract(deps: {
  isNonEmptyString: (value: unknown) => value is string;
  assertSafeIdentifier: (value: string, label: string) => void;
  normalizeCost: (value: unknown, options: { allowNull: boolean; fieldName: string }) => CostConfig | null | undefined;
  missingRequiredField: (message: string) => never;
  invalidInputField: (message: string) => never;
  missingUpdateFields: (message: string) => never;
}) {
  function readRequiredString(value: unknown, missingMessage: string, invalidMessage: string): string {
    if (typeof value === "undefined") {
      deps.missingRequiredField(missingMessage);
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readOptionalString(value: unknown, invalidMessage: string): string | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function readOptionalTimeout(
    value: unknown,
    invalidMessage: string,
    options: { allowNull: boolean }
  ): number | null | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (value === null) {
      return options.allowNull ? null : undefined;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function validateRouteCreateInput(options: {
    name: unknown;
    model: unknown;
    serviceProvider: unknown;
    providerModelId: unknown;
    displayName: unknown;
    timeoutMs: unknown;
    cost: unknown;
    missingNameMessage: string;
    invalidNameMessage: string;
    missingModelMessage: string;
    invalidModelMessage: string;
    missingServiceProviderMessage: string;
    invalidServiceProviderMessage: string;
    missingProviderModelIdMessage: string;
    invalidProviderModelIdMessage: string;
    missingDisplayNameMessage: string;
    invalidDisplayNameMessage: string;
    invalidTimeoutMessage: string;
    identifierLabel: string;
    costFieldName: string;
  }): RouteCreateInput {
    const name = readRequiredString(options.name, options.missingNameMessage, options.invalidNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);
    const model = readRequiredString(options.model, options.missingModelMessage, options.invalidModelMessage);
    const serviceProvider = readRequiredString(
      options.serviceProvider,
      options.missingServiceProviderMessage,
      options.invalidServiceProviderMessage
    );
    const providerModelId = readRequiredString(
      options.providerModelId,
      options.missingProviderModelIdMessage,
      options.invalidProviderModelIdMessage
    );
    const displayName = readRequiredString(
      options.displayName,
      options.missingDisplayNameMessage,
      options.invalidDisplayNameMessage
    );
    const timeoutMs = readOptionalTimeout(options.timeoutMs, options.invalidTimeoutMessage, { allowNull: false });
    const cost = deps.normalizeCost(options.cost, { allowNull: false, fieldName: options.costFieldName });

    return {
      name,
      model,
      service_provider: serviceProvider,
      provider_model_id: providerModelId,
      display_name: displayName,
      ...(typeof timeoutMs === "number" ? { timeout_ms: timeoutMs } : {}),
      ...(typeof cost === "undefined" || cost === null ? {} : { cost })
    };
  }

  function validateRouteUpdateInput(options: {
    name: unknown;
    model: unknown;
    serviceProvider: unknown;
    providerModelId: unknown;
    displayName: unknown;
    timeoutMs: unknown;
    cost: unknown;
    missingNameMessage: string;
    invalidModelMessage: string;
    invalidServiceProviderMessage: string;
    invalidProviderModelIdMessage: string;
    invalidDisplayNameMessage: string;
    invalidTimeoutMessage: string;
    identifierLabel: string;
    costFieldName: string;
    missingUpdateFieldsMessage: string;
  }): RouteUpdateInput {
    const name = readRequiredString(options.name, options.missingNameMessage, options.missingNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);
    const model = readOptionalString(options.model, options.invalidModelMessage);
    const serviceProvider = readOptionalString(options.serviceProvider, options.invalidServiceProviderMessage);
    const providerModelId = readOptionalString(options.providerModelId, options.invalidProviderModelIdMessage);
    const displayName = readOptionalString(options.displayName, options.invalidDisplayNameMessage);
    const timeoutMs = readOptionalTimeout(options.timeoutMs, options.invalidTimeoutMessage, { allowNull: true });
    const cost = deps.normalizeCost(options.cost, { allowNull: true, fieldName: options.costFieldName });

    if (
      typeof model === "undefined" &&
      typeof serviceProvider === "undefined" &&
      typeof providerModelId === "undefined" &&
      typeof displayName === "undefined" &&
      typeof timeoutMs === "undefined" &&
      typeof cost === "undefined"
    ) {
      deps.missingUpdateFields(options.missingUpdateFieldsMessage);
    }

    return {
      name,
      ...(typeof model === "undefined" ? {} : { model }),
      ...(typeof serviceProvider === "undefined" ? {} : { service_provider: serviceProvider }),
      ...(typeof providerModelId === "undefined" ? {} : { provider_model_id: providerModelId }),
      ...(typeof displayName === "undefined" ? {} : { display_name: displayName }),
      ...(typeof timeoutMs === "undefined" ? {} : { timeout_ms: timeoutMs }),
      ...(typeof cost === "undefined" ? {} : { cost })
    };
  }

  return {
    validateRouteCreateInput,
    validateRouteUpdateInput
  };
}
