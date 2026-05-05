import {
  parseFlagArgv,
  parseNonNegativeIntegerFlagValue,
  parsePositiveIntegerFlagValue,
  type BooleanFlagSpec,
  type LongFlagSpec,
  type ReadLongFlagValue
} from "./command-arg-primitives";
import { isBenchPathModeValue, type BenchPathModeValue } from "../observability/bench-path-mode";

export type OptimizeRunArgs = {
  modelId?: string;
  objective?: string;
  routesCsv?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  prompt?: string;
  filePath?: string;
  iterations?: number;
  warmup?: number;
  concurrency?: number;
  pathMode: BenchPathModeValue;
  timeoutMs?: number;
  configPath?: string;
  outputPath?: string;
  json: boolean;
  errorMessage?: string;
};

export type OptimizeListArgs = {
  limit: number;
  json: boolean;
  errorMessage?: string;
};

export type OptimizeShowArgs = {
  json: boolean;
  errorMessage?: string;
};

export type OptimizePruneArgs = {
  olderThan?: string;
  json: boolean;
  errorMessage?: string;
};

export type OptimizeApplyArgs = {
  routeId?: string;
  configPath?: string;
  dryRun: boolean;
  verify: boolean;
  reload: boolean;
  json: boolean;
  errorMessage?: string;
};

type OptimizeRunState = {
  modelId?: string;
  objective?: string;
  routesCsv?: string;
  inputTokensRaw?: string;
  outputTokensRaw?: string;
  cacheReadTokensRaw?: string;
  cacheWriteTokensRaw?: string;
  prompt?: string;
  filePath?: string;
  iterationsRaw?: string;
  warmupRaw?: string;
  concurrencyRaw?: string;
  pathModeRaw?: string;
  timeoutMsRaw?: string;
  configPath?: string;
  outputPath?: string;
  json: boolean;
};

type OptimizeListState = {
  limitRaw?: string;
  json: boolean;
};

type OptimizeShowState = {
  json: boolean;
};

type OptimizePruneState = {
  olderThan?: string;
  json: boolean;
};

type OptimizeApplyState = {
  routeId?: string;
  configPath?: string;
  dryRun: boolean;
  verify: boolean;
  reload: boolean;
  json: boolean;
};

const optimizeRunLongFlagSpecs: readonly LongFlagSpec<OptimizeRunState>[] = [
  {
    flagName: "--model",
    reader: "value",
    apply: (state, value) => {
      state.modelId = value;
    }
  },
  {
    flagName: "--objective",
    reader: "value",
    apply: (state, value) => {
      state.objective = value;
    }
  },
  {
    flagName: "--routes",
    reader: "value",
    apply: (state, value) => {
      state.routesCsv = value;
    }
  },
  {
    flagName: "--input-tokens",
    reader: "value",
    apply: (state, value) => {
      state.inputTokensRaw = value;
    }
  },
  {
    flagName: "--output-tokens",
    reader: "value",
    apply: (state, value) => {
      state.outputTokensRaw = value;
    }
  },
  {
    flagName: "--cache-read-tokens",
    reader: "value",
    apply: (state, value) => {
      state.cacheReadTokensRaw = value;
    }
  },
  {
    flagName: "--cache-write-tokens",
    reader: "value",
    apply: (state, value) => {
      state.cacheWriteTokensRaw = value;
    }
  },
  {
    flagName: "--prompt",
    reader: "value",
    apply: (state, value) => {
      state.prompt = value;
    }
  },
  {
    flagName: "--file",
    reader: "path",
    apply: (state, value) => {
      state.filePath = value;
    }
  },
  {
    flagName: "--iterations",
    reader: "value",
    apply: (state, value) => {
      state.iterationsRaw = value;
    }
  },
  {
    flagName: "--warmup",
    reader: "value",
    apply: (state, value) => {
      state.warmupRaw = value;
    }
  },
  {
    flagName: "--concurrency",
    reader: "value",
    apply: (state, value) => {
      state.concurrencyRaw = value;
    }
  },
  {
    flagName: "--path",
    reader: "value",
    apply: (state, value) => {
      state.pathModeRaw = value;
    }
  },
  {
    flagName: "--timeout-ms",
    reader: "value",
    apply: (state, value) => {
      state.timeoutMsRaw = value;
    }
  },
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  },
  {
    flagName: "--output",
    reader: "path",
    apply: (state, value) => {
      state.outputPath = value;
    }
  }
];

const optimizeRunBooleanFlagSpecs: readonly BooleanFlagSpec<OptimizeRunState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const optimizeListLongFlagSpecs: readonly LongFlagSpec<OptimizeListState>[] = [
  {
    flagName: "--limit",
    reader: "value",
    apply: (state, value) => {
      state.limitRaw = value;
    }
  }
];

const optimizeListBooleanFlagSpecs: readonly BooleanFlagSpec<OptimizeListState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const optimizeShowBooleanFlagSpecs: readonly BooleanFlagSpec<OptimizeShowState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const optimizeApplyLongFlagSpecs: readonly LongFlagSpec<OptimizeApplyState>[] = [
  {
    flagName: "--route",
    reader: "value",
    apply: (state, value) => {
      state.routeId = value;
    }
  },
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  }
];

const optimizePruneLongFlagSpecs: readonly LongFlagSpec<OptimizePruneState>[] = [
  {
    flagName: "--older-than",
    reader: "value",
    apply: (state, value) => {
      state.olderThan = value;
    }
  }
];

const optimizeApplyBooleanFlagSpecs: readonly BooleanFlagSpec<OptimizeApplyState>[] = [
  {
    flagName: "--dry-run",
    apply: (state) => {
      state.dryRun = true;
    }
  },
  {
    flagName: "--verify",
    apply: (state) => {
      state.verify = true;
    }
  },
  {
    flagName: "--reload",
    apply: (state) => {
      state.reload = true;
    }
  },
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const optimizePruneBooleanFlagSpecs: readonly BooleanFlagSpec<OptimizePruneState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

function parseOptionalNonNegativeInteger(
  rawValue: string | undefined,
  flagName: string,
  defaultValue: number
): { value?: number; errorMessage?: string } {
  if (typeof rawValue === "undefined") {
    return { value: defaultValue };
  }

  return parseNonNegativeIntegerFlagValue(rawValue, flagName);
}

function buildOptimizeRunResult(
  state: OptimizeRunState,
  parsedTokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    iterations?: number;
    warmup?: number;
    concurrency?: number;
    pathMode: BenchPathModeValue;
    timeoutMs?: number;
  },
  errorMessage?: string
): OptimizeRunArgs {
  return {
    modelId: state.modelId,
    objective: state.objective,
    routesCsv: state.routesCsv,
    inputTokens: parsedTokens.inputTokens,
    outputTokens: parsedTokens.outputTokens,
    cacheReadTokens: parsedTokens.cacheReadTokens,
    cacheWriteTokens: parsedTokens.cacheWriteTokens,
    pathMode: parsedTokens.pathMode,
    configPath: state.configPath,
    outputPath: state.outputPath,
    json: state.json,
    ...(typeof state.prompt === "undefined" ? {} : { prompt: state.prompt }),
    ...(typeof state.filePath === "undefined" ? {} : { filePath: state.filePath }),
    ...(typeof parsedTokens.iterations === "undefined" ? {} : { iterations: parsedTokens.iterations }),
    ...(typeof parsedTokens.warmup === "undefined" ? {} : { warmup: parsedTokens.warmup }),
    ...(typeof parsedTokens.concurrency === "undefined" ? {} : { concurrency: parsedTokens.concurrency }),
    ...(typeof parsedTokens.timeoutMs === "undefined" ? {} : { timeoutMs: parsedTokens.timeoutMs }),
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

export function parseOptimizeRunArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): OptimizeRunArgs {
  const state: OptimizeRunState = {
    json: false
  };
  const defaultTokens = {
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    pathMode: "both" as const
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: optimizeRunBooleanFlagSpecs,
    longFlags: optimizeRunLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return buildOptimizeRunResult(state, defaultTokens, parsedArgs.errorMessage);
  }

  const parsedInputTokens = parseOptionalNonNegativeInteger(
    state.inputTokensRaw,
    "--input-tokens",
    defaultTokens.inputTokens
  );
  if (parsedInputTokens.errorMessage || typeof parsedInputTokens.value !== "number") {
    return buildOptimizeRunResult(state, defaultTokens, parsedInputTokens.errorMessage);
  }

  const parsedOutputTokens = parseOptionalNonNegativeInteger(
    state.outputTokensRaw,
    "--output-tokens",
    defaultTokens.outputTokens
  );
  if (parsedOutputTokens.errorMessage || typeof parsedOutputTokens.value !== "number") {
    return buildOptimizeRunResult(state, defaultTokens, parsedOutputTokens.errorMessage);
  }

  const parsedCacheReadTokens = parseOptionalNonNegativeInteger(
    state.cacheReadTokensRaw,
    "--cache-read-tokens",
    defaultTokens.cacheReadTokens
  );
  if (parsedCacheReadTokens.errorMessage || typeof parsedCacheReadTokens.value !== "number") {
    return buildOptimizeRunResult(state, defaultTokens, parsedCacheReadTokens.errorMessage);
  }

  const parsedCacheWriteTokens = parseOptionalNonNegativeInteger(
    state.cacheWriteTokensRaw,
    "--cache-write-tokens",
    defaultTokens.cacheWriteTokens
  );
  if (parsedCacheWriteTokens.errorMessage || typeof parsedCacheWriteTokens.value !== "number") {
    return buildOptimizeRunResult(state, defaultTokens, parsedCacheWriteTokens.errorMessage);
  }

  const parsedIterations =
    typeof state.iterationsRaw === "undefined"
      ? {}
      : parsePositiveIntegerFlagValue(state.iterationsRaw, "--iterations");
  if (parsedIterations.errorMessage) {
    return buildOptimizeRunResult(state, defaultTokens, parsedIterations.errorMessage);
  }

  const parsedWarmup =
    typeof state.warmupRaw === "undefined"
      ? {}
      : parseNonNegativeIntegerFlagValue(state.warmupRaw, "--warmup");
  if (parsedWarmup.errorMessage) {
    return buildOptimizeRunResult(state, defaultTokens, parsedWarmup.errorMessage);
  }

  const parsedConcurrency =
    typeof state.concurrencyRaw === "undefined"
      ? {}
      : parsePositiveIntegerFlagValue(state.concurrencyRaw, "--concurrency");
  if (parsedConcurrency.errorMessage) {
    return buildOptimizeRunResult(state, defaultTokens, parsedConcurrency.errorMessage);
  }

  if (typeof state.pathModeRaw !== "undefined" && !isBenchPathModeValue(state.pathModeRaw)) {
    return buildOptimizeRunResult(state, defaultTokens, "Flag '--path' must be one of gateway, direct, or both");
  }

  const parsedTimeoutMs =
    typeof state.timeoutMsRaw === "undefined"
      ? {}
      : parsePositiveIntegerFlagValue(state.timeoutMsRaw, "--timeout-ms");
  if (parsedTimeoutMs.errorMessage) {
    return buildOptimizeRunResult(state, defaultTokens, parsedTimeoutMs.errorMessage);
  }
  const pathMode = state.pathModeRaw ?? defaultTokens.pathMode;

  return buildOptimizeRunResult(state, {
    inputTokens: parsedInputTokens.value,
    outputTokens: parsedOutputTokens.value,
    cacheReadTokens: parsedCacheReadTokens.value,
    cacheWriteTokens: parsedCacheWriteTokens.value,
    iterations: parsedIterations.value,
    warmup: parsedWarmup.value,
    concurrency: parsedConcurrency.value,
    pathMode,
    timeoutMs: parsedTimeoutMs.value
  });
}

export function parseOptimizeListArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): OptimizeListArgs {
  const state: OptimizeListState = {
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: optimizeListBooleanFlagSpecs,
    longFlags: optimizeListLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return {
      limit: 25,
      json: state.json,
      errorMessage: parsedArgs.errorMessage
    };
  }

  const parsedLimit = parseOptionalPositiveInteger(state.limitRaw, "--limit", 25);
  if (parsedLimit.errorMessage || typeof parsedLimit.value !== "number") {
    return {
      limit: 25,
      json: state.json,
      errorMessage: parsedLimit.errorMessage
    };
  }

  return {
    limit: parsedLimit.value,
    json: state.json
  };
}

export function parseOptimizeShowArgs(argv: string[], readLongFlagValue: ReadLongFlagValue): OptimizeShowArgs {
  const state: OptimizeShowState = {
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: optimizeShowBooleanFlagSpecs,
    readLongFlagValue
  });

  return {
    json: state.json,
    ...(typeof parsedArgs.errorMessage === "undefined" ? {} : { errorMessage: parsedArgs.errorMessage })
  };
}

export function parseOptimizePruneArgs(argv: string[], readLongFlagValue: ReadLongFlagValue): OptimizePruneArgs {
  const state: OptimizePruneState = {
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: optimizePruneBooleanFlagSpecs,
    longFlags: optimizePruneLongFlagSpecs,
    readLongFlagValue
  });

  return {
    olderThan: state.olderThan,
    json: state.json,
    ...(typeof parsedArgs.errorMessage === "undefined" ? {} : { errorMessage: parsedArgs.errorMessage })
  };
}

export function parseOptimizeApplyArgs(argv: string[], readLongFlagValue: ReadLongFlagValue): OptimizeApplyArgs {
  const state: OptimizeApplyState = {
    dryRun: false,
    verify: false,
    reload: false,
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: optimizeApplyBooleanFlagSpecs,
    longFlags: optimizeApplyLongFlagSpecs,
    readLongFlagValue
  });

  return {
    routeId: state.routeId,
    configPath: state.configPath,
    dryRun: state.dryRun,
    verify: state.verify,
    reload: state.reload,
    json: state.json,
    ...(typeof parsedArgs.errorMessage === "undefined" ? {} : { errorMessage: parsedArgs.errorMessage })
  };
}

function parseOptionalPositiveInteger(
  rawValue: string | undefined,
  flagName: string,
  defaultValue: number
): { value?: number; errorMessage?: string } {
  if (typeof rawValue === "undefined") {
    return { value: defaultValue };
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== rawValue) {
    return { errorMessage: `Flag '${flagName}' requires a positive integer value` };
  }

  return { value: parsed };
}
