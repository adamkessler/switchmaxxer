import { safeErrorMessage } from "../../platform/logger";
import type { ObservabilityModule } from "./observability-module";
import {
  buildObservabilityIpcErrorResponse,
  buildObservabilityIpcSuccessResponse,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityIpcOperation,
  type ObservabilityIpcPayloadByOperation,
  type ObservabilityIpcRequest,
  type ObservabilityIpcResponse,
  type ObservabilityIpcResultByOperation
} from "./observability-ipc-contract";
import { validateObservabilityIpcRequest } from "./observability-ipc-validation";

type PayloadWithDbPath<T extends ObservabilityIpcOperation> =
  ObservabilityIpcPayloadByOperation[T] & { readonly dbPath: string };

function payloadWithDbPath<T extends ObservabilityIpcOperation>(
  request: ObservabilityIpcRequest<T>
): PayloadWithDbPath<T> {
  return {
    ...request.payload,
    dbPath: request.store.dbPath
  };
}

async function dispatchObservabilityIpcOperation<T extends ObservabilityIpcOperation>(
  observabilityModule: ObservabilityModule,
  request: ObservabilityIpcRequest<T>
): Promise<ObservabilityIpcResultByOperation[T]> {
  const payload = payloadWithDbPath(request);

  switch (request.operation) {
    case "trace.list":
      return observabilityModule.trace.list(payload as PayloadWithDbPath<"trace.list">) as ObservabilityIpcResultByOperation[T];
    case "trace.listObservations":
      return observabilityModule.trace.listObservations(
        payload as PayloadWithDbPath<"trace.listObservations">
      ) as ObservabilityIpcResultByOperation[T];
    case "trace.getStats":
      return observabilityModule.trace.getStats(
        payload as PayloadWithDbPath<"trace.getStats">
      ) as ObservabilityIpcResultByOperation[T];
    case "trace.show":
      return observabilityModule.trace.show(payload as PayloadWithDbPath<"trace.show">) as ObservabilityIpcResultByOperation[T];
    case "trace.verify":
      return observabilityModule.traceMaintenance.verify(
        payload as PayloadWithDbPath<"trace.verify">
      ) as ObservabilityIpcResultByOperation[T];
    case "trace.repair":
      return observabilityModule.traceMaintenance.repair(
        payload as PayloadWithDbPath<"trace.repair">
      ) as ObservabilityIpcResultByOperation[T];
    case "retention.pruneOlderThan":
      return observabilityModule.retention.pruneOlderThan(
        payload as PayloadWithDbPath<"retention.pruneOlderThan">
      ) as ObservabilityIpcResultByOperation[T];
    case "ledger.list":
      return observabilityModule.ledger.list(payload as PayloadWithDbPath<"ledger.list">) as ObservabilityIpcResultByOperation[T];
    case "ledger.show":
      return observabilityModule.ledger.show(payload as PayloadWithDbPath<"ledger.show">) as ObservabilityIpcResultByOperation[T];
    case "controlPlaneAudit.startConfigMutation":
      return observabilityModule.controlPlaneAudit.startConfigMutation(
        payload as PayloadWithDbPath<"controlPlaneAudit.startConfigMutation">
      ) as ObservabilityIpcResultByOperation[T];
    case "controlPlaneAudit.finishConfigMutation":
      return observabilityModule.controlPlaneAudit.finishConfigMutation(
        payload as PayloadWithDbPath<"controlPlaneAudit.finishConfigMutation">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkHistory.list":
      return observabilityModule.benchmarkHistory.list(
        payload as PayloadWithDbPath<"benchmarkHistory.list">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkHistory.show":
      return observabilityModule.benchmarkHistory.show(
        payload as PayloadWithDbPath<"benchmarkHistory.show">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkHistory.pruneOlderThan":
      return observabilityModule.benchmarkHistory.pruneOlderThan(
        payload as PayloadWithDbPath<"benchmarkHistory.pruneOlderThan">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkHistory.deleteRun":
      return observabilityModule.benchmarkHistory.deleteRun(
        payload as PayloadWithDbPath<"benchmarkHistory.deleteRun">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkHistory.clear":
      return observabilityModule.benchmarkHistory.clear(
        payload as PayloadWithDbPath<"benchmarkHistory.clear">
      ) as ObservabilityIpcResultByOperation[T];
    case "benchmarkRuns.run":
      return await observabilityModule.benchmarkRuns.run(
        payload as PayloadWithDbPath<"benchmarkRuns.run">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationHistory.list":
      return observabilityModule.optimizationHistory.list(
        payload as PayloadWithDbPath<"optimizationHistory.list">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationHistory.show":
      return observabilityModule.optimizationHistory.show(
        payload as PayloadWithDbPath<"optimizationHistory.show">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationHistory.pruneOlderThan":
      return observabilityModule.optimizationHistory.pruneOlderThan(
        payload as PayloadWithDbPath<"optimizationHistory.pruneOlderThan">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationHistory.deleteRun":
      return observabilityModule.optimizationHistory.deleteRun(
        payload as PayloadWithDbPath<"optimizationHistory.deleteRun">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationHistory.clear":
      return observabilityModule.optimizationHistory.clear(
        payload as PayloadWithDbPath<"optimizationHistory.clear">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationReports.persistCost":
      return observabilityModule.optimizationReports.persistCost(
        payload as PayloadWithDbPath<"optimizationReports.persistCost">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizationReports.persistLatency":
      return observabilityModule.optimizationReports.persistLatency(
        payload as PayloadWithDbPath<"optimizationReports.persistLatency">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizeMutations.apply":
      return observabilityModule.optimizeMutations.apply(
        payload as PayloadWithDbPath<"optimizeMutations.apply">
      ) as ObservabilityIpcResultByOperation[T];
    case "optimizeMutations.restore":
      return observabilityModule.optimizeMutations.restore(
        payload as PayloadWithDbPath<"optimizeMutations.restore">
      ) as ObservabilityIpcResultByOperation[T];
    default: {
      const exhaustive: never = request.operation;
      return exhaustive;
    }
  }
}

export async function dispatchObservabilityIpcRequest<T extends ObservabilityIpcOperation>(
  observabilityModule: ObservabilityModule,
  requestFrame: ObservabilityIpcRequest<T>
): Promise<ObservabilityIpcResponse<T>> {
  const validation = validateObservabilityIpcRequest(requestFrame);
  if (!validation.ok) {
    return buildObservabilityIpcErrorResponse({
      id: validation.error.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
      message: validation.error.message,
      details: validation.error.details
    });
  }

  const request = validation.request as ObservabilityIpcRequest<T>;

  try {
    const result = await dispatchObservabilityIpcOperation(observabilityModule, request);
    return buildObservabilityIpcSuccessResponse(request, result);
  } catch (error) {
    return buildObservabilityIpcErrorResponse({
      id: request.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
      message: safeErrorMessage(error),
      details: {
        operation: request.operation
      }
    });
  }
}
