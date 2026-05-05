// Hot-path contract: observation event types.
//
// `HotPathObservation` is the discriminated union over every event the
// hot path may emit during request processing. The contract's
// observation channel — an AsyncIterable for in-process Manatee, an
// fd 3 framed pipe for out-of-process implementations — carries
// values of this shape.
//
// The variants here are deliberately coarser than the existing
// gateway observation system's (`kind` × `event` × `stage` × `outcome`
// matrix). The translation between this discriminated union and the
// existing observability ledger record format lives in the
// `emitObservation` helper that Phase 3 of the implementation plan
// introduces. Each variant carries enough information for the helper
// to produce a faithful ledger entry; variants will be refined in
// Phase 3 as the actual emit sites are migrated.
//
// This file is contract-only: it has no runtime exports and depends on
// no other smx module.
//
// See docs/subsystems/hot-path/manatee-implementation-plan.md (Phase 1) for
// design notes.

import type { ApiMode, ApiSurface, TrustClass } from "./hot-path-snapshot";

export type HotPathObservation =
  | RequestStartedObservation
  | RequestCompletedObservation
  | UpstreamErrorObservation
  | RateLimitDecisionObservation
  | AuthDecisionObservation
  | InvokeInspectionCapturedObservation
  | ConfigSnapshotAppliedObservation
  | SnapshotReloadFailedObservation
  | BackpressureSignalObservation;

export interface RequestStartedObservation {
  kind: "request_started";
  requestId: string;
  method: string;
  pathname: string;
  sourceIp: string;
  trustClass: TrustClass;
  receivedAt: string;
}

export interface RequestCompletedObservation {
  kind: "request_completed";
  requestId: string;
  status: number;
  latencyMs: number;
  // The route key (model id) used to resolve the upstream, when
  // applicable.
  routeKey: string | null;
  // The dialect the inbound listener spoke.
  clientApiMode: ApiMode | null;
  // The dialect the upstream provider spoke.
  upstreamApiMode: ApiMode | null;
  upstreamRequestId: string | null;
  bytesIn: number;
  bytesOut: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostMicros: number | null;
  // Marker for streamed responses; helpful when downstream consumers
  // want to distinguish buffered from streaming success metrics.
  streamed: boolean;
}

export type UpstreamErrorClass =
  | "network"
  | "timeout"
  | "upstream_4xx"
  | "upstream_5xx"
  | "malformed_response"
  | "translation_error"
  | "policy_violation"
  | "unknown";

export interface UpstreamErrorObservation {
  kind: "upstream_error";
  requestId: string;
  routeKey: string | null;
  errorClass: UpstreamErrorClass;
  upstreamStatus: number | null;
  message: string;
  retriable: boolean;
}

export type RateLimitDecisionOutcome =
  | "allowed"
  | "denied_request_rate"
  | "denied_streaming_slots"
  | "denied_json_parse_slots";

export interface RateLimitDecisionObservation {
  kind: "rate_limit_decision";
  requestId: string;
  sourceIp: string;
  trustClass: TrustClass;
  outcome: RateLimitDecisionOutcome;
  remaining: number;
  retryAfterSeconds: number | null;
}

export type AuthDecisionOutcome =
  | "allowed"
  | "denied_no_token"
  | "denied_bad_token"
  | "denied_loopback_only"
  | "denied_unauthenticated_browser"
  | "denied_misdirected_host"
  | "denied_rate_limited";

export interface AuthDecisionObservation {
  kind: "auth_decision";
  requestId: string;
  sourceIp: string;
  method: string;
  pathname: string;
  outcome: AuthDecisionOutcome;
  // True when the failed-auth limiter has been incremented for this
  // source IP.
  backoffApplied: boolean;
  retryAfterSeconds: number | null;
  // The HTTP status code returned to the client.
  statusCode: number;
  // Short machine-readable explanation, e.g., "unexpected_host". Null
  // when the outcome alone is sufficient.
  reason: string | null;
  // Human-readable summary; goes to the ledger and to logs.
  message: string;
}

export interface InvokeInspectionCapturedObservation {
  kind: "invoke_inspection_captured";
  requestId: string;
  inspectId: string;
  routeKey: string | null;
  // Whether secrets were captured (pending reveal-token gate at read
  // time). Never the secret values themselves.
  containsSecrets: boolean;
}

export interface ConfigSnapshotAppliedObservation {
  kind: "config_snapshot_applied";
  snapshotId: string;
  loadedAt: string;
  routeCount: number;
  apiSurfaces: ApiSurface[];
}

export interface SnapshotReloadFailedObservation {
  kind: "snapshot_reload_failed";
  attemptedSnapshotId: string | null;
  message: string;
}

export type BackpressureSignalSource =
  | "json_parse_slots"
  | "streaming_slots_per_ip"
  | "observation_buffer";

export interface BackpressureSignalObservation {
  kind: "backpressure_signal";
  source: BackpressureSignalSource;
  // Number of events / requests dropped or rejected since the previous
  // backpressure signal of the same source.
  droppedSinceLastSignal: number;
  // Optional source-IP scope when the signal applies per-IP.
  sourceIp: string | null;
}
