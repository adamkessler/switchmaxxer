export const BENCH_MAX_ITERATIONS = 500;
export const BENCH_MAX_CONCURRENCY = 16;
export const BENCH_MAX_PROMPT_LENGTH = 65536;
export const BENCH_MAX_ROUTES = 32;
export const BENCH_MAX_TOTAL_TASKS = 50000;

type BenchmarkPlanningSurface = "bench" | "bench_run" | "optimize" | "optimize_run";

export function assertBenchmarkPromptLength(prompt: string, surface: BenchmarkPlanningSurface): void {
  if (prompt.length > BENCH_MAX_PROMPT_LENGTH) {
    if (surface === "bench") {
      throw new Error(`Benchmark prompt must be at most ${BENCH_MAX_PROMPT_LENGTH} characters for 'bench'`);
    }

    throw new Error(`field 'prompt' must be at most ${BENCH_MAX_PROMPT_LENGTH} characters for '${surface}'`);
  }
}

export function calculateBenchmarkTaskCount(options: {
  routeCount: number;
  pathMode: "gateway" | "direct" | "both";
  warmup: number;
  iterations: number;
}): number {
  const pathCount = options.pathMode === "both" ? 2 : 1;
  return options.routeCount * pathCount * (options.warmup + options.iterations);
}

export function assertBenchmarkTaskPlanSize(
  options: {
    routeCount: number;
    pathMode: "gateway" | "direct" | "both";
    warmup: number;
    iterations: number;
  },
  surface: BenchmarkPlanningSurface
): void {
  const totalTasks = calculateBenchmarkTaskCount(options);
  if (totalTasks <= BENCH_MAX_TOTAL_TASKS) {
    return;
  }

  throw new Error(
    `Benchmark plan must contain at most ${BENCH_MAX_TOTAL_TASKS} tasks for '${surface}'; requested ${totalTasks}`
  );
}
