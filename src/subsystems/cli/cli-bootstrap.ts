import { createConfigCli } from "./commands/config";
import { createMcpCli } from "./commands/mcp";
import { createModelsCli } from "./commands/models";
import { createOptimizeCli } from "./commands/optimize";
import { createProvidersCli } from "./commands/providers";
import { createRoutesCli } from "./commands/routes";
import { createConfigReadCommands } from "./config-read-commands";
import { createConfigWriteCommands } from "./config-write-commands";
import type { CliBootstrapDeps } from "./cli-bootstrap-types";
import { createCliMutationBootstrap } from "./cli-bootstrap-mutations";
import {
  beginPlannedExternalOptimizeApplyMutationAgainstModule,
  beginPlannedExternalOptimizeRestoreMutationAgainstModule
} from "../observability/observability-ipc-optimize-mutation-executor";
import { createOptimizeMutationIdempotencyRepository } from "../observability/optimize-mutation-idempotency-runtime";
import {
  closeObservabilityServiceHandle,
  openExistingObservabilityService
} from "../observability/runtime-loader";

export type { CliBootstrapDeps } from "./cli-bootstrap-types";

export function createCliBootstrap(rawDeps: CliBootstrapDeps) {
  const deps = {
    ...rawDeps,
    ...rawDeps.registrationDeps,
    ...rawDeps.configDeps,
    ...rawDeps.observabilityDeps,
    ...rawDeps.normalizationDeps,
    ...rawDeps.metadataDeps,
    ...rawDeps.formattingDeps,
    ...rawDeps.contractDeps
  };

  const configReadCommands = createConfigReadCommands({
    parseConfigCommandArgs: rawDeps.cliParserDeps.parseConfigCommandArgs,
    parseConfigExportArgs: rawDeps.cliParserDeps.parseConfigExportArgs,
    loadConfig: rawDeps.configDeps.loadConfig,
    loadCliReadModel: rawDeps.configDeps.loadCliReadModel,
    getCliEnv: rawDeps.configDeps.getCliEnv,
    resolveCliConfigPath: rawDeps.configDeps.resolveCliConfigPath,
    getCliCwd: rawDeps.configDeps.getCliCwd,
    loadConfigDocumentForDisplay: rawDeps.configDeps.loadConfigDocumentForDisplay,
    buildCliConfigSchemaMetadata: rawDeps.metadataDeps.buildCliConfigSchemaMetadata,
    mcpUsageErrorCodes: rawDeps.contractDeps.mcpUsageErrorCodes,
    mcpEntityStateErrorCodes: rawDeps.contractDeps.mcpEntityStateErrorCodes,
    loadConfigJsonDocument: rawDeps.configDeps.loadConfigJsonDocument,
    normalizeAndValidateConfigDocumentForMutation: rawDeps.configDeps.normalizeAndValidateConfigDocumentForMutation,
    writeConfigJsonDocument: rawDeps.configDeps.writeConfigJsonDocument,
    ...rawDeps.cliOutputDeps
  });

  const configWriteCommands = createConfigWriteCommands({
    parseConfigImportArgs: rawDeps.cliParserDeps.parseConfigImportArgs,
    parseConfigSetArgs: rawDeps.cliParserDeps.parseConfigSetArgs,
    resolveStructuredInputMode: rawDeps.normalizationDeps.resolveStructuredInputMode,
    assertStructuredInputPresent: rawDeps.normalizationDeps.assertStructuredInputPresent,
    classifyCliUsageFailure: rawDeps.cliMutationCommandDeps.classifyCliUsageFailure,
    noUsageMessageMatch: rawDeps.cliMutationCommandDeps.noUsageMessageMatch,
    createCliUsageError: rawDeps.formattingDeps.createCliUsageError,
    throwCliInvalidInputField: rawDeps.configDeps.throwCliInvalidInputField,
    readCliStdin: rawDeps.configDeps.readCliStdin,
    readTextFileWithinCliLimit: rawDeps.configDeps.readTextFileWithinCliLimit,
    readJsonObjectFromString: rawDeps.configDeps.readJsonObjectFromString,
    loadConfigJsonDocument: rawDeps.configDeps.loadConfigJsonDocument,
    normalizeAndValidateConfigDocumentForMutation: rawDeps.configDeps.normalizeAndValidateConfigDocumentForMutation,
    serializeConfigDocument: rawDeps.configDeps.serializeConfigDocument,
    renderConfigImportDiff: rawDeps.configDeps.renderConfigImportDiff,
    createConfigImportBackup: rawDeps.configDeps.createConfigImportBackup,
    writeConfigJsonDocument: rawDeps.configDeps.writeConfigJsonDocument,
    mutateConfigDocument: rawDeps.configDeps.mutateConfigDocument,
    resolveCliConfigPath: rawDeps.configDeps.resolveCliConfigPath,
    getCliCwd: rawDeps.configDeps.getCliCwd,
    mcpUsageErrorCodes: {
      missingRequiredField: rawDeps.contractDeps.mcpUsageErrorCodes.missingRequiredField,
      invalidInputField: rawDeps.contractDeps.mcpUsageErrorCodes.invalidInputField
    },
    ...rawDeps.cliOutputDeps
  });

  const mutationBootstrap = createCliMutationBootstrap(rawDeps);

  const getInlineApiKeyProviderNames = configReadCommands.getInlineApiKeyProviderNames;
  const getWorldReadableConfigWarning = configReadCommands.getWorldReadableConfigWarning;
  const runConfigValidate = async (argv: string[]): Promise<number> => configReadCommands.runConfigValidate(argv);
  const runConfigShow = async (argv: string[]): Promise<number> => configReadCommands.runConfigShow(argv);
  const runConfigSchema = async (argv: string[]): Promise<number> => configReadCommands.runConfigSchema(argv);
  const runConfigExport = async (argv: string[]): Promise<number> => configReadCommands.runConfigExport(argv);
  const runConfigImport = async (argv: string[]): Promise<number> => configWriteCommands.runConfigImport(argv);
  const runConfigSet = async (argv: string[]): Promise<number> => configWriteCommands.runConfigSet(argv);

  const routesCli = createRoutesCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    parseConfigCommandArgs: deps.cliParserDeps.parseConfigCommandArgs,
    loadCliReadModel: deps.loadCliReadModel,
    runRoutesCreate: mutationBootstrap.runRoutesCreate,
    runRoutesUpdate: mutationBootstrap.runRoutesUpdate,
    runRoutesDelete: mutationBootstrap.runRoutesDelete,
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJson: deps.cliOutputDeps.writeJson,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope,
    buildRouteFieldMetadata: deps.buildRouteFieldMetadata,
    formatCostConfig: deps.formatCostConfig,
    routeNotFoundCode: deps.mcpEntityStateErrorCodes.routeNotFound
  });

  const modelsCli = createModelsCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    parseConfigCommandArgs: deps.cliParserDeps.parseConfigCommandArgs,
    loadCliReadModel: deps.loadCliReadModel,
    runModelsCreate: mutationBootstrap.runModelsCreate,
    runModelsUpdate: mutationBootstrap.runModelsUpdate,
    runModelsDelete: mutationBootstrap.runModelsDelete,
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJson: deps.cliOutputDeps.writeJson,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope,
    buildModelFieldMetadata: deps.buildModelFieldMetadata,
    formatCostConfig: deps.formatCostConfig,
    modelNotFoundCode: deps.mcpEntityStateErrorCodes.modelNotFound
  });

  const providersCli = createProvidersCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    parseConfigCommandArgs: deps.cliParserDeps.parseConfigCommandArgs,
    loadCliReadModel: deps.loadCliReadModel,
    runProvidersCreate: mutationBootstrap.runProvidersCreate,
    runProvidersUpdate: mutationBootstrap.runProvidersUpdate,
    runProvidersDelete: mutationBootstrap.runProvidersDelete,
    runProvidersSetKey: mutationBootstrap.runProvidersSetKey,
    runProvidersClearKey: mutationBootstrap.runProvidersClearKey,
    runProvidersSetKeyEnv: mutationBootstrap.runProvidersSetKeyEnv,
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJson: deps.cliOutputDeps.writeJson,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope,
    buildProviderFieldMetadata: deps.buildProviderFieldMetadata,
    maskSecretValue: deps.maskSecretValue,
    providerNotFoundCode: deps.mcpEntityStateErrorCodes.providerNotFound
  });

  const configCli = createConfigCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    runHelpAwareCommand: deps.runHelpAwareCommand,
    runConfigValidate,
    runConfigShow,
    runConfigSchema,
    runConfigExport,
    runConfigImport,
    runConfigSet,
    writeStdout: deps.cliOutputDeps.writeStdout
  });

  const mcpCli = createMcpCli({
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    runHelpAwareCommand: deps.runHelpAwareCommand,
    runMcpServe: deps.runMcpServe,
    runMcpCapabilities: deps.runMcpCapabilities,
    writeStdout: deps.cliOutputDeps.writeStdout
  });

  const optimizeCli = createOptimizeCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    parseOptimizeRunArgs: deps.cliParserDeps.parseOptimizeRunArgs,
    parseOptimizeListArgs: deps.cliParserDeps.parseOptimizeListArgs,
    parseOptimizePruneArgs: deps.cliParserDeps.parseOptimizePruneArgs,
    parseOptimizeShowArgs: deps.cliParserDeps.parseOptimizeShowArgs,
    parseOptimizeApplyArgs: deps.cliParserDeps.parseOptimizeApplyArgs,
    loadConfig: deps.loadConfig,
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableConfigSection: deps.cliMutationCommandDeps.getMutableConfigSection,
    optimizationHistory: deps.observabilityDeps.observabilityModule.optimizationHistory,
    optimizationReports: deps.observabilityDeps.observabilityModule.optimizationReports,
    optimizeMutations: deps.observabilityDeps.observabilityModule.optimizeMutations,
    beginOptimizeApplyMutation: (options) => {
      const handle = openExistingObservabilityService(options.dbPath);
      if (handle === null) {
        return {
          id: options.id,
          ok: true,
          result: {
            dbPath: options.dbPath,
            storeFound: false,
            result: null
          },
          warnings: []
        };
      }

      let shouldClose = true;
      try {
        const response = beginPlannedExternalOptimizeApplyMutationAgainstModule({
          id: options.id,
          dbPath: options.dbPath,
          configPath: options.configPath,
          readModel: options.readModel,
          loadReadModel: options.loadReadModel,
          mutateConfigDocument: options.mutateConfigDocument,
          getMutableConfigSection: options.getMutableConfigSection,
          plan: options.plan,
          observabilityModule: deps.observabilityDeps.observabilityModule,
          repository: createOptimizeMutationIdempotencyRepository(handle),
          nowIso: new Date().toISOString()
        });
        if (response.ok && response.completeIdempotency) {
          shouldClose = false;
          return {
            ...response,
            completeIdempotency: (completion, completedAtIso) => {
              try {
                return response.completeIdempotency!(completion, completedAtIso ?? new Date().toISOString());
              } finally {
                closeObservabilityServiceHandle(handle);
              }
            }
          };
        }

        return response;
      } finally {
        if (shouldClose) {
          closeObservabilityServiceHandle(handle);
        }
      }
    },
    beginOptimizeRestoreMutation: (options) => {
      const handle = openExistingObservabilityService(options.dbPath);
      if (handle === null) {
        return {
          id: options.id,
          ok: true,
          result: {
            dbPath: options.dbPath,
            storeFound: false,
            result: null
          },
          warnings: []
        };
      }

      let shouldClose = true;
      try {
        const response = beginPlannedExternalOptimizeRestoreMutationAgainstModule({
          id: options.id,
          dbPath: options.dbPath,
          configPath: options.configPath,
          readModel: options.readModel,
          loadReadModel: options.loadReadModel,
          mutateConfigDocument: options.mutateConfigDocument,
          getMutableConfigSection: options.getMutableConfigSection,
          plan: options.plan,
          observabilityModule: deps.observabilityDeps.observabilityModule,
          repository: createOptimizeMutationIdempotencyRepository(handle),
          nowIso: new Date().toISOString()
        });
        if (response.ok && response.completeIdempotency) {
          shouldClose = false;
          return {
            ...response,
            completeIdempotency: (completion, completedAtIso) => {
              try {
                return response.completeIdempotency!(completion, completedAtIso ?? new Date().toISOString());
              } finally {
                closeObservabilityServiceHandle(handle);
              }
            }
          };
        }

        return response;
      } finally {
        if (shouldClose) {
          closeObservabilityServiceHandle(handle);
        }
      }
    },
    benchmarkRuns: deps.observabilityDeps.observabilityModule.benchmarkRuns,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath,
    defaultCliFetchTimeoutMs: deps.defaultCliFetchTimeoutMs,
    preflightGatewayRouteTests: deps.preflightGatewayRouteTests,
    runOptimizeApplyReload: deps.observabilityDeps.runOptimizeApplyReload,
    runOptimizeApplyVerify: deps.observabilityDeps.runOptimizeApplyVerify,
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJsonSuccessEnvelope: deps.cliOutputDeps.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope
  });

  return {
    getInlineApiKeyProviderNames,
    getWorldReadableConfigWarning,
    runConfigValidate,
    runConfigShow,
    runConfigSchema,
    runConfigExport,
    runConfigImport,
    runConfigSet,
    runModelsCreate: mutationBootstrap.runModelsCreate,
    runModelsUpdate: mutationBootstrap.runModelsUpdate,
    runModelsDelete: mutationBootstrap.runModelsDelete,
    runProvidersCreate: mutationBootstrap.runProvidersCreate,
    runProvidersUpdate: mutationBootstrap.runProvidersUpdate,
    runProvidersDelete: mutationBootstrap.runProvidersDelete,
    runRoutesCreate: mutationBootstrap.runRoutesCreate,
    runRoutesUpdate: mutationBootstrap.runRoutesUpdate,
    runRoutesDelete: mutationBootstrap.runRoutesDelete,
    runProvidersSetKey: mutationBootstrap.runProvidersSetKey,
    runProvidersClearKey: mutationBootstrap.runProvidersClearKey,
    runProvidersSetKeyEnv: mutationBootstrap.runProvidersSetKeyEnv,
    configCli,
    modelsCli,
    providersCli,
    routesCli,
    mcpCli,
    optimizeCli
  };
}
