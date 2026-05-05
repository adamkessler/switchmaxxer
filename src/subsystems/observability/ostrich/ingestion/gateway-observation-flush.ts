import {
  gatewayObservationBatchSize,
  gatewayObservationFlushDelayMs,
  gatewayObservationSlowFlushWarnMs
} from "./gateway-observability-config";
import { type GatewayObservationQueueState } from "./gateway-observation-queue";
import type { ObservabilityService, RecordObservationBatchItem } from "../../service";

export type GatewayObservationFlushOptions = {
  getObservabilityService: () => ObservabilityService | null;
  getDbPath: () => string | null;
  flushBatchToWorker: (
    dbPath: string,
    batch: RecordObservationBatchItem[]
  ) => Promise<{ durationMs: number; droppedCount: number; warnings: string[] }>;
  logWarning: (message: string) => void;
  onFlushFailure: (error: unknown) => void;
};

export type GatewayObservationFlushState = ReturnType<typeof createGatewayObservationFlushState>;

function unrefHandle(handle: { unref?: () => void } | null): void {
  handle?.unref?.();
}

export function createGatewayObservationFlushState(queueState: GatewayObservationQueueState) {
  let pendingGatewayObservationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingGatewayObservationDrainHandle: ReturnType<typeof setImmediate> | null = null;
  let gatewayObservationFlushInProgress = false;
  let gatewayObservationFlushPromise: Promise<void> | null = null;

  function clearGatewayObservationFlushTimer(): void {
    if (pendingGatewayObservationFlushTimer !== null) {
      clearTimeout(pendingGatewayObservationFlushTimer);
      pendingGatewayObservationFlushTimer = null;
    }
  }

  function clearGatewayObservationDrainHandle(): void {
    if (pendingGatewayObservationDrainHandle !== null) {
      clearImmediate(pendingGatewayObservationDrainHandle);
      pendingGatewayObservationDrainHandle = null;
    }
  }

  function resetGatewayObservationFlushState(): void {
    gatewayObservationFlushInProgress = false;
    gatewayObservationFlushPromise = null;
  }

  function isGatewayObservationFlushActive(): boolean {
    return gatewayObservationFlushInProgress || gatewayObservationFlushPromise !== null;
  }

  function logDroppedGatewayObservationsIfNeeded(logWarning: (message: string) => void): void {
    const dropped = queueState.consumeDroppedGatewayObservationCount();
    if (dropped <= 0) {
      return;
    }

    logWarning(
      `Observability queue dropped ${dropped} observation(s) after reaching the configured pending queue limits.`
    );
  }

  async function flushGatewayObservationQueueNow(options: GatewayObservationFlushOptions): Promise<void> {
    if (gatewayObservationFlushPromise) {
      return gatewayObservationFlushPromise;
    }

    gatewayObservationFlushPromise = (async () => {
      const service = options.getObservabilityService();
      const dbPath = options.getDbPath();

      if (!service || !dbPath || queueState.pendingGatewayObservationQueueLength() === 0 || gatewayObservationFlushInProgress) {
        return;
      }

      gatewayObservationFlushInProgress = true;
      clearGatewayObservationFlushTimer();
      clearGatewayObservationDrainHandle();

      try {
        logDroppedGatewayObservationsIfNeeded(options.logWarning);

        const batch = queueState.drainPendingGatewayObservationBatch(gatewayObservationBatchSize());
        const result = await options.flushBatchToWorker(dbPath, batch);
        logDroppedGatewayObservationsIfNeeded(options.logWarning);

        for (const warning of result.warnings) {
          options.logWarning(warning);
        }

        if (result.durationMs >= gatewayObservationSlowFlushWarnMs()) {
          options.logWarning(
            `Observability batch flush took ${result.durationMs}ms for ${batch.length} observation(s); queue_depth=${queueState.pendingGatewayObservationQueueLength()}`
          );
        }
      } catch (error) {
        options.onFlushFailure(error);
      } finally {
        gatewayObservationFlushInProgress = false;
      }

      if (queueState.pendingGatewayObservationQueueLength() > 0) {
        scheduleGatewayObservationFlush("immediate", options);
      }
    })();

    try {
      await gatewayObservationFlushPromise;
    } finally {
      gatewayObservationFlushPromise = null;
    }
  }

  function scheduleGatewayObservationFlush(
    mode: "delayed" | "immediate" = "delayed",
    options: GatewayObservationFlushOptions
  ): void {
    if (gatewayObservationFlushInProgress) {
      return;
    }

    if (mode === "immediate") {
      clearGatewayObservationFlushTimer();

      if (pendingGatewayObservationDrainHandle !== null) {
        return;
      }

      pendingGatewayObservationDrainHandle = setImmediate(() => {
        pendingGatewayObservationDrainHandle = null;
        void flushGatewayObservationQueueNow(options);
      });
      unrefHandle(pendingGatewayObservationDrainHandle);
      return;
    }

    if (pendingGatewayObservationFlushTimer !== null || pendingGatewayObservationDrainHandle !== null) {
      return;
    }

    pendingGatewayObservationFlushTimer = setTimeout(() => {
      pendingGatewayObservationFlushTimer = null;
      void flushGatewayObservationQueueNow(options);
    }, gatewayObservationFlushDelayMs());
    unrefHandle(pendingGatewayObservationFlushTimer);
  }

  return {
    clearGatewayObservationFlushTimer,
    clearGatewayObservationDrainHandle,
    resetGatewayObservationFlushState,
    isGatewayObservationFlushActive,
    flushGatewayObservationQueueNow,
    scheduleGatewayObservationFlush
  };
}
