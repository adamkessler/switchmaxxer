import assert from "node:assert/strict";
import test from "node:test";

import { runTasksWithConcurrency } from "../../../../platform/concurrency";
import { BenchmarkCancelledError } from "../../../bench/bench-runtime";
import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import { createBenchRunCommand, type BenchRunCommandDeps } from "./run-command";
import { parseBenchArgs } from "./run-command-support";
import { createOstrichBenchmarkRunPort } from "../../../observability/observability-module";

function readLongFlagValue(
  argv: string[],
  index: number,
  flagName: string
): { value?: unknown; consumed: number; errorMessage?: string } | null {
  if (argv[index] !== flagName) {
    return null;
  }

  const next = argv[index + 1];
  if (typeof next === "undefined" || next.startsWith("--")) {
    return {
      consumed: 0,
      errorMessage: `Flag '${flagName}' requires a value`
    };
  }

  return {
    value: next,
    consumed: 1
  };
}

void test("bench run parser rejects partial numeric flag tokens", () => {
  const cases: Array<{ flag: string; value: string; message: string }> = [
    { flag: "--iterations", value: "10x", message: "Flag '--iterations' requires a non-negative integer value" },
    { flag: "--concurrency", value: "1.5", message: "Flag '--concurrency' requires a non-negative integer value" },
    { flag: "--warmup", value: "+1", message: "Flag '--warmup' requires a non-negative integer value" },
    { flag: "--timeout-ms", value: "1000ms", message: "Flag '--timeout-ms' requires a positive integer value" }
  ];

  for (const { flag, value, message } of cases) {
    const parsed = parseBenchArgs(["--route", "route_a", "--prompt", "hello", flag, value], {
      readLongFlagValue
    });

    assert.equal(parsed.errorMessage, message, `${flag}=${value}`);
  }
});

void test("bench run cancels on SIGINT, marks the run cancelled, and returns a typed json envelope", async () => {
  const jsonWrites: unknown[] = [];
  const statuses: string[] = [];

  const deps: BenchRunCommandDeps = {
    printUsageError: () => {
      throw new Error("did not expect usage output");
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJson: (value) => {
      jsonWrites.push(value);
    },
    writeJsonErrorEnvelope: () => {
      throw new Error("did not expect preflight json error envelope");
    },
    writeJsonSuccessEnvelope: () => {
      throw new Error("did not expect success envelope");
    },
    readLongFlagValue,
    assertBenchmarkPromptLength: () => {},
    benchLimits: {
      maxConcurrency: 4,
      maxIterations: 10,
      maxPromptLength: 10_000,
      maxRoutes: 4
    },
    defaultCliFetchTimeoutMs: 5_000,
    benchmarkRuns: createOstrichBenchmarkRunPort({
      open: () =>
        ({
          service: {
            benchmarks: {
              createRun: () => {},
              updateRunStatus: (_runId: string, status: string) => {
                statuses.push(status);
              }
            }
          }
        }) as never,
      close: () => {}
    }),
    resolveObservabilityStorePath: () => ".switchmaxxer/observability.sqlite",
    loadConfig: () =>
      ({
        bindHost: "127.0.0.1",
        port: 8080,
        timeoutMs: 5_000,
        routes: {
          route_a: {
            serviceProvider: "provider-a",
            api_mode: "openai-completions",
            anthropicVersion: null,
            modelCreator: "openai",
            model: "provider-model-a",
            baseUrl: "https://example.test/v1/chat/completions",
            allowPrivateEndpoints: false,
            apiKeyEnv: null,
            inlineApiKey: null,
            routeTimeoutMs: null,
            timeoutMs: 5_000,
            cost: null,
            modelCost: null
          }
        }
      }) as never,
    preflightGatewayRouteTests: async () =>
      ({
        ok: true,
        sourceFile: "config.json",
        sourcePath: "/tmp/config.json",
        bindHost: "127.0.0.1",
        port: 8080,
        probeHost: "127.0.0.1",
        healthUrl: "http://127.0.0.1:8080/health",
        pid: null,
        latencyMs: 1
      }) as never,
    resolveBenchmarkExecutionPlan: async () => ({
      ok: true,
      plan: {
        requestedPathMode: "direct",
        effectivePaths: ["direct"],
        skippedPaths: [],
        warnings: []
      }
    }),
    buildBenchTasks: () => [
      {
        sampleIndex: 0,
        routeName: "route_a",
        path: "direct",
        iteration: 1,
        isWarmup: false
      }
    ],
    executeBenchmarkTask: async ({ signal }) =>
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          reject(signal?.reason ?? new BenchmarkCancelledError("Benchmark run cancelled", "aborted"));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    runTasksWithConcurrency,
    toBenchmarkRunView: () => {
      throw new Error("did not expect completed run view");
    },
    toBenchmarkSampleView: () => {
      throw new Error("did not expect sample view");
    },
    buildBenchmarkReportView: () => {
      throw new Error("did not expect report view");
    },
    classifyCliUsageFailure: () => ({
      message: "unexpected classification",
      code: APP_ERROR_CODES.benchError,
      exitCode: 1
    }),
    noUsageMessageMatch: () => false,
    mcpUsageErrorCodes: {
      missingRequiredField: "missing_required_field",
      invalidInputField: "invalid_input_field",
      invalidFlagValue: "invalid_flag_value"
    },
    mcpEntityStateErrorCodes: {
      routeNotFound: "route_not_found"
    },
    createCliUsageError: (code: string, message: string) => Object.assign(new Error(message), { code })
  };

  const { runBenchRun } = createBenchRunCommand(deps);
  const runPromise = runBenchRun([
    "--route",
    "route_a",
    "--prompt",
    "hello",
    "--iterations",
    "1",
    "--warmup",
    "0",
    "--path",
    "direct",
    "--json"
  ]);

  await new Promise<void>((resolve) => setImmediate(resolve));
  process.emit("SIGINT");

  const exitCode = await runPromise;
  assert.equal(exitCode, 130);
  assert.deepEqual(statuses, ["cancelled"]);

  const envelope = jsonWrites[0] as
    | {
        error?: {
          code?: string;
          message?: string;
        };
        details?: Record<string, unknown>;
      }
    | undefined;
  assert.equal(jsonWrites.length, 1);
  assert.equal(envelope?.error?.code, APP_ERROR_CODES.benchError);
  assert.match(String(envelope?.error?.message), /cancelled by SIGINT/);
  assert.equal(envelope?.details?.["cancel_reason"], "SIGINT");
});
