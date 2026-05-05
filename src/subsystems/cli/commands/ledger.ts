import { APP_ERROR_CODES, type AppErrorCode } from "../../../platform/error-codes";
import { retentionDurationToCutoffIso } from "../../../platform/retention-duration";
import {
  parsePositiveIntegerFlagValue
} from "../command-arg-primitives";
import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import {
  CONTROL_PLANE_ACTION_OPERATIONS,
  CONTROL_PLANE_ACTION_SOURCE_SURFACES,
  CONTROL_PLANE_ACTION_STATUSES,
  CONTROL_PLANE_ACTION_TARGET_KINDS,
  type ControlPlaneActionOperation,
  type ControlPlaneActionSourceSurface,
  type ControlPlaneActionStatus,
  type ControlPlaneActionTargetKind,
  type ListControlPlaneActionEventsOptions
} from "../../observability/control-plane-actions";
import {
  toControlPlaneActionDetailView,
  toControlPlaneActionSummaryView
} from "../../observability/contracts";
import type { ObservabilityLedgerPort } from "../../observability/observability-module";

export type LedgerCommandDeps = {
  buildRegisteredFamilyHelpText?: typeof buildRegisteredFamilyHelpText;
  createCliCommandRegistration: (options: {
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
  runRegisteredCommandFamily: (
    argv: string[],
    options: {
      familyName: string;
      help: () => void;
      commands: CliCommandRegistration[];
    }
  ) => Promise<number | undefined>;
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
  ledger: ObservabilityLedgerPort;
  resolveObservabilityStorePath: () => string;
};

type LedgerListArgs = {
  routeId?: string;
  targetId?: string;
  targetKind?: ControlPlaneActionTargetKind;
  operation?: ControlPlaneActionOperation;
  status?: ControlPlaneActionStatus;
  sourceSurface?: ControlPlaneActionSourceSurface;
  sessionId?: string;
  optimizationRunId?: string;
  mutationEventId?: string;
  since?: string;
  cutoffAt?: string;
  limit?: number;
  json: boolean;
  errorMessage?: string;
};

function allowedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

function parseKnownValue<T extends string>(
  value: string,
  flagName: string,
  allowedValues: readonly T[]
): { value?: T; errorMessage?: string } {
  if ((allowedValues as readonly string[]).includes(value)) {
    return { value: value as T };
  }

  return {
    errorMessage: `Flag '${flagName}' must be one of ${allowedList(allowedValues)}`
  };
}

function parseLedgerListArgs(deps: LedgerCommandDeps, argv: string[]): LedgerListArgs {
  let routeId: string | undefined;
  let targetId: string | undefined;
  let targetKind: ControlPlaneActionTargetKind | undefined;
  let operation: ControlPlaneActionOperation | undefined;
  let status: ControlPlaneActionStatus | undefined;
  let sourceSurface: ControlPlaneActionSourceSurface | undefined;
  let sessionId: string | undefined;
  let optimizationRunId: string | undefined;
  let mutationEventId: string | undefined;
  let since: string | undefined;
  let cutoffAt: string | undefined;
  let limit: number | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    for (const flagName of [
      "--route",
      "--target",
      "--target-kind",
      "--operation",
      "--status",
      "--surface",
      "--session-id",
      "--run-id",
      "--mutation-event-id",
      "--since",
      "--limit"
    ] as const) {
      const parsedFlag = deps.readLongFlagValue(argv, index, flagName);
      if (!parsedFlag) {
        continue;
      }

      if (parsedFlag.errorMessage) {
        return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: parsedFlag.errorMessage };
      }

      const nextArg = parsedFlag.value as string;

      if (flagName === "--route") {
        routeId = nextArg;
      } else if (flagName === "--target") {
        targetId = nextArg;
      } else if (flagName === "--target-kind") {
        const parsed = parseKnownValue(nextArg, flagName, CONTROL_PLANE_ACTION_TARGET_KINDS);
        if (parsed.errorMessage) {
          return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: parsed.errorMessage };
        }
        targetKind = parsed.value;
      } else if (flagName === "--operation") {
        const parsed = parseKnownValue(nextArg, flagName, CONTROL_PLANE_ACTION_OPERATIONS);
        if (parsed.errorMessage) {
          return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: parsed.errorMessage };
        }
        operation = parsed.value;
      } else if (flagName === "--status") {
        const parsed = parseKnownValue(nextArg, flagName, CONTROL_PLANE_ACTION_STATUSES);
        if (parsed.errorMessage) {
          return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: parsed.errorMessage };
        }
        status = parsed.value;
      } else if (flagName === "--surface") {
        const parsed = parseKnownValue(nextArg, flagName, CONTROL_PLANE_ACTION_SOURCE_SURFACES);
        if (parsed.errorMessage) {
          return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: parsed.errorMessage };
        }
        sourceSurface = parsed.value;
      } else if (flagName === "--session-id") {
        sessionId = nextArg;
      } else if (flagName === "--run-id") {
        optimizationRunId = nextArg;
      } else if (flagName === "--mutation-event-id") {
        mutationEventId = nextArg;
      } else if (flagName === "--since") {
        try {
          cutoffAt = retentionDurationToCutoffIso(nextArg);
          since = nextArg;
        } catch {
          return {
            routeId,
            targetId,
            targetKind,
            operation,
            status,
            sourceSurface,
            sessionId,
            optimizationRunId,
            mutationEventId,
            since,
            cutoffAt,
            limit,
            json,
            errorMessage: "Flag '--since' must be one of <number>m, <number>h, <number>d, or <number>w"
          };
        }
      } else {
        const parsed = parsePositiveIntegerFlagValue(nextArg, "--limit");
        if (parsed.errorMessage || typeof parsed.value !== "number") {
          return {
            routeId,
            targetId,
            targetKind,
            operation,
            status,
            sourceSurface,
            sessionId,
            optimizationRunId,
            mutationEventId,
            since,
            cutoffAt,
            limit,
            json,
            errorMessage: "Flag '--limit' requires a positive integer value"
          };
        }

        limit = parsed.value;
      }

      index += parsedFlag.consumed;
      continue argLoop;
    }

    return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { routeId, targetId, targetKind, operation, status, sourceSurface, sessionId, optimizationRunId, mutationEventId, since, cutoffAt, limit, json };
}

function parseLedgerShowArgs(argv: string[]): { json: boolean; errorMessage?: string } {
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    return { json, errorMessage: `Unknown flag '${arg}'` };
  }

  return { json };
}

function filtersFromArgs(args: LedgerListArgs): ListControlPlaneActionEventsOptions {
  return {
    routeId: args.routeId,
    targetId: args.targetId,
    targetKind: args.targetKind,
    operation: args.operation,
    status: args.status,
    sourceSurface: args.sourceSurface,
    sessionId: args.sessionId,
    optimizationRunId: args.optimizationRunId,
    mutationEventId: args.mutationEventId,
    createdSince: args.cutoffAt,
    limit: args.limit ?? 25
  };
}

function filterViewFromArgs(args: LedgerListArgs): Record<string, unknown> {
  return {
    route_id: args.routeId ?? null,
    target_id: args.targetId ?? null,
    target_kind: args.targetKind ?? null,
    operation: args.operation ?? null,
    status: args.status ?? null,
    source_surface: args.sourceSurface ?? null,
    session_id: args.sessionId ?? null,
    optimization_run_id: args.optimizationRunId ?? null,
    mutation_event_id: args.mutationEventId ?? null,
    since: args.since ?? null,
    cutoff_at: args.cutoffAt ?? null,
    limit: args.limit ?? 25
  };
}

function renderLedgerListText(options: {
  events: Array<Record<string, unknown>>;
  storePath: string;
  filters: Record<string, unknown>;
}): string {
  const lines = [
    `Ledger events (${options.events.length})`,
    `Store: ${options.storePath}`
  ];

  if (Object.values(options.filters).some((value) => value !== null && typeof value !== "undefined")) {
    lines.push(`Filters: ${JSON.stringify(options.filters)}`);
  }

  if (options.events.length === 0) {
    lines.push("", "No Ledger events found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const event of options.events) {
    lines.push(
      `${String(event["ledger_event_id"])}  created_at=${String(event["created_at"])}  surface=${String(
        event["source_surface"]
      )}  operation=${String(event["operation"])}  status=${String(event["status"])}  target=${String(
        event["target_kind"] ?? "-"
      )}:${String(
        event["target_id"] ?? "-"
      )}  run=${String(event["optimization_run_id"] ?? "-")}  mutation_event=${String(
        event["mutation_event_id"] ?? "-"
      )}  session=${String(event["session_id"] ?? "-")}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderLedgerShowText(event: Record<string, unknown>, storePath: string): string {
  return `${[
    `Ledger Event: ${String(event["ledger_event_id"])}`,
    `Store: ${storePath}`,
    `Created At: ${String(event["created_at"])}`,
    `Finished At: ${String(event["finished_at"] ?? "-")}`,
    `Surface: ${String(event["source_surface"])}`,
    `Actor: ${String(event["actor_kind"])}${event["actor_id"] ? `:${String(event["actor_id"])}` : ""}`,
    `Session: ${String(event["session_id"] ?? "-")}`,
    `Operation: ${String(event["operation"])}`,
    `Status: ${String(event["status"])}`,
    `Target: ${String(event["target_kind"])} ${String(event["target_id"] ?? "-")}`,
    `Optimize Run: ${String(event["optimization_run_id"] ?? "-")}`,
    `Mutation Event: ${String(event["mutation_event_id"] ?? "-")}`,
    "",
    "Correlation IDs:",
    JSON.stringify(event["correlation_ids"] ?? {}, null, 2),
    "",
    "Result:",
    JSON.stringify(event["result"] ?? {}, null, 2),
    "",
    "Error:",
    JSON.stringify(event["error"] ?? {}, null, 2),
    "",
    "Metadata:",
    JSON.stringify(event["metadata"] ?? {}, null, 2)
  ].join("\n")}\n`;
}

export function createLedgerCli(deps: LedgerCommandDeps): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  const buildHelpText = deps.buildRegisteredFamilyHelpText ?? buildRegisteredFamilyHelpText;

  function runLedgerList(argv: string[]): number {
    const parsedArgs = parseLedgerListArgs(deps, argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const filters = filtersFromArgs(parsedArgs);
      const ledgerResult = deps.ledger.list({
        dbPath,
        filters
      });
      const { events } = ledgerResult;
      const eventViews = events.map((event) => toControlPlaneActionSummaryView(event));
      const filterView = filterViewFromArgs(parsedArgs);

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(
          "ledger list",
          {
            store_path: dbPath,
            filters: filterView,
            events: eventViews
          },
          {
            count: eventViews.length,
            warnings: ledgerResult.storeFound ? undefined : ["No observability store was found yet."]
          }
        );
        return 0;
      }

      deps.writeStdout(renderLedgerListText({ events: eventViews, storePath: dbPath, filters: filterView }));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown ledger list error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("ledger list", APP_ERROR_CODES.ledgerListError, message, {
          details: { store_path: dbPath || null }
        });
        return 1;
      }

      deps.writeStderr(`Ledger list failed: ${message}`);
      return 1;
    }
  }

  function runLedgerShow(ledgerEventId: string, argv: string[]): number {
    const parsedArgs = parseLedgerShowArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let dbPath = "";

    try {
      dbPath = deps.resolveObservabilityStorePath();
      const ledgerResult = deps.ledger.show({
        dbPath,
        ledgerEventId
      });
      const { event } = ledgerResult;

      if (!event) {
        const message = `Ledger event '${ledgerEventId}' was not found`;
        if (parsedArgs.json) {
          deps.writeJsonErrorEnvelope("ledger show", APP_ERROR_CODES.ledgerNotFound, message, {
            details: { store_path: dbPath, ledger_event_id: ledgerEventId }
          });
          return 1;
        }

        deps.writeStderr(message);
        return 1;
      }

      const eventView = toControlPlaneActionDetailView(event);
      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope("ledger show", {
          store_path: dbPath,
          event: eventView
        });
        return 0;
      }

      deps.writeStdout(renderLedgerShowText(eventView, dbPath));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown ledger show error";
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("ledger show", APP_ERROR_CODES.ledgerShowError, message, {
          details: { store_path: dbPath || null, ledger_event_id: ledgerEventId }
        });
        return 1;
      }

      deps.writeStderr(`Ledger show failed: ${message}`);
      return 1;
    }
  }

  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "list",
        summary: "List Control Plane Audit Ledger events",
        usageLines: ["switchmaxxer ledger list [--route <route-id>] [--target <id>] [--target-kind <kind>] [--operation <operation>] [--status <status>] [--surface <cli|mcp>] [--session-id <id>] [--run-id <run-id>] [--mutation-event-id <event-id>] [--since <duration>] [--limit <number>] [--json]"],
        exampleLines: ["switchmaxxer ledger list --status failed", "switchmaxxer ledger list --target-kind provider --operation providers_update --json"],
        match: matchExactCommand("list"),
        run: async (args) => runLedgerList(args)
      },
      deps.createCliCommandRegistration({
        name: "show",
        commandName: "ledger show",
        summary: "Show one Control Plane Audit Ledger event",
        usageLines: ["switchmaxxer ledger show <ledger-event-id> [--json]"],
        exampleLines: ["switchmaxxer ledger show ledger-event-id --json"],
        positionals: [{ label: "<ledger-event-id>" }],
        match: matchExactCommand("show"),
        execute: (showArgs, [ledgerEventId = ""]) => runLedgerShow(ledgerEventId, showArgs)
      })
    ];
  }

  function getHelpText(): string {
    return buildHelpText({
      title: "switchmaxxer ledger",
      description: "Inspects Control Plane Audit Ledger events from the local observability store.",
      commands: getCommandRegistry(),
      flags: [
        "ledger list: --route <route-id>  Filter by target route",
        "ledger list: --target <id>  Filter by target model, provider, or route id",
        `ledger list: --target-kind <${CONTROL_PLANE_ACTION_TARGET_KINDS.join("|")}>  Filter by target kind`,
        "ledger list: --operation <operation>  Filter by control-plane operation",
        "ledger list: --status <status>  Filter by attempt outcome",
        "ledger list: --surface <cli|mcp>  Filter by invoking surface",
        "ledger list: --session-id <id>  Filter by MCP session id",
        "ledger list: --run-id <run-id>  Filter by optimize run id",
        "ledger list: --mutation-event-id <event-id>  Filter by committed mutation event id",
        "ledger list: --since <duration>  Include events created within a recent duration",
        "ledger list: --limit <number>  Limit the number of returned events",
        "ledger list/show: --json  Emit a JSON envelope"
      ],
      notes: [
        "The Ledger records control-plane attempts. Committed restore points live in config_mutation_events."
      ],
      docsPath: "docs/subsystems/observability/contracts/tech-spec-for-control-plane-audit-ledger.md",
      proTip: "smx ledger is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "ledger",
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
