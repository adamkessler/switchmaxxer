import { type CliCommandRegistration, matchExactCommand } from "./registry";

const TOP_LEVEL_HELP_PREFIX = `Switchmaxxer

Description:
  Runs the Switchmaxxer gateway runtime by default when no arguments are provided.

Usage:
`;

const TOP_LEVEL_HELP_MIDDLE = `
Available commands:
`;

const TOP_LEVEL_HELP_SUFFIX = `
Available flags:
  -h, --help  Show top-level help
  -V, --version  Show version and exit

Exit codes:
  0  Success
  1  Runtime or operational failure; use --json and inspect error.code for machine detail
  2  Usage error, invalid flags, or missing required arguments

Pro tip:
  smx is the official short operator alias for switchmaxxer.
`;

export function buildCliAppRegistries(deps: {
  runCliEntrypoint: (
    commandName: string,
    argv: string[],
    run: (args: string[]) => Promise<number | undefined>
  ) => Promise<number | undefined>;
  printConfigHelp: () => void;
  printGatewayHelp: () => void;
  printTestHelp: () => void;
  printBenchHelp: () => void;
  printModelsHelp: () => void;
  printProvidersHelp: () => void;
  printPruneHelp: () => void;
  printLedgerHelp: () => void;
  printRoutesHelp: () => void;
  printToolHelp: () => void;
  printOptimizeHelp: () => void;
  printTraceHelp: () => void;
  writeMcpHelp: () => void;
  printInvokeHelp: () => void;
  printTopLevelHelp: () => void;
  printVersion: () => void;
  printHelpTopic: (topic: string) => boolean;
  printUsageError: (message: string) => void;
  handleConfigCommand: (argv: string[]) => Promise<number | undefined>;
  handleGatewayCommand: (argv: string[]) => Promise<number | undefined>;
  handleTestCommand: (argv: string[]) => Promise<number | undefined>;
  handleBenchCommand: (argv: string[]) => Promise<number | undefined>;
  handleModelsCommand: (argv: string[]) => Promise<number | undefined>;
  handleProvidersCommand: (argv: string[]) => Promise<number | undefined>;
  handlePruneCommand: (argv: string[]) => Promise<number | undefined>;
  handleLedgerCommand: (argv: string[]) => Promise<number | undefined>;
  handleRoutesCommand: (argv: string[]) => Promise<number | undefined>;
  handleToolCommand: (argv: string[]) => Promise<number | undefined>;
  handleOptimizeCommand: (argv: string[]) => Promise<number | undefined>;
  handleTraceCommand: (argv: string[]) => Promise<number | undefined>;
  handleMcpCommand: (argv: string[]) => Promise<number | undefined>;
  runInvokeCommand: (argv: string[]) => Promise<number | undefined>;
  runDefaultGatewayEntry: () => Promise<number | undefined>;
}): {
  cliCommandRegistry: CliCommandRegistration[];
  globalMetaCommandRegistry: CliCommandRegistration[];
  defaultEntryCommandRegistry: CliCommandRegistration[];
  getTopLevelHelpText: () => string;
} {
  const cliCommandRegistry: CliCommandRegistration[] = [
    {
      name: "config",
      args: "<subcommand> [flags]",
      help: deps.printConfigHelp,
      summary: "Validate configuration",
      usageLines: ["switchmaxxer config <subcommand> [flags]", "switchmaxxer help config"],
      exampleLines: ["switchmaxxer config validate", "switchmaxxer config show"],
      match: matchExactCommand("config"),
      run: async (args) => await deps.runCliEntrypoint("config", args, deps.handleConfigCommand)
    },
    {
      name: "gateway",
      args: "<subcommand> [flags]",
      help: deps.printGatewayHelp,
      summary: "Interact with the live Switchmaxxer gateway runtime",
      usageLines: [
        "switchmaxxer gateway run [--config <path>] [--host <host>] [--port <number>] [--log-level <debug|info|warn|error>]",
        "switchmaxxer gateway <start|stop|restart|status|health|reload> [flags]"
      ],
      exampleLines: ["switchmaxxer", "switchmaxxer gateway status"],
      match: matchExactCommand("gateway"),
      run: async (args) => await deps.runCliEntrypoint("gateway", args, deps.handleGatewayCommand)
    },
    {
      name: "test",
      args: "[flags]",
      help: deps.printTestHelp,
      summary: "Run route tests and exit",
      usageLines: ["switchmaxxer test [--route <route-id>] [--config <path>] [--json] [--no-gateway]"],
      exampleLines: ["switchmaxxer test", "switchmaxxer test --no-gateway"],
      match: matchExactCommand("test"),
      run: async (args) => await deps.runCliEntrypoint("test", args, deps.handleTestCommand)
    },
    {
      name: "bench",
      args: "<subcommand-or-flags>",
      help: deps.printBenchHelp,
      summary: "Benchmark one or more routes",
      usageLines: [
        "switchmaxxer bench [--route <route-id>|--routes <csv>] [--prompt <text>|--file <path>] [--iterations <number>] [--concurrency <number>] [--warmup <number>] [--path <gateway|direct|both>] [--timeout-ms <number>] [--config <path>] [--output <path>] [--json]",
        "switchmaxxer bench <list|show> [flags]"
      ],
      exampleLines: ["switchmaxxer bench --route gpt-4o-mini --prompt \"hello\"", "switchmaxxer bench list"],
      match: matchExactCommand("bench"),
      run: async (args) => await deps.runCliEntrypoint("bench", args, deps.handleBenchCommand)
    },
    {
      name: "models",
      args: "<subcommand> [flags]",
      help: deps.printModelsHelp,
      summary: "Inspect canonical models",
      usageLines: ["switchmaxxer models <list|show|create|update|delete> [flags]"],
      exampleLines: ["switchmaxxer models list", "switchmaxxer models show gpt-4o-mini"],
      match: matchExactCommand("models"),
      run: async (args) => await deps.runCliEntrypoint("models", args, deps.handleModelsCommand)
    },
    {
      name: "providers",
      args: "<subcommand> [flags]",
      help: deps.printProvidersHelp,
      summary: "Inspect configured service providers",
      usageLines: ["switchmaxxer providers <list|show|create|update|delete|set-key|clear-key|set-key-env> [flags]"],
      exampleLines: ["switchmaxxer providers list", "switchmaxxer providers show provider_id"],
      match: matchExactCommand("providers"),
      run: async (args) => await deps.runCliEntrypoint("providers", args, deps.handleProvidersCommand)
    },
    {
      name: "prune",
      args: "[flags]",
      help: deps.printPruneHelp,
      summary: "Apply observability-store retention",
      usageLines: ["switchmaxxer prune --older-than <duration> [--json]", "switchmaxxer prune --config <path> [--json]"],
      exampleLines: ["switchmaxxer prune --older-than 30d", "switchmaxxer prune --config ./config.json --json"],
      match: matchExactCommand("prune"),
      run: async (args) => await deps.runCliEntrypoint("prune", args, deps.handlePruneCommand)
    },
    {
      name: "ledger",
      args: "<subcommand> [flags]",
      help: deps.printLedgerHelp,
      summary: "Inspect Control Plane Audit Ledger events",
      usageLines: [
        "switchmaxxer ledger list [--route <route-id>] [--status <status>] [--json]",
        "switchmaxxer ledger show <ledger-event-id> [--json]"
      ],
      exampleLines: ["switchmaxxer ledger list --status failed", "switchmaxxer ledger show ledger-event-id --json"],
      match: matchExactCommand("ledger"),
      run: async (args) => await deps.runCliEntrypoint("ledger", args, deps.handleLedgerCommand)
    },
    {
      name: "routes",
      args: "<subcommand> [flags]",
      help: deps.printRoutesHelp,
      summary: "Inspect configured routes",
      usageLines: ["switchmaxxer routes <list|show|create|update|delete|explain> [flags]"],
      exampleLines: ["switchmaxxer routes list", "switchmaxxer routes explain route_id"],
      match: matchExactCommand("routes"),
      run: async (args) => await deps.runCliEntrypoint("routes", args, deps.handleRoutesCommand)
    },
    {
      name: "tool",
      args: "<subcommand> [flags]",
      help: deps.printToolHelp,
      summary: "Run built-in operator and developer tools",
      usageLines: ["switchmaxxer tool <date|uptime|random> [flags]"],
      exampleLines: ["switchmaxxer tool date", "switchmaxxer tool uptime --json"],
      match: matchExactCommand("tool"),
      run: async (args) => await deps.runCliEntrypoint("tool", args, deps.handleToolCommand)
    },
    {
      name: "optimize",
      args: "<subcommand-or-flags>",
      help: deps.printOptimizeHelp,
      summary: "Recommend, apply, or restore a route provider for a model",
      usageLines: [
        "switchmaxxer optimize --model <model-id> --objective cost [flags]",
        "switchmaxxer optimize --model <model-id> --objective latency [flags]",
        "switchmaxxer optimize <list|show|apply|restore> [flags]"
      ],
      exampleLines: ["switchmaxxer optimize --model gpt-4o-mini --objective cost"],
      match: matchExactCommand("optimize"),
      run: async (args) => await deps.runCliEntrypoint("optimize", args, deps.handleOptimizeCommand)
    },
    {
      name: "trace",
      args: "<subcommand> [flags]",
      help: deps.printTraceHelp,
      summary: "Inspect recorded invocation traces",
      usageLines: ["switchmaxxer trace <list|stats|observations|show|verify|repair> [flags]"],
      exampleLines: ["switchmaxxer trace list", "switchmaxxer trace verify --all"],
      match: matchExactCommand("trace"),
      run: async (args) => await deps.runCliEntrypoint("trace", args, deps.handleTraceCommand)
    },
    {
      name: "mcp",
      args: "<subcommand> [flags]",
      help: deps.writeMcpHelp,
      summary: "Run the Switchmaxxer MCP stdio server",
      usageLines: ["switchmaxxer mcp serve [--config <path>]"],
      exampleLines: ["switchmaxxer mcp serve"],
      match: matchExactCommand("mcp"),
      run: async (args) => await deps.runCliEntrypoint("mcp", args, deps.handleMcpCommand)
    },
    {
      name: "invoke",
      args: "[flags]",
      help: deps.printInvokeHelp,
      summary: "Send one-off requests through the Switchmaxxer gateway",
      usageLines: [
        "switchmaxxer invoke --route <route-id> [--api <openai|anthropic|auto>] [--prompt <text>|--stdin|--file <path>] [--system <text>] [--stream] [--inspect [--include-secrets]] [--temperature <number>] [--max-tokens <number>] [--timeout-ms <number>] [--config <path>] [--json]"
      ],
      exampleLines: ["switchmaxxer invoke --route gpt-4o-mini --prompt \"hello\""],
      match: matchExactCommand("invoke"),
      run: async (args) => await deps.runCliEntrypoint("invoke", args, deps.runInvokeCommand)
    }
  ];

  const globalMetaCommandRegistry: CliCommandRegistration[] = [
    {
      name: "--help",
      summary: "Show top-level help",
      usageLines: ["switchmaxxer [--help|-h]"],
      exampleLines: ["switchmaxxer --help"],
      match: (argv: string[]) => (argv[0] === "--help" || argv[0] === "-h" ? argv.slice(1) : null),
      run: async (args) => await deps.runCliEntrypoint("help", args, async () => {
        deps.printTopLevelHelp();
        return 0;
      })
    },
    {
      name: "version",
      summary: "Show version and exit",
      usageLines: ["switchmaxxer [--version|-V]", "switchmaxxer version"],
      exampleLines: ["switchmaxxer --version"],
      match: (argv: string[]) =>
        argv[0] === "--version" || argv[0] === "-V" || argv[0] === "version" ? argv.slice(1) : null,
      run: async (args) => await deps.runCliEntrypoint("version", args, async () => {
        deps.printVersion();
        return 0;
      })
    },
    {
      name: "help",
      summary: "Show top-level help or help for a supported command",
      usageLines: ["switchmaxxer help [command]"],
      exampleLines: ["switchmaxxer help help"],
      match: matchExactCommand("help"),
      run: async (args) => await deps.runCliEntrypoint("help", args, async (innerArgs) => {
        const [topic] = innerArgs;

        if (typeof topic === "undefined") {
          deps.printTopLevelHelp();
          return 0;
        }

        if (deps.printHelpTopic(topic)) {
          return 0;
        }

        deps.printUsageError(`Unknown help topic '${topic}'`);
        return 2;
      })
    }
  ];

  const defaultEntryCommandRegistry: CliCommandRegistration[] = [
    {
      name: "__default_gateway_run__",
      commandName: "gateway run",
      summary: "Run the live gateway in the foreground",
      match: (argv: string[]) => (argv.length === 0 ? [] : null),
      run: async (args) =>
        (await deps.runCliEntrypoint("gateway run", args, async () => (await deps.runDefaultGatewayEntry()) ?? 0)) ?? 0
    }
  ];

  const getTopLevelHelpText = (): string => {
    const registryCommands = cliCommandRegistry
      .filter((command) => command.showInHelp !== false && typeof command.summary === "string")
      .map((command) => ({
        name: command.name,
        summary: command.summary as string
      }));
    const commands = [
      { name: "help", summary: "Show top-level help or help for a supported command" },
      ...registryCommands,
      { name: "version", summary: "Show version and exit" }
    ];
    const widestName = commands.reduce((max, command) => Math.max(max, command.name.length), 0);
    const usageLines = [
      "switchmaxxer",
      "switchmaxxer [--help|-h]",
      "switchmaxxer [--version|-V]",
      "switchmaxxer help [command]",
      ...cliCommandRegistry.filter((command) => command.showInHelp !== false).flatMap((command) => command.usageLines ?? [])
    ].map((line) => `  ${line}`);
    const exampleLines = [
      "switchmaxxer --help",
      "switchmaxxer --version",
      "switchmaxxer help help",
      ...cliCommandRegistry.filter((command) => command.showInHelp !== false).flatMap((command) => command.exampleLines ?? [])
    ].map((line) => `  ${line}`);

    return `${TOP_LEVEL_HELP_PREFIX}${usageLines.join("\n")}${TOP_LEVEL_HELP_MIDDLE}${commands
      .map((command) => `  ${command.name.padEnd(widestName)}  ${command.summary}`)
      .join("\n")}${TOP_LEVEL_HELP_SUFFIX}

Examples:
${exampleLines.join("\n")}

Pro tip:
  smx is the official short operator alias for switchmaxxer.
`;
  };

  return {
    cliCommandRegistry,
    globalMetaCommandRegistry,
    defaultEntryCommandRegistry,
    getTopLevelHelpText
  };
}
