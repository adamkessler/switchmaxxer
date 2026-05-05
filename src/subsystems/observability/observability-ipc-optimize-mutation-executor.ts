import { safeErrorMessage } from "../../platform/logger";
import {
  buildObservabilityIpcErrorResponse,
  buildObservabilityIpcSuccessResponse,
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityExternalOptimizeApplyCommand,
  type ObservabilityExternalOptimizeRestoreCommand,
  type ObservabilityIpcRequest,
  type ObservabilityIpcResponse,
  type ObservabilityIpcResultByOperation
} from "./observability-ipc-contract";
import {
  buildExternalOptimizeApplyCommandFromPlan,
  buildExternalOptimizeRestoreCommandFromPlan,
  type BuildExternalOptimizeMutationCommandOptions
} from "./observability-ipc-optimize-mutation-plan";
import {
  digestOptimizeMutationCommand,
  OptimizeMutationIdempotencyRepository,
  type OptimizeMutationIdempotencyOperation,
  type OptimizeMutationIdempotencyRecord
} from "./optimize-mutation-idempotency";
import type {
  ObservabilityModule,
  ObservabilityOptimizeApplyMutationResult,
  ObservabilityOptimizeRestoreMutationResult
} from "./observability-module";
import type { OptimizeMutationCompletionOptions } from "./optimize-orchestrator";

type ExternalOptimizeMutationOperation = "optimizeMutations.apply" | "optimizeMutations.restore";
type ExternalOptimizeMutationCommandByOperation<T extends ExternalOptimizeMutationOperation> =
  T extends "optimizeMutations.apply"
    ? ObservabilityExternalOptimizeApplyCommand
    : ObservabilityExternalOptimizeRestoreCommand;

export interface ExecuteExternalOptimizeMutationCommandOptions<T extends ExternalOptimizeMutationOperation> {
  readonly id: string;
  readonly dbPath: string;
  readonly operation: T;
  readonly command: ExternalOptimizeMutationCommandByOperation<T>;
  readonly repository: OptimizeMutationIdempotencyRepository;
  readonly nowIso: string;
  readonly execute: () => Promise<ObservabilityIpcResultByOperation[T]> | ObservabilityIpcResultByOperation[T];
}

type OptimizeApplyPortOptions = Parameters<ObservabilityModule["optimizeMutations"]["apply"]>[0];
type OptimizeRestorePortOptions = Parameters<ObservabilityModule["optimizeMutations"]["restore"]>[0];
type ExternalOptimizeMutationRuntime = Pick<ObservabilityModule, "optimizeMutations">;

export interface ExternalOptimizeMutationRuntimeDependencies {
  readonly observabilityModule: ExternalOptimizeMutationRuntime;
  readonly dbPath: string;
  readonly configPath: OptimizeApplyPortOptions["configPath"];
  readonly readModel: OptimizeApplyPortOptions["readModel"];
  readonly loadReadModel: OptimizeApplyPortOptions["loadReadModel"];
  readonly mutateConfigDocument: OptimizeApplyPortOptions["mutateConfigDocument"];
  readonly getMutableConfigSection: OptimizeApplyPortOptions["getMutableConfigSection"];
}

export type ExecuteExternalOptimizeApplyMutationAgainstModuleOptions =
  Omit<ExecuteExternalOptimizeMutationCommandOptions<"optimizeMutations.apply">, "operation" | "execute"> &
    ExternalOptimizeMutationRuntimeDependencies;

export type ExecuteExternalOptimizeRestoreMutationAgainstModuleOptions =
  Omit<ExecuteExternalOptimizeMutationCommandOptions<"optimizeMutations.restore">, "operation" | "execute"> &
    ExternalOptimizeMutationRuntimeDependencies;

export type ExecutePlannedExternalOptimizeMutationAgainstModuleOptions = {
  readonly id: string;
  readonly repository: OptimizeMutationIdempotencyRepository;
  readonly nowIso: string;
  readonly plan: BuildExternalOptimizeMutationCommandOptions;
} & ExternalOptimizeMutationRuntimeDependencies;

export type BeginPlannedExternalOptimizeApplyMutationAgainstModuleOptions = {
  readonly id: string;
  readonly repository: OptimizeMutationIdempotencyRepository;
  readonly nowIso: string;
  readonly plan: BuildExternalOptimizeMutationCommandOptions & {
    readonly command: Extract<BuildExternalOptimizeMutationCommandOptions["command"], { readonly command: "optimizeMutation.planApply" }>;
  };
} & ExternalOptimizeMutationRuntimeDependencies;

type PendingExternalOptimizeMutationCompletion<T extends ExternalOptimizeMutationOperation> = (
  completion: OptimizeMutationCompletionOptions,
  completedAtIso?: string
) => ObservabilityIpcResponse<T>;

type BeginExternalOptimizeMutationResponse<T extends ExternalOptimizeMutationOperation> =
  ObservabilityIpcResponse<T> & {
    readonly completeIdempotency?: PendingExternalOptimizeMutationCompletion<T>;
  };

export type PendingExternalOptimizeApplyMutationCompletion =
  PendingExternalOptimizeMutationCompletion<"optimizeMutations.apply">;

export type BeginPlannedExternalOptimizeApplyMutationResponse =
  BeginExternalOptimizeMutationResponse<"optimizeMutations.apply">;

export type BeginPlannedExternalOptimizeRestoreMutationAgainstModuleOptions = {
  readonly id: string;
  readonly repository: OptimizeMutationIdempotencyRepository;
  readonly nowIso: string;
  readonly plan: BuildExternalOptimizeMutationCommandOptions & {
    readonly command: Extract<BuildExternalOptimizeMutationCommandOptions["command"], { readonly command: "optimizeMutation.planRestore" }>;
  };
} & ExternalOptimizeMutationRuntimeDependencies;

export type PendingExternalOptimizeRestoreMutationCompletion =
  PendingExternalOptimizeMutationCompletion<"optimizeMutations.restore">;

export type BeginPlannedExternalOptimizeRestoreMutationResponse =
  BeginExternalOptimizeMutationResponse<"optimizeMutations.restore">;

function operationForIdempotency(operation: ExternalOptimizeMutationOperation): OptimizeMutationIdempotencyOperation {
  return operation;
}

function requestForExternalCommand<T extends ExternalOptimizeMutationOperation>(
  options: ExecuteExternalOptimizeMutationCommandOptions<T>
): ObservabilityIpcRequest<T> {
  return {
    id: options.id,
    operation: options.operation,
    contract_version: OBSERVABILITY_IPC_CONTRACT_VERSION,
    store: {
      dbPath: options.dbPath
    },
    payload: options.command as never
  };
}

function parseStoredResult<T extends ExternalOptimizeMutationOperation>(
  record: OptimizeMutationIdempotencyRecord
): ObservabilityIpcResultByOperation[T] {
  return JSON.parse(record.result_json) as ObservabilityIpcResultByOperation[T];
}

function parseStoredError(record: OptimizeMutationIdempotencyRecord): Record<string, unknown> {
  return JSON.parse(record.error_json) as Record<string, unknown>;
}

function storedErrorMessage(error: Record<string, unknown>, fallback: string): string {
  return typeof error["message"] === "string" && error["message"].trim().length > 0
    ? error["message"]
    : fallback;
}

function errorDetailsForRecord(record: OptimizeMutationIdempotencyRecord): Record<string, unknown> {
  return {
    idempotencyKey: record.idempotency_key,
    operation: record.operation,
    status: record.status,
    ...(record.control_plane_action_id === null ? {} : { controlPlaneActionId: record.control_plane_action_id })
  };
}

function metadataFromExternalCommand(
  command: ExternalOptimizeMutationCommandByOperation<ExternalOptimizeMutationOperation>
): Record<string, unknown> | undefined {
  return command.metadata === undefined ? undefined : { ...command.metadata };
}

function hasExternalCompletion(
  command: ExternalOptimizeMutationCommandByOperation<ExternalOptimizeMutationOperation>
): boolean {
  return command.completion !== undefined;
}

function completionFromExternalCommand(
  command: ExternalOptimizeMutationCommandByOperation<ExternalOptimizeMutationOperation>
): OptimizeMutationCompletionOptions | undefined {
  const completion = command.completion;
  if (completion === undefined) {
    return undefined;
  }

  return {
    ...(completion.reload === undefined
      ? {}
      : { reload: completion.reload as OptimizeMutationCompletionOptions["reload"] }),
    ...(completion.verification === undefined
      ? {}
      : { verification: completion.verification as OptimizeMutationCompletionOptions["verification"] }),
    ...(completion.warnings === undefined ? {} : { warnings: [...completion.warnings] }),
    ...(completion.includePostActionResult === undefined
      ? {}
      : { includePostActionResult: completion.includePostActionResult })
  };
}

function commonOptimizeMutationPortOptions(
  command: ExternalOptimizeMutationCommandByOperation<ExternalOptimizeMutationOperation>,
  deps: ExternalOptimizeMutationRuntimeDependencies,
  options: {
    readonly forceDeferLedgerCompletion?: boolean;
  } = {}
): Omit<
  OptimizeApplyPortOptions,
  "runId" | "targetRouteId"
> {
  return {
    dbPath: deps.dbPath,
    configPath: deps.configPath,
    readModel: deps.readModel,
    loadReadModel: deps.loadReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableConfigSection: deps.getMutableConfigSection,
    sourceSurface: command.sourceSurface,
    createdBy: command.createdBy,
    actorKind: command.actorKind,
    actorId: command.actorId,
    sessionId: command.sessionId,
    dryRun: command.dryRun,
    metadata: metadataFromExternalCommand(command),
    deferLedgerCompletion: options.forceDeferLedgerCompletion === true || hasExternalCompletion(command)
  };
}

export function buildExternalOptimizeApplyMutationPortOptions(
  command: ObservabilityExternalOptimizeApplyCommand,
  deps: ExternalOptimizeMutationRuntimeDependencies,
  options: {
    readonly forceDeferLedgerCompletion?: boolean;
  } = {}
): OptimizeApplyPortOptions {
  return {
    ...commonOptimizeMutationPortOptions(command, deps, options),
    runId: command.runId,
    targetRouteId: command.targetRouteId
  };
}

export function buildExternalOptimizeRestoreMutationPortOptions(
  command: ObservabilityExternalOptimizeRestoreCommand,
  deps: ExternalOptimizeMutationRuntimeDependencies,
  options: {
    readonly forceDeferLedgerCompletion?: boolean;
  } = {}
): OptimizeRestorePortOptions {
  return {
    ...commonOptimizeMutationPortOptions(command, deps, options),
    selector: typeof command.actionId === "string"
      ? {
          mode: "action",
          actionId: command.actionId
        }
      : {
          mode: "run_route",
          runId: command.runId,
          routeId: command.targetRouteId
        }
  };
}

function completeDeferredApplyResultForExternalCommand(
  command: ObservabilityExternalOptimizeApplyCommand,
  result: ObservabilityOptimizeApplyMutationResult
): ObservabilityOptimizeApplyMutationResult {
  if (!result.result?.ok || !result.result.deferred) {
    return result;
  }

  const { complete, ...deferredResult } = result.result;
  return {
    ...result,
    result: {
      ...deferredResult,
      deferred: false,
      view: complete(completionFromExternalCommand(command))
    }
  };
}

function completeDeferredRestoreResultForExternalCommand(
  command: ObservabilityExternalOptimizeRestoreCommand,
  result: ObservabilityOptimizeRestoreMutationResult
): ObservabilityOptimizeRestoreMutationResult {
  if (!result.result?.ok || !result.result.deferred) {
    return result;
  }

  const { complete, ...deferredResult } = result.result;
  return {
    ...result,
    result: {
      ...deferredResult,
      deferred: false,
      view: complete(completionFromExternalCommand(command))
    }
  };
}

export async function executeExternalOptimizeMutationCommand<T extends ExternalOptimizeMutationOperation>(
  options: ExecuteExternalOptimizeMutationCommandOptions<T>
): Promise<ObservabilityIpcResponse<T>> {
  const request = requestForExternalCommand(options);
  const commandDigest = digestOptimizeMutationCommand(options.command);
  const acceptResult = options.repository.accept({
    idempotencyKey: options.command.idempotencyKey,
    operation: operationForIdempotency(options.operation),
    commandDigest,
    nowIso: options.nowIso
  });

  switch (acceptResult.kind) {
    case "digest_mismatch":
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
        message: "External optimize mutation idempotency key was reused for a different command.",
        details: {
          ...errorDetailsForRecord(acceptResult.record),
          expectedDigest: acceptResult.record.command_digest,
          receivedDigest: commandDigest
        }
      });
    case "unknown_completion":
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.unknownCompletion,
        message: "External optimize mutation completion is unknown; inspect Ledger and optimize history before retrying.",
        details: errorDetailsForRecord(acceptResult.record)
      });
    case "replay_failed": {
      const error = parseStoredError(acceptResult.record);
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
        message: storedErrorMessage(error, "External optimize mutation previously failed."),
        details: {
          ...errorDetailsForRecord(acceptResult.record),
          previousError: error
        }
      });
    }
    case "replay_completed":
      return buildObservabilityIpcSuccessResponse(
        request,
        parseStoredResult<T>(acceptResult.record)
      );
    case "accepted":
      break;
    default: {
      const exhaustive: never = acceptResult;
      return exhaustive;
    }
  }

  try {
    const result = await options.execute();
    options.repository.complete(
      options.command.idempotencyKey,
      JSON.stringify(result),
      options.nowIso
    );
    return buildObservabilityIpcSuccessResponse(request, result);
  } catch (error) {
    const message = safeErrorMessage(error);
    options.repository.fail(
      options.command.idempotencyKey,
      JSON.stringify({
        code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
        message
      }),
      options.nowIso
    );
    return buildObservabilityIpcErrorResponse({
      id: options.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
      message,
      details: {
        idempotencyKey: options.command.idempotencyKey,
        operation: options.operation
      }
    });
  }
}

export async function executeExternalOptimizeApplyMutationAgainstModule(
  options: ExecuteExternalOptimizeApplyMutationAgainstModuleOptions
): Promise<ObservabilityIpcResponse<"optimizeMutations.apply">> {
  return executeExternalOptimizeMutationCommand({
    id: options.id,
    dbPath: options.dbPath,
    operation: "optimizeMutations.apply",
    command: options.command,
    repository: options.repository,
    nowIso: options.nowIso,
    execute: () => completeDeferredApplyResultForExternalCommand(
      options.command,
      options.observabilityModule.optimizeMutations.apply(
        buildExternalOptimizeApplyMutationPortOptions(options.command, options)
      )
    )
  });
}

export async function executeExternalOptimizeRestoreMutationAgainstModule(
  options: ExecuteExternalOptimizeRestoreMutationAgainstModuleOptions
): Promise<ObservabilityIpcResponse<"optimizeMutations.restore">> {
  return executeExternalOptimizeMutationCommand({
    id: options.id,
    dbPath: options.dbPath,
    operation: "optimizeMutations.restore",
    command: options.command,
    repository: options.repository,
    nowIso: options.nowIso,
    execute: () => completeDeferredRestoreResultForExternalCommand(
      options.command,
      options.observabilityModule.optimizeMutations.restore(
        buildExternalOptimizeRestoreMutationPortOptions(options.command, options)
      )
    )
  });
}

export async function executePlannedExternalOptimizeMutationAgainstModule(
  options: ExecutePlannedExternalOptimizeMutationAgainstModuleOptions
): Promise<ObservabilityIpcResponse<"optimizeMutations.apply" | "optimizeMutations.restore">> {
  if (options.plan.command.command === "optimizeMutation.planApply") {
    return executeExternalOptimizeApplyMutationAgainstModule({
      id: options.id,
      dbPath: options.dbPath,
      command: buildExternalOptimizeApplyCommandFromPlan({
        ...options.plan,
        command: options.plan.command
      }),
      repository: options.repository,
      nowIso: options.nowIso,
      observabilityModule: options.observabilityModule,
      configPath: options.configPath,
      readModel: options.readModel,
      loadReadModel: options.loadReadModel,
      mutateConfigDocument: options.mutateConfigDocument,
      getMutableConfigSection: options.getMutableConfigSection
    });
  }

  return executeExternalOptimizeRestoreMutationAgainstModule({
    id: options.id,
    dbPath: options.dbPath,
    command: buildExternalOptimizeRestoreCommandFromPlan({
      ...options.plan,
      command: options.plan.command
    }),
    repository: options.repository,
    nowIso: options.nowIso,
    observabilityModule: options.observabilityModule,
    configPath: options.configPath,
    readModel: options.readModel,
    loadReadModel: options.loadReadModel,
    mutateConfigDocument: options.mutateConfigDocument,
    getMutableConfigSection: options.getMutableConfigSection
  });
}

function beginExternalOptimizeMutationAgainstModule<T extends ExternalOptimizeMutationOperation>(
  options: Omit<ExecuteExternalOptimizeMutationCommandOptions<T>, "execute"> & {
    readonly execute: () => ObservabilityIpcResultByOperation[T];
    readonly completeDeferredResult: (
      result: ObservabilityIpcResultByOperation[T],
      completion: OptimizeMutationCompletionOptions
    ) => ObservabilityIpcResultByOperation[T];
  }
): BeginExternalOptimizeMutationResponse<T> {
  const request = requestForExternalCommand({
    id: options.id,
    dbPath: options.dbPath,
    operation: options.operation,
    command: options.command,
    repository: options.repository,
    nowIso: options.nowIso,
    execute: () => {
      throw new Error("beginExternalOptimizeMutationAgainstModule does not use this callback");
    }
  });
  const commandDigest = digestOptimizeMutationCommand(options.command);
  const acceptResult = options.repository.accept({
    idempotencyKey: options.command.idempotencyKey,
    operation: operationForIdempotency(options.operation),
    commandDigest,
    nowIso: options.nowIso
  });

  switch (acceptResult.kind) {
    case "digest_mismatch":
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
        message: "External optimize mutation idempotency key was reused for a different command.",
        details: {
          ...errorDetailsForRecord(acceptResult.record),
          expectedDigest: acceptResult.record.command_digest,
          receivedDigest: commandDigest
        }
      });
    case "unknown_completion":
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.unknownCompletion,
        message: "External optimize mutation completion is unknown; inspect Ledger and optimize history before retrying.",
        details: errorDetailsForRecord(acceptResult.record)
      });
    case "replay_failed": {
      const error = parseStoredError(acceptResult.record);
      return buildObservabilityIpcErrorResponse({
        id: options.id,
        code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
        message: storedErrorMessage(error, "External optimize mutation previously failed."),
        details: {
          ...errorDetailsForRecord(acceptResult.record),
          previousError: error
        }
      });
    }
    case "replay_completed":
      return buildObservabilityIpcSuccessResponse(
        request,
        parseStoredResult<T>(acceptResult.record)
      );
    case "accepted":
      break;
    default: {
      const exhaustive: never = acceptResult;
      return exhaustive;
    }
  }

  try {
    const result = options.execute();
    const mutationResult = result as {
      readonly result?: {
        readonly ok?: boolean;
        readonly deferred?: boolean;
      } | null;
    };
    if (!mutationResult.result?.ok || !mutationResult.result.deferred) {
      options.repository.complete(options.command.idempotencyKey, JSON.stringify(result), options.nowIso);
      return buildObservabilityIpcSuccessResponse(request, result);
    }

    const response = buildObservabilityIpcSuccessResponse(request, result);
    return {
      ...response,
      completeIdempotency: (completion, completedAtIso = options.nowIso) => {
        const completedResult = options.completeDeferredResult(result, completion);
        options.repository.complete(
          options.command.idempotencyKey,
          JSON.stringify(completedResult),
          completedAtIso
        );
        return buildObservabilityIpcSuccessResponse(request, completedResult);
      }
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    options.repository.fail(
      options.command.idempotencyKey,
      JSON.stringify({
        code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
        message
      }),
      options.nowIso
    );
    return buildObservabilityIpcErrorResponse({
      id: options.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.operationFailed,
      message,
      details: {
        idempotencyKey: options.command.idempotencyKey,
        operation: options.operation
      }
    });
  }
}

function completeDeferredApplyResultForCallerCompletion(
  result: ObservabilityOptimizeApplyMutationResult,
  completion: OptimizeMutationCompletionOptions
): ObservabilityOptimizeApplyMutationResult {
  if (!result.result?.ok || !result.result.deferred) {
    return result;
  }

  const { complete, ...deferredResult } = result.result;
  return {
    ...result,
    result: {
      ...deferredResult,
      deferred: false,
      view: complete(completion)
    }
  };
}

function completeDeferredRestoreResultForCallerCompletion(
  result: ObservabilityOptimizeRestoreMutationResult,
  completion: OptimizeMutationCompletionOptions
): ObservabilityOptimizeRestoreMutationResult {
  if (!result.result?.ok || !result.result.deferred) {
    return result;
  }

  const { complete, ...deferredResult } = result.result;
  return {
    ...result,
    result: {
      ...deferredResult,
      deferred: false,
      view: complete(completion)
    }
  };
}

export function beginPlannedExternalOptimizeApplyMutationAgainstModule(
  options: BeginPlannedExternalOptimizeApplyMutationAgainstModuleOptions
): BeginPlannedExternalOptimizeApplyMutationResponse {
  const command = buildExternalOptimizeApplyCommandFromPlan({
    ...options.plan,
    command: options.plan.command
  });
  return beginExternalOptimizeMutationAgainstModule({
    id: options.id,
    dbPath: options.dbPath,
    operation: "optimizeMutations.apply",
    command,
    repository: options.repository,
    nowIso: options.nowIso,
    execute: () => options.observabilityModule.optimizeMutations.apply(
      buildExternalOptimizeApplyMutationPortOptions(command, options, {
        forceDeferLedgerCompletion: true
      })
    ),
    completeDeferredResult: completeDeferredApplyResultForCallerCompletion
  });
}

export function beginPlannedExternalOptimizeRestoreMutationAgainstModule(
  options: BeginPlannedExternalOptimizeRestoreMutationAgainstModuleOptions
): BeginPlannedExternalOptimizeRestoreMutationResponse {
  const command = buildExternalOptimizeRestoreCommandFromPlan({
    ...options.plan,
    command: options.plan.command
  });
  return beginExternalOptimizeMutationAgainstModule({
    id: options.id,
    dbPath: options.dbPath,
    operation: "optimizeMutations.restore",
    command,
    repository: options.repository,
    nowIso: options.nowIso,
    execute: () => options.observabilityModule.optimizeMutations.restore(
      buildExternalOptimizeRestoreMutationPortOptions(command, options, {
        forceDeferLedgerCompletion: true
      })
    ),
    completeDeferredResult: completeDeferredRestoreResultForCallerCompletion
  });
}
