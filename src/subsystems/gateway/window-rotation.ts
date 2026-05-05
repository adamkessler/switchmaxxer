export type WindowState = {
  windowStartedAtMs: number;
};

export function advanceWindow<T extends WindowState>(
  state: T,
  nowMs: number,
  windowMs: number,
  reset: (nextWindowStartedAtMs: number) => T
): T {
  if (state.windowStartedAtMs === 0 || nowMs - state.windowStartedAtMs >= windowMs) {
    return reset(nowMs);
  }

  return state;
}
