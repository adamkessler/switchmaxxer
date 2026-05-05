import { buildSanitizedErrorEnvelope, buildSuccessEnvelope } from "../../platform/response-envelope";

export type CliUsageFailureInfo = {
  code: string;
  message: string;
};

export function createCliOutputWriter(deps: {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  getUsageContext: () => { json?: boolean; command: string } | null | undefined;
  classifyUsageError: (message: string) => CliUsageFailureInfo;
  getTopLevelHelpText: () => string;
}) {
  const writeStdout = (message: string): void => {
    deps.stdout(message.endsWith("\n") ? message : `${message}\n`);
  };

  const writeStderr = (message: string): void => {
    deps.stderr(message.endsWith("\n") ? message : `${message}\n`);
  };

  const writeJson = (value: unknown): void => {
    writeStdout(`${JSON.stringify(value)}\n`);
  };

  const writeJsonSuccessEnvelope = (
    command: string,
    data: unknown,
    options: {
      count?: number;
      warnings?: unknown;
      details?: unknown;
      top_level?: Record<string, unknown>;
    } = {}
  ): void => {
    writeJson(
      buildSuccessEnvelope(command, data, {
        count: options.count,
        warnings: options.warnings,
        details: options.details,
        top_level: options.top_level
      })
    );
  };

  const writeJsonErrorEnvelope = (
    command: string,
    code: string,
    message: string,
    options: {
      warnings?: unknown;
      details?: unknown;
    } = {}
  ): void => {
    writeJson(buildSanitizedErrorEnvelope(command, code, message, options));
  };

  const printUsageError = (message: string): void => {
    const usageContext = deps.getUsageContext();

    if (usageContext?.json) {
      const classified = deps.classifyUsageError(message);
      writeJsonErrorEnvelope(usageContext.command, classified.code, classified.message);
      return;
    }

    writeStderr(`Error: ${message}`);
    writeStderr("");
    writeStderr(deps.getTopLevelHelpText());
  };

  return {
    printUsageError,
    writeStdout,
    writeStderr,
    writeJson,
    writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope
  };
}
