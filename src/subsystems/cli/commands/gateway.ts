import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import type { LogLevel } from "../../../platform/types";

type GatewayRunArgs = {
  configPath?: string;
  host?: string;
  port?: number;
  logLevel?: LogLevel;
  errorMessage?: string;
};

export function createGatewayCli(deps: {
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
  runHelpAwareCommand: (
    argv: string[],
    options: {
      help: () => void;
      run: (args: string[]) => Promise<number>;
      helpOnEmpty?: boolean;
    }
  ) => Promise<number | undefined>;
  parseGatewayRunArgs: (argv: string[]) => GatewayRunArgs;
  runGatewayRun: (
    configPath?: string,
    options?: {
      host?: string;
      port?: number;
      logLevel?: LogLevel;
    }
  ) => Promise<void>;
  runRuntimeConfig: (
    argv: string[],
    options: {
      commandName: "gateway runtime config" | "runtime config";
    }
  ) => Promise<number>;
  runLogsCommand: (
    argv: string[],
    options: {
      commandName: "gateway logs tail" | "gateway logs show" | "logs tail" | "logs show";
      allowFollow: boolean;
    }
  ) => Promise<number>;
  runStatus: (
    argv: string[],
    options: {
      commandName: "status" | "gateway status";
    }
  ) => Promise<number>;
  runAuth: (
    argv: string[],
    options: {
      commandName: "auth" | "gateway auth";
    }
  ) => Promise<number>;
  runReload: (
    argv: string[],
    options: {
      commandName: "reload" | "gateway reload";
    }
  ) => Promise<number>;
  runGatewayServiceAction: (
    argv: string[],
    action: "restart" | "start" | "stop" | "enable" | "disable",
    options: {
      commandName: "gateway restart" | "gateway start" | "gateway stop" | "gateway enable" | "gateway disable";
    }
  ) => Promise<number>;
  runHealth: (
    argv: string[],
    options: {
      commandName: "health" | "gateway health";
    }
  ) => Promise<number>;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getLeafCommandRegistry: () => CliCommandRegistration[];
  getRuntimeCommandRegistry: () => CliCommandRegistration[];
  getLogsCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function prefixCommandRegistrations(prefix: string, commands: CliCommandRegistration[]): CliCommandRegistration[] {
    return commands.map((command) => ({
      ...command,
      name: `${prefix} ${command.name}`
    }));
  }

  function createHelpAwareLeafCommand(
    help: () => void,
    run: (argv: string[]) => Promise<number>
  ): (argv: string[]) => Promise<number | undefined> {
    return async (argv: string[]) =>
      await deps.runHelpAwareCommand(argv, {
        help,
        run: async (leafArgs) => await run(leafArgs)
      });
  }

  function createGatewayHelpAwareLeafCommand(
    run: (argv: string[]) => Promise<number>
  ): (argv: string[]) => Promise<number | undefined> {
    return createHelpAwareLeafCommand(printHelp, run);
  }

  function getRuntimeCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "config",
        summary: "Show the live gateway runtime config",
        usageLines: ["switchmaxxer gateway runtime config [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer gateway runtime config"],
        match: matchExactCommand("config"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runRuntimeConfig(leafArgs, {
              commandName: "gateway runtime config"
            })
        )
      }
    ];
  }

  function getLogsCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "tail",
        summary: "Tail live gateway logs",
        usageLines: [
          "switchmaxxer gateway logs tail [--lines <number>] [--since <timestamp>] [--format <text|json>] [--route <route-id>] [--provider <provider-id>] [--follow]"
        ],
        exampleLines: ["switchmaxxer gateway logs tail"],
        match: matchExactCommand("tail"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runLogsCommand(leafArgs, {
              commandName: "gateway logs tail",
              allowFollow: true
            })
        )
      },
      {
        name: "show",
        summary: "Show recent gateway logs",
        usageLines: [
          "switchmaxxer gateway logs show [--lines <number>] [--since <timestamp>] [--format <text|json>] [--route <route-id>] [--provider <provider-id>]"
        ],
        exampleLines: ["switchmaxxer gateway logs show --format json --lines 100"],
        match: matchExactCommand("show"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runLogsCommand(leafArgs, {
              commandName: "gateway logs show",
              allowFollow: false
            })
        )
      }
    ];
  }

  function getLeafCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "run",
        summary: "Run the live gateway in the foreground",
        usageLines: [
          "switchmaxxer gateway run [--config <path>] [--host <host>] [--port <number>] [--log-level <debug|info|warn|error>]"
        ],
        exampleLines: [
          "switchmaxxer gateway run",
          "switchmaxxer gateway run --config ./config.json",
          "switchmaxxer gateway run --host 127.0.0.1 --port 4081",
          "switchmaxxer gateway run --log-level debug"
        ],
        match: matchExactCommand("run"),
        run: createGatewayHelpAwareLeafCommand(async (leafArgs) => {
          const parsedArgs = deps.parseGatewayRunArgs(leafArgs);

          if (parsedArgs.errorMessage) {
            deps.printUsageError(parsedArgs.errorMessage);
            return 2;
          }

          await deps.runGatewayRun(parsedArgs.configPath, {
            host: parsedArgs.host,
            port: parsedArgs.port,
            logLevel: parsedArgs.logLevel
          });
          return 0;
        })
      },
      {
        name: "status",
        summary: "Show gateway service status",
        usageLines: ["switchmaxxer gateway status [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer gateway status --json"],
        match: matchExactCommand("status"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runStatus(leafArgs, {
              commandName: "gateway status"
            })
        )
      },
      {
        name: "auth",
        summary: "Diagnose inbound gateway auth configuration",
        usageLines: ["switchmaxxer gateway auth [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer gateway auth --json"],
        match: matchExactCommand("auth"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runAuth(leafArgs, {
              commandName: "gateway auth"
            })
        )
      },
      {
        name: "reload",
        summary: "Reload the managed gateway service",
        usageLines: ["switchmaxxer gateway reload [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer gateway reload", "switchmaxxer gateway reload --config ./config.json"],
        match: matchExactCommand("reload"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runReload(leafArgs, {
              commandName: "gateway reload"
            })
        )
      },
      {
        name: "restart",
        summary: "Restart the managed gateway service",
        usageLines: ["switchmaxxer gateway restart [--json]"],
        exampleLines: ["switchmaxxer gateway restart"],
        match: matchExactCommand("restart"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runGatewayServiceAction(leafArgs, "restart", {
              commandName: "gateway restart"
            })
        )
      },
      {
        name: "start",
        summary: "Start the managed gateway service",
        usageLines: ["switchmaxxer gateway start [--json]"],
        exampleLines: ["switchmaxxer gateway start"],
        match: matchExactCommand("start"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runGatewayServiceAction(leafArgs, "start", {
              commandName: "gateway start"
            })
        )
      },
      {
        name: "stop",
        summary: "Stop the managed gateway service",
        usageLines: ["switchmaxxer gateway stop [--json]"],
        exampleLines: ["switchmaxxer gateway stop"],
        match: matchExactCommand("stop"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runGatewayServiceAction(leafArgs, "stop", {
              commandName: "gateway stop"
            })
        )
      },
      {
        name: "enable",
        summary: "Enable the managed gateway service",
        usageLines: ["switchmaxxer gateway enable [--json]"],
        exampleLines: ["switchmaxxer gateway enable"],
        match: matchExactCommand("enable"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runGatewayServiceAction(leafArgs, "enable", {
              commandName: "gateway enable"
            })
        )
      },
      {
        name: "disable",
        summary: "Disable the managed gateway service",
        usageLines: ["switchmaxxer gateway disable [--json]"],
        exampleLines: ["switchmaxxer gateway disable"],
        match: matchExactCommand("disable"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runGatewayServiceAction(leafArgs, "disable", {
              commandName: "gateway disable"
            })
        )
      },
      {
        name: "health",
        summary: "Probe gateway health",
        usageLines: [
          "switchmaxxer gateway health [--config <path>] [--json] [--check <gateway|config|providers|routes|all>] [--timeout-ms <number>]"
        ],
        exampleLines: ["switchmaxxer gateway health --check gateway"],
        match: matchExactCommand("health"),
        run: createGatewayHelpAwareLeafCommand(
          async (leafArgs) =>
            await deps.runHealth(leafArgs, {
              commandName: "gateway health"
            })
        )
      },
      deps.createCliCommandFamilyRegistration({
        name: "runtime",
        commandName: "gateway runtime",
        help: printHelp,
        summary: "Inspect gateway runtime subcommands",
        commands: getRuntimeCommandRegistry(),
        missingSubcommandMessage: "Missing required gateway runtime subcommand 'config'",
        match: matchExactCommand("runtime")
      }),
      deps.createCliCommandFamilyRegistration({
        name: "logs",
        commandName: "gateway logs",
        help: printHelp,
        summary: "Read gateway log subcommands",
        commands: getLogsCommandRegistry(),
        missingSubcommandMessage: "Missing required gateway logs subcommand 'tail' or 'show'",
        match: matchExactCommand("logs")
      })
    ];
  }

  function getHelpText(): string {
    const gatewayHelpCommands = [
      ...getLeafCommandRegistry(),
      ...prefixCommandRegistrations("runtime", getRuntimeCommandRegistry()),
      ...prefixCommandRegistrations("logs", getLogsCommandRegistry())
    ];

    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer gateway",
      description:
        "The gateway is the live Switchmaxxer runtime: the long-running server that listens for requests, resolves routes, proxies traffic to upstream providers, and exposes runtime inspection and health surfaces.",
      commands: gatewayHelpCommands,
      docsPath: "docs/subsystems/gateway/tech-spec-for-gateway.md",
      proTip: "smx gateway is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "gateway",
      help: printHelp,
      commands: getLeafCommandRegistry()
    });
  }

  return {
    getHelpText,
    printHelp,
    getLeafCommandRegistry,
    getRuntimeCommandRegistry,
    getLogsCommandRegistry,
    handleCommand
  };
}
