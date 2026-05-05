import { getEnvValue, isEnvFlagEnabled } from "../../../../platform/env";
import { logLine, logWarning, safeErrorMessage } from "../../../../platform/logger";
import { retentionDurationToCutoffIso } from "../../../../platform/retention-duration";
import {
  closeObservabilityServiceHandle,
  defaultObservabilityDbPath,
  openObservabilityService,
  type ObservabilityRuntimeHandle
} from "../../runtime-loader";
import type { ObservabilityService, ObservabilityPruneResult } from "../../service";

export type GatewayObservabilityRuntime = {
  configure: (options: {
    retentionOlderThan?: string | null;
    disabled?: boolean;
    dbPath?: string | null;
  }) => void;
  getService: () => ObservabilityService | null;
  bootstrap: () => void;
  pruneRetentionNow: (source?: "startup" | "interval") => void;
  getDbPath: () => string | null;
  markFailed: () => void;
  close: () => void;
  reset: () => void;
};

function logRetentionPruneResult(result: ObservabilityPruneResult): void {
  if (result.total_deleted <= 0) {
    return;
  }

  logLine(
    `observability_retention_pruned  status=${result.status}  cutoff_at=${result.cutoff_at}  observations_deleted=${result.observations_deleted}  request_executions_deleted=${result.request_executions_deleted}  benchmark_runs_deleted=${result.benchmark_runs_deleted}  benchmark_samples_deleted=${result.benchmark_samples_deleted}  cost_facts_deleted=${result.cost_facts_deleted}  optimization_facts_deleted=${result.optimization_facts_deleted}  control_plane_action_events_deleted=${result.control_plane_action_events_deleted}  config_mutation_events_deleted=${result.config_mutation_events_deleted}  config_snapshots_deleted=${result.config_snapshots_deleted}  total_deleted=${result.total_deleted}${result.failure_stage ? `  failure_stage=${result.failure_stage}` : ""}${result.failure_message ? `  failure=${result.failure_message}` : ""}`
  );
}

export function configureGatewayObservabilityRuntime(options: {
  retentionOlderThan?: string | null;
  disabled?: boolean;
  dbPath?: string | null;
}): void {
  defaultGatewayObservabilityRuntime.configure(options);
}

export function createGatewayObservabilityRuntime(): GatewayObservabilityRuntime {
  let runtimeHandle: ObservabilityRuntimeHandle | null = null;
  let bootstrapFailed = false;
  let runtimeRetentionOlderThan: string | null = null;
  let runtimeDisabled = false;
  let runtimeDbPath: string | null = null;

  const getService = (): ObservabilityService | null => {
    if (runtimeDisabled || isEnvFlagEnabled("SWITCHMAXXER_OBSERVABILITY_DISABLED")) {
      return null;
    }

    if (bootstrapFailed) {
      return null;
    }

    if (runtimeHandle) {
      return runtimeHandle.service;
    }

    try {
      const dbPath = runtimeDbPath ?? getEnvValue("SWITCHMAXXER_OBSERVABILITY_DB") ?? defaultObservabilityDbPath();
      runtimeHandle = openObservabilityService(dbPath, {
        retentionOlderThan: runtimeRetentionOlderThan,
        sqliteExperimentalWarning: "allow",
        onRetentionPruned: logRetentionPruneResult,
        onRetentionError: (error) => {
          logWarning(`Observability retention prune failed during startup: ${safeErrorMessage(error)}`);
        }
      });
      return runtimeHandle.service;
    } catch (error) {
      bootstrapFailed = true;
      const message = safeErrorMessage(error ?? "Unknown observability bootstrap error");
      logWarning(`Observability store bootstrap failed; continuing without persistence: ${message}`);
      return null;
    }
  };

  return {
    configure: (options) => {
      runtimeRetentionOlderThan =
        typeof options.retentionOlderThan === "string" && options.retentionOlderThan.trim().length > 0
          ? options.retentionOlderThan
          : null;
      runtimeDisabled = options.disabled === true;
      runtimeDbPath = typeof options.dbPath === "string" && options.dbPath.trim().length > 0 ? options.dbPath : null;
    },
    getService,
    bootstrap: () => {
      void getService();
    },
    pruneRetentionNow: (source = "interval") => {
      if (runtimeDisabled || bootstrapFailed || runtimeRetentionOlderThan === null) {
        return;
      }

      const service = getService();
      if (!service) {
        return;
      }

      try {
        const result = service.pruneOlderThan(retentionDurationToCutoffIso(runtimeRetentionOlderThan));
        logRetentionPruneResult(result);
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error("Unknown observability retention prune error");
        const qualifier = source === "startup" ? "during startup" : "during scheduled maintenance";
        logWarning(`Observability retention prune failed ${qualifier}: ${normalizedError.message}`);
      }
    },
    getDbPath: () => runtimeHandle?.store.dbPath ?? null,
    markFailed: () => {
      bootstrapFailed = true;
    },
    close: () => {
      closeObservabilityServiceHandle(runtimeHandle);
      runtimeHandle = null;
    },
    reset: () => {
      bootstrapFailed = false;
      runtimeRetentionOlderThan = null;
      runtimeDisabled = false;
      runtimeDbPath = null;
      runtimeHandle = null;
    }
  };
}

const defaultGatewayObservabilityRuntime = createGatewayObservabilityRuntime();

export function getGatewayObservabilityService(): ObservabilityService | null {
  return defaultGatewayObservabilityRuntime.getService();
}

export function bootstrapGatewayObservabilityRuntime(): void {
  defaultGatewayObservabilityRuntime.bootstrap();
}

export function pruneGatewayObservabilityRetentionNowRuntime(source: "startup" | "interval" = "interval"): void {
  defaultGatewayObservabilityRuntime.pruneRetentionNow(source);
}

export function getGatewayObservabilityDbPath(): string | null {
  return defaultGatewayObservabilityRuntime.getDbPath();
}

export function markGatewayObservabilityRuntimeFailed(): void {
  defaultGatewayObservabilityRuntime.markFailed();
}

export function closeGatewayObservabilityRuntime(): void {
  defaultGatewayObservabilityRuntime.close();
}

export function resetGatewayObservabilityRuntimeState(): void {
  defaultGatewayObservabilityRuntime.reset();
}
