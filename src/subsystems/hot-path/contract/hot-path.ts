// Hot-path contract: the HotPath interface.
//
// Every hot-path implementation — Manatee (in-process TypeScript),
// FireHorseAdapter (out-of-process Java 21 child), RustHorseAdapter
// (out-of-process Rust child) — implements this interface. From smx's
// point of view, all three are objects that satisfy the same contract;
// the difference is whether method calls execute in-process or are
// serialized onto framed pipes to a child process.
//
// Three rules govern the interface so the wire derivation for
// out-of-process implementations is mechanical:
//
// 1. Plain-data parameters. HotPathSnapshot, HotPathStatus, and
//    HotPathObservation round-trip through JSON without information
//    loss. No class instances, no Buffer references, no callbacks in
//    payloads.
// 2. Async iteration over observations, not push-style listeners. An
//    AsyncIterable is straightforward to back with a stream of frames
//    over a pipe.
// 3. No back-references. An observation cannot carry a handle the
//    consumer can later call methods on. Use opaque IDs and explicit
//    methods if such a flow is needed.
//
// This file is contract-only: it has no runtime exports and depends on
// no other smx module beyond its sibling contract types.
//
// See docs/subsystems/hot-path/hypothetical-hot-path-module.md for design
// background and docs/subsystems/hot-path/manatee-implementation-plan.md for the
// rollout plan.

import type { HotPathSnapshot } from "./hot-path-snapshot";
import type { HotPathStatus } from "./hot-path-status";
import type { HotPathObservation } from "./hot-path-observation";

export interface HotPath {
  // Bind the listener and begin serving requests with the given
  // snapshot. Resolves once the listener is ready to accept
  // connections.
  start(snapshot: HotPathSnapshot): Promise<void>;

  // Atomically replace the current snapshot. In-flight requests
  // continue using the snapshot they captured at entry; new requests
  // see the replacement. Resolves once the replacement is in effect.
  reload(snapshot: HotPathSnapshot): Promise<void>;

  // Stop accepting new connections, allow up to `graceMs` for
  // in-flight requests to complete, then forcibly close. Resolves
  // when drain has finished (either gracefully or by timeout).
  drain(graceMs: number): Promise<void>;

  // Drain (with a default grace) and release the listener. Resolves
  // when the implementation has fully released its resources.
  shutdown(): Promise<void>;

  // Point-in-time view of runtime state.
  status(): Promise<HotPathStatus>;

  // Stream of structured events emitted during request processing.
  // The iterable yields HotPathObservation values until the
  // implementation shuts down. Backpressure-aware: if the consumer is
  // slow, the implementation may drop observations and signal via a
  // BackpressureSignalObservation rather than block the data plane.
  observations(): AsyncIterable<HotPathObservation>;
}
