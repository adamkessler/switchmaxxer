import assert from "node:assert/strict";
import test from "node:test";

import {
  inferGatewayFailureOutcome,
  normalizeGatewayFailureStage
} from "./gateway-failure-mapping";
import type { ObservationOutcome, ObservationStage } from "../../types";

void test("normalizeGatewayFailureStage maps gateway failure stages to canonical observation stages", () => {
  const cases: Array<{
    input: string;
    expected: ObservationStage;
  }> = [
    { input: "request_validation", expected: "ingress" },
    { input: "route_resolution", expected: "route_resolution" },
    { input: "listener_compatibility", expected: "listener_compatibility" },
    { input: "request_translation", expected: "request_shaping" },
    { input: "upstream_fetch", expected: "upstream_fetch" },
    { input: "response_upstream_status", expected: "upstream_response" },
    { input: "response_translation", expected: "response_translation" },
    { input: "response_stream", expected: "response_stream" },
    { input: "response_delivery", expected: "client_response" },
    { input: "client_response", expected: "client_response" },
    { input: "unknown_stage", expected: "client_response" }
  ];

  for (const { input, expected } of cases) {
    assert.equal(normalizeGatewayFailureStage(input), expected, input);
  }
});

void test("inferGatewayFailureOutcome maps rejection, timeout, cancellation, and generic failures", () => {
  const cases: Array<{
    stage: string;
    reason: string;
    expected: ObservationOutcome;
  }> = [
    { stage: "request_validation", reason: "invalid_json", expected: "rejected" },
    { stage: "route_resolution", reason: "provider_disabled", expected: "rejected" },
    { stage: "listener_compatibility", reason: "unsupported_surface", expected: "rejected" },
    { stage: "upstream_fetch", reason: "route_not_found", expected: "rejected" },
    { stage: "upstream_fetch", reason: "missing_model_field", expected: "rejected" },
    { stage: "upstream_fetch", reason: "upstream_timeout", expected: "timed_out" },
    { stage: "response_stream", reason: "client_abort_before_done", expected: "cancelled" },
    { stage: "response_stream", reason: "client_disconnect", expected: "cancelled" },
    { stage: "client_response", reason: "client_closed_socket", expected: "cancelled" },
    { stage: "response_translation", reason: "bad_upstream_payload", expected: "failed" }
  ];

  for (const { stage, reason, expected } of cases) {
    assert.equal(inferGatewayFailureOutcome(stage, reason), expected, `${stage}:${reason}`);
  }
});
