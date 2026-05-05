import assert from "node:assert/strict";
import test from "node:test";

import { buildSuccessEnvelope } from "../../../platform/response-envelope";
import type { AppConfig, CliReadModel, ModelReadModel, ProviderReadModel, RouteReadModel } from "../../../platform/types";
import type { BenchmarkSampleRecord } from "../../observability/benchmarks";
import type { BenchmarkOperationOptions, BenchmarkRunnerResult } from "../../observability/bench-runner";
import { createOstrichOptimizeMutationPort } from "../../observability/observability-module";
import type {
  BeginPlannedExternalOptimizeApplyMutationResponse,
  BeginPlannedExternalOptimizeRestoreMutationResponse
} from "../../observability/observability-ipc-optimize-mutation-executor";
import type {
  ObservabilityBenchmarkRunPort,
  ObservabilityOptimizeMutationPort,
  ObservabilityOptimizationReportPort,
  ObservabilityOptimizationHistoryPort
} from "../../observability/observability-module";
import type { OptimizationRunRecord } from "../../observability/optimizations";
import type { ObservabilityRuntimeHandle } from "../../observability/runtime-loader";
import {
  parseOptimizeApplyArgs,
  parseOptimizeListArgs,
  parseOptimizePruneArgs,
  parseOptimizeRunArgs,
  parseOptimizeShowArgs
} from "../command-args-optimize";
import { readLongFlagValue } from "../input-utils";
import { createOptimizeCli } from "./optimize";

const TARGET_MODEL = "target-model";

function createMissingOptimizationHistoryPort(): ObservabilityOptimizationHistoryPort {
  return {
    list: ({ dbPath }) => ({
      dbPath,
      storeFound: false,
      runs: []
    }),
    show: ({ dbPath }) => ({
      dbPath,
      storeFound: false,
      run: null
    }),
    pruneOlderThan: ({ dbPath }) => ({
      dbPath,
      storeFound: false,
      result: null
    }),
    deleteRun: ({ dbPath }) => ({
      dbPath,
      storeFound: false,
      result: null
    }),
    clear: ({ dbPath }) => ({
      dbPath,
      storeFound: false,
      result: null
    })
  };
}

function createFailingBenchmarkRunPort(message: string): ObservabilityBenchmarkRunPort {
  return {
    run: async () => {
      throw new Error(message);
    }
  };
}

function createFailingOptimizationReportPort(message: string): ObservabilityOptimizationReportPort {
  return {
    persistCost: () => {
      throw new Error(message);
    },
    persistLatency: () => {
      throw new Error(message);
    }
  };
}

function createFailingOptimizeMutationPort(message: string): ObservabilityOptimizeMutationPort {
  return {
    apply: () => {
      throw new Error(message);
    },
    restore: () => {
      throw new Error(message);
    }
  };
}

function createFailingBeginOptimizeApplyMutation(message: string) {
  return (): BeginPlannedExternalOptimizeApplyMutationResponse => {
    throw new Error(message);
  };
}

function createFailingBeginOptimizeRestoreMutation(message: string) {
  return (): BeginPlannedExternalOptimizeRestoreMutationResponse => {
    throw new Error(message);
  };
}

function route(name: string): RouteReadModel {
  return {
    name,
    model: TARGET_MODEL,
    service_provider: "provider-test",
    provider_model_id: name,
    display_name: name,
    api_mode: "openai-completions",
    cost: null,
    model_cost: null,
    effective_cost: null,
    timeout_ms: null,
    effective_timeout_ms: null
  };
}

function provider(name: string): ProviderReadModel {
  return {
    name,
    endpoint: `https://${name}.example.com/v1/chat/completions`,
    api_mode: "openai-completions",
    anthropic_version: null,
    model_id_format: "passthrough",
    api_key_env: null,
    api_key_masked: null,
    allow_private_endpoints: false,
    allow_insecure_http: false,
    auth_source: "not required"
  };
}

function model(name: string, routes: RouteReadModel[]): ModelReadModel {
  return {
    name,
    display_name: name,
    model_creator: "switchmaxxer-test",
    route_count: routes.filter((candidate) => candidate.model === name).length,
    cost: null
  };
}

function readModel(routes: RouteReadModel[], providers: ProviderReadModel[] = []): CliReadModel {
  const models = [model(TARGET_MODEL, routes)];
  return {
    sourceFile: "config.json",
    sourcePath: "/tmp/config.json",
    rawText: "{}",
    models,
    modelsByName: Object.fromEntries(models.map((entry) => [entry.name, entry])),
    providers,
    providersByName: Object.fromEntries(providers.map((entry) => [entry.name, entry])),
    routes,
    routesByName: Object.fromEntries(routes.map((entry) => [entry.name, entry]))
  };
}

function benchmarkSample(overrides: Partial<BenchmarkSampleRecord> & { route_id: string; latency_ms: number }): BenchmarkSampleRecord {
  const now = "2026-04-26T00:00:00.000Z";
  return {
    id: `sample-${overrides.route_id}-${overrides.latency_ms}`,
    benchmark_run_id: "bench-run-cli",
    request_execution_id: `request-${overrides.route_id}-${overrides.latency_ms}`,
    route_id: overrides.route_id,
    provider_id: "provider-test",
    provider_model_id: overrides.route_id,
    sample_index: overrides.sample_index ?? 0,
    started_at: now,
    completed_at: now,
    status_code: 200,
    outcome: "succeeded",
    latency_ms: overrides.latency_ms,
    ttft_ms: null,
    duration_ms: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    estimated_cost_micros: null,
    is_warmup: overrides.is_warmup ?? 0,
    score_value: null,
    score_scale: null,
    score_direction: null,
    score_source: null,
    score_method: null,
    scored_at: null,
    score_json: "{\"path\":\"gateway\"}"
  };
}

void test("optimize apply --verify still verifies a no-op provider apply without mutating config", async () => {
  const targetRoute = {
    ...route("route-target"),
    service_provider: "provider-winner",
    provider_model_id: "winner-model",
    effective_cost: {
      input: 0.1,
      output: 0.1,
      cacheRead: 0,
      cacheWrite: 0
    }
  };
  const fallbackRoute = {
    ...route("route-fallback"),
    service_provider: "provider-fallback",
    provider_model_id: "fallback-model",
    effective_cost: {
      input: 0.2,
      output: 0.2,
      cacheRead: 0,
      cacheWrite: 0
    }
  };
  const currentReadModel = readModel(
    [targetRoute, fallbackRoute],
    [provider("provider-winner"), provider("provider-fallback")]
  );
  const optimizationRun: OptimizationRunRecord = {
    id: "opt-run-noop",
    created_at: "2026-04-26T00:00:00.000Z",
    finished_at: "2026-04-26T00:01:00.000Z",
    created_by: "switchmaxxer optimize",
    target_model: TARGET_MODEL,
    objective: "cost",
    status: "completed",
    winner_route: "route-target",
    benchmark_run_id: null,
    settings_json: "{}",
    candidate_snapshot_json: "[]",
    result_json: JSON.stringify({
      run: {
        run_id: null,
        persisted: false,
        created_at: null,
        finished_at: null,
        created_by: null,
        status: "completed",
        target_model: TARGET_MODEL,
        objective: "cost"
      },
      candidates: {
        requested_routes: null,
        resolved_routes: ["route-target", "route-fallback"],
        disqualified: []
      },
      reference_tokens: {
        input_tokens: 1000,
        output_tokens: 1000,
        cache_read_tokens: 0,
        cache_write_tokens: 0
      },
      bench: null,
      ranking: [
        {
          rank: 1,
          objective: "cost",
          route_id: "route-target",
          display_name: "route-target",
          model: TARGET_MODEL,
          service_provider: "provider-winner",
          provider_model_id: "winner-model",
          score: 0.0002,
          score_unit: "usd",
          details: {},
          disqualified: null
        },
        {
          rank: 2,
          objective: "cost",
          route_id: "route-fallback",
          display_name: "route-fallback",
          model: TARGET_MODEL,
          service_provider: "provider-fallback",
          provider_model_id: "fallback-model",
          score: 0.0004,
          score_unit: "usd",
          details: {},
          disqualified: null
        }
      ],
      winner: {
        route_id: "route-target",
        score: 0.0002,
        score_unit: "usd",
        tied_with: []
      },
      warnings: []
    }),
    warnings_json: "[]"
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const verifyCalls: Array<{ configPath?: string; routeId: string }> = [];
  let mutateCallCount = 0;

  const controlPlaneEvents: Array<{ id: string; status: string; result_json: string }> = [];
  const fakeService = {
    optimizations: {
      getRun: (runId: string) => runId === optimizationRun.id ? optimizationRun : null
    },
    controlPlaneActions: {
      createEvent: (record: { id: string; status: string; result_json: string }) => {
        controlPlaneEvents.push(record);
      },
      finishEvent: (actionId: string, options: { status: string; resultJson?: string }) => {
        const event = controlPlaneEvents.find((candidate) => candidate.id === actionId);
        assert.ok(event, "expected optimize apply to create a control-plane action");
        event.status = options.status;
        event.result_json = options.resultJson ?? "{}";
      }
    },
    configMutations: {
      createSnapshot: () => {
        throw new Error("no-op optimize apply should not create a config snapshot");
      },
      createEvent: () => {
        throw new Error("no-op optimize apply should not create a config mutation event");
      }
    }
  };

  const optimizeMutationPort = createOstrichOptimizeMutationPort({
    openExisting: () =>
      ({
        store: {},
        service: fakeService
      }) as unknown as ObservabilityRuntimeHandle,
    close: () => {}
  });
  const cli = createOptimizeCli({
    createCliCommandRegistration: (options) => ({
      ...options,
      run: async (argv) => {
        const positionals: string[] = [];
        let rest = [...argv];
        for (const positional of options.positionals ?? []) {
          const value = rest.shift();
          if (typeof value !== "string" || value.length === 0 || (positional.rejectFlagLike !== false && value.startsWith("-"))) {
            stderr.push(`Missing required argument '${positional.label}'`);
            return 2;
          }
          positionals.push(value);
        }
        return await options.execute?.(rest, positionals);
      }
    }),
    runRegisteredCommandFamily: async (argv, options) => {
      for (const command of options.commands) {
        const matchedArgs = command.match(argv);
        if (matchedArgs !== null) {
          return await command.run(matchedArgs);
        }
      }
      return await options.defaultRun?.(argv);
    },
    parseOptimizeRunArgs: (argv) => parseOptimizeRunArgs(argv, readLongFlagValue),
    parseOptimizeListArgs: (argv) => parseOptimizeListArgs(argv, readLongFlagValue),
    parseOptimizePruneArgs: (argv) => parseOptimizePruneArgs(argv, readLongFlagValue),
    parseOptimizeShowArgs: (argv) => parseOptimizeShowArgs(argv, readLongFlagValue),
    parseOptimizeApplyArgs: (argv) => parseOptimizeApplyArgs(argv, readLongFlagValue),
    loadConfig: () => ({ routes: {} }) as AppConfig,
    loadCliReadModel: () => currentReadModel,
    mutateConfigDocument: () => {
      mutateCallCount += 1;
    },
    getMutableConfigSection: (document, sectionName) => document[sectionName] as Record<string, unknown>,
    optimizationHistory: {
      ...createMissingOptimizationHistoryPort(),
      show: ({ dbPath, runId }) => ({
        dbPath,
        storeFound: true,
        run: fakeService.optimizations.getRun(runId)
      })
    },
    optimizationReports: createFailingOptimizationReportPort("optimize apply should not persist reports"),
    optimizeMutations: createFailingOptimizeMutationPort("optimize apply should use the planned begin dependency"),
    beginOptimizeApplyMutation: (options) => {
      const result = optimizeMutationPort.apply({
        dbPath: options.dbPath,
        configPath: options.configPath,
        readModel: options.readModel,
        loadReadModel: options.loadReadModel,
        mutateConfigDocument: options.mutateConfigDocument,
        getMutableConfigSection: options.getMutableConfigSection,
        sourceSurface: options.plan.command.sourceSurface,
        createdBy: options.plan.command.createdBy,
        actorKind: options.plan.command.actorKind,
        runId: options.plan.command.runId,
        targetRouteId: options.plan.command.targetRouteId,
        dryRun: options.plan.command.dryRun,
        deferLedgerCompletion: true,
        metadata: options.plan.command.metadata
      });
      return {
        id: options.id,
        ok: true,
        result,
        warnings: [],
        completeIdempotency: (completion) => {
          if (result.result?.ok && result.result.deferred) {
            const view = result.result.complete(completion);
            return {
              id: options.id,
              ok: true,
              result: {
                ...result,
                result: {
                  ...result.result,
                  deferred: false,
                  view
                }
              },
              warnings: []
            };
          }

          return {
            id: options.id,
            ok: true,
            result,
            warnings: []
          };
        }
      };
    },
    beginOptimizeRestoreMutation: createFailingBeginOptimizeRestoreMutation("optimize apply should not begin restore mutations"),
    resolveObservabilityStorePath: () => "/tmp/observability.sqlite",
    defaultCliFetchTimeoutMs: 60_000,
    preflightGatewayRouteTests: async () => ({
      ok: true,
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      bindHost: "127.0.0.1",
      port: 3000,
      probeHost: "127.0.0.1",
      healthUrl: "http://127.0.0.1:3000/health",
      pid: null,
      latencyMs: null
    }),
    runOptimizeApplyReload: async () => {
      throw new Error("optimize apply --verify should not reload without --reload");
    },
    runOptimizeApplyVerify: async (options) => {
      verifyCalls.push({ configPath: options.configPath, routeId: options.routeId });
      return {
        requested: true,
        status: "passed",
        exit_code: 0,
        command: "test",
        route_id: options.routeId,
        message: null
      };
    },
    benchmarkRuns: createFailingBenchmarkRunPort("optimize apply should not run benchmarks"),
    printUsageError: (message) => {
      stderr.push(message);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    writeJsonSuccessEnvelope: (command, data, options) => {
      stdout.push(JSON.stringify(buildSuccessEnvelope(command, data, options)));
    },
    writeJsonErrorEnvelope: (command, code, message, options) => {
      stdout.push(JSON.stringify({ ok: false, command, error: { code, message }, ...options }));
    }
  });

  const exitCode = await cli.handleCommand([
    "apply",
    optimizationRun.id,
    "--route",
    "route-target",
    "--verify",
    "--json"
  ]);

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(mutateCallCount, 0);
  assert.deepEqual(verifyCalls, [{ configPath: undefined, routeId: "route-target" }]);
  assert.equal(controlPlaneEvents.length, 1);
  assert.equal(controlPlaneEvents[0]?.status, "noop");

  const payload = JSON.parse(stdout[0] ?? "{}") as {
    ok: boolean;
    data: {
      changed: boolean;
      action_id: string | null;
      verification: { requested: boolean; status: string; route_id: string } | null;
      mutation: { from: string; to: string };
    };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.data.changed, false);
  assert.equal(payload.data.action_id, null);
  assert.deepEqual(payload.data.mutation, {
    field: "service_provider",
    from: "provider-winner",
    to: "provider-winner",
    service_provider: {
      changed: false,
      from: "provider-winner",
      to: "provider-winner"
    },
    provider_model_id: {
      changed: false,
      from: "winner-model",
      to: "winner-model"
    },
    cost: {
      changed: false,
      from: null,
      to: null
    }
  });
  assert.deepEqual(payload.data.verification, {
    requested: true,
    status: "passed",
    exit_code: 0,
    command: "test",
    route_id: "route-target",
    message: null
  });
});

void test("optimize latency runs the bench operation and persists an owned benchmark reference", async () => {
  const routes = [route("route-slow"), route("route-fast")];
  const optimizationRecords: OptimizationRunRecord[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const runnerResult: BenchmarkRunnerResult = {
    ok: true,
    benchmarkRunId: "bench-run-cli",
    run: {
      id: "bench-run-cli",
      name: "bench-2026-04-26T00:00:00.000Z",
      created_at: "2026-04-26T00:00:00.000Z",
      created_by: "switchmaxxer optimize",
      objective: "route_optimization",
      notes: null,
      settings_json: "{}",
      status: "completed"
    },
    summary: {
      total_samples: 4,
      measured_samples: 4,
      warmup_samples: 0,
      success_count: 4,
      failed_count: 0,
      average_latency_ms: 130,
      min_latency_ms: 80,
      max_latency_ms: 190,
      average_ttft_ms: null,
      average_duration_ms: null
    },
    samples: [
      benchmarkSample({ route_id: "route-fast", latency_ms: 80, sample_index: 1 }),
      benchmarkSample({ route_id: "route-fast", latency_ms: 100, sample_index: 2 }),
      benchmarkSample({ route_id: "route-slow", latency_ms: 150, sample_index: 3 }),
      benchmarkSample({ route_id: "route-slow", latency_ms: 190, sample_index: 4 })
    ],
    sampleViews: [],
    report: {
      run: {},
      execution: {
        requested_path_mode: "gateway",
        effective_paths: ["gateway"],
        skipped_paths: [],
        warnings: []
      },
      summary: {
        total_samples: 4,
        measured_samples: 4,
        warmup_samples: 0,
        success_count: 4,
        failed_count: 0,
        average_latency_ms: 130,
        min_latency_ms: 80,
        max_latency_ms: 190,
        average_ttft_ms: null,
        average_duration_ms: null
      },
      analysis: {
        by_path: []
      },
      samples: []
    }
  };

  const cli = createOptimizeCli({
    createCliCommandRegistration: (options) => ({
      ...options,
      run: async (argv) => await options.execute?.(argv, [])
    }),
    runRegisteredCommandFamily: async (argv, options) => await options.defaultRun?.(argv),
    parseOptimizeRunArgs: (argv) => parseOptimizeRunArgs(argv, readLongFlagValue),
    parseOptimizeListArgs: (argv) => parseOptimizeListArgs(argv, readLongFlagValue),
    parseOptimizePruneArgs: (argv) => parseOptimizePruneArgs(argv, readLongFlagValue),
    parseOptimizeShowArgs: (argv) => parseOptimizeShowArgs(argv, readLongFlagValue),
    parseOptimizeApplyArgs: (argv) => parseOptimizeApplyArgs(argv, readLongFlagValue),
    loadConfig: () => ({ routes: {} }) as AppConfig,
    loadCliReadModel: () => readModel(routes),
    mutateConfigDocument: () => undefined,
    getMutableConfigSection: (document, sectionName) => document[sectionName] as Record<string, unknown>,
    optimizationHistory: createMissingOptimizationHistoryPort(),
    optimizationReports: {
      persistCost: () => {
        throw new Error("latency optimize should not persist a cost report");
      },
      persistLatency: (options) => {
        optimizationRecords.push({
          id: "opt-run-cli",
          created_at: "2026-05-12T00:00:00.000Z",
          finished_at: "2026-05-12T00:00:00.000Z",
          created_by: options.createdBy,
          target_model: TARGET_MODEL,
          objective: "latency",
          status: "completed",
          winner_route: options.report.winner.route_id,
          benchmark_run_id: options.benchmarkRunId,
          settings_json: JSON.stringify({
            requested_routes: options.requestedRoutes,
            ...options.settings
          }),
          result_json: JSON.stringify(options.report),
          candidate_snapshot_json: "[]",
          warnings_json: "[]"
        });
        return {
          dbPath: options.dbPath,
          storeFound: true,
          report: {
            ...options.report,
            store_path: options.dbPath,
            run: {
              ...options.report.run,
              run_id: "opt-run-cli",
              persisted: true,
              created_at: "2026-05-12T00:00:00.000Z",
              finished_at: "2026-05-12T00:00:00.000Z",
              created_by: options.createdBy
            }
          }
        };
      }
    },
    optimizeMutations: createFailingOptimizeMutationPort("latency optimize should not run apply/restore mutations"),
    beginOptimizeApplyMutation: createFailingBeginOptimizeApplyMutation("latency optimize should not begin apply mutations"),
    beginOptimizeRestoreMutation: createFailingBeginOptimizeRestoreMutation("latency optimize should not begin restore mutations"),
    resolveObservabilityStorePath: () => "/tmp/observability.sqlite",
    defaultCliFetchTimeoutMs: 60_000,
    preflightGatewayRouteTests: async () => ({
      ok: true,
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      bindHost: "127.0.0.1",
      port: 3000,
      probeHost: "127.0.0.1",
      healthUrl: "http://127.0.0.1:3000/health",
      pid: null,
      latencyMs: null
    }),
    runOptimizeApplyReload: async () => ({
      requested: true,
      status: "succeeded",
      exit_code: 0,
      command: "gateway reload",
      message: null
    }),
    runOptimizeApplyVerify: async () => ({
      requested: true,
      status: "passed",
      exit_code: 0,
      command: "test",
      route_id: "route-fast",
      message: null
    }),
    benchmarkRuns: {
      run: async (options: Omit<BenchmarkOperationOptions, "service"> & { dbPath: string }) => {
      assert.deepEqual(options.routeNames, ["route-slow", "route-fast"]);
      assert.equal(options.prompt, "ping");
      assert.equal(options.pathMode, "gateway");
      assert.equal(options.createdBy, "switchmaxxer optimize");
        return {
          dbPath: options.dbPath,
          storeFound: true,
          result: runnerResult
        };
      }
    },
    printUsageError: (message) => {
      stderr.push(message);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    writeJsonSuccessEnvelope: (command, data, options) => {
      stdout.push(JSON.stringify(buildSuccessEnvelope(command, data, options)));
    },
    writeJsonErrorEnvelope: (command, code, message, options) => {
      stdout.push(JSON.stringify({ ok: false, command, error: { code, message }, ...options }));
    }
  });

  const exitCode = await cli.handleCommand([
    "--model",
    TARGET_MODEL,
    "--objective",
    "latency",
    "--prompt",
    "ping",
    "--iterations",
    "2",
    "--warmup",
    "0",
    "--path",
    "gateway",
    "--json"
  ]);

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(optimizationRecords.length, 1);
  assert.equal(optimizationRecords[0]?.benchmark_run_id, "bench-run-cli");
  assert.deepEqual(JSON.parse(optimizationRecords[0]?.settings_json ?? "{}"), {
    requested_routes: null,
    prompt_chars: 4,
    iterations: 2,
    warmup: 0,
    concurrency: 1,
    timeout_ms: 60_000,
    path_mode: "gateway"
  });

  const payload = JSON.parse(stdout[0] ?? "{}") as {
    ok: boolean;
    data: {
      run: { objective: string };
      winner: { route_id: string; score: number; score_unit: string; tied_with: string[] };
      bench: { run_id: string };
    };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.data.run.objective, "latency");
  assert.deepEqual(payload.data.winner, {
    route_id: "route-fast",
    score: 90,
    score_unit: "ms",
    tied_with: []
  });
  assert.equal(payload.data.bench.run_id, "bench-run-cli");
});
