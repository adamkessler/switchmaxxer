import type { CostConfig } from "../../platform/types";

export type SerializedCostConfig = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type ModelCreateInput = {
  name: string;
  display_name: string;
  model_creator: string;
  cost?: CostConfig;
};

export type ModelUpdateInput = {
  name: string;
  display_name?: string;
  model_creator?: string;
  cost?: CostConfig | null;
};

export function pickCostFields(cost: CostConfig): SerializedCostConfig {
  return {
    input: cost.input,
    output: cost.output,
    cache_read: cost.cacheRead,
    cache_write: cost.cacheWrite
  };
}

export function createModelInputContract(deps: {
  isNonEmptyString: (value: unknown) => value is string;
  assertSafeIdentifier: (value: string, label: string) => void;
  normalizeCost: (value: unknown, options: { allowNull: boolean; fieldName: string }) => CostConfig | null | undefined;
  missingRequiredField: (message: string) => never;
  invalidInputField: (message: string) => never;
  missingUpdateFields: (message: string) => never;
}) {
  function requireString(value: unknown, missingMessage: string, invalidMessage: string): string {
    if (typeof value === "undefined") {
      deps.missingRequiredField(missingMessage);
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function optionalString(value: unknown, invalidMessage: string): string | undefined {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function validateModelCreateInput(options: {
    name: unknown;
    displayName: unknown;
    modelCreator: unknown;
    cost: unknown;
    missingNameMessage: string;
    missingDisplayNameMessage: string;
    missingModelCreatorMessage: string;
    invalidNameMessage: string;
    invalidDisplayNameMessage: string;
    invalidModelCreatorMessage: string;
    identifierLabel: string;
    costFieldName: string;
  }): ModelCreateInput {
    const name = requireString(options.name, options.missingNameMessage, options.invalidNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);

    const displayName = requireString(
      options.displayName,
      options.missingDisplayNameMessage,
      options.invalidDisplayNameMessage
    );
    const modelCreator = requireString(
      options.modelCreator,
      options.missingModelCreatorMessage,
      options.invalidModelCreatorMessage
    );
    const cost = deps.normalizeCost(options.cost, { allowNull: false, fieldName: options.costFieldName });

    return {
      name,
      display_name: displayName,
      model_creator: modelCreator,
      ...(typeof cost === "undefined" || cost === null ? {} : { cost })
    };
  }

  function validateModelUpdateInput(options: {
    name: unknown;
    displayName: unknown;
    modelCreator: unknown;
    cost: unknown;
    missingNameMessage: string;
    invalidDisplayNameMessage: string;
    invalidModelCreatorMessage: string;
    identifierLabel: string;
    costFieldName: string;
    missingUpdateFieldsMessage: string;
  }): ModelUpdateInput {
    const name = requireString(options.name, options.missingNameMessage, options.missingNameMessage);
    deps.assertSafeIdentifier(name, options.identifierLabel);

    const displayName = optionalString(options.displayName, options.invalidDisplayNameMessage);
    const modelCreator = optionalString(options.modelCreator, options.invalidModelCreatorMessage);
    const cost = deps.normalizeCost(options.cost, { allowNull: true, fieldName: options.costFieldName });

    if (typeof displayName === "undefined" && typeof modelCreator === "undefined" && typeof cost === "undefined") {
      deps.missingUpdateFields(options.missingUpdateFieldsMessage);
    }

    return {
      name,
      ...(typeof displayName === "undefined" ? {} : { display_name: displayName }),
      ...(typeof modelCreator === "undefined" ? {} : { model_creator: modelCreator }),
      ...(typeof cost === "undefined" ? {} : { cost })
    };
  }

  return {
    validateModelCreateInput,
    validateModelUpdateInput
  };
}
