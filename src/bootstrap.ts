import { buildCliAppRegistries } from "./subsystems/cli/app-registry";
import { createCliHelpCommandGlue } from "./subsystems/cli/help-command-glue";
import type { CliCommandRegistration } from "./subsystems/cli/registry";

type CommandFamily = {
  getHelpText: () => string;
  printHelp: () => void;
  handleCommand: (argv: string[]) => Promise<number | undefined>;
};

type RegistryCommandFamily = CommandFamily & {
  getCommandRegistry: () => CliCommandRegistration[];
};

type GatewayCommandFamily = CommandFamily & {
  getRuntimeCommandRegistry: () => CliCommandRegistration[];
  getLogsCommandRegistry: () => CliCommandRegistration[];
  getLeafCommandRegistry: () => CliCommandRegistration[];
};

type InvokeCommandFamily = {
  getHelpText: () => string;
  printHelp: () => void;
  runInvokeCommand: (argv: string[]) => Promise<number | undefined>;
};

export function createSwitchmaxxerContainer(deps: {
  configCli: RegistryCommandFamily;
  modelsCli: RegistryCommandFamily;
  providersCli: RegistryCommandFamily;
  pruneCli: CommandFamily;
  ledgerCli: RegistryCommandFamily;
  traceCli: RegistryCommandFamily;
  routesCli: RegistryCommandFamily;
  testCli: CommandFamily;
  gatewayCli: GatewayCommandFamily;
  invokeCli: InvokeCommandFamily;
  mcpCli: RegistryCommandFamily;
  toolCli: RegistryCommandFamily;
  benchCli: RegistryCommandFamily;
  optimizeCli: RegistryCommandFamily;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  printUsageError: (message: string) => void;
  runCliEntrypoint: (
    commandName: string,
    argv: string[],
    run: (args: string[]) => Promise<number | undefined>
  ) => Promise<number | undefined>;
  runDefaultGatewayEntry: () => Promise<number | undefined>;
}) {
  const cliHelp = createCliHelpCommandGlue({
    configCli: deps.configCli,
    modelsCli: deps.modelsCli,
    providersCli: deps.providersCli,
    pruneCli: deps.pruneCli,
    ledgerCli: deps.ledgerCli,
    traceCli: deps.traceCli,
    routesCli: deps.routesCli,
    testCli: deps.testCli,
    gatewayCli: deps.gatewayCli,
    invokeCli: deps.invokeCli,
    mcpCli: deps.mcpCli,
    toolCli: deps.toolCli,
    benchCli: deps.benchCli,
    optimizeCli: deps.optimizeCli,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    getTopLevelHelpText: () => registries.getTopLevelHelpText(),
    getCliCommandRegistry: () => registries.cliCommandRegistry
  });

  const registries = buildCliAppRegistries({
    runCliEntrypoint: deps.runCliEntrypoint,
    printConfigHelp: cliHelp.printConfigHelp,
    printGatewayHelp: cliHelp.printGatewayHelp,
    printTestHelp: cliHelp.printTestHelp,
    printBenchHelp: cliHelp.printBenchHelp,
    printModelsHelp: cliHelp.printModelsHelp,
    printProvidersHelp: cliHelp.printProvidersHelp,
    printPruneHelp: cliHelp.printPruneHelp,
    printLedgerHelp: cliHelp.printLedgerHelp,
    printRoutesHelp: cliHelp.printRoutesHelp,
    printToolHelp: cliHelp.printToolHelp,
    printOptimizeHelp: cliHelp.printOptimizeHelp,
    printTraceHelp: cliHelp.printTraceHelp,
    writeMcpHelp: () => deps.writeStdout(cliHelp.getMcpCliHelpText()),
    printInvokeHelp: cliHelp.printInvokeHelp,
    printTopLevelHelp: cliHelp.printTopLevelHelp,
    printVersion: cliHelp.printVersion,
    printHelpTopic: cliHelp.printHelpTopic,
    printUsageError: deps.printUsageError,
    handleConfigCommand: cliHelp.handleConfigCommand,
    handleGatewayCommand: cliHelp.handleGatewayCommand,
    handleTestCommand: cliHelp.handleTestCommand,
    handleBenchCommand: cliHelp.handleBenchCommand,
    handleModelsCommand: cliHelp.handleModelsCommand,
    handleProvidersCommand: cliHelp.handleProvidersCommand,
    handlePruneCommand: cliHelp.handlePruneCommand,
    handleLedgerCommand: cliHelp.handleLedgerCommand,
    handleRoutesCommand: cliHelp.handleRoutesCommand,
    handleToolCommand: cliHelp.handleToolCommand,
    handleOptimizeCommand: cliHelp.handleOptimizeCommand,
    handleTraceCommand: cliHelp.handleTraceCommand,
    handleMcpCommand: cliHelp.handleMcpCommand,
    runInvokeCommand: async (args) => await deps.invokeCli.runInvokeCommand(args),
    runDefaultGatewayEntry: deps.runDefaultGatewayEntry
  });

  return {
    cliHelp,
    registries,
    getTopLevelHelpText: registries.getTopLevelHelpText
  };
}
