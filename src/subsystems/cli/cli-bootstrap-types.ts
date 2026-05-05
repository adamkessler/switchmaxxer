import { createConfigCli } from "./commands/config";
import { createMcpCli } from "./commands/mcp";
import { createModelsCli } from "./commands/models";
import { createProvidersCli } from "./commands/providers";
import { createRoutesCli } from "./commands/routes";
import { createConfigReadCommands } from "./config-read-commands";
import { createConfigWriteCommands } from "./config-write-commands";
import type { AppConfig, CliReadModel } from "../../platform/types";
import type { AppErrorCode } from "../../platform/error-codes";
import type { BenchmarkPreflightResult } from "../bench/bench-runtime";
import type { ObservabilityModule } from "../observability/observability-module";

type ConfigReadCommandDeps = Parameters<typeof createConfigReadCommands>[0];
type ConfigWriteCommandDeps = Parameters<typeof createConfigWriteCommands>[0];
type ConfigCliDeps = Parameters<typeof createConfigCli>[0];
type McpCliDeps = Parameters<typeof createMcpCli>[0];
type ModelsCliDeps = Parameters<typeof createModelsCli>[0];
type ProvidersCliDeps = Parameters<typeof createProvidersCli>[0];
type RoutesCliDeps = Parameters<typeof createRoutesCli>[0];
type OptimizeCliDeps = Parameters<typeof import("./commands/optimize").createOptimizeCli>[0];

export type CliParserDeps = {
  parseConfigCommandArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseConfigCommandArgs>;
  parseConfigExportArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseConfigExportArgs>;
  parseConfigImportArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseConfigImportArgs>;
  parseConfigSetArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseConfigSetArgs>;
  parseModelsCreateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseModelsCreateArgs>;
  parseModelsUpdateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseModelsUpdateArgs>;
  parseProviderSetKeyArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseProviderSetKeyArgs>;
  parseProvidersCreateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseProvidersCreateArgs>;
  parseProvidersUpdateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseProvidersUpdateArgs>;
  parseRoutesCreateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseRoutesCreateArgs>;
  parseRoutesUpdateArgs: (argv: string[]) => ReturnType<typeof import("./command-args").parseRoutesUpdateArgs>;
  parseOptimizeRunArgs: OptimizeCliDeps["parseOptimizeRunArgs"];
  parseOptimizeListArgs: OptimizeCliDeps["parseOptimizeListArgs"];
  parseOptimizePruneArgs: OptimizeCliDeps["parseOptimizePruneArgs"];
  parseOptimizeShowArgs: OptimizeCliDeps["parseOptimizeShowArgs"];
  parseOptimizeApplyArgs: OptimizeCliDeps["parseOptimizeApplyArgs"];
};

export type CliOutputDeps = {
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonSuccessEnvelope: (
    command: string,
    data: unknown,
    options?: {
      count?: number;
      warnings?: unknown;
      details?: unknown;
      top_level?: Record<string, unknown>;
    }
  ) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: string,
    message: string,
    options?: {
      warnings?: unknown;
      details?: unknown;
    }
  ) => void;
};

export type CliMutationCommandDeps = {
  getMutableConfigSection: (
    document: Record<string, unknown>,
    sectionName: "models" | "service_providers" | "routes"
  ) => Record<string, unknown>;
  createCliMutationError: (code: string, message: string) => Error;
  assertSafeCliConfigIdentifier: (value: string, label: string) => void;
  classifyCliUsageFailure: ConfigWriteCommandDeps["classifyCliUsageFailure"];
  noUsageMessageMatch: ConfigWriteCommandDeps["noUsageMessageMatch"];
};

export type CliBootstrapNormalizationDeps = {
  resolveStructuredInputMode: (
    commandName: string,
    options: { stdin: boolean; jsonInputPath?: string }
  ) => ReturnType<typeof import("./structured-input-detect").resolveStructuredInputMode>;
  assertStructuredInputPresent: ConfigWriteCommandDeps["assertStructuredInputPresent"];
  normalizeModelCreateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeModelCreateInput"];
  normalizeModelUpdateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeModelUpdateInput"];
  normalizeProviderCreateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeProviderCreateInput"];
  normalizeProviderUpdateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeProviderUpdateInput"];
  normalizeRouteCreateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeRouteCreateInput"];
  normalizeRouteUpdateInput: ReturnType<typeof import("./input-normalization").createCliInputNormalization>["normalizeRouteUpdateInput"];
};

export interface CliBootstrapDeps {
  cliParserDeps: CliParserDeps;
  cliOutputDeps: CliOutputDeps;
  cliMutationCommandDeps: CliMutationCommandDeps;
  registrationDeps: {
    createCliCommandRegistration: ModelsCliDeps["createCliCommandRegistration"];
    runRegisteredCommandFamily: ModelsCliDeps["runRegisteredCommandFamily"];
    runHelpAwareCommand: ConfigCliDeps["runHelpAwareCommand"];
    runMcpServe: McpCliDeps["runMcpServe"];
    runMcpCapabilities: McpCliDeps["runMcpCapabilities"];
  };
  configDeps: {
    loadConfig: (configPath?: string) => AppConfig;
    loadCliReadModel: (configPath?: string) => CliReadModel;
    getCliEnv: ConfigReadCommandDeps["getCliEnv"];
    getCliCwd: ConfigReadCommandDeps["getCliCwd"];
    resolveCliConfigPath: ConfigReadCommandDeps["resolveCliConfigPath"];
    loadConfigDocumentForDisplay: ConfigReadCommandDeps["loadConfigDocumentForDisplay"];
    loadConfigJsonDocument: ConfigReadCommandDeps["loadConfigJsonDocument"];
    normalizeAndValidateConfigDocumentForMutation: ConfigReadCommandDeps["normalizeAndValidateConfigDocumentForMutation"];
    writeConfigJsonDocument: ConfigReadCommandDeps["writeConfigJsonDocument"];
    throwCliInvalidInputField: ConfigWriteCommandDeps["throwCliInvalidInputField"];
    readCliStdin: ConfigWriteCommandDeps["readCliStdin"];
    readCliStdinSync: (options?: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string }) => string;
    readTextFileWithinCliLimit: ConfigWriteCommandDeps["readTextFileWithinCliLimit"];
    readJsonObjectFromString: ConfigWriteCommandDeps["readJsonObjectFromString"];
    serializeConfigDocument: ConfigWriteCommandDeps["serializeConfigDocument"];
    renderConfigImportDiff: ConfigWriteCommandDeps["renderConfigImportDiff"];
    createConfigImportBackup: ConfigWriteCommandDeps["createConfigImportBackup"];
    mutateConfigDocument: ConfigWriteCommandDeps["mutateConfigDocument"];
    maskSecretValue: ProvidersCliDeps["maskSecretValue"];
  };
  observabilityDeps: {
    observabilityModule: ObservabilityModule;
    resolveObservabilityStorePath: () => string;
    defaultCliFetchTimeoutMs: number;
    preflightGatewayRouteTests: (configPath?: string) => Promise<BenchmarkPreflightResult>;
    runOptimizeApplyReload: OptimizeCliDeps["runOptimizeApplyReload"];
    runOptimizeApplyVerify: OptimizeCliDeps["runOptimizeApplyVerify"];
  };
  normalizationDeps: CliBootstrapNormalizationDeps;
  metadataDeps: {
    buildCliConfigSchemaMetadata: ConfigReadCommandDeps["buildCliConfigSchemaMetadata"];
    buildModelFieldMetadata: ModelsCliDeps["buildModelFieldMetadata"];
    buildProviderFieldMetadata: ProvidersCliDeps["buildProviderFieldMetadata"];
    buildRouteFieldMetadata: RoutesCliDeps["buildRouteFieldMetadata"];
  };
  formattingDeps: {
    classifyMutationError: (message: string, fallbackCode: AppErrorCode) => {
      message: string;
      code: AppErrorCode;
      exitCode: number;
    };
    formatCostConfig: (value: unknown) => string;
    createCliUsageError: ConfigWriteCommandDeps["createCliUsageError"];
  };
  contractDeps: {
    mcpUsageErrorCodes: ConfigWriteCommandDeps["mcpUsageErrorCodes"] & {
      invalidFlagValue: string;
    };
    mcpEntityStateErrorCodes: {
      modelAlreadyExists: AppErrorCode;
      modelNotFound: AppErrorCode;
      modelInUse: AppErrorCode;
      providerAlreadyExists: AppErrorCode;
      providerNotFound: AppErrorCode;
      providerInUse: AppErrorCode;
      routeAlreadyExists: AppErrorCode;
      routeNotFound: AppErrorCode;
      unknownModel: AppErrorCode;
      unknownServiceProvider: AppErrorCode;
    };
  };
}
