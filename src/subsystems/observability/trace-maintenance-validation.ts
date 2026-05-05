export const TRACE_MAINTENANCE_SCOPE_MESSAGES = {
  conflictingScope: "Use either '<trace-id>' or '--all', not both",
  missingScope: "Provide '<trace-id>' or '--all'",
  batchSizeRequiresAll: "Flag '--batch-size' is only supported with '--all'"
} as const;

export type TraceMaintenanceScope = {
  traceId?: string;
  all: boolean;
  batchSize?: number;
};

export function validateTraceMaintenanceScope(
  scope: TraceMaintenanceScope
): (typeof TRACE_MAINTENANCE_SCOPE_MESSAGES)[keyof typeof TRACE_MAINTENANCE_SCOPE_MESSAGES] | null {
  if (scope.all && typeof scope.traceId !== "undefined") {
    return TRACE_MAINTENANCE_SCOPE_MESSAGES.conflictingScope;
  }

  if (!scope.all && typeof scope.traceId === "undefined") {
    return TRACE_MAINTENANCE_SCOPE_MESSAGES.missingScope;
  }

  if (!scope.all && typeof scope.batchSize !== "undefined") {
    return TRACE_MAINTENANCE_SCOPE_MESSAGES.batchSizeRequiresAll;
  }

  return null;
}
