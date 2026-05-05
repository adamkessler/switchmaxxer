import type { CliCommandRegistration } from "./registry";

export function createCliAppRuntime(deps: {
  runCliDispatch: typeof import("./dispatch").runCliDispatch;
  handleCliFallback: typeof import("./dispatch-support").handleCliFallback;
  printUsageError: (message: string) => void;
  registries: {
    cliCommandRegistry: CliCommandRegistration[];
    globalMetaCommandRegistry: CliCommandRegistration[];
    defaultEntryCommandRegistry: CliCommandRegistration[];
  };
  invokeRuntime: {
    runInvoke: (
      argv: string[],
      options: { commandName: "invoke"; failurePrefix: string }
    ) => Promise<number>;
  };
  testRuntime: {
    runTestRoutesCommand: (commandName: "test", argv: string[]) => Promise<number>;
  };
}) {
  async function runInvoke(
    argv: string[],
    options: { commandName: "invoke"; failurePrefix: string } = {
      commandName: "invoke",
      failurePrefix: "Invoke"
    }
  ): Promise<number> {
    return await deps.invokeRuntime.runInvoke(argv, options);
  }

  async function runTestRoutesCommand(commandName: "test", argv: string[]): Promise<number> {
    return await deps.testRuntime.runTestRoutesCommand(commandName, argv);
  }

  async function runCliInternal(argv: string[]): Promise<number> {
    return await deps.runCliDispatch(
      argv,
      {
        cliCommandRegistry: deps.registries.cliCommandRegistry,
        globalMetaCommandRegistry: deps.registries.globalMetaCommandRegistry,
        defaultEntryCommandRegistry: deps.registries.defaultEntryCommandRegistry
      },
      (args) => deps.handleCliFallback(args, { printUsageError: deps.printUsageError })
    );
  }

  return {
    runInvoke,
    runTestRoutesCommand,
    runCliInternal
  };
}
