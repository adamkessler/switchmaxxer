import type { BenchmarkPreflightResult } from "../../../bench/bench-runtime";
import type {
  OptimizeApplyReloadView,
  OptimizeApplyVerificationView
} from "../../../observability/optimize-ledger-views";
import type { AppConfig, CliReadModel } from "../../../../platform/types";
import type { CliCommandRegistration } from "../../registry";
import type {
  OptimizeApplyArgs,
  OptimizeListArgs,
  OptimizePruneArgs,
  OptimizeRunArgs,
  OptimizeShowArgs
} from "../../command-args-optimize";
import type {
  BeginPlannedExternalOptimizeApplyMutationResponse,
  BeginPlannedExternalOptimizeRestoreMutationResponse
} from "../../../observability/observability-ipc-optimize-mutation-executor";
import type {
  BuildExternalOptimizeMutationCommandOptions,
  ObservabilityOptimizeMutationPlanApplyCommand,
  ObservabilityOptimizeMutationPlanRestoreCommand
} from "../../../observability/observability-ipc-optimize-mutation-plan";
import type {
  ObservabilityBenchmarkRunPort,
  ObservabilityOptimizationReportPort,
  ObservabilityOptimizeMutationPort,
  ObservabilityOptimizationHistoryPort
} from "../../../observability/observability-module";

export type OptimizeCliDeps = {
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
    unsupportedMessage?: string;
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
      missingSubcommandMessage?: string;
    }
  ) => Promise<number | undefined>;
  parseOptimizeRunArgs: (argv: string[]) => OptimizeRunArgs;
  parseOptimizeListArgs: (argv: string[]) => OptimizeListArgs;
  parseOptimizePruneArgs: (argv: string[]) => OptimizePruneArgs;
  parseOptimizeShowArgs: (argv: string[]) => OptimizeShowArgs;
  parseOptimizeApplyArgs: (argv: string[]) => OptimizeApplyArgs;
  loadConfig: (configPath?: string) => AppConfig;
  loadCliReadModel: (configPath?: string) => CliReadModel;
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableConfigSection: (
    document: Record<string, unknown>,
    sectionName: "models" | "service_providers" | "routes"
  ) => Record<string, unknown>;
  optimizationHistory: ObservabilityOptimizationHistoryPort;
  optimizationReports: ObservabilityOptimizationReportPort;
  optimizeMutations: ObservabilityOptimizeMutationPort;
  beginOptimizeApplyMutation: (options: {
    id: string;
    dbPath: string;
    configPath: string | undefined;
    readModel: CliReadModel;
    loadReadModel: () => CliReadModel;
    mutateConfigDocument: OptimizeCliDeps["mutateConfigDocument"];
    getMutableConfigSection: OptimizeCliDeps["getMutableConfigSection"];
    plan: BuildExternalOptimizeMutationCommandOptions & {
      command: ObservabilityOptimizeMutationPlanApplyCommand;
    };
  }) => BeginPlannedExternalOptimizeApplyMutationResponse;
  beginOptimizeRestoreMutation: (options: {
    id: string;
    dbPath: string;
    configPath: string | undefined;
    readModel: CliReadModel;
    loadReadModel: () => CliReadModel;
    mutateConfigDocument: OptimizeCliDeps["mutateConfigDocument"];
    getMutableConfigSection: OptimizeCliDeps["getMutableConfigSection"];
    plan: BuildExternalOptimizeMutationCommandOptions & {
      command: ObservabilityOptimizeMutationPlanRestoreCommand;
    };
  }) => BeginPlannedExternalOptimizeRestoreMutationResponse;
  benchmarkRuns: ObservabilityBenchmarkRunPort;
  resolveObservabilityStorePath: () => string;
  defaultCliFetchTimeoutMs: number;
  preflightGatewayRouteTests: (configPath?: string) => Promise<BenchmarkPreflightResult>;
  runOptimizeApplyReload: (options: { configPath?: string; operation?: "apply" | "restore" }) => Promise<OptimizeApplyReloadView>;
  runOptimizeApplyVerify: (options: { configPath?: string; routeId: string; operation?: "apply" | "restore" }) => Promise<OptimizeApplyVerificationView>;
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
};
