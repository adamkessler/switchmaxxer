import path from "node:path";

import { logWarning, safeErrorMessage } from "../../platform/logger";
export {
  resetGatewayObservabilityRuntimeForIsolatedRun as resetGatewayObservabilityForTests
} from "./gateway-observability-runtime-control";
import {
  gatewayObservationWorkerCloseTimeoutMs,
  gatewayObservationWorkerWriteTimeoutMs
} from "./gateway-observability-config";
import {
  getGatewayObservabilityService as getObservabilityService,
  getGatewayObservabilityDbPath,
  markGatewayObservabilityRuntimeFailed
} from "./gateway-observability-runtime";
import { gatewayObservationRuntimeState } from "./gateway-observation-runtime-state";
import { type GatewayObservationFlushOptions } from "./gateway-observation-flush";
import {
  type GatewayObservationWorkerDeps,
  type GatewayObservationWorkerWriteResult
} from "./gateway-observation-worker";
import type { RecordObservationBatchItem } from "./service";

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

function createGatewayObservationFlushOptions(): GatewayObservationFlushOptions {
  return {
    getObservabilityService,
    getDbPath: getGatewayObservabilityDbPath,
    flushBatchToWorker: flushGatewayObservationBatchToWorker,
    logWarning,
    onFlushFailure: (error) => {
      markGatewayObservabilityRuntimeFailed();
      const message = safeErrorMessage(error ?? "Unknown observability worker flush error");
      logWarning(`Observability persistence failed; continuing without persistence: ${message}`);
    }
  };
}

export async function flushGatewayObservationQueueForTests(): Promise<void> {
  gatewayObservationRuntimeState.flush.clearGatewayObservationFlushTimer();
  gatewayObservationRuntimeState.flush.clearGatewayObservationDrainHandle();

  while (
    gatewayObservationRuntimeState.queue.pendingGatewayObservationQueueLength() > 0 ||
    gatewayObservationRuntimeState.flush.isGatewayObservationFlushActive()
  ) {
    await gatewayObservationRuntimeState.flush.flushGatewayObservationQueueNow(createGatewayObservationFlushOptions());
  }
}

export function getPendingGatewayObservationWorkerWriteCountForTests(): number {
  return gatewayObservationRuntimeState.worker.getPendingGatewayObservationWorkerWriteCountForTests();
}

export function createPendingGatewayObservationWorkerWriteForTests(
  sequence: number,
  timeoutMs: number
): Promise<GatewayObservationWorkerWriteResult> {
  return gatewayObservationRuntimeState.worker.createPendingGatewayObservationWorkerWriteForTests(sequence, timeoutMs);
}

export function getGatewayObservationWorkerCloseTimeoutMsForTests(): number {
  return gatewayObservationWorkerCloseTimeoutMs();
}
