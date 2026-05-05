import type { ObservationOutcome } from "../../types";
import { buildWhereClause, whereNonEmptyString, type WhereClauseCondition } from "./where-clause";

const DEFAULT_REQUEST_EXECUTION_BATCH_SIZE = 500;
const MAX_REQUEST_EXECUTION_BATCH_SIZE = 5_000;

export interface ListRequestExecutionOptions {
  routeId?: string;
  providerId?: string;
  outcome?: ObservationOutcome;
  limit?: number;
}

export function buildRequestExecutionListConditions(options: ListRequestExecutionOptions): WhereClauseCondition[] {
  return [
    whereNonEmptyString("(route_id = ? OR route_name = ?)", options.routeId, (routeId) => [routeId, routeId]),
    whereNonEmptyString("provider_id = ?", options.providerId),
    whereNonEmptyString("outcome = ?", options.outcome)
  ].filter((condition): condition is WhereClauseCondition => condition !== null);
}

export function buildRequestExecutionListQuery(options: ListRequestExecutionOptions): {
  whereClause: string;
  values: Array<string | number>;
} {
  return buildWhereClause(buildRequestExecutionListConditions(options));
}

export function normalizeRequestExecutionBatchSize(batchSize?: number): number {
  if (!Number.isFinite(batchSize) || typeof batchSize === "undefined") {
    return DEFAULT_REQUEST_EXECUTION_BATCH_SIZE;
  }

  return Math.max(1, Math.min(Math.trunc(batchSize), MAX_REQUEST_EXECUTION_BATCH_SIZE));
}

export function defaultRequestExecutionBatchSize(): number {
  return DEFAULT_REQUEST_EXECUTION_BATCH_SIZE;
}
