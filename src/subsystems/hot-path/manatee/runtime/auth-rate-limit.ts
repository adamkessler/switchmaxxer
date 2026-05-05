import { advanceWindow } from "./window-rotation";

export type FailedAuthDecision =
  | { status: "allow_401" }
  | { status: "blocked"; retryAfterSeconds: number };

export interface FailedAuthAttemptLimiter {
  registerFailure(sourceIp: string, nowMs?: number): FailedAuthDecision;
  reset(sourceIp: string): void;
}

type FailedAuthEntry = {
  windowStartedAtMs: number;
  failureCount: number;
  firstSeenAtMs: number;
  firstFailureAtMs: number;
  lastFailureAtMs: number;
  blockedUntilMs: number;
  lastTouchedAtMs: number;
};

type FailedAuthEvictionCandidate = {
  sourceIp: string;
  entry: FailedAuthEntry;
};

export function createFailedAuthAttemptLimiter(config: {
  windowMs?: number;
  threshold?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxEntries?: number;
} = {}): FailedAuthAttemptLimiter {
  const windowMs = config.windowMs ?? 10 * 60_000;
  const threshold = config.threshold ?? 5;
  const initialBackoffMs = config.initialBackoffMs ?? 30_000;
  const maxBackoffMs = config.maxBackoffMs ?? 5 * 60_000;
  const maxEntries = config.maxEntries ?? 10_000;

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Failed auth limiter requires a positive 'windowMs'.");
  }

  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Failed auth limiter requires a positive integer 'threshold'.");
  }

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Failed auth limiter requires a positive integer 'maxEntries'.");
  }

  const entries = new Map<string, FailedAuthEntry>();

  function createEntry(windowStartedAtMs: number, firstSeenAtMs = windowStartedAtMs): FailedAuthEntry {
    return {
      failureCount: 0,
      firstSeenAtMs,
      firstFailureAtMs: windowStartedAtMs,
      lastFailureAtMs: windowStartedAtMs,
      blockedUntilMs: 0,
      lastTouchedAtMs: windowStartedAtMs,
      windowStartedAtMs
    };
  }

  function touchEntry(sourceIp: string, entry: FailedAuthEntry, nowMs: number): void {
    entry.lastTouchedAtMs = nowMs;
    entries.delete(sourceIp);
    entries.set(sourceIp, entry);
  }

  function isEntryBlocked(entry: FailedAuthEntry, nowMs: number): boolean {
    return entry.blockedUntilMs > nowMs;
  }

  function isEntryWindowDrained(entry: FailedAuthEntry, nowMs: number): boolean {
    return nowMs - entry.lastFailureAtMs > windowMs;
  }

  function evictionPriority(entry: FailedAuthEntry, nowMs: number): number {
    if (isEntryBlocked(entry, nowMs)) {
      return 2;
    }

    if (isEntryWindowDrained(entry, nowMs)) {
      return 0;
    }

    return 1;
  }

  function compareEvictionCandidates(
    candidateA: FailedAuthEvictionCandidate,
    candidateB: FailedAuthEvictionCandidate,
    nowMs: number
  ): number {
    const priorityA = evictionPriority(candidateA.entry, nowMs);
    const priorityB = evictionPriority(candidateB.entry, nowMs);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    if (
      isEntryBlocked(candidateA.entry, nowMs) &&
      candidateA.entry.blockedUntilMs !== candidateB.entry.blockedUntilMs
    ) {
      return candidateA.entry.blockedUntilMs - candidateB.entry.blockedUntilMs;
    }

    if (candidateA.entry.lastTouchedAtMs !== candidateB.entry.lastTouchedAtMs) {
      return candidateA.entry.lastTouchedAtMs - candidateB.entry.lastTouchedAtMs;
    }

    if (candidateA.entry.firstSeenAtMs !== candidateB.entry.firstSeenAtMs) {
      return candidateA.entry.firstSeenAtMs - candidateB.entry.firstSeenAtMs;
    }

    return candidateA.sourceIp.localeCompare(candidateB.sourceIp);
  }

  function selectEvictionCandidate(nowMs: number): FailedAuthEvictionCandidate | null {
    let selected: FailedAuthEvictionCandidate | null = null;

    for (const [sourceIp, entry] of entries) {
      const candidate = { sourceIp, entry };

      if (selected === null || compareEvictionCandidates(candidate, selected, nowMs) < 0) {
        selected = candidate;
      }
    }

    return selected;
  }

  function pruneExpiredEntries(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (!isEntryBlocked(entry, nowMs) && isEntryWindowDrained(entry, nowMs)) {
        entries.delete(key);
      }
    }

    while (entries.size > maxEntries) {
      const candidate = selectEvictionCandidate(nowMs);

      if (candidate === null) {
        break;
      }

      entries.delete(candidate.sourceIp);
    }
  }

  return {
    registerFailure(sourceIp: string, nowMs = Date.now()): FailedAuthDecision {
      pruneExpiredEntries(nowMs);

      const current = entries.get(sourceIp);
      const baseline = current ?? createEntry(nowMs);
      const entry = advanceWindow(
        baseline,
        nowMs,
        windowMs,
        (nextWindowStartedAtMs) => createEntry(nextWindowStartedAtMs, baseline.firstSeenAtMs)
      );

      entry.failureCount += 1;
      entry.lastFailureAtMs = nowMs;

      if (entry.failureCount >= threshold) {
        const exponent = Math.max(0, entry.failureCount - threshold);
        const backoffMs = Math.min(initialBackoffMs * 2 ** exponent, maxBackoffMs);
        entry.blockedUntilMs = Math.max(entry.blockedUntilMs, nowMs + backoffMs);
        touchEntry(sourceIp, entry, nowMs);
        pruneExpiredEntries(nowMs);
        return {
          status: "blocked",
          retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntilMs - nowMs) / 1_000))
        };
      }

      touchEntry(sourceIp, entry, nowMs);
      pruneExpiredEntries(nowMs);
      return { status: "allow_401" };
    },

    reset(sourceIp: string): void {
      entries.delete(sourceIp);
    }
  };
}
