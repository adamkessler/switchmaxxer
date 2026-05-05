// Hot-path contract: snapshot type.
//
// `HotPathSnapshot` is the immutable bundle of fields any hot-path
// implementation needs at start() and at every reload(). It is the
// hot-path-relevant slice of the smx runtime configuration; smx
// produces it, and the hot path consumes it without further reaching
// into smx state.
//
// This file is contract-only: it has no runtime exports and depends on
// no other smx module. Implementations (Manatee in TypeScript, Fire
// Horse in Java, Rust Horse in Rust) all conform to this shape.
//
// See docs/subsystems/hot-path/manatee-implementation-plan.md (Phase 1) for
// design notes.

export type ApiMode = "openai-completions" | "anthropic-messages";
export type ApiSurface = "openai" | "anthropic";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type ModelIdFormat = "passthrough" | "creator/model";
export type TrustClass =
  | "health_probe"
  | "data_plane"
  | "control_plane_read"
  | "unknown";

export interface CostConfig {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// A non-secret reference to provider auth material. The raw bytes live
// in a separate materializer so a snapshot can be safely serialized
// (e.g., for status views) without leaking secrets.
export interface SecretRef {
  envVar: string | null;
  inlineMaterializerId: string | null;
}

export type InboundAuthKind =
  | "disabled_explicit"
  | "loopback_only"
  | "token";

export interface InboundAuthState {
  kind: InboundAuthKind;
  // For "token" mode: a SecretRef to the inbound bearer token. Never
  // the raw token. For other modes: null.
  tokenRef: SecretRef | null;
}

export interface FailedAuthLimitPolicy {
  failureBudget: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export interface DnsPinPolicy {
  enabled: boolean;
  cacheTtlMs: number;
}

export interface UpstreamTimeouts {
  connectMs: number;
  requestMs: number;
}

export interface ApiSurfaces {
  openai: boolean;
  anthropic: boolean;
}

export interface RedactionPolicy {
  // Field-name patterns whose values must be redacted before emission.
  redactFieldPatterns: string[];
  // Header-name patterns whose values must be redacted before
  // emission.
  redactHeaderPatterns: string[];
}

export interface CorsPolicy {
  allowedOrigins: string[];
  allowCredentials: boolean;
}

export interface UpstreamConfig {
  baseUrl: string;
  defaultHeaders: Record<string, string>;
  apiKeyRef: SecretRef;
  // The Anthropic version header to send when api_mode is
  // "anthropic-messages". Null for OpenAI-mode routes.
  anthropicVersion: string | null;
  // Whether the upstream may use private (RFC1918 / loopback /
  // link-local) addresses. Most providers should be false.
  allowPrivateEndpoints: boolean;
  upstreamModelIdFormat: ModelIdFormat;
}

export interface RouteEntry {
  // The dialect this route speaks upstream.
  apiMode: ApiMode;
  // Where and how to send the request.
  upstream: UpstreamConfig;
  // What to send to the provider as the model id (may differ from the
  // client-facing key in the routes map).
  upstreamModelId: string;
  // Optional, informational. Not used to gate.
  costConfig: CostConfig | null;
  // Per-route timeout overrides. Null fields fall back to snapshot
  // defaults.
  perRouteTimeouts: Partial<UpstreamTimeouts> | null;
}

export interface HotPathSnapshot {
  // Listener
  bindHost: string;
  port: number;
  maxConnections: number;
  apiSurfaces: ApiSurfaces;

  // Auth + rate limit
  inboundAuthState: InboundAuthState;
  failedAuthLimitPolicy: FailedAuthLimitPolicy;
  rateLimit: RateLimitConfig;

  // Concurrency caps. Applied via fail-fast semaphores; the hot path
  // never queues on these.
  jsonParseSlots: number;
  streamingSlotsPerIp: number;

  // Body limits
  bodySizeLimitBytes: number;
  bodyReadIdleTimeoutMs: number;
  bodyReadTotalTimeoutMs: number;

  // Upstream timeouts and streaming budgets
  upstreamConnectTimeoutMs: number;
  upstreamRequestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  streamLifetimeTimeoutMs: number;
  streamRateOfProgressBytesPerSec: number;
  streamMaxEventBytes: number;
  streamMaxTotalBytes: number;
  maxBufferedUpstreamResponseBytes: number;

  // DNS pinning posture
  dnsPinPolicy: DnsPinPolicy;

  // Routes, keyed by client-supplied model id.
  routes: Record<string, RouteEntry>;

  // Misc
  logLevel: LogLevel;
  redactionPolicy: RedactionPolicy;
  corsPolicy: CorsPolicy | null;

  // Identity / provenance
  processStartedAt: string;
  snapshotLoadedAt: string;
  snapshotId: string;
}
