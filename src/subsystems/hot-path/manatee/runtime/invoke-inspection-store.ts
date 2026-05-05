import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  createInvokeInspectionCapture,
  INVOKE_INSPECTION_DEFAULT_TTL_MS,
  INVOKE_INSPECTION_MAX_CAPTURE_BYTES,
  INVOKE_INSPECTION_MAX_CAPTURES,
  removeInvokeInspectionCaptureBindings,
  type InvokeInspectionCapture
} from "./invoke-inspection";

export const INVOKE_INSPECTION_MAX_STORE_BYTES =
  INVOKE_INSPECTION_MAX_CAPTURE_BYTES * INVOKE_INSPECTION_MAX_CAPTURES;

export interface InvokeInspectionCaptureStore {
  allocate(): {
    id: string;
    readToken: string;
    capture: InvokeInspectionCapture;
  };
  consume(id: string, readToken: string): InvokeInspectionCapture | null;
  prune(nowMs?: number): void;
  dispose(): void;
}

type InvokeInspectionPruneTimer = {
  unref?: () => void;
};

type InvokeInspectionCaptureStoreOptions = {
  nowMs?: () => number;
  autoPruneIntervalMs?: number | null;
  maxTotalBytes?: number;
  setInterval?: (callback: () => void, intervalMs: number) => InvokeInspectionPruneTimer;
  clearInterval?: (timer: InvokeInspectionPruneTimer) => void;
};

type StoredInvokeInspectionCapture = {
  capture: InvokeInspectionCapture;
  readTokenHash: Buffer;
};

const INVOKE_INSPECTION_PRUNE_INTERVAL_MS = Math.max(1, Math.floor(INVOKE_INSPECTION_DEFAULT_TTL_MS / 2));
const INVOKE_INSPECTION_READ_TOKEN_BYTES = 32;

function normalizeMaxTotalBytes(value: number | undefined): number {
  if (typeof value === "undefined") {
    return INVOKE_INSPECTION_MAX_STORE_BYTES;
  }

  if (!Number.isFinite(value) || value < 1) {
    return INVOKE_INSPECTION_MAX_STORE_BYTES;
  }

  return Math.floor(value);
}

function estimateInvokeInspectionCaptureBytes(capture: InvokeInspectionCapture): number {
  return Buffer.byteLength(JSON.stringify(capture), "utf8");
}

function estimateInvokeInspectionStoreBytes(captures: ReadonlyMap<string, StoredInvokeInspectionCapture>): number {
  let totalBytes = 0;

  for (const stored of captures.values()) {
    totalBytes += estimateInvokeInspectionCaptureBytes(stored.capture);
  }

  return totalBytes;
}

function createInvokeInspectionReadToken(): string {
  return randomBytes(INVOKE_INSPECTION_READ_TOKEN_BYTES).toString("base64url");
}

function hashInvokeInspectionReadToken(readToken: string): Buffer {
  return createHash("sha256").update(readToken, "utf8").digest();
}

function readTokenMatches(readToken: string, expectedHash: Buffer): boolean {
  const receivedHash = hashInvokeInspectionReadToken(readToken);
  return timingSafeEqual(receivedHash, expectedHash);
}

export function createInvokeInspectionCaptureStore(
  options: InvokeInspectionCaptureStoreOptions = {}
): InvokeInspectionCaptureStore {
  const captures = new Map<string, StoredInvokeInspectionCapture>();
  const nowMs = options.nowMs ?? (() => Date.now());
  const scheduleInterval = options.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
  const clearScheduledInterval =
    options.clearInterval ??
    ((timer) => {
      clearInterval(timer as ReturnType<typeof setInterval>);
    });
  const autoPruneIntervalMs =
    typeof options.autoPruneIntervalMs === "undefined"
      ? INVOKE_INSPECTION_PRUNE_INTERVAL_MS
      : options.autoPruneIntervalMs;
  const maxTotalBytes = normalizeMaxTotalBytes(options.maxTotalBytes);
  let pruneTimer: InvokeInspectionPruneTimer | null = null;

  function deleteCapture(id: string, stored: StoredInvokeInspectionCapture): void {
    captures.delete(id);
    removeInvokeInspectionCaptureBindings(stored.capture);
  }

  function prune(nowMsValue = nowMs()): void {
    for (const [id, stored] of captures.entries()) {
      if (nowMsValue - stored.capture.createdAt > INVOKE_INSPECTION_DEFAULT_TTL_MS) {
        deleteCapture(id, stored);
      }
    }

    while (captures.size > INVOKE_INSPECTION_MAX_CAPTURES) {
      const oldest = captures.entries().next().value as [string, StoredInvokeInspectionCapture] | undefined;
      if (!oldest) {
        return;
      }
      deleteCapture(oldest[0], oldest[1]);
    }

    let totalBytes = estimateInvokeInspectionStoreBytes(captures);
    while (totalBytes > maxTotalBytes) {
      const oldest = captures.entries().next().value as [string, StoredInvokeInspectionCapture] | undefined;
      if (!oldest) {
        return;
      }

      deleteCapture(oldest[0], oldest[1]);
      totalBytes = estimateInvokeInspectionStoreBytes(captures);
    }
  }

  if (autoPruneIntervalMs !== null) {
    pruneTimer = scheduleInterval(() => {
      prune();
    }, autoPruneIntervalMs);
    pruneTimer.unref?.();
  }

  const store: InvokeInspectionCaptureStore = {
    allocate(): { id: string; readToken: string; capture: InvokeInspectionCapture } {
      const id = randomUUID();
      const readToken = createInvokeInspectionReadToken();
      prune();
      const capture = createInvokeInspectionCapture(id, nowMs());
      captures.set(id, {
        capture,
        readTokenHash: hashInvokeInspectionReadToken(readToken)
      });
      return { id, readToken, capture };
    },

    consume(id: string, readToken: string): InvokeInspectionCapture | null {
      prune();
      const stored = captures.get(id);

      if (typeof stored === "undefined") {
        return null;
      }

      if (!readTokenMatches(readToken, stored.readTokenHash)) {
        return null;
      }

      deleteCapture(id, stored);
      return stored.capture;
    },

    prune,

    dispose(): void {
      if (pruneTimer === null) {
        return;
      }

      clearScheduledInterval(pruneTimer);
      pruneTimer = null;
    }
  };

  return store;
}
