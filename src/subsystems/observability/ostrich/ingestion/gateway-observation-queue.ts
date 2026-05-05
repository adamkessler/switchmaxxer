import {
  gatewayObservationBatchSize,
  gatewayObservationMaxQueueBytes,
  gatewayObservationMaxQueueSize
} from "./gateway-observability-config";
import {
  gatewayObservationPriority,
  type GatewayObservationPriority
} from "./gateway-observation-priority";
import type { RecordObservationBatchItem, RecordObservationOptions } from "../../service";
import type { ObservationRecord } from "../../types";

type GatewayObservationPriorityBuckets = {
  0: GatewayObservationQueuedItem[];
  1: GatewayObservationQueuedItem[];
  2: GatewayObservationQueuedItem[];
  3: GatewayObservationQueuedItem[];
};

type GatewayObservationQueuedItem = {
  priority: GatewayObservationPriority;
  item: RecordObservationBatchItem;
  sizeBytes: number;
};

export type GatewayObservationQueueState = ReturnType<typeof createGatewayObservationQueueState>;

function createPendingGatewayObservationQueue(): GatewayObservationPriorityBuckets {
  return {
    0: [],
    1: [],
    2: [],
    3: []
  };
}

function measureGatewayObservationQueuedItemBytes(item: RecordObservationBatchItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8");
}

export function createGatewayObservationQueueState() {
  let pendingGatewayObservationQueue = createPendingGatewayObservationQueue();
  let pendingGatewayObservationDropCount = 0;
  let pendingGatewayObservationQueueBytes = 0;

  function pendingGatewayObservationQueueLength(): number {
    return (
      pendingGatewayObservationQueue[0].length +
      pendingGatewayObservationQueue[1].length +
      pendingGatewayObservationQueue[2].length +
      pendingGatewayObservationQueue[3].length
    );
  }

  function clearPendingGatewayObservationQueue(): void {
    pendingGatewayObservationQueue = createPendingGatewayObservationQueue();
    pendingGatewayObservationQueueBytes = 0;
  }

  function drainPendingGatewayObservationBatch(maxItems: number): RecordObservationBatchItem[] {
    const batch: RecordObservationBatchItem[] = [];

    while (batch.length < maxItems) {
      let nextQueued: GatewayObservationQueuedItem | null = null;

      for (const priority of [0, 1, 2, 3] as const) {
        const bucket = pendingGatewayObservationQueue[priority];
        const candidate = bucket[0];
        if (!candidate) {
          continue;
        }

        if (
          nextQueued === null ||
          candidate.item.record.observed_at.localeCompare(nextQueued.item.record.observed_at) < 0
        ) {
          nextQueued = candidate;
        }
      }

      if (nextQueued === null) {
        break;
      }

      pendingGatewayObservationQueue[nextQueued.priority].shift();
      pendingGatewayObservationQueueBytes -= nextQueued.sizeBytes;
      batch.push(nextQueued.item);
    }

    return batch;
  }

  function dropLowestPriorityGatewayObservation(): boolean {
    if (pendingGatewayObservationQueueLength() === 0) {
      return false;
    }

    for (const priority of [0, 1, 2, 3] as const) {
      const bucket = pendingGatewayObservationQueue[priority];
      if (bucket.length <= 0) {
        continue;
      }

      const dropped = bucket.shift();
      if (dropped) {
        pendingGatewayObservationQueueBytes -= dropped.sizeBytes;
      }
      pendingGatewayObservationDropCount += 1;
      return true;
    }

    return false;
  }

  function consumeDroppedGatewayObservationCount(): number {
    const dropped = pendingGatewayObservationDropCount;
    pendingGatewayObservationDropCount = 0;
    return dropped;
  }

  function registerDroppedGatewayObservationCount(count: number): void {
    if (count > 0) {
      pendingGatewayObservationDropCount += count;
    }
  }

  function resetDroppedGatewayObservationCount(): void {
    pendingGatewayObservationDropCount = 0;
  }

  function enqueueGatewayObservation(
    record: ObservationRecord,
    options: RecordObservationOptions
  ): "immediate" | "delayed" {
    const item: RecordObservationBatchItem = {
      record,
      options
    };
    const queuedItem: GatewayObservationQueuedItem = {
      priority: gatewayObservationPriority({ record, options }),
      item,
      sizeBytes: measureGatewayObservationQueuedItemBytes(item)
    };

    pendingGatewayObservationQueue[queuedItem.priority].push(queuedItem);
    pendingGatewayObservationQueueBytes += queuedItem.sizeBytes;

    while (
      pendingGatewayObservationQueueLength() > gatewayObservationMaxQueueSize() ||
      pendingGatewayObservationQueueBytes > gatewayObservationMaxQueueBytes()
    ) {
      if (!dropLowestPriorityGatewayObservation()) {
        break;
      }
    }

    return pendingGatewayObservationQueueLength() >= gatewayObservationBatchSize() ? "immediate" : "delayed";
  }

  return {
    pendingGatewayObservationQueueLength,
    clearPendingGatewayObservationQueue,
    drainPendingGatewayObservationBatch,
    dropLowestPriorityGatewayObservation,
    consumeDroppedGatewayObservationCount,
    registerDroppedGatewayObservationCount,
    resetDroppedGatewayObservationCount,
    enqueueGatewayObservation
  };
}
