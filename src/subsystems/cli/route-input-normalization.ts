import { assertResolvedCostFlags, resolveCostFlags } from "./cost-flag-parser";
import { assertNoStructuredInputMix, loadStructuredInputPayload, resolveStructuredInputMode, withStructuredInputMode } from "./structured-input-detect";
import { createRouteInputContract } from "../config/route-input-contract";
import { ROUTE_INPUT_SHAPES, rejectUnknownStructuredInputFields } from "../config/entity-input-shapes";
import type { CliTextReadOptions } from "./input-utils";
import type { CostConfig } from "../../platform/types";
import type {
  NormalizedRouteCreateInput,
  NormalizedRouteUpdateInput,
  RouteCliMutationArgs
} from "./route-input-types";

export function createCliRouteInputNormalization(deps: {
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
    invalidInputField: string;
    conflictingInputModes: string;
    conflictingStructuredInput: string;
    missingUpdateFields: string;
    conflictingCostFlags: string;
    incompleteCostFlags: string;
  };
}) {
  const routeInputContract = createRouteInputContract({
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

  function normalizeRouteCreateInput(args: RouteCliMutationArgs): NormalizedRouteCreateInput {
    const commandName = "routes create";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);
    const resolvedCostFlags = resolveCostFlags(args, { allowPartial: false });

    assertResolvedCostFlags(resolvedCostFlags, deps);

    if (resolvedCostFlags.cost === null) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.unsupportedClearCost,
        "Flag '--clear-cost' is not supported for 'routes create'"
      );
    }

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      typeof resolvedCostFlags.cost !== "undefined" || Boolean(args.clearCost) || typeof args.timeoutMs !== "undefined" || Boolean(args.clearTimeoutMs),
      "with '--cost-*' flags, '--clear-cost', '--timeout-ms', or '--clear-timeout-ms'",
      deps
    );

    if (args.clearTimeoutMs) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.invalidInputField,
        "Flag '--clear-timeout-ms' is not supported for 'routes create'"
      );
    }

    return withStructuredInputMode(commandName, args, deps, {
      stdin: () => {
        const structuredInput = loadStructuredInputPayload("stdin", args, deps) as {
          payload: Record<string, unknown>;
          sourceLabel: "stdin payload";
        };
        const { payload, sourceLabel } = structuredInput;
        rejectUnknownStructuredInputFields(
          payload,
          ROUTE_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return routeInputContract.validateRouteCreateInput({
          name: payload["name"],
          model: payload["model"],
          serviceProvider: payload["service_provider"],
          providerModelId: payload["provider_model_id"],
          displayName: payload["display_name"],
          timeoutMs: payload["timeout_ms"],
          cost: payload["cost"],
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingModelMessage: `${sourceLabel} must include a non-empty 'model'`,
          invalidModelMessage: `${sourceLabel} must include a non-empty 'model'`,
          missingServiceProviderMessage: `${sourceLabel} must include a non-empty 'service_provider'`,
          invalidServiceProviderMessage: `${sourceLabel} must include a non-empty 'service_provider'`,
          missingProviderModelIdMessage: `${sourceLabel} must include a non-empty 'provider_model_id'`,
          invalidProviderModelIdMessage: `${sourceLabel} must include a non-empty 'provider_model_id'`,
          missingDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidTimeoutMessage: `${sourceLabel} field 'timeout_ms' must be a positive integer when provided`,
          identifierLabel: "Route name",
          costFieldName: `${sourceLabel} field 'cost'`
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
          ROUTE_INPUT_SHAPES.cliStructured.create,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return routeInputContract.validateRouteCreateInput({
          name: payload["name"],
          model: payload["model"],
          serviceProvider: payload["service_provider"],
          providerModelId: payload["provider_model_id"],
          displayName: payload["display_name"],
          timeoutMs: payload["timeout_ms"],
          cost: payload["cost"],
          missingNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          invalidNameMessage: `${sourceLabel} must include a non-empty 'name'`,
          missingModelMessage: `${sourceLabel} must include a non-empty 'model'`,
          invalidModelMessage: `${sourceLabel} must include a non-empty 'model'`,
          missingServiceProviderMessage: `${sourceLabel} must include a non-empty 'service_provider'`,
          invalidServiceProviderMessage: `${sourceLabel} must include a non-empty 'service_provider'`,
          missingProviderModelIdMessage: `${sourceLabel} must include a non-empty 'provider_model_id'`,
          invalidProviderModelIdMessage: `${sourceLabel} must include a non-empty 'provider_model_id'`,
          missingDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidDisplayNameMessage: `${sourceLabel} must include a non-empty 'display_name'`,
          invalidTimeoutMessage: `${sourceLabel} field 'timeout_ms' must be a positive integer when provided`,
          identifierLabel: "Route name",
          costFieldName: `${sourceLabel} field 'cost'`
        });
      },
      cli: () => {
        if (!deps.isNonEmptyCliString(args.name)) {
          throw deps.createCliUsageError(
            deps.mcpUsageErrorCodes.missingRequiredField,
            "Missing required argument '<name>' for 'routes create'"
          );
        }

        if (!deps.isNonEmptyCliString(args.model)) {
          throw deps.createCliUsageError(
            deps.mcpUsageErrorCodes.missingRequiredField,
            "Flag '--model' is required when not using '--stdin' or '--json-input'"
          );
        }

        if (!deps.isNonEmptyCliString(args.serviceProvider)) {
          throw deps.createCliUsageError(
            deps.mcpUsageErrorCodes.missingRequiredField,
            "Flag '--service-provider' is required when not using '--stdin' or '--json-input'"
          );
        }

        if (!deps.isNonEmptyCliString(args.providerModelId)) {
          throw deps.createCliUsageError(
            deps.mcpUsageErrorCodes.missingRequiredField,
            "Flag '--provider-model-id' is required when not using '--stdin' or '--json-input'"
          );
        }

        if (!deps.isNonEmptyCliString(args.displayName)) {
          throw deps.createCliUsageError(
            deps.mcpUsageErrorCodes.missingRequiredField,
            "Flag '--display-name' is required when not using '--stdin' or '--json-input'"
          );
        }

        return routeInputContract.validateRouteCreateInput({
          name: args.name,
          model: args.model,
          serviceProvider: args.serviceProvider,
          providerModelId: args.providerModelId,
          displayName: args.displayName,
          timeoutMs: args.timeoutMs,
          cost: resolvedCostFlags.cost,
          missingNameMessage: "Missing required argument '<name>' for 'routes create'",
          invalidNameMessage: "Missing required argument '<name>' for 'routes create'",
          missingModelMessage: "Flag '--model' is required when not using '--stdin' or '--json-input'",
          invalidModelMessage: "Flag '--model' is required when not using '--stdin' or '--json-input'",
          missingServiceProviderMessage: "Flag '--service-provider' is required when not using '--stdin' or '--json-input'",
          invalidServiceProviderMessage: "Flag '--service-provider' is required when not using '--stdin' or '--json-input'",
          missingProviderModelIdMessage: "Flag '--provider-model-id' is required when not using '--stdin' or '--json-input'",
          invalidProviderModelIdMessage: "Flag '--provider-model-id' is required when not using '--stdin' or '--json-input'",
          missingDisplayNameMessage: "Flag '--display-name' is required when not using '--stdin' or '--json-input'",
          invalidDisplayNameMessage: "Flag '--display-name' is required when not using '--stdin' or '--json-input'",
          invalidTimeoutMessage: "Flag '--timeout-ms' requires a positive integer",
          identifierLabel: "Route name",
          costFieldName: "cli field 'cost'"
        });
      }
    });
  }

  function normalizeRouteUpdateInput(args: RouteCliMutationArgs): NormalizedRouteUpdateInput {
    const commandName = "routes update";
    const structuredInputMode = resolveStructuredInputMode(commandName, args, deps);
    const resolvedCostFlags = resolveCostFlags(args, { allowPartial: false });

    if (!deps.isNonEmptyCliString(args.name)) {
      throw deps.createCliUsageError(
        deps.mcpUsageErrorCodes.missingRequiredField,
        "Missing required argument '<name>' for 'routes update'"
      );
    }

    deps.assertSafeCliConfigIdentifier(args.name, "Route name");

    assertResolvedCostFlags(resolvedCostFlags, deps);

    assertNoStructuredInputMix(
      commandName,
      structuredInputMode,
      typeof resolvedCostFlags.cost !== "undefined" || Boolean(args.clearCost) || typeof args.timeoutMs !== "undefined" || Boolean(args.clearTimeoutMs),
      "with '--cost-*' flags, '--clear-cost', '--timeout-ms', or '--clear-timeout-ms'",
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
          ROUTE_INPUT_SHAPES.cliStructured.update,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return routeInputContract.validateRouteUpdateInput({
          name: args.name,
          model: payload["model"],
          serviceProvider: payload["service_provider"],
          providerModelId: payload["provider_model_id"],
          displayName: payload["display_name"],
          timeoutMs: payload["timeout_ms"],
          cost: payload["cost"],
          missingNameMessage: "Missing required argument '<name>' for 'routes update'",
          invalidModelMessage: `${sourceLabel} field 'model' must be a non-empty string`,
          invalidServiceProviderMessage: `${sourceLabel} field 'service_provider' must be a non-empty string`,
          invalidProviderModelIdMessage: `${sourceLabel} field 'provider_model_id' must be a non-empty string`,
          invalidDisplayNameMessage: `${sourceLabel} field 'display_name' must be a non-empty string`,
          invalidTimeoutMessage: `${sourceLabel} field 'timeout_ms' must be a positive integer or null`,
          identifierLabel: "Route name",
          costFieldName: `${sourceLabel} field 'cost'`,
          missingUpdateFieldsMessage: "Provide at least one update field for 'routes update': 'model', 'service_provider', 'provider_model_id', 'display_name', 'timeout_ms', or 'cost'"
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
          ROUTE_INPUT_SHAPES.cliStructured.update,
          sourceLabel,
          deps.throwCliInvalidInputField
        );

        return routeInputContract.validateRouteUpdateInput({
          name: args.name,
          model: payload["model"],
          serviceProvider: payload["service_provider"],
          providerModelId: payload["provider_model_id"],
          displayName: payload["display_name"],
          timeoutMs: payload["timeout_ms"],
          cost: payload["cost"],
          missingNameMessage: "Missing required argument '<name>' for 'routes update'",
          invalidModelMessage: `${sourceLabel} field 'model' must be a non-empty string`,
          invalidServiceProviderMessage: `${sourceLabel} field 'service_provider' must be a non-empty string`,
          invalidProviderModelIdMessage: `${sourceLabel} field 'provider_model_id' must be a non-empty string`,
          invalidDisplayNameMessage: `${sourceLabel} field 'display_name' must be a non-empty string`,
          invalidTimeoutMessage: `${sourceLabel} field 'timeout_ms' must be a positive integer or null`,
          identifierLabel: "Route name",
          costFieldName: `${sourceLabel} field 'cost'`,
          missingUpdateFieldsMessage: "Provide at least one update field for 'routes update': 'model', 'service_provider', 'provider_model_id', 'display_name', 'timeout_ms', or 'cost'"
        });
      },
      cli: () =>
        routeInputContract.validateRouteUpdateInput({
          name: args.name,
          model: args.model,
          serviceProvider: args.serviceProvider,
          providerModelId: args.providerModelId,
          displayName: args.displayName,
          timeoutMs: args.clearTimeoutMs ? null : args.timeoutMs,
          cost: resolvedCostFlags.cost,
          missingNameMessage: "Missing required argument '<name>' for 'routes update'",
          invalidModelMessage: "Flag '--model' requires a non-empty string",
          invalidServiceProviderMessage: "Flag '--service-provider' requires a non-empty string",
          invalidProviderModelIdMessage: "Flag '--provider-model-id' requires a non-empty string",
          invalidDisplayNameMessage: "Flag '--display-name' requires a non-empty string",
          invalidTimeoutMessage: "Flag '--timeout-ms' requires a positive integer or null",
          identifierLabel: "Route name",
          costFieldName: "cli field 'cost'",
          missingUpdateFieldsMessage: "Provide at least one update field for 'routes update': '--model', '--service-provider', '--provider-model-id', '--display-name', '--timeout-ms', '--clear-timeout-ms', '--stdin', or '--json-input'"
        })
    });
  }

  return {
    normalizeRouteCreateInput,
    normalizeRouteUpdateInput
  };
}
