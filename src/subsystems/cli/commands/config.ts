import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";

export function createConfigCli(deps: {
  createCliCommandRegistration: (options: {
    name: string;
    commandName?: string;
    summary?: string;
    usageLines?: string[];
    exampleLines?: string[];
    positionals?: Array<{
      label: string;
      rejectFlagLike?: boolean;
    }>;
    unsupportedMessage?: string;
    match: (argv: string[]) => string[] | null;
    execute?: (argv: string[], positionals: string[]) => Promise<number | undefined> | number | undefined;
  }) => CliCommandRegistration;
  runRegisteredCommandFamily: (
    argv: string[],
    options: {
      familyName: string;
      help: () => void;
      commands: CliCommandRegistration[];
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
  runConfigValidate: (argv: string[]) => Promise<number>;
  runConfigShow: (argv: string[]) => Promise<number>;
  runConfigSchema: (argv: string[]) => Promise<number>;
  runConfigExport: (argv: string[]) => Promise<number>;
  runConfigImport: (argv: string[]) => Promise<number>;
  runConfigSet: (argv: string[]) => Promise<number>;
  writeStdout: (message: string) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "validate",
        summary: "Validate the selected config file",
        usageLines: ["switchmaxxer config validate [--config <path>] [--json]"],
        exampleLines: [
          "switchmaxxer help config",
          "switchmaxxer config validate",
          "switchmaxxer config validate --json",
          "switchmaxxer config validate --config ./config.json"
        ],
        match: matchExactCommand("validate"),
        run: async (args) => deps.runConfigValidate(args)
      },
      {
        name: "show",
        summary: "Show the redacted normalized config view",
        usageLines: ["switchmaxxer config show [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer config show", "switchmaxxer config show --json"],
        match: matchExactCommand("show"),
        run: async (args) => deps.runConfigShow(args)
      },
      {
        name: "schema",
        summary: "Show the config schema",
        usageLines: ["switchmaxxer config schema [--json]"],
        exampleLines: ["switchmaxxer config schema --json"],
        match: matchExactCommand("schema"),
        run: async (args) => deps.runConfigSchema(args)
      },
      deps.createCliCommandRegistration({
        name: "migrate",
        commandName: "config migrate",
        summary: "Reserved schema/version upgrade surface",
        usageLines: ["switchmaxxer config migrate [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer config migrate --json"],
        unsupportedMessage: "config migration is not implemented yet",
        match: matchExactCommand("migrate"),
        execute: async () => undefined
      }),
      {
        name: "import",
        summary: "Import a full config document",
        usageLines: [
          "switchmaxxer config import (--stdin|--json-input <path>) [--config <path>] [--dry-run] [--backup] [--json]"
        ],
        exampleLines: [
          "switchmaxxer config import --json-input ./switchmaxxer-backup.json",
          "switchmaxxer config import --json-input ./switchmaxxer-backup.json --dry-run",
          "cat ./switchmaxxer-backup.json | switchmaxxer config import --stdin --backup --json"
        ],
        match: matchExactCommand("import"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: async (leafArgs) => await deps.runConfigImport(leafArgs)
          })
      },
      {
        name: "export",
        summary: "Export the selected config file",
        usageLines: ["switchmaxxer config export [--config <path>] [--output <path>] [--include-secrets] [--json]"],
        exampleLines: [
          "switchmaxxer config export --output ./switchmaxxer-redacted.json",
          "switchmaxxer config export --include-secrets --output ./switchmaxxer-backup.json",
          "switchmaxxer config export --json"
        ],
        match: matchExactCommand("export"),
        run: async (args) => deps.runConfigExport(args)
      },
      deps.createCliCommandRegistration({
        name: "set",
        commandName: "config set",
        summary: "Set a supported config key",
        usageLines: ["switchmaxxer config set max_payload_size <bytes> [--config <path>] [--json]"],
        exampleLines: [
          "switchmaxxer config set max_payload_size 4000000",
          "switchmaxxer config set max_payload_size 2000000 --json"
        ],
        positionals: [
          { label: "<key>", rejectFlagLike: false },
          { label: "<value>", rejectFlagLike: false }
        ],
        match: matchExactCommand("set"),
        execute: async (args, [key = "", value = ""]) => deps.runConfigSet([key, value, ...args])
      })
    ];
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer config",
      description: "Shows, validates, imports, exports, or updates the selected Switchmaxxer config file.",
      commands: getCommandRegistry(),
      flags: [
        "--config <path>  Use the specified config file",
        "--json           Emit a simple JSON envelope",
        "--stdin          Read one full config object from stdin for import",
        "--json-input     Read one full config object from a JSON file for import",
        "--dry-run        Validate and preview config import changes without writing",
        "--backup         Write .bak backups under <config-dir>/.switchmaxxer/catalog-backups/ before replacing local config/catalog files",
        "--output <path>  Write the exported config to the specified path",
        "--include-secrets Preserve inline provider api_key values; requires --output"
      ],
      notes: [
        "config show returns a redacted normalized view of the config document.",
        "It is safe for inspection, but it is not a byte-for-byte dump of the on-disk file.",
        "config export redacts inline api_key values by default.",
        "config import --dry-run redacts inline api_key values in preview diffs.",
        "Use config export --include-secrets --output <path> only for full-fidelity secret-bearing backups."
      ],
      docsPath: "docs/subsystems/config/config-reference.md",
      proTip: "smx help config is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "config",
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
