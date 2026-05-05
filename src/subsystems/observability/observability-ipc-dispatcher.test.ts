import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createOstrichBenchmarkHistoryPort,
  createOstrichBenchmarkRunPort,
  createOstrichControlPlaneAuditPort,
  createOstrichLedgerPort,
  createOstrichObservabilityModule,
  createOstrichOptimizeMutationPort,
  createOstrichOptimizationHistoryPort,
  createOstrichOptimizationReportPort,
  createOstrichRetentionPort,
  createOstrichTraceMaintenancePort,
  createOstrichTraceQueryPort,
  defaultObservabilityModule
} from "./observability-module";
import { dispatchObservabilityIpcRequest } from "./observability-ipc-dispatcher";
import {
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityIpcRequest
} from "./observability-ipc-contract";
import { test } from "./observability.test-support";
import type { ObservabilityRuntimeHandle } from "./runtime-loader";
import { ObservabilityService } from "./service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import { seedSuccessfulRequest } from "./test-helpers";

const MISSING_DB_PATH = "/tmp/missing-observability-ipc-dispatcher.sqlite";

const missingStoreDeps = {
  open: () => null,
  openExisting: () => null,
  close: (_handle: ObservabilityRuntimeHandle | null) => {}
};

function createMissingStoreModule() {
  return createOstrichObservabilityModule({
    configure: () => {},
    bootstrap: () => {},
    pruneRetentionNow: () => {},
    getService: () => null,
    getDbPath: () => null,
    recordGatewayObservation: () => {},
    recordGatewayFailureObservation: () => {},
    shutdown: async () => {},
    trace: createOstrichTraceQueryPort(missingStoreDeps),
    traceMaintenance: createOstrichTraceMaintenancePort(missingStoreDeps),
    retention: createOstrichRetentionPort(missingStoreDeps),
    ledger: createOstrichLedgerPort(missingStoreDeps),
    controlPlaneAudit: createOstrichControlPlaneAuditPort(missingStoreDeps),
    benchmarkRuns: createOstrichBenchmarkRunPort(missingStoreDeps),
    benchmarkHistory: createOstrichBenchmarkHistoryPort(missingStoreDeps),
    optimizationReports: createOstrichOptimizationReportPort(missingStoreDeps),
    optimizeMutations: createOstrichOptimizeMutationPort(missingStoreDeps),
    optimizationHistory: createOstrichOptimizationHistoryPort(missingStoreDeps)
  });
}

void test("observability IPC dispatcher frames missing-store trace and ledger reads", async () => {
  const missingStoreModule = createMissingStoreModule();
  const traceListResponse = await dispatchObservabilityIpcRequest(missingStoreModule, {
    id: "ipc-missing-trace-list",
    operation: "trace.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: MISSING_DB_PATH
    },
    payload: {
      filters: {
        limit: 5
      }
    }
  });

  assert.equal(traceListResponse.ok, true);
  assert.deepEqual(traceListResponse, {
    id: "ipc-missing-trace-list",
    ok: true,
    result: {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      traces: []
    },
    warnings: []
  });

  const ledgerShowResponse = await dispatchObservabilityIpcRequest(missingStoreModule, {
    id: "ipc-missing-ledger-show",
    operation: "ledger.show",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: MISSING_DB_PATH
    },
    payload: {
      ledgerEventId: "ledger-missing"
    }
  });

  assert.equal(ledgerShowResponse.ok, true);
  assert.deepEqual(ledgerShowResponse, {
    id: "ipc-missing-ledger-show",
    ok: true,
    result: {
      dbPath: MISSING_DB_PATH,
      storeFound: false,
      event: null
    },
    warnings: []
  });
});

void test("observability IPC dispatcher rejects contract version mismatches", async () => {
  const request: ObservabilityIpcRequest<"trace.list"> = {
    id: "ipc-protocol-mismatch",
    operation: "trace.list",
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: MISSING_DB_PATH
    },
    payload: {}
  };

  const response = await dispatchObservabilityIpcRequest(defaultObservabilityModule, {
    ...request,
    contract_version: "observability-module-v0"
  });

  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }

  assert.equal(response.id, "ipc-protocol-mismatch");
  assert.equal(response.error.code, OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch);
  assert.equal(response.error.retryable, false);
  assert.deepEqual(response.warnings, []);
});

void test("observability IPC dispatcher frames seeded trace and Ledger reads", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-ipc-dispatcher-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const requestId = "req-ipc-dispatcher-seeded";
  const mutationTargetId = "route-ipc-dispatcher";
  let store = bootstrapObservabilityStore({ dbPath });

  try {
    const service = new ObservabilityService(store.db);
    seedSuccessfulRequest(service, requestId);
  } finally {
    closeObservabilityStore(store);
  }

  try {
    const traceShowResponse = await dispatchObservabilityIpcRequest(defaultObservabilityModule, {
      id: "ipc-seeded-trace-show",
      operation: "trace.show",
      contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
      store: {
        dbPath
      },
      payload: {
        traceId: requestId
      }
    });

    assert.equal(traceShowResponse.ok, true);
    assert.equal(traceShowResponse.result.storeFound, true);
    assert.equal(traceShowResponse.result.requestExecution?.request_id, requestId);
    assert.ok(traceShowResponse.result.observations.length > 0);

    const auditStartResponse = await dispatchObservabilityIpcRequest(defaultObservabilityModule, {
      id: "ipc-audit-start",
      operation: "controlPlaneAudit.startConfigMutation",
      contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
      store: {
        dbPath
      },
      payload: {
        sourceSurface: "cli",
        operation: "routes_update",
        targetKind: "route",
        targetId: mutationTargetId,
        createdBy: "switchmaxxer IPC dispatcher test",
        actorKind: "operator"
      }
    });

    assert.equal(auditStartResponse.ok, true);
    assert.equal(auditStartResponse.result.storeFound, true);
    assert.equal(typeof auditStartResponse.result.actionId, "string");

    const actionId = auditStartResponse.result.actionId;
    if (actionId === null) {
      throw new Error("Expected IPC dispatcher audit start to return an action id.");
    }

    const auditFinishResponse = await dispatchObservabilityIpcRequest(defaultObservabilityModule, {
      id: "ipc-audit-finish",
      operation: "controlPlaneAudit.finishConfigMutation",
      contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
      store: {
        dbPath
      },
      payload: {
        actionId,
        status: "succeeded",
        targetId: mutationTargetId
      }
    });

    assert.equal(auditFinishResponse.ok, true);
    assert.equal(auditFinishResponse.result.storeFound, true);

    const ledgerShowResponse = await dispatchObservabilityIpcRequest(defaultObservabilityModule, {
      id: "ipc-ledger-show",
      operation: "ledger.show",
      contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
      store: {
        dbPath
      },
      payload: {
        ledgerEventId: actionId
      }
    });

    assert.equal(ledgerShowResponse.ok, true);
    assert.equal(ledgerShowResponse.result.storeFound, true);
    assert.equal(ledgerShowResponse.result.event?.id, actionId);
    assert.equal(ledgerShowResponse.result.event?.status, "succeeded");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
