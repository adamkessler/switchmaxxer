import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import { runOptimizeApply } from "./optimize/optimize-cli-apply";
import {
  runOptimizeClear,
  runOptimizeDelete,
  runOptimizeList,
  runOptimizePrune,
  runOptimizeShow
} from "./optimize/optimize-cli-history";
import { runOptimizeRestore } from "./optimize/optimize-cli-restore";
import { runOptimize } from "./optimize/optimize-cli-run";
import type { OptimizeCliDeps } from "./optimize/optimize-types";

export function createOptimizeCli(deps: OptimizeCliDeps): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function getCommandRegistry(): CliCommandRegistration[] {
    return [
      deps.createCliCommandRegistration({
        name: "list",
        commandName: "optimize list",
        summary: "List optimization runs",
        usageLines: ["switchmaxxer optimize list [--limit <number>] [--json]"],
        exampleLines: ["switchmaxxer optimize list"],
        match: matchExactCommand("list"),
        execute: async (args) => runOptimizeList(deps, args)
      }),
      deps.createCliCommandRegistration({
        name: "show",
        commandName: "optimize show",
        summary: "Show one optimization run",
        usageLines: ["switchmaxxer optimize show <run-id> [--json]"],
        exampleLines: ["switchmaxxer optimize show opt_123"],
        positionals: [{ label: "<run-id>" }],
        match: matchExactCommand("show"),
        execute: async (args, [runId = ""]) => runOptimizeShow(deps, runId, args)
      }),
      deps.createCliCommandRegistration({
        name: "prune",
        commandName: "optimize prune",
        summary: "Prune old optimize-history records",
        usageLines: ["switchmaxxer optimize prune --older-than <duration> [--json]"],
        exampleLines: ["switchmaxxer optimize prune --older-than 30d"],
        match: matchExactCommand("prune"),
        execute: (args) => runOptimizePrune(deps, args)
      }),
      deps.createCliCommandRegistration({
        name: "delete",
        commandName: "optimize delete",
        summary: "Delete one optimize-history run",
        usageLines: ["switchmaxxer optimize delete <run-id> [--json]"],
        exampleLines: ["switchmaxxer optimize delete opt_123"],
        positionals: [{ label: "<run-id>" }],
        match: matchExactCommand("delete"),
        execute: (args, [runId = ""]) => runOptimizeDelete(deps, runId, args)
      }),
      deps.createCliCommandRegistration({
        name: "clear",
        commandName: "optimize clear",
        summary: "Clear optimize-history records",
        usageLines: ["switchmaxxer optimize clear [--json]"],
        exampleLines: ["switchmaxxer optimize clear"],
        match: matchExactCommand("clear"),
        execute: (args) => runOptimizeClear(deps, args)
      }),
      deps.createCliCommandRegistration({
        name: "apply",
        commandName: "optimize apply",
        summary: "Apply the winning provider to a route",
        usageLines: ["switchmaxxer optimize apply <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]"],
        exampleLines: [
          "switchmaxxer optimize apply opt_123 --route gpt-4o-mini --dry-run",
          "switchmaxxer optimize apply opt_123 --route gpt-4o-mini --reload --verify"
        ],
        positionals: [{ label: "<run-id>" }],
        match: matchExactCommand("apply"),
        execute: async (args, [applyRunId = ""]) => await runOptimizeApply(deps, applyRunId, args)
      }),
      deps.createCliCommandRegistration({
        name: "restore",
        commandName: "optimize restore",
        summary: "Restore the provider changed by optimize apply",
        usageLines: [
          "switchmaxxer optimize restore <apply-action-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]",
          "switchmaxxer optimize restore <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]"
        ],
        exampleLines: [
          "switchmaxxer optimize restore 4fd6f7aa-0f55-4ccb-b2e5-6d17fd8ce9bb --dry-run",
          "switchmaxxer optimize restore opt_123 --route gpt-4o-mini --dry-run",
          "switchmaxxer optimize restore opt_123 --route gpt-4o-mini --reload --verify"
        ],
        positionals: [{ label: "<apply-action-id|run-id>" }],
        match: matchExactCommand("restore"),
        execute: async (args, [restoreSelector = ""]) => await runOptimizeRestore(deps, restoreSelector, args)
      })
    ];
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer optimize",
      description:
        "Ranks candidate routes for one canonical model by estimated cost or measured latency, then can apply or restore a route provider.",
      commands: getCommandRegistry(),
      usageLines: [
        "switchmaxxer optimize --model <model-id> --objective cost [--routes <csv>] [--input-tokens <n>] [--output-tokens <n>] [--cache-read-tokens <n>] [--cache-write-tokens <n>] [--config <path>] [--output <path>] [--json]",
        "switchmaxxer optimize --model <model-id> --objective latency (--prompt <text>|--file <path>) [--routes <csv>] [--iterations <n>] [--warmup <n>] [--concurrency <n>] [--path <gateway|direct|both>] [--timeout-ms <n>] [--config <path>] [--output <path>] [--json]",
        "switchmaxxer optimize prune --older-than <duration> [--json]",
        "switchmaxxer optimize delete <run-id> [--json]",
        "switchmaxxer optimize clear [--json]",
        "switchmaxxer optimize apply <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]",
        "switchmaxxer optimize restore <apply-action-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]",
        "switchmaxxer optimize restore <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]"
      ],
      flags: [
        "--model <model-id>          Target canonical model",
        "--objective <name>         Rank by cost or latency",
        "--routes <csv>             Optional candidate route allow-list",
        "--input-tokens <n>         Reference input token count; default 1000",
        "--output-tokens <n>        Reference output token count; default 1000",
        "--cache-read-tokens <n>    Reference cache-read token count; default 0",
        "--cache-write-tokens <n>   Reference cache-write token count; default 0",
        "--prompt <text>            Prompt for latency benchmark runs",
        "--file <path>              Read the latency benchmark prompt from a file",
        "--iterations <n>           Measured latency samples per route/path; default 3",
        "--warmup <n>               Warmup samples per route/path; default 1",
        "--concurrency <n>          Concurrent benchmark tasks; default 1",
        "--path <mode>              Benchmark gateway, direct, or both paths; default both",
        "--timeout-ms <n>           Per-request latency benchmark timeout",
        "--older-than <duration>    Optimize-history cleanup cutoff like 30d",
        "--route <route-id>         Route to mutate for optimize apply or restore",
        "--dry-run                  Preview optimize apply/restore without changing catalog.json",
        "--verify                   Run a route test after optimize apply/restore",
        "--reload                   Reload the managed gateway after optimize apply/restore",
        "--config <path>            Use the specified config file",
        "--output <path>            Write the optimize report to a file",
        "--json                     Emit a stable JSON report envelope"
      ],
      notes: [
        "The default optimize run surface does not mutate config.",
        "`optimize apply` mutates only the target route's service_provider to the persisted winner's provider.",
        "`optimize apply` writes a managed observability snapshot and action event before mutation when a change is needed.",
        "`optimize restore` uses the apply action event to change that same route's service_provider back.",
        "Each optimize run is persisted into the observability store.",
        "`optimize list` and `optimize show` read the persisted optimize-history records.",
        "`optimize prune`, `optimize delete`, and `optimize clear` are optimize-history cleanup commands.",
        "Optimize-history cleanup removes optimize runs plus their optimize apply/restore events and managed snapshots; trace and benchmark rows are left alone.",
        "MCP optimize_run latency benchmarks share the MCP bench_run wall-clock cap; CLI optimize relies on --timeout-ms, SIGINT, and process control instead.",
        "Use `switchmaxxer prune --older-than <duration>` for whole-store pruning."
      ],
      exampleLines: [
        "switchmaxxer optimize --model gpt-4o-mini --objective cost",
        "switchmaxxer optimize --model gpt-4o-mini --objective cost --input-tokens 2000 --output-tokens 500 --json",
        "switchmaxxer optimize --model gpt-4o-mini --objective latency --prompt 'Say pong' --iterations 5",
        "switchmaxxer optimize prune --older-than 30d"
      ],
      docsPath: "docs/subsystems/observability/tech-spec-for-optimize-command.md",
      proTip: "smx optimize is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "optimize",
      help: printHelp,
      commands: getCommandRegistry(),
      defaultRun: async (args) => runOptimize(deps, args)
    });
  }

  return {
    getHelpText,
    printHelp,
    getCommandRegistry,
    handleCommand
  };
}

export type { OptimizeCliDeps };
