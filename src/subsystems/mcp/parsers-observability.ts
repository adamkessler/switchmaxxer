import type { ObservationEvent, ObservationKind, ObservationOutcome } from "../observability/types";
import {
  CONTROL_PLANE_ACTION_OPERATIONS,
  CONTROL_PLANE_ACTION_SOURCE_SURFACES,
  CONTROL_PLANE_ACTION_STATUSES,
  CONTROL_PLANE_ACTION_TARGET_KINDS,
  type ControlPlaneActionOperation,
  type ControlPlaneActionSourceSurface,
  type ControlPlaneActionStatus,
  type ControlPlaneActionTargetKind
} from "../observability/control-plane-actions";
import {
  PRUNE_OLDER_THAN_MESSAGE,
  validatePruneOlderThan
} from "../observability/prune-validation";
import { validateTraceMaintenanceScope } from "../observability/trace-maintenance-validation";
import {
  getOptionalObservationEvent,
  getOptionalObservationKind,
  getOptionalObservationOutcome,
  getOptionalBooleanField,
  getOptionalPositiveInteger,
  getOptionalString,
  parseToolArgs
} from "./parsers-shared";
import { invalidInputFieldError } from "./errors";

export type TraceListArgs = {
  routeId: string | undefined;
  providerId: string | undefined;
  outcome: ObservationOutcome | undefined;
  limit: number | undefined;
};

export type TraceShowArgs = {
  traceId: string;
};

export type TraceStatsArgs = {
  routeId: string | undefined;
  providerId: string | undefined;
  outcome: ObservationOutcome | undefined;
};

export type TraceObservationsArgs = {
  routeId: string | undefined;
  providerId: string | undefined;
  kind: ObservationKind | undefined;
  event: ObservationEvent | undefined;
  limit: number | undefined;
};

export type TraceVerifyArgs = {
  traceId: string | undefined;
  all: boolean;
  batchSize: number | undefined;
};

export type TraceRepairArgs = {
  traceId: string | undefined;
  all: boolean;
  batchSize: number | undefined;
};

export type PruneArgs = {
  olderThan: string | undefined;
};

export type LedgerListArgs = {
  routeId: string | undefined;
  targetId: string | undefined;
  targetKind: ControlPlaneActionTargetKind | undefined;
  operation: ControlPlaneActionOperation | undefined;
  status: ControlPlaneActionStatus | undefined;
  sourceSurface: ControlPlaneActionSourceSurface | undefined;
  sessionId: string | undefined;
  ownSession: boolean;
  optimizationRunId: string | undefined;
  mutationEventId: string | undefined;
  since: string | undefined;
  limit: number | undefined;
};

export type LedgerShowArgs = {
  ledgerEventId: string;
};

function getOptionalKnownValue<T extends string>(
  params: Record<string, unknown> | undefined,
  field: string,
  allowedValues: readonly T[]
): T | undefined {
  const value = getOptionalString(params, field);
  if (typeof value === "undefined") {
    return undefined;
  }

  if ((allowedValues as readonly string[]).includes(value)) {
    return value as T;
  }

  throw invalidInputFieldError(`field '${field}' must be one of: ${allowedValues.join(", ")}`);
}

export function parseTraceListArgs(params: unknown): TraceListArgs {
  return parseToolArgs(params, {
    toolName: "trace_list",
    allowedFields: ["route_id", "provider_id", "outcome", "limit"],
    validate: (objectParams) => ({
      routeId: getOptionalString(objectParams, "route_id"),
      providerId: getOptionalString(objectParams, "provider_id"),
      outcome: getOptionalObservationOutcome(objectParams, "outcome"),
      limit: getOptionalPositiveInteger(objectParams, "limit")
    })
  });
}

export function parseTraceShowArgs(params: unknown): TraceShowArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "trace_show",
    allowedFields: ["trace_id"],
    validate: (validatedParams) => validatedParams
  });
  const traceId = getOptionalString(objectParams, "trace_id");
  if (!traceId) {
    throw new Error("Tool 'trace_show' requires non-empty 'trace_id'.");
  }
  return { traceId };
}

export function parseTraceStatsArgs(params: unknown): TraceStatsArgs {
  return parseToolArgs(params, {
    toolName: "trace_stats",
    allowedFields: ["route_id", "provider_id", "outcome"],
    validate: (objectParams) => ({
      routeId: getOptionalString(objectParams, "route_id"),
      providerId: getOptionalString(objectParams, "provider_id"),
      outcome: getOptionalObservationOutcome(objectParams, "outcome")
    })
  });
}

export function parseTraceObservationsArgs(params: unknown): TraceObservationsArgs {
  return parseToolArgs(params, {
    toolName: "trace_observations",
    allowedFields: ["route_id", "provider_id", "kind", "event", "limit"],
    validate: (objectParams) => ({
      routeId: getOptionalString(objectParams, "route_id"),
      providerId: getOptionalString(objectParams, "provider_id"),
      kind: getOptionalObservationKind(objectParams, "kind"),
      event: getOptionalObservationEvent(objectParams, "event"),
      limit: getOptionalPositiveInteger(objectParams, "limit")
    })
  });
}

function parseTraceScopeArgs(
  params: unknown,
  toolName: "trace_verify" | "trace_repair"
): TraceVerifyArgs | TraceRepairArgs {
  const objectParams = parseToolArgs(params, {
    toolName,
    allowedFields: ["trace_id", "all", "batch_size"],
    validate: (validatedParams) => validatedParams
  });
  const traceId = getOptionalString(objectParams, "trace_id");
  const all = objectParams["all"] === true;
  const batchSize = getOptionalPositiveInteger(objectParams, "batch_size");
  const validationError = validateTraceMaintenanceScope({ traceId, all, batchSize });

  if (validationError) {
    throw invalidInputFieldError(validationError);
  }

  return {
    traceId,
    all,
    batchSize
  };
}

export function parseTraceVerifyArgs(params: unknown): TraceVerifyArgs {
  return parseTraceScopeArgs(params, "trace_verify");
}

export function parseTraceRepairArgs(params: unknown): TraceRepairArgs {
  return parseTraceScopeArgs(params, "trace_repair");
}

export function parsePruneArgs(params: unknown): PruneArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "prune",
    allowedFields: ["older_than"],
    validate: (validatedParams) => validatedParams
  });
  const olderThan = getOptionalString(objectParams, "older_than");
  const validationError = validatePruneOlderThan(olderThan);
  if (validationError) {
    throw invalidInputFieldError(`field 'older_than' must be a ${PRUNE_OLDER_THAN_MESSAGE}.`);
  }
  return { olderThan };
}

export function parseLedgerListArgs(params: unknown): LedgerListArgs {
  return parseToolArgs(params, {
    toolName: "ledger_list",
    allowedFields: [
      "route_id",
      "target_id",
      "target_kind",
      "operation",
      "status",
      "source_surface",
      "session_id",
      "own_session",
      "run_id",
      "mutation_event_id",
      "since",
      "limit"
    ],
    validate: (objectParams) => {
      const ownSession = getOptionalBooleanField(objectParams, "own_session") === true;
      const since = getOptionalString(objectParams, "since");
      if (typeof since === "string") {
        const validationError = validatePruneOlderThan(since);
        if (validationError) {
          throw invalidInputFieldError("field 'since' must be one of <number>m, <number>h, <number>d, or <number>w");
        }
      }

      return {
        routeId: getOptionalString(objectParams, "route_id"),
        targetId: getOptionalString(objectParams, "target_id"),
        targetKind: getOptionalKnownValue(objectParams, "target_kind", CONTROL_PLANE_ACTION_TARGET_KINDS),
        operation: getOptionalKnownValue(objectParams, "operation", CONTROL_PLANE_ACTION_OPERATIONS),
        status: getOptionalKnownValue(objectParams, "status", CONTROL_PLANE_ACTION_STATUSES),
        sourceSurface: getOptionalKnownValue(objectParams, "source_surface", CONTROL_PLANE_ACTION_SOURCE_SURFACES),
        sessionId: getOptionalString(objectParams, "session_id"),
        ownSession,
        optimizationRunId: getOptionalString(objectParams, "run_id"),
        mutationEventId: getOptionalString(objectParams, "mutation_event_id"),
        since,
        limit: getOptionalPositiveInteger(objectParams, "limit")
      };
    }
  });
}

export function parseLedgerShowArgs(params: unknown): LedgerShowArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "ledger_show",
    allowedFields: ["ledger_event_id"],
    validate: (validatedParams) => validatedParams
  });
  const ledgerEventId = getOptionalString(objectParams, "ledger_event_id");
  if (!ledgerEventId) {
    throw new Error("Tool 'ledger_show' requires non-empty 'ledger_event_id'.");
  }
  return { ledgerEventId };
}
