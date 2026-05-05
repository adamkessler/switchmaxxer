import { randomInt } from "node:crypto";

import { APP_ERROR_CODES } from "../../../platform/error-codes";
import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";

type ToolCommonArgs = {
  json: boolean;
  configPath?: string;
  errorMessage?: string;
};

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDurationParts(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0 || parts.length > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || parts.length > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function createToolCli(deps: {
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
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string,
    missingValueMessage?: string
  ) =>
    | {
        value?: string;
        consumed: number;
        errorMessage?: string;
      }
    | null;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  fetchGatewayRuntimeConfigPayload: (
    document: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ endpoint: string; payload: Record<string, unknown> }>;
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
    code: string,
    message: string,
    options?: {
      warnings?: unknown;
      details?: unknown;
    }
  ) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function parseToolArgs(
    argv: string[],
    options: {
      allowConfig: boolean;
    }
  ): ToolCommonArgs {
    let json = false;
    let configPath: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      if (arg === "--json") {
        json = true;
        continue;
      }

      if (options.allowConfig) {
        const parsedConfig = deps.readLongFlagValue(argv, index, "--config", "Flag '--config' requires a path value");
        if (parsedConfig) {
          if (parsedConfig.errorMessage) {
            return { json, configPath, errorMessage: parsedConfig.errorMessage };
          }

          configPath = parsedConfig.value;
          index += parsedConfig.consumed;
          continue;
        }
      }

      return {
        json,
        configPath,
        errorMessage: `Unknown flag '${arg}'`
      };
    }

    return { json, configPath };
  }

  function writeTextLine(value: string): void {
    deps.writeStdout(`${value}\n`);
  }

  async function runToolDate(argv: string[]): Promise<number> {
    const parsedArgs = parseToolArgs(argv, { allowConfig: false });

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const today = formatLocalDate(new Date());

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("tool date", {
        date: today
      });
      return 0;
    }

    writeTextLine(today);
    return 0;
  }

  async function runToolRandom(argv: string[]): Promise<number> {
    const parsedArgs = parseToolArgs(argv, { allowConfig: false });

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const value = randomInt(0, 1_000_000_000) / 1_000_000_000;

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope("tool random", {
        value
      });
      return 0;
    }

    writeTextLine(String(value));
    return 0;
  }

  async function runToolUptime(argv: string[]): Promise<number> {
    const parsedArgs = parseToolArgs(argv, { allowConfig: true });
    let sourceFile: string | null = null;
    let bindHost: string | null = null;
    let port: number | null = null;

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    try {
      const loadedConfig = deps.loadConfigJsonDocument(parsedArgs.configPath);
      sourceFile = loadedConfig.sourceFile;
      const { document } = loadedConfig;
      bindHost =
        typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
          ? document["bind_host"]
          : "127.0.0.1";
      port =
        typeof document["port"] === "number" && Number.isFinite(document["port"])
          ? document["port"]
          : null;
      const runtimeConfig = await deps.fetchGatewayRuntimeConfigPayload(document);
      const startedAt =
        typeof runtimeConfig.payload["started_at"] === "string" && runtimeConfig.payload["started_at"].trim().length > 0
          ? runtimeConfig.payload["started_at"]
          : null;

      if (startedAt === null) {
        const message = "Gateway runtime config did not return a valid 'started_at' timestamp.";
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("tool uptime", APP_ERROR_CODES.toolExecutionError, message);
          return 1;
        }

        deps.writeStderr(`Tool uptime failed: ${message}`);
        return 1;
      }

      const startedAtMs = Date.parse(startedAt);
      if (!Number.isFinite(startedAtMs)) {
        const message = `Gateway runtime config returned an invalid 'started_at' timestamp: ${startedAt}`;
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("tool uptime", APP_ERROR_CODES.toolExecutionError, message);
          return 1;
        }

        deps.writeStderr(`Tool uptime failed: ${message}`);
        return 1;
      }

      const uptimeMs = Math.max(0, Date.now() - startedAtMs);
      const uptimeSeconds = Math.floor(uptimeMs / 1000);
      const uptime = formatDurationParts(uptimeSeconds);

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope("tool uptime", {
          uptime,
          uptime_ms: uptimeMs,
          uptime_seconds: uptimeSeconds,
          started_at: startedAt
        });
        return 0;
      }

      writeTextLine(uptime);
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown gateway uptime error";
      const code =
        message.includes("Unable to reach runtime config endpoint") || message.includes("runtime config endpoint returned HTTP")
          ? APP_ERROR_CODES.gatewayUnavailable
          : APP_ERROR_CODES.toolExecutionError;

      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("tool uptime", code, message, {
          details: {
            source_file: sourceFile,
            bind_host: bindHost,
            port
          }
        });
        return 1;
      }

      deps.writeStderr(`Tool uptime failed: ${message}`);
      return 1;
    }
  }

  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "date",
        summary: "Print today's local date",
        usageLines: ["switchmaxxer tool date [--json]"],
        exampleLines: ["switchmaxxer tool date", "switchmaxxer tool date --json"],
        match: matchExactCommand("date"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: (leafArgs) => runToolDate(leafArgs)
          })
      },
      {
        name: "uptime",
        summary: "Print the running gateway uptime",
        usageLines: ["switchmaxxer tool uptime [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer tool uptime", "switchmaxxer tool uptime --config ./config.json --json"],
        match: matchExactCommand("uptime"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: async (leafArgs) => await runToolUptime(leafArgs)
          })
      },
      {
        name: "random",
        summary: "Print a random number between 0 and 1",
        usageLines: ["switchmaxxer tool random [--json]"],
        exampleLines: ["switchmaxxer tool random", "switchmaxxer tool random --json"],
        match: matchExactCommand("random"),
        run: async (args) =>
          await deps.runHelpAwareCommand(args, {
            help: printHelp,
            run: (leafArgs) => runToolRandom(leafArgs)
          })
      }
    ];
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer tool",
      description: "Runs built-in Switchmaxxer operator and developer utilities.",
      commands: getCommandRegistry(),
      flags: [
        "--json           Emit a machine-readable success or error envelope",
        "--config <path>  Use the specified config file for gateway-aware tools like uptime"
      ],
      notes: [
        "Built-in tools are a real CLI utility surface, not aliases for routes.",
        "The current release includes date, uptime, and random."
      ],
      docsPath: "docs/subsystems/cli/tech-spec-for-tools.md",
      proTip: "smx tool is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "tool",
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
