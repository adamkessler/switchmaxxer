import type { ObservabilityModule } from "./observability-module";

export const OBSERVABILITY_IPC_PROTOCOL_VERSION = "1" as const;
export const OBSERVABILITY_IPC_CONTRACT_VERSION = "observability-module-v1" as const;

export const OBSERVABILITY_IPC_ERROR_CODES = {
  engineUnavailable: "observability_engine_unavailable",
  protocolMismatch: "observability_protocol_mismatch",
  operationTimeout: "observability_operation_timeout",
  operationFailed: "observability_operation_failed",
  storeUnavailable: "observability_store_unavailable",
  unknownCompletion: "observability_unknown_completion"
} as const;

export type ObservabilityIpcErrorCode =
  (typeof OBSERVABILITY_IPC_ERROR_CODES)[keyof typeof OBSERVABILITY_IPC_ERROR_CODES];

export const OBSERVABILITY_IPC_OPERATIONS = [
  "trace.list",
  "trace.listObservations",
  "trace.getStats",
  "trace.show",
  "trace.verify",
  "trace.repair",
  "retention.pruneOlderThan",
  "ledger.list",
  "ledger.show",
  "controlPlaneAudit.startConfigMutation",
  "controlPlaneAudit.finishConfigMutation",
  "benchmarkHistory.list",
  "benchmarkHistory.show",
  "benchmarkHistory.pruneOlderThan",
  "benchmarkHistory.deleteRun",
  "benchmarkHistory.clear",
  "benchmarkRuns.run",
  "optimizationHistory.list",
  "optimizationHistory.show",
  "optimizationHistory.pruneOlderThan",
  "optimizationHistory.deleteRun",
  "optimizationHistory.clear",
  "optimizationReports.persistCost",
  "optimizationReports.persistLatency",
  "optimizeMutations.apply",
  "optimizeMutations.restore"
] as const;

export type ObservabilityIpcOperation = (typeof OBSERVABILITY_IPC_OPERATIONS)[number];

type MethodPayload<T> = T extends (options: infer Options) => unknown ? Omit<Options, "dbPath"> : never;
type MethodResult<T> = T extends (...args: never[]) => infer Result ? Awaited<Result> : never;

export interface ObservabilityIpcStoreRef {
  readonly dbPath: string;
}

export type ObservabilityIpcJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ObservabilityIpcJsonValue[]
  | { readonly [key: string]: ObservabilityIpcJsonValue };

export interface ObservabilityExternalOptimizeMutationCatalogContext {
  readonly kind: "catalog_snapshot" | "narrowed_command_context";
  readonly catalogRevision?: string | null;
  readonly document?: { readonly [key: string]: ObservabilityIpcJsonValue };
  readonly targetRoute?: { readonly [key: string]: ObservabilityIpcJsonValue };
  readonly winningRoute?: { readonly [key: string]: ObservabilityIpcJsonValue };
  readonly restorePoint?: { readonly [key: string]: ObservabilityIpcJsonValue };
  readonly providerAuth?: { readonly [key: string]: ObservabilityIpcJsonValue };
}

export interface ObservabilityExternalOptimizeMutationCompletion {
  readonly reload?: { readonly [key: string]: ObservabilityIpcJsonValue } | null;
  readonly verification?: { readonly [key: string]: ObservabilityIpcJsonValue } | null;
  readonly warnings?: readonly string[];
  readonly includePostActionResult?: boolean;
}

export interface ObservabilityExternalOptimizeMutationCommandBase {
  readonly idempotencyKey: string;
  readonly dryRun: boolean;
  readonly reload: boolean;
  readonly verify: boolean;
  readonly createdBy: string;
  readonly sourceSurface: "cli" | "mcp";
  readonly actorKind: "operator" | "agent";
  readonly actorId?: string | null;
  readonly sessionId?: string | null;
  readonly metadata?: { readonly [key: string]: ObservabilityIpcJsonValue };
  readonly catalog: ObservabilityExternalOptimizeMutationCatalogContext;
  readonly completion?: ObservabilityExternalOptimizeMutationCompletion;
}

export interface ObservabilityExternalOptimizeApplyCommand extends ObservabilityExternalOptimizeMutationCommandBase {
  readonly runId: string;
  readonly targetRouteId: string;
}

export type ObservabilityExternalOptimizeRestoreCommand =
  | (ObservabilityExternalOptimizeMutationCommandBase & {
      readonly actionId: string;
      readonly runId?: never;
      readonly targetRouteId?: never;
    })
  | (ObservabilityExternalOptimizeMutationCommandBase & {
      readonly runId: string;
      readonly targetRouteId: string;
      readonly actionId?: never;
    });

export interface ObservabilityIpcPayloadByOperation {
  readonly "trace.list": MethodPayload<ObservabilityModule["trace"]["list"]>;
  readonly "trace.listObservations": MethodPayload<ObservabilityModule["trace"]["listObservations"]>;
  readonly "trace.getStats": MethodPayload<ObservabilityModule["trace"]["getStats"]>;
  readonly "trace.show": MethodPayload<ObservabilityModule["trace"]["show"]>;
  readonly "trace.verify": MethodPayload<ObservabilityModule["traceMaintenance"]["verify"]>;
  readonly "trace.repair": MethodPayload<ObservabilityModule["traceMaintenance"]["repair"]>;
  readonly "retention.pruneOlderThan": MethodPayload<ObservabilityModule["retention"]["pruneOlderThan"]>;
  readonly "ledger.list": MethodPayload<ObservabilityModule["ledger"]["list"]>;
  readonly "ledger.show": MethodPayload<ObservabilityModule["ledger"]["show"]>;
  readonly "controlPlaneAudit.startConfigMutation": MethodPayload<
    ObservabilityModule["controlPlaneAudit"]["startConfigMutation"]
  >;
  readonly "controlPlaneAudit.finishConfigMutation": MethodPayload<
    ObservabilityModule["controlPlaneAudit"]["finishConfigMutation"]
  >;
  readonly "benchmarkHistory.list": MethodPayload<ObservabilityModule["benchmarkHistory"]["list"]>;
  readonly "benchmarkHistory.show": MethodPayload<ObservabilityModule["benchmarkHistory"]["show"]>;
  readonly "benchmarkHistory.pruneOlderThan": MethodPayload<ObservabilityModule["benchmarkHistory"]["pruneOlderThan"]>;
  readonly "benchmarkHistory.deleteRun": MethodPayload<ObservabilityModule["benchmarkHistory"]["deleteRun"]>;
  readonly "benchmarkHistory.clear": MethodPayload<ObservabilityModule["benchmarkHistory"]["clear"]>;
  readonly "benchmarkRuns.run": MethodPayload<ObservabilityModule["benchmarkRuns"]["run"]>;
  readonly "optimizationHistory.list": MethodPayload<ObservabilityModule["optimizationHistory"]["list"]>;
  readonly "optimizationHistory.show": MethodPayload<ObservabilityModule["optimizationHistory"]["show"]>;
  readonly "optimizationHistory.pruneOlderThan": MethodPayload<
    ObservabilityModule["optimizationHistory"]["pruneOlderThan"]
  >;
  readonly "optimizationHistory.deleteRun": MethodPayload<ObservabilityModule["optimizationHistory"]["deleteRun"]>;
  readonly "optimizationHistory.clear": MethodPayload<ObservabilityModule["optimizationHistory"]["clear"]>;
  readonly "optimizationReports.persistCost": MethodPayload<ObservabilityModule["optimizationReports"]["persistCost"]>;
  readonly "optimizationReports.persistLatency": MethodPayload<
    ObservabilityModule["optimizationReports"]["persistLatency"]
  >;
  readonly "optimizeMutations.apply": MethodPayload<ObservabilityModule["optimizeMutations"]["apply"]>;
  readonly "optimizeMutations.restore": MethodPayload<ObservabilityModule["optimizeMutations"]["restore"]>;
}

export interface ObservabilityIpcResultByOperation {
  readonly "trace.list": MethodResult<ObservabilityModule["trace"]["list"]>;
  readonly "trace.listObservations": MethodResult<ObservabilityModule["trace"]["listObservations"]>;
  readonly "trace.getStats": MethodResult<ObservabilityModule["trace"]["getStats"]>;
  readonly "trace.show": MethodResult<ObservabilityModule["trace"]["show"]>;
  readonly "trace.verify": MethodResult<ObservabilityModule["traceMaintenance"]["verify"]>;
  readonly "trace.repair": MethodResult<ObservabilityModule["traceMaintenance"]["repair"]>;
  readonly "retention.pruneOlderThan": MethodResult<ObservabilityModule["retention"]["pruneOlderThan"]>;
  readonly "ledger.list": MethodResult<ObservabilityModule["ledger"]["list"]>;
  readonly "ledger.show": MethodResult<ObservabilityModule["ledger"]["show"]>;
  readonly "controlPlaneAudit.startConfigMutation": MethodResult<
    ObservabilityModule["controlPlaneAudit"]["startConfigMutation"]
  >;
  readonly "controlPlaneAudit.finishConfigMutation": MethodResult<
    ObservabilityModule["controlPlaneAudit"]["finishConfigMutation"]
  >;
  readonly "benchmarkHistory.list": MethodResult<ObservabilityModule["benchmarkHistory"]["list"]>;
  readonly "benchmarkHistory.show": MethodResult<ObservabilityModule["benchmarkHistory"]["show"]>;
  readonly "benchmarkHistory.pruneOlderThan": MethodResult<ObservabilityModule["benchmarkHistory"]["pruneOlderThan"]>;
  readonly "benchmarkHistory.deleteRun": MethodResult<ObservabilityModule["benchmarkHistory"]["deleteRun"]>;
  readonly "benchmarkHistory.clear": MethodResult<ObservabilityModule["benchmarkHistory"]["clear"]>;
  readonly "benchmarkRuns.run": MethodResult<ObservabilityModule["benchmarkRuns"]["run"]>;
  readonly "optimizationHistory.list": MethodResult<ObservabilityModule["optimizationHistory"]["list"]>;
  readonly "optimizationHistory.show": MethodResult<ObservabilityModule["optimizationHistory"]["show"]>;
  readonly "optimizationHistory.pruneOlderThan": MethodResult<
    ObservabilityModule["optimizationHistory"]["pruneOlderThan"]
  >;
  readonly "optimizationHistory.deleteRun": MethodResult<ObservabilityModule["optimizationHistory"]["deleteRun"]>;
  readonly "optimizationHistory.clear": MethodResult<ObservabilityModule["optimizationHistory"]["clear"]>;
  readonly "optimizationReports.persistCost": MethodResult<ObservabilityModule["optimizationReports"]["persistCost"]>;
  readonly "optimizationReports.persistLatency": MethodResult<
    ObservabilityModule["optimizationReports"]["persistLatency"]
  >;
  readonly "optimizeMutations.apply": MethodResult<ObservabilityModule["optimizeMutations"]["apply"]>;
  readonly "optimizeMutations.restore": MethodResult<ObservabilityModule["optimizeMutations"]["restore"]>;
}

export type ObservabilityIpcRequest<T extends ObservabilityIpcOperation = ObservabilityIpcOperation> = {
  readonly [Operation in T]: {
    readonly id: string;
    readonly operation: Operation;
    readonly contract_version: string;
    readonly store: ObservabilityIpcStoreRef;
    readonly payload: ObservabilityIpcPayloadByOperation[Operation];
  };
}[T];

export type ObservabilityIpcSuccessResponse<T extends ObservabilityIpcOperation = ObservabilityIpcOperation> = {
  readonly [Operation in T]: {
    readonly id: string;
    readonly ok: true;
    readonly result: ObservabilityIpcResultByOperation[Operation];
    readonly warnings: readonly string[];
  };
}[T];

export interface ObservabilityIpcErrorResponse {
  readonly id: string;
  readonly ok: false;
  readonly error: {
    readonly code: ObservabilityIpcErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
  };
  readonly warnings: readonly string[];
}

export type ObservabilityIpcResponse<T extends ObservabilityIpcOperation = ObservabilityIpcOperation> =
  | ObservabilityIpcSuccessResponse<T>
  | ObservabilityIpcErrorResponse;

export function isObservabilityIpcOperation(value: unknown): value is ObservabilityIpcOperation {
  return typeof value === "string" && OBSERVABILITY_IPC_OPERATIONS.includes(value as ObservabilityIpcOperation);
}

export function buildObservabilityIpcSuccessResponse<T extends ObservabilityIpcOperation>(
  request: ObservabilityIpcRequest<T>,
  result: ObservabilityIpcResultByOperation[T],
  warnings: readonly string[] = []
): ObservabilityIpcSuccessResponse<T> {
  return {
    id: request.id,
    ok: true,
    result,
    warnings
  } as ObservabilityIpcSuccessResponse<T>;
}

export function buildObservabilityIpcErrorResponse(options: {
  id: string;
  code: ObservabilityIpcErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  warnings?: readonly string[];
}): ObservabilityIpcErrorResponse {
  return {
    id: options.id,
    ok: false,
    error: {
      code: options.code,
      message: options.message,
      retryable: options.retryable ?? false,
      ...(options.details ? { details: options.details } : {})
    },
    warnings: options.warnings ?? []
  };
}
