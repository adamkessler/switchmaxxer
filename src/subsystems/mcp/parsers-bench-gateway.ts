import {
  assertBenchmarkPromptLength,
  assertBenchmarkTaskPlanSize,
  BENCH_MAX_CONCURRENCY,
  BENCH_MAX_ITERATIONS,
  BENCH_MAX_PROMPT_LENGTH,
  BENCH_MAX_ROUTES
} from "../observability/bench-limits";
import { isBenchPathModeValue, type BenchPathModeValue } from "../observability/bench-path-mode";
import { BENCH_EXECUTION_ISSUES, validateBenchExecutionInput } from "../observability/bench-execution-validation";
import { BENCH_ROUTE_SELECTION_ISSUES, normalizeBenchRouteSelection } from "../observability/bench-route-selection";
import { invalidInputFieldError } from "./errors";
import {
  getOptionalPositiveInteger,
  getOptionalString,
  parseToolArgs
} from "./parsers-shared";

type HealthCheckName = "gateway" | "config" | "providers" | "routes";

export type GatewayHealthArgs = {
  check: HealthCheckName | "all" | undefined;
  timeoutMs: number | undefined;
};

export type BenchListArgs = {
  limit: number | undefined;
};

export type BenchShowArgs = {
  runId: string;
};

export type BenchRunArgs = {
  prompt: string;
  routeNames: string[];
  iterations: number | undefined;
  warmup: number | undefined;
  concurrency: number | undefined;
  pathModeValue: BenchPathModeValue | undefined;
  timeoutMs: number | undefined;
};

export function parseGatewayHealthArgs(params: unknown): GatewayHealthArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "gateway_health",
    allowedFields: ["check", "timeout_ms"],
    validate: (validatedParams) => validatedParams
  });
  const check = getOptionalString(objectParams, "check");
  if (
    typeof check !== "undefined" &&
    check !== "all" &&
    check !== "gateway" &&
    check !== "config" &&
    check !== "providers" &&
    check !== "routes"
  ) {
    throw invalidInputFieldError("field 'check' must be one of: gateway, config, providers, routes, all");
  }
  return {
    check: check as GatewayHealthArgs["check"],
    timeoutMs: getOptionalPositiveInteger(objectParams, "timeout_ms")
  };
}

export function parseBenchListArgs(params: unknown): BenchListArgs {
  return parseToolArgs(params, {
    toolName: "bench_list",
    allowedFields: ["limit"],
    validate: (objectParams) => ({ limit: getOptionalPositiveInteger(objectParams, "limit") })
  });
}

export function parseBenchShowArgs(params: unknown): BenchShowArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "bench_show",
    allowedFields: ["run_id"],
    validate: (validatedParams) => validatedParams
  });
  const runId = getOptionalString(objectParams, "run_id");
  if (!runId) {
    throw invalidInputFieldError("Tool 'bench_show' requires non-empty 'run_id'.");
  }
  return { runId };
}

export function parseBenchRunArgs(params: unknown): BenchRunArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "bench_run",
    allowedFields: ["prompt", "route_id", "routes", "iterations", "warmup", "concurrency", "path_mode", "timeout_ms"],
    validate: (validatedParams) => validatedParams
  });

  const prompt = getOptionalString(objectParams, "prompt");
  if (!prompt) {
    throw invalidInputFieldError("Tool 'bench_run' requires non-empty 'prompt'.");
  }

  const routeId = getOptionalString(objectParams, "route_id");
  const normalizedSelection = normalizeBenchRouteSelection({
    routeName: routeId,
    routeNames: Array.isArray(objectParams["routes"]) ? (objectParams["routes"] as string[]) : objectParams["routes"] === undefined ? undefined : [],
    maxRoutes: BENCH_MAX_ROUTES
  });

  if (!normalizedSelection.ok) {
    switch (normalizedSelection.issue) {
      case BENCH_ROUTE_SELECTION_ISSUES.conflictingSelectors:
      case BENCH_ROUTE_SELECTION_ISSUES.missingSelector:
        throw invalidInputFieldError("Tool arguments must provide exactly one of 'route_id' or 'routes'.");
      case BENCH_ROUTE_SELECTION_ISSUES.invalidRouteList:
        throw invalidInputFieldError("field 'routes' must be a non-empty array of route names");
      case BENCH_ROUTE_SELECTION_ISSUES.tooManyRoutes:
        throw invalidInputFieldError(`field 'routes' must contain at most ${BENCH_MAX_ROUTES} route names for 'bench_run'`);
    }
  }

  const routeNames = normalizedSelection.routeNames;

  const iterations = getOptionalPositiveInteger(objectParams, "iterations");
  const warmup = getOptionalNonNegativeWarmup(objectParams);
  const concurrency = getOptionalPositiveInteger(objectParams, "concurrency");
  const pathModeValue = getOptionalString(objectParams, "path_mode");
  const timeoutMs = getOptionalPositiveInteger(objectParams, "timeout_ms");
  const requestedPathMode = (pathModeValue ?? "both") as BenchPathModeValue;

  const executionIssue = validateBenchExecutionInput({
    prompt,
    iterations,
    concurrency,
    maxPromptLength: BENCH_MAX_PROMPT_LENGTH,
    maxIterations: BENCH_MAX_ITERATIONS,
    maxConcurrency: BENCH_MAX_CONCURRENCY
  });
  if (executionIssue !== null) {
    switch (executionIssue) {
      case BENCH_EXECUTION_ISSUES.promptTooLong:
        try {
          assertBenchmarkPromptLength(prompt, "bench_run");
        } catch (error) {
          throw invalidInputFieldError(
            error instanceof Error ? error.message : `field 'prompt' must be at most ${BENCH_MAX_PROMPT_LENGTH} characters for 'bench_run'`
          );
        }
        break;
      case BENCH_EXECUTION_ISSUES.iterationsTooHigh:
        throw invalidInputFieldError(`field 'iterations' must be at most ${BENCH_MAX_ITERATIONS} for 'bench_run'`);
      case BENCH_EXECUTION_ISSUES.concurrencyTooHigh:
        throw invalidInputFieldError(`field 'concurrency' must be at most ${BENCH_MAX_CONCURRENCY} for 'bench_run'`);
    }
  }
  if (typeof pathModeValue !== "undefined" && !isBenchPathModeValue(pathModeValue)) {
    throw invalidInputFieldError("field 'path_mode' must be one of: gateway, direct, both");
  }
  try {
    assertBenchmarkTaskPlanSize(
      {
        routeCount: routeNames.length,
        pathMode: requestedPathMode,
        warmup: warmup ?? 1,
        iterations: iterations ?? 3
      },
      "bench_run"
    );
  } catch (error) {
    throw invalidInputFieldError(
      error instanceof Error ? error.message : "Benchmark plan exceeds the supported task limit"
    );
  }

  return {
    prompt,
    routeNames,
    iterations,
    warmup,
    concurrency,
    pathModeValue,
    timeoutMs
  };
}

function getOptionalNonNegativeWarmup(params: Record<string, unknown> | undefined): number | undefined {
  const value = params?.["warmup"];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw invalidInputFieldError("field 'warmup' must be a non-negative integer");
  }
  return value;
}
