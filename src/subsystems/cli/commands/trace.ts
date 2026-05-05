import type { AppErrorCode } from "../../../platform/error-codes";
import type { ObservabilityModule } from "../../observability/observability-module";
import { resolveObservabilityStorePath as resolveConfiguredObservabilityStorePath } from "../../observability/runtime-loader";

import type { BenchmarkSampleRecord } from "../../observability/benchmarks";
import type {
  RequestExecutionRecord
} from "../../observability/request-executions";
import type { ObservationEvent, ObservationKind, ObservationOutcome, ObservationRecord } from "../../observability/types";
import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import { createTraceReadCommands } from "./trace/read-commands";
import { createTraceMaintenanceCommands } from "./trace/maintenance-commands";

export function createTraceCli(deps: {
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
  getCliEnv: () => NodeJS.ProcessEnv;
  observabilityModule: ObservabilityModule;
  toTraceSummaryView: (trace: RequestExecutionRecord) => Record<string, unknown>;
  toTraceObservationView: (observation: ObservationRecord) => Record<string, unknown>;
  toBenchmarkSampleView: (sample: BenchmarkSampleRecord) => Record<string, unknown>;
  observationOutcomes: readonly ObservationOutcome[];
  observationKinds: readonly ObservationKind[];
  observationEvents: readonly ObservationEvent[];
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  const buildHelpText = deps.buildRegisteredFamilyHelpText ?? buildRegisteredFamilyHelpText;

  function resolveObservabilityStorePath(): string {
    return resolveConfiguredObservabilityStorePath({
      env: deps.getCliEnv()
    });
  }

  const traceReadCommands = createTraceReadCommands({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    traceQueries: deps.observabilityModule.trace,
    toTraceSummaryView: deps.toTraceSummaryView,
    toTraceObservationView: deps.toTraceObservationView,
    toBenchmarkSampleView: deps.toBenchmarkSampleView,
    resolveObservabilityStorePath,
    observationOutcomes: deps.observationOutcomes,
    observationKinds: deps.observationKinds,
    observationEvents: deps.observationEvents
  });
  const {
    runTraceList,
    runTraceShow,
    runTraceStats,
    runTraceObservations
  } = traceReadCommands;
  const {
    runTraceVerify,
    runTraceRepair
  } = createTraceMaintenanceCommands({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    traceMaintenance: deps.observabilityModule.traceMaintenance,
    resolveObservabilityStorePath
  });

  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "list",
        summary: "List recorded traces",
        usageLines: ["switchmaxxer trace list [--route <route-id>] [--provider <provider-id>] [--outcome <value>] [--limit <number>] [--json]"],
        exampleLines: ["switchmaxxer trace list", "switchmaxxer trace list --route gpt-4o-mini", "switchmaxxer trace list --outcome failed --limit 10"],
        match: matchExactCommand("list"),
        run: async (args) => runTraceList(args)
      },
      {
        name: "stats",
        summary: "Show aggregate trace stats",
        usageLines: ["switchmaxxer trace stats [--route <route-id>] [--provider <provider-id>] [--outcome <value>] [--json]"],
        exampleLines: ["switchmaxxer trace stats", "switchmaxxer trace stats --route gpt-4o-mini"],
        match: matchExactCommand("stats"),
        run: async (args) => runTraceStats(args)
      },
      {
        name: "observations",
        summary: "List raw trace observations",
        usageLines: ["switchmaxxer trace observations [--route <route-id>] [--provider <provider-id>] [--kind <value>] [--event <value>] [--limit <number>] [--json]"],
        exampleLines: ["switchmaxxer trace observations --kind error --limit 20"],
        match: matchExactCommand("observations"),
        run: async (args) => runTraceObservations(args)
      },
      deps.createCliCommandRegistration({
        name: "show",
        commandName: "trace show",
        summary: "Show one trace execution",
        usageLines: ["switchmaxxer trace show <trace-id> [--json]"],
        exampleLines: ["switchmaxxer trace show trace-123"],
        positionals: [{ label: "<trace-id>", rejectFlagLike: false }],
        match: matchExactCommand("show"),
        execute: async (showArgs, [traceId = ""]) => runTraceShow(traceId, showArgs)
      }),
      {
        name: "verify",
        summary: "Verify persisted trace summaries",
        usageLines: ["switchmaxxer trace verify [<trace-id>|--all] [--batch-size <number>] [--json]"],
        exampleLines: ["switchmaxxer trace verify --all"],
        match: matchExactCommand("verify"),
        run: async (args) => runTraceVerify(args)
      },
      {
        name: "repair",
        summary: "Repair persisted trace summaries",
        usageLines: ["switchmaxxer trace repair [<trace-id>|--all] [--batch-size <number>] [--json]"],
        exampleLines: ["switchmaxxer trace repair req-123"],
        match: matchExactCommand("repair"),
        run: async (args) => runTraceRepair(args)
      }
    ];
  }

  function getHelpText(): string {
    return buildHelpText({
      title: "switchmaxxer trace",
      description: "Inspects recorded invocation traces from the local observability store.",
      commands: getCommandRegistry(),
      flags: [
        "trace list: --route <route-id>  Filter by route_id or route_name",
        "trace list: --provider <provider-id>  Filter by provider_id",
        "trace list: --outcome <value>  Filter by request outcome",
        "trace list: --limit <number>  Limit the number of returned traces",
        "trace list: --json  Emit a simple JSON envelope",
        "trace stats: --route <route-id>  Filter by route_id or route_name",
        "trace stats: --provider <provider-id>  Filter by provider_id",
        "trace stats: --outcome <value>  Filter by request outcome",
        "trace stats: --json  Emit a simple JSON envelope",
        "trace observations: --route <route-id>  Filter by route_id or route_name",
        "trace observations: --provider <provider-id>  Filter by provider_id",
        "trace observations: --kind <value>  Filter by observation kind",
        "trace observations: --event <value>  Filter by observation event",
        "trace observations: --limit <number>  Limit the number of returned observations",
        "trace observations: --json  Emit a simple JSON envelope",
        "trace verify/repair: --all  Verify or repair every known trace summary",
        "trace verify/repair: --batch-size <number>  Process whole-store verify / repair work in bounded batches",
        "trace verify/repair: --json  Emit a simple JSON envelope"
      ],
      notes: ["In v1, <trace-id> resolves to the persisted request identifier for the recorded execution."],
      docsPath: "docs/subsystems/observability/contracts/tech-spec-for-observation-semantics.md",
      proTip: "smx trace is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "trace",
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
