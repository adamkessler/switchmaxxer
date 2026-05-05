import { APP_ERROR_CODES, type AppErrorCode } from "../../../platform/error-codes";
import type { ObservabilityRuntimeHandle } from "../../observability/runtime-loader";
import type { ObservabilityPruneResult } from "../../observability/service";
import {
  PRUNE_OLDER_THAN_MESSAGE,
  validatePruneOlderThan
} from "../../observability/prune-validation";

interface ObservabilityPruneService {
  pruneOlderThan(cutoffIso: string): ObservabilityPruneResult;
}

export type ObservabilityPruneHandle = ObservabilityRuntimeHandle & {
  service: ObservabilityPruneService;
};

export type ObservabilityPruneCommandDeps = {
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJsonErrorEnvelope: (
    commandName: string,
    code: AppErrorCode,
    message: string,
    metadata?: Record<string, unknown>
  ) => void;
  writeJsonSuccessEnvelope: (
    commandName: string,
    payload: unknown,
    metadata?: Record<string, unknown>
  ) => void;
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string
  ) => { value?: unknown; consumed: number; errorMessage?: string } | null;
  openExistingObservabilityService: (dbPath: string) => ObservabilityPruneHandle | null;
  closeObservabilityServiceHandle: (handle: ObservabilityRuntimeHandle | null) => void;
  resolveObservabilityStorePath: () => string;
  resolveConfiguredObservabilityRetentionOlderThan: (configPath?: string) => string | null;
  retentionDurationToCutoffIso: (olderThan: string) => string;
  resolveCliConfigPath: (configPath?: string) => string;
};

type ObservabilityPruneArgs = {
  olderThan?: string;
  configPath?: string;
  json: boolean;
  help: boolean;
  errorMessage?: string;
};

function parseObservabilityPruneArgs(deps: ObservabilityPruneCommandDeps, argv: string[]): ObservabilityPruneArgs {
  let olderThan: string | undefined;
  let configPath: string | undefined;
  let json = false;
  let help = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    for (const flagName of ["--older-than", "--config"] as const) {
      const parsedFlag = deps.readLongFlagValue(argv, index, flagName);
      if (!parsedFlag) {
        continue;
      }

      if (parsedFlag.errorMessage) {
        return { olderThan, configPath, json, help, errorMessage: parsedFlag.errorMessage };
      }

      const nextArg = parsedFlag.value as string;

      if (flagName === "--older-than") {
        const validationError = validatePruneOlderThan(nextArg);
        if (validationError) {
          return {
            olderThan,
            configPath,
            json,
            help,
            errorMessage: `Flag '--older-than' must be a ${PRUNE_OLDER_THAN_MESSAGE}`
          };
        }

        olderThan = nextArg;
      } else {
        configPath = nextArg;
      }

      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { olderThan, configPath, json, help, errorMessage: `Unknown flag '${arg}'` };
  }

  return { olderThan, configPath, json, help };
}

function renderObservabilityPruneText(result: ObservabilityPruneResult, dbPath: string, olderThan: string): string {
  const lines = [
    "Observability-store prune",
    `Store: ${dbPath}`,
    `Older Than: ${olderThan}`,
    `Status: ${result.status ?? "completed"}`,
    `Cutoff: ${result.cutoff_at}`
  ];

  if (typeof result.failure_stage === "string" && result.failure_stage.length > 0) {
    lines.push(`Failure Stage: ${result.failure_stage}`);
  }

  if (typeof result.failure_message === "string" && result.failure_message.length > 0) {
    lines.push(`Failure: ${result.failure_message}`);
  }

  lines.push(
    "",
    `Observations Deleted: ${result.observations_deleted}`,
    `Request Executions Deleted: ${result.request_executions_deleted}`,
    `Benchmark Runs Deleted: ${result.benchmark_runs_deleted}`,
    `Benchmark Samples Deleted: ${result.benchmark_samples_deleted}`,
    `Cost Facts Deleted: ${result.cost_facts_deleted}`,
    `Optimization Facts Deleted: ${result.optimization_facts_deleted}`,
    `Control Plane Action Events Deleted: ${result.control_plane_action_events_deleted}`,
    `Config Mutation Events Deleted: ${result.config_mutation_events_deleted}`,
    `Config Snapshots Deleted: ${result.config_snapshots_deleted}`,
    `Total Deleted: ${result.total_deleted}`
  );

  return `${lines.join("\n")}\n`;
}

export function runObservabilityPruneCommand(
  deps: ObservabilityPruneCommandDeps,
  argv: string[],
  options: {
    commandName: string;
    errorCode: AppErrorCode;
  }
): number {
  const parsedArgs = parseObservabilityPruneArgs(deps, argv);
  if (parsedArgs.errorMessage) {
    deps.printUsageError(parsedArgs.errorMessage);
    return 2;
  }

  let handle: ObservabilityPruneHandle | null = null;
  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    const olderThan = parsedArgs.olderThan ?? deps.resolveConfiguredObservabilityRetentionOlderThan(parsedArgs.configPath);

    if (!olderThan) {
      throw new Error("Provide '--older-than <duration>' or set 'observability.retention.older_than' in config.json.");
    }

    handle = deps.openExistingObservabilityService(dbPath);

    if (!handle) {
      const message = `Observability store was not found at '${dbPath}'; nothing can be pruned yet`;
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope(options.commandName, options.errorCode, message, {
          details: {
            store_path: dbPath,
            older_than: olderThan
          }
        });
        return 1;
      }

      deps.writeStderr(`Observability-store prune failed: ${message}`);
      return 1;
    }

    const cutoffAt = deps.retentionDurationToCutoffIso(olderThan);
    const result = handle.service.pruneOlderThan(cutoffAt);

    if (parsedArgs.json) {
      deps.writeJsonSuccessEnvelope(
        options.commandName,
        {
          store_path: dbPath,
          older_than: olderThan,
          result
        },
        {
          count: result.total_deleted
        }
      );
      return 0;
    }

    deps.writeStdout(renderObservabilityPruneText(result, dbPath, olderThan));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown observability-store prune error";
    if (parsedArgs.json) {
      deps.writeJsonErrorEnvelope(options.commandName, options.errorCode, message, {
        details: {
          store_path: dbPath || null,
          older_than: parsedArgs.olderThan ?? null,
          config_path: parsedArgs.configPath ? deps.resolveCliConfigPath(parsedArgs.configPath) : null
        }
      });
      return 1;
    }

    deps.writeStderr(`Observability-store prune failed: ${message}`);
    return 1;
  } finally {
    deps.closeObservabilityServiceHandle(handle);
  }
}

export function createPruneCli(deps: ObservabilityPruneCommandDeps): {
  getHelpText: () => string;
  printHelp: () => void;
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function getHelpText(): string {
    return `switchmaxxer prune

Usage:
  switchmaxxer prune --older-than <duration> [--json]
  switchmaxxer prune --config <path> [--json]

Description:
  Applies whole observability-store retention. This is not trace-only: it can
  delete old observations, request executions, benchmark rows, cost facts,
  optimization facts, config mutation events, and managed config snapshots.

Flags:
  --older-than <duration>  Delete rows older than a duration like 14d, 168h, 30m, or 2w
  --config <path>         Read observability.retention.older_than from the specified config when --older-than is omitted
  --json                  Emit a stable JSON envelope

Examples:
  switchmaxxer prune --older-than 30d
  switchmaxxer prune --config ./config.json --json

Docs:
  docs/subsystems/observability/tech-spec-for-observability-store-implementation.md

Pro tip:
  smx prune is the official short operator alias form.
`;
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    const parsedArgs = parseObservabilityPruneArgs(deps, argv);
    if (parsedArgs.help) {
      printHelp();
      return 0;
    }

    return runObservabilityPruneCommand(deps, argv, {
      commandName: "prune",
      errorCode: APP_ERROR_CODES.pruneError
    });
  }

  return {
    getHelpText,
    printHelp,
    handleCommand
  };
}
