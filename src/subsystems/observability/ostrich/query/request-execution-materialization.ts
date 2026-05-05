import { redactSensitiveText } from "../../../../platform/logger";
import { parseJsonObjectWithWarning } from "../../json-parse";
import type { ObservationEvent, ObservationOutcome, ObservationRecord } from "../../types";
import type { RequestExecutionRecord } from "./request-executions";

export function assertRequestScopedObservation(record: ObservationRecord): asserts record is ObservationRecord & {
  request_id: string;
  client_api_mode: string;
} {
  if (typeof record.request_id !== "string" || record.request_id.trim().length === 0) {
    throw new Error("Request execution materialization requires a request-scoped observation.");
  }

  if (typeof record.client_api_mode !== "string" || record.client_api_mode.trim().length === 0) {
    throw new Error("Request execution materialization requires 'client_api_mode'.");
  }
}

function isoDiffMs(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) {
    return null;
  }

  const start = Date.parse(startIso);
  const end = Date.parse(endIso);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return end - start;
}

function parseAttributesJson(record: ObservationRecord): {
  value: Record<string, unknown>;
  malformed: boolean;
} {
  const parsed = parseJsonObjectWithWarning(record.attributes_json, "observations.attributes_json");
  return {
    value: parsed.value,
    malformed: parsed.warnings.length > 0
  };
}

function sanitizePersistedObservationMessage(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return redactSensitiveText(value);
}

function chooseTerminalOutcome(record: ObservationRecord): ObservationOutcome | null {
  if (!record.outcome) {
    return null;
  }

  switch (record.outcome) {
    case "succeeded":
    case "failed":
    case "cancelled":
    case "timed_out":
    case "rejected":
    case "partial":
      return record.outcome;
    default:
      return null;
  }
}

function eventToMilestoneField(event: ObservationEvent): keyof RequestExecutionRecord | null {
  switch (event) {
    case "request_received":
      return "request_received_at";
    case "route_resolved":
      return "route_resolved_at";
    case "upstream_request_started":
      return "upstream_request_started_at";
    case "upstream_response_started":
      return "upstream_response_started_at";
    case "upstream_response_completed":
      return "upstream_response_completed_at";
    case "client_response_started":
      return "client_response_started_at";
    case "client_response_completed":
      return "client_response_completed_at";
    default:
      return null;
  }
}

function initialOutcomeForEvent(event: ObservationEvent, record: ObservationRecord): ObservationOutcome {
  const terminal = chooseTerminalOutcome(record);

  if (terminal) {
    return terminal;
  }

  if (event === "request_received") {
    return "started";
  }

  return "in_progress";
}

export function createInitialRequestExecution(record: ObservationRecord): RequestExecutionRecord {
  assertRequestScopedObservation(record);

  const milestoneField = eventToMilestoneField(record.event);
  const observedAt = record.observed_at;

  return {
    id: record.request_id,
    request_id: record.request_id,
    started_at: observedAt,
    completed_at: null,
    request_received_at: milestoneField === "request_received_at" ? observedAt : observedAt,
    route_resolved_at: milestoneField === "route_resolved_at" ? observedAt : null,
    upstream_request_started_at: milestoneField === "upstream_request_started_at" ? observedAt : null,
    upstream_response_started_at: milestoneField === "upstream_response_started_at" ? observedAt : null,
    upstream_response_completed_at: milestoneField === "upstream_response_completed_at" ? observedAt : null,
    client_response_started_at: milestoneField === "client_response_started_at" ? observedAt : null,
    client_response_completed_at: milestoneField === "client_response_completed_at" ? observedAt : null,
    route_id: record.route_id ?? null,
    route_name: record.route_name ?? null,
    model_id: record.model_id ?? null,
    provider_id: record.provider_id ?? null,
    provider_model_id: record.provider_model_id ?? null,
    client_api_mode: record.client_api_mode,
    upstream_api_mode: record.upstream_api_mode ?? null,
    status_code: record.status_code ?? null,
    outcome: initialOutcomeForEvent(record.event, record),
    failure_stage: null,
    failure_reason: null,
    observation_count: 0,
    latency_ms: null,
    ttft_ms: null,
    duration_ms: null,
    input_tokens: record.input_tokens ?? null,
    output_tokens: record.output_tokens ?? null,
    total_tokens: record.total_tokens ?? null,
    estimated_cost_micros: record.estimated_cost_micros ?? null,
    currency: record.currency ?? null,
    switchmaxxer_pre_upstream_ms: null,
    upstream_ttft_ms: null,
    upstream_duration_ms: null,
    switchmaxxer_post_upstream_ms: null,
    client_write_ms: null,
    gateway_residency_ms: null,
    partial_output: 0
  };
}

function mergeContext(target: RequestExecutionRecord, record: ObservationRecord): void {
  target.route_id = record.route_id ?? target.route_id;
  target.route_name = record.route_name ?? target.route_name;
  target.model_id = record.model_id ?? target.model_id;
  target.provider_id = record.provider_id ?? target.provider_id;
  target.provider_model_id = record.provider_model_id ?? target.provider_model_id;
  target.upstream_api_mode = record.upstream_api_mode ?? target.upstream_api_mode;
  target.status_code = record.status_code ?? target.status_code;
  target.input_tokens = record.input_tokens ?? target.input_tokens;
  target.output_tokens = record.output_tokens ?? target.output_tokens;
  target.total_tokens = record.total_tokens ?? target.total_tokens;
  target.estimated_cost_micros = record.estimated_cost_micros ?? target.estimated_cost_micros;
  target.currency = record.currency ?? target.currency;
}

export function applyObservationToExecution(
  target: RequestExecutionRecord,
  record: ObservationRecord,
  observationCount: number
): RequestExecutionRecord {
  mergeContext(target, record);
  target.observation_count = observationCount;
  const parsedAttributes =
    record.event === "debug_error_context" ||
    record.event === "client_response_started" ||
    record.event === "client_response_completed"
      ? parseAttributesJson(record)
      : null;

  const milestoneField = eventToMilestoneField(record.event);
  if (milestoneField && target[milestoneField] === null) {
    (target[milestoneField] as string | null) = record.observed_at;
  }

  const terminalOutcome = chooseTerminalOutcome(record);
  if (terminalOutcome) {
    target.outcome = terminalOutcome;
    target.completed_at = record.observed_at;
  } else if (target.outcome === "started" && record.event !== "request_received") {
    target.outcome = "in_progress";
  }

  if (record.event === "debug_error_context") {
    const reason =
      typeof parsedAttributes?.value["reason"] === "string"
        ? sanitizePersistedObservationMessage(parsedAttributes.value["reason"])
        : typeof record.message === "string"
          ? sanitizePersistedObservationMessage(record.message)
          : parsedAttributes?.malformed
            ? "invalid_attributes_json"
            : null;

    target.failure_stage = record.stage ?? target.failure_stage;
    target.failure_reason = reason ?? target.failure_reason;
    target.completed_at = record.observed_at;

    if (!terminalOutcome) {
      target.outcome = "failed";
    }
  }

  if (record.event === "client_response_completed" && !target.completed_at) {
    target.completed_at = record.observed_at;

    if (!terminalOutcome && !target.failure_stage) {
      target.outcome = "succeeded";
    }
  }

  if (record.event === "client_response_started" || record.event === "client_response_completed") {
    if (parsedAttributes?.malformed) {
      target.failure_reason = "invalid_attributes_json";
    }

    const partialOutput = parsedAttributes?.value["partial_output"];

    if (partialOutput === true || partialOutput === 1 || partialOutput === "true") {
      target.partial_output = 1;
    }
  }

  target.switchmaxxer_pre_upstream_ms = isoDiffMs(target.request_received_at, target.upstream_request_started_at);
  target.upstream_ttft_ms = isoDiffMs(target.upstream_request_started_at, target.upstream_response_started_at);
  target.upstream_duration_ms = isoDiffMs(
    target.upstream_request_started_at,
    target.upstream_response_completed_at
  );
  target.switchmaxxer_post_upstream_ms = isoDiffMs(
    target.upstream_response_started_at,
    target.client_response_started_at
  );
  target.client_write_ms = isoDiffMs(target.client_response_started_at, target.client_response_completed_at);
  target.gateway_residency_ms = isoDiffMs(target.request_received_at, target.client_response_completed_at);

  target.ttft_ms = target.upstream_ttft_ms;
  target.duration_ms = target.gateway_residency_ms;
  target.latency_ms = target.gateway_residency_ms;

  return target;
}
