import { createCliOutputWriter } from "./subsystems/cli/output-writer";
import { createCliEntrypointErrorGuard } from "./subsystems/cli/entrypoint-error-guard";
import { handleCliFallback } from "./subsystems/cli/dispatch-support";
import {
  createAppCliConfigMutationWiring,
  createAppCliInputWiring,
  createAppCliParserDeps,
  createAppCliRegistryWiring,
  createAppGatewayHttpWiring
} from "./subsystems/cli/app-cli-wiring";
import {
  formatCostConfig,
  readLongFlagValue,
  type CliInputUtilsDeps
} from "./subsystems/cli/input-utils";
import { runCliDispatch } from "./subsystems/cli/dispatch";
import { createDefaultCliIo, getCliCwd, getCliEnv, getCliIo, runWithCliIo, type CliIo } from "./subsystems/cli/io";
import { getCliUsageContext, runWithCliUsageContext } from "./subsystems/cli/usage-context";
import { createCliBootstrap } from "./subsystems/cli/cli-bootstrap";
import { createCliAppRuntime } from "./subsystems/cli/app-cli-runtime";
import {
  createObservabilityBootstrap
} from "./subsystems/observability/observability-bootstrap";
import { createSwitchmaxxerContainer } from "./bootstrap";
import {
  buildCliConfigSchemaMetadata,
  buildModelFieldMetadata,
  buildProviderFieldMetadata,
  buildRouteFieldMetadata,
  MCP_ENTITY_STATE_ERROR_CODES,
  MCP_USAGE_ERROR_CODES
} from "./subsystems/config/config-metadata";
import { matchesLogFilters, parseGatewayRunArgs, parseLogsTailArgs } from "./subsystems/gateway/runtime-support";
import { createGatewayBootstrap } from "./subsystems/cli/gateway-cli-bootstrap";
import {
  loadCliReadModel,
  loadConfigDocumentForDisplay,
  loadConfigJsonDocument,
  loadRawConfigJsonDocument,
  resolveCliConfigPath,
  resolveConfiguredObservabilityRetentionOlderThan
} from "./subsystems/config/read-model";
import {
  assertBenchmarkPromptLength,
  BENCH_MAX_CONCURRENCY,
  BENCH_MAX_ITERATIONS,
  BENCH_MAX_PROMPT_LENGTH,
  BENCH_MAX_ROUTES
} from "./subsystems/observability/bench-limits";
import { assertSafeObjectKey } from "./platform/object-key-policy";
import { retentionDurationToCutoffIso } from "./platform/retention-duration";
import { isNonEmptyString } from "./platform/type-guards";
import { runTasksWithConcurrency } from "./platform/concurrency";
import {
  buildBenchTasks,
  executeBenchmarkTask,
  resolveBenchmarkExecutionPlan
} from "./subsystems/bench/bench-runtime";
import { loadConfig } from "./subsystems/config/config";
import { type AppErrorCode, APP_ERROR_CODES } from "./platform/error-codes";
import { getPackageVersion } from "./platform/package-version";
import {
  buildLocalGatewayAuthHeaders,
  resolveLocalGatewayInboundAuthState,
  timingSafeTokenMatches
} from "./subsystems/gateway/local-gateway-auth";
import { runMcpCapabilities, runMcpServe } from "./subsystems/mcp/mcp";
import {
  buildBenchmarkReportView,
  toBenchmarkRunView,
  toBenchmarkSampleView,
  toTraceObservationView,
  toTraceSummaryView
} from "./subsystems/observability/contracts";
import {
  bootstrapGatewayObservability,
  configureGatewayObservability,
  pruneGatewayObservabilityRetentionNow,
  shutdownGatewayObservability
} from "./subsystems/observability/gateway";
import {
  closeObservabilityServiceHandle,
  openExistingObservabilityService,
  openObservabilityService,
  resolveObservabilityStorePath
} from "./subsystems/observability/runtime-loader";
import { maskSecretValue } from "./platform/masked-secret";
import {
  OBSERVATION_EVENTS,
  OBSERVATION_KINDS,
  OBSERVATION_OUTCOMES
} from "./subsystems/observability/types";
import { logDebug, logLine, logStartup, logWarning } from "./platform/logger";
import { proxyAnthropicMessage, proxyChatCompletion, runRouteTestsDetailed, sendJsonError } from "./subsystems/proxy/proxy";
import {
  normalizeApiMode,
  normalizeModelIdFormat,
  type CostConfig
} from "./platform/types";

const DEFAULT_MAX_PAYLOAD_SIZE = 4_000_000;
const DEFAULT_CLI_FETCH_TIMEOUT_MS = 60_000;
const MAX_REQUEST_JSON_DEPTH = 64;
const DEFAULT_SYSTEMD_UNIT = "switchmaxxer.service";
const DEFAULT_RELOAD_CONFIRMATION_POLL_INTERVAL_MS = 100;
// Keep the runtime-config probe timeout comfortably above one poll tick so a
// slower local response does not get treated like a cadence change.
const DEFAULT_RELOAD_CONFIRMATION_FETCH_TIMEOUT_MS = DEFAULT_RELOAD_CONFIRMATION_POLL_INTERVAL_MS * 5;
const appVersion = getPackageVersion();
const cliOutputWriter = createCliOutputWriter({
  stdout: (message) => getCliIo().stdout(message),
  stderr: (message) => getCliIo().stderr(message),
  getUsageContext: () => getCliUsageContext(),
  classifyUsageError: (message) =>
    classifyCliUsageFailure(new Error(message), {
      usageFallbackCode: APP_ERROR_CODES.invalidRequest,
      mutationFallbackCode: APP_ERROR_CODES.invalidRequest,
      isUsageMessage: () => true
    }),
  getTopLevelHelpText: () => switchmaxxerContainer.getTopLevelHelpText()
});
const cliEntrypointErrorGuard = createCliEntrypointErrorGuard({
  writeJsonErrorEnvelope: (command, code, message) => cliOutputWriter.writeJsonErrorEnvelope(command, code, message),
  writeStderr: cliOutputWriter.writeStderr,
  runWithUsageContext: runWithCliUsageContext
});

const {
  writeConfigJsonDocument,
  serializeConfigDocument,
  createConfigImportBackup,
  renderConfigImportDiff,
  getMutableConfigSection,
  normalizeAndValidateConfigDocumentForMutation,
  classifyMutationError,
  CliUsageError,
  CliMutationError,
  throwCliInvalidInputField,
  classifyCliUsageFailure,
  noUsageMessageMatch,
  mutateConfigDocument
} = createAppCliConfigMutationWiring({
  defaultMaxPayloadSize: DEFAULT_MAX_PAYLOAD_SIZE,
  defaultSystemdUnit: DEFAULT_SYSTEMD_UNIT,
  resolveCliConfigPath,
  loadConfigJsonDocument: loadRawConfigJsonDocument,
  assertSafeObjectKey,
  getCliEnv
});

const cliInputUtilsDeps: CliInputUtilsDeps = {
  getCliIo,
  writeStderr: cliOutputWriter.writeStderr,
  assertSafeObjectKey,
  throwCliInvalidInputField
};
const {
  readCliStdinSyncWithIo,
  readCliStdinWithIo,
  readTextFileWithinCliLimit,
  readJsonObjectFromStringWithValidation,
  assertSafeCliConfigIdentifierWithDeps,
  resolveStructuredInputMode,
  assertStructuredInputPresent,
  normalizeModelCreateInput,
  normalizeModelUpdateInput,
  normalizeProviderCreateInput,
  normalizeProviderUpdateInput,
  normalizeRouteCreateInput,
  normalizeRouteUpdateInput
} = createAppCliInputWiring({
  cliInputUtilsDeps,
  isNonEmptyCliString: isNonEmptyString,
  normalizeApiMode,
  normalizeModelIdFormat,
  throwCliInvalidInputField,
  createCliUsageError: (code, message) => new CliUsageError(code, message),
  mcpUsageErrorCodes: {
    conflictingStructuredInput: MCP_USAGE_ERROR_CODES.conflictingStructuredInput,
    missingRequiredField: MCP_USAGE_ERROR_CODES.missingRequiredField,
    conflictingInputModes: MCP_USAGE_ERROR_CODES.conflictingInputModes,
    missingUpdateFields: MCP_USAGE_ERROR_CODES.missingUpdateFields,
    unsupportedClearCost: MCP_USAGE_ERROR_CODES.unsupportedClearCost,
    invalidInputField: MCP_USAGE_ERROR_CODES.invalidInputField,
    invalidFlagValue: MCP_USAGE_ERROR_CODES.invalidFlagValue,
    conflictingCostFlags: MCP_USAGE_ERROR_CODES.conflictingCostFlags,
    incompleteCostFlags: MCP_USAGE_ERROR_CODES.incompleteCostFlags
  }
});

const {
  readRequestBodyWithLimit,
  validateParsedRequestBodyShape,
  resolveConfiguredSystemdUnit,
  resolveSystemdUnitFromDocument
} = createAppGatewayHttpWiring({
  getCliEnv,
  isNonEmptyCliString: isNonEmptyString,
  isNonEmptyConfigString: isNonEmptyString,
  defaultSystemdUnit: DEFAULT_SYSTEMD_UNIT,
  maxRequestJsonDepth: MAX_REQUEST_JSON_DEPTH
});

function printUsageError(message: string): void {
  cliOutputWriter.printUsageError(message);
}

const {
  createCliCommandRegistration,
  createCliCommandFamilyRegistration,
  runRegisteredCommandFamily,
  runHelpAwareCommand
} = createAppCliRegistryWiring({
  printUsageError,
  writeJsonErrorEnvelope: cliOutputWriter.writeJsonErrorEnvelope,
  writeStderr: cliOutputWriter.writeStderr,
  runWithUsageContext: runWithCliUsageContext
});

const cliParserDeps = createAppCliParserDeps();

const cliOutputDeps = {
  printUsageError,
  writeStdout: cliOutputWriter.writeStdout,
  writeStderr: cliOutputWriter.writeStderr,
  writeJson: cliOutputWriter.writeJson,
  writeJsonSuccessEnvelope: cliOutputWriter.writeJsonSuccessEnvelope,
  writeJsonErrorEnvelope: cliOutputWriter.writeJsonErrorEnvelope
};

const cliMutationCommandDeps = {
  assertSafeCliConfigIdentifier: assertSafeCliConfigIdentifierWithDeps,
  getMutableConfigSection,
  classifyCliUsageFailure,
  noUsageMessageMatch,
  createCliMutationError: (code: string, message: string, exitCode?: number) =>
    new CliMutationError(code, message, exitCode)
};

const {
  getInlineApiKeyProviderNames,
  getWorldReadableConfigWarning,
  configCli,
  modelsCli,
  providersCli,
  routesCli,
  mcpCli,
  optimizeCli
} = createCliBootstrap({
  cliParserDeps,
  cliOutputDeps,
  cliMutationCommandDeps,
  registrationDeps: {
    createCliCommandRegistration,
    runRegisteredCommandFamily,
    runHelpAwareCommand,
    runMcpServe: (argv) =>
      runMcpServe(argv, {
        optimizePostActions: {
          runOptimizeApplyReload,
          runOptimizeApplyVerify
        }
      }),
    runMcpCapabilities: (argv) =>
      runMcpCapabilities(argv, {
        printUsageError: cliOutputWriter.printUsageError,
        writeStdout: cliOutputWriter.writeStdout,
        writeJsonSuccessEnvelope: cliOutputWriter.writeJsonSuccessEnvelope
      })
  },
  configDeps: {
    loadConfig,
    loadCliReadModel,
    getCliEnv,
    getCliCwd,
    resolveCliConfigPath,
    loadConfigDocumentForDisplay,
    loadConfigJsonDocument,
    normalizeAndValidateConfigDocumentForMutation,
    writeConfigJsonDocument,
    throwCliInvalidInputField,
    readCliStdin: readCliStdinWithIo,
    readCliStdinSync: readCliStdinSyncWithIo,
    readTextFileWithinCliLimit,
    readJsonObjectFromString: readJsonObjectFromStringWithValidation,
    serializeConfigDocument,
    renderConfigImportDiff,
    createConfigImportBackup,
    mutateConfigDocument,
    maskSecretValue
  },
  observabilityDeps: {
    openExistingObservabilityService,
    openObservabilityService,
    closeObservabilityServiceHandle,
    resolveObservabilityStorePath,
    defaultCliFetchTimeoutMs: DEFAULT_CLI_FETCH_TIMEOUT_MS,
    preflightGatewayRouteTests,
    runOptimizeApplyReload,
    runOptimizeApplyVerify
  },
  normalizationDeps: {
    resolveStructuredInputMode,
    assertStructuredInputPresent,
    normalizeModelCreateInput,
    normalizeModelUpdateInput,
    normalizeProviderCreateInput,
    normalizeProviderUpdateInput,
    normalizeRouteCreateInput,
    normalizeRouteUpdateInput
  },
  metadataDeps: {
    buildCliConfigSchemaMetadata,
    buildModelFieldMetadata,
    buildProviderFieldMetadata,
    buildRouteFieldMetadata
  },
  formattingDeps: {
    classifyMutationError: (message: string, fallbackCode: AppErrorCode) => classifyMutationError(message, fallbackCode) as {
      message: string;
      code: AppErrorCode;
      exitCode: number;
    },
    formatCostConfig: (value: unknown) => formatCostConfig(value as CostConfig | null | undefined),
    createCliUsageError: (code: string, message: string) => new CliUsageError(code, message)
  },
  contractDeps: {
    mcpUsageErrorCodes: MCP_USAGE_ERROR_CODES,
    mcpEntityStateErrorCodes: MCP_ENTITY_STATE_ERROR_CODES
  }
});

async function fetchGatewayRuntimeConfigPayload(
  document: Record<string, unknown>,
  timeoutMs = DEFAULT_RELOAD_CONFIRMATION_FETCH_TIMEOUT_MS
): Promise<{
  endpoint: string;
  payload: Record<string, unknown>;
}> {
  return await gatewayRuntime.fetchGatewayRuntimeConfigPayload(document, timeoutMs);
}

const { benchCli, ledgerCli, pruneCli, traceCli } = createObservabilityBootstrap({
  registrationDeps: {
    createCliCommandRegistration,
    runRegisteredCommandFamily
  },
  cliOutputDeps,
  benchDeps: {
    writeJson: cliOutputWriter.writeJson,
    readLongFlagValue,
    assertBenchmarkPromptLength,
    benchLimits: {
      maxConcurrency: BENCH_MAX_CONCURRENCY,
      maxIterations: BENCH_MAX_ITERATIONS,
      maxPromptLength: BENCH_MAX_PROMPT_LENGTH,
      maxRoutes: BENCH_MAX_ROUTES
    },
    defaultCliFetchTimeoutMs: DEFAULT_CLI_FETCH_TIMEOUT_MS,
    openExistingObservabilityService,
    openObservabilityService,
    closeObservabilityServiceHandle,
    resolveObservabilityStorePath,
    loadConfig,
    preflightGatewayRouteTests,
    resolveBenchmarkExecutionPlan,
    buildBenchTasks,
    executeBenchmarkTask,
    runTasksWithConcurrency,
    toBenchmarkRunView,
    toBenchmarkSampleView,
    buildBenchmarkReportView,
    classifyCliUsageFailure,
    noUsageMessageMatch,
    mcpUsageErrorCodes: MCP_USAGE_ERROR_CODES,
    mcpEntityStateErrorCodes: {
      routeNotFound: MCP_ENTITY_STATE_ERROR_CODES.routeNotFound
    },
    createCliUsageError: (code: string, message: string) => new CliUsageError(code, message)
  },
  traceDeps: {
    readLongFlagValue,
    getCliEnv,
    openExistingObservabilityService,
    closeObservabilityServiceHandle,
    toTraceSummaryView,
    toTraceObservationView,
    toBenchmarkSampleView,
    observationOutcomes: OBSERVATION_OUTCOMES,
    observationKinds: OBSERVATION_KINDS,
    observationEvents: OBSERVATION_EVENTS
  },
  ledgerDeps: {
    readLongFlagValue,
    openExistingObservabilityService,
    closeObservabilityServiceHandle,
    resolveObservabilityStorePath
  },
  pruneDeps: {
    readLongFlagValue,
    openExistingObservabilityService,
    closeObservabilityServiceHandle,
    resolveObservabilityStorePath,
    resolveConfiguredObservabilityRetentionOlderThan,
    retentionDurationToCutoffIso,
    resolveCliConfigPath
  }
});

const {
  gatewayHealthCommands,
  gatewayOperatorCommands,
  gatewayRuntime,
  invokeRuntime,
  testRuntime,
  gatewayCli,
  invokeCli,
  testCli,
  toolCli
} = createGatewayBootstrap({
  cliParserDeps: {
    parseConfigCommandArgs: cliParserDeps.parseConfigCommandArgs
  },
  cliOutputDeps,
  readLongFlagValue,
  runRegisteredCommandFamily,
  createCliCommandFamilyRegistration,
  runHelpAwareCommand,
  parseGatewayRunArgs: (argv) => parseGatewayRunArgs(argv, readLongFlagValue),
  parseLogsTailArgs: (argv) => parseLogsTailArgs(argv, readLongFlagValue),
  getCliEnv,
  loadConfig,
  loadCliReadModel,
  loadConfigJsonDocument,
  resolveSystemdUnitFromDocument,
  fetchGatewayRuntimeConfigPayload,
  matchesLogFilters,
  buildLocalGatewayAuthHeaders,
  resolveLocalGatewayInboundAuthState,
  timingSafeTokenMatches,
  proxyAnthropicMessage,
  proxyChatCompletion,
  sendJsonError,
  readRequestBodyWithLimit,
  validateParsedRequestBodyShape,
  resolveConfiguredSystemdUnit,
  maskSecretValue,
  configureGatewayObservability,
  pruneGatewayObservabilityRetentionNow,
  bootstrapGatewayObservability,
  shutdownGatewayObservability,
  getInlineApiKeyProviderNames,
  getWorldReadableConfigWarning,
  logLine,
  logWarning,
  logStartup: (bindHost, port, routeCount, sourcePath) =>
    logStartup(appVersion, bindHost, port, routeCount, sourcePath),
  logDebug,
  readCliStdin: readCliStdinWithIo,
  getMutableConfigSection,
  writeConfigJsonDocument,
  runRouteTestsDetailed,
  defaultCliFetchTimeoutMs: DEFAULT_CLI_FETCH_TIMEOUT_MS,
  preflightGatewayRouteTests,
  mcpEntityStateErrorCodes: {
    routeNotFound: MCP_ENTITY_STATE_ERROR_CODES.routeNotFound
  }
});

const { runGatewayRun } = gatewayRuntime;

async function preflightGatewayRouteTests(configPath?: string): Promise<
  | {
      ok: true;
      sourceFile: string;
      sourcePath: string;
      bindHost: string;
      port: number;
      probeHost: string;
      healthUrl: string;
      pid: number | null;
      latencyMs: number | null;
    }
  | {
      ok: false;
      code: typeof APP_ERROR_CODES.invalidConfig | typeof APP_ERROR_CODES.gatewayUnavailable;
      message: string;
      sourceFile: string;
      sourcePath: string;
      bindHost: string;
      port: number | null;
      probeHost: string;
      healthUrl: string | null;
      pid: number | null;
      latencyMs: number | null;
    }
> {
  return await gatewayHealthCommands.preflightGatewayRouteTests(configPath);
}

async function runOptimizeApplyReload(options: { configPath?: string; operation?: "apply" | "restore" }) {
  const operation = options.operation ?? "apply";
  const result = await gatewayOperatorCommands.runReloadOperation(options.configPath);

  return {
    requested: true,
    status: result.ok ? "succeeded" as const : "failed" as const,
    exit_code: result.ok ? 0 : 1,
    command: "gateway reload",
    message: result.ok ? null : result.message || `Gateway reload failed after optimize ${operation}.`,
    ...(result.ok ? { data: result.data } : {}),
    ...(result.ok ? {} : { error: { code: result.code, message: result.message } })
  };
}

async function runOptimizeApplyVerify(options: { configPath?: string; routeId: string; operation?: "apply" | "restore" }) {
  const operation = options.operation ?? "apply";
  const result = await testRuntime.runTestRoutesOperation({
    routeName: options.routeId,
    configPath: options.configPath,
    noGateway: false,
    log: false
  });

  return {
    requested: true,
    status: result.ok && result.data.failed === 0 ? "passed" as const : "failed" as const,
    exit_code: result.ok && result.data.failed === 0 ? 0 : 1,
    command: "test",
    route_id: options.routeId,
    message:
      result.ok && result.data.failed === 0
        ? null
        : result.ok
          ? `Route verification failed after optimize ${operation}.`
          : result.message || `Route verification failed after optimize ${operation}.`,
    ...(result.ok ? { data: result.data } : {}),
    ...(result.ok ? {} : { error: { code: result.code, message: result.message } })
  };
}

const switchmaxxerContainer = createSwitchmaxxerContainer({
  configCli,
  modelsCli,
  providersCli,
  pruneCli,
  ledgerCli,
  traceCli,
  routesCli,
  testCli,
  gatewayCli,
  invokeCli,
  mcpCli,
  toolCli,
  benchCli,
  optimizeCli,
  writeStdout: cliOutputWriter.writeStdout,
  writeStderr: cliOutputWriter.writeStderr,
  printUsageError,
  runCliEntrypoint: cliEntrypointErrorGuard.runCliEntrypoint,
  runDefaultGatewayEntry: async () => {
    await runGatewayRun();
    return 0;
  }
});

const { runCliInternal } = createCliAppRuntime({
  runCliDispatch,
  handleCliFallback,
  printUsageError,
  registries: switchmaxxerContainer.registries,
  invokeRuntime,
  testRuntime
});

export async function run(argv: string[], io: CliIo = createDefaultCliIo()): Promise<number> {
  return await runWithCliIo(io, async () => await runCliInternal(argv));
}

export async function runCli(argv: string[], io: CliIo = createDefaultCliIo()): Promise<number> {
  return await run(argv, io);
}

export type { CliIo } from "./subsystems/cli/io";

export type SwitchmaxxerApp = {
  run: (argv: string[]) => Promise<number>;
  runCli: (argv: string[]) => Promise<number>;
};

export function createSwitchmaxxerApp(options: {
  io?: Omit<CliIo, "env" | "cwd">;
  env?: NodeJS.ProcessEnv;
  cwd?: () => string;
} = {}): SwitchmaxxerApp {
  const defaultIo = createDefaultCliIo();
  const io: CliIo = {
    stdout: options.io?.stdout ?? defaultIo.stdout,
    stderr: options.io?.stderr ?? defaultIo.stderr,
    stdin: options.io?.stdin ?? defaultIo.stdin,
    env: options.env ?? defaultIo.env,
    cwd: options.cwd ?? defaultIo.cwd
  };

  return {
    run: async (argv: string[]) => await run(argv, io),
    runCli: async (argv: string[]) => await runCli(argv, io)
  };
}
