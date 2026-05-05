import type {
  ObservabilityIpcOperation,
  ObservabilityIpcResponse
} from "./observability-ipc-contract";
import {
  validateBenchmarkHistoryDeleteResult,
  validateBenchmarkHistoryListResult,
  validateBenchmarkHistoryShowResult,
  validateBenchmarkRunResult
} from "./observability-ipc-result-validation-benchmark";
import {
  validateControlPlaneAuditFinishResult,
  validateControlPlaneAuditStartResult,
  validateLedgerListResult,
  validateLedgerShowResult,
  validateRetentionPruneResult
} from "./observability-ipc-result-validation-ledger";
import {
  validateOptimizationHistoryDeleteResult,
  validateOptimizationHistoryListResult,
  validateOptimizationHistoryShowResult,
  validateOptimizationReportPersistResult,
  validateOptimizeMutationResult
} from "./observability-ipc-result-validation-optimization";
import {
  validateTraceListResult,
  validateTraceMaintenanceResult,
  validateTraceObservationsResult,
  validateTraceShowResult,
  validateTraceStatsResult
} from "./observability-ipc-result-validation-trace";

export const OBSERVABILITY_IPC_RESULT_VALIDATED_OPERATIONS = [
  "trace.list",
  "trace.listObservations",
  "trace.getStats",
  "trace.show",
  "trace.verify",
  "trace.repair",
  "retention.pruneOlderThan",
  "ledger.list",
  "ledger.show",
  "controlPlaneAudit.startConfigMutation",
  "controlPlaneAudit.finishConfigMutation",
  "benchmarkHistory.list",
  "benchmarkHistory.show",
  "benchmarkHistory.pruneOlderThan",
  "benchmarkHistory.deleteRun",
  "benchmarkHistory.clear",
  "benchmarkRuns.run",
  "optimizationHistory.list",
  "optimizationHistory.show",
  "optimizationHistory.pruneOlderThan",
  "optimizationHistory.deleteRun",
  "optimizationHistory.clear",
  "optimizationReports.persistCost",
  "optimizationReports.persistLatency",
  "optimizeMutations.apply",
  "optimizeMutations.restore"
] as const satisfies readonly ObservabilityIpcOperation[];

export type ObservabilityIpcOperationResultValidationError = {
  readonly message: string;
  readonly field: string;
};

export function validateObservabilityIpcOperationResponseResult(
  operation: ObservabilityIpcOperation,
  response: ObservabilityIpcResponse
): ObservabilityIpcOperationResultValidationError | null {
  if (!response.ok) {
    return null;
  }

  switch (operation) {
    case "trace.list":
      return validateTraceListResult(response.result);
    case "trace.listObservations":
      return validateTraceObservationsResult(response.result);
    case "trace.getStats":
      return validateTraceStatsResult(response.result);
    case "trace.show":
      return validateTraceShowResult(response.result);
    case "trace.verify":
    case "trace.repair":
      return validateTraceMaintenanceResult(response.result, operation);
    case "retention.pruneOlderThan":
      return validateRetentionPruneResult(response.result);
    case "benchmarkRuns.run":
      return validateBenchmarkRunResult(response.result);
    case "benchmarkHistory.list":
      return validateBenchmarkHistoryListResult(response.result);
    case "benchmarkHistory.show":
      return validateBenchmarkHistoryShowResult(response.result);
    case "benchmarkHistory.pruneOlderThan":
    case "benchmarkHistory.deleteRun":
    case "benchmarkHistory.clear":
      return validateBenchmarkHistoryDeleteResult(response.result, operation);
    case "ledger.list":
      return validateLedgerListResult(response.result);
    case "ledger.show":
      return validateLedgerShowResult(response.result);
    case "controlPlaneAudit.startConfigMutation":
      return validateControlPlaneAuditStartResult(response.result);
    case "controlPlaneAudit.finishConfigMutation":
      return validateControlPlaneAuditFinishResult(response.result);
    case "optimizationHistory.list":
      return validateOptimizationHistoryListResult(response.result);
    case "optimizationHistory.show":
      return validateOptimizationHistoryShowResult(response.result);
    case "optimizationHistory.pruneOlderThan":
    case "optimizationHistory.deleteRun":
    case "optimizationHistory.clear":
      return validateOptimizationHistoryDeleteResult(response.result, operation);
    case "optimizationReports.persistCost":
    case "optimizationReports.persistLatency":
      return validateOptimizationReportPersistResult(response.result, operation);
    case "optimizeMutations.apply":
    case "optimizeMutations.restore":
      return validateOptimizeMutationResult(response.result, operation);
    default:
      return null;
  }
}
