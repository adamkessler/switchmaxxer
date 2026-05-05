import { APP_ERROR_CODES } from "../../platform/error-codes";

export function runUnsupportedCliCommand(
  commandName: string,
  message: string,
  argv: string[],
  deps: {
    writeJsonErrorEnvelope: (command: string, code: string, message: string) => void;
    writeStderr: (message: string) => void;
  }
): number {
  const json = argv.includes("--json");

  if (json) {
    deps.writeJsonErrorEnvelope(commandName, APP_ERROR_CODES.unsupported, message);
    return 1;
  }

  deps.writeStderr(`${commandName} is currently unsupported: ${message}`);
  return 1;
}

export function handleCliFallback(
  argv: string[],
  deps: {
    printUsageError: (message: string) => void;
  }
): {
  shouldExit: boolean;
  exitCode: number;
} {
  const [firstArg] = argv;

  if (typeof firstArg === "undefined") {
    return { shouldExit: false, exitCode: 0 };
  }

  if (firstArg.startsWith("-")) {
    deps.printUsageError(`Unknown flag '${firstArg}'`);
    return { shouldExit: true, exitCode: 2 };
  }

  deps.printUsageError(`Unknown command '${firstArg}'`);
  return { shouldExit: true, exitCode: 2 };
}
