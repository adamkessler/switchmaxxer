import { type CliCommandRegistration, resolveRegisteredCommand } from "./registry";

export async function runCliDispatch(
  argv: string[],
  registries: {
    cliCommandRegistry: CliCommandRegistration[];
    globalMetaCommandRegistry: CliCommandRegistration[];
    defaultEntryCommandRegistry: CliCommandRegistration[];
  },
  handleCliFallback: (argv: string[]) => {
    shouldExit: boolean;
    exitCode: number;
  }
): Promise<number> {
  const resolvedCommand = resolveRegisteredCommand(registries.cliCommandRegistry, argv);

  if (resolvedCommand) {
    return (await resolvedCommand.command.run(resolvedCommand.args)) ?? 0;
  }

  const resolvedMetaCommand = resolveRegisteredCommand(registries.globalMetaCommandRegistry, argv);
  if (resolvedMetaCommand) {
    return (await resolvedMetaCommand.command.run(resolvedMetaCommand.args)) ?? 0;
  }

  const resolvedDefaultEntryCommand = resolveRegisteredCommand(registries.defaultEntryCommandRegistry, argv);
  if (resolvedDefaultEntryCommand) {
    return (await resolvedDefaultEntryCommand.command.run(resolvedDefaultEntryCommand.args)) ?? 0;
  }

  const fallback = handleCliFallback(argv);
  if (fallback.shouldExit) {
    return fallback.exitCode;
  }

  return 0;
}
