import { assertSafeObjectKey } from "../../platform/object-key-policy";
import {
  BENCH_MAX_CONCURRENCY,
  BENCH_MAX_ITERATIONS,
  BENCH_MAX_PROMPT_LENGTH,
  BENCH_MAX_ROUTES,
  assertBenchmarkPromptLength
} from "../observability/bench-limits";
import {
  DEFAULT_OPTIMIZE_REFERENCE_TOKENS,
  type OptimizeReferenceTokens
} from "../observability/optimize-report-builder";
import { isBenchPathModeValue, type BenchPathModeValue } from "../observability/bench-path-mode";
import { invalidInputFieldError } from "./errors";
import {
  getOptionalBooleanField,
  getOptionalNonNegativeInteger,
  getOptionalPositiveInteger,
  getOptionalString,
  parseToolArgs
} from "./parsers-shared";

export type OptimizeListArgs = {
  limit: number | undefined;
};

export type OptimizeShowArgs = {
  runId: string;
};

export type OptimizeApplyArgs = {
  runId: string;
  routeId: string;
  dryRun: boolean;
  reload: boolean;
  verify: boolean;
};

export type OptimizeRestoreArgs = {
  dryRun: boolean;
  reload: boolean;
  verify: boolean;
} & (
  | {
      mode: "action";
      actionId: string;
    }
  | {
      mode: "run_route";
      runId: string;
      routeId: string;
    }
);

export type OptimizeRunArgs = {
  modelId: string;
  objective: "cost" | "latency";
  requestedRoutes: string[] | null;
} & (
  | {
      objective: "cost";
      referenceTokens: OptimizeReferenceTokens;
    }
  | {
      objective: "latency";
      prompt: string;
      iterations: number | undefined;
      warmup: number | undefined;
      concurrency: number | undefined;
      pathModeValue: BenchPathModeValue | undefined;
      timeoutMs: number | undefined;
    }
);

function getRequiredOptimizeString(
  params: Record<string, unknown>,
  field: string,
  toolName: string
): string {
  const value = getOptionalString(params, field);
  if (!value) {
    throw invalidInputFieldError(`Tool '${toolName}' requires non-empty '${field}'.`);
  }

  try {
    assertSafeObjectKey(value, `field '${field}'`);
  } catch (error) {
    throw invalidInputFieldError((error as Error).message);
  }

  return value;
}

function getOptionalRoutes(params: Record<string, unknown>): string[] | null {
  const value = params["routes"];
  if (typeof value === "undefined") {
    return null;
  }

  if (!Array.isArray(value)) {
    throw invalidInputFieldError("field 'routes' must be an array of route names");
  }

  const uniqueRoutes: string[] = [];
  const seenRoutes = new Set<string>();
  for (const route of value) {
    if (typeof route !== "string" || route.trim().length === 0) {
      throw invalidInputFieldError("field 'routes' must contain only non-empty route names");
    }

    try {
      assertSafeObjectKey(route, "field 'routes'");
    } catch (error) {
      throw invalidInputFieldError((error as Error).message);
    }

    if (!seenRoutes.has(route)) {
      uniqueRoutes.push(route);
      seenRoutes.add(route);
    }
  }

  if (uniqueRoutes.length === 0) {
    throw invalidInputFieldError("field 'routes' must be a non-empty array of route names");
  }

  if (uniqueRoutes.length > BENCH_MAX_ROUTES) {
    throw invalidInputFieldError(`field 'routes' must contain at most ${BENCH_MAX_ROUTES} route names for 'optimize_run'`);
  }

  return uniqueRoutes;
}

export function parseOptimizeListArgs(params: unknown): OptimizeListArgs {
  return parseToolArgs(params, {
    toolName: "optimize_list",
    allowedFields: ["limit"],
    validate: (objectParams) => ({ limit: getOptionalPositiveInteger(objectParams, "limit") })
  });
}

export function parseOptimizeShowArgs(params: unknown): OptimizeShowArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "optimize_show",
    allowedFields: ["run_id"],
    validate: (validatedParams) => validatedParams
  });
  const runId = getRequiredOptimizeString(objectParams, "run_id", "optimize_show");
  return { runId };
}

export function parseOptimizeApplyArgs(params: unknown): OptimizeApplyArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "optimize_apply",
    allowedFields: ["run_id", "route_id", "dry_run", "reload", "verify"],
    validate: (validatedParams) => validatedParams
  });
  return {
    runId: getRequiredOptimizeString(objectParams, "run_id", "optimize_apply"),
    routeId: getRequiredOptimizeString(objectParams, "route_id", "optimize_apply"),
    dryRun: getOptionalBooleanField(objectParams, "dry_run") ?? false,
    reload: getOptionalBooleanField(objectParams, "reload") ?? false,
    verify: getOptionalBooleanField(objectParams, "verify") ?? false
  };
}

export function parseOptimizeRestoreArgs(params: unknown): OptimizeRestoreArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "optimize_restore",
    allowedFields: ["action_id", "run_id", "route_id", "dry_run", "reload", "verify"],
    validate: (validatedParams) => validatedParams
  });
  const actionId = getOptionalString(objectParams, "action_id");
  const runId = getOptionalString(objectParams, "run_id");
  const routeId = getOptionalString(objectParams, "route_id");
  const hasAction = typeof actionId === "string" && actionId.trim().length > 0;
  const hasRun = typeof runId === "string" && runId.trim().length > 0;
  const hasRoute = typeof routeId === "string" && routeId.trim().length > 0;
  const hasRunRoute = hasRun && hasRoute;

  if ((hasAction && (hasRun || hasRoute)) || (!hasAction && !hasRunRoute)) {
    throw invalidInputFieldError("Tool 'optimize_restore' requires either 'action_id' or both 'run_id' and 'route_id'.");
  }

  const dryRun = getOptionalBooleanField(objectParams, "dry_run") ?? false;
  const reload = getOptionalBooleanField(objectParams, "reload") ?? false;
  const verify = getOptionalBooleanField(objectParams, "verify") ?? false;
  if (hasAction) {
    return {
      mode: "action",
      actionId: getRequiredOptimizeString(objectParams, "action_id", "optimize_restore"),
      dryRun,
      reload,
      verify
    };
  }

  return {
    mode: "run_route",
    runId: getRequiredOptimizeString(objectParams, "run_id", "optimize_restore"),
    routeId: getRequiredOptimizeString(objectParams, "route_id", "optimize_restore"),
    dryRun,
    reload,
    verify
  };
}

export function parseOptimizeRunArgs(params: unknown): OptimizeRunArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "optimize_run",
    allowedFields: [
      "model",
      "objective",
      "routes",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "prompt",
      "iterations",
      "warmup",
      "concurrency",
      "path_mode",
      "timeout_ms"
    ],
    validate: (validatedParams) => validatedParams
  });

  const modelId = getRequiredOptimizeString(objectParams, "model", "optimize_run");
  const objective = getRequiredOptimizeString(objectParams, "objective", "optimize_run");
  if (objective !== "cost" && objective !== "latency") {
    throw invalidInputFieldError("field 'objective' must be one of: cost, latency");
  }

  const requestedRoutes = getOptionalRoutes(objectParams);
  if (objective === "latency") {
    const prompt = getOptionalString(objectParams, "prompt");
    if (!prompt) {
      throw invalidInputFieldError("Tool 'optimize_run' requires non-empty 'prompt' when objective is 'latency'.");
    }
    try {
      assertBenchmarkPromptLength(prompt, "optimize_run");
    } catch (error) {
      throw invalidInputFieldError(
        error instanceof Error
          ? error.message
          : `field 'prompt' must be at most ${BENCH_MAX_PROMPT_LENGTH} characters for 'optimize_run'`
      );
    }

    const iterations = getOptionalPositiveInteger(objectParams, "iterations");
    if (typeof iterations === "number" && iterations > BENCH_MAX_ITERATIONS) {
      throw invalidInputFieldError(`field 'iterations' must be at most ${BENCH_MAX_ITERATIONS} for 'optimize_run'`);
    }

    const warmup = getOptionalNonNegativeInteger(objectParams, "warmup");
    const concurrency = getOptionalPositiveInteger(objectParams, "concurrency");
    if (typeof concurrency === "number" && concurrency > BENCH_MAX_CONCURRENCY) {
      throw invalidInputFieldError(`field 'concurrency' must be at most ${BENCH_MAX_CONCURRENCY} for 'optimize_run'`);
    }

    const pathModeValue = getOptionalString(objectParams, "path_mode");
    if (typeof pathModeValue !== "undefined" && !isBenchPathModeValue(pathModeValue)) {
      throw invalidInputFieldError("field 'path_mode' must be one of: gateway, direct, both");
    }

    return {
      modelId,
      objective,
      requestedRoutes,
      prompt,
      iterations,
      warmup,
      concurrency,
      pathModeValue,
      timeoutMs: getOptionalPositiveInteger(objectParams, "timeout_ms")
    };
  }

  return {
    modelId,
    objective,
    requestedRoutes,
    referenceTokens: {
      input_tokens: getOptionalNonNegativeInteger(objectParams, "input_tokens") ?? DEFAULT_OPTIMIZE_REFERENCE_TOKENS.input_tokens,
      output_tokens: getOptionalNonNegativeInteger(objectParams, "output_tokens") ?? DEFAULT_OPTIMIZE_REFERENCE_TOKENS.output_tokens,
      cache_read_tokens: getOptionalNonNegativeInteger(objectParams, "cache_read_tokens") ?? DEFAULT_OPTIMIZE_REFERENCE_TOKENS.cache_read_tokens,
      cache_write_tokens: getOptionalNonNegativeInteger(objectParams, "cache_write_tokens") ?? DEFAULT_OPTIMIZE_REFERENCE_TOKENS.cache_write_tokens
    }
  };
}
