// Hot-path contract: status type.
//
// `HotPathStatus` is the snapshot of runtime state returned by
// `HotPath.status()`. It is read by smx for diagnostics
// (e.g., `smx gateway status`) and by the read-only control-plane GET
// at `/__switchmaxxer/runtime/config`.
//
// Status is a point-in-time view; it does not describe ongoing
// activity. For per-request events, see HotPathObservation.
//
// This file is contract-only: it has no runtime exports and depends on
// no other smx module.

export type HotPathFatalState =
  | { kind: "ok" }
  | { kind: "fatal"; reason: string; occurredAt: string };

export interface StreamingSlotsView {
  // Per-source-IP count of currently-active streaming slots.
  perIp: Record<string, number>;
  // Aggregate count across all source IPs.
  total: number;
}

export interface HotPathStatus {
  // Provenance of the snapshot the implementation is currently
  // serving.
  snapshotId: string;
  snapshotLoadedAt: string;
  processStartedAt: string;

  // Live counters.
  inFlightRequests: number;
  jsonParseSlotsInUse: number;
  streamingSlots: StreamingSlotsView;

  // True when the implementation is draining and not accepting new
  // connections.
  draining: boolean;

  // Backpressure / loss accounting since process start.
  observationDropCountTotal: number;
  // Backpressure / loss accounting since the previous status() call.
  // Implementations may approximate this with the value since the
  // most recent reset of an internal counter.
  observationDropCountSinceLastStatus: number;

  // Unrecoverable state, if any. health_handler returns 503 when this
  // is non-ok.
  fatalState: HotPathFatalState;
}
