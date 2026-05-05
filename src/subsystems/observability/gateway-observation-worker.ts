import { Worker } from "node:worker_threads";

import type { GatewayObservationWriterResponseMessage } from "./gateway-writer-protocol";
import type { RecordObservationBatchItem } from "./service";

type PendingGatewayObservationWorkerWrite = {
  resolve: (value: GatewayObservationWorkerWriteResult) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

export type GatewayObservationWorkerWriteResult = {
  durationMs: number;
  droppedCount: number;
  warnings: string[];
};

export type GatewayObservationWorkerDeps = {
  workerScriptPath: string;
  closeTimeoutMs: number;
  writeTimeoutMs: number;
  onDroppedCount: (count: number) => void;
  onWorkerCloseTimeout: (error: Error) => void;
  onWorkerFailure: (error: Error) => void;
};

export type GatewayObservationWorkerState = ReturnType<typeof createGatewayObservationWorkerState>;

function unrefHandle(handle: { unref?: () => void } | null): void {
  handle?.unref?.();
}

export function createGatewayObservationWorkerState() {
  let gatewayObservationWorker: Worker | null = null;
  let gatewayObservationWorkerDbPath: string | null = null;
  let gatewayObservationWorkerReadyPromise: Promise<void> | null = null;
  let gatewayObservationWorkerReadyResolve: (() => void) | null = null;
  let gatewayObservationWorkerReadyReject: ((error: Error) => void) | null = null;
  let gatewayObservationWorkerClosePromise: Promise<void> | null = null;
  let gatewayObservationWorkerCloseResolve: (() => void) | null = null;
  let gatewayObservationWorkerCloseReject: ((error: Error) => void) | null = null;
  let gatewayObservationWorkerShutdownInProgress = false;
  let gatewayObservationWorkerSequence = 0;
  let gatewayObservationWorkerGeneration = 0;
  const pendingGatewayObservationWorkerWrites = new Map<number, PendingGatewayObservationWorkerWrite>();

  function resetGatewayObservationWorkerState(options: { advanceGeneration?: boolean } = {}): void {
    gatewayObservationWorker = null;
    gatewayObservationWorkerDbPath = null;
    gatewayObservationWorkerReadyPromise = null;
    gatewayObservationWorkerReadyResolve = null;
    gatewayObservationWorkerReadyReject = null;
    gatewayObservationWorkerClosePromise = null;
    gatewayObservationWorkerCloseResolve = null;
    gatewayObservationWorkerCloseReject = null;
    gatewayObservationWorkerShutdownInProgress = false;
    gatewayObservationWorkerSequence = 0;
    if (options.advanceGeneration === true) {
      gatewayObservationWorkerGeneration += 1;
    }
  }

  function rejectPendingGatewayObservationWorkerWrites(error: Error): void {
    for (const pending of pendingGatewayObservationWorkerWrites.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }

    pendingGatewayObservationWorkerWrites.clear();
  }

  function handleGatewayObservationWorkerMessage(
    message: GatewayObservationWriterResponseMessage,
    deps: GatewayObservationWorkerDeps
  ): void {
    switch (message.type) {
      case "ready":
        gatewayObservationWorkerReadyResolve?.();
        gatewayObservationWorkerReadyResolve = null;
        gatewayObservationWorkerReadyReject = null;
        return;
      case "batch_written": {
        const pending = pendingGatewayObservationWorkerWrites.get(message.sequence);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutHandle);
        pendingGatewayObservationWorkerWrites.delete(message.sequence);
        deps.onDroppedCount(message.droppedCount);
        pending.resolve({
          durationMs: message.durationMs,
          droppedCount: message.droppedCount,
          warnings: message.warnings
        });
        return;
      }
      case "fatal": {
        const error = new Error(message.message);
        gatewayObservationWorkerReadyReject?.(error);
        gatewayObservationWorkerReadyResolve = null;
        gatewayObservationWorkerReadyReject = null;
        gatewayObservationWorkerCloseReject?.(error);
        gatewayObservationWorkerCloseResolve = null;
        gatewayObservationWorkerCloseReject = null;
        rejectPendingGatewayObservationWorkerWrites(error);
        return;
      }
      case "closed":
        gatewayObservationWorkerCloseResolve?.();
        gatewayObservationWorkerCloseResolve = null;
        gatewayObservationWorkerCloseReject = null;
        return;
      default: {
        const exhaustiveMessage: never = message;
        throw new Error(`Unsupported gateway observation writer response: ${String(exhaustiveMessage)}`);
      }
    }
  }

  function handleGatewayObservationWorkerMessageForGeneration(
    workerGeneration: number,
    message: GatewayObservationWriterResponseMessage,
    deps: GatewayObservationWorkerDeps
  ): void {
    if (workerGeneration !== gatewayObservationWorkerGeneration) {
      return;
    }

    handleGatewayObservationWorkerMessage(message, deps);
  }

  function handleGatewayObservationWorkerErrorForGeneration(
    workerGeneration: number,
    error: Error,
    deps: GatewayObservationWorkerDeps
  ): void {
    if (workerGeneration !== gatewayObservationWorkerGeneration) {
      return;
    }

    gatewayObservationWorkerReadyReject?.(error);
    gatewayObservationWorkerReadyResolve = null;
    gatewayObservationWorkerReadyReject = null;
    gatewayObservationWorkerCloseReject?.(error);
    gatewayObservationWorkerCloseResolve = null;
    gatewayObservationWorkerCloseReject = null;
    rejectPendingGatewayObservationWorkerWrites(error);
    deps.onWorkerFailure(error);
    void disposeGatewayObservationWorker(deps);
  }

  function handleGatewayObservationWorkerExitForGeneration(
    workerGeneration: number,
    code: number,
    deps: GatewayObservationWorkerDeps
  ): void {
    if (workerGeneration !== gatewayObservationWorkerGeneration) {
      return;
    }

    if (code !== 0) {
      const error = new Error(`Gateway observation worker exited with code ${code}.`);
      gatewayObservationWorkerReadyReject?.(error);
      gatewayObservationWorkerReadyResolve = null;
      gatewayObservationWorkerReadyReject = null;
      gatewayObservationWorkerCloseReject?.(error);
      gatewayObservationWorkerCloseResolve = null;
      gatewayObservationWorkerCloseReject = null;
      rejectPendingGatewayObservationWorkerWrites(error);
      deps.onWorkerFailure(error);
    }

    resetGatewayObservationWorkerState({ advanceGeneration: true });
  }

  async function disposeGatewayObservationWorker(deps: GatewayObservationWorkerDeps): Promise<void> {
    const workerToTerminate = gatewayObservationWorker;

    if (!workerToTerminate) {
      resetGatewayObservationWorkerState({ advanceGeneration: true });
      rejectPendingGatewayObservationWorkerWrites(new Error("Gateway observation writer stopped."));
      return;
    }

    if (gatewayObservationWorkerShutdownInProgress && gatewayObservationWorkerClosePromise) {
      await gatewayObservationWorkerClosePromise.catch(() => undefined);
      return;
    }

    gatewayObservationWorkerShutdownInProgress = true;
    gatewayObservationWorkerClosePromise = new Promise<void>((resolve, reject) => {
      gatewayObservationWorkerCloseResolve = resolve;
      gatewayObservationWorkerCloseReject = reject;
    });

    try {
      workerToTerminate.postMessage({ type: "close" });
    } catch (error) {
      gatewayObservationWorkerCloseReject?.(
        error instanceof Error ? error : new Error("Failed to post worker close message.")
      );
    }

    let gracefulCloseTimedOut = false;

    try {
      await Promise.race([
        gatewayObservationWorkerClosePromise,
        new Promise<void>((_, reject) => {
          const timeoutHandle = setTimeout(() => {
            reject(new Error(`Gateway observation worker close timed out after ${deps.closeTimeoutMs}ms.`));
          }, deps.closeTimeoutMs);
          unrefHandle(timeoutHandle);
        })
      ]);
    } catch (error) {
      gracefulCloseTimedOut = true;
      deps.onWorkerCloseTimeout(
        error instanceof Error ? error : new Error("Gateway observation worker close timed out.")
      );
    }

    workerToTerminate.removeAllListeners();
    try {
      await workerToTerminate.terminate();
    } finally {
      resetGatewayObservationWorkerState({ advanceGeneration: true });
      rejectPendingGatewayObservationWorkerWrites(
        new Error(gracefulCloseTimedOut
          ? "Gateway observation writer close timed out and was force-terminated."
          : "Gateway observation writer stopped.")
      );
    }
  }

  async function ensureGatewayObservationWorker(
    dbPath: string,
    deps: GatewayObservationWorkerDeps
  ): Promise<void> {
    if (gatewayObservationWorker && gatewayObservationWorkerDbPath === dbPath && gatewayObservationWorkerReadyPromise) {
      return gatewayObservationWorkerReadyPromise;
    }

    await disposeGatewayObservationWorker(deps);

    gatewayObservationWorkerDbPath = dbPath;
    gatewayObservationWorker = new Worker(deps.workerScriptPath);
    // Disposal advances the generation to invalidate callbacks from the old worker.
    // Advance again here to assign a distinct generation token to the new worker.
    gatewayObservationWorkerGeneration += 1;
    const workerGeneration = gatewayObservationWorkerGeneration;
    unrefHandle(gatewayObservationWorker);
    gatewayObservationWorkerReadyPromise = new Promise<void>((resolve, reject) => {
      gatewayObservationWorkerReadyResolve = resolve;
      gatewayObservationWorkerReadyReject = reject;
    });
    gatewayObservationWorkerClosePromise = null;
    gatewayObservationWorkerCloseResolve = null;
    gatewayObservationWorkerCloseReject = null;
    gatewayObservationWorkerShutdownInProgress = false;

    gatewayObservationWorker.on("message", (message: GatewayObservationWriterResponseMessage) => {
      handleGatewayObservationWorkerMessageForGeneration(workerGeneration, message, deps);
    });
    gatewayObservationWorker.on("error", (error) => {
      handleGatewayObservationWorkerErrorForGeneration(workerGeneration, error, deps);
    });
    gatewayObservationWorker.on("exit", (code) => {
      handleGatewayObservationWorkerExitForGeneration(workerGeneration, code, deps);
    });

    gatewayObservationWorker.postMessage({
      type: "init",
      dbPath
    });

    return gatewayObservationWorkerReadyPromise;
  }

  function createPendingGatewayObservationWorkerWrite(
    sequence: number,
    timeoutMs: number,
    options: { refTimeout?: boolean } = {}
  ): Promise<GatewayObservationWorkerWriteResult> {
    return new Promise<GatewayObservationWorkerWriteResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pending = pendingGatewayObservationWorkerWrites.get(sequence);
        if (!pending) {
          return;
        }

        pendingGatewayObservationWorkerWrites.delete(sequence);
        pending.reject(new Error(`Gateway observation worker write timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      if (options.refTimeout !== true) {
        unrefHandle(timeoutHandle);
      }

      pendingGatewayObservationWorkerWrites.set(sequence, {
        resolve,
        reject,
        timeoutHandle
      });
    });
  }

  async function writeGatewayObservationBatch(
    dbPath: string,
    batch: RecordObservationBatchItem[],
    deps: GatewayObservationWorkerDeps
  ): Promise<GatewayObservationWorkerWriteResult> {
    await ensureGatewayObservationWorker(dbPath, deps);

    if (!gatewayObservationWorker) {
      throw new Error("Gateway observation worker is unavailable.");
    }

    if (gatewayObservationWorkerShutdownInProgress) {
      throw new Error("Gateway observation worker is shutting down.");
    }

    if (gatewayObservationWorkerSequence >= Number.MAX_SAFE_INTEGER) {
      gatewayObservationWorkerSequence = 0;
    }

    const sequence = gatewayObservationWorkerSequence;
    gatewayObservationWorkerSequence += 1;

    const pendingWrite = createPendingGatewayObservationWorkerWrite(sequence, deps.writeTimeoutMs);

    gatewayObservationWorker.postMessage({
      type: "write_batch",
      sequence,
      batch
    });

    return pendingWrite;
  }

  function getPendingGatewayObservationWorkerWriteCountForTests(): number {
    return pendingGatewayObservationWorkerWrites.size;
  }

  function createPendingGatewayObservationWorkerWriteForTests(
    sequence: number,
    timeoutMs: number
  ): Promise<GatewayObservationWorkerWriteResult> {
    return createPendingGatewayObservationWorkerWrite(sequence, timeoutMs, { refTimeout: true });
  }

  function getGatewayObservationWorkerGenerationForTests(): number {
    return gatewayObservationWorkerGeneration;
  }

  function handleGatewayObservationWorkerMessageForTests(
    workerGeneration: number,
    message: GatewayObservationWriterResponseMessage,
    deps: GatewayObservationWorkerDeps
  ): void {
    handleGatewayObservationWorkerMessageForGeneration(workerGeneration, message, deps);
  }

  return {
    disposeGatewayObservationWorker,
    ensureGatewayObservationWorker,
    writeGatewayObservationBatch,
    getPendingGatewayObservationWorkerWriteCountForTests,
    createPendingGatewayObservationWorkerWriteForTests,
    getGatewayObservationWorkerGenerationForTests,
    handleGatewayObservationWorkerMessageForTests
  };
}
