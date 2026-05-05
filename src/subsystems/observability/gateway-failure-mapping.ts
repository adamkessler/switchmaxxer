import type { ObservationOutcome, ObservationStage } from "./types";

export function normalizeGatewayFailureStage(stage: string): ObservationStage {
  switch (stage) {
    case "request_validation":
      return "ingress";
    case "route_resolution":
      return "route_resolution";
    case "listener_compatibility":
      return "listener_compatibility";
    case "request_translation":
      return "request_shaping";
    case "upstream_fetch":
      return "upstream_fetch";
    case "response_upstream_status":
      return "upstream_response";
    case "response_translation":
      return "response_translation";
    case "response_stream":
      return "response_stream";
    case "response_delivery":
      return "client_response";
    case "client_response":
      return "client_response";
    default:
      return "client_response";
  }
}

export function inferGatewayFailureOutcome(stage: string, reason: string): ObservationOutcome {
  if (
    stage === "request_validation" ||
    stage === "route_resolution" ||
    stage === "listener_compatibility" ||
    reason === "route_not_found" ||
    reason === "missing_model_field"
  ) {
    return "rejected";
  }

  if (reason.includes("timeout")) {
    return "timed_out";
  }

  if (reason.includes("client_abort") || reason.includes("client_disconnect") || reason.includes("client_closed")) {
    return "cancelled";
  }

  return "failed";
}
