// Manatee: hot-path config slice.
//
// `HotPathConfigSlice` is the exact subset of smx's `AppConfig` that
// hot-path code reads on the per-request path. Annotating hot-path
// entry points with this type forces the TypeScript compiler to
// reject any future read of an `AppConfig` field that has not been
// explicitly added here. The result: the boundary between "fields
// the hot path uses" and "fields that belong to other smx subsystems"
// is enforced by the type system, not by convention.
//
// Why a slice type instead of the contract's `HotPathSnapshot`:
// `HotPathSnapshot` (in `../contract/hot-path-snapshot.ts`) is the
// idealized shape that future Manatee implementations — including
// out-of-process Fire Horse and Rust Horse — will receive at
// `start()` and `reload()`. Its field names and types are designed
// for portability and clarity; they are deliberately different from
// `AppConfig`'s existing field names (e.g.,
// `streamLifetimeTimeoutMs` vs `streamMaxLifetimeMs`,
// `inboundAuthState` vs `inboundApiKeyEnv`,
// `rateLimit.windowMs: number` vs `rateLimit.window: string`).
//
// `HotPathConfigSlice` bridges that gap during the prep phases. When
// the Manatee class is extracted in Phase 6, smx will translate
// `AppConfig` into `HotPathSnapshot` once at startup and at every
// reload, and Manatee's internal code will read `HotPathSnapshot`
// directly. Until then, this slice is the read-scope contract for
// hot-path code.
//
// The list below tracks the actual fields read across the hot path.
// Adding a field to a hot-path read site requires adding it here
// first; that is the enforcement mechanism.

import type { AppConfig } from "../../../platform/types";

export type HotPathConfigSlice = Pick<AppConfig,
  // Listener
  | "bindHost"
  | "port"
  | "maxConnections"

  // Inbound auth
  | "inboundApiKeyEnv"
  | "allowUnauthenticatedGateway"
  | "allowUnauthenticatedHealth"
  | "oneTrustedOperatorBoundary"
  | "allowRemoteBind"
  | "allowWildcardBind"

  // Rate limit + concurrency caps
  | "rateLimit"
  | "maxConcurrentJsonParses"
  | "maxConcurrentStreamsPerIp"

  // Body limits
  | "maxPayloadSize"
  | "timeoutMs"

  // Streaming budgets
  | "streamIdleTimeoutMs"
  | "streamMaxLifetimeMs"
  | "streamMinBytesPerSecond"
  | "streamRateWindowMs"
  | "streamMaxEventBytes"
  | "streamMaxTotalBytes"
  | "maxBufferedUpstreamResponseBytes"

  // Routes
  | "routes"

  // Misc hot-path-touched fields
  | "shutdownTimeoutMs"
  | "systemdUnit"     // read by control-plane-on-data-port handler
  | "observability"   // retentionOlderThan check at reload
>;
