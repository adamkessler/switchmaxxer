import { randomUUID } from "node:crypto";

import { safeJsonStringifyWithinBounds } from "../../platform/json-bounds";
import type { ProxyRequestContext, RouteConfig } from "../../platform/types";
import {
  OBSERVABILITY_MAX_JSON_BYTES,
  OBSERVABILITY_MAX_JSON_DEPTH,
  OBSERVABILITY_MAX_JSON_NODE_COUNT,
  type ObservationEvent,
  type ObservationOutcome,
  type ObservationRecord,
  type ObservationStage
} from "./types";

export interface GatewayObservationInput {
  context: ProxyRequestContext;
  kind: ObservationRecord["kind"];
  event: ObservationEvent;
  stage?: ObservationStage | null;
  route?: RouteConfig | null;
  outcome?: ObservationOutcome | null;
  status_code?: number | null;
  request_bytes?: number | null;
  response_bytes?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_micros?: number | null;
  currency?: string | null;
  attributes?: Record<string, unknown>;
  tags?: string[];
  message?: string | null;
  observedAt?: string;
}

function serializeJson(
  value: Record<string, unknown> | string[] | undefined,
  fieldName: "attributes" | "tags",
  options: { onMetadataDropped: (message: string) => void }
): {
  json: string | null;
  truncated: boolean;
} {
  if (typeof value === "undefined") {
    return {
      json: null,
      truncated: false
    };
  }

  try {
    return {
      json: safeJsonStringifyWithinBounds(value, {
        maxSerializedBytes: OBSERVABILITY_MAX_JSON_BYTES,
        maxNodeCount: OBSERVABILITY_MAX_JSON_NODE_COUNT,
        maxDepth: OBSERVABILITY_MAX_JSON_DEPTH
      }),
      truncated: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_observability_json_error");
    options.onMetadataDropped(
      `Dropped oversized gateway observability ${fieldName} metadata before persistence: ${message}`
    );
    return {
      json: null,
      truncated: true
    };
  }
}

function baseGatewayObservation(
  context: ProxyRequestContext,
  route?: RouteConfig | null
): Pick<
  ObservationRecord,
  | "request_id"
  | "route_id"
  | "route_name"
  | "provider_id"
  | "provider_model_id"
  | "client_api_mode"
  | "upstream_api_mode"
  | "listener"
  | "actor"
> {
  return {
    request_id: context.requestId,
    route_id: context.bareModel || null,
    route_name: context.bareModel || null,
    provider_id: route?.serviceProvider ?? null,
    provider_model_id: route?.model ?? null,
    client_api_mode: context.apiMode,
    upstream_api_mode: route?.api_mode ?? null,
    listener: context.apiMode,
    actor: context.caller
  };
}

export function buildGatewayObservationRecord(
  input: GatewayObservationInput,
  options: { onMetadataDropped: (message: string) => void }
): ObservationRecord {
  const serializedAttributes = serializeJson(input.attributes, "attributes", options);
  const serializedTags = serializeJson(input.tags, "tags", options);

  return {
    id: randomUUID(),
    observed_at: input.observedAt ?? new Date().toISOString(),
    surface: "gateway",
    kind: input.kind,
    event: input.event,
    stage: input.stage ?? null,
    outcome: input.outcome ?? null,
    status_code: input.status_code ?? null,
    request_bytes: input.request_bytes ?? null,
    response_bytes: input.response_bytes ?? null,
    input_tokens: input.input_tokens ?? null,
    output_tokens: input.output_tokens ?? null,
    total_tokens: input.total_tokens ?? null,
    estimated_cost_micros: input.estimated_cost_micros ?? null,
    currency: input.currency ?? null,
    attributes_json: serializedAttributes.json,
    attributes_truncated: serializedAttributes.truncated ? 1 : 0,
    tags_json: serializedTags.json,
    message: input.message ?? null,
    ...baseGatewayObservation(input.context, input.route)
  };
}
