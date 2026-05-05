import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCH_EXECUTION_ISSUES,
  validateBenchExecutionInput
} from "./bench-execution-validation";

const DEFAULT_LIMITS = {
  maxPromptLength: 8,
  maxIterations: 5,
  maxConcurrency: 3
} as const;

void test("validateBenchExecutionInput accepts values within shared caps", () => {
  assert.equal(
    validateBenchExecutionInput({
      prompt: "hello",
      iterations: 5,
      concurrency: 3,
      ...DEFAULT_LIMITS
    }),
    null
  );
});

void test("validateBenchExecutionInput rejects prompts above the shared cap", () => {
  assert.equal(
    validateBenchExecutionInput({
      prompt: "x".repeat(9),
      ...DEFAULT_LIMITS
    }),
    BENCH_EXECUTION_ISSUES.promptTooLong
  );
});

void test("validateBenchExecutionInput rejects iterations above the shared cap", () => {
  assert.equal(
    validateBenchExecutionInput({
      prompt: "hello",
      iterations: 6,
      ...DEFAULT_LIMITS
    }),
    BENCH_EXECUTION_ISSUES.iterationsTooHigh
  );
});

void test("validateBenchExecutionInput rejects concurrency above the shared cap", () => {
  assert.equal(
    validateBenchExecutionInput({
      prompt: "hello",
      concurrency: 4,
      ...DEFAULT_LIMITS
    }),
    BENCH_EXECUTION_ISSUES.concurrencyTooHigh
  );
});
