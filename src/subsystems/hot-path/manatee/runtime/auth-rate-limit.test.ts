import assert from "node:assert/strict";
import test from "node:test";

import { createFailedAuthAttemptLimiter } from "./auth-rate-limit";

void test("failed auth limiter blocks at the threshold within a single window", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 1_000,
    threshold: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.10", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.10", 1_500), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.10", 1_999), {
    status: "blocked",
    retryAfterSeconds: 1
  });
});

void test("failed auth limiter resets the failure count when the window expires", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 1_000,
    threshold: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.20", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.20", 1_500), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.20", 2_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.20", 2_500), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.20", 2_999), {
    status: "blocked",
    retryAfterSeconds: 1
  });
  assert.deepEqual(limiter.registerFailure("198.51.100.20", 4_000), { status: "allow_401" });
});

void test("failed auth limiter escalates exponential backoff and caps retry-after", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 2,
    initialBackoffMs: 1_000,
    maxBackoffMs: 4_000
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.30", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.30", 1_100), {
    status: "blocked",
    retryAfterSeconds: 1
  });
  assert.deepEqual(limiter.registerFailure("198.51.100.30", 1_200), {
    status: "blocked",
    retryAfterSeconds: 2
  });
  assert.deepEqual(limiter.registerFailure("198.51.100.30", 1_300), {
    status: "blocked",
    retryAfterSeconds: 4
  });
  assert.deepEqual(limiter.registerFailure("198.51.100.30", 1_400), {
    status: "blocked",
    retryAfterSeconds: 4
  });
});

void test("failed auth limiter tracks source IPs independently and reset clears one source", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 2,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.40", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.40", 1_100), {
    status: "blocked",
    retryAfterSeconds: 1
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.41", 1_100), { status: "allow_401" });

  limiter.reset("198.51.100.40");

  assert.deepEqual(limiter.registerFailure("198.51.100.40", 1_200), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.41", 1_200), {
    status: "blocked",
    retryAfterSeconds: 1
  });
});

void test("failed auth limiter preserves active blocks under cache pressure", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 2,
    initialBackoffMs: 10_000,
    maxBackoffMs: 10_000,
    maxEntries: 2
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.50", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.50", 1_001), {
    status: "blocked",
    retryAfterSeconds: 10
  });
  assert.deepEqual(limiter.registerFailure("198.51.100.51", 1_002), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.52", 1_003), { status: "allow_401" });

  const blockedAttempt = limiter.registerFailure("198.51.100.50", 1_004);
  assert.equal(blockedAttempt.status, "blocked");

  assert.deepEqual(limiter.registerFailure("198.51.100.51", 1_005), { status: "allow_401" });
});

void test("failed auth limiter evicts older active entries before recently touched entries", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000,
    maxEntries: 3
  });

  assert.deepEqual(limiter.registerFailure("198.51.100.60", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.61", 2_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.62", 3_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.60", 4_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("198.51.100.63", 5_000), { status: "allow_401" });

  assert.deepEqual(limiter.registerFailure("198.51.100.61", 6_000), { status: "allow_401" });

  const retainedAttempt = limiter.registerFailure("198.51.100.60", 7_000);
  assert.equal(retainedAttempt.status, "blocked");
  if (retainedAttempt.status === "blocked") {
    assert.equal(retainedAttempt.retryAfterSeconds, 1);
  }
});

void test("failed auth limiter validates security-sensitive limiter config", () => {
  assert.throws(
    () => createFailedAuthAttemptLimiter({ windowMs: 0 }),
    /requires a positive 'windowMs'/
  );
  assert.throws(
    () => createFailedAuthAttemptLimiter({ windowMs: Number.NaN }),
    /requires a positive 'windowMs'/
  );
  assert.throws(
    () => createFailedAuthAttemptLimiter({ threshold: 0 }),
    /requires a positive integer 'threshold'/
  );
  assert.throws(
    () => createFailedAuthAttemptLimiter({ threshold: 1.5 }),
    /requires a positive integer 'threshold'/
  );
  assert.throws(
    () => createFailedAuthAttemptLimiter({ maxEntries: 0 }),
    /requires a positive integer 'maxEntries'/
  );
  assert.throws(
    () => createFailedAuthAttemptLimiter({ maxEntries: 1.5 }),
    /requires a positive integer 'maxEntries'/
  );
});
