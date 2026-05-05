import { parseNonNegativeIntegerEnv, parsePositiveIntegerEnv } from "../../platform/env";
import { OBSERVABILITY_MAX_JSON_BYTES } from "./types";

const DEFAULT_GATEWAY_OBSERVABILITY_BATCH_SIZE = 50;
const DEFAULT_GATEWAY_OBSERVABILITY_FLUSH_DELAY_MS = 10;
const DEFAULT_GATEWAY_OBSERVABILITY_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_GATEWAY_OBSERVABILITY_MAX_QUEUE_BYTES =
  DEFAULT_GATEWAY_OBSERVABILITY_MAX_QUEUE_SIZE * OBSERVABILITY_MAX_JSON_BYTES;
const DEFAULT_GATEWAY_OBSERVABILITY_SLOW_FLUSH_WARN_MS = 25;
const DEFAULT_GATEWAY_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS = 10_000;
const DEFAULT_GATEWAY_OBSERVABILITY_WORKER_CLOSE_TIMEOUT_MS = 3_000;
const DEFAULT_GATEWAY_OBSERVABILITY_SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

export function gatewayObservationBatchSize(): number {
  return parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE") ?? DEFAULT_GATEWAY_OBSERVABILITY_BATCH_SIZE;
}

export function gatewayObservationFlushDelayMs(): number {
  return parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS") ?? DEFAULT_GATEWAY_OBSERVABILITY_FLUSH_DELAY_MS;
}

export function gatewayObservationMaxQueueSize(): number {
  const maxQueueSize =
    parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE") ?? DEFAULT_GATEWAY_OBSERVABILITY_MAX_QUEUE_SIZE;
  return Math.max(maxQueueSize, gatewayObservationBatchSize());
}

export function gatewayObservationMaxQueueBytes(): number {
  const maxQueueBytes =
    parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES") ?? DEFAULT_GATEWAY_OBSERVABILITY_MAX_QUEUE_BYTES;
  return Math.max(maxQueueBytes, gatewayObservationBatchSize());
}

export function gatewayObservationSlowFlushWarnMs(): number {
  return (
    parseNonNegativeIntegerEnv("SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS") ??
    DEFAULT_GATEWAY_OBSERVABILITY_SLOW_FLUSH_WARN_MS
  );
}

export function gatewayObservationWorkerWriteTimeoutMs(): number {
  return (
    parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS") ??
    DEFAULT_GATEWAY_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS
  );
}

export function gatewayObservationWorkerCloseTimeoutMs(): number {
  return (
    parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_WORKER_CLOSE_TIMEOUT_MS") ??
    DEFAULT_GATEWAY_OBSERVABILITY_WORKER_CLOSE_TIMEOUT_MS
  );
}

export function gatewayObservationShutdownDrainTimeoutMs(): number {
  return (
    parsePositiveIntegerEnv("SWITCHMAXXER_OBSERVABILITY_SHUTDOWN_DRAIN_TIMEOUT_MS") ??
    DEFAULT_GATEWAY_OBSERVABILITY_SHUTDOWN_DRAIN_TIMEOUT_MS
  );
}
