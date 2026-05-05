import type { ProxyRequestContext, RouteConfig, RouteReadModel } from "../../platform/types";
import {
  bootstrapGatewayObservability,
  configureGatewayObservability,
  pruneGatewayObservabilityRetentionNow,
  recordGatewayFailureObservation,
  recordGatewayObservation,
  shutdownGatewayObservability,
  type GatewayObservationInput
} from "./gateway";
import {
  getGatewayObservabilityDbPath,
  getGatewayObservabilityService
} from "./gateway-observability-runtime";
import type {
  ConfigMutationAuditFinishOptions,
  ConfigMutationAuditStartOptions
} from "./config-mutation-audit";
import {
  finishConfigMutationControlPlaneAudit,
  startConfigMutationControlPlaneAudit
} from "./config-mutation-audit";
import type {
  ControlPlaneActionEventRecord,
  ListControlPlaneActionEventsOptions
} from "./control-plane-actions";
import {
  closeObservabilityServiceHandle,
  openExistingObservabilityService,
  openObservabilityService,
  type ObservabilityRuntimeHandle
} from "./runtime-loader";
import type {
  BenchmarkRunRecord,
  BenchmarkRunSummary,
  BenchmarkSampleRecord
} from "./benchmarks";
import {
  runBenchmarkOperation,
  type BenchmarkOperationOptions,
  type BenchmarkRunnerResult
} from "./ostrich/benchmark/bench-runner";
import type { ObservationQueryOptions } from "./ostrich/query/repository";
import type {
  ListRequestExecutionOptions,
  RequestExecutionRepairResult,
  RequestExecutionRecord,
  RequestExecutionStats,
  RequestExecutionVerificationResult
} from "./request-executions";
import type {
  BenchmarkHistoryDeleteResult,
  ObservabilityPruneResult,
  ObservabilityService,
  OptimizeHistoryDeleteResult
} from "./service";
import type { OptimizationRunRecord } from "./ostrich/optimization/optimizations";
import {
  persistCostOptimizeReport,
  persistLatencyOptimizeReport,
  type OptimizeReferenceTokens,
  type OptimizeReportView
} from "./optimize-report-builder";
import {
  runOptimizeApplyMutation,
  runOptimizeRestoreMutation,
  type OptimizeApplyMutationServiceResult,
  type OptimizeRestoreMutationServiceResult,
  type RunOptimizeApplyMutationOptions,
  type RunOptimizeRestoreMutationOptions
} from "./ostrich/optimization/optimize-orchestrator";
import type { ObservationRecord } from "./types";

export type ObservabilityModuleId = "ostrich" | "osprey" | "owl";

export type ObservabilityModuleRuntime = "in_process_typescript" | "external_java" | "external_rust";

export interface ObservabilityModuleCapabilities {
  readonly gatewayObservationWrites: boolean;
  readonly localReadModel: boolean;
  readonly retentionPruning: boolean;
  readonly gracefulShutdownDrain: boolean;
}

export interface ObservabilityModuleConfigureOptions {
  retentionOlderThan?: string | null;
  disabled?: boolean;
  dbPath?: string | null;
}

export interface ObservabilityModuleDescriptor {
  readonly id: ObservabilityModuleId;
  readonly runtime: ObservabilityModuleRuntime;
  readonly displayName: string;
  readonly capabilities: ObservabilityModuleCapabilities;
}

export interface ObservabilityTraceStatsResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly stats: RequestExecutionStats;
}

export interface ObservabilityTraceListResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly traces: RequestExecutionRecord[];
}

export interface ObservabilityTraceObservationsResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly observations: ObservationRecord[];
}

export interface ObservabilityTraceShowResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly requestExecution: RequestExecutionRecord | null;
  readonly observations: ObservationRecord[];
  readonly benchmarkSamples: BenchmarkSampleRecord[];
}

export interface ObservabilityTraceQueryPort {
  list(options: {
    dbPath: string;
    filters?: ListRequestExecutionOptions;
  }): ObservabilityTraceListResult;
  listObservations(options: {
    dbPath: string;
    filters?: ObservationQueryOptions;
  }): ObservabilityTraceObservationsResult;
  getStats(options: {
    dbPath: string;
    filters?: ListRequestExecutionOptions;
  }): ObservabilityTraceStatsResult;
  show(options: {
    dbPath: string;
    traceId: string;
  }): ObservabilityTraceShowResult;
}

export interface ObservabilityTraceMaintenanceResult<T> {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly results: T[];
}

export interface ObservabilityTraceMaintenancePort {
  verify(options: {
    dbPath: string;
    all: boolean;
    traceId?: string;
    batchSize?: number;
  }): ObservabilityTraceMaintenanceResult<RequestExecutionVerificationResult>;
  repair(options: {
    dbPath: string;
    all: boolean;
    traceId?: string;
    batchSize?: number;
  }): ObservabilityTraceMaintenanceResult<RequestExecutionRepairResult>;
}

export interface ObservabilityRetentionPruneResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: ObservabilityPruneResult | null;
}

export interface ObservabilityRetentionPort {
  pruneOlderThan(options: {
    dbPath: string;
    cutoffIso: string;
  }): ObservabilityRetentionPruneResult;
}

export interface ObservabilityLedgerListResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly events: ControlPlaneActionEventRecord[];
}

export interface ObservabilityLedgerShowResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly event: ControlPlaneActionEventRecord | null;
}

export interface ObservabilityLedgerPort {
  list(options: {
    dbPath: string;
    filters?: ListControlPlaneActionEventsOptions;
  }): ObservabilityLedgerListResult;
  show(options: {
    dbPath: string;
    ledgerEventId: string;
  }): ObservabilityLedgerShowResult;
}

export interface ObservabilityControlPlaneAuditStartResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly actionId: string | null;
}

export interface ObservabilityControlPlaneAuditFinishResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
}

export interface ObservabilityControlPlaneAuditPort {
  startConfigMutation(options: Omit<ConfigMutationAuditStartOptions, "repository"> & {
    dbPath: string;
  }): ObservabilityControlPlaneAuditStartResult;
  finishConfigMutation(options: Omit<ConfigMutationAuditFinishOptions, "repository"> & {
    dbPath: string;
  }): ObservabilityControlPlaneAuditFinishResult;
}

export interface ObservabilityBenchmarkRunListItem {
  readonly run: BenchmarkRunRecord;
  readonly summary: BenchmarkRunSummary;
}

export interface ObservabilityBenchmarkHistoryListResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly runs: ObservabilityBenchmarkRunListItem[];
}

export interface ObservabilityBenchmarkHistoryShowResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly run: BenchmarkRunRecord | null;
  readonly summary: BenchmarkRunSummary | null;
  readonly samples: BenchmarkSampleRecord[];
}

export interface ObservabilityBenchmarkHistoryDeleteResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: BenchmarkHistoryDeleteResult | null;
}

export interface ObservabilityBenchmarkHistoryPort {
  list(options: {
    dbPath: string;
    limit: number;
  }): ObservabilityBenchmarkHistoryListResult;
  show(options: {
    dbPath: string;
    runId: string;
  }): ObservabilityBenchmarkHistoryShowResult;
  pruneOlderThan(options: {
    dbPath: string;
    cutoffIso: string;
  }): ObservabilityBenchmarkHistoryDeleteResult;
  deleteRun(options: {
    dbPath: string;
    runId: string;
  }): ObservabilityBenchmarkHistoryDeleteResult;
  clear(options: {
    dbPath: string;
  }): ObservabilityBenchmarkHistoryDeleteResult;
}

export interface ObservabilityBenchmarkRunResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: BenchmarkRunnerResult | null;
}

export interface ObservabilityBenchmarkRunPort {
  run(options: Omit<BenchmarkOperationOptions, "service"> & {
    dbPath: string;
  }): Promise<ObservabilityBenchmarkRunResult>;
}

export interface ObservabilityOptimizationHistoryListResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly runs: OptimizationRunRecord[];
}

export interface ObservabilityOptimizationHistoryShowResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly run: OptimizationRunRecord | null;
}

export interface ObservabilityOptimizationHistoryDeleteResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: OptimizeHistoryDeleteResult | null;
}

export interface ObservabilityOptimizationHistoryPort {
  list(options: {
    dbPath: string;
    limit: number;
  }): ObservabilityOptimizationHistoryListResult;
  show(options: {
    dbPath: string;
    runId: string;
  }): ObservabilityOptimizationHistoryShowResult;
  pruneOlderThan(options: {
    dbPath: string;
    cutoffIso: string;
  }): ObservabilityOptimizationHistoryDeleteResult;
  deleteRun(options: {
    dbPath: string;
    runId: string;
  }): ObservabilityOptimizationHistoryDeleteResult;
  clear(options: {
    dbPath: string;
  }): ObservabilityOptimizationHistoryDeleteResult;
}

export interface ObservabilityOptimizationReportPersistResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly report: OptimizeReportView | null;
}

export interface ObservabilityOptimizationReportPort {
  persistCost(options: {
    dbPath: string;
    report: OptimizeReportView;
    candidateRoutes: RouteReadModel[];
    requestedRoutes: string[] | null;
    referenceTokens: OptimizeReferenceTokens;
    createdBy: string;
    runId?: string;
    now?: Date;
  }): ObservabilityOptimizationReportPersistResult;
  persistLatency(options: {
    dbPath: string;
    report: OptimizeReportView;
    candidateRoutes: RouteReadModel[];
    requestedRoutes: string[] | null;
    createdBy: string;
    benchmarkRunId: string;
    settings: Record<string, unknown>;
    runId?: string;
    now?: Date;
  }): ObservabilityOptimizationReportPersistResult;
}

export interface ObservabilityOptimizeApplyMutationResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: OptimizeApplyMutationServiceResult | null;
}

export interface ObservabilityOptimizeRestoreMutationResult {
  readonly dbPath: string;
  readonly storeFound: boolean;
  readonly result: OptimizeRestoreMutationServiceResult | null;
}

export interface ObservabilityOptimizeMutationPort {
  apply(options: Omit<RunOptimizeApplyMutationOptions, "service"> & {
    dbPath: string;
  }): ObservabilityOptimizeApplyMutationResult;
  restore(options: Omit<RunOptimizeRestoreMutationOptions, "service"> & {
    dbPath: string;
  }): ObservabilityOptimizeRestoreMutationResult;
}

export interface ObservabilityModule {
  readonly descriptor: ObservabilityModuleDescriptor;
  readonly trace: ObservabilityTraceQueryPort;
  readonly traceMaintenance: ObservabilityTraceMaintenancePort;
  readonly retention: ObservabilityRetentionPort;
  readonly ledger: ObservabilityLedgerPort;
  readonly controlPlaneAudit: ObservabilityControlPlaneAuditPort;
  readonly benchmarkRuns: ObservabilityBenchmarkRunPort;
  readonly benchmarkHistory: ObservabilityBenchmarkHistoryPort;
  readonly optimizationReports: ObservabilityOptimizationReportPort;
  readonly optimizeMutations: ObservabilityOptimizeMutationPort;
  readonly optimizationHistory: ObservabilityOptimizationHistoryPort;
  configure(options: ObservabilityModuleConfigureOptions): void;
  bootstrap(): void;
  pruneRetentionNow(source?: "startup" | "interval"): void;
  getService(): ObservabilityService | null;
  getDbPath(): string | null;
  recordGatewayObservation(input: GatewayObservationInput): void;
  recordGatewayFailureObservation(
    stage: string,
    context: ProxyRequestContext,
    reason: string,
    route?: RouteConfig | null,
    attributes?: Record<string, unknown>
  ): void;
  shutdown(): Promise<void>;
}

interface ObservabilityModuleDeps {
  configure: (options: ObservabilityModuleConfigureOptions) => void;
  bootstrap: () => void;
  pruneRetentionNow: (source?: "startup" | "interval") => void;
  getService: () => ObservabilityService | null;
  getDbPath: () => string | null;
  recordGatewayObservation: (input: GatewayObservationInput) => void;
  recordGatewayFailureObservation: (
    stage: string,
    context: ProxyRequestContext,
    reason: string,
    route?: RouteConfig | null,
    attributes?: Record<string, unknown>
  ) => void;
  shutdown: () => Promise<void>;
  trace: ObservabilityTraceQueryPort;
  traceMaintenance: ObservabilityTraceMaintenancePort;
  retention: ObservabilityRetentionPort;
  ledger: ObservabilityLedgerPort;
  controlPlaneAudit: ObservabilityControlPlaneAuditPort;
  benchmarkRuns: ObservabilityBenchmarkRunPort;
  benchmarkHistory: ObservabilityBenchmarkHistoryPort;
  optimizationReports: ObservabilityOptimizationReportPort;
  optimizeMutations: ObservabilityOptimizeMutationPort;
  optimizationHistory: ObservabilityOptimizationHistoryPort;
}

function emptyRequestExecutionStats(): RequestExecutionStats {
  return {
    total_count: 0,
    partial_output_count: 0,
    average_gateway_residency_ms: null,
    average_upstream_ttft_ms: null,
    average_upstream_duration_ms: null,
    outcome_counts: [],
    top_failing_routes: []
  };
}

export function createOstrichTraceQueryPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityTraceQueryPort {
  function withExistingHandle<T>(
    dbPath: string,
    read: (handle: ObservabilityRuntimeHandle | null) => T
  ): T {
    const handle = deps.openExisting(dbPath);

    try {
      return read(handle);
    } finally {
      deps.close(handle);
    }
  }

  return {
    list: ({ dbPath, filters = {} }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        traces: handle?.service.listRecentRequestExecutions(filters) ?? []
      })),
    listObservations: ({ dbPath, filters = {} }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        observations: handle?.service.listRecentObservations(filters) ?? []
      })),
    getStats: ({ dbPath, filters = {} }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        stats: handle?.service.getRequestExecutionStats(filters) ?? emptyRequestExecutionStats()
      })),
    show: ({ dbPath, traceId }) =>
      withExistingHandle(dbPath, (handle) => {
        const requestExecution = handle?.service.getRequestExecution(traceId) ?? null;
        const observations = handle?.service.listObservationsByRequestId(traceId, 500) ?? [];
        const benchmarkSamples = requestExecution
          ? handle?.service.benchmarks.listSamplesByRequestExecutionId(requestExecution.request_id) ?? []
          : [];

        return {
          dbPath,
          storeFound: handle !== null,
          requestExecution,
          observations,
          benchmarkSamples
        };
      })
  };
}

export function createOstrichTraceMaintenancePort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityTraceMaintenancePort {
  function withExistingHandle<T>(
    dbPath: string,
    read: (handle: ObservabilityRuntimeHandle | null) => ObservabilityTraceMaintenanceResult<T>
  ): ObservabilityTraceMaintenanceResult<T> {
    const handle = deps.openExisting(dbPath);

    try {
      return read(handle);
    } finally {
      deps.close(handle);
    }
  }

  return {
    verify: ({ dbPath, all, traceId, batchSize }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        results: !handle
          ? []
          : all
            ? handle.service.verifyAllRequestExecutions({ batchSize })
            : [handle.service.verifyRequestExecution(traceId!)]
      })),
    repair: ({ dbPath, all, traceId, batchSize }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        results: !handle
          ? []
          : all
            ? handle.service.repairAllRequestExecutions({ batchSize })
            : [handle.service.repairRequestExecution(traceId!)]
      }))
  };
}

export function createOstrichRetentionPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityRetentionPort {
  return {
    pruneOlderThan: ({ dbPath, cutoffIso }) => {
      const handle = deps.openExisting(dbPath);

      try {
        return {
          dbPath,
          storeFound: handle !== null,
          result: handle?.service.pruneOlderThan(cutoffIso) ?? null
        };
      } finally {
        deps.close(handle);
      }
    }
  };
}

export function createOstrichLedgerPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityLedgerPort {
  function withExistingHandle<T>(
    dbPath: string,
    read: (handle: ObservabilityRuntimeHandle | null) => T
  ): T {
    const handle = deps.openExisting(dbPath);

    try {
      return read(handle);
    } finally {
      deps.close(handle);
    }
  }

  return {
    list: ({ dbPath, filters = {} }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        events: handle?.service.controlPlaneActions.listEvents(filters) ?? []
      })),
    show: ({ dbPath, ledgerEventId }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        event: handle?.service.controlPlaneActions.getEvent(ledgerEventId) ?? null
      }))
  };
}

export function createOstrichControlPlaneAuditPort(deps: {
  open: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  open: openObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityControlPlaneAuditPort {
  return {
    startConfigMutation: ({ dbPath, ...options }) => {
      const handle = deps.open(dbPath);

      try {
        return {
          dbPath,
          storeFound: handle !== null,
          actionId: handle
            ? startConfigMutationControlPlaneAudit({
                repository: handle.service.controlPlaneActions,
                ...options
              })
            : null
        };
      } finally {
        deps.close(handle);
      }
    },
    finishConfigMutation: ({ dbPath, ...options }) => {
      const handle = deps.open(dbPath);

      try {
        if (handle) {
          finishConfigMutationControlPlaneAudit({
            repository: handle.service.controlPlaneActions,
            ...options
          });
        }

        return {
          dbPath,
          storeFound: handle !== null
        };
      } finally {
        deps.close(handle);
      }
    }
  };
}

export function createOstrichBenchmarkHistoryPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityBenchmarkHistoryPort {
  function withExistingHandle<T>(
    dbPath: string,
    read: (handle: ObservabilityRuntimeHandle | null) => T
  ): T {
    const handle = deps.openExisting(dbPath);

    try {
      return read(handle);
    } finally {
      deps.close(handle);
    }
  }

  return {
    list: ({ dbPath, limit }) =>
      withExistingHandle(dbPath, (handle) => {
        const runs =
          handle?.service.benchmarks.listRuns(limit).map((run) => ({
            run,
            summary: handle.service.benchmarks.summarizeRun(run.id)
          })) ?? [];

        return {
          dbPath,
          storeFound: handle !== null,
          runs
        };
      }),
    show: ({ dbPath, runId }) =>
      withExistingHandle(dbPath, (handle) => {
        const run = handle?.service.benchmarks.getRun(runId) ?? null;
        const summary = run ? handle?.service.benchmarks.summarizeRun(runId) ?? null : null;
        const samples = run ? handle?.service.benchmarks.listSamplesByRun(runId) ?? [] : [];

        return {
          dbPath,
          storeFound: handle !== null,
          run,
          summary,
          samples
        };
      }),
    pruneOlderThan: ({ dbPath, cutoffIso }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.pruneBenchmarkHistoryOlderThan(cutoffIso) ?? null
      })),
    deleteRun: ({ dbPath, runId }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.deleteBenchmarkRun(runId) ?? null
      })),
    clear: ({ dbPath }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.clearBenchmarkHistory() ?? null
      }))
  };
}

export function createOstrichBenchmarkRunPort(deps: {
  open: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  open: openObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityBenchmarkRunPort {
  return {
    run: async ({ dbPath, ...options }) => {
      const handle = deps.open(dbPath);

      try {
        return {
          dbPath,
          storeFound: handle !== null,
          result: handle
            ? await runBenchmarkOperation({
                service: handle.service,
                ...options
              })
            : null
        };
      } finally {
        deps.close(handle);
      }
    }
  };
}

export function createOstrichOptimizationHistoryPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityOptimizationHistoryPort {
  function withExistingHandle<T>(
    dbPath: string,
    read: (handle: ObservabilityRuntimeHandle | null) => T
  ): T {
    const handle = deps.openExisting(dbPath);

    try {
      return read(handle);
    } finally {
      deps.close(handle);
    }
  }

  return {
    list: ({ dbPath, limit }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        runs: handle?.service.optimizations.listRuns(limit) ?? []
      })),
    show: ({ dbPath, runId }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        run: handle?.service.optimizations.getRun(runId) ?? null
      })),
    pruneOlderThan: ({ dbPath, cutoffIso }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.pruneOptimizationHistoryOlderThan(cutoffIso) ?? null
      })),
    deleteRun: ({ dbPath, runId }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.deleteOptimizationRun(runId) ?? null
      })),
    clear: ({ dbPath }) =>
      withExistingHandle(dbPath, (handle) => ({
        dbPath,
        storeFound: handle !== null,
        result: handle?.service.clearOptimizationHistory() ?? null
      }))
  };
}

export function createOstrichOptimizationReportPort(deps: {
  open: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  open: openObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityOptimizationReportPort {
  return {
    persistCost: ({ dbPath, ...options }) => {
      const handle = deps.open(dbPath);

      try {
        return {
          dbPath,
          storeFound: handle !== null,
          report: handle
            ? persistCostOptimizeReport({
                service: handle.service,
                storePath: dbPath,
                ...options
              })
            : null
        };
      } finally {
        deps.close(handle);
      }
    },
    persistLatency: ({ dbPath, ...options }) => {
      const handle = deps.open(dbPath);

      try {
        return {
          dbPath,
          storeFound: handle !== null,
          report: handle
            ? persistLatencyOptimizeReport({
                service: handle.service,
                storePath: dbPath,
                ...options
              })
            : null
        };
      } finally {
        deps.close(handle);
      }
    }
  };
}

export function createOstrichOptimizeMutationPort(deps: {
  openExisting: (dbPath: string) => ObservabilityRuntimeHandle | null;
  close: (handle: ObservabilityRuntimeHandle | null) => void;
} = {
  openExisting: openExistingObservabilityService,
  close: closeObservabilityServiceHandle
}): ObservabilityOptimizeMutationPort {
  function closeAfterDeferredCompletion<T extends { deferred: true; complete: (...args: never[]) => unknown }>(
    handle: ObservabilityRuntimeHandle,
    result: T
  ): T {
    let closed = false;
    const closeOnce = () => {
      if (!closed) {
        closed = true;
        deps.close(handle);
      }
    };

    return {
      ...result,
      complete: ((...args: Parameters<T["complete"]>) => {
        try {
          return result.complete(...args);
        } finally {
          closeOnce();
        }
      }) as T["complete"]
    };
  }

  return {
    apply: ({ dbPath, ...options }) => {
      const handle = deps.openExisting(dbPath);
      let shouldClose = true;

      try {
        const result = handle
          ? runOptimizeApplyMutation({
              service: handle.service,
              dbPath,
              ...options
            })
          : null;

        if (handle && result?.ok && result.deferred) {
          shouldClose = false;
          return {
            dbPath,
            storeFound: true,
            result: closeAfterDeferredCompletion(handle, result)
          };
        }

        return {
          dbPath,
          storeFound: handle !== null,
          result
        };
      } finally {
        if (shouldClose) {
          deps.close(handle);
        }
      }
    },
    restore: ({ dbPath, ...options }) => {
      const handle = deps.openExisting(dbPath);
      let shouldClose = true;

      try {
        const result = handle
          ? runOptimizeRestoreMutation({
              service: handle.service,
              dbPath,
              ...options
            })
          : null;

        if (handle && result?.ok && result.deferred) {
          shouldClose = false;
          return {
            dbPath,
            storeFound: true,
            result: closeAfterDeferredCompletion(handle, result)
          };
        }

        return {
          dbPath,
          storeFound: handle !== null,
          result
        };
      } finally {
        if (shouldClose) {
          deps.close(handle);
        }
      }
    }
  };
}

export const OSTRICH_OBSERVABILITY_MODULE_DESCRIPTOR: ObservabilityModuleDescriptor = {
  id: "ostrich",
  runtime: "in_process_typescript",
  displayName: "Ostrich",
  capabilities: {
    gatewayObservationWrites: true,
    localReadModel: true,
    retentionPruning: true,
    gracefulShutdownDrain: true
  }
};

export function createOstrichObservabilityModule(
  deps: ObservabilityModuleDeps = {
    configure: configureGatewayObservability,
    bootstrap: bootstrapGatewayObservability,
    pruneRetentionNow: pruneGatewayObservabilityRetentionNow,
    getService: getGatewayObservabilityService,
    getDbPath: getGatewayObservabilityDbPath,
    recordGatewayObservation,
    recordGatewayFailureObservation,
    shutdown: shutdownGatewayObservability,
    trace: createOstrichTraceQueryPort(),
    traceMaintenance: createOstrichTraceMaintenancePort(),
    retention: createOstrichRetentionPort(),
    ledger: createOstrichLedgerPort(),
    controlPlaneAudit: createOstrichControlPlaneAuditPort({
      open: openObservabilityService,
      close: closeObservabilityServiceHandle
    }),
    benchmarkRuns: createOstrichBenchmarkRunPort({
      open: openObservabilityService,
      close: closeObservabilityServiceHandle
    }),
    benchmarkHistory: createOstrichBenchmarkHistoryPort(),
    optimizationReports: createOstrichOptimizationReportPort({
      open: openObservabilityService,
      close: closeObservabilityServiceHandle
    }),
    optimizeMutations: createOstrichOptimizeMutationPort(),
    optimizationHistory: createOstrichOptimizationHistoryPort()
  }
): ObservabilityModule {
  return {
    descriptor: OSTRICH_OBSERVABILITY_MODULE_DESCRIPTOR,
    trace: deps.trace,
    traceMaintenance: deps.traceMaintenance,
    retention: deps.retention,
    ledger: deps.ledger,
    controlPlaneAudit: deps.controlPlaneAudit,
    benchmarkRuns: deps.benchmarkRuns,
    benchmarkHistory: deps.benchmarkHistory,
    optimizationReports: deps.optimizationReports,
    optimizeMutations: deps.optimizeMutations,
    optimizationHistory: deps.optimizationHistory,
    configure: deps.configure,
    bootstrap: deps.bootstrap,
    pruneRetentionNow: deps.pruneRetentionNow,
    getService: deps.getService,
    getDbPath: deps.getDbPath,
    recordGatewayObservation: deps.recordGatewayObservation,
    recordGatewayFailureObservation: deps.recordGatewayFailureObservation,
    shutdown: deps.shutdown
  };
}

export const defaultObservabilityModule: ObservabilityModule = createOstrichObservabilityModule();
