import { advanceWindow } from "./window-rotation";

export type GlobalRateLimitDecision =
  | { allowed: true; remaining: number; resetAtMs: number }
  | { allowed: false; retryAfterSeconds: number; resetAtMs: number };

export interface GlobalRateLimiter {
  check(callerKey: string, nowMs?: number): GlobalRateLimitDecision;
}

const DEFAULT_GLOBAL_RATE_LIMIT_MAX_ENTRIES = 10_000;

type GlobalRateLimitEntry = {
  windowStartedAtMs: number;
  requestCount: number;
  lastTouchedAtMs: number;
};

export function evictRateLimitEntriesOlderThan(
  entries: Map<string, GlobalRateLimitEntry>,
  entryTtlMs: number,
  nowMs: number
): void {
  for (const [key, candidate] of entries) {
    if ((nowMs - candidate.lastTouchedAtMs) > entryTtlMs) {
      entries.delete(key);
    }
  }
}

export function createGlobalRateLimiter(config: {
  requests: number;
  windowMs: number;
  maxEntries?: number;
  entryTtlMs?: number;
}): GlobalRateLimiter {
  if (!Number.isInteger(config.requests) || config.requests <= 0) {
    throw new Error("Global rate limiter requires a positive integer 'requests'.");
  }

  if (!Number.isFinite(config.windowMs) || config.windowMs <= 0) {
    throw new Error("Global rate limiter requires a positive 'windowMs'.");
  }

  const maxEntries = config.maxEntries ?? DEFAULT_GLOBAL_RATE_LIMIT_MAX_ENTRIES;

  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("Global rate limiter requires a positive integer 'maxEntries'.");
  }

  if (
    typeof config.entryTtlMs !== "undefined"
    && (!Number.isFinite(config.entryTtlMs) || config.entryTtlMs <= 0)
  ) {
    throw new Error("Global rate limiter requires a positive 'entryTtlMs' when provided.");
  }

  const entries = new Map<string, GlobalRateLimitEntry>();

  return {
    check(callerKey: string, nowMs = Date.now()): GlobalRateLimitDecision {
      const normalizedCallerKey = callerKey.trim().length > 0 ? callerKey : "unknown";

      if (typeof config.entryTtlMs === "number") {
        evictRateLimitEntriesOlderThan(entries, config.entryTtlMs, nowMs);
      }

      const currentState = entries.get(normalizedCallerKey) ?? {
        windowStartedAtMs: 0,
        requestCount: 0,
        lastTouchedAtMs: nowMs
      };
      const nextState = advanceWindow(currentState, nowMs, config.windowMs, (nextWindowStartedAtMs) => ({
        windowStartedAtMs: nextWindowStartedAtMs,
        requestCount: 0,
        lastTouchedAtMs: nowMs
      }));
      nextState.lastTouchedAtMs = nowMs;

      entries.delete(normalizedCallerKey);
      entries.set(normalizedCallerKey, nextState);

      while (entries.size > maxEntries) {
        let oldestKey: string | null = null;
        let oldestTouchedAtMs = Number.POSITIVE_INFINITY;

        for (const [key, candidate] of entries) {
          if (candidate.lastTouchedAtMs < oldestTouchedAtMs) {
            oldestTouchedAtMs = candidate.lastTouchedAtMs;
            oldestKey = key;
          }
        }

        if (typeof oldestKey !== "string") {
          break;
        }

        entries.delete(oldestKey);
      }

      const resetAtMs = nextState.windowStartedAtMs + config.windowMs;

      if (nextState.requestCount >= config.requests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
          resetAtMs
        };
      }

      nextState.requestCount += 1;

      return {
        allowed: true,
        remaining: Math.max(0, config.requests - nextState.requestCount),
        resetAtMs
      };
    }
  };
}
