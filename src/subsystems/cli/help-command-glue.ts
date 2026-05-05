import type { CliCommandRegistration } from "./registry";
import { getPackageVersion } from "../../platform/package-version";

type CommandFamily = {
  getHelpText: () => string;
  printHelp?: () => void;
  handleCommand?: (argv: string[]) => Promise<number | undefined>;
};

type RegistryCommandFamily = CommandFamily & {
  getCommandRegistry: () => CliCommandRegistration[];
};

type GatewayCommandFamily = CommandFamily & {
  printHelp: () => void;
  handleCommand: (argv: string[]) => Promise<number | undefined>;
  getRuntimeCommandRegistry: () => CliCommandRegistration[];
  getLogsCommandRegistry: () => CliCommandRegistration[];
  getLeafCommandRegistry: () => CliCommandRegistration[];
};

export function createCliHelpCommandGlue(deps: {
  configCli: RegistryCommandFamily;
  modelsCli: RegistryCommandFamily;
  providersCli: RegistryCommandFamily;
  pruneCli: CommandFamily & {
    printHelp: () => void;
    handleCommand: (argv: string[]) => Promise<number | undefined>;
  };
  ledgerCli: RegistryCommandFamily;
  traceCli: RegistryCommandFamily;
  routesCli: RegistryCommandFamily;
  testCli: CommandFamily & {
    printHelp: () => void;
    handleCommand: (argv: string[]) => Promise<number | undefined>;
  };
  gatewayCli: GatewayCommandFamily;
  invokeCli: CommandFamily & {
    printHelp: () => void;
  };
  mcpCli: RegistryCommandFamily;
  toolCli: RegistryCommandFamily;
  benchCli: RegistryCommandFamily;
  optimizeCli: RegistryCommandFamily;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  getTopLevelHelpText: () => string;
  getCliCommandRegistry: () => CliCommandRegistration[];
}) {
  const registryCommandFamilies = {
    config: deps.configCli,
    bench: deps.benchCli,
    ledger: deps.ledgerCli,
    models: deps.modelsCli,
    providers: deps.providersCli,
    routes: deps.routesCli,
    tool: deps.toolCli,
    optimize: deps.optimizeCli,
    trace: deps.traceCli,
    mcp: deps.mcpCli
  } satisfies Record<string, RegistryCommandFamily>;

  const helpTopicFamilies: Record<string, CommandFamily> = {
    gateway: deps.gatewayCli,
    invoke: deps.invokeCli,
    prune: deps.pruneCli,
    test: deps.testCli,
    ...registryCommandFamilies
  };

  function getHelpTopicNames(): string[] {
    const visibleCommandTopics = deps
      .getCliCommandRegistry()
      .filter((command) => command.showInHelp !== false)
      .map((command) => command.name);

    return [...new Set(["help", ...visibleCommandTopics, "version"])];
  }

  function getHelpHelpText(): string {
    const topics = getHelpTopicNames();
    return `switchmaxxer help

Usage:
  switchmaxxer help
  switchmaxxer help <command>

Description:
  Shows top-level help or help for a supported command.

Currently supported help topics:
${topics.map((topic) => `  ${topic}`).join("\n")}

Examples:
  switchmaxxer help
${topics
  .filter((topic) => topic !== "help")
  .map((topic) => `  switchmaxxer help ${topic}`)
  .join("\n")}

Pro tip:
  smx help is the official short operator alias form.
`;
  }

  function getVersionHelpText(): string {
    return `switchmaxxer version

Usage:
  switchmaxxer version
  switchmaxxer --version
  switchmaxxer -V

Description:
  Prints the current Switchmaxxer version and exits.

Examples:
  switchmaxxer version
  switchmaxxer --version

Pro tip:
  smx version is the official short operator alias form.
`;
  }

  function getHelpTopicText(topic: string): string | null {
    if (topic === "help") {
      return getHelpHelpText();
    }

    if (topic === "version") {
      return getVersionHelpText();
    }

    const family = helpTopicFamilies[topic];
    return family ? family.getHelpText() : null;
  }

  function printTopLevelHelp(): void {
    deps.writeStdout(deps.getTopLevelHelpText());
  }

  function printVersion(): void {
    deps.writeStdout(`switchmaxxer ${getPackageVersion()}`);
  }

  function printHelpText(getText: () => string): void {
    deps.writeStdout(getText());
  }

  function printHelpTopic(topic: string): boolean {
    if (!getHelpTopicNames().includes(topic)) {
      return false;
    }

    const text = getHelpTopicText(topic);
    if (text === null) {
      return false;
    }

    deps.writeStdout(text);
    return true;
  }

  function printUsageError(message: string): void {
    deps.writeStderr(`Error: ${message}`);
    deps.writeStderr("");
    deps.writeStderr(deps.getTopLevelHelpText());
  }

  function getCommandRegistry(topic: keyof typeof registryCommandFamilies): CliCommandRegistration[] {
    return registryCommandFamilies[topic].getCommandRegistry();
  }

  async function handleRegistryCommand(topic: keyof typeof registryCommandFamilies, argv: string[]): Promise<number | undefined> {
    return await registryCommandFamilies[topic].handleCommand!(argv);
  }

  return {
    getMcpCliHelpText: () => deps.mcpCli.getHelpText(),
    printTopLevelHelp,
    printVersion,
    printGatewayHelp: () => printHelpText(deps.gatewayCli.getHelpText),
    printInvokeHelp: () => printHelpText(deps.invokeCli.getHelpText),
    printToolHelp: () => printHelpText(deps.toolCli.getHelpText),
    printBenchHelp: () => printHelpText(deps.benchCli.getHelpText),
    printLedgerHelp: () => printHelpText(deps.ledgerCli.getHelpText),
    printOptimizeHelp: () => printHelpText(deps.optimizeCli.getHelpText),
    printConfigHelp: () => printHelpText(deps.configCli.getHelpText),
    printModelsHelp: () => printHelpText(deps.modelsCli.getHelpText),
    printProvidersHelp: () => printHelpText(deps.providersCli.getHelpText),
    printPruneHelp: () => printHelpText(deps.pruneCli.getHelpText),
    printRoutesHelp: () => printHelpText(deps.routesCli.getHelpText),
    printTestHelp: () => printHelpText(deps.testCli.getHelpText),
    printTraceHelp: () => printHelpText(deps.traceCli.getHelpText),
    printHelpTopic,
    printUsageError,
    handleGatewayCommand: async (argv: string[]) => await deps.gatewayCli.handleCommand(argv),
    handleTestCommand: async (argv: string[]) => await deps.testCli.handleCommand(argv),
    handleBenchCommand: async (argv: string[]) => await handleRegistryCommand("bench", argv),
    handleLedgerCommand: async (argv: string[]) => await handleRegistryCommand("ledger", argv),
    handleConfigCommand: async (argv: string[]) => await handleRegistryCommand("config", argv),
    handleModelsCommand: async (argv: string[]) => await handleRegistryCommand("models", argv),
    handleProvidersCommand: async (argv: string[]) => await handleRegistryCommand("providers", argv),
    handlePruneCommand: async (argv: string[]) => await deps.pruneCli.handleCommand(argv),
    handleRoutesCommand: async (argv: string[]) => await handleRegistryCommand("routes", argv),
    handleToolCommand: async (argv: string[]) => await handleRegistryCommand("tool", argv),
    handleOptimizeCommand: async (argv: string[]) => await handleRegistryCommand("optimize", argv),
    handleTraceCommand: async (argv: string[]) => await handleRegistryCommand("trace", argv),
    handleMcpCommand: async (argv: string[]) => await handleRegistryCommand("mcp", argv),
    getGatewayRuntimeCommandRegistry: () => deps.gatewayCli.getRuntimeCommandRegistry(),
    getGatewayLogsCommandRegistry: () => deps.gatewayCli.getLogsCommandRegistry(),
    getGatewayLeafCommandRegistry: () => deps.gatewayCli.getLeafCommandRegistry(),
    getBenchCommandRegistry: () => getCommandRegistry("bench"),
    getLedgerCommandRegistry: () => getCommandRegistry("ledger"),
    getConfigCommandRegistry: () => getCommandRegistry("config"),
    getModelsCommandRegistry: () => getCommandRegistry("models"),
    getProvidersCommandRegistry: () => getCommandRegistry("providers"),
    getRoutesCommandRegistry: () => getCommandRegistry("routes"),
    getToolCommandRegistry: () => getCommandRegistry("tool"),
    getOptimizeCommandRegistry: () => getCommandRegistry("optimize"),
    getTraceCommandRegistry: () => getCommandRegistry("trace"),
    getMcpCommandRegistry: () => getCommandRegistry("mcp")
  };
}
