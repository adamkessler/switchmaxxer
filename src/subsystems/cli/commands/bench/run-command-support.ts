import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isBenchPathModeValue, type BenchPathModeValue } from "../../../observability/bench-path-mode";
import { BenchmarkCancelledError } from "../../../bench/bench-runtime";
import {
  BENCH_EXECUTION_ISSUES,
  validateBenchExecutionInput
} from "../../../observability/bench-execution-validation";
import {
  parseNonNegativeIntegerFlagValue,
  parsePositiveIntegerFlagValue
} from "../../command-arg-primitives";

export type BenchPathMode = BenchPathModeValue;

export type ParseBenchArgsResult = {
  route?: string;
  routesCsv?: string;
  prompt?: string;
  filePath?: string;
  iterations?: number;
  concurrency?: number;
  warmup?: number;
  pathMode: BenchPathMode;
  timeoutMs?: number;
  configPath?: string;
  outputPath?: string;
  json: boolean;
  errorMessage?: string;
};

export function parseBenchArgs(
  argv: string[],
  options: {
    readLongFlagValue: (
      argv: string[],
      index: number,
      flagName: string
    ) => { value?: unknown; consumed: number; errorMessage?: string } | null;
  }
): ParseBenchArgsResult {
  let route: string | undefined;
  let routesCsv: string | undefined;
  let prompt: string | undefined;
  let filePath: string | undefined;
  let iterations: number | undefined;
  let concurrency: number | undefined;
  let warmup: number | undefined;
  let pathMode: BenchPathMode = "both";
  let timeoutMs: number | undefined;
  let configPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;

  argLoop: for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    for (const flagName of [
      "--route",
      "--routes",
      "--prompt",
      "--file",
      "--iterations",
      "--concurrency",
      "--warmup",
      "--path",
      "--timeout-ms",
      "--config",
      "--output"
    ] as const) {
      const parsedFlag = options.readLongFlagValue(argv, index, flagName);
      if (!parsedFlag) {
        continue;
      }

      if (parsedFlag.errorMessage) {
        return {
          route,
          routesCsv,
          prompt,
          filePath,
          iterations,
          concurrency,
          warmup,
          pathMode,
          configPath,
          outputPath,
          json,
          errorMessage: parsedFlag.errorMessage
        };
      }

      const nextArg = parsedFlag.value as string;

      if (flagName === "--route") {
        route = nextArg;
      } else if (flagName === "--routes") {
        routesCsv = nextArg;
      } else if (flagName === "--prompt") {
        prompt = nextArg;
      } else if (flagName === "--file") {
        filePath = nextArg;
      } else if (flagName === "--iterations") {
        const parsed = parseNonNegativeIntegerFlagValue(nextArg, flagName);
        if (parsed.errorMessage) {
          return {
            route,
            routesCsv,
            prompt,
            filePath,
            iterations,
            concurrency,
            warmup,
            pathMode,
            configPath,
            outputPath,
            json,
            errorMessage: parsed.errorMessage
          };
        }
        iterations = parsed.value;
      } else if (flagName === "--concurrency") {
        const parsed = parseNonNegativeIntegerFlagValue(nextArg, flagName);
        if (parsed.errorMessage) {
          return {
            route,
            routesCsv,
            prompt,
            filePath,
            iterations,
            concurrency,
            warmup,
            pathMode,
            configPath,
            outputPath,
            json,
            errorMessage: parsed.errorMessage
          };
        }
        concurrency = parsed.value;
      } else if (flagName === "--warmup") {
        const parsed = parseNonNegativeIntegerFlagValue(nextArg, flagName);
        if (parsed.errorMessage) {
          return {
            route,
            routesCsv,
            prompt,
            filePath,
            iterations,
            concurrency,
            warmup,
            pathMode,
            configPath,
            outputPath,
            json,
            errorMessage: parsed.errorMessage
          };
        }
        warmup = parsed.value;
      } else if (flagName === "--path") {
        if (!isBenchPathModeValue(nextArg)) {
          return {
            route,
            routesCsv,
            prompt,
            filePath,
            iterations,
            concurrency,
            warmup,
            pathMode,
            configPath,
            outputPath,
            json,
            errorMessage: "Flag '--path' must be one of gateway, direct, or both"
          };
        }
        pathMode = nextArg;
      } else if (flagName === "--timeout-ms") {
        const parsed = parsePositiveIntegerFlagValue(nextArg, flagName);
        if (parsed.errorMessage || typeof parsed.value !== "number") {
          return {
            route,
            routesCsv,
            prompt,
            filePath,
            iterations,
            concurrency,
            warmup,
            pathMode,
            configPath,
            outputPath,
            json,
            errorMessage: "Flag '--timeout-ms' requires a positive integer value"
          };
        }
        timeoutMs = parsed.value;
      } else if (flagName === "--config") {
        configPath = nextArg;
      } else if (flagName === "--output") {
        outputPath = nextArg;
      }

      index += parsedFlag.consumed;
      continue argLoop;
    }

    return {
      route,
      routesCsv,
      prompt,
      filePath,
      iterations,
      concurrency,
      warmup,
      pathMode,
      timeoutMs,
      configPath,
      outputPath,
      json,
      errorMessage: `Unknown flag '${arg}'`
    };
  }

  if (route && routesCsv) {
    return {
      route,
      routesCsv,
      prompt,
      filePath,
      iterations,
      concurrency,
      warmup,
      pathMode,
      timeoutMs,
      configPath,
      outputPath,
      json,
      errorMessage: "Use either '--route' or '--routes', not both"
    };
  }

  if (!route && !routesCsv) {
    return {
      route,
      routesCsv,
      prompt,
      filePath,
      iterations,
      concurrency,
      warmup,
      pathMode,
      timeoutMs,
      configPath,
      outputPath,
      json,
      errorMessage: "One of '--route' or '--routes' is required"
    };
  }

  if (prompt && filePath) {
    return {
      route,
      routesCsv,
      prompt,
      filePath,
      iterations,
      concurrency,
      warmup,
      pathMode,
      configPath,
      outputPath,
      json,
      errorMessage: "Use either '--prompt' or '--file', not both"
    };
  }

  if (!prompt && !filePath) {
    return {
      route,
      routesCsv,
      prompt,
      filePath,
      iterations,
      concurrency,
      warmup,
      pathMode,
      configPath,
      outputPath,
      json,
      errorMessage: "One of '--prompt' or '--file' is required"
    };
  }

  return {
    route,
    routesCsv,
    prompt,
    filePath,
    iterations,
    concurrency,
    warmup,
    pathMode,
    timeoutMs,
    configPath,
    outputPath,
    json
  };
}

export function buildBenchmarkPrompt(
  parsedArgs: ParseBenchArgsResult,
  options: {
    assertBenchmarkPromptLength: (prompt: string, commandName: "bench" | "bench_run") => void;
    maxPromptLength: number;
    createCliUsageError: (code: string, message: string) => Error;
    missingRequiredFieldCode: string;
    invalidInputFieldCode: string;
  }
): string {
  let prompt: string;

  if (typeof parsedArgs.prompt === "string") {
    prompt = parsedArgs.prompt;
  } else if (typeof parsedArgs.filePath === "string") {
    prompt = readFileSync(parsedArgs.filePath, "utf8");
  } else {
    throw options.createCliUsageError(
      options.missingRequiredFieldCode,
      "One of '--prompt' or '--file' is required"
    );
  }

  try {
    options.assertBenchmarkPromptLength(prompt, "bench");
  } catch (error) {
    throw options.createCliUsageError(
      options.invalidInputFieldCode,
      error instanceof Error
        ? error.message
        : `Benchmark prompt must be at most ${options.maxPromptLength} characters for 'bench'`
    );
  }

  return prompt;
}

export function writeBenchReportOutput(
  outputPath: string | undefined,
  report: unknown,
  text: string,
  json: boolean
): void {
  if (!outputPath) {
    return;
  }

  const resolvedPath = path.resolve(outputPath);
  writeFileSync(resolvedPath, json ? `${JSON.stringify(report, null, 2)}\n` : text, "utf8");
}

export function validateBenchExecutionContract(options: {
  prompt: string;
  iterations: number;
  concurrency: number;
  maxPromptLength: number;
  maxIterations: number;
  maxConcurrency: number;
  assertBenchmarkPromptLength: (prompt: string, commandName: "bench" | "bench_run") => void;
  createCliUsageError: (code: string, message: string) => Error;
  invalidInputFieldCode: string;
  invalidFlagValueCode: string;
}): void {
  const executionIssue = validateBenchExecutionInput({
    prompt: options.prompt,
    iterations: options.iterations,
    concurrency: options.concurrency,
    maxPromptLength: options.maxPromptLength,
    maxIterations: options.maxIterations,
    maxConcurrency: options.maxConcurrency
  });
  if (executionIssue !== null) {
    switch (executionIssue) {
      case BENCH_EXECUTION_ISSUES.promptTooLong:
        try {
          options.assertBenchmarkPromptLength(options.prompt, "bench");
        } catch (error) {
          throw options.createCliUsageError(
            options.invalidInputFieldCode,
            error instanceof Error
              ? error.message
              : `Benchmark prompt must be at most ${options.maxPromptLength} characters for 'bench'`
          );
        }
        break;
      case BENCH_EXECUTION_ISSUES.iterationsTooHigh:
        throw options.createCliUsageError(
          options.invalidFlagValueCode,
          `Flag '--iterations' must be at most ${options.maxIterations} for 'bench'`
        );
      case BENCH_EXECUTION_ISSUES.concurrencyTooHigh:
        throw options.createCliUsageError(
          options.invalidFlagValueCode,
          `Flag '--concurrency' must be at most ${options.maxConcurrency} for 'bench'`
        );
    }
  }
}

export function waitForBenchDrainAfterAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      timeout = setTimeout(() => {
        cleanup();
        reject(
          new BenchmarkCancelledError(
            `Benchmark run cancelled by SIGINT after waiting ${timeoutMs}ms for in-flight work to stop`,
            "SIGINT"
          )
        );
      }, timeoutMs);
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
