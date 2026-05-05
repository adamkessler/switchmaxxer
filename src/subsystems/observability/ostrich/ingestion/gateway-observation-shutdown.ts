import { safeErrorMessage } from "../../../../platform/logger";
import type { ObservabilityService } from "../../service";

function unrefHandle(handle: { unref?: () => void } | null): void {
  handle?.unref?.();
}

export async function drainGatewayObservationQueueForShutdown(options: {
  clearFlushTimer: () => void;
  clearDrainHandle: () => void;
  pendingQueueLength: () => number;
  isFlushActive: () => boolean;
  getObservabilityService: () => ObservabilityService | null;
  getDbPath: () => string | null;
  flushQueueNow: () => Promise<void>;
  shutdownDrainTimeoutMs: () => number;
  clearPendingQueue: () => void;
  logWarning: (message: string) => void;
}): Promise<{ drained: number; lost: number }> {
  options.clearFlushTimer();
  options.clearDrainHandle();

  const queueLengthAtStart = options.pendingQueueLength();
  if (queueLengthAtStart <= 0 && !options.isFlushActive()) {
    return {
      drained: 0,
      lost: 0
    };
  }

  const timeoutAt = Date.now() + options.shutdownDrainTimeoutMs();
  while (Date.now() < timeoutAt) {
    const remainingMs = timeoutAt - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    if (options.pendingQueueLength() <= 0 && !options.isFlushActive()) {
      break;
    }

    const service = options.getObservabilityService();
    const dbPath = options.getDbPath();
    if (!service || !dbPath) {
      break;
    }

    try {
      await Promise.race([
        options.flushQueueNow(),
        new Promise<never>((_, reject) => {
          const timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `Gateway observation shutdown drain timed out after ${options.shutdownDrainTimeoutMs()}ms.`
              )
            );
          }, remainingMs);
          unrefHandle(timeoutHandle);
        })
      ]);
    } catch (error) {
      options.logWarning(`Observability shutdown drain stopped early: ${safeErrorMessage(error)}`);
      break;
    }
  }

  const lost = options.pendingQueueLength();
  const drained = Math.max(queueLengthAtStart - lost, 0);

  if (lost > 0) {
    options.clearPendingQueue();
  }

  return {
    drained,
    lost
  };
}
