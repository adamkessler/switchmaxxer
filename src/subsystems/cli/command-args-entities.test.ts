import assert from "node:assert/strict";
import test from "node:test";

import { parseCostFlag } from "./command-arg-primitives";
import { parseModelsCreateArgs, parseModelsUpdateArgs } from "./command-args-models";
import {
  parseOptimizeApplyArgs,
  parseOptimizeListArgs,
  parseOptimizePruneArgs,
  parseOptimizeRunArgs,
  parseOptimizeShowArgs
} from "./command-args-optimize";
import { parseRoutesCreateArgs, parseRoutesUpdateArgs } from "./command-args-routes";
import { readLongFlagValue } from "./input-utils";

void test("parseOptimizeRunArgs accepts cost objective knobs through shared flag parsing", () => {
  const parsed = parseOptimizeRunArgs(
    [
      "--model=gpt-4o-mini",
      "--objective",
      "cost",
      "--routes",
      "direct,openrouter",
      "--input-tokens",
      "2000",
      "--output-tokens=500",
      "--cache-read-tokens",
      "25",
      "--cache-write-tokens=50",
      "--config=./config.json",
      "--output",
      "./optimize.json",
      "--json"
    ],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    modelId: "gpt-4o-mini",
    objective: "cost",
    routesCsv: "direct,openrouter",
    inputTokens: 2000,
    outputTokens: 500,
    cacheReadTokens: 25,
    cacheWriteTokens: 50,
    pathMode: "both",
    configPath: "./config.json",
    outputPath: "./optimize.json",
    json: true
  });
});

void test("parseOptimizeRunArgs accepts latency objective benchmark knobs", () => {
  const parsed = parseOptimizeRunArgs(
    [
      "--model",
      "gpt-4o-mini",
      "--objective=latency",
      "--routes",
      "direct,openrouter",
      "--prompt",
      "ping",
      "--iterations",
      "5",
      "--warmup=2",
      "--concurrency",
      "3",
      "--path",
      "gateway",
      "--timeout-ms=20000",
      "--json"
    ],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    modelId: "gpt-4o-mini",
    objective: "latency",
    routesCsv: "direct,openrouter",
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    prompt: "ping",
    iterations: 5,
    warmup: 2,
    concurrency: 3,
    pathMode: "gateway",
    timeoutMs: 20000,
    configPath: undefined,
    outputPath: undefined,
    json: true
  });
});

void test("parseOptimizeListArgs and parseOptimizeShowArgs accept history flags", () => {
  assert.deepEqual(parseOptimizeListArgs(["--limit=5", "--json"], readLongFlagValue), {
    limit: 5,
    json: true
  });
  assert.deepEqual(parseOptimizeShowArgs(["--json"], readLongFlagValue), {
    json: true
  });
  assert.deepEqual(parseOptimizeListArgs(["--limit", "0"], readLongFlagValue), {
    limit: 25,
    json: false,
    errorMessage: "Flag '--limit' requires a positive integer value"
  });
});

void test("parseOptimizePruneArgs accepts optimize-history cleanup flags", () => {
  assert.deepEqual(parseOptimizePruneArgs(["--older-than=30d", "--json"], readLongFlagValue), {
    olderThan: "30d",
    json: true
  });
  assert.deepEqual(parseOptimizePruneArgs(["--older-than", "30d"], readLongFlagValue), {
    olderThan: "30d",
    json: false
  });
});

void test("parseOptimizeApplyArgs accepts provider apply knobs", () => {
  assert.deepEqual(
    parseOptimizeApplyArgs(
      ["--route", "current-route", "--config", "./config.json", "--dry-run", "--verify", "--reload", "--json"],
      readLongFlagValue
    ),
    {
      routeId: "current-route",
      configPath: "./config.json",
      dryRun: true,
      verify: true,
      reload: true,
      json: true
    }
  );
});

void test("parseModelsCreateArgs accepts shared long flags through the table-driven helper", () => {
  const parsed = parseModelsCreateArgs(
    [
      "demo-model",
      "--config=./config.json",
      "--json-input",
      "./model.json",
      "--display-name=Demo Model",
      "--model-creator",
      "openai"
    ],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: false,
    stdin: false,
    jsonInputPath: "./model.json",
    name: "demo-model",
    displayName: "Demo Model",
    modelCreator: "openai",
    clearCost: false
  });
});

void test("parseModelsCreateArgs preserves missing-value errors from shared long-flag parsing", () => {
  const parsed = parseModelsCreateArgs(["demo-model", "--display-name"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: "demo-model",
    displayName: undefined,
    modelCreator: undefined,
    clearCost: false,
    errorMessage: "Flag '--display-name' requires a value"
  });
});

void test("parseModelsUpdateArgs shares model create parser behavior", () => {
  const parsed = parseModelsUpdateArgs(["demo-model", "--model-creator=anthropic"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: "demo-model",
    displayName: undefined,
    modelCreator: "anthropic",
    clearCost: false
  });
});

void test("parseRoutesCreateArgs accepts shared long flags and timeout parsing together", () => {
  const parsed = parseRoutesCreateArgs(
    [
      "demo-route",
      "--config=./config.json",
      "--json-input",
      "./route.json",
      "--model",
      "demo-model",
      "--service-provider=provider-a",
      "--provider-model-id",
      "upstream-model",
      "--display-name=Demo Route",
      "--timeout-ms",
      "15000"
    ],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: false,
    stdin: false,
    jsonInputPath: "./route.json",
    name: "demo-route",
    model: "demo-model",
    serviceProvider: "provider-a",
    providerModelId: "upstream-model",
    displayName: "Demo Route",
    timeoutMs: 15000,
    clearTimeoutMs: false,
    clearCost: false
  });
});

void test("parseRoutesCreateArgs preserves timeout integer validation", () => {
  const parsed = parseRoutesCreateArgs(["demo-route", "--timeout-ms", "bogus"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: "demo-route",
    model: undefined,
    serviceProvider: undefined,
    providerModelId: undefined,
    displayName: undefined,
    timeoutMs: undefined,
    clearTimeoutMs: false,
    clearCost: false,
    errorMessage: "Flag '--timeout-ms' requires a positive integer value"
  });
});

void test("parseRoutesCreateArgs rejects partial timeout integer tokens", () => {
  for (const value of ["123abc", "1.5", "+1", " 123", "123 ", "9007199254740992"]) {
    const parsed = parseRoutesCreateArgs(["demo-route", "--timeout-ms", value], readLongFlagValue);

    assert.equal(parsed.errorMessage, "Flag '--timeout-ms' requires a positive integer value", value);
    assert.equal(parsed.timeoutMs, undefined, value);
  }
});

void test("parseRoutesUpdateArgs shares route create parser behavior", () => {
  const parsed = parseRoutesUpdateArgs(["demo-route", "--clear-timeout-ms"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: "demo-route",
    model: undefined,
    serviceProvider: undefined,
    providerModelId: undefined,
    displayName: undefined,
    timeoutMs: undefined,
    clearTimeoutMs: true,
    clearCost: false
  });
});

void test("parseCostFlag accepts each numeric cost flag through the shared descriptor table", () => {
  const state = { clearCost: false } as {
    costInput?: number;
    costOutput?: number;
    costCacheRead?: number;
    costCacheWrite?: number;
    clearCost?: boolean;
  };

  assert.deepEqual(parseCostFlag(["--cost-input", "1.5"], 0, state, readLongFlagValue), { consumed: 1 });
  assert.deepEqual(parseCostFlag(["--cost-output", "2.5"], 0, state, readLongFlagValue), { consumed: 1 });
  assert.deepEqual(parseCostFlag(["--cost-cache-read", "3.5"], 0, state, readLongFlagValue), { consumed: 1 });
  assert.deepEqual(parseCostFlag(["--cost-cache-write", "4.5"], 0, state, readLongFlagValue), { consumed: 1 });
  assert.deepEqual(state, {
    clearCost: false,
    costInput: 1.5,
    costOutput: 2.5,
    costCacheRead: 3.5,
    costCacheWrite: 4.5
  });
});

void test("parseCostFlag preserves numeric validation errors", () => {
  const state = { clearCost: false };

  assert.deepEqual(
    parseCostFlag(["--cost-input", "-1"], 0, state, readLongFlagValue),
    {
      consumed: 0,
      errorMessage: "Flag '--cost-input' requires a non-negative numeric value"
    }
  );
});
