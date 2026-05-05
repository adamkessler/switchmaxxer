import type { DatabaseSync } from "node:sqlite";

import type { BenchmarkRepository } from "../../benchmarks";
import type { OptimizationRepository } from "../../optimizations";
import type {
  BenchmarkHistoryDeleteResult,
  OptimizeHistoryDeleteResult
} from "../../service";
import {
  buildInClausePlaceholders,
  deleteRows,
  listRowIds,
  runImmediateTransaction
} from "./history-delete";

function emptyBenchmarkHistoryDeleteResult(): BenchmarkHistoryDeleteResult {
  return {
    benchmark_runs_deleted: 0,
    benchmark_samples_deleted: 0,
    total_deleted: 0
  };
}

function emptyOptimizeHistoryDeleteResult(): OptimizeHistoryDeleteResult {
  return {
    optimization_runs_deleted: 0,
    config_mutation_events_deleted: 0,
    config_snapshots_deleted: 0,
    total_deleted: 0
  };
}

export class BenchmarkHistoryService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly benchmarks: BenchmarkRepository
  ) {}

  deleteBenchmarkRun(runId: string): BenchmarkHistoryDeleteResult {
    const run = this.benchmarks.getRun(runId);
    if (!run) {
      return emptyBenchmarkHistoryDeleteResult();
    }

    return runImmediateTransaction(this.db, () => {
      const benchmarkSamplesDeleted = deleteRows(this.db, "DELETE FROM benchmark_samples WHERE benchmark_run_id = ?", runId);
      const benchmarkRunsDeleted = deleteRows(this.db, "DELETE FROM benchmark_runs WHERE id = ?", runId);

      return {
        benchmark_runs_deleted: benchmarkRunsDeleted,
        benchmark_samples_deleted: benchmarkSamplesDeleted,
        total_deleted: benchmarkRunsDeleted + benchmarkSamplesDeleted
      };
    });
  }

  pruneBenchmarkHistoryOlderThan(cutoffIso: string): BenchmarkHistoryDeleteResult {
    return runImmediateTransaction(this.db, () => {
      const runIds = listRowIds(
        this.db,
        `
          SELECT id
          FROM benchmark_runs
          WHERE created_at < ?
          ORDER BY created_at, id
        `,
        cutoffIso
      );

      if (runIds.length === 0) {
        return emptyBenchmarkHistoryDeleteResult();
      }

      const benchmarkSamplesDeleted = deleteRows(
        this.db,
        `DELETE FROM benchmark_samples WHERE benchmark_run_id IN ${buildInClausePlaceholders(runIds.length)}`,
        ...runIds
      );
      const benchmarkRunsDeleted = deleteRows(
        this.db,
        `DELETE FROM benchmark_runs WHERE id IN ${buildInClausePlaceholders(runIds.length)}`,
        ...runIds
      );

      return {
        benchmark_runs_deleted: benchmarkRunsDeleted,
        benchmark_samples_deleted: benchmarkSamplesDeleted,
        total_deleted: benchmarkRunsDeleted + benchmarkSamplesDeleted
      };
    });
  }

  clearBenchmarkHistory(): BenchmarkHistoryDeleteResult {
    return runImmediateTransaction(this.db, () => {
      const benchmarkSamplesDeleted = deleteRows(this.db, "DELETE FROM benchmark_samples");
      const benchmarkRunsDeleted = deleteRows(this.db, "DELETE FROM benchmark_runs");

      return {
        benchmark_runs_deleted: benchmarkRunsDeleted,
        benchmark_samples_deleted: benchmarkSamplesDeleted,
        total_deleted: benchmarkRunsDeleted + benchmarkSamplesDeleted
      };
    });
  }
}

export class OptimizationHistoryService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly optimizations: OptimizationRepository
  ) {}

  private listConfigSnapshotIdsForOptimizeEvents(whereSql: string, ...parameters: Array<string | number | bigint | Uint8Array | null>): string[] {
    return listRowIds(
      this.db,
      `
        SELECT DISTINCT snapshot_id AS id
        FROM config_mutation_events
        WHERE snapshot_id IS NOT NULL
        AND ${whereSql}
      `,
      ...parameters
    );
  }

  private deleteOrphanedConfigSnapshotsByIds(snapshotIds: string[]): number {
    if (snapshotIds.length === 0) {
      return 0;
    }

    return deleteRows(
      this.db,
      `
        DELETE FROM config_snapshots
        WHERE id IN ${buildInClausePlaceholders(snapshotIds.length)}
        AND id NOT IN (
          SELECT snapshot_id
          FROM config_mutation_events
          WHERE snapshot_id IS NOT NULL
        )
      `,
      ...snapshotIds
    );
  }

  deleteOptimizationRun(runId: string): OptimizeHistoryDeleteResult {
    const run = this.optimizations.getRun(runId);
    if (!run) {
      return emptyOptimizeHistoryDeleteResult();
    }

    return runImmediateTransaction(this.db, () => {
      const snapshotIds = this.listConfigSnapshotIdsForOptimizeEvents("optimization_run_id = ?", runId);
      const configMutationEventsDeleted = deleteRows(
        this.db,
        "DELETE FROM config_mutation_events WHERE optimization_run_id = ?",
        runId
      );
      const optimizationRunsDeleted = deleteRows(this.db, "DELETE FROM optimization_runs WHERE id = ?", runId);
      const configSnapshotsDeleted = this.deleteOrphanedConfigSnapshotsByIds(snapshotIds);

      return {
        optimization_runs_deleted: optimizationRunsDeleted,
        config_mutation_events_deleted: configMutationEventsDeleted,
        config_snapshots_deleted: configSnapshotsDeleted,
        total_deleted: optimizationRunsDeleted + configMutationEventsDeleted + configSnapshotsDeleted
      };
    });
  }

  pruneOptimizationHistoryOlderThan(cutoffIso: string): OptimizeHistoryDeleteResult {
    return runImmediateTransaction(this.db, () => {
      const runIds = listRowIds(
        this.db,
        `
          SELECT id
          FROM optimization_runs
          WHERE created_at < ?
          ORDER BY created_at, id
        `,
        cutoffIso
      );
      const snapshotIds = runIds.length === 0
        ? []
        : this.listConfigSnapshotIdsForOptimizeEvents(
            `optimization_run_id IN ${buildInClausePlaceholders(runIds.length)}`,
            ...runIds
          );

      const configMutationEventsDeleted = runIds.length === 0
        ? 0
        : deleteRows(
            this.db,
            `DELETE FROM config_mutation_events WHERE optimization_run_id IN ${buildInClausePlaceholders(runIds.length)}`,
            ...runIds
          );
      const optimizationRunsDeleted = runIds.length === 0
        ? 0
        : deleteRows(
            this.db,
            `DELETE FROM optimization_runs WHERE id IN ${buildInClausePlaceholders(runIds.length)}`,
            ...runIds
          );
      const configSnapshotsDeleted = this.deleteOrphanedConfigSnapshotsByIds(snapshotIds);

      return {
        optimization_runs_deleted: optimizationRunsDeleted,
        config_mutation_events_deleted: configMutationEventsDeleted,
        config_snapshots_deleted: configSnapshotsDeleted,
        total_deleted: optimizationRunsDeleted + configMutationEventsDeleted + configSnapshotsDeleted
      };
    });
  }

  clearOptimizationHistory(): OptimizeHistoryDeleteResult {
    return runImmediateTransaction(this.db, () => {
      const snapshotIds = this.listConfigSnapshotIdsForOptimizeEvents(
        "operation IN ('optimize_apply', 'optimize_restore')"
      );
      const configMutationEventsDeleted = deleteRows(
        this.db,
        "DELETE FROM config_mutation_events WHERE operation IN ('optimize_apply', 'optimize_restore')"
      );
      const optimizationRunsDeleted = deleteRows(this.db, "DELETE FROM optimization_runs");
      const configSnapshotsDeleted = this.deleteOrphanedConfigSnapshotsByIds(snapshotIds);

      return {
        optimization_runs_deleted: optimizationRunsDeleted,
        config_mutation_events_deleted: configMutationEventsDeleted,
        config_snapshots_deleted: configSnapshotsDeleted,
        total_deleted: optimizationRunsDeleted + configMutationEventsDeleted + configSnapshotsDeleted
      };
    });
  }
}
