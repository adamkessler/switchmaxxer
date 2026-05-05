import { assertResolvedCostFlags, resolveCostFlags } from "./cost-flag-parser";
import { assertNoStructuredInputMix, loadStructuredInputPayload, resolveStructuredInputMode, withStructuredInputMode } from "./structured-input-detect";
import { createModelInputContract } from "../config/model-input-contract";
import { MODEL_INPUT_SHAPES, rejectUnknownStructuredInputFields } from "../config/entity-input-shapes";
import type { CliTextReadOptions } from "./input-utils";
import type { CostConfig } from "../../platform/types";

export function createCliModelInputNormalization(deps: {
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
    unsupportedClearCost: string;
    conflictingInputModes: string;
    conflictingStructuredInput: string;
    missingUpdateFields: string;
    conflictingCostFlags: string;
    incompleteCostFlags: string;
  };
}) {
  const modelInputContract = createModelInputContract({
    isNonEmptyString: deps.isNonEmptyCliString,
    assertSafeIdentifier: deps.assertSafeCliConfigIdentifier,
    normalizeCost: (value, options) => deps.normalizeCliCostConfig(value, options.fieldName, { allowNull: options.allowNull }),
    missingRequiredField: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.missingRequiredField, message);
    },
    invalidInputField: deps.throwCliInvalidInputField,
    missingUpdateFields: (message) => {
      throw deps.createCliUsageError(deps.mcpUsageErrorCodes.missingUpdateFields, message);
    }
  });

  function normalizeModelCreateInput(args: {
    stdin: boolean;
    jsonInputPath?: string;
    name?: string;
    displayName?: string;
    modelCreator?: string;
    costInput?: number;
    costOutput?: number;
    costCacheRead?: number;
    costCacheWrite?: number;
    clearCost?: boolean;
  }): {
    name: string;
    display_name: string;
    model_creator: string;
    cost?: CostConfig;
  } {
    const commandName = "models create";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);
    const resolvedCostFlags = resolveCostFlags(args, { allowPartial: false });

    assertResolvedCostFlags(resolvedCostFlags, deps);

    if (resolvedCostFlags.cost === null) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.unsupportedClearCost,
        "Flag '--clear-cost' is not supported for 'models create'"
      );
    }

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      typeof resolvedCostFlags.cost !== "undefined" || Boolean(args.clearCost),
      "with '--cost-*' flags or '--clear-cost'",
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
          MODEL_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return modelInputContract.validateModelCreateInput({
          name: payload["name"],
          displayName: payload["display_name"],
          modelCreator: payload["model_creator"],
          cost: payload["cost"],
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          missingModelCreatorMessage: `${sourceLabel} must include a non-empty 'model_creator'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidModelCreatorMessage: `${sourceLabel} must include a non-empty 'model_creator'`,
          identifierLabel: "Model name",
          costFieldName: "stdin payload field 'cost'"
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
          MODEL_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return modelInputContract.validateModelCreateInput({
          name: payload["name"],
          displayName: payload["display_name"],
          modelCreator: payload["model_creator"],
          cost: payload["cost"],
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          missingModelCreatorMessage: `${sourceLabel} must include a non-empty 'model_creator'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidModelCreatorMessage: `${sourceLabel} must include a non-empty 'model_creator'`,
          identifierLabel: "Model name",
          costFieldName: "json input field 'cost'"
        });
      },
      cli: () =>
        modelInputContract.validateModelCreateInput({
          name: args.name,
          displayName: args.displayName,
          modelCreator: args.modelCreator,
          cost: resolvedCostFlags.cost,
          missingNameMessage: "Missing required argument '<name>' for 'models create'",
          missingDisplayNameMessage: "Flag '--display-name' is required when not using '--stdin' or '--json-input'",
          missingModelCreatorMessage: "Flag '--model-creator' is required when not using '--stdin' or '--json-input'",
          invalidNameMessage: "Missing required argument '<name>' for 'models create'",
          invalidDisplayNameMessage: "Flag '--display-name' is required when not using '--stdin' or '--json-input'",
          invalidModelCreatorMessage: "Flag '--model-creator' is required when not using '--stdin' or '--json-input'",
          identifierLabel: "Model name",
          costFieldName: "cli field 'cost'"
        })
    });
  }

  function normalizeModelUpdateInput(args: {
    stdin: boolean;
    jsonInputPath?: string;
    name?: string;
    displayName?: string;
    modelCreator?: string;
    costInput?: number;
    costOutput?: number;
    costCacheRead?: number;
    costCacheWrite?: number;
    clearCost?: boolean;
  }): {
    name: string;
    display_name?: string;
    model_creator?: string;
    cost?: CostConfig | null;
  } {
    const commandName = "models update";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);
    const resolvedCostFlags = resolveCostFlags(args, { allowPartial: false });

    assertResolvedCostFlags(resolvedCostFlags, deps);

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      typeof resolvedCostFlags.cost !== "undefined" || Boolean(args.clearCost),
      "with '--cost-*' flags or '--clear-cost'",
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
          MODEL_INPUT_SHAPES.cliStructured.update,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return modelInputContract.validateModelUpdateInput({
          name: args.name,
          displayName: payload["display_name"],
          modelCreator: payload["model_creator"],
          cost: payload["cost"],
          missingNameMessage: "Missing required argument '<name>' for 'models update'",
          invalidDisplayNameMessage: `${sourceLabel} field 'display_name' must be a non-empty string`,
          invalidModelCreatorMessage: `${sourceLabel} field 'model_creator' must be a non-empty string`,
          identifierLabel: "Model name",
          costFieldName: `${sourceLabel} field 'cost'`,
          missingUpdateFieldsMessage: "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
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
          MODEL_INPUT_SHAPES.cliStructured.update,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return modelInputContract.validateModelUpdateInput({
          name: args.name,
          displayName: payload["display_name"],
          modelCreator: payload["model_creator"],
          cost: payload["cost"],
          missingNameMessage: "Missing required argument '<name>' for 'models update'",
          invalidDisplayNameMessage: `${sourceLabel} field 'display_name' must be a non-empty string`,
          invalidModelCreatorMessage: `${sourceLabel} field 'model_creator' must be a non-empty string`,
          identifierLabel: "Model name",
          costFieldName: `${sourceLabel} field 'cost'`,
          missingUpdateFieldsMessage: "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
        });
      },
      cli: () =>
        modelInputContract.validateModelUpdateInput({
          name: args.name,
          displayName: args.displayName,
          modelCreator: args.modelCreator,
          cost: resolvedCostFlags.cost,
          missingNameMessage: "Missing required argument '<name>' for 'models update'",
          invalidDisplayNameMessage: "Flag '--display-name' requires a non-empty string",
          invalidModelCreatorMessage: "Flag '--model-creator' requires a non-empty string",
          identifierLabel: "Model name",
          costFieldName: "cli field 'cost'",
          missingUpdateFieldsMessage: "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
        })
    });
  }

  return {
    normalizeModelCreateInput,
    normalizeModelUpdateInput
  };
}
