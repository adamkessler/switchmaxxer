# Tech Spec For Switchmaxxer Gateway

## Purpose

This document defines the Switchmaxxer gateway as a product and runtime
boundary.

Use it when:

- reasoning about the live HTTP server
- separating gateway concerns from CLI, MCP, and other control-plane concerns
- designing features that touch listener behavior, request translation, auth,
  observability, or runtime lifecycle
- grounding future optimization and architecture work in a shared model

For operator workflows and step-by-step usage, also see:

- [README.md](../../../README.md)
- [how-to-operate-the-switchmaxxer-gateway.md](../../how-to/how-to-operate-the-switchmaxxer-gateway.md)
- [tech-spec-for-api-modes.md](../../contracts/tech-spec-for-api-modes.md)

## Definition

The Switchmaxxer gateway is the long-running HTTP runtime that accepts client
LLM requests, resolves configured routes, applies provider transport policy and
auth, forwards requests upstream, and returns responses in the expected client
contract.

It is the primary data-plane component of Switchmaxxer.

## Non-Goals

The gateway is not responsible for being the full control plane.

The following capabilities are intentionally outside the gateway boundary:

- config mutation workflows
- top-level CLI dispatch
- MCP server transport and tool dispatch
- observability inspection and repair workflows
- benchmark report browsing
- operator help and documentation rendering

Those surfaces may inspect or control the gateway, but they are not the
gateway itself.

## Core Responsibilities

The gateway is responsible for:

- listening on the configured host and port
- accepting supported client-facing API surfaces
- authenticating inbound requests when inbound auth is enabled
- enforcing request trust-boundary protections
- enforcing a global fixed-window request rate limit
- enforcing failed-auth backoff keyed to the normalized source IP, without
  trusting forwarded-header claims from untrusted peers
- evicting failed-auth limiter entries under bounded cache pressure by
  preferring drained, non-blocked, and older eligible entries before active
  blocked entries
- resolving caller-selected routes
- mapping routes to models, providers, and exact upstream model ids
- applying upstream auth and provider policy
- translating between client and upstream API modes when needed
- handling buffered and streaming upstream responses
- emitting request-path logs and observability facts
- exposing minimal runtime inspection endpoints
- supporting safe reload and graceful shutdown behavior

## Supported Listener Surfaces

The gateway currently exposes these main HTTP endpoints:

- `GET /health`
- `GET /__switchmaxxer/runtime/config`
- `GET /__switchmaxxer/runtime/inspect/<inspection-id>`
- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`

### `GET /health`

Purpose:

- minimal liveness and readiness signal

Properties:

- intentionally lightweight
- intended for probes and quick checks
- authenticated by default when `inbound_api_key_env` is configured
- unauthenticated only when `allow_unauthenticated_gateway: true` disables
  gateway auth entirely or `allow_unauthenticated_health: true` explicitly
  allows local unauthenticated health probes
- intentionally non-identifying for unauthenticated callers
- returns non-200 when the process has entered a fatal runtime-integrity state
- protected by a very high coarse per-IP limiter so normal probes stay
  unaffected while unauthenticated floods get cheap `429` responses

### `GET /__switchmaxxer/runtime/config`

Purpose:

- authenticated runtime introspection endpoint

Properties:

- returns the active runtime snapshot view
- includes runtime lifecycle metadata such as `started_at`, `loaded_at`,
  reload state, and fatal state
- sanitizes operator-facing reload and fatal error strings before returning them
- exposes provider endpoint debug summaries rather than raw full endpoint URLs
- used by control-plane features such as reload confirmation and uptime

### `GET /__switchmaxxer/runtime/inspect/<inspection-id>`

Purpose:

- one-time authenticated retrieval of an ephemeral `smx invoke --inspect`
  capture

Properties:

- local runtime endpoint used by the CLI after a non-streaming inspected invoke
- inspection captures are requested with `x-switchmaxxer-inspect: 1`; the
  gateway allocates the inspection id and one-time read token, then returns them
  in `x-switchmaxxer-inspect-id` and `x-switchmaxxer-inspect-token`
- the runtime inspect read requires the matching
  `x-switchmaxxer-inspect-token` header before it consumes the capture
- returns the four-hop protocol capture for one request: client to
  Switchmaxxer, Switchmaxxer to provider, provider to Switchmaxxer, and
  Switchmaxxer to client
- masks secret-bearing headers unless the CLI explicitly requests
  `--include-secrets` and the gateway process is opted in with
  `SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`; upstream provider authorization
  remains redacted
- stores captures only in memory, expires them quickly with lazy and active
  pruning, and deletes each capture after it is read
- is not a logging surface and does not persist request or response bodies to
  the observability store

Trust assumption:

- local control-plane callers may construct the runtime-config probe target from
  trusted local config fields such as `bind_host` and `port`
- local control-plane probe responses are read with an explicit byte cap and
  parsed through the platform bounded JSON helper before their payloads are
  trusted
- this is acceptable in the current product model because local config mutation
  already implies trusted operator-level machine access
- this assumption would need to be revisited if config ever became remotely
  mutable or sync-driven

### `POST /v1/chat/completions`

Purpose:

- OpenAI-compatible client-facing listener

Properties:

- accepts OpenAI-style chat-completions requests
- does not require Switchmaxxer-specific inspection headers for ordinary model
  traffic; `x-switchmaxxer-inspect: 1` is an optional local-operator debug
  control, not a client compatibility requirement
- may forward nearly transparently to OpenAI-compatible upstreams
- may translate to Anthropic-style upstreams when the selected route uses
  `api_mode: "anthropic-messages"`

### `POST /anthropic/v1/messages`

Purpose:

- Anthropic-compatible client-facing listener

Properties:

- accepts Anthropic Messages requests
- does not require Switchmaxxer-specific inspection headers for ordinary model
  traffic; clients that cannot emit custom debug headers can still use this
  listener normally
- currently expects Anthropic-mode route/provider behavior
- is intended to preserve Anthropic semantics rather than behave like a generic
  compatibility wrapper

## Request Path Model

### Runtime Handler Ownership

The gateway runtime request handler is intentionally split by trust class.

- `runtime-request-handler.ts` is the small router and trust-policy wrapper. It
  parses the request target, classifies the route, enforces inbound auth,
  local-Host checks, unauthenticated browser-fetch defenses, and caller rate
  limits before dispatching.
- `data-plane-handler.ts` owns only LLM reverse-proxy traffic for
  `POST /v1/chat/completions` and `POST /anthropic/v1/messages`, plus the
  local inspection-capture request header used by debug invocations.
- `runtime-config-handler.ts` owns the redacted runtime config read view.
- `runtime-inspect-handler.ts` owns one-time inspection capture reads and the
  explicit secret-reveal opt-in checks.
- `health-handler.ts` owns only the minimal health payload and health-specific
  coarse rate limiter after the router has handled health auth policy.

The key invariant is that individual route handlers do not decide whether a
request has crossed the correct trust boundary. The wrapper does that once from
the route's trust class, then hands the request to a handler with a narrow
contract.

The gateway request path can be understood as these stages:

1. accept the incoming HTTP request
2. enforce inbound auth policy
3. enforce payload-size and parsed-JSON-shape bounds
4. determine the client-facing API mode from the listener surface
5. parse and validate the request body
6. resolve the requested route
7. resolve the route’s provider, model, and exact upstream model id
8. determine the upstream API mode from provider config
9. build and send the upstream request
10. stream or buffer the upstream response
11. translate response shape if client-facing and upstream modes differ
12. emit logs and observability facts
13. return the final client response

This model is the core of the gateway’s data-plane responsibility.

## Route Resolution Model

The gateway uses the caller’s selected model identifier to resolve a route.

A route determines:

- canonical model identity
- selected service provider
- exact upstream `provider_model_id`
- effective timeout
- effective cost metadata
- effective upstream API mode through the chosen provider

The route is therefore the stable invocation contract used by callers, even
though the provider and upstream model id may evolve behind it.

## API Mode Model

The gateway must reason about two API-mode values on a request path:

- `client_api_mode`
- `upstream_api_mode`

These may match or differ.

Examples:

- OpenAI client -> OpenAI upstream: near pass-through
- Anthropic client -> Anthropic upstream: near pass-through
- OpenAI client -> Anthropic upstream: translation required
- Anthropic client -> OpenAI upstream: translation required

This is why API mode is a gateway concern rather than merely a config field.

For the canonical API-mode model, see
[tech-spec-for-api-modes.md](../../contracts/tech-spec-for-api-modes.md).

## Authentication Model

### Inbound Authentication

Inbound gateway auth is optional and config-driven.

When enabled:

- endpoints require a configured token, including `/health` unless
  `allow_unauthenticated_health: true` is explicitly configured
- non-loopback listener binds such as `0.0.0.0` require the additional
  explicit `allow_remote_bind: true` opt-in and emit a startup warning
- wildcard listener binds such as `0.0.0.0` or `::` also require
  `allow_wildcard_bind: true` and emit a distinct all-interfaces warning
- accepted client headers include:
  - `Authorization: Bearer <token>`
  - `x-api-key: <token>`
- misconfiguration is treated as a fail-closed condition rather than silent
  auth disablement

When disabled intentionally for localhost-style operation:

- the mode is a development escape hatch; inbound auth remains the recommended
  default even on loopback
- Switchmaxxer only allows that mode on a loopback-style bind host such as
  `127.0.0.1`, `localhost`, or `::1`
- `allow_remote_bind: true` is rejected in this mode; remote bind always
  requires inbound auth
- unauthenticated requests must also target an allowed local `Host` value
- unauthenticated gateway proxy POSTs must include
  `Content-Type: application/json`; they must also include
  `X-Switchmaxxer-Local-Client: 1` unless
  `one_trusted_operator_boundary: true` is explicitly configured
- unauthenticated runtime control-plane GETs under
  `/__switchmaxxer/runtime/` must include `X-Switchmaxxer-Local-Client: 1`
  unless `one_trusted_operator_boundary: true` is explicitly configured, and
  must pass the same browser-origin and fetch-metadata gate before dispatch
- browser-originated cross-site signals such as hostile `Origin`,
  `Sec-Fetch-Site`, and `Sec-Fetch-Mode` values are rejected before proxying
  or runtime control-plane reads
- gateway path parsing uses a fixed internal base and does not build the
  request URL from the raw `Host` header; malformed `Host` values are handled
  only by the Host guard and are classified as `misdirected_request`
- malformed request targets are classified as `invalid_request`
- this is why the gateway cares about the difference between a narrow
  **loopback** host and a broader **private/local** host category

For a beginner-friendly explanation of how Switchmaxxer classifies loopback and
local-only hosts, see
[tech-spec-for-security.md](../../swe/tech-spec-for-security.md).

### Source IP And Rate-Limit Assumption

The gateway currently keys its failed-auth limiter and global request limiter
from the direct socket peer address.

Current assumption:

- client identity for rate-limit purposes is based on the accepted TCP peer,
  not on forwarded-header claims
- this is the correct security posture for the current local-first deployment
  model
- the gateway does **not** silently trust `X-Forwarded-For` or similar
  headers, because doing so would create an auth and rate-limit bypass for the
  stated direct-connection model

Operational consequence:

- when clients connect directly, limiter buckets track the real peer address
- when the gateway is placed behind a reverse proxy anyway, multiple clients
  may collapse into the proxy's socket address and therefore share one limiter
  bucket
- in that unsupported proxy shape, one abusive client can exhaust failed-auth
  or request budget for other clients behind the same proxy
- reverse proxy deployments must therefore enforce their own client-aware
  bucketing and abuse controls upstream rather than expecting the gateway to
  infer trusted client identity automatically
- the failed-auth limiter follows this same rule and keys on the connected
  socket peer address rather than `X-Forwarded-For` or similar headers

This is an explicit deployment assumption, not an accidental implementation
detail.

### Failed-Auth Limiter Entry Lifecycle

The failed-auth limiter exists to make repeated bad inbound gateway auth cheap
to reject and progressively harder to brute force.

Lifecycle:

- a source-IP entry is created when inbound token auth fails for that source
- each entry tracks its first-seen time, current fixed-window start, failure
  count, last failure, last touch, and any active blocked-until timestamp
- failures inside the active window increment the count
- once the source reaches the configured threshold, additional failed auth
  attempts return `429` with `Retry-After` until the computed backoff expires
- successful inbound auth removes the source-IP entry
- expired, non-blocked entries are pruned when the limiter is touched

Capacity policy:

- the limiter is bounded by `maxEntries`, defaulting to 10,000 source IPs
- capacity is enforced after a failure is recorded, so a new source cannot
  leave the map above the configured cap until the next request
- pruning first removes expired entries whose windows are drained and which
  are not actively blocked
- if the map is still over capacity, eviction prefers non-blocked entries over
  active blocked entries
- among equally eligible non-blocked entries, the oldest recent touch is
  evicted first so recently failing sources keep their accounting
- if every entry is actively blocked and the map is still over capacity, the
  entry closest to unblocking is evicted first, then the oldest touch and
  oldest first-seen time break ties

### Outbound Provider Authentication

Provider auth is applied according to provider config.

Preferred posture:

- use `api_key_env` where possible
- allow inline `api_key` only as an explicit configuration choice

The gateway must not leak provider-secret values through logs, JSON envelopes,
or runtime inspection surfaces.

## Caller Display Label Headers

The gateway accepts an optional caller display-label hint from inbound request
headers.

This is not an authentication surface. It is a request-attribution surface used
for logs and observability.

Current accepted headers are:

- `x-switchmaxxer-caller`
- `x-switchmaxxer-client`
- `x-client-name`

### Purpose

These headers let a caller attach a human-readable display label to a request so
downstream logs and persisted observations can attribute traffic to a named app,
workflow, or operator-facing client surface.

Examples:

- a local app can identify itself as `paperclip.ai`
- an agent runtime can identify itself as `hermes-agent`
- an operator integration can identify itself as `openclaw`

### Precedence

When more than one caller display-label header is present, the gateway resolves
one effective caller display label using this precedence order:

1. `x-switchmaxxer-caller`
2. `x-switchmaxxer-client`
3. `x-client-name`
4. socket remote address fallback

This means `x-switchmaxxer-caller` is the strongest explicit attribution
signal, while `x-client-name` is the weakest named hint.

### Normalization And Bounds

The caller display label is normalized at acquisition time before entering the
rest of the request path.

Current behavior:

- empty values are ignored
- control characters are replaced with spaces
- the final caller display label is bounded to 128 characters
- if no accepted caller display-label header is present, the gateway falls back to
  the socket remote address when available

This prevents unbounded or control-character-containing caller strings from
spilling into logs and observability.

### Security And Trust Model

These headers do not authenticate the caller.

They are trusted only as attribution hints from an already accepted inbound
request. A caller that can successfully reach the authenticated gateway can set
one of these header values and thereby influence the recorded caller display
label.

Therefore:

- treat these headers as operator-facing attribution metadata, not proof of
  identity
- do not use them as authorization signals
- do not treat them as cryptographically meaningful client identity
- do not use them as rate-limit keys; gateway request rate limiting is keyed by
  the trusted source IP plus the classified route trust class unless a future
  authenticated client-identity model is explicitly added

### Logging And Observability

The resolved caller display label is used by the request path for:

- request-path log attribution
- persisted observability actor/caller attribution

These headers therefore affect how traffic is labeled, searched, and reasoned
about in downstream operational tooling.

## Trust-Boundary Protections

The gateway sits at a trust boundary and must enforce defensive limits before
the request reaches the rest of the runtime.

Current concerns include:

- inbound auth enforcement
- max payload size
- bounded streaming lifetime and buffer growth
- parsed JSON size and depth limits
- provider endpoint policy
- timeout enforcement
- fail-closed handling of malformed input

These protections are part of the gateway contract, not optional extras.

## Provider Endpoint Policy

The gateway respects provider endpoint policy validated from config.

This includes:

- rejecting malformed provider URLs
- allowing only supported protocols
- rejecting URL userinfo in provider endpoints
- blocking insecure HTTP unless explicitly allowed
- blocking private, local, loopback, and link-local endpoints unless explicitly
  allowed
- rejecting ambiguous non-canonical numeric host notation such as integer,
  short-dotted, or hex-like IPv4 spellings
- resolving provider hostnames at request dispatch time and pinning the checked
  public address into the actual outbound socket connection when
  `allow_private_endpoints` is false

This policy exists to reduce accidental or malicious SSRF exposure in the
upstream transport layer.

## Streaming And Buffered Responses

The gateway supports both:

- buffered response handling
- streaming response handling

Buffered behavior is used when the upstream response is returned as a normal
JSON body.

Streaming behavior is used when the upstream response is returned as an event
stream or chunked output.

For Anthropic-style streaming, the gateway parses Server-Sent Events (SSE)
according to the WHATWG HTML Living Standard event-stream rules rather than
assuming LF-only framing. That includes accepting LF, CRLF, and CR line
endings in `text/event-stream` payloads.

The gateway is responsible for:

- preserving the correct client-facing streaming contract
- stripping or recomputing headers that would become invalid after translation
  or streaming adaptation
- avoiding cross-mode response corruption when translation is required

### Shared Request-Path Behavior

Both streaming and non-streaming gateway paths still share the same outer data-
plane model:

- they resolve the same route and provider state
- they apply the same provider endpoint policy and outbound auth rules
- they emit the same request-lifecycle observations such as request received,
  route resolved, upstream request started, upstream response started, and
  client response completion
- they preserve the same client-facing API-mode contract at the listener
  surface, even when translation is required
- they remain subject to the same inbound auth, request-size, and upstream
  timeout posture before response handling begins

Request-body ingress is also shared before the proxy surface sees any parsed
payload:

- the gateway reads the request body itself rather than handing raw request
  streams directly to proxy dispatch
- declared `Content-Length` is checked against `max_payload_size` when present
- actual streamed bytes are checked against `max_payload_size` while reading
- request-body idle timeout is enforced during body read
- parsed JSON is validated against the bounded JSON helper before route proxy
  code sees it
- the gateway relies on Node's HTTP parser for request framing and does not try
  to reinterpret `Content-Length` / `Transfer-Encoding` semantics itself

In other words, "streaming" versus "non-streaming" is not a different gateway.
It is a divergence inside one shared request pipeline after the upstream
response path has been established.

### Where The Paths Diverge

The main differences begin after the upstream response has started:

- non-streaming paths buffer the upstream body before returning or translating
  it
- streaming paths forward or translate incrementally as chunks arrive
- non-streaming paths are governed by a bounded buffered-body size ceiling
- streaming paths are governed by stream-specific limits such as idle timeout,
  absolute lifetime, per-event size, total streamed bytes, and minimum
  sustained byte rate
- streaming paths must also manage downstream disconnects, upstream abort
  propagation, and SSE framing/translation correctness in real time

This means the two paths share request-routing and trust-boundary logic, but
they differ materially in memory shape, timeout shape, and response-delivery
mechanics.

### Practical Rule Of Thumb

When reasoning about a gateway behavior:

- if the question is about auth, route resolution, provider policy, or request
  validation, the answer is usually shared by both paths
- if the question is about buffering, partial output, disconnect handling,
  event framing, or long-lived resource occupancy, the answer usually differs
  between streaming and non-streaming handling

## Proxy Module Boundaries

The proxy layer is intentionally split into a small coordination surface plus
specialized helper modules.

Current module ownership:

- [src/subsystems/hot-path/manatee/proxy/proxy.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy.ts)
  Coordinates request execution, selects the response path, preserves the
  public helper exports used by tests, and owns the route-test entrypoints.
- [src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts)
  Owns request-context creation, caller display-label resolution, header
  sanitation, provider header application, upstream transport dispatch, route
  validation, and buffered-response bookkeeping.
- [src/subsystems/hot-path/manatee/proxy/proxy-streaming.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-streaming.ts)
  Owns the streaming pumps, idle and lifetime enforcement, minimum-byte-rate
  monitoring, downstream backpressure handling, and streaming header
  preparation.
- [src/subsystems/hot-path/manatee/proxy/proxy-translation.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-translation.ts)
  Owns OpenAI<->Anthropic body translation, text normalization, and Anthropic
  SSE-to-OpenAI chunk translation.
- [src/subsystems/hot-path/manatee/proxy/proxy-error-classification.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-error-classification.ts)
  Owns client-facing upstream and response-delivery error classification,
  including limit-error types.
- [src/subsystems/hot-path/manatee/proxy/proxy-logging.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-logging.ts)
  Owns proxy-specific structured logging and log-field sanitization helpers.

This split is deliberate. A change in one area should usually stay within one
module:

- translation changes should not require editing stream-pump mechanics
- stream-limit changes should not require editing provider transport code
- client-facing error text changes should not require editing request-rewrite
  logic

The design goal is that `src/proxy/proxy.ts` remains a thin composition layer rather
than regressing into another all-in-one implementation file.

## Runtime Snapshot Model

The gateway operates from an active runtime snapshot rather than mutating live
request-serving state piecemeal.

A runtime snapshot includes:

- validated config
- derived read model
- lifecycle metadata such as `loaded_at`
- reload state
- fatal runtime-integrity state

Key properties:

- a request snapshots the active runtime at request start
- successful reload swaps in a new snapshot atomically
- failed reload preserves the last good snapshot
- host and port changes remain restart-required rather than hot-reloadable

## Reload Model

Reload is intended to be safe and observable.

Desired properties:

- reload does not partially apply config
- a failed reload does not poison the current serving snapshot
- reload success/failure is surfaced through runtime-config state
- operator surfaces can confirm whether a reload was adopted

Reload is a data-plane continuity feature, not just a control-plane convenience.

## Shutdown Model

Graceful shutdown should:

- stop accepting new work at the appropriate time
- give in-flight request-path work a bounded opportunity to finish
- flush or close observability resources predictably
- avoid hanging forever
- surface when shutdown required a forced fallback

Shutdown behavior is part of gateway correctness because it affects
observability integrity, operator trust, and service-manager behavior.

## Runtime Integrity Model

The gateway tracks process-integrity state.

Uncaught exceptions and unhandled promise rejections are not treated as
incidental. They are treated as signals that the process is no longer in a
fully trustworthy state.

Expected behavior:

- record the fatal state
- surface it through runtime config
- degrade `/health`
- begin graceful shutdown

This model is intentional: a gateway should fail clearly rather than continue
pretending to be healthy after a fatal integrity event.

## Observability Responsibilities

The gateway is not the full observability control plane, but it is responsible
for emitting request-path observability facts.

That includes:

- recording gateway-stage events
- recording request ids and timing boundaries
- attaching enough context for later trace and benchmark inspection
- doing so with bounded overhead and bounded failure modes

The gateway should not allow observability trouble to become an unbounded memory
or lifecycle problem.

## Control Plane Relationship

The CLI and MCP are control-plane surfaces that inspect and manage the gateway.

Examples:

- `smx gateway status`
- `smx gateway auth`
- `smx gateway runtime config`
- `smx gateway reload [--config <path>]`
- `smx invoke`
- `smx invoke --inspect`
- `smx bench --path gateway`
- `switchmaxxer mcp serve` tool calls for gateway inspection

These surfaces may:

- read gateway state
- trigger lifecycle actions
- test gateway reachability
- inspect one local non-streaming invoke protocol exchange

`gateway status` and MCP `gateway_status` surface redacted
`inbound_auth_state` so operators can tell whether inbound gateway auth is
enabled, explicitly disabled, or misconfigured without exposing the token.
`gateway auth` is a local-only focused diagnostic for install, incident, and
key-rotation workflows; it may report the configured env-var name and a short
token fingerprint, but never the token itself.

But they should not redefine the gateway contract independently. The gateway
remains the authoritative runtime boundary.

## Design Invariants

The following invariants should hold:

- the gateway is the data plane
- the CLI and MCP are control-plane surfaces
- route resolution is stable and explicit
- API mode is treated as a wire contract, not a vendor label
- auth failures fail closed
- trust-boundary protections are enforced before deep request processing
- reload is snapshot-based and safe
- fatal runtime-integrity failures are surfaced clearly
- observability emission is bounded and should not destabilize the runtime
- failed-auth limiter settings should be chosen with the worst shared source-IP
  case in mind, because one source IP is the unit of backoff accounting
- production files under `src/subsystems/gateway/` must not import from
  `src/subsystems/cli/`; CLI command composition owns CLI-facing gateway
  wiring and imports gateway runtime helpers instead

## Architectural Direction

Future work on the gateway should favor:

- clearer separation between transport, routing, translation, and lifecycle
- tighter spec-to-code alignment for listener contracts
- shared contract definitions across gateway, CLI, MCP, and observability
- explicit boundaries that make future performance or implementation changes
  easier without changing the gateway contract

The gateway should continue to evolve as a precise, well-bounded runtime
surface rather than as a catch-all place for control-plane behavior.

## Future Work: Explicit Trusted Proxy Mode

Reverse proxy support should not be added by implicitly honoring
`X-Forwarded-For`.

If Switchmaxxer ever gains first-class proxy support, it should be introduced
as an explicit trusted-proxy mode with a separate threat model.

Required properties for that future work:

- default behavior remains the current direct-socket trust model
- forwarded client IP handling is disabled unless the operator explicitly
  enables trusted-proxy mode
- trusted-proxy mode must require explicit proxy trust configuration, such as
  a `trusted_proxies` allowlist of proxy peer addresses or networks
- forwarded-header parsing must fail closed when the immediate peer is not a
  trusted proxy
- the trusted-proxy contract must name exactly which forwarded header or
  header chain is honored and how multi-hop proxy chains are normalized
- auth limiter, global limiter, and any source-IP-sensitive logic must all use
  the same normalized trusted-client identity rules
- reverse proxy deployments must be able to keep abuse bucketing upstream even
  when trusted-proxy mode is enabled, so gateway trust expansion stays opt-in
  and minimal
- trusted-proxy mode should be covered by dedicated integration tests that
  prove direct clients cannot spoof forwarded headers to escape auth or
  limiter boundaries
- operator docs must spell out the deployment and spoofing trade-offs clearly

In other words, future proxy support is a product feature with its own trust
boundary contract, not a small convenience tweak to current header handling.
