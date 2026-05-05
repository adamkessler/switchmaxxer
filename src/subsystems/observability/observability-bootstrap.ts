import { createBenchCli } from "../cli/commands/bench";
import { createLedgerCli } from "../cli/commands/ledger";
import { createPruneCli } from "../cli/commands/prune";
import { createTraceCli } from "../cli/commands/trace";

type BenchCliDeps = Parameters<typeof createBenchCli>[0];
type LedgerCliDeps = Parameters<typeof createLedgerCli>[0];
type PruneCliDeps = Parameters<typeof createPruneCli>[0];
type TraceCliDeps = Parameters<typeof createTraceCli>[0];

export interface ObservabilityBootstrapDeps {
  registrationDeps: {
    createCliCommandRegistration: BenchCliDeps["createCliCommandRegistration"];
    runRegisteredCommandFamily: BenchCliDeps["runRegisteredCommandFamily"];
  };
  cliOutputDeps: {
    printUsageError: BenchCliDeps["printUsageError"];
    writeStdout: BenchCliDeps["writeStdout"];
    writeStderr: BenchCliDeps["writeStderr"];
    writeJsonErrorEnvelope: BenchCliDeps["writeJsonErrorEnvelope"];
    writeJsonSuccessEnvelope: BenchCliDeps["writeJsonSuccessEnvelope"];
  };
  benchDeps: Omit<
    BenchCliDeps,
    | "createCliCommandRegistration"
    | "runRegisteredCommandFamily"
    | "printUsageError"
    | "writeStdout"
    | "writeStderr"
    | "writeJsonErrorEnvelope"
    | "writeJsonSuccessEnvelope"
  >;
  traceDeps: Omit<
    TraceCliDeps,
    | "createCliCommandRegistration"
    | "runRegisteredCommandFamily"
    | "printUsageError"
    | "writeStdout"
    | "writeStderr"
    | "writeJsonErrorEnvelope"
    | "writeJsonSuccessEnvelope"
  >;
  ledgerDeps: Omit<
    LedgerCliDeps,
    | "createCliCommandRegistration"
    | "runRegisteredCommandFamily"
    | "printUsageError"
    | "writeStdout"
    | "writeStderr"
    | "writeJsonErrorEnvelope"
    | "writeJsonSuccessEnvelope"
  >;
  pruneDeps: Omit<
    PruneCliDeps,
    | "printUsageError"
    | "writeStdout"
    | "writeStderr"
    | "writeJsonErrorEnvelope"
    | "writeJsonSuccessEnvelope"
  >;
}

export function createObservabilityBootstrap(rawDeps: ObservabilityBootstrapDeps) {
  const deps = {
    ...rawDeps.registrationDeps,
    ...rawDeps.cliOutputDeps,
    ...rawDeps.benchDeps,
    ...rawDeps.traceDeps,
    ...rawDeps.pruneDeps
  };
  const benchCli = createBenchCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJson: deps.writeJson,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    assertBenchmarkPromptLength: deps.assertBenchmarkPromptLength,
    benchLimits: deps.benchLimits,
    defaultCliFetchTimeoutMs: deps.defaultCliFetchTimeoutMs,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    openObservabilityService: deps.openObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath,
    loadConfig: deps.loadConfig,
    preflightGatewayRouteTests: deps.preflightGatewayRouteTests,
    resolveBenchmarkExecutionPlan: deps.resolveBenchmarkExecutionPlan,
    buildBenchTasks: deps.buildBenchTasks,
    executeBenchmarkTask: deps.executeBenchmarkTask,
    runTasksWithConcurrency: deps.runTasksWithConcurrency,
    toBenchmarkRunView: deps.toBenchmarkRunView,
    toBenchmarkSampleView: deps.toBenchmarkSampleView,
    buildBenchmarkReportView: deps.buildBenchmarkReportView,
    classifyCliUsageFailure: deps.classifyCliUsageFailure,
    noUsageMessageMatch: deps.noUsageMessageMatch,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes,
    mcpEntityStateErrorCodes: deps.mcpEntityStateErrorCodes,
    createCliUsageError: deps.createCliUsageError
  });

  const traceCli = createTraceCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    getCliEnv: deps.getCliEnv,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    toTraceSummaryView: deps.toTraceSummaryView,
    toTraceObservationView: deps.toTraceObservationView,
    toBenchmarkSampleView: deps.toBenchmarkSampleView,
    observationOutcomes: deps.observationOutcomes,
    observationKinds: deps.observationKinds,
    observationEvents: deps.observationEvents
  });

  const ledgerCli = createLedgerCli({
    createCliCommandRegistration: deps.createCliCommandRegistration,
    runRegisteredCommandFamily: deps.runRegisteredCommandFamily,
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath
  });

  const pruneCli = createPruneCli({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath,
    resolveConfiguredObservabilityRetentionOlderThan: deps.resolveConfiguredObservabilityRetentionOlderThan,
    retentionDurationToCutoffIso: deps.retentionDurationToCutoffIso,
    resolveCliConfigPath: deps.resolveCliConfigPath
  });

  return {
    benchCli,
    ledgerCli,
    pruneCli,
    traceCli
  };
}
