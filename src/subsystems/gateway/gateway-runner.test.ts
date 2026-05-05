import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import { runGatewayServerLifecycle } from "./gateway-runner";
import type { GatewayFatalState, GatewayReloadState } from "../hot-path/manatee/runtime/runtime-snapshot";
import type { ObservabilityModule } from "../observability/observability-module";

type RunnerSnapshot = {
  config: {
    sourceFile: string;
    sourcePath: string;
    bindHost: string;
    port: number;
    maxConnections: number;
    shutdownTimeoutMs?: number;
    observability: {
      retentionOlderThan: string | null;
    };
    routes: Record<string, unknown>;
  };
  readModel: {
    providers: Array<{
      name: string;
      auth_source: string;
    }>;
  };
  reloadState: GatewayReloadState;
  fatalState: GatewayFatalState;
};

function createRunnerSnapshot(): RunnerSnapshot {
  return {
    config: {
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      bindHost: "127.0.0.1",
      port: 0,
      maxConnections: 25,
      shutdownTimeoutMs: 1_000,
      observability: {
        retentionOlderThan: "7d"
      },
      routes: {
        "test-route": {}
      }
    },
    readModel: {
      providers: []
    },
    reloadState: {
      lastReloadStatus: "never_attempted",
      lastReloadError: null,
      lastReloadAttemptedAt: null,
      lastReloadSucceededAt: null
    },
    fatalState: {
      processIntegrityStatus: "ok",
      lastFatalError: null,
      lastFatalAt: null
    }
  };
}

function createRecordingObservabilityModule(calls: string[], onBootstrap: () => void): ObservabilityModule {
  return {
    descriptor: {
      id: "ostrich",
      runtime: "in_process_typescript",
      displayName: "Ostrich",
      capabilities: {
        gatewayObservationWrites: true,
        localReadModel: true,
        retentionPruning: true,
        gracefulShutdownDrain: true
      }
    },
    trace: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        traces: []
      }),
      listObservations: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        observations: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        requestExecution: null,
        observations: [],
        benchmarkSamples: []
      }),
      getStats: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        stats: {
          total_count: 0,
          partial_output_count: 0,
          average_gateway_residency_ms: null,
          average_upstream_ttft_ms: null,
          average_upstream_duration_ms: null,
          outcome_counts: [],
          top_failing_routes: []
        }
      })
    },
    traceMaintenance: {
      verify: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        results: []
      }),
      repair: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        results: []
      })
    },
    retention: {
      pruneOlderThan: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    ledger: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        events: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        event: null
      })
    },
    controlPlaneAudit: {
      startConfigMutation: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        actionId: null
      }),
      finishConfigMutation: ({ dbPath }) => ({
        dbPath,
        storeFound: false
      })
    },
    benchmarkRuns: {
      run: async ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    benchmarkHistory: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        runs: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        run: null,
        summary: null,
        samples: []
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
    },
    optimizationReports: {
      persistCost: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        report: null
      }),
      persistLatency: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        report: null
      })
    },
    optimizeMutations: {
      apply: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      restore: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    optimizationHistory: {
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
    },
    configure: (options) => {
      calls.push(`configure:${options.retentionOlderThan ?? "none"}`);
    },
    bootstrap: () => {
      calls.push("bootstrap");
      onBootstrap();
    },
    pruneRetentionNow: (source = "interval") => {
      calls.push(`prune:${source}`);
    },
    getService: () => null,
    getDbPath: () => null,
    recordGatewayObservation: () => {},
    recordGatewayFailureObservation: () => {},
    shutdown: async () => {
      calls.push("shutdown");
    }
  };
}

void test("gateway runner drives startup and retention through the observability module", async () => {
  const calls: string[] = [];
  const processHandlerCleanups: Array<() => void> = [];
  let closed = false;

  let resolveStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  const shutdown = new Promise<void>((resolve) => {
    void runGatewayServerLifecycle({
      initialRuntime: createRunnerSnapshot(),
      requestHandler: async (_request: IncomingMessage, response: ServerResponse) => {
        response.statusCode = 204;
        response.end();
      },
      resolveInboundAuthKind: () => "token",
      applyEffectiveLogLevel: () => "info",
      observabilityModule: createRecordingObservabilityModule(calls, resolveStarted),
      getWorldReadableConfigWarning: () => null,
      getInlineApiKeyProviderNames: () => [],
      defaultRetentionPruneIntervalMs: 10,
      logLine: () => {},
      logWarning: () => {},
      logStartup: () => {},
      logDebug: () => {},
      sendJsonError: (response, statusCode, message) => {
        response.statusCode = statusCode;
        response.end(JSON.stringify({ error: message }));
      },
      beginGracefulShutdown: (
        _reason,
        _currentRuntime,
        clearRetentionPruneTimer,
        closeServer,
        _closeIdleConnections,
        removeHandlers
      ) => {
        clearRetentionPruneTimer();
        processHandlerCleanups.push(removeHandlers);
        removeHandlers();
        closeServer(() => {
          closed = true;
          resolve();
        });
        return true;
      },
      reloadRuntime: (currentRuntime) => currentRuntime,
      markReloadFailure: (currentRuntime) => currentRuntime,
      markFatalRuntimeError: (currentRuntime) => currentRuntime
    });
  });

  try {
    await started;
    await new Promise((resolve) => setTimeout(resolve, 25));
    process.emit("SIGTERM");
    await shutdown;

    assert.ok(calls.includes("configure:7d"));
    assert.ok(calls.includes("bootstrap"));
    assert.ok(calls.includes("prune:interval"));
    assert.equal(closed, true);
  } finally {
    processHandlerCleanups.forEach((cleanup) => cleanup());
  }
});
