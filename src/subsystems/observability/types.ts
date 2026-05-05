export const OBSERVATION_KINDS = [
  "debug",
  "measurement",
  "usage",
  "cost",
  "benchmark",
  "optimization",
  "system",
  "error"
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export const OBSERVATION_EVENTS = [
  "debug_ingress",
  "debug_route_resolution",
  "debug_upstream_request",
  "debug_upstream_retry",
  "debug_response_path",
  "debug_client_response",
  "debug_error_context",
  "request_received",
  "route_resolved",
  "upstream_request_started",
  "upstream_response_started",
  "upstream_response_completed",
  "client_response_started",
  "client_response_completed",
  "usage_counted",
  "cost_estimated",
  "benchmark_sample_attached",
  "optimization_inputs_recorded",
  "inspection_secret_reveal_requested",
  "rate_limited",
  "auth_failed",
  "auth_rate_limited"
] as const;

export type ObservationEvent = (typeof OBSERVATION_EVENTS)[number];

export const OBSERVATION_STAGES = [
  "ingress",
  "route_resolution",
  "listener_compatibility",
  "request_shaping",
  "upstream_request",
  "upstream_fetch",
  "upstream_response",
  "response_translation",
  "response_stream",
  "client_response",
  "cost",
  "optimization"
] as const;

export type ObservationStage = (typeof OBSERVATION_STAGES)[number];

export const OBSERVATION_OUTCOMES = [
  "started",
  "in_progress",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
  "partial",
  "unknown"
] as const;

export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

export const MAX_OBSERVATION_MESSAGE_LENGTH = 4 * 1024;
export const OBSERVABILITY_MAX_JSON_BYTES = 64 * 1024;
export const OBSERVABILITY_MAX_JSON_NODE_COUNT = 4_096;
export const OBSERVABILITY_MAX_JSON_DEPTH = 32;

export type BenchmarkRunStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export interface ObservationRecord {
  id: string;
  observed_at: string;
  ingested_at?: string | null;
  request_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  surface: string;
  kind: ObservationKind;
  event: ObservationEvent;
  stage?: ObservationStage | null;
  severity?: string | null;
  outcome?: ObservationOutcome | null;
  route_id?: string | null;
  route_name?: string | null;
  model_id?: string | null;
  provider_id?: string | null;
  provider_model_id?: string | null;
  client_api_mode?: string | null;
  upstream_api_mode?: string | null;
  listener?: string | null;
  actor?: string | null;
  status_code?: number | null;
  latency_ms?: number | null;
  ttft_ms?: number | null;
  duration_ms?: number | null;
  request_bytes?: number | null;
  response_bytes?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_micros?: number | null;
  currency?: string | null;
  billing_source?: string | null;
  benchmark_run_id?: string | null;
  benchmark_case_id?: string | null;
  optimization_profile_id?: string | null;
  tags_json?: string | null;
  attributes_json?: string | null;
  attributes_truncated?: number;
  message?: string | null;
}

export function isObservationKind(value: unknown): value is ObservationKind {
  return typeof value === "string" && OBSERVATION_KINDS.includes(value as ObservationKind);
}

export function isObservationEvent(value: unknown): value is ObservationEvent {
  return typeof value === "string" && OBSERVATION_EVENTS.includes(value as ObservationEvent);
}

export function isObservationStage(value: unknown): value is ObservationStage {
  return typeof value === "string" && OBSERVATION_STAGES.includes(value as ObservationStage);
}

export function isObservationOutcome(value: unknown): value is ObservationOutcome {
  return typeof value === "string" && OBSERVATION_OUTCOMES.includes(value as ObservationOutcome);
}
