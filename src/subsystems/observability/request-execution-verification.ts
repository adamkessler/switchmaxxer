import type {
  RequestExecutionFieldMismatch,
  RequestExecutionRecord,
  RequestExecutionVerificationResult
} from "./request-executions";

const REQUEST_EXECUTION_FIELDS: Array<keyof RequestExecutionRecord> = [
  "id",
  "request_id",
  "started_at",
  "completed_at",
  "request_received_at",
  "route_resolved_at",
  "upstream_request_started_at",
  "upstream_response_started_at",
  "upstream_response_completed_at",
  "client_response_started_at",
  "client_response_completed_at",
  "route_id",
  "route_name",
  "model_id",
  "provider_id",
  "provider_model_id",
  "client_api_mode",
  "upstream_api_mode",
  "status_code",
  "outcome",
  "failure_stage",
  "failure_reason",
  "observation_count",
  "latency_ms",
  "ttft_ms",
  "duration_ms",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "estimated_cost_micros",
  "currency",
  "switchmaxxer_pre_upstream_ms",
  "upstream_ttft_ms",
  "upstream_duration_ms",
  "switchmaxxer_post_upstream_ms",
  "client_write_ms",
  "gateway_residency_ms",
  "partial_output"
];

export function diffRequestExecutionRecords(
  expected: RequestExecutionRecord,
  actual: RequestExecutionRecord
): RequestExecutionFieldMismatch[] {
  const mismatches: RequestExecutionFieldMismatch[] = [];

  for (const field of REQUEST_EXECUTION_FIELDS) {
    if (expected[field] !== actual[field]) {
      mismatches.push({
        field,
        expected: expected[field] ?? null,
        actual: actual[field] ?? null
      });
    }
  }

  return mismatches;
}

export function createOrphanSummaryVerification(
  requestId: string,
  actual: RequestExecutionRecord
): RequestExecutionVerificationResult {
  return {
    request_id: requestId,
    status: "orphan_summary",
    observation_count: 0,
    mismatch_count: REQUEST_EXECUTION_FIELDS.length,
    mismatches: REQUEST_EXECUTION_FIELDS.map((field) => ({
      field,
      expected: null,
      actual: actual[field] ?? null
    }))
  };
}

export function createMissingSummaryVerification(
  requestId: string,
  observationCount: number,
  expected: RequestExecutionRecord | null
): RequestExecutionVerificationResult {
  return {
    request_id: requestId,
    status: "missing_summary",
    observation_count: observationCount,
    mismatch_count: expected ? REQUEST_EXECUTION_FIELDS.length : 0,
    mismatches: expected
      ? REQUEST_EXECUTION_FIELDS.map((field) => ({
          field,
          expected: expected[field] ?? null,
          actual: null
        }))
      : []
  };
}
