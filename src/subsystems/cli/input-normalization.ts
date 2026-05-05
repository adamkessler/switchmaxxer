import { createCliModelInputNormalization } from "./model-input-normalization";
import { createCliProviderInputNormalization } from "./provider-input-normalization";
import { createCliRouteInputNormalization } from "./route-input-normalization";
import {
  assertStructuredInputPresent,
  resolveStructuredInputMode,
  type StructuredInputMode
} from "./structured-input-detect";
import type { CliTextReadOptions } from "./input-utils";
import type { ApiMode, CostConfig, ModelIdFormat } from "../../platform/types";

export function createCliInputNormalization(deps: {
  readCliStdinSync: (options?: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string }) => string;
  readTextFileWithinCliLimit: (sourcePath: string, options?: CliTextReadOptions) => string;
  readJsonObjectFromString: (
    rawText: string,
    sourceName: string,
    options?: { maxSerializedBytes?: number }
  ) => Record<string, unknown>;
  isNonEmptyCliString: (value: unknown) => value is string;
  assertSafeCliConfigIdentifier: (value: string, label: string) => void;
  normalizeCliCostConfig: (
    value: unknown,
    fieldName: string,
    options: { allowNull: boolean }
  ) => CostConfig | null | undefined;
  normalizeApiMode: (value: unknown) => ApiMode | null;
  normalizeModelIdFormat: (value: unknown) => ModelIdFormat | null;
  throwCliInvalidInputField: (message: string) => never;
  createCliUsageError: (code: string, message: string) => Error;
  mcpUsageErrorCodes: {
    conflictingStructuredInput: string;
    missingRequiredField: string;
    conflictingInputModes: string;
    missingUpdateFields: string;
    unsupportedClearCost: string;
    invalidInputField: string;
    invalidFlagValue: string;
    conflictingCostFlags: string;
    incompleteCostFlags: string;
  };
}) {
  function assertAtLeastOneUpdateField(options: {
    commandName: string;
    source: "stdin payload" | "json input" | "cli";
    fieldNames: string[];
    hasAnyField: boolean;
  }): void {
    if (options.hasAnyField) {
      return;
    }

    const formattedFields = options.fieldNames.map((field) => `'${field}'`).join(", ");
    if (options.source === "cli") {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.missingUpdateFields,
        `Provide at least one update field for '${options.commandName}': ${formattedFields}`
      );
    }

    throw deps.createCliUsageError(
      deps.mcpUsageErrorCodes.missingUpdateFields,
      `${options.source} must include at least one update field: ${formattedFields}`
    );
  }

  function normalizeCliApiMode(value: unknown): ApiMode | null {
    return deps.normalizeApiMode(value);
  }

  function resolveNormalizationStructuredInputMode(
    commandName: string,
    options: {
      stdin: boolean;
      jsonInputPath?: string;
    }
  ): StructuredInputMode {
    return resolveStructuredInputMode(commandName, options, deps);
  }

  function assertNormalizationStructuredInputPresent(
    commandName: string,
    mode: StructuredInputMode,
    targetDescription: string
  ): void {
    assertStructuredInputPresent(commandName, mode, targetDescription, deps);
  }

  const {
    normalizeModelCreateInput,
    normalizeModelUpdateInput
  } = createCliModelInputNormalization({
    readCliStdinSync: deps.readCliStdinSync,
    readTextFileWithinCliLimit: deps.readTextFileWithinCliLimit,
    readJsonObjectFromString: deps.readJsonObjectFromString,
    isNonEmptyCliString: deps.isNonEmptyCliString,
    assertSafeCliConfigIdentifier: deps.assertSafeCliConfigIdentifier,
    normalizeCliCostConfig: deps.normalizeCliCostConfig,
    throwCliInvalidInputField: deps.throwCliInvalidInputField,
    createCliUsageError: deps.createCliUsageError,
    assertAtLeastOneUpdateField,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes
  });
  const {
    normalizeProviderCreateInput,
    normalizeProviderUpdateInput
  } = createCliProviderInputNormalization({
    readCliStdinSync: deps.readCliStdinSync,
    readTextFileWithinCliLimit: deps.readTextFileWithinCliLimit,
    readJsonObjectFromString: deps.readJsonObjectFromString,
    isNonEmptyCliString: deps.isNonEmptyCliString,
    assertSafeCliConfigIdentifier: deps.assertSafeCliConfigIdentifier,
    normalizeCliApiMode,
    normalizeModelIdFormat: deps.normalizeModelIdFormat,
    throwCliInvalidInputField: deps.throwCliInvalidInputField,
    createCliUsageError: deps.createCliUsageError,
    assertAtLeastOneUpdateField,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes
  });
  const {
    normalizeRouteCreateInput,
    normalizeRouteUpdateInput
  } = createCliRouteInputNormalization({
    readCliStdinSync: deps.readCliStdinSync,
    readTextFileWithinCliLimit: deps.readTextFileWithinCliLimit,
    readJsonObjectFromString: deps.readJsonObjectFromString,
    isNonEmptyCliString: deps.isNonEmptyCliString,
    assertSafeCliConfigIdentifier: deps.assertSafeCliConfigIdentifier,
    normalizeCliCostConfig: deps.normalizeCliCostConfig,
    throwCliInvalidInputField: deps.throwCliInvalidInputField,
    createCliUsageError: deps.createCliUsageError,
    assertAtLeastOneUpdateField,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes
  });

  return {
    resolveStructuredInputMode: resolveNormalizationStructuredInputMode,
    assertStructuredInputPresent: assertNormalizationStructuredInputPresent,
    normalizeModelCreateInput,
    normalizeModelUpdateInput,
    normalizeProviderCreateInput,
    normalizeProviderUpdateInput,
    normalizeRouteCreateInput,
    normalizeRouteUpdateInput
  };
}
