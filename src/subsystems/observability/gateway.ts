import path from "node:path";

import { logLine, logWarning, safeErrorMessage } from "../../platform/logger";
import type { ProxyRequestContext, RouteConfig } from "../../platform/types";
import {
  gatewayObservationShutdownDrainTimeoutMs,
  gatewayObservationWorkerCloseTimeoutMs,
  gatewayObservationWorkerWriteTimeoutMs
} from "./ostrich/ingestion/gateway-observability-config";
import { inferGatewayFailureOutcome, normalizeGatewayFailureStage } from "./ostrich/ingestion/gateway-failure-mapping";
import {
  bootstrapGatewayObservabilityRuntime,
  closeGatewayObservabilityRuntime,
  configureGatewayObservabilityRuntime,
  getGatewayObservabilityService as getObservabilityService,
  getGatewayObservabilityDbPath,
  markGatewayObservabilityRuntimeFailed,
  pruneGatewayObservabilityRetentionNowRuntime
} from "./gateway-observability-runtime";
import {
  buildGatewayObservationRecord,
  type GatewayObservationInput
} from "./ostrich/ingestion/gateway-observation-records";
import { gatewayObservationRuntimeState } from "./gateway-observation-runtime-state";
import { drainGatewayObservationQueueForShutdown } from "./gateway-observation-shutdown";
import { type GatewayObservationFlushOptions } from "./gateway-observation-flush";
import { type GatewayObservationWorkerDeps } from "./gateway-observation-worker";
import type { RecordObservationBatchItem, RecordObservationOptions } from "./service";
import {
  type ObservationRecord
} from "./types";

export type { GatewayObservationInput } from "./ostrich/ingestion/gateway-observation-records";

export function configureGatewayObservability(options: {
  retentionOlderThan?: string | null;
  disabled?: boolean;
  dbPath?: string | null;
}): void {
  configureGatewayObservabilityRuntime(options);
}

export function bootstrapGatewayObservability(): void {
  bootstrapGatewayObservabilityRuntime();
}

export function pruneGatewayObservabilityRetentionNow(source: "startup" | "interval" = "interval"): void {
  pruneGatewayObservabilityRetentionNowRuntime(source);
}

function createGatewayObservationWorkerDeps(): GatewayObservationWorkerDeps {
  return {
    workerScriptPath: path.join(__dirname, "gateway-writer-worker.js"),
    closeTimeoutMs: gatewayObservationWorkerCloseTimeoutMs(),
    writeTimeoutMs: gatewayObservationWorkerWriteTimeoutMs(),
    onDroppedCount: gatewayObservationRuntimeState.queue.registerDroppedGatewayObservationCount,
    onWorkerCloseTimeout: (error) => {
      logWarning(`Observability worker close timed out; forcing termination: ${safeErrorMessage(error)}`);
    },
    onWorkerFailure: (error) => {
      markGatewayObservabilityRuntimeFailed();
      logWarning(`Observability worker failed; continuing without persistence: ${safeErrorMessage(error)}`);
    }
  };
}

function handleGatewayObservationFlushFailure(error: unknown): void {
  markGatewayObservabilityRuntimeFailed();
  const message = safeErrorMessage(error ?? "Unknown observability worker flush error");
  logWarning(`Observability persistence failed; continuing without persistence: ${message}`);
}

function createGatewayObservationFlushOptions(): GatewayObservationFlushOptions {
  return {
    getObservabilityService,
    getDbPath: getGatewayObservabilityDbPath,
    flushBatchToWorker: flushGatewayObservationBatchToWorker,
    logWarning,
    onFlushFailure: handleGatewayObservationFlushFailure
  };
}

export async function shutdownGatewayObservability(): Promise<void> {
  const { drained, lost } = await drainGatewayObservationQueueForShutdown({
    clearFlushTimer: gatewayObservationRuntimeState.flush.clearGatewayObservationFlushTimer,
    clearDrainHandle: gatewayObservationRuntimeState.flush.clearGatewayObservationDrainHandle,
    pendingQueueLength: gatewayObservationRuntimeState.queue.pendingGatewayObservationQueueLength,
    isFlushActive: gatewayObservationRuntimeState.flush.isGatewayObservationFlushActive,
    getObservabilityService,
    getDbPath: getGatewayObservabilityDbPath,
    flushQueueNow: () => gatewayObservationRuntimeState.flush.flushGatewayObservationQueueNow(createGatewayObservationFlushOptions()),
    shutdownDrainTimeoutMs: gatewayObservationShutdownDrainTimeoutMs,
    clearPendingQueue: gatewayObservationRuntimeState.queue.clearPendingGatewayObservationQueue,
    logWarning
  });
  await gatewayObservationRuntimeState.worker.disposeGatewayObservationWorker(createGatewayObservationWorkerDeps());
  closeGatewayObservabilityRuntime();
  gatewayObservationRuntimeState.flush.resetGatewayObservationFlushState();
  gatewayObservationRuntimeState.queue.clearPendingGatewayObservationQueue();

  if (drained > 0 || lost > 0) {
    logLine(`Observability shutdown drain completed: drained=${drained} lost=${lost}`);
  }
}

async function flushGatewayObservationBatchToWorker(
  dbPath: string,
  batch: RecordObservationBatchItem[]
): Promise<{ durationMs: number; droppedCount: number; warnings: string[] }> {
  return gatewayObservationRuntimeState.worker.writeGatewayObservationBatch(
    dbPath,
    batch,
    createGatewayObservationWorkerDeps()
  );
}

function enqueueGatewayObservation(record: ObservationRecord, options: RecordObservationOptions): void {
  if (gatewayObservationRuntimeState.queue.enqueueGatewayObservation(record, options) === "immediate") {
    gatewayObservationRuntimeState.flush.scheduleGatewayObservationFlush("immediate", createGatewayObservationFlushOptions());
    return;
  }

  gatewayObservationRuntimeState.flush.scheduleGatewayObservationFlush("delayed", createGatewayObservationFlushOptions());
}

export function recordGatewayObservation(input: GatewayObservationInput): void {
  const service = getObservabilityService();

  if (!service) {
    return;
  }

  const record = buildGatewayObservationRecord(input, {
    onMetadataDropped: logWarning
  });

  enqueueGatewayObservation(record, {
    requestExecutionMode: "terminal_only"
  });
}

export function recordGatewayFailureObservation(
  stage: string,
  context: ProxyRequestContext,
  reason: string,
  route?: RouteConfig | null,
  attributes?: Record<string, unknown>
): void {
  recordGatewayObservation({
    context,
    route,
    kind: "error",
    event: "debug_error_context",
    stage: normalizeGatewayFailureStage(stage),
    outcome: inferGatewayFailureOutcome(stage, reason),
    attributes: {
      ...(attributes ?? {}),
      reason,
      original_stage: stage
    }
  });
}
