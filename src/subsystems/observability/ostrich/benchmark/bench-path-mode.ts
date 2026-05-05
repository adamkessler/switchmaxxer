const BENCH_PATH_MODES = ["gateway", "direct", "both"] as const;

export type BenchPathModeValue = (typeof BENCH_PATH_MODES)[number];

export function isBenchPathModeValue(value: string | undefined): value is BenchPathModeValue {
  return BENCH_PATH_MODES.some((mode) => mode === value);
}
