import assert from "node:assert/strict";

import {
  buildObservabilityIpcErrorResponse,
  buildObservabilityIpcSuccessResponse,
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityIpcRequest
} from "./observability-ipc-contract";
import {
  dispatchExternalObservabilityIpcRequest,
  type ObservabilityIpcExternalTransport
} from "./observability-ipc-external-adapter";
import { test } from "./observability.test-support";

const DB_PATH = "/tmp/observability-ipc-external-adapter.sqlite";

void test("observability IPC external adapter validates requests before exchange and responses after exchange", async () => {
  const request: ObservabilityIpcRequest<"trace.list"> = {
    id: "external-ipc-trace-list",
    operation: "trace.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {
      filters: {
        limit: 5
      }
    }
  };
  const exchangedRequests: unknown[] = [];
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async (frame) => {
      exchangedRequests.push(frame);
      return buildObservabilityIpcSuccessResponse(frame as ObservabilityIpcRequest<"trace.list">, {
        dbPath: DB_PATH,
        storeFound: false,
        traces: []
      });
    }
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(response.ok, true);
  assert.deepEqual(exchangedRequests, [request]);
  assert.deepEqual(response, {
    id: "external-ipc-trace-list",
    ok: true,
    result: {
      dbPath: DB_PATH,
      storeFound: false,
      traces: []
    },
    warnings: []
  });
});

void test("observability IPC external adapter round-trips a supported history request", async () => {
  const request: ObservabilityIpcRequest<"benchmarkHistory.list"> = {
    id: "external-ipc-benchmark-history-list",
    operation: "benchmarkHistory.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {
      limit: 10
    }
  };
  const exchangedRequests: unknown[] = [];
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async (frame) => {
      exchangedRequests.push(frame);
      return {
        ...buildObservabilityIpcSuccessResponse(frame as ObservabilityIpcRequest<"benchmarkHistory.list">, {
          dbPath: DB_PATH,
          storeFound: true,
          runs: []
        }),
        warnings: ["external engine returned an empty benchmark history."]
      };
    }
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(response.ok, true);
  assert.deepEqual(exchangedRequests, [request]);
  assert.deepEqual(response, {
    id: "external-ipc-benchmark-history-list",
    ok: true,
    result: {
      dbPath: DB_PATH,
      storeFound: true,
      runs: []
    },
    warnings: ["external engine returned an empty benchmark history."]
  });
});

void test("observability IPC external adapter rejects malformed operation success results", async () => {
  const request: ObservabilityIpcRequest<"benchmarkHistory.list"> = {
    id: "external-ipc-benchmark-history-bad-result",
    operation: "benchmarkHistory.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {
      limit: 10
    }
  };
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async (frame) => buildObservabilityIpcSuccessResponse(
      frame as ObservabilityIpcRequest<"benchmarkHistory.list">,
      {
        dbPath: DB_PATH,
        storeFound: true,
        runs: "not-runs"
      } as never
    )
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }
  assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
  assert.equal(response.error.details?.["field"], "result.runs");
  assert.equal(response.error.details?.["operation"], "benchmarkHistory.list");
  assert.equal(response.error.details?.["transport"], "external");
});

void test("observability IPC external adapter rejects local-only function payloads before exchange", async () => {
  const request = {
    id: "external-ipc-benchmark-run",
    operation: "benchmarkRuns.run",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {
      config: {
        bindHost: "127.0.0.1",
        port: 8080,
        timeoutMs: 5000,
        routes: {}
      },
      routeNames: ["route-ipc-external"],
      prompt: "hello",
      iterations: 1,
      warmup: 0,
      concurrency: 1,
      pathMode: "direct",
      preflightGateway: async () => ({ ok: true }),
      createdBy: "switchmaxxer external IPC test",
      objective: "route_benchmark",
      taskPlanCommandName: "bench"
    }
  } as ObservabilityIpcRequest<"benchmarkRuns.run">;
  let exchangeCount = 0;
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async () => {
      exchangeCount += 1;
      throw new Error("exchange should not run for invalid external payloads");
    }
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(exchangeCount, 0);
  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }
  assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
  assert.equal(response.error.details?.["field"], "payload.preflightGateway");
});

void test("observability IPC external adapter rejects framed optimize mutations before exchange", async () => {
  const requests = [
    {
      id: "external-ipc-optimize-apply",
      operation: "optimizeMutations.apply",
      payload: {
        configPath: "/tmp/config.json",
        readModel: {},
        sourceSurface: "cli",
        createdBy: "switchmaxxer external IPC test",
        actorKind: "operator",
        actorId: null,
        sessionId: null,
        dryRun: true,
        metadata: {
          phase: "external-adapter-validation"
        },
        deferLedgerCompletion: false,
        runId: "opt-ipc-external",
        targetRouteId: "route-ipc-external"
      }
    },
    {
      id: "external-ipc-optimize-restore",
      operation: "optimizeMutations.restore",
      payload: {
        configPath: "/tmp/config.json",
        readModel: {},
        sourceSurface: "mcp",
        createdBy: "switchmaxxer external IPC test",
        actorKind: "agent",
        actorId: null,
        sessionId: "external-session",
        dryRun: true,
        metadata: {
          phase: "external-adapter-validation"
        },
        deferLedgerCompletion: false,
        selector: {
          mode: "action",
          actionId: "optimize-apply-action"
        }
      }
    }
  ] as const;
  let exchangeCount = 0;
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async () => {
      exchangeCount += 1;
      throw new Error("exchange should not run for unsupported external optimize mutations");
    }
  };

  for (const requestOptions of requests) {
    const request = {
      id: requestOptions.id,
      operation: requestOptions.operation,
      contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
      store: {
        dbPath: DB_PATH
      },
      payload: requestOptions.payload
    } as unknown as ObservabilityIpcRequest<"optimizeMutations.apply" | "optimizeMutations.restore">;

    const response = await dispatchExternalObservabilityIpcRequest(transport, request);

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }
    assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
    assert.equal(response.error.details?.["field"], "operation");
    assert.equal(response.error.details?.["operation"], requestOptions.operation);
  }
  assert.equal(exchangeCount, 0);
});

void test("observability IPC external adapter maps malformed engine responses to protocol errors", async () => {
  const request: ObservabilityIpcRequest<"trace.list"> = {
    id: "external-ipc-bad-response",
    operation: "trace.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {}
  };
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async () => ({
      id: "external-ipc-bad-response",
      ok: true,
      warnings: []
    })
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }
  assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
  assert.equal(response.error.details?.["field"], "result");
});

void test("observability IPC external adapter accepts engine error responses without result validation", async () => {
  const request: ObservabilityIpcRequest<"benchmarkHistory.list"> = {
    id: "external-ipc-engine-error-response",
    operation: "benchmarkHistory.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {
      limit: 10
    }
  };
  const engineError = buildObservabilityIpcErrorResponse({
    id: request.id,
    code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
    message: "External engine rejected benchmark history list.",
    details: {
      operation: "benchmarkHistory.list",
      reason: "synthetic_engine_failure"
    },
    warnings: ["external engine warning"]
  });
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async () => engineError
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.deepEqual(response, engineError);
});

void test("observability IPC external adapter maps transport failures to engine-unavailable errors", async () => {
  const request: ObservabilityIpcRequest<"trace.list"> = {
    id: "external-ipc-transport-failure",
    operation: "trace.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: DB_PATH
    },
    payload: {}
  };
  const transport: ObservabilityIpcExternalTransport = {
    exchange: async () => {
      throw new Error("synthetic transport failure");
    }
  };

  const response = await dispatchExternalObservabilityIpcRequest(transport, request);

  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }
  assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.engineUnavailable);
  assert.equal(response.error.details?.["operation"], "trace.list");
});
