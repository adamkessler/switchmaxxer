import { APP_ERROR_CODES } from "../../platform/error-codes";
import { logWarning, safeErrorMessage } from "../../platform/logger";

const GENERIC_CLI_ENTRYPOINT_FAILURE_MESSAGE = "Internal CLI error: see stderr or logs for details.";

export function createCliEntrypointErrorGuard(deps: {
  writeJsonErrorEnvelope: (command: string, code: string, message: string) => void;
  writeStderr: (message: string) => void;
  runWithUsageContext: <T>(
    context: { command: string; json: boolean },
    fn: () => Promise<T>
  ) => Promise<T>;
}) {
  async function runCliEntrypoint(
    commandName: string,
    argv: string[],
    run: (args: string[]) => Promise<number | undefined>
  ): Promise<number | undefined> {
    const json = argv.includes("--json");

    return await deps.runWithUsageContext({ command: commandName, json }, async () => {
      try {
        return await run(argv);
      } catch (error) {
        const detail = safeErrorMessage(error, 512);
        logWarning(`CLI command '${commandName}' failed unexpectedly: ${detail}`);

        if (json) {
          deps.writeJsonErrorEnvelope(
            commandName,
            APP_ERROR_CODES.internalError,
            GENERIC_CLI_ENTRYPOINT_FAILURE_MESSAGE
          );
        } else {
          deps.writeStderr(`${commandName} failed: ${detail}`);
        }

        return 1;
      }
    });
  }

  return {
    runCliEntrypoint
  };
}

export { GENERIC_CLI_ENTRYPOINT_FAILURE_MESSAGE };
