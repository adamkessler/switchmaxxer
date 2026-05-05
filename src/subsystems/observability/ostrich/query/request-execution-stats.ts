import type { ObservationOutcome } from "../../types";
import type { RequestExecutionStats } from "./request-executions";
import { buildWhereClause, type BuiltWhereClause, type WhereClauseCondition } from "./where-clause";

export type RequestExecutionSummaryRow = {
  total_count?: number;
  partial_output_count?: number | null;
  average_gateway_residency_ms?: number | null;
  average_upstream_ttft_ms?: number | null;
  average_upstream_duration_ms?: number | null;
};

const FAILING_REQUEST_EXECUTION_OUTCOMES: readonly ObservationOutcome[] = [
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
  "partial"
] as const;

const FAILING_REQUEST_EXECUTION_OUTCOME_PLACEHOLDERS = FAILING_REQUEST_EXECUTION_OUTCOMES.map(() => "?").join(", ");

export function buildFailingRequestExecutionsWhereClause(
  conditions: readonly WhereClauseCondition[]
): BuiltWhereClause {
  return buildWhereClause([
    ...conditions,
    {
      clause: `outcome IN (${FAILING_REQUEST_EXECUTION_OUTCOME_PLACEHOLDERS})`,
      values: FAILING_REQUEST_EXECUTION_OUTCOMES
    }
  ]);
}

export function toRequestExecutionStats(input: {
  summary?: RequestExecutionSummaryRow;
  outcomeCounts: Array<{ outcome: ObservationOutcome; count: number }>;
  topFailingRoutes: Array<{ route: string; count: number }>;
}): RequestExecutionStats {
  const { summary, outcomeCounts, topFailingRoutes } = input;

  return {
    total_count: summary?.total_count ?? 0,
    partial_output_count: summary?.partial_output_count ?? 0,
    average_gateway_residency_ms:
      typeof summary?.average_gateway_residency_ms === "number" ? summary.average_gateway_residency_ms : null,
    average_upstream_ttft_ms:
      typeof summary?.average_upstream_ttft_ms === "number" ? summary.average_upstream_ttft_ms : null,
    average_upstream_duration_ms:
      typeof summary?.average_upstream_duration_ms === "number" ? summary.average_upstream_duration_ms : null,
    outcome_counts: outcomeCounts,
    top_failing_routes: topFailingRoutes
  };
}
