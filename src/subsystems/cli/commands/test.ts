import { buildRegisteredFamilyHelpText, type CliCommandRegistration } from "../registry";

export function createTestCli(deps: {
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
  runTestRoutesCommand: (commandName: "test", argv: string[]) => Promise<number>;
  writeStdout: (message: string) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer test",
      description: "Runs configured gateway and route tests without starting a new gateway runtime.",
      commands: [],
      usageLines: ["switchmaxxer test [--route <route-id>] [--config <path>] [--json] [--no-gateway]"],
      flags: [
        "--route <route-id>   Restrict the test run to one route",
        "--config <path>  Use the specified config file",
        "--json           Emit a simple JSON envelope",
        "--no-gateway     Bypass the live gateway and test routes directly against upstream providers"
      ],
      notes: [
        "`switchmaxxer test` now tests routes through the live gateway by default.",
        "Use `--no-gateway` to run the same checks directly against upstream providers."
      ],
      exampleLines: [
        "switchmaxxer test",
        "switchmaxxer test --route gpt-4o-mini",
        "switchmaxxer test --no-gateway"
      ],
      docsPath: "docs/subsystems/cli/tech-spec-for-tools.md",
      proTip: "smx test is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    const testCommandRegistry: CliCommandRegistration[] = [];

    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "test",
      help: printHelp,
      commands: testCommandRegistry,
      defaultRun: async (args) => await deps.runTestRoutesCommand("test", args)
    });
  }

  return {
    getHelpText,
    printHelp,
    handleCommand
  };
}
