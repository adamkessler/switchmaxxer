import { spawn } from "node:child_process";

import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { normalizeJournalJsonEntry } from "../../platform/log-normalization";

export type GatewayLogsFormat = "text" | "json";

type GatewayLogsAttempt = {
  ok: boolean;
  scope: "user" | "system";
  entries: string[];
  message?: string;
};

export function createGatewayLogsCommand(deps: {
  parseLogsTailArgs: (argv: string[]) => {
    follow: boolean;
    lines: number;
    since?: string;
    format: GatewayLogsFormat;
    route?: string;
    provider?: string;
    errorMessage?: string;
  };
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  resolveSystemdUnitFromDocument: (document: Record<string, unknown>) => string;
  matchesLogFilters: (
    rawLine: string,
    format: GatewayLogsFormat,
    route?: string,
    provider?: string
  ) => boolean;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJsonSuccessEnvelope: (
    command: string,
    data: unknown,
    options?: {
      count?: number;
      warnings?: unknown;
      details?: unknown;
      top_level?: Record<string, unknown>;
    }
  ) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: AppErrorCode,
    message: string,
    options?: {
      details?: unknown;
      top_level?: Record<string, unknown>;
    }
  ) => void;
  runJournalctlAttempt?: (
    scope: "user" | "system",
    follow: boolean,
    args: string[],
    onLine: (rawLine: string) => void
  ) => Promise<GatewayLogsAttempt>;
}): {
  runLogsCommand: (
    argv: string[],
    options: {
      commandName: "logs tail" | "logs show" | "gateway logs tail" | "gateway logs show";
      allowFollow: boolean;
    }
  ) => Promise<number>;
} {
  async function runLogsCommand(
    argv: string[],
    options: {
      commandName: "logs tail" | "logs show" | "gateway logs tail" | "gateway logs show";
      allowFollow: boolean;
    }
  ): Promise<number> {
    const parsedArgs = deps.parseLogsTailArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    if (!options.allowFollow && parsedArgs.follow) {
      deps.printUsageError(`Flag '--follow' is not supported for '${options.commandName}'`);
      return 2;
    }

    const { document } = deps.loadConfigJsonDocument();
    const systemdUnit = deps.resolveSystemdUnitFromDocument(document);

    const buildJournalctlArgs = (scope: "user" | "system", follow: boolean): string[] => {
      const args = scope === "user" ? ["--user"] : [];
      args.push(`--unit=${systemdUnit}`, "-n", String(parsedArgs.lines));

      if (parsedArgs.since) {
        args.push("--since", parsedArgs.since);
      }

      args.push("-o", parsedArgs.format === "json" ? "json" : "short-iso");

      if (follow) {
        args.push("-f");
      }

      return args;
    };

    const runJournalctlAttempt = async (scope: "user" | "system", follow: boolean): Promise<GatewayLogsAttempt> => {
      const args = buildJournalctlArgs(scope, follow);
      return await new Promise((resolve) => {
        const child = spawn("journalctl", args, {
          stdio: ["ignore", "pipe", "pipe"]
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";
        const filteredEntries: string[] = [];

        const flushTextLine = (rawLine: string): void => {
          if (rawLine.length === 0 || rawLine === "-- No entries --") {
            return;
          }

          if (!deps.matchesLogFilters(rawLine, parsedArgs.format, parsedArgs.route, parsedArgs.provider)) {
            return;
          }

          if (follow) {
            deps.writeStdout(rawLine);
            return;
          }

          filteredEntries.push(rawLine);
        };

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdoutBuffer += chunk.toString();

          let newlineIndex = stdoutBuffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = stdoutBuffer.slice(0, newlineIndex);
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            flushTextLine(line);
            newlineIndex = stdoutBuffer.indexOf("\n");
          }
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
          stderrBuffer += chunk.toString();
        });

        child.on("error", (error) => {
          resolve({
            ok: false,
            scope,
            entries: [],
            message: error instanceof Error ? error.message : "Unknown journald error"
          });
        });

        child.on("close", (code) => {
          if (stdoutBuffer.length > 0) {
            flushTextLine(stdoutBuffer);
          }

          if (code !== 0) {
            resolve({
              ok: false,
              scope,
              entries: [],
              message: stderrBuffer.trim().length > 0 ? stderrBuffer.trim() : `journalctl exited with code ${code}`
            });
            return;
          }

          resolve({
            ok: true,
            scope,
            entries: filteredEntries
          });
        });
      });
    };

    const attemptJournalctl = async (scope: "user" | "system", follow: boolean): Promise<GatewayLogsAttempt> => {
      if (deps.runJournalctlAttempt) {
        return await deps.runJournalctlAttempt(scope, follow, buildJournalctlArgs(scope, follow), (rawLine) => {
          if (rawLine.length === 0 || rawLine === "-- No entries --") {
            return;
          }

          if (!deps.matchesLogFilters(rawLine, parsedArgs.format, parsedArgs.route, parsedArgs.provider)) {
            return;
          }

          if (follow) {
            deps.writeStdout(rawLine);
          }
        });
      }

      return await runJournalctlAttempt(scope, follow);
    };

    const attempts = [await attemptJournalctl("user", false), await attemptJournalctl("system", false)];
    const successWithEntries = attempts.find((attempt) => attempt.ok && attempt.entries.length > 0);
    const success = successWithEntries ?? attempts.find((attempt) => attempt.ok);

    if (!success) {
      const message = attempts[1]?.message || attempts[0]?.message || "Unknown journald error";

      if (parsedArgs.format === "json" && !parsedArgs.follow) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.logsError, message);
      } else if (!parsedArgs.follow) {
        deps.writeStderr(`Logs tail failed: ${message}`);
      }

      return 1;
    }

    if (parsedArgs.follow) {
      const followAttempt = await attemptJournalctl(success.scope, true);

      if (followAttempt.ok) {
        return 0;
      }

      const message = followAttempt.message || "Unknown journald error";
      deps.writeStderr(`Logs tail failed: ${message}`);
      return 1;
    }

    if (parsedArgs.format === "json") {
      deps.writeJsonSuccessEnvelope(
        options.commandName,
        {
          source: "journald",
          unit: systemdUnit,
          scope: success.scope,
          entries: success.entries.map((entry) => normalizeJournalJsonEntry(entry))
        },
        { count: success.entries.length }
      );
      return 0;
    }

    if (success.entries.length === 0) {
      deps.writeStdout("No log entries found.");
      return 0;
    }

    deps.writeStdout(success.entries.join("\n"));
    return 0;
  }

  return {
    runLogsCommand
  };
}
