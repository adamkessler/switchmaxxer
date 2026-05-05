import { type AppErrorCode } from "../../../platform/error-codes";
import { buildSuccessEnvelope } from "../../../platform/response-envelope";
import { matchExactCommand, type CliCommandRegistration } from "../registry";

type CreateCliCommandRegistration = (options: {
  name: string;
  commandName?: string;
  summary?: string;
  usageLines?: string[];
  exampleLines?: string[];
  positionals?: Array<{
    label: string;
    rejectFlagLike?: boolean;
  }>;
  match: (argv: string[]) => string[] | null;
  execute?: (argv: string[], positionals: string[]) => Promise<number | undefined> | number | undefined;
}) => CliCommandRegistration;

export function writeCrudJsonSuccess(
  deps: {
    writeJson: (value: unknown) => void;
  },
  command: string,
  data: unknown,
  extras: Record<string, unknown> = {}
): void {
  const { count, editability, ...topLevel } = extras;

  deps.writeJson(buildSuccessEnvelope(command, data, {
    ...(typeof count === "undefined" ? {} : { count: Number(count) }),
    ...(typeof editability === "undefined"
      ? {}
      : {
          editability: editability as {
            writable: string[];
            derived: string[];
            effective: string[];
          }
        }),
    ...(Object.keys(topLevel).length === 0 ? {} : { top_level: topLevel })
  }));
}

export function writeCrudNotFound(
  deps: {
    writeStderr: (message: string) => void;
    writeJsonErrorEnvelope: (
      command: string,
      code: AppErrorCode,
      message: string,
      options?: {
        warnings?: unknown;
        details?: unknown;
      }
    ) => void;
  },
  options: {
    json: boolean;
    command: string;
    notFoundCode: AppErrorCode;
    failurePrefix: string;
    entityLabel: string;
    entityName: string;
  }
): number {
  const message = `${options.entityLabel} '${options.entityName}' was not found`;

  if (options.json) {
    deps.writeJsonErrorEnvelope(options.command, options.notFoundCode, message);
    return 1;
  }

  deps.writeStderr(`${options.failurePrefix} failed: ${message}`);
  return 1;
}

export function runParsedCrudConfigCommand(
  argv: string[],
  deps: {
    parseConfigCommandArgs: (argv: string[]) => {
      configPath?: string;
      json: boolean;
      errorMessage?: string;
    };
    printUsageError: (message: string) => void;
    writeStderr: (message: string) => void;
    writeJsonErrorEnvelope: (
      command: string,
      code: AppErrorCode,
      message: string,
      options?: {
        warnings?: unknown;
        details?: unknown;
      }
    ) => void;
  },
  options: {
    command: string;
    errorCode: AppErrorCode;
    failurePrefix: string;
    run: (parsedArgs: { configPath?: string; json: boolean }) => number;
  }
): number {
  const parsedArgs = deps.parseConfigCommandArgs(argv);

  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  try {
    return options.run({
      configPath: parsedArgs.configPath,
      json: parsedArgs.json
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown ${options.command} error`;

    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope(options.command, options.errorCode, message);
      return 1;
    }

    deps.writeStderr(`${options.failurePrefix} failed: ${message}`);
    return 1;
  }
}

export function createStandardCrudCommandRegistry(
  deps: {
    createCliCommandRegistration: CreateCliCommandRegistration;
  },
  options: {
    list: {
      summary: string;
      usageLines: string[];
      exampleLines: string[];
      run: (argv: string[]) => Promise<number | undefined> | number | undefined;
    };
    show: {
      commandName: string;
      summary: string;
      usageLines: string[];
      exampleLines: string[];
      positionalLabel: string;
      run: (name: string, argv: string[]) => Promise<number | undefined> | number | undefined;
    };
    create: {
      commandName: string;
      summary: string;
      usageLines: string[];
      exampleLines: string[];
      positionalLabel: string;
      run: (name: string, argv: string[]) => Promise<number | undefined> | number | undefined;
    };
    update: {
      commandName: string;
      summary: string;
      usageLines: string[];
      exampleLines: string[];
      positionalLabel: string;
      run: (name: string, argv: string[]) => Promise<number | undefined> | number | undefined;
    };
    delete: {
      commandName: string;
      summary: string;
      usageLines: string[];
      exampleLines: string[];
      positionalLabel: string;
      run: (name: string, argv: string[]) => Promise<number | undefined> | number | undefined;
    };
    extras?: CliCommandRegistration[];
  }
): CliCommandRegistration[] {
  return [
    {
      name: "list",
      summary: options.list.summary,
      usageLines: options.list.usageLines,
      exampleLines: options.list.exampleLines,
      match: matchExactCommand("list"),
      run: async (argv) => await options.list.run(argv)
    },
    deps.createCliCommandRegistration({
      name: "show",
      commandName: options.show.commandName,
      summary: options.show.summary,
      usageLines: options.show.usageLines,
      exampleLines: options.show.exampleLines,
      positionals: [{ label: options.show.positionalLabel, rejectFlagLike: false }],
      match: matchExactCommand("show"),
      execute: async (argv, [name = ""]) => await options.show.run(name, argv)
    }),
    deps.createCliCommandRegistration({
      name: "create",
      commandName: options.create.commandName,
      summary: options.create.summary,
      usageLines: options.create.usageLines,
      exampleLines: options.create.exampleLines,
      positionals: [{ label: options.create.positionalLabel, rejectFlagLike: false }],
      match: matchExactCommand("create"),
      execute: async (argv, [name = ""]) => await options.create.run(name, argv)
    }),
    deps.createCliCommandRegistration({
      name: "update",
      commandName: options.update.commandName,
      summary: options.update.summary,
      usageLines: options.update.usageLines,
      exampleLines: options.update.exampleLines,
      positionals: [{ label: options.update.positionalLabel, rejectFlagLike: false }],
      match: matchExactCommand("update"),
      execute: async (argv, [name = ""]) => await options.update.run(name, argv)
    }),
    deps.createCliCommandRegistration({
      name: "delete",
      commandName: options.delete.commandName,
      summary: options.delete.summary,
      usageLines: options.delete.usageLines,
      exampleLines: options.delete.exampleLines,
      positionals: [{ label: options.delete.positionalLabel, rejectFlagLike: false }],
      match: matchExactCommand("delete"),
      execute: async (argv, [name = ""]) => await options.delete.run(name, argv)
    }),
    ...(options.extras ?? [])
  ];
}
