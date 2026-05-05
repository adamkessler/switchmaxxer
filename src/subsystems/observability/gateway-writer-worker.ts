import { parentPort } from "node:worker_threads";

import type {
  GatewayObservationWriterRequestMessage,
  GatewayObservationWriterResponseMessage
} from "./gateway-writer-protocol";
import { normalizeGatewayObservationBatch } from "./gateway-writer-bounds";
import { ObservabilityService } from "./service";
import { withSqliteBusyRetry } from "./sqlite-busy";
import { bootstrapObservabilityStore, closeObservabilityStore, type ObservabilityStore } from "./store";

if (!parentPort) {
  throw new Error("Gateway observation writer worker requires a parent port.");
}

function postMessage(message: GatewayObservationWriterResponseMessage): void {
  parentPort?.postMessage(message);
}

function createGatewayWriterWorkerRuntime(options: {
  postMessage: (message: GatewayObservationWriterResponseMessage) => void;
}): {
  handleMessage: (message: GatewayObservationWriterRequestMessage) => Promise<void>;
} {
  let store: ObservabilityStore | null = null;
  let service: ObservabilityService | null = null;
  let closeRequested = false;
  let inFlightWrites = 0;

  const closeWorkerStoreIfIdle = (): void => {
    if (!closeRequested || inFlightWrites > 0) {
      return;
    }

    if (store) {
      closeObservabilityStore(store);
      store = null;
      service = null;
    }

    options.postMessage({ type: "closed" });
  };

  const writeBatch = async (
    batch: Parameters<ObservabilityService["recordObservationBatch"]>[0]
  ): Promise<{ durationMs: number; warnings: string[] }> => {
    if (!service) {
      throw new Error("Gateway observation writer is not initialized.");
    }

    const warnings: string[] = [];
    const startedAt = Date.now();

    try {
      await withSqliteBusyRetry(
        () => {
          service?.recordObservationBatch(batch);
        },
        {
          onRetry: (attempt, error) => {
            warnings.push(`Observability batch write hit SQLITE_BUSY; retry attempt ${attempt}: ${error.message}`);
          }
        }
      );
    } catch (error) {
      const batchMessage = error instanceof Error ? error.message : "Unknown observation batch persistence error";
      warnings.push(`Observability batch persistence failed; retrying individual observations: ${batchMessage}`);

      for (const item of batch) {
        try {
          service.recordObservation(item.record, item.options);
        } catch (itemError) {
          const message = itemError instanceof Error ? itemError.message : "Unknown observation persistence error";
          warnings.push(
            `Observability persistence failed for request ${item.record.request_id ?? item.record.id}; continuing: ${message}`
          );
        }
      }
    }

    return {
      durationMs: Date.now() - startedAt,
      warnings
    };
  };

  return {
    handleMessage: async (message) => {
      switch (message.type) {
        case "init":
          closeRequested = false;
          inFlightWrites = 0;
          if (store) {
            closeObservabilityStore(store);
          }

          store = bootstrapObservabilityStore({ dbPath: message.dbPath });
          service = new ObservabilityService(store.db);
          options.postMessage({ type: "ready" });
          return;
        case "write_batch": {
          if (closeRequested) {
            throw new Error("Gateway observation writer is shutting down.");
          }

          const normalizedBatch = normalizeGatewayObservationBatch(message.batch);
          inFlightWrites += 1;

          try {
            const result = await writeBatch(normalizedBatch.accepted);
            options.postMessage({
              type: "batch_written",
              sequence: message.sequence,
              durationMs: result.durationMs,
              droppedCount: normalizedBatch.dropped,
              warnings: [...normalizedBatch.warnings, ...result.warnings]
            });
          } finally {
            inFlightWrites = Math.max(0, inFlightWrites - 1);
            closeWorkerStoreIfIdle();
          }
          return;
        }
        case "close":
          closeRequested = true;
          closeWorkerStoreIfIdle();
          return;
        default: {
          const exhaustiveMessage: never = message;
          throw new Error(`Unsupported gateway observation writer message: ${String(exhaustiveMessage)}`);
        }
      }
    }
  };
}

const workerRuntime = createGatewayWriterWorkerRuntime({ postMessage });

parentPort.on("message", (message: GatewayObservationWriterRequestMessage) => {
  void (async () => {
    try {
      await workerRuntime.handleMessage(message);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Unknown gateway observation writer error");
      postMessage({
        type: "fatal",
        message: normalizedError.message
      });
    }
  })();
});
