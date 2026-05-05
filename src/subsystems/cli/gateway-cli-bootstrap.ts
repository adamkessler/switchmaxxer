import { createGatewayHealthCommands } from "../gateway/health-commands";
import { createGatewayOperatorCommands } from "../gateway/operator-commands";
import { createGatewayRuntime } from "../gateway/runtime";
import { createInvokeRuntime } from "./invoke-runtime";
import { createTestRuntime } from "./test-runtime";
import { createGatewayCli } from "./commands/gateway";
import { createInvokeCli } from "./commands/invoke";
import { createTestCli } from "./commands/test";
import { createToolCli } from "./commands/tool";
import type { CliCommandRegistration } from "./registry";
import type { AppErrorCode } from "../../platform/error-codes";
import type { AppConfig, LogLevel } from "../../platform/types";

export function createGatewayBootstrap(deps: {
  cliParserDeps: {
    parseConfigCommandArgs: (argv: string[]) => {
      configPath?: string;
      json: boolean;
      errorMessage?: string;
    };
  };
  cliOutputDeps: {
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
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string,
    missingValueMessage?: string
  ) =>
    | {
        value?: string;
        consumed: number;
        errorMessage?: string;
      }
    | null;
  runRegisteredCommandFamily: (
    argv: string[],
    options: {
      familyName: string;
      help: () => void;
      commands: CliCommandRegistration[];
      defaultRun?: (argv: string[]) => Promise<number | undefined>;
      missingSubcommandMessage?: string;
    }
  ) => Promise<number | undefined>;
  createCliCommandFamilyRegistration: (options: {
    name: string;
    commandName?: string;
    help: () => void;
    summary?: string;
    usageLines?: string[];
    exampleLines?: string[];
    match: (argv: string[]) => string[] | null;
    commands: CliCommandRegistration[];
    familyName?: string;
    missingSubcommandMessage?: string;
    defaultRun?: (argv: string[]) => Promise<number | undefined>;
  }) => CliCommandRegistration;
  runHelpAwareCommand: (
    argv: string[],
    options: {
      help: () => void;
      run: (args: string[]) => Promise<number>;
      helpOnEmpty?: boolean;
    }
  ) => Promise<number | undefined>;
  parseGatewayRunArgs: (argv: string[]) => {
    configPath?: string;
    host?: string;
    port?: number;
    logLevel?: LogLevel;
    errorMessage?: string;
  };
  parseLogsTailArgs: (argv: string[]) => {
    follow: boolean;
    lines: number;
    since?: string;
    format: "text" | "json";
    route?: string;
    provider?: string;
    errorMessage?: string;
  };
  getCliEnv: () => NodeJS.ProcessEnv;
  loadConfig: (configPath?: string) => AppConfig;
  loadCliReadModel: typeof import("../config/read-model").loadCliReadModel;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  resolveSystemdUnitFromDocument: (document: Record<string, unknown>) => string;
  fetchGatewayRuntimeConfigPayload: (
    document: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ endpoint: string; payload: Record<string, unknown> }>;
  matchesLogFilters: (
    rawLine: string,
    format: "text" | "json",
    route?: string,
    provider?: string
  ) => boolean;
  buildLocalGatewayAuthHeaders: typeof import("../gateway/local-gateway-auth").buildLocalGatewayAuthHeaders;
  resolveLocalGatewayInboundAuthState: typeof import("../gateway/local-gateway-auth").resolveLocalGatewayInboundAuthState;
  timingSafeTokenMatches: typeof import("../gateway/local-gateway-auth").timingSafeTokenMatches;
  proxyAnthropicMessage: typeof import("../proxy/proxy").proxyAnthropicMessage;
  proxyChatCompletion: typeof import("../proxy/proxy").proxyChatCompletion;
  sendJsonError: typeof import("../proxy/proxy").sendJsonError;
  readRequestBodyWithLimit: typeof import("../gateway/http-runtime-helpers").createGatewayHttpRuntimeHelpers extends (
    ...args: never[]
  ) => infer R
    ? R extends { readRequestBodyWithLimit: infer T }
      ? T
      : never
    : never;
  validateParsedRequestBodyShape: typeof import("../gateway/http-runtime-helpers").createGatewayHttpRuntimeHelpers extends (
    ...args: never[]
  ) => infer R
    ? R extends { validateParsedRequestBodyShape: infer T }
      ? T
      : never
    : never;
  resolveConfiguredSystemdUnit: (config: Pick<AppConfig, "systemdUnit">) => string;
  maskSecretValue: (value: string | null) => string | null;
  configureGatewayObservability: typeof import("../observability/gateway").configureGatewayObservability;
  pruneGatewayObservabilityRetentionNow: typeof import("../observability/gateway").pruneGatewayObservabilityRetentionNow;
  bootstrapGatewayObservability: typeof import("../observability/gateway").bootstrapGatewayObservability;
  shutdownGatewayObservability: typeof import("../observability/gateway").shutdownGatewayObservability;
  getInlineApiKeyProviderNames: (configPath?: string) => string[];
  getWorldReadableConfigWarning: (configPath?: string) => string | null;
  logLine: (message: string) => void;
  logWarning: (message: string) => void;
  logStartup: (bindHost: string, port: number, routeCount: number, sourcePath: string) => void;
  logDebug: (message: string) => void;
  readCliStdin: () => Promise<string>;
  getMutableConfigSection: (
    document: Record<string, unknown>,
    key: "models" | "service_providers" | "routes"
  ) => Record<string, unknown>;
  writeConfigJsonDocument: (
    sourcePath: string,
    document: Record<string, unknown>
  ) => void;
  runRouteTestsDetailed: typeof import("../proxy/proxy").runRouteTestsDetailed;
  defaultCliFetchTimeoutMs: number;
  preflightGatewayRouteTests: (configPath?: string) => Promise<
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
        code: AppErrorCode;
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
  >;
  mcpEntityStateErrorCodes: {
    routeNotFound: AppErrorCode;
  };
}): {
  gatewayHealthCommands: ReturnType<typeof createGatewayHealthCommands>;
  gatewayOperatorCommands: ReturnType<typeof createGatewayOperatorCommands>;
  gatewayRuntime: ReturnType<typeof createGatewayRuntime>;
  invokeRuntime: ReturnType<typeof createInvokeRuntime>;
  testRuntime: ReturnType<typeof createTestRuntime>;
  gatewayCli: ReturnType<typeof createGatewayCli>;
  invokeCli: ReturnType<typeof createInvokeCli>;
  testCli: ReturnType<typeof createTestCli>;
  toolCli: ReturnType<typeof createToolCli>;
} {
  const gatewayHealthCommands = createGatewayHealthCommands({
    readLongFlagValue: deps.readLongFlagValue,
    loadConfig: deps.loadConfig,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    buildLocalGatewayAuthHeaders: deps.buildLocalGatewayAuthHeaders,
    resolveSystemdUnitFromDocument: deps.resolveSystemdUnitFromDocument,
    ...deps.cliOutputDeps
  });

  const gatewayOperatorCommands = createGatewayOperatorCommands({
    parseConfigCommandArgs: deps.cliParserDeps.parseConfigCommandArgs,
    parseLogsTailArgs: (argv) => deps.parseLogsTailArgs(argv),
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    resolveSystemdUnitFromDocument: deps.resolveSystemdUnitFromDocument,
    fetchGatewayRuntimeConfigPayload: deps.fetchGatewayRuntimeConfigPayload,
    probeGatewayServiceUnit: gatewayHealthCommands.probeGatewayServiceUnit,
    probeGatewayHealthAtHost: gatewayHealthCommands.probeGatewayHealthAtHost,
    normalizeHealthProbeHost: gatewayHealthCommands.normalizeHealthProbeHost,
    matchesLogFilters: deps.matchesLogFilters,
    reloadConfirmationTimeoutMs: 2_000,
    reloadConfirmationPollIntervalMs: 100,
    ...deps.cliOutputDeps
  });

  const gatewayRuntime = createGatewayRuntime({
    getCliEnv: deps.getCliEnv,
    loadConfig: deps.loadConfig,
    loadCliReadModel: deps.loadCliReadModel,
    normalizeHealthProbeHost: gatewayHealthCommands.normalizeHealthProbeHost,
    buildLocalGatewayAuthHeaders: deps.buildLocalGatewayAuthHeaders,
    resolveLocalGatewayInboundAuthState: deps.resolveLocalGatewayInboundAuthState,
    timingSafeTokenMatches: deps.timingSafeTokenMatches,
    proxyAnthropicMessage: deps.proxyAnthropicMessage,
    proxyChatCompletion: deps.proxyChatCompletion,
    sendJsonError: deps.sendJsonError,
    readRequestBodyWithLimit: deps.readRequestBodyWithLimit,
    validateParsedRequestBodyShape: deps.validateParsedRequestBodyShape,
    resolveConfiguredSystemdUnit: deps.resolveConfiguredSystemdUnit,
    maskSecretValue: deps.maskSecretValue,
    configureGatewayObservability: deps.configureGatewayObservability,
    pruneGatewayObservabilityRetentionNow: deps.pruneGatewayObservabilityRetentionNow,
    bootstrapGatewayObservability: deps.bootstrapGatewayObservability,
    shutdownGatewayObservability: deps.shutdownGatewayObservability,
    getInlineApiKeyProviderNames: deps.getInlineApiKeyProviderNames,
    getWorldReadableConfigWarning: deps.getWorldReadableConfigWarning,
    logLine: deps.logLine,
    logWarning: deps.logWarning,
    logStartup: deps.logStartup,
    logDebug: deps.logDebug,
    defaultRequestBodyIdleTimeoutMs: 5_000,
    defaultReloadConfirmationPollIntervalMs: 100,
    defaultRetentionPruneIntervalMs: 60 * 60 * 1000
  });

  const invokeRuntime = createInvokeRuntime({
    readLongFlagValue: deps.readLongFlagValue,
    printUsageError: deps.cliOutputDeps.printUsageError,
    readCliStdin: deps.readCliStdin,
    loadCliReadModel: deps.loadCliReadModel,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    buildLocalGatewayAuthHeaders: deps.buildLocalGatewayAuthHeaders,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.cliOutputDeps.writeJsonSuccessEnvelope,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeStdout: deps.cliOutputDeps.writeStdout,
    defaultCliFetchTimeoutMs: deps.defaultCliFetchTimeoutMs,
    routeNotFoundCode: deps.mcpEntityStateErrorCodes.routeNotFound
  });

  const testRuntime = createTestRuntime({
    readLongFlagValue: deps.readLongFlagValue,
    printUsageError: deps.cliOutputDeps.printUsageError,
    loadCliReadModel: deps.loadCliReadModel,
    loadConfig: deps.loadConfig,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    getMutableConfigSection: deps.getMutableConfigSection,
    writeConfigJsonDocument: deps.writeConfigJsonDocument,
    normalizeHealthProbeHost: gatewayHealthCommands.normalizeHealthProbeHost,
    buildLocalGatewayAuthHeaders: deps.buildLocalGatewayAuthHeaders,
    preflightGatewayRouteTests: gatewayHealthCommands.preflightGatewayRouteTests,
    runRouteTestsDetailed: deps.runRouteTestsDetailed,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJson: deps.cliOutputDeps.writeJson,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope
  });

  const gatewayCli = createGatewayCli({
    createCliCommandFamilyRegistration: deps.createCliCommandFamilyRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    runHelpAwareCommand: deps.runHelpAwareCommand,
    parseGatewayRunArgs: deps.parseGatewayRunArgs,
    runGatewayRun: async (configPath, options) => {
      await gatewayRuntime.runGatewayRun(configPath, options);
    },
    runRuntimeConfig: async (argv, options) => await gatewayOperatorCommands.runRuntimeConfig(argv, options),
    runLogsCommand: async (argv, options) => await gatewayOperatorCommands.runLogsCommand(argv, options),
    runStatus: async (argv, options) => await gatewayOperatorCommands.runStatus(argv, options),
    runAuth: async (argv, options) => await gatewayOperatorCommands.runAuth(argv, options),
    runReload: async (argv, options) => await gatewayOperatorCommands.runReload(argv, options),
    runGatewayServiceAction: async (argv, action, options) =>
      await gatewayOperatorCommands.runGatewayServiceAction(argv, action, options),
    runHealth: async (argv, options) => await gatewayHealthCommands.runHealth(argv, options),
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout
  });

  const invokeCli = createInvokeCli({
    runHelpAwareCommand: deps.runHelpAwareCommand,
    runInvoke: async (argv) => await invokeRuntime.runInvoke(argv),
    writeStdout: deps.cliOutputDeps.writeStdout
  });

  const testCli = createTestCli({
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    runTestRoutesCommand: async (commandName, argv) => await testRuntime.runTestRoutesCommand(commandName, argv),
    writeStdout: deps.cliOutputDeps.writeStdout
  });

  const toolCli = createToolCli({
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    runHelpAwareCommand: deps.runHelpAwareCommand,
    readLongFlagValue: deps.readLongFlagValue,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    fetchGatewayRuntimeConfigPayload: deps.fetchGatewayRuntimeConfigPayload,
    printUsageError: deps.cliOutputDeps.printUsageError,
    writeStdout: deps.cliOutputDeps.writeStdout,
    writeStderr: deps.cliOutputDeps.writeStderr,
    writeJsonSuccessEnvelope: deps.cliOutputDeps.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: deps.cliOutputDeps.writeJsonErrorEnvelope
  });

  return {
    gatewayHealthCommands,
    gatewayOperatorCommands,
    gatewayRuntime,
    invokeRuntime,
    testRuntime,
    gatewayCli,
    invokeCli,
    testCli,
    toolCli
  };
}
