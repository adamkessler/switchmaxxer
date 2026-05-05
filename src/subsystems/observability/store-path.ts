import path from "node:path";

export function defaultObservabilityDbPath(cwd = process.cwd()): string {
  return path.join(cwd, ".switchmaxxer", "observability.sqlite");
}
