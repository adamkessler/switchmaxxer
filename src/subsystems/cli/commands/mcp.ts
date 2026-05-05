import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";

export function createMcpCli(deps: {
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
  runMcpServe: (argv: string[]) => Promise<number>;
  runMcpCapabilities: (argv: string[]) => Promise<number>;
  writeStdout: (message: string) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "serve",
        summary: "Run the MCP stdio server",
        usageLines: ["switchmaxxer mcp serve [--config <path>]"],
        exampleLines: ["switchmaxxer mcp serve"],
        match: matchExactCommand("serve"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: async (leafArgs) => await deps.runMcpServe(leafArgs)
          })
      },
      {
        name: "capabilities",
        summary: "Show granted MCP capabilities and visible tools",
        usageLines: ["switchmaxxer mcp capabilities [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer mcp capabilities --config ./config.json --json"],
        match: matchExactCommand("capabilities"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: async (leafArgs) => await deps.runMcpCapabilities(leafArgs)
          })
      }
    ];
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer mcp",
      description: "Runs the Switchmaxxer MCP stdio server for local MCP clients.",
      commands: getCommandRegistry(),
      flags: ["--config <path>  Use the specified config file"],
      notes: [
        "This CLI surface runs the stdio MCP server process and previews the effective MCP capability grant.",
        "The invoke surface is intentionally CLI-only; MCP clients should not expect a live-invocation tool here.",
        "For richer MCP protocol details and tool contracts, use the dedicated MCP docs and contract surfaces."
      ],
      docsPath: "docs/subsystems/mcp/how-to-launch-switchmaxxer-mcp.md",
      proTip: "smx mcp is the official short operator alias form."
    });
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "mcp",
      help: printHelp,
      commands: getCommandRegistry()
    });
  }

  return {
    getHelpText,
    printHelp,
    getCommandRegistry,
    handleCommand
  };
}
