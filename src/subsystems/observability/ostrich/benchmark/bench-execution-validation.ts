export const BENCH_EXECUTION_ISSUES = {
  promptTooLong: "prompt_too_long",
  iterationsTooHigh: "iterations_too_high",
  concurrencyTooHigh: "concurrency_too_high"
} as const;

export type BenchExecutionIssue =
  (typeof BENCH_EXECUTION_ISSUES)[keyof typeof BENCH_EXECUTION_ISSUES];

export type BenchExecutionValidationInput = {
  prompt: string;
  iterations?: number;
  concurrency?: number;
  maxPromptLength: number;
  maxIterations: number;
  maxConcurrency: number;
};

export function validateBenchExecutionInput(
  input: BenchExecutionValidationInput
): BenchExecutionIssue | null {
  if (input.prompt.length > input.maxPromptLength) {
    return BENCH_EXECUTION_ISSUES.promptTooLong;
  }

  if (typeof input.iterations === "number" && input.iterations > input.maxIterations) {
    return BENCH_EXECUTION_ISSUES.iterationsTooHigh;
  }

  if (typeof input.concurrency === "number" && input.concurrency > input.maxConcurrency) {
    return BENCH_EXECUTION_ISSUES.concurrencyTooHigh;
  }

  return null;
}
