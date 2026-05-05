import type { AppErrorCode } from "../../../platform/error-codes";
import { createBenchMaintenanceCommands } from "./bench/maintenance-commands";
import { createBenchReadCommands, type BenchObservabilityHandle } from "./bench/read-commands";
import { createBenchRunCommand, type BenchPathMode } from "./bench/run-command";

import type { BenchmarkReportView } from "../../observability/contracts";
import type { BenchmarkRunRecord, BenchmarkRunSummary, BenchmarkSampleRecord } from "../../observability/benchmarks";
import type { ObservabilityRuntimeHandle } from "../../observability/runtime-loader";
import type { AppConfig } from "../../../platform/types";
import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";

export function createBenchCli(deps: {
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
      defaultRun?: (argv: string[]) => Promise<number | undefined>;
    }
  ) => Promise<number | undefined>;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
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
  assertBenchmarkPromptLength: (prompt: string, commandName: "bench" | "bench_run") => void;
  benchLimits: {
    maxConcurrency: number;
    maxIterations: number;
    maxPromptLength: number;
    maxRoutes: number;
  };
  defaultCliFetchTimeoutMs: number;
  openExistingObservabilityService: (dbPath: string) => BenchObservabilityHandle | null;
  openObservabilityService: (dbPath: string) => ObservabilityRuntimeHandle;
  closeObservabilityServiceHandle: (handle: ObservabilityRuntimeHandle | null) => void;
  resolveObservabilityStorePath: () => string;
  loadConfig: (configPath?: string) => AppConfig;
  preflightGatewayRouteTests: (configPath?: string) => Promise<import("../../bench/bench-runtime").BenchmarkPreflightResult>;
  resolveBenchmarkExecutionPlan: (
    pathMode: BenchPathMode,
    preflight: () => Promise<import("../../bench/bench-runtime").BenchmarkPreflightResult>
  ) => Promise<
    | {
        ok: true;
        plan: import("../../bench/bench-runtime").BenchmarkExecutionPlan;
      }
    | {
        ok: false;
        code: string;
        message: string;
        details?: Record<string, unknown>;
      }
  >;
  buildBenchTasks: (
    routeNames: string[],
    effectivePathMode: BenchPathMode,
    warmup: number,
    iterations: number
  ) => import("../../bench/bench-runtime").BenchmarkRunTask[];
  executeBenchmarkTask: (options: {
    service: ObservabilityRuntimeHandle["service"];
    config: AppConfig;
    routeName: string;
    route: AppConfig["routes"][string];
    prompt: string;
    benchmarkRunId: string;
    task: import("../../bench/bench-runtime").BenchmarkRunTask;
    bindHost: string;
    port: number;
    createdBy: string;
    signal?: AbortSignal;
  }) => Promise<{
    sample: BenchmarkSampleRecord;
    requestExecution: import("../../observability/request-executions").RequestExecutionRecord | null;
  }>;
  runTasksWithConcurrency: <T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
    options?: {
      signal?: AbortSignal;
    }
  ) => Promise<T[]>;
  toBenchmarkRunView: (
    run: BenchmarkRunRecord,
    summary: BenchmarkRunSummary
  ) => Record<string, unknown> & { summary: BenchmarkRunSummary };
  toBenchmarkSampleView: (sample: BenchmarkSampleRecord) => Record<string, unknown>;
  buildBenchmarkReportView: (payload: {
    store_path?: string;
    run: Record<string, unknown>;
    summary: BenchmarkRunSummary;
    rawSamples: BenchmarkSampleRecord[];
    samples?: Array<Record<string, unknown>>;
  }) => BenchmarkReportView;
  classifyCliUsageFailure: (
    error: unknown,
    options: {
      usageFallbackCode: string;
      mutationFallbackCode: string;
      isUsageMessage: (message: string) => boolean;
    }
  ) => { message: string; code: string; exitCode: number };
  noUsageMessageMatch: (message: string) => boolean;
  mcpUsageErrorCodes: {
    missingRequiredField: string;
    invalidInputField: string;
    invalidFlagValue: string;
  };
  mcpEntityStateErrorCodes: {
    routeNotFound: string;
  };
  createCliUsageError: (code: string, message: string) => Error;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  const buildHelpText = deps.buildRegisteredFamilyHelpText ?? buildRegisteredFamilyHelpText;

  const { runBenchList, runBenchShow } = createBenchReadCommands({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath,
    toBenchmarkRunView: deps.toBenchmarkRunView,
    toBenchmarkSampleView: deps.toBenchmarkSampleView,
    buildBenchmarkReportView: deps.buildBenchmarkReportView
  });

  const { runBenchPrune, runBenchDelete, runBenchClear } = createBenchMaintenanceCommands({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    openExistingObservabilityService: deps.openExistingObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath
  });

  const { runBenchRun } = createBenchRunCommand({
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJson: deps.writeJson,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    readLongFlagValue: deps.readLongFlagValue,
    assertBenchmarkPromptLength: deps.assertBenchmarkPromptLength,
    benchLimits: deps.benchLimits,
    defaultCliFetchTimeoutMs: deps.defaultCliFetchTimeoutMs,
    openObservabilityService: deps.openObservabilityService,
    closeObservabilityServiceHandle: deps.closeObservabilityServiceHandle,
    resolveObservabilityStorePath: deps.resolveObservabilityStorePath,
    loadConfig: deps.loadConfig,
    preflightGatewayRouteTests: deps.preflightGatewayRouteTests,
    resolveBenchmarkExecutionPlan: deps.resolveBenchmarkExecutionPlan,
    buildBenchTasks: deps.buildBenchTasks,
    executeBenchmarkTask: deps.executeBenchmarkTask,
    runTasksWithConcurrency: deps.runTasksWithConcurrency,
    toBenchmarkRunView: deps.toBenchmarkRunView,
    toBenchmarkSampleView: deps.toBenchmarkSampleView,
    buildBenchmarkReportView: deps.buildBenchmarkReportView,
    classifyCliUsageFailure: deps.classifyCliUsageFailure,
    noUsageMessageMatch: deps.noUsageMessageMatch,
    mcpUsageErrorCodes: deps.mcpUsageErrorCodes,
    mcpEntityStateErrorCodes: deps.mcpEntityStateErrorCodes,
    createCliUsageError: deps.createCliUsageError
  });

  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      {
        name: "list",
        summary: "List persisted benchmark runs",
        usageLines: ["switchmaxxer bench list [--limit <number>] [--json]"],
        exampleLines: ["switchmaxxer bench list"],
        match: matchExactCommand("list"),
        run: async (args) => runBenchList(args)
      },
      deps.createCliCommandRegistration({
        name: "show",
        commandName: "bench show",
        summary: "Show one persisted benchmark run",
        usageLines: ["switchmaxxer bench show <run-id> [--json]"],
        exampleLines: ["switchmaxxer bench show run_123"],
        positionals: [{ label: "<run-id>" }],
        match: matchExactCommand("show"),
        execute: async (showArgs, [runId = ""]) => runBenchShow(runId, showArgs)
      }),
      deps.createCliCommandRegistration({
        name: "prune",
        commandName: "bench prune",
        summary: "Prune old benchmark-history records",
        usageLines: ["switchmaxxer bench prune --older-than <duration> [--json]"],
        exampleLines: ["switchmaxxer bench prune --older-than 30d"],
        match: matchExactCommand("prune"),
        execute: (args) => runBenchPrune(args)
      }),
      deps.createCliCommandRegistration({
        name: "delete",
        commandName: "bench delete",
        summary: "Delete one benchmark-history run",
        usageLines: ["switchmaxxer bench delete <run-id> [--json]"],
        exampleLines: ["switchmaxxer bench delete bench_123"],
        positionals: [{ label: "<run-id>" }],
        match: matchExactCommand("delete"),
        execute: (args, [runId = ""]) => runBenchDelete(runId, args)
      }),
      deps.createCliCommandRegistration({
        name: "clear",
        commandName: "bench clear",
        summary: "Clear benchmark history",
        usageLines: ["switchmaxxer bench clear [--json]"],
        exampleLines: ["switchmaxxer bench clear"],
        match: matchExactCommand("clear"),
        execute: (args) => runBenchClear(args)
      })
    ];
  }

  function getHelpText(): string {
    return buildHelpText({
      title: "switchmaxxer bench",
      description:
        "Benchmarks one or more routes through the local Switchmaxxer gateway, direct upstream providers, or both, then persists the run into the observability store.",
      commands: getCommandRegistry(),
      usageLines: [
        "switchmaxxer bench [--route <route-id>|--routes <csv>] [--prompt <text>|--file <path>] [--iterations <number>] [--concurrency <number>] [--warmup <number>] [--path <gateway|direct|both>] [--timeout-ms <number>] [--config <path>] [--output <path>] [--json]",
        "switchmaxxer bench prune --older-than <duration> [--json]",
        "switchmaxxer bench delete <run-id> [--json]",
        "switchmaxxer bench clear [--json]"
      ],
      flags: [
        "--route <route-id>         Benchmark one route",
        "--routes <csv>             Benchmark a comma-separated route set",
        "--prompt <text>            Prompt text used for the benchmark workload",
        "--file <path>              Read benchmark prompt text from a file",
        "--iterations <n>           Number of measured benchmark iterations",
        "--concurrency <n>          Number of concurrent workers",
        "--warmup <n>               Number of warmup iterations to run before measurement",
        "--path <mode>              Benchmark through gateway, direct upstream, or both",
        "--older-than <duration>    Benchmark-history cleanup cutoff like 30d",
        "--config <path>            Read gateway port and route metadata from the specified config file",
        "--output <path>            Write the benchmark report to a file",
        "--json                     Emit a stable JSON report envelope"
      ],
      notes: [
        "Each run is persisted into the observability store.",
        "`bench list` and `bench show` read the persisted benchmark history.",
        "`bench prune`, `bench delete`, and `bench clear` are benchmark-history cleanup commands.",
        "Benchmark-history cleanup removes benchmark runs and samples; trace rows are left alone.",
        "MCP bench_run adds a 15-minute wall-clock cap by default via SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS; CLI bench relies on --timeout-ms, SIGINT, and process control instead.",
        "Use `switchmaxxer prune --older-than <duration>` for whole-store pruning."
      ],
      exampleLines: [
        "switchmaxxer bench --route gpt-4o-mini --prompt \"hello\"",
        "switchmaxxer bench --routes gpt-4o-mini,claude-sonnet-4-6 --file ./prompt.txt --iterations 5 --path both",
        "switchmaxxer bench --route gpt-4o-mini --prompt \"hello\" --json",
        "switchmaxxer bench prune --older-than 30d"
      ],
      docsPath: "docs/subsystems/observability/tech-spec-for-benchmarking.md",
      proTip: "smx bench is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "bench",
      help: printHelp,
      commands: getCommandRegistry(),
      defaultRun: async (args) => await runBenchRun(args)
    });
  }

  return {
    getHelpText,
    printHelp,
    getCommandRegistry,
    handleCommand
  };
}
