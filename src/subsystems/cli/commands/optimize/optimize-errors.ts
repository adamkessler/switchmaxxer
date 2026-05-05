import type { OptimizeFailure } from "../../../observability/optimize-report-builder";
import type { OptimizeCliDeps } from "./optimize-types";

export function writeOptimizeCommandError(options: {
  deps: Pick<OptimizeCliDeps, "writeJsonErrorEnvelope" | "writeStderr">;
  json: boolean;
  command: string;
  prefix: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): number {
  if (options.json) {
    options.deps.writeJsonErrorEnvelope(options.command, options.code, options.message, {
      ...(typeof options.details === "undefined" ? {} : { details: options.details })
    });
    return 1;
  }

  options.deps.writeStderr(`${options.prefix}: ${options.message}`);
  return 1;
}

export function writeOptimizeFailure(
  deps: Pick<OptimizeCliDeps, "writeJsonErrorEnvelope" | "writeStderr">,
  json: boolean,
  failure: OptimizeFailure
): number {
  return writeOptimizeCommandError({
    deps,
    json,
    command: "optimize",
    prefix: "Optimize failed",
    code: failure.code,
    message: failure.message,
    details: failure.details
  });
}
