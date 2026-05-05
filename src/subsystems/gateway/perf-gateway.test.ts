import assert from "node:assert/strict";
import test from "node:test";

import { percentile, runScenario } from "./perf-gateway";

void test("perf gateway percentile interpolates across sorted samples", () => {
  const sorted = [10, 20, 30, 40];

  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile(sorted, 0), 10);
  assert.equal(percentile(sorted, 50), 25);
  assert.equal(percentile(sorted, 95), 38.5);
  assert.ok(Math.abs(percentile(sorted, 99) - 39.7) < 1e-9);
  assert.equal(percentile(sorted, 100), 40);
});

void test("perf gateway scenario uses injected fetch without mutating global fetch", async () => {
  const originalFetch = globalThis.fetch;
  const sentinelFetch = (async (): Promise<Response> => {
    throw new Error("global fetch should not be used by perf harness");
  }) as typeof fetch;

  globalThis.fetch = sentinelFetch;

  try {
    const result = await runScenario("fetch-injection-check", {
      iterations: 1,
      warmup: 0,
      observabilityEnabled: false,
      debugLogging: false
    });

    assert.equal(result.name, "fetch-injection-check");
    assert.equal(result.iterations, 1);
    assert.equal(globalThis.fetch, sentinelFetch);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("perf gateway rejects overlapping scenarios", async () => {
  const firstScenario = runScenario("overlap-first", {
    iterations: 1,
    warmup: 0,
    observabilityEnabled: false,
    debugLogging: false
  });

  await assert.rejects(
    runScenario("overlap-second", {
      iterations: 1,
      warmup: 0,
      observabilityEnabled: false,
      debugLogging: false
    }),
    /sequential-only/
  );

  await firstScenario;
});
