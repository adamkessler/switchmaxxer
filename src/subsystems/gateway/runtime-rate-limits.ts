import { parseRateLimitWindowMs } from "../../platform/rate-limit-window";
import type { AppConfig } from "../../platform/types";
import { createGlobalRateLimiter, type GlobalRateLimitDecision, type GlobalRateLimiter } from "./rate-limit";

const HEALTH_RATE_LIMIT_REQUESTS = 100;
const HEALTH_RATE_LIMIT_WINDOW_MS = 1_000;
const HEALTH_RATE_LIMIT_MAX_ENTRIES = 10_000;
const HEALTH_RATE_LIMIT_ENTRY_TTL_MS = 60_000;

export function createGatewayHealthRateLimiter(): GlobalRateLimiter {
  return createGlobalRateLimiter({
    requests: HEALTH_RATE_LIMIT_REQUESTS,
    windowMs: HEALTH_RATE_LIMIT_WINDOW_MS,
    maxEntries: HEALTH_RATE_LIMIT_MAX_ENTRIES,
    entryTtlMs: HEALTH_RATE_LIMIT_ENTRY_TTL_MS
  });
}

export function checkGatewayHealthRateLimit(
  limiter: GlobalRateLimiter,
  sourceIp: string,
  nowMs = Date.now()
): GlobalRateLimitDecision {
  return limiter.check(sourceIp, nowMs);
}

export function createGatewayRuntimeRateLimiter(config: AppConfig): GlobalRateLimiter {
  const windowMs = parseRateLimitWindowMs(config.rateLimit.window);

  if (windowMs === null) {
    throw new Error(`Gateway rate limit window '${config.rateLimit.window}' is invalid.`);
  }

  return createGlobalRateLimiter({
    requests: config.rateLimit.requests,
    windowMs
  });
}
