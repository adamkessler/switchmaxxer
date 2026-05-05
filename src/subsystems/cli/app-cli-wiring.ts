import {
  parseConfigCommandArgs,
  parseConfigExportArgs,
  parseConfigImportArgs,
  parseConfigSetArgs,
  parseModelsCreateArgs,
  parseModelsUpdateArgs,
  parseOptimizeListArgs,
  parseOptimizeApplyArgs,
  parseOptimizePruneArgs,
  parseOptimizeRunArgs,
  parseOptimizeShowArgs,
  parseProviderSetKeyArgs,
  parseProvidersCreateArgs,
  parseProvidersUpdateArgs,
  parseRoutesCreateArgs,
  parseRoutesUpdateArgs
} from "./command-args";
import { runUnsupportedCliCommand } from "./dispatch-support";
import { createCliInputNormalization } from "./input-normalization";
import {
  assertSafeCliConfigIdentifier,
  normalizeCliCostConfig,
  readCliStdin,
  readCliStdinSync,
  readJsonObjectFromString,
  readTextFileWithinCliLimit,
  readLongFlagValue,
  type CliInputUtilsDeps
} from "./input-utils";
import {
  createCliCommandFamilyRegistration as createCliCommandFamilyRegistrationWithDeps,
  createCliCommandRegistration as createCliCommandRegistrationWithDeps,
  runRegisteredCommandFamily as runRegisteredCommandFamilyWithDeps,
  type CliCommandRegistration
} from "./registry";
import { CURRENT_CONFIG_VERSION } from "../config/config";
import { isValidSystemdUnitName } from "../config/config-validation";
import { createConfigMutationRuntime } from "../config/mutation";
import { createGatewayHttpRuntimeHelpers } from "../hot-path/manatee/runtime/http-runtime-helpers";
import type { CostConfig } from "../../platform/types";

type RunWithUsageContext = <T>(
  context: { command: string; json: boolean },
  fn: () => Promise<T>
) => Promise<T>;

export function createAppCliConfigMutationWiring(deps: {
  defaultMaxPayloadSize: number;
  defaultSystemdUnit: string;
  resolveCliConfigPath: (configPath?: string) => string;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  assertSafeObjectKey: (value: string, label: string) => void;
  getCliEnv: () => NodeJS.ProcessEnv;
}) {
  const configMutationRuntime = createConfigMutationRuntime({
    currentConfigVersion: CURRENT_CONFIG_VERSION,
    defaultMaxPayloadSize: deps.defaultMaxPayloadSize,
    defaultSystemdUnit: deps.defaultSystemdUnit,
    resolveCliConfigPath: deps.resolveCliConfigPath,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    assertSafeCliConfigIdentifier: (value, label) => deps.assertSafeObjectKey(value, label),
    getEnv: deps.getCliEnv
  });

  return {
    writeConfigJsonDocument: configMutationRuntime.writeConfigJsonDocument,
    serializeConfigDocument: configMutationRuntime.serializeConfigDocument,
    createConfigImportBackup: configMutationRuntime.createConfigImportBackup,
    renderConfigImportDiff: configMutationRuntime.renderConfigImportDiff,
    getMutableConfigSection: configMutationRuntime.getMutableConfigSection,
    normalizeAndValidateConfigDocumentForMutation: configMutationRuntime.normalizeAndValidateConfigDocumentForMutation,
    classifyMutationError: configMutationRuntime.classifyMutationError,
    CliUsageError: configMutationRuntime.CliUsageError,
    CliMutationError: configMutationRuntime.CliMutationError,
    throwCliInvalidInputField: configMutationRuntime.throwCliInvalidInputField,
    classifyCliUsageFailure: configMutationRuntime.classifyCliUsageFailure,
    noUsageMessageMatch: configMutationRuntime.noUsageMessageMatch,
    mutateConfigDocument: configMutationRuntime.mutateConfigDocument
  };
}

export function createAppGatewayHttpWiring(deps: {
  getCliEnv: () => NodeJS.ProcessEnv;
  isNonEmptyCliString: (value: unknown) => value is string;
  isNonEmptyConfigString: (value: unknown) => value is string;
  defaultSystemdUnit: string;
  maxRequestJsonDepth: number;
}) {
  const gatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: deps.getCliEnv,
    isNonEmptyCliString: deps.isNonEmptyCliString,
    isNonEmptyConfigString: deps.isNonEmptyConfigString,
    isValidSystemdUnitName,
    defaultSystemdUnit: deps.defaultSystemdUnit,
    maxRequestJsonDepth: deps.maxRequestJsonDepth
  });

  return {
    readRequestBodyWithLimit: gatewayHttpRuntimeHelpers.readRequestBodyWithLimit,
    validateParsedRequestBodyShape: gatewayHttpRuntimeHelpers.validateParsedRequestBodyShape,
    resolveConfiguredSystemdUnit: gatewayHttpRuntimeHelpers.resolveConfiguredSystemdUnit,
    resolveSystemdUnitFromDocument: gatewayHttpRuntimeHelpers.resolveSystemdUnitFromDocument
  };
}

export function createAppCliRegistryWiring(deps: {
  printUsageError: (message: string) => void;
  writeJsonErrorEnvelope: (command: string, code: string, message: string) => void;
  writeStderr: (message: string) => void;
  runWithUsageContext: RunWithUsageContext;
}) {
  const isHelpFlag = (arg?: string): boolean => arg === "--help" || arg === "-h";
  const cliRegistryDeps = {
    isHelpFlag,
    printUsageError: deps.printUsageError
  };

  async function runHelpAwareCommand(
    argv: string[],
    options: {
      help: () => void;
      run: (args: string[]) => Promise<number>;
      helpOnEmpty?: boolean;
    }
  ): Promise<number | undefined> {
    if ((options.helpOnEmpty && argv.length === 0) || isHelpFlag(argv[0])) {
      options.help();
      return undefined;
    }

    return await options.run(argv);
  }

  function createCliCommandRegistration(
    options: Parameters<typeof createCliCommandRegistrationWithDeps>[0]
  ): CliCommandRegistration {
    return createCliCommandRegistrationWithDeps(options, {
      printUsageError: deps.printUsageError,
      runUnsupportedCommand: (commandName, message, argv) =>
        runUnsupportedCliCommand(commandName, message, argv, {
          writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
          writeStderr: deps.writeStderr
        }),
      runWithUsageContext: deps.runWithUsageContext
    });
  }

  function createCliCommandFamilyRegistration(
    options: Parameters<typeof createCliCommandFamilyRegistrationWithDeps>[0]
  ): CliCommandRegistration {
    return createCliCommandFamilyRegistrationWithDeps(options, cliRegistryDeps);
  }

  async function runRegisteredCommandFamily(
    argv: string[],
    options: Parameters<typeof runRegisteredCommandFamilyWithDeps>[1]
  ): Promise<number | undefined> {
    return await runRegisteredCommandFamilyWithDeps(argv, options, cliRegistryDeps);
  }

  return {
    isHelpFlag,
    runHelpAwareCommand,
    createCliCommandRegistration,
    createCliCommandFamilyRegistration,
    runRegisteredCommandFamily
  };
}

export function createAppCliParserDeps() {
  return {
    parseConfigCommandArgs: (argv: string[]) => parseConfigCommandArgs(argv, readLongFlagValue),
    parseConfigExportArgs: (argv: string[]) => parseConfigExportArgs(argv, readLongFlagValue),
    parseConfigImportArgs: (argv: string[]) => parseConfigImportArgs(argv, readLongFlagValue),
    parseConfigSetArgs: (argv: string[]) => parseConfigSetArgs(argv, readLongFlagValue),
    parseProviderSetKeyArgs: (argv: string[]) => parseProviderSetKeyArgs(argv, readLongFlagValue),
    parseProvidersCreateArgs: (argv: string[]) => parseProvidersCreateArgs(argv, readLongFlagValue),
    parseProvidersUpdateArgs: (argv: string[]) => parseProvidersUpdateArgs(argv, readLongFlagValue),
    parseRoutesCreateArgs: (argv: string[]) => parseRoutesCreateArgs(argv, readLongFlagValue),
    parseRoutesUpdateArgs: (argv: string[]) => parseRoutesUpdateArgs(argv, readLongFlagValue),
    parseModelsCreateArgs: (argv: string[]) => parseModelsCreateArgs(argv, readLongFlagValue),
    parseModelsUpdateArgs: (argv: string[]) => parseModelsUpdateArgs(argv, readLongFlagValue),
    parseOptimizeRunArgs: (argv: string[]) => parseOptimizeRunArgs(argv, readLongFlagValue),
    parseOptimizeListArgs: (argv: string[]) => parseOptimizeListArgs(argv, readLongFlagValue),
    parseOptimizePruneArgs: (argv: string[]) => parseOptimizePruneArgs(argv, readLongFlagValue),
    parseOptimizeShowArgs: (argv: string[]) => parseOptimizeShowArgs(argv, readLongFlagValue),
    parseOptimizeApplyArgs: (argv: string[]) => parseOptimizeApplyArgs(argv, readLongFlagValue)
  };
}

export function createAppCliInputWiring(deps: {
  cliInputUtilsDeps: CliInputUtilsDeps;
  isNonEmptyCliString: (value: unknown) => value is string;
  normalizeApiMode: Parameters<typeof createCliInputNormalization>[0]["normalizeApiMode"];
  normalizeModelIdFormat: Parameters<typeof createCliInputNormalization>[0]["normalizeModelIdFormat"];
  throwCliInvalidInputField: (message: string) => never;
  createCliUsageError: (code: string, message: string) => Error;
  mcpUsageErrorCodes: Parameters<typeof createCliInputNormalization>[0]["mcpUsageErrorCodes"];
}) {
  const readCliStdinSyncWithIo = (options?: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string }) =>
    readCliStdinSync(deps.cliInputUtilsDeps, options);
  const readCliStdinWithIo = (options?: { maxBytes?: number; logicalName?: string }) =>
    readCliStdin(deps.cliInputUtilsDeps, options);
  const readJsonObjectFromStringWithValidation = (
    rawText: string,
    sourceName: string,
    options?: { maxSerializedBytes?: number }
  ) => readJsonObjectFromString(deps.cliInputUtilsDeps, rawText, sourceName, options);
  const assertSafeCliConfigIdentifierWithDeps = (value: string, label: string) =>
    assertSafeCliConfigIdentifier(deps.cliInputUtilsDeps, value, label);
  const normalizeCliCostConfigWithValidation = (
    value: unknown,
    fieldName: string,
    options: { allowNull: boolean }
  ): CostConfig | null | undefined => normalizeCliCostConfig(deps.cliInputUtilsDeps, value, fieldName, options);

  const cliInputNormalization = createCliInputNormalization({
    readCliStdinSync: readCliStdinSyncWithIo,
    readTextFileWithinCliLimit,
    readJsonObjectFromString: readJsonObjectFromStringWithValidation,
    isNonEmptyCliString: deps.isNonEmptyCliString,
    assertSafeCliConfigIdentifier: assertSafeCliConfigIdentifierWithDeps,
    normalizeCliCostConfig: normalizeCliCostConfigWithValidation,
    normalizeApiMode: deps.normalizeApiMode,
    normalizeModelIdFormat: deps.normalizeModelIdFormat,
    throwCliInvalidInputField: deps.throwCliInvalidInputField,
    createCliUsageError: deps.createCliUsageError,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes
  });

  return {
    readCliStdinSyncWithIo,
    readCliStdinWithIo,
    readTextFileWithinCliLimit,
    readJsonObjectFromStringWithValidation,
    assertSafeCliConfigIdentifierWithDeps,
    resolveStructuredInputMode: cliInputNormalization.resolveStructuredInputMode,
    assertStructuredInputPresent: cliInputNormalization.assertStructuredInputPresent,
    normalizeModelCreateInput: cliInputNormalization.normalizeModelCreateInput,
    normalizeModelUpdateInput: cliInputNormalization.normalizeModelUpdateInput,
    normalizeProviderCreateInput: cliInputNormalization.normalizeProviderCreateInput,
    normalizeProviderUpdateInput: cliInputNormalization.normalizeProviderUpdateInput,
    normalizeRouteCreateInput: cliInputNormalization.normalizeRouteCreateInput,
    normalizeRouteUpdateInput: cliInputNormalization.normalizeRouteUpdateInput
  };
}
