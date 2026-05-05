import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";

void test("json parse concurrency manager enforces the configured cap and releases idempotently", () => {
  const manager = new JsonParseConcurrencyManager();

  const first = manager.tryAcquire(1);
  assert.ok(first);
  assert.equal(manager.getActiveRequestCount(), 1);

  const blocked = manager.tryAcquire(1);
  assert.equal(blocked, null);
  assert.equal(manager.getActiveRequestCount(), 1);

  first();
  assert.equal(manager.getActiveRequestCount(), 0);

  first();
  assert.equal(manager.getActiveRequestCount(), 0);

  const allowedAgain = manager.tryAcquire(1);
  assert.ok(allowedAgain);
  allowedAgain();
});

void test("streaming request concurrency manager tracks counts per source and cleans up released buckets", () => {
  const manager = new StreamingRequestConcurrencyManager();

  const first = manager.tryAcquire("127.0.0.1", 2);
  const second = manager.tryAcquire("127.0.0.1", 2);
  assert.ok(first);
  assert.ok(second);
  assert.equal(manager.getActiveRequestCountForSourceIp("127.0.0.1"), 2);
  assert.equal(manager.getTrackedSourceIpCount(), 1);

  const blocked = manager.tryAcquire("127.0.0.1", 2);
  assert.equal(blocked, null);

  const otherSource = manager.tryAcquire("127.0.0.2", 2);
  assert.ok(otherSource);
  assert.equal(manager.getTrackedSourceIpCount(), 2);

  second();
  assert.equal(manager.getActiveRequestCountForSourceIp("127.0.0.1"), 1);

  first();
  assert.equal(manager.getActiveRequestCountForSourceIp("127.0.0.1"), 0);
  assert.equal(manager.getTrackedSourceIpCount(), 1);

  first();
  assert.equal(manager.getTrackedSourceIpCount(), 1);

  otherSource();
  assert.equal(manager.getTrackedSourceIpCount(), 0);
});
