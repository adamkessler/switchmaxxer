import type { DatabaseSync } from "node:sqlite";

import { BenchmarkRepository } from "./ostrich/benchmark/benchmarks";
import { ConfigMutationRepository } from "./ostrich/ledger/config-mutations";
import { ControlPlaneActionRepository } from "./ostrich/ledger/control-plane-actions";
import {
  BenchmarkHistoryService,
  OptimizationHistoryService
} from "./ostrich/maintenance/history-services";
import {
  buildInClausePlaceholders,
  countRows,
  deleteRows,
  listRowIds,
  type SqlParameter
} from "./ostrich/maintenance/history-delete";
import { OptimizationRepository } from "./ostrich/optimization/optimizations";
import {
  ObservabilityPruneService,
  type ObservabilityPruneOptions,
  type ObservabilityPruneResult
} from "./ostrich/maintenance/prune-service";
import { ObservationRepository, type ObservationQueryOptions } from "./ostrich/query/repository";
import {
  type ListRequestExecutionOptions,
  type RequestExecutionRecord,
  type RequestExecutionRepairResult,
  type RequestExecutionStats,
  type RequestExecutionVerificationResult,
  RequestExecutionMaterializer
} from "./ostrich/query/request-executions";
import type { ObservationRecord } from "./types";

export { buildInClausePlaceholders } from "./ostrich/maintenance/history-delete";
export type { ObservabilityPruneOptions, ObservabilityPruneResult } from "./ostrich/maintenance/prune-service";

export interface RecordObservationResult {
  observation: ObservationRecord;
  requestExecution: RequestExecutionRecord | null;
  requestObservationCount: number;
}

export interface RecordObservationOptions {
  requestExecutionMode?: "incremental" | "terminal_only";
}

export interface RecordObservationBatchItem {
  record: ObservationRecord;
  options?: RecordObservationOptions;
}

export interface OptimizeHistoryDeleteResult {
  optimization_runs_deleted: number;
  config_mutation_events_deleted: number;
  config_snapshots_deleted: number;
  total_deleted: number;
}

export interface BenchmarkHistoryDeleteResult {
  benchmark_runs_deleted: number;
  benchmark_samples_deleted: number;
  total_deleted: number;
}

export class ObservabilityService {
  readonly benchmarks: BenchmarkRepository;
  readonly benchmarkHistory: BenchmarkHistoryService;
  readonly configMutations: ConfigMutationRepository;
  readonly controlPlaneActions: ControlPlaneActionRepository;
  readonly optimizations: OptimizationRepository;
  readonly optimizationHistory: OptimizationHistoryService;
  readonly pruneService: ObservabilityPruneService;
  readonly observations: ObservationRepository;
  readonly requestExecutions: RequestExecutionMaterializer;

  constructor(private readonly db: DatabaseSync) {
    this.benchmarks = new BenchmarkRepository(db);
    this.configMutations = new ConfigMutationRepository(db);
    this.controlPlaneActions = new ControlPlaneActionRepository(db);
    this.optimizations = new OptimizationRepository(db);
    this.benchmarkHistory = new BenchmarkHistoryService(db, this.benchmarks);
    this.optimizationHistory = new OptimizationHistoryService(db, this.optimizations);
    this.pruneService = new ObservabilityPruneService(db, {
      countRows: (sql, ...parameters) => this.countRows(sql, ...parameters),
      deleteRowsBySelectedIds: (selectIdsSql, deleteTable, deleteColumn, parameters, batchSize) =>
        this.deleteRowsBySelectedIds(selectIdsSql, deleteTable, deleteColumn, parameters, batchSize)
    });
    this.observations = new ObservationRepository(db);
    this.requestExecutions = new RequestExecutionMaterializer(db);
  }

  recordObservation(record: ObservationRecord, options: RecordObservationOptions = {}): RecordObservationResult {
    const [result] = this.recordObservationBatch([
      {
        record,
        options
      }
    ]);

    if (typeof result === "undefined") {
      throw new Error("recordObservationBatch returned no result for a single observation");
    }

    return result;
  }

  recordObservationBatch(items: RecordObservationBatchItem[]): RecordObservationResult[] {
    if (items.length === 0) {
      return [];
    }

    this.db.exec("BEGIN");

    try {
      const results: RecordObservationResult[] = [];

      for (const item of items) {
        const { record, options = {} } = item;
        this.observations.insert(record);

        const mode = options.requestExecutionMode ?? "incremental";
        let requestExecution: RequestExecutionRecord | null = null;

        if (record.request_id && typeof record.client_api_mode === "string") {
          if (mode === "incremental") {
            requestExecution = this.requestExecutions.materialize(record);
          } else if (this.isTerminalRequestObservation(record)) {
            requestExecution = this.requestExecutions.materializeFromObservations(record.request_id);
          }
        }

        results.push({
          observation: record,
          requestExecution,
          requestObservationCount: requestExecution?.observation_count ?? 0
        });
      }

      this.db.exec("COMMIT");

      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private isTerminalRequestObservation(record: ObservationRecord): boolean {
    if (record.event === "client_response_completed" || record.event === "debug_error_context") {
      return true;
    }

    switch (record.outcome) {
      case "succeeded":
      case "failed":
      case "cancelled":
      case "timed_out":
      case "rejected":
      case "partial":
        return true;
      default:
        return false;
    }
  }

  private countRows(sql: string, ...parameters: SqlParameter[]): number {
    return countRows(this.db, sql, ...parameters);
  }

  private listRowIds(sql: string, ...parameters: SqlParameter[]): string[] {
    return listRowIds(this.db, sql, ...parameters);
  }

  private deleteRows(sql: string, ...parameters: SqlParameter[]): number {
    return deleteRows(this.db, sql, ...parameters);
  }

  private deleteRowsBySelectedIds(
    selectIdsSql: string,
    deleteTable: string,
    deleteColumn: string,
    parameters: SqlParameter[],
    batchSize: number
  ): number {
    let deleted = 0;

    for (;;) {
      const ids = this.listRowIds(selectIdsSql, ...parameters, batchSize);

      if (ids.length === 0) {
        break;
      }

      deleted += this.deleteRows(
        `DELETE FROM ${deleteTable} WHERE ${deleteColumn} IN ${buildInClausePlaceholders(ids.length)}`,
        ...ids
      );

      if (ids.length < batchSize) {
        break;
      }
    }

    return deleted;
  }

  listRecentObservations(options: ObservationQueryOptions = {}): ObservationRecord[] {
    return this.observations.listRecent(options);
  }

  listObservationsByRequestId(requestId: string, limit = 200): ObservationRecord[] {
    return this.observations.listByRequestId(requestId, limit);
  }

  getRequestExecution(requestId: string): RequestExecutionRecord | null {
    return this.requestExecutions.getByRequestId(requestId);
  }

  listRecentRequestExecutions(options: ListRequestExecutionOptions = {}): RequestExecutionRecord[] {
    return this.requestExecutions.listRecent(options);
  }

  getRequestExecutionStats(options: ListRequestExecutionOptions = {}): RequestExecutionStats {
    return this.requestExecutions.stats(options);
  }

  verifyRequestExecution(requestId: string): RequestExecutionVerificationResult {
    return this.requestExecutions.verify(requestId);
  }

  verifyAllRequestExecutions(options: { batchSize?: number } = {}): RequestExecutionVerificationResult[] {
    return this.requestExecutions.verifyAll(options.batchSize);
  }

  repairRequestExecution(requestId: string): RequestExecutionRepairResult {
    this.db.exec("BEGIN");

    try {
      const result = this.requestExecutions.repair(requestId);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  repairAllRequestExecutions(options: { batchSize?: number } = {}): RequestExecutionRepairResult[] {
    const results: RequestExecutionRepairResult[] = [];
    const safeBatchSize =
      typeof options.batchSize === "number" && Number.isFinite(options.batchSize)
        ? Math.max(1, Math.trunc(options.batchSize))
        : 500;
    let afterRequestId: string | null = null;

    for (;;) {
      const requestIds = this.requestExecutions.listKnownRequestIdsAfter({
        limit: safeBatchSize,
        afterRequestId
      });

      if (requestIds.length === 0) {
        break;
      }

      afterRequestId = requestIds[requestIds.length - 1] as string;

      this.db.exec("BEGIN");

      try {
        for (const requestId of requestIds) {
          results.push(this.requestExecutions.repair(requestId));
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }

      if (requestIds.length < safeBatchSize) {
        break;
      }
    }

    return results;
  }

  deleteBenchmarkRun(runId: string): BenchmarkHistoryDeleteResult {
    return this.benchmarkHistory.deleteBenchmarkRun(runId);
  }

  pruneBenchmarkHistoryOlderThan(cutoffIso: string): BenchmarkHistoryDeleteResult {
    return this.benchmarkHistory.pruneBenchmarkHistoryOlderThan(cutoffIso);
  }

  clearBenchmarkHistory(): BenchmarkHistoryDeleteResult {
    return this.benchmarkHistory.clearBenchmarkHistory();
  }

  deleteOptimizationRun(runId: string): OptimizeHistoryDeleteResult {
    return this.optimizationHistory.deleteOptimizationRun(runId);
  }

  pruneOptimizationHistoryOlderThan(cutoffIso: string): OptimizeHistoryDeleteResult {
    return this.optimizationHistory.pruneOptimizationHistoryOlderThan(cutoffIso);
  }

  clearOptimizationHistory(): OptimizeHistoryDeleteResult {
    return this.optimizationHistory.clearOptimizationHistory();
  }

  pruneOlderThan(cutoffIso: string, options: ObservabilityPruneOptions = {}): ObservabilityPruneResult {
    return this.pruneService.pruneOlderThan(cutoffIso, options);
  }
}
