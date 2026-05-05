import type { DatabaseSync } from "node:sqlite";

import type { SqlParameter } from "./history-delete";

const DEFAULT_OBSERVABILITY_PRUNE_BATCH_SIZE = 250;

export interface ObservabilityPruneResult {
  status: "completed" | "partial";
  cutoff_at: string;
  failure_stage?:
    | "control_plane_action_events"
    | "config_mutation_events"
    | "config_snapshots"
    | "benchmark_runs"
    | "request_executions"
    | "observations"
    | null;
  failure_message?: string | null;
  observations_deleted: number;
  request_executions_deleted: number;
  benchmark_runs_deleted: number;
  benchmark_samples_deleted: number;
  cost_facts_deleted: number;
  optimization_facts_deleted: number;
  control_plane_action_events_deleted: number;
  config_mutation_events_deleted: number;
  config_snapshots_deleted: number;
  total_deleted: number;
}

export interface ObservabilityPruneOptions {
  batchSize?: number;
}

export interface ObservabilityPruneDatabaseOperations {
  countRows(sql: string, ...parameters: SqlParameter[]): number;
  deleteRowsBySelectedIds(
    selectIdsSql: string,
    deleteTable: string,
    deleteColumn: string,
    parameters: SqlParameter[],
    batchSize: number
  ): number;
}

export class ObservabilityPruneService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly operations: ObservabilityPruneDatabaseOperations
  ) {}

  private resolvePruneBatchSize(options: ObservabilityPruneOptions): number {
    if (typeof options.batchSize === "number" && Number.isFinite(options.batchSize)) {
      return Math.max(1, Math.trunc(options.batchSize));
    }

    return DEFAULT_OBSERVABILITY_PRUNE_BATCH_SIZE;
  }

  pruneOlderThan(cutoffIso: string, options: ObservabilityPruneOptions = {}): ObservabilityPruneResult {
    const safeBatchSize = this.resolvePruneBatchSize(options);
    let benchmarkRunsDeleted = 0;
    let benchmarkSamplesDeleted = 0;
    let requestExecutionsDeleted = 0;
    let costFactsDeleted = 0;
    let optimizationFactsDeleted = 0;
    let controlPlaneActionEventsDeleted = 0;
    let configMutationEventsDeleted = 0;
    let configSnapshotsDeleted = 0;
    let observationsDeleted = 0;
    let status: ObservabilityPruneResult["status"] = "completed";
    let failureStage: ObservabilityPruneResult["failure_stage"] = null;
    let failureMessage: string | null = null;
    let currentStage: ObservabilityPruneResult["failure_stage"] = "benchmark_runs";

    try {
      this.db.exec("BEGIN IMMEDIATE");

      currentStage = "control_plane_action_events";
      controlPlaneActionEventsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM control_plane_action_events
          WHERE created_at < ?
        `,
        cutoffIso
      );

      currentStage = "config_mutation_events";
      configMutationEventsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM config_mutation_events
          WHERE created_at < ?
        `,
        cutoffIso
      );

      currentStage = "config_snapshots";
      configSnapshotsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM config_snapshots
          WHERE created_at < ?1
          OR (retention_expires_at IS NOT NULL AND retention_expires_at < ?1)
        `,
        cutoffIso
      );

      currentStage = "benchmark_runs";
      benchmarkRunsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM benchmark_runs
          WHERE created_at < ?
        `,
        cutoffIso
      );

      currentStage = "request_executions";
      requestExecutionsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM request_executions
          WHERE started_at < ?
        `,
        cutoffIso
      );
      costFactsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM cost_facts
          WHERE request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?
          )
        `,
        cutoffIso
      );
      optimizationFactsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM optimization_facts
          WHERE request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?
          )
        `,
        cutoffIso
      );
      benchmarkSamplesDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM benchmark_samples
          WHERE benchmark_run_id IN (
            SELECT id
            FROM benchmark_runs
            WHERE created_at < ?1
          )
          OR request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?1
          )
        `,
        cutoffIso
      );

      currentStage = "observations";
      observationsDeleted = this.operations.countRows(
        `
          SELECT COUNT(*) AS count
          FROM observations
          WHERE observed_at < ?
        `,
        cutoffIso
      );

      currentStage = "control_plane_action_events";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM control_plane_action_events
          WHERE created_at < ?1
          ORDER BY created_at, id
          LIMIT ?2
        `,
        "control_plane_action_events",
        "id",
        [cutoffIso],
        safeBatchSize
      );
      currentStage = "config_mutation_events";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM config_mutation_events
          WHERE created_at < ?1
          ORDER BY created_at, id
          LIMIT ?2
        `,
        "config_mutation_events",
        "id",
        [cutoffIso],
        safeBatchSize
      );
      currentStage = "config_snapshots";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM config_snapshots
          WHERE created_at < ?1
          OR (retention_expires_at IS NOT NULL AND retention_expires_at < ?1)
          ORDER BY created_at, id
          LIMIT ?2
        `,
        "config_snapshots",
        "id",
        [cutoffIso],
        safeBatchSize
      );

      currentStage = "benchmark_runs";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM benchmark_samples
          WHERE benchmark_run_id IN (
            SELECT id
            FROM benchmark_runs
            WHERE created_at < ?1
          )
          OR request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?1
          )
          ORDER BY id
          LIMIT ?2
        `,
        "benchmark_samples",
        "id",
        [cutoffIso],
        safeBatchSize
      );
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM benchmark_runs
          WHERE created_at < ?1
          ORDER BY created_at, id
          LIMIT ?2
        `,
        "benchmark_runs",
        "id",
        [cutoffIso],
        safeBatchSize
      );

      currentStage = "request_executions";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM cost_facts
          WHERE request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?1
          )
          ORDER BY id
          LIMIT ?2
        `,
        "cost_facts",
        "id",
        [cutoffIso],
        safeBatchSize
      );
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM optimization_facts
          WHERE request_execution_id IN (
            SELECT id
            FROM request_executions
            WHERE started_at < ?1
          )
          ORDER BY id
          LIMIT ?2
        `,
        "optimization_facts",
        "id",
        [cutoffIso],
        safeBatchSize
      );
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM request_executions
          WHERE started_at < ?1
          ORDER BY started_at, id
          LIMIT ?2
        `,
        "request_executions",
        "id",
        [cutoffIso],
        safeBatchSize
      );

      currentStage = "observations";
      this.operations.deleteRowsBySelectedIds(
        `
          SELECT id
          FROM observations
          WHERE observed_at < ?1
          ORDER BY observed_at, id
          LIMIT ?2
        `,
        "observations",
        "id",
        [cutoffIso],
        safeBatchSize
      );

      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore secondary rollback failures; preserve the original prune error
      }
      status = "partial";
      failureMessage = error instanceof Error ? error.message : "Unknown observability prune error";
      failureStage = currentStage;
      benchmarkRunsDeleted = 0;
      benchmarkSamplesDeleted = 0;
      requestExecutionsDeleted = 0;
      costFactsDeleted = 0;
      optimizationFactsDeleted = 0;
      controlPlaneActionEventsDeleted = 0;
      configMutationEventsDeleted = 0;
      configSnapshotsDeleted = 0;
      observationsDeleted = 0;
    }

    return {
      status,
      cutoff_at: cutoffIso,
      failure_stage: failureStage,
      failure_message: failureMessage,
      observations_deleted: observationsDeleted,
      request_executions_deleted: requestExecutionsDeleted,
      benchmark_runs_deleted: benchmarkRunsDeleted,
      benchmark_samples_deleted: benchmarkSamplesDeleted,
      cost_facts_deleted: costFactsDeleted,
      optimization_facts_deleted: optimizationFactsDeleted,
      control_plane_action_events_deleted: controlPlaneActionEventsDeleted,
      config_mutation_events_deleted: configMutationEventsDeleted,
      config_snapshots_deleted: configSnapshotsDeleted,
      total_deleted:
        observationsDeleted +
        requestExecutionsDeleted +
        benchmarkRunsDeleted +
        benchmarkSamplesDeleted +
        costFactsDeleted +
        optimizationFactsDeleted +
        controlPlaneActionEventsDeleted +
        configMutationEventsDeleted +
        configSnapshotsDeleted
    };
  }
}
