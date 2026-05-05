export type CliCommandRegistration = {
  name: string;
  commandName?: string;
  args?: string;
  help?: () => void;
  summary?: string;
  usageLines?: string[];
  exampleLines?: string[];
  showInHelp?: boolean;
  positionals?: Array<{
    label: string;
    rejectFlagLike?: boolean;
  }>;
  unsupportedMessage?: string;
  match: (argv: string[]) => string[] | null;
  run: (argv: string[]) => Promise<number | undefined>;
};

type PrintUsageError = (message: string) => void;
type RunUnsupportedCommand = (commandName: string, message: string, argv: string[]) => number;

export function consumeCommandPositionals(
  commandName: string,
  argv: string[],
  positionals: Array<{
    label: string;
    rejectFlagLike?: boolean;
  }>,
  printUsageError: PrintUsageError
): {
  values: string[];
  rest: string[];
} | null {
  const remaining = [...argv];
  const values: string[] = [];

  for (const positional of positionals) {
    const value = remaining.shift();
    const rejectFlagLike = positional.rejectFlagLike ?? true;
    if (typeof value !== "string" || value.length === 0 || (rejectFlagLike && value.startsWith("-"))) {
      printUsageError(`Missing required argument '${positional.label}' for '${commandName}'`);
      return null;
    }

    values.push(value);
  }

  return { values, rest: remaining };
}

export function createCliCommandRegistration(
  options: {
    name: string;
    commandName?: string;
    args?: string;
    help?: () => void;
    summary?: string;
    usageLines?: string[];
    exampleLines?: string[];
    showInHelp?: boolean;
    positionals?: Array<{
      label: string;
      rejectFlagLike?: boolean;
    }>;
    unsupportedMessage?: string;
    match: (argv: string[]) => string[] | null;
    execute?: (argv: string[], positionals: string[]) => Promise<number | undefined> | number | undefined;
  },
  deps: {
    printUsageError: PrintUsageError;
    runUnsupportedCommand: RunUnsupportedCommand;
    runWithUsageContext: <T>(
      context: { command: string; json: boolean },
      fn: () => Promise<T>
    ) => Promise<T>;
  }
): CliCommandRegistration {
  return {
    name: options.name,
    commandName: options.commandName,
    args: options.args,
    help: options.help,
    summary: options.summary,
    usageLines: options.usageLines,
    exampleLines: options.exampleLines,
    showInHelp: options.showInHelp ?? typeof options.unsupportedMessage !== "string",
    positionals: options.positionals,
    unsupportedMessage: options.unsupportedMessage,
    match: options.match,
    run: async (argv: string[]) => await deps.runWithUsageContext(
      {
        command: options.commandName ?? options.name,
        json: argv.includes("--json")
      },
      async () => {
      const commandName = options.commandName ?? options.name;
      const consumedPositionals =
        Array.isArray(options.positionals) && options.positionals.length > 0
          ? consumeCommandPositionals(commandName, argv, options.positionals, deps.printUsageError)
          : { values: [], rest: argv };

      if (!consumedPositionals) {
        return 2;
      }

      if (typeof options.unsupportedMessage === "string") {
        return deps.runUnsupportedCommand(commandName, options.unsupportedMessage, argv);
      }

      if (typeof options.execute === "function") {
        return await options.execute(consumedPositionals.rest, consumedPositionals.values);
      }

      return undefined;
      }
    )
  };
}

export function buildRegisteredFamilyHelpText(options: {
  title: string;
  description: string;
  commands: CliCommandRegistration[];
  flags?: string[];
  notes?: string[];
  usageLines?: string[];
  exampleLines?: string[];
  docsPath?: string;
  proTip?: string;
}): string {
  const visibleCommands = options.commands.filter((command) => command.showInHelp !== false);
  const usageLines = [...(options.usageLines ?? []), ...visibleCommands.flatMap((command) => command.usageLines ?? [])];
  const exampleLines = [
    ...(options.exampleLines ?? []),
    ...visibleCommands.flatMap((command) => command.exampleLines ?? [])
  ];
  const summaryLines = visibleCommands.map((command) =>
    typeof command.summary === "string" ? `  ${command.name}  ${command.summary}` : `  ${command.name}`
  );
  const sections = [
    options.title,
    "",
    "Description:",
    `  ${options.description}`,
    ""
  ];

  if (usageLines.length > 0) {
    sections.splice(2, 0, "Usage:", ...usageLines.map((line) => `  ${line}`), "");
  }

  if (Array.isArray(options.notes) && options.notes.length > 0) {
    sections.push("Notes:");
    sections.push(...options.notes.map((line) => `  ${line}`));
    sections.push("");
  }

  if (summaryLines.length > 0) {
    sections.push("Currently supported subcommands:", ...summaryLines, "");
  }

  if (Array.isArray(options.flags) && options.flags.length > 0) {
    sections.push("Flags:", ...options.flags.map((line) => `  ${line}`), "");
  }

  if (exampleLines.length > 0) {
    sections.push("Examples:", ...exampleLines.map((line) => `  ${line}`));
  }

  if (typeof options.docsPath === "string" && options.docsPath.length > 0) {
    sections.push("", "Docs:", `  ${options.docsPath}`);
  }

  if (typeof options.proTip === "string" && options.proTip.length > 0) {
    sections.push("", "Pro tip:", `  ${options.proTip}`);
  }

  return `${sections.join("\n")}\n`;
}

export async function runRegisteredCommandFamily(
  argv: string[],
  options: {
    familyName: string;
    help: () => void;
    commands: CliCommandRegistration[];
    defaultRun?: (argv: string[]) => Promise<number | undefined>;
    missingSubcommandMessage?: string;
  },
  deps: {
    isHelpFlag: (arg?: string) => boolean;
    printUsageError: PrintUsageError;
  }
): Promise<number | undefined> {
  const subcommand = argv[0];

  if (deps.isHelpFlag(subcommand)) {
    options.help();
    return 0;
  }

  if (typeof options.defaultRun === "function" && (typeof subcommand === "undefined" || subcommand.startsWith("-"))) {
    return await options.defaultRun(argv);
  }

  if (typeof subcommand === "undefined") {
    if (typeof options.missingSubcommandMessage === "string") {
      deps.printUsageError(options.missingSubcommandMessage);
      return 2;
    }

    options.help();
    return 0;
  }

  const resolvedCommand = resolveRegisteredCommand(options.commands, argv);

  if (resolvedCommand) {
    return await resolvedCommand.command.run(resolvedCommand.args);
  }

  deps.printUsageError(`Unknown ${options.familyName} subcommand '${subcommand}'`);
  return 2;
}

export function createCliCommandFamilyRegistration(
  options: {
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
  },
  deps: {
    isHelpFlag: (arg?: string) => boolean;
    printUsageError: PrintUsageError;
  }
): CliCommandRegistration {
  return {
    name: options.name,
    commandName: options.commandName,
    help: options.help,
    summary: options.summary,
    usageLines: options.usageLines,
    exampleLines: options.exampleLines,
    match: options.match,
    run: async (argv: string[]) =>
      await runRegisteredCommandFamily(
        argv,
        {
          familyName: options.familyName ?? options.commandName ?? options.name,
          help: options.help,
          commands: options.commands,
          defaultRun: options.defaultRun,
          missingSubcommandMessage: options.missingSubcommandMessage
        },
        deps
      )
  };
}

export function matchExactCommand(commandName: string): (argv: string[]) => string[] | null {
  return (argv: string[]) => (argv[0] === commandName ? argv.slice(1) : null);
}

export function matchCommandPath(...commandPath: string[]): (argv: string[]) => string[] | null {
  return (argv: string[]) => {
    for (let index = 0; index < commandPath.length; index += 1) {
      if (argv[index] !== commandPath[index]) {
        return null;
      }
    }

    return argv.slice(commandPath.length);
  };
}

export function resolveRegisteredCommand(
  commands: CliCommandRegistration[],
  argv: string[]
): { command: CliCommandRegistration; args: string[] } | null {
  for (const command of commands) {
    const args = command.match(argv);

    if (args !== null) {
      return { command, args };
    }
  }

  return null;
}
