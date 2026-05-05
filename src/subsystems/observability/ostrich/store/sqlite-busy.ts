import { resolveNonNegativeIntegerEnv } from "../../../../platform/env";

const DEFAULT_OBSERVABILITY_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_OBSERVABILITY_BUSY_RETRY_ATTEMPTS = 3;
const DEFAULT_OBSERVABILITY_BUSY_RETRY_DELAY_MS = 25;
const DEFAULT_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES = 1_000;

export function resolveObservabilityBusyTimeoutMs(): number {
  return resolveNonNegativeIntegerEnv("SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS", DEFAULT_OBSERVABILITY_BUSY_TIMEOUT_MS);
}

export function resolveObservabilityBusyRetryAttempts(): number {
  return resolveNonNegativeIntegerEnv(
    "SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_ATTEMPTS",
    DEFAULT_OBSERVABILITY_BUSY_RETRY_ATTEMPTS
  );
}

export function resolveObservabilityBusyRetryDelayMs(): number {
  return resolveNonNegativeIntegerEnv(
    "SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_DELAY_MS",
    DEFAULT_OBSERVABILITY_BUSY_RETRY_DELAY_MS
  );
}

export function resolveObservabilityWalAutocheckpointPages(): number {
  return resolveNonNegativeIntegerEnv(
    "SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES",
    DEFAULT_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES
  );
}

export function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    errcode?: unknown;
    errstr?: unknown;
    message?: unknown;
  };

  return (
    candidate.errcode === 5 ||
    candidate.code === "SQLITE_BUSY" ||
    (typeof candidate.errstr === "string" && candidate.errstr.includes("database is locked")) ||
    (typeof candidate.message === "string" &&
      (candidate.message.includes("SQLITE_BUSY") || candidate.message.includes("database is locked")))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withSqliteBusyRetry<T>(
  operation: () => T | Promise<T>,
  options: {
    retryAttempts?: number;
    retryDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const retryAttempts = options.retryAttempts ?? resolveObservabilityBusyRetryAttempts();
  const retryDelayMs = options.retryDelayMs ?? resolveObservabilityBusyRetryDelayMs();

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Unknown SQLite busy error");

      if (!isSqliteBusyError(error) || attempt >= retryAttempts) {
        throw normalizedError;
      }

      options.onRetry?.(attempt + 1, normalizedError);
      await sleep(retryDelayMs);
    }
  }
}
