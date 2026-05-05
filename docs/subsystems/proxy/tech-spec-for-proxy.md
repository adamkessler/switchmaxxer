# Tech Spec For Proxy

## Purpose

This document defines the Switchmaxxer proxy subsystem: the code that actually
executes one LLM request through the gateway's hot path, from accepted inbound
request to delivered client response.

Use it when:

- reasoning about what happens to a single request once the gateway has
  validated, authenticated, and parsed it
- designing features that touch buffered or streaming upstream response
  handling, request/response translation, or upstream transport error shaping
- deciding which proxy submodule owns a given change
- grounding security review of the data-plane hot path

For the outer gateway runtime and listener contract, see:

- [tech-spec-for-gateway.md](../gateway/tech-spec-for-gateway.md)
- [tech-spec-for-api-modes.md](../../contracts/tech-spec-for-api-modes.md)
- [tech-spec-for-gateway-observation-mapping.md](../observability/tech-spec-for-gateway-observation-mapping.md)
- [tech-spec-for-security.md](../../swe/tech-spec-for-security.md)

## Definition

The proxy is the per-request execution engine invoked by the gateway after a
request has cleared ingress validation.

It is called by two gateway entry points:

- [`proxyChatCompletion`](../../../src/subsystems/proxy/proxy.ts) — OpenAI listener surface
- [`proxyAnthropicMessage`](../../../src/subsystems/proxy/proxy.ts) — Anthropic listener surface

And by the CLI route-test runtime via [`runRouteTestsDetailed`](../../../src/subsystems/proxy/proxy.ts).

The proxy owns everything that happens between "the gateway accepted and
validated this request" and "the client response has been delivered or
terminated."

## Non-Goals

The proxy is not responsible for:

- listener setup, binding, or shutdown
- inbound authentication
- global rate limiting
- request-body size or JSON-shape enforcement at ingress
- config loading, mutation, or validation
- MCP tool dispatch
- observability query, repair, or pruning

Those live upstream of the proxy (in the gateway or the control plane). The
proxy trusts that by the time it is invoked, the gateway has already enforced
its ingress posture.

## Core Responsibilities

The proxy is responsible for:

- creating a stable per-request context (request id, caller, bare model, api
  mode, start time)
- resolving the caller-selected route against the current config
- enforcing listener/route API-mode compatibility
- sanitizing and forwarding inbound headers
- applying outbound provider auth headers
- dispatching the upstream request through the provider transport with DNS
  pinning when applicable and automatic redirects disabled
- selecting buffered vs streaming response handling per request
- enforcing streaming-specific limits (idle, lifetime, min-byte-rate, per-event
  and total bytes)
- translating between client and upstream API shapes when they differ
- classifying upstream and response-delivery errors into client-facing error
  envelopes
- emitting request-lifecycle observations via the shared observability bridge
- preserving client backpressure and propagating client disconnects to the
  upstream transport

## Module Boundaries

The proxy is intentionally split into a thin composition layer plus specialized
helper modules. A change in one area should usually stay within one module.

### [src/subsystems/proxy/proxy.ts](../../../src/subsystems/proxy/proxy.ts)

Public barrel.

Owns:

- the stable public import surface for gateway, CLI route tests, and unit tests
- re-exporting the listener entry points from `proxy-openai.ts` and
  `proxy-anthropic.ts`
- re-exporting shared proxy types and selected helpers from `proxy-core.ts`

It does not own request execution behavior. New proxy behavior should land in
one of the implementation modules below and be re-exported from the barrel only
when another subsystem needs that API.

### [src/subsystems/proxy/proxy-openai.ts](../../../src/subsystems/proxy/proxy-openai.ts)

OpenAI-compatible listener composition.

Owns:

- the `proxyChatCompletion` entry point
- the OpenAI listener's `executeProxyRequest` options
- route listener validation through `validateListenerForRequest`
- same-mode OpenAI body patching via `buildPatchedJsonBody`
- OpenAI-to-Anthropic request translation via
  `buildAnthropicRequestBodyFromOpenAi`
- OpenAI-client response handling via `handleUpstreamResponseForOpenAiClient`

### [src/subsystems/proxy/proxy-anthropic.ts](../../../src/subsystems/proxy/proxy-anthropic.ts)

Anthropic-compatible listener composition.

Owns:

- the `proxyAnthropicMessage` entry point
- the Anthropic listener's `executeProxyRequest` options
- route listener validation through `validateListenerForRequest`
- Anthropic body patching via `buildPatchedJsonBody`
- Anthropic-client response handling via
  `handleUpstreamResponseForAnthropicClient`

### [src/subsystems/proxy/proxy-core.ts](../../../src/subsystems/proxy/proxy-core.ts)

Shared request pipeline.

Owns:

- the shared `executeProxyRequest` pipeline that binds the submodules together
  per request
- per-request context creation, route resolution, ingress logging, and common
  route-state validation
- invoking listener-specific body builders and response handlers
- request header sanitation and provider auth application through
  `proxy-headers.ts`
- buffered-vs-streaming upstream dispatch selection
- client-facing fetch/response-delivery error classification

### [src/subsystems/proxy/proxy-forwarding.ts](../../../src/subsystems/proxy/proxy-forwarding.ts)

Outbound transport, route checks, and lifecycle bookkeeping.

Owns:

- the buffered and streaming upstream dispatch wrappers
  (`forwardUpstreamRequest`, `forwardStreamingUpstreamRequest`) that run the
  pinned-DNS provider endpoint policy check before handing off to
  `http-transport`
- per-request context creation (`createContext`) and untrusted caller display
  label resolution (`getCallerDisplayLabel`)
- route resolution against current config (`resolveRoute`)
- listener/route-mode compatibility enforcement
  (`validateCommonRouteState`, `validateListenerForRequest`)
- request-lifecycle observation emitters
- the buffered response send path (`sendBufferedResponse`)
- the shared `sendJsonError` client error writer

### [src/subsystems/proxy/proxy-headers.ts](../../../src/subsystems/proxy/proxy-headers.ts)

Header trust-boundary helpers.

Owns:

- inbound header sanitation for upstream forwarding (`sanitizeIncomingHeaders`)
- outbound provider auth header shaping (`applyProviderHeaders`)
- response header copy with hop-by-hop, cookie, and auth-like header stripping
  (`copyResponseHeaders`, `copyBufferedResponseHeaders`)
- debug-log header redaction (`sanitizeHeadersForLogging`)

Request and response header hardening should be reviewed in this module.

### [src/subsystems/proxy/proxy-response-handlers.ts](../../../src/subsystems/proxy/proxy-response-handlers.ts)

Client response path selection.

Owns:

- OpenAI-client response handling (`handleUpstreamResponseForOpenAiClient`)
- Anthropic-client response handling
  (`handleUpstreamResponseForAnthropicClient`)
- upstream error buffering before streaming branches
- buffered-vs-streaming response-path selection
- same-mode passthrough vs cross-mode translation selection
- Anthropic response body buffering and `translateAnthropicResponse`
  invocation

Transport retry policy for upstream `POST` requests is intentionally
conservative:

- a `POST` that already received an upstream HTTP response status is not
  retried automatically
- this includes upstream `502`, `503`, and `504` responses, because once
  headers exist the provider may already have started model work
- `POST` requests do not retry pre-response transport failures by default
- generic transport callers may opt into a bounded pre-response `POST` retry by
  setting `retry.maxRetries`, or by supplying an `Idempotency-Key` header when
  that key is known to be honored by the upstream
- the gateway proxy path sets `retry.maxRetries = 0` because forwarded
  `Idempotency-Key` headers are not provider-verified at the gateway boundary
- when a retry does occur, the retry callback includes retry policy,
  idempotency-key presence, and duplicate-risk metadata; the gateway persists
  that as `debug_upstream_retry` when observability is enabled

This is deliberate. LLM completions are not assumed idempotent, and automatic
replay after upstream work may have started can duplicate billing or output.

### [src/subsystems/proxy/proxy-streaming.ts](../../../src/subsystems/proxy/proxy-streaming.ts)

Streaming response mechanics.

Owns:

- the OpenAI-to-OpenAI streaming pump (`pipeOpenAiStreamingResponse`)
- the Anthropic-to-OpenAI streaming translation pump
  (`pipeAnthropicStreamingToOpenAi`)
- streaming response header preparation (`prepareStreamingResponseHeaders`)
- idle timeout, lifetime timeout, min-bytes-per-second, per-event, and
  total-bytes streaming limits
- downstream write backpressure awaited via `drain` events
- client-disconnect detection and upstream abort propagation via
  `AbortController`
- abort-reason resolution (`getAbortReason`)

Streaming code is the single place that must reason about the real-time shape
of a response. It is where bounded streaming limits are enforced, where a
client can terminate the upstream early, and where the gateway ensures a
single event stream remains correctly framed under translation.

Important retry constraint:

- the Anthropic-to-OpenAI streaming translation state
  (`AnthropicToOpenAiStreamState`) is intentionally per-request and
  in-memory-only
- that state tracks emitted response ids, announced role state, and tool-call
  index bookkeeping for one live SSE stream
- once a translated stream has started emitting OpenAI chunks, the gateway
  cannot safely retry the upstream mid-stream and "resume" translation from the
  middle
- even before translation starts, Switchmaxxer does not automatically retry a
  streaming `POST` request unless the caller supplied an `Idempotency-Key`
- any future retry design for translated streaming must treat a retry as a new
  stream with fresh translation state, or introduce an explicit replay/resume
  protocol first

In other words, translated streaming is currently a one-shot request lifecycle,
not a retryable mid-stream transport.

### [src/subsystems/proxy/proxy-translation.ts](../../../src/subsystems/proxy/proxy-translation.ts)

API-shape translation. Stateless on data; does not touch the network.

Owns:

- OpenAI-to-Anthropic request body construction
  (`buildAnthropicRequestBodyFromOpenAi`)
  - OpenAI function-tool definitions become Anthropic tool schemas
  - OpenAI assistant `tool_calls` become Anthropic `tool_use` content blocks
  - OpenAI client `role: "tool"` messages become Anthropic `tool_result`
    content blocks
  - Switchmaxxer translates the tool-call loop but does not execute requested
    tools itself
- Anthropic-to-OpenAI buffered response translation
  (`translateAnthropicResponse`)
- Anthropic streaming event translation to OpenAI streaming chunks
  (`translateAnthropicEventToOpenAiChunks`)
- SSE parsing according to WHATWG event-stream rules (`parseSseEvents`)
- SSE chunk formatting (`formatSseChunk`)
- text content normalization (`normalizeTextContent`) and the
  `UnsupportedTextContentError` and `AnthropicMessagesRequiredError` error
  types

Translation is the one area where incoming user content is re-shaped. It
enforces its own JSON bounds (`parseJsonWithinBounds`) on anything it parses,
ignores Anthropic reasoning-only metadata blocks (`thinking` and
`redacted_thinking`) for OpenAI clients, and refuses all other unknown content
block types rather than silently dropping them. The translator must not expose
thinking text or signatures through OpenAI-compatible responses.

For Anthropic-to-OpenAI tool streaming, a `content_block_start` for
`tool_use` with an empty Anthropic `input` object emits an initial OpenAI tool
delta with `function.arguments: ""`. Later `input_json_delta` events carry the
JSON argument fragments. The stream emits exactly one terminal
`data: [DONE]` marker.

### [src/subsystems/proxy/proxy-error-classification.ts](../../../src/subsystems/proxy/proxy-error-classification.ts)

Client-facing error shaping.

Owns:

- the `StreamingResponseLimitError` and `BufferedResponseLimitError` classes
  used to surface limit violations with a stable `code`
- `classifyFetchError` for upstream-request failures (timeouts, unreachable,
  private-endpoint-blocked, limit errors)
- `classifyResponseDeliveryError` for failures after the upstream response has
  started
- `describeTestFailure` for CLI route-test status explanations

This module is intentionally conservative. It maps diverse underlying errors
into a small, stable set of `{ statusCode, message, code }` shapes so clients
and observability never see raw fetch or socket text.

### [src/subsystems/proxy/proxy-logging.ts](../../../src/subsystems/proxy/proxy-logging.ts)

Proxy-specific structured logging.

Owns:

- request-path log line emitters (`logIncomingRequest` via forwarding, plus
  `logUpstreamResponse`, `logError`, and the `logDebug*` family)
- log-field sanitization helpers (`safeLogField`, `safeLogReason`) that bound
  lengths and strip control characters before they reach the log stream
- the `ProxyDebugIngressSummary` shape used for debug-mode ingress summaries

Callers that want to log a field coming from request data should always route
it through `safeLogField` / `safeLogReason` first.

## Request Execution Model

The in-proxy request path can be understood as these stages:

1. create context and caller display label
2. log the incoming request
3. resolve the route from config
4. enforce route-mode compatibility for the active listener
5. sanitize inbound headers and apply provider auth
6. build the upstream request body (passthrough or translated)
7. dispatch the upstream request through the provider transport with DNS
   pinning when applicable and automatic redirects disabled
8. branch on upstream status:
   - upstream error status → buffer and forward as-is
   - streaming client intent → pipe through the appropriate streaming pump
   - buffered non-streaming → buffer and, if needed, translate before sending
9. emit lifecycle observations at each milestone
10. classify any thrown error and write a safe client envelope if the response
    has not yet been delivered

The shared composition for this pipeline lives in `executeProxyRequest` in
[src/subsystems/proxy/proxy-core.ts](../../../src/subsystems/proxy/proxy-core.ts).
Listener modules (`proxy-openai.ts` and `proxy-anthropic.ts`) supply
listener-specific body builders, route validation, and response handlers.

## Response Path Selection

Four response paths exist, selected at runtime:

- **buffered passthrough** — same client/upstream API mode, non-streaming
- **buffered translation** — differing modes, non-streaming (currently: OpenAI
  client + Anthropic upstream)
- **streaming passthrough** — same mode, streaming
- **streaming translation** — differing modes, streaming (currently: OpenAI
  client + Anthropic upstream SSE → OpenAI SSE)

Upstream 4xx/5xx status codes always take the buffered path, regardless of
stream intent, so that the client sees the upstream's own error body rather
than a partial event stream.

## Streaming Limits

Streaming responses are bounded by five separate limits, all enforced inside
[src/subsystems/proxy/proxy-streaming.ts](../../../src/subsystems/proxy/proxy-streaming.ts):

- `streamIdleTimeoutMs` — no bytes received for this long → 504-equivalent
- `streamMaxLifetimeMs` — absolute ceiling on a single stream's wall time
- `streamMinBytesPerSecond` + `streamRateWindowMs` — sustained minimum rate
  enforced in rolling windows (catches slow-drip upstreams)
- `streamMaxEventBytes` — maximum size of a single SSE event during translation
- `streamMaxTotalBytes` — ceiling on cumulative streamed bytes for one request

Each limit surfaces as a `StreamingResponseLimitError` with a stable `code`,
which `classifyFetchError` / `classifyResponseDeliveryError` map to a
client-facing envelope.

All five limits come from `AppConfig`. The proxy does not invent defaults.

## Buffered Response Limit

Non-streaming upstream bodies are bounded by `maxBufferedUpstreamResponseBytes`
(default 16 MB if the config does not set it explicitly). Exceeding it raises
`BufferedResponseLimitError` with code `upstream_response_too_large` and a
`502` client status. That code is part of the proxy-compatible HTTP error body,
not the CLI/MCP JSON envelope `APP_ERROR_CODES` registry.

The ceiling is checked both against the upstream's declared `content-length`
header and against actual bytes received, so a lying header cannot bypass the
guard.

## Trust Boundary Posture

The proxy lives downstream of the gateway ingress boundary, but it still
applies its own defensive posture because it is the surface that talks to
upstream providers and re-enters the client trust boundary on the way back.

Current protections inside the proxy:

- **Header name charset** — upstream forwarded headers and copied response
  headers are validated against RFC 7230 token syntax before being emitted
  ([src/subsystems/proxy/proxy-headers.ts](../../../src/subsystems/proxy/proxy-headers.ts))
- **Header value charset** — forwarded and copied header values are validated
  against `^[\x09\x20-\x7e]*$` (tab, space, printable ASCII) to prevent CRLF
  header injection
- **Header value size** — bounded at 8 KB per value
- **Hop-by-hop filtering** — `connection`, `keep-alive`, `te`, `trailer`,
  `transfer-encoding`, `upgrade`, and friends are not forwarded in either
  direction
- **Managed header filtering** — `accept-encoding`, `authorization`,
  `x-api-key`, `x-switchmaxxer-inspect`, `x-switchmaxxer-inspect-id`,
  `x-switchmaxxer-inspect-token`, `anthropic-version`, `host`, and
  `content-length` from the inbound request are never forwarded to the
  upstream; provider auth and response-encoding policy are applied fresh
- **Cookie and auth-like response-header stripping** — upstream `set-cookie`,
  `set-cookie2`, `authorization`, `proxy-authorization`, and `x-api-key`
  response headers are never forwarded to the client; this is intentional
  defense-in-depth against unusual upstream behavior rather than a statement
  that normal providers emit those headers
- **Provider endpoint policy and pinned DNS** — every upstream dispatch runs
  `assertResolvedProviderEndpointPolicy` before transport. DNS hostnames are
  resolved and pinned into the socket path. Private/local/special-use DNS
  answers are rejected unless `allow_private_endpoints` is true; when that
  opt-in is true, the allowed private answer is still pinned into the socket
  path. IP literals do not need DNS pinning, but still pass
  configured-endpoint private/local/special-use validation (see
  [tech-spec-for-gateway.md](../gateway/tech-spec-for-gateway.md)'s Provider
  Endpoint Policy section)
- **Manual upstream redirects** — provider HTTP redirects are returned as
  upstream responses rather than followed automatically. This prevents a
  validated public provider endpoint from redirecting Switchmaxxer into
  localhost, link-local, or private-address targets without a fresh policy
  check. Any future redirect-following feature must re-run scheme, userinfo,
  private-address, and DNS-pinning validation for each `Location` target before
  connecting.
- **Caller display label bound** — `getCallerDisplayLabel` caps untrusted
  caller metadata at 128 chars and strips control characters before the value
  enters logs or observations
- **Secrets in logs** — `sanitizeHeadersForLogging` replaces `authorization`,
  `proxy-authorization`, and `x-api-key` values with the `REDACTED_SECRET`
  sentinel before debug logging
- **Response body bounds** — both buffered and streaming paths enforce
  byte-ceilings; neither path will accumulate unbounded upstream output
- **JSON bounds on translated bodies** — `parseJsonWithinBounds` is applied to
  the Anthropic upstream body before translation so a pathologically deep or
  wide upstream response cannot exhaust the process

These are contract, not conventions. A change that weakens any of them should
be called out in review.

## HTTP Headers

This section documents the concrete header set at each hop of one
client-to-provider round trip. The rules in `## Trust Boundary Posture` above
define what is allowed; this section walks one example end to end so the
operator-visible behavior is unambiguous.

The example case used below: a non-streaming OpenAI-compatible chat completion
sent from a generic OpenAI SDK client to the local Switchmaxxer gateway,
routed to an OpenAI-direct provider. Streaming and Anthropic-mode deltas are
called out where they apply.

### Hop 1: Client → Switchmaxxer (inbound request)

What the SDK puts on the wire. Switchmaxxer is the receiver and adds nothing
at this hop; everything here originates with the client.

```
POST /v1/chat/completions HTTP/1.1
Host: 127.0.0.1:4080
User-Agent: openai-python/1.45.0
Accept: application/json
Accept-Encoding: gzip, br
Authorization: Bearer <gateway-inbound-token>
Content-Type: application/json
Content-Length: 412
Connection: keep-alive
X-Stainless-Client: openai-python
X-Stainless-Version: 1.45.0
```

What each header means at this hop:

- `Host` — must match the configured `bind_host:port` for unauthenticated
  paths and for `/__switchmaxxer/runtime/...` control-plane requests; the
  loopback-host check is enforced by `runtime.ts`. For authenticated
  data-plane requests, the Host check is loose.
- `Authorization: Bearer <token>` — the **inbound gateway token** resolved
  against `inbound_api_key_env`. SHA-256 hashed and `crypto.timingSafeEqual`
  compared by `requestHasExpectedInboundAuth`. This token is for the gateway
  boundary only; it is never the upstream provider's API key.
- `Content-Type: application/json` — required. Anything else is rejected with
  HTTP 415.
- `Content-Length` — required. Chunked transfer-encoding is rejected with
  HTTP 411 (`request-dispatch.ts` enforces this).
- `User-Agent`, `Accept`, `Accept-Encoding`, `Connection`, `X-Stainless-*` —
  passive metadata. Some are dropped at the next hop (see below); some are
  forwarded.

Optional inbound headers Switchmaxxer specifically recognizes if the client
chooses to send them:

- `Idempotency-Key: <opaque>` — when present on a POST, enables the
  transport's `maxRetries: 1` retry policy in `http-transport.ts`. Without
  this header, POSTs are not retried by default.
- `X-Switchmaxxer-Caller`, `X-Switchmaxxer-Client`, `X-Client-Name` — display
  labels consumed by `getCallerDisplayLabel` for the trace's `caller` field.
  Trust level is zero: sanitized to ASCII printable + tab, capped at 128
  bytes, never used for auth or routing.

### Hop 2: Switchmaxxer → Provider (outbound request)

Switchmaxxer constructs a fresh `Headers` object via `sanitizeIncomingHeaders`
and `applyProviderHeaders`, then dispatches via `fetch`. The transformation
has three parts.

**Stripped from the inbound request:**

Hop-by-hop headers (RFC 7230 § 6.1) — `Connection`, `Keep-Alive`,
`Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`,
`Transfer-Encoding`, `Upgrade`. Drop set defined in
[src/subsystems/proxy/proxy-headers.ts](../../../src/subsystems/proxy/proxy-headers.ts)
as `HOP_BY_HOP_HEADERS`.

Managed headers — `Accept-Encoding`, `Authorization`, `X-API-Key`,
`X-Switchmaxxer-Inspect`, `X-Switchmaxxer-Inspect-Id`,
`Anthropic-Version`, `Host`, `Content-Length`. Drop set defined as
`MANAGED_HEADERS`. The inbound `Authorization` (gateway-facing token) is
dropped here and never reaches the provider; this is a load-bearing security
property of the proxy.

Browser-local context headers — `Cookie`, `Cookie2`, `Origin`, `Referer`,
`Referrer`, and `User-Agent`. `Cookie`-style state and browser navigation
context are dropped, and `User-Agent` is rewritten by Switchmaxxer rather
than forwarded from the caller.

**Forwarded from the inbound request, after sanitization:**

Anything not in a drop set, with each value validated against
`/^[\x09\x20-\x7e]*$/` (tab, space, printable ASCII) and a per-value 8 KiB
ceiling. Header names are lowercased on the way out because the WHATWG
`Headers` API normalizes them; HTTP makes header names case-insensitive so
this is wire-compatible.

In practice the forwarded set looks like:

```
x-stainless-client: openai-python
x-stainless-version: 1.45.0
idempotency-key: <opaque>            (if the client sent one)
x-switchmaxxer-caller: <label>       (if the client sent one)
```

**Set fresh by Switchmaxxer:**

```
content-type: application/json; charset=utf-8
accept: application/json
accept-encoding: identity
user-agent: switchmaxxer-gateway
authorization: Bearer <provider-api-key>
```

`Accept` becomes `text/event-stream` instead of `application/json` when the
parsed inbound body has `stream: true`. The `Authorization` header carries
the route's resolved provider key from `resolveRouteApiKey`, which unwraps a
`SecretString` only at this point. `Accept-Encoding` is forced to `identity`
so upstream providers do not return compressed bytes that the pinned DNS
transport cannot transparently decode.

For Anthropic-mode upstreams the auth-injection branch differs:

```
anthropic-version: 2023-06-01
x-api-key: <provider-api-key>
```

(no `Authorization` header in the Anthropic case).

**Set by the underlying fetch implementation:**

```
host: <provider-hostname>
content-length: <recomputed for the rewritten body>
```

`Host` reflects the configured upstream URL's hostname; under DNS pinning
the TCP connection is dialed to the pinned IP while `Host` and TLS SNI
remain the canonical hostname. `Content-Length` is recomputed because body
translation may have changed the length.

The full set of headers leaving Switchmaxxer for the provider:

```
POST /v1/chat/completions HTTP/1.1
host: <provider-hostname>
authorization: Bearer <provider-api-key>
content-type: application/json; charset=utf-8
accept: application/json
accept-encoding: identity
content-length: <recomputed>
user-agent: switchmaxxer-gateway
x-stainless-client: openai-python
x-stainless-version: 1.45.0
idempotency-key: <opaque>             (if present)
x-switchmaxxer-caller: <label>        (if present)
```

What is notably absent: the inbound gateway token, the inbound `Host`
pointing at loopback, and any hop-by-hop framing.

### Hop 3: Provider → Switchmaxxer (upstream response)

Whatever the provider sends. Switchmaxxer makes no semantic use of upstream
response headers beyond status-class classification; it treats them as
opaque metadata for the response-copy step. A representative OpenAI-mode
response:

```
HTTP/1.1 200 OK
date: <RFC 1123>
content-type: application/json; charset=utf-8
content-length: 1837
openai-organization: <org>
openai-processing-ms: 412
openai-version: 2020-10-01
strict-transport-security: max-age=15552000; includeSubDomains; preload
x-ratelimit-limit-requests: 10000
x-ratelimit-limit-tokens: 30000000
x-ratelimit-remaining-requests: 9998
x-ratelimit-remaining-tokens: 29999588
x-ratelimit-reset-requests: 8.64s
x-ratelimit-reset-tokens: 825ms
x-request-id: <provider request id>
cf-cache-status: DYNAMIC
server: cloudflare
cf-ray: <cf trace id>
```

Streaming responses replace `content-type` with
`text/event-stream; charset=utf-8` and omit `content-length` (the provider
uses chunked transfer-encoding).

Anthropic-mode upstreams emit headers like
`anthropic-organization-id`, `anthropic-ratelimit-requests-*`,
`anthropic-ratelimit-tokens-*`, `request-id`. Same opaque treatment.

Upstream 4xx/5xx responses come with provider-shaped error JSON bodies and
are recorded by the gateway-observation layer as `upstream_error` outcomes
but propagated header-by-header to the client (subject to the strip rules
in the next hop).

### Hop 4: Switchmaxxer → Client (response back to the client)

The response-copy step inverts the inbound filter. Upstream response
headers are copied to the client response except where the deny-list
strips them, and Switchmaxxer adds a small set of its own headers.

**Stripped from the upstream response:**

Hop-by-hop again — `Connection`, `Keep-Alive`, `Proxy-Authenticate`,
`Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`.

Auth-bearing — `Set-Cookie`, `Set-Cookie2`, `Authorization`,
`Proxy-Authorization`, `X-API-Key`. Defined in `proxy-headers.ts` as
`BLOCKED_UPSTREAM_RESPONSE_HEADERS`. Normal LLM providers do not emit these
on responses, but the strip is intentional defense-in-depth.

Buffered-path-only — `Content-Encoding`. Buffered requests ask the provider
for `Accept-Encoding: identity`; the original provider encoding header is not
safe to forward after Switchmaxxer buffers and re-emits the response body.
Streaming responses preserve encoding semantics differently and do not strip
this header on that path.

Header names that fail the RFC 7230 token regex
(`/^[!#$%&'*+\-.^_\`|~0-9A-Za-z]+$/`) and header values that fail the
charset regex are also dropped silently.

**Copied verbatim from the upstream response:**

Everything else from the upstream response that passes the filter. So the
client's response includes all the provider's `x-ratelimit-*` /
`anthropic-ratelimit-*` headers, the provider's `x-request-id`, the
provider's `server` / `cf-ray`, and any other safe metadata the provider
emitted.

**Added by Switchmaxxer:**

```
x-switchmaxxer-request-id: <uuid>
content-length: <recomputed for the buffered body>
ratelimit-limit: <config.rate_limit.requests>
ratelimit-remaining: <window remaining>
ratelimit-reset: <seconds to next window>
```

The `x-switchmaxxer-request-id` is set at the top of `requestHandler` via
`assignRequestId(request)`. This UUID is the same one carried in every
observation row for the request and is the operator's primary handle:
`smx trace show <request-id>` is the path from a response header to the
full trace.

The `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` triple
follows the IETF `RateLimit` header field draft and reflects
**Switchmaxxer's own per-caller rate limit**, not the provider's. Both sets
of rate-limit headers (`x-ratelimit-*` from the provider and `RateLimit-*`
from Switchmaxxer) coexist on the response and mean different things to
different layers.

For streaming responses the added set is different:

```
x-switchmaxxer-request-id: <uuid>
content-type: text/event-stream; charset=utf-8
cache-control: no-cache
connection: keep-alive
ratelimit-limit: <config.rate_limit.requests>
ratelimit-remaining: <window remaining>
ratelimit-reset: <seconds to next window>
```

(no `Content-Length` because the body is streamed; the upstream's
`Transfer-Encoding: chunked` is hop-by-hop and dropped, but Node
re-applies its own framing).

When Switchmaxxer rejects a request itself — bad inbound auth, rate-limit
exceeded, payload too large, malformed body, misconfigured provider — the
response is generated by the gateway, not copied from any upstream:

```
HTTP/1.1 401 Unauthorized
content-type: application/json; charset=utf-8
content-length: <length of the error envelope body>
x-switchmaxxer-request-id: <uuid>
```

For 429 rejections the response also includes `Retry-After: <seconds>`,
either from the auth-failure backoff limiter or from the per-caller rate
limiter.

### Header Hop Summary Table

| Header | Client→smx | smx→Provider | Provider→smx | smx→Client |
|---|---|---|---|---|
| `Authorization` (gateway-inbound token) | present | stripped | — | — |
| `Authorization` (provider key, OpenAI mode) | — | injected fresh | — | — |
| `x-api-key` + `anthropic-version` (Anthropic mode) | — | injected fresh | — | — |
| `Host` | required loopback in some cases | rewritten to provider | — | — |
| `Content-Type` | required `application/json` | rewritten canonical | from provider | copied (or `text/event-stream` for streams) |
| `Content-Length` | required | recomputed | from provider (buffered) | recomputed (buffered only) |
| `Connection`, `Keep-Alive`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade` | may be present | stripped (hop-by-hop) | may be present | stripped (hop-by-hop) |
| `Proxy-Authorization`, `Proxy-Authenticate` | may be present | stripped | — | stripped |
| `Set-Cookie`, `Set-Cookie2` | — | — | may be present | stripped |
| `Content-Encoding` | — | forwarded if present | may be present | stripped (buffered only) |
| `User-Agent` | from SDK | rewritten fixed | — | — |
| `Cookie`, `Cookie2`, `Origin`, `Referer`, `Referrer` | may be present | stripped | — | — |
| `X-Stainless-*` | from SDK | forwarded sanitized | — | — |
| `Accept-Encoding` | from SDK | replaced with `identity` | — | — |
| `Idempotency-Key` | optional | forwarded; enables retry | — | — |
| `X-Switchmaxxer-Caller` / `-Client`, `X-Client-Name` | optional | forwarded sanitized | — | — |
| Provider rate-limit (`x-ratelimit-*`, `anthropic-ratelimit-*`) | — | — | from provider | copied through |
| Provider trace headers (`x-request-id`, `request-id`, `cf-ray`) | — | — | from provider | copied through |
| `x-switchmaxxer-request-id` | — | — | — | added by gateway |
| `RateLimit-Limit` / `Remaining` / `Reset` | — | — | — | added by gateway (proxy paths) |
| `Retry-After` | — | — | — | added on 429 |
| `cache-control: no-cache`, `connection: keep-alive` | — | — | — | added on streaming paths |

### Header Invariants

The header model encodes five invariants worth stating explicitly:

1. **Client-to-gateway tokens never reach providers.** `Authorization` and
   `X-API-Key` are managed; the provider sees only the route's configured
   provider key, injected fresh by `applyProviderHeaders`.
2. **Provider-to-gateway secrets never reach clients.** `Set-Cookie`,
   `Authorization`, `X-API-Key`, and `Proxy-Authorization` on upstream
   responses are stripped before client-side emission.
3. **Hop-by-hop is hop-by-hop in both directions.** Connection-level
   framing metadata never crosses Switchmaxxer; both ingress and egress
   headers are filtered against the same RFC 7230 hop-by-hop set.
4. **Browser-local context stays local.** Cookies, browser origin/referrer
   metadata, and caller-specific user-agent strings are not forwarded to
   upstream providers.
5. **The gateway-assigned request id is the operator's handle.**
   `x-switchmaxxer-request-id` on the client response is the only piece
   of header state that ties an externally-visible request to the
   internal trace. Operators stitch invocations to traces via this header.

A change that weakens any of these five invariants belongs in
`## Trust Boundary Posture` and in this section together, not in one or
the other.

## Error Shaping Rules

Client-facing error envelopes produced by the proxy use the shape:

```json
{
  "error": {
    "message": "<short client-safe message>",
    "type": "switchmaxxer_error",
    "code": "<stable_lowercase_code>"
  }
}
```

This asymmetry is intentional:

- the proxy does not reuse the CLI/MCP `buildSuccessEnvelope` /
  `buildErrorEnvelope` contract
- the proxy is a client-compatibility surface for SDKs and model API clients
- changing proxy errors to the CLI/MCP envelope shape would be a breaking API
  change
Classification rules:

- timeouts and aborts → `504` / `upstream_timeout`
- socket-level failures (ENOTFOUND, EAI_AGAIN, ECONNREFUSED, ECONNRESET, or
  any other reach failure) → `502` / `upstream_unreachable`
- `ResolvedPrivateEndpointError` → `502` / `private_endpoint_resolution_blocked`
- streaming limit violations → `502` and the limit's own stable code
- buffered oversize → `502` / `upstream_response_too_large` in the
  proxy-compatible HTTP error body
- response-delivery errors after the upstream response started → `502` /
  `response_delivery_failed`

Error messages are intentionally coarse. Specific upstream URLs, addresses, or
underlying node socket error strings are never leaked to the client; they stay
in the debug log stream only.

## Invoke Inspection

`smx invoke --inspect` is a deliberately ephemeral protocol-debugging surface
for local operators. It captures one non-streaming request across four hops:

- `Client -> SMX`
- `SMX -> Provider`
- `Provider -> SMX`
- `SMX -> Client`

The CLI asks the gateway to create a capture with `x-switchmaxxer-inspect: 1`;
the gateway allocates the inspection id plus a one-time read token and returns
them in `x-switchmaxxer-inspect-id` and `x-switchmaxxer-inspect-token`. The
capture is kept only in the running gateway process, is read once through a
local runtime endpoint that requires the matching read token, expires quickly,
and is never written to logs or the observability store. Bodies are shown
because the operator explicitly asked for protocol inspection. Secret-bearing
headers are masked by default; the CLI's `--include-secrets` flag asks the
runtime endpoint to return local secret-bearing headers in clear text for
trusted local debugging only when the gateway process is opted in with
`SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`.
Gateway-to-provider authorization remains redacted even in this mode.

## Observability Contract

The proxy is the primary source of gateway request-path observations. Each
request emits at least:

- `request_received` on context creation
- `upstream_request_started` before dispatch
- `upstream_response_started` on first upstream bytes
- `upstream_response_completed` on upstream stream end or buffered read end
- `client_response_started` on first bytes written to the client
- `client_response_completed` or a terminal error event at the end of
  lifecycle

Observations flow through the shared observability bridge rather than being
written directly to the store. The proxy does not know (or care) whether the
store is present, degraded, or disabled.

For the canonical observation mapping and field meaning, see
[tech-spec-for-gateway-observation-mapping.md](../observability/tech-spec-for-gateway-observation-mapping.md).

## Route-Test Entry Point

The CLI exposes an in-process route-test flow that reuses the proxy
translation and error-classification helpers but does not run through the full
gateway listener.

`runRouteTestsDetailed` iterates the configured routes, issues a minimal
upstream probe per route, and reports a `RouteTestResult` with
`{ status: "pass" | "fail", status_code, latency_ms, reason }`.

This path is why several proxy helpers are public exports from
[src/subsystems/proxy/proxy.ts](../../../src/subsystems/proxy/proxy.ts): the CLI route-test surface
and the gateway hot path share the same translation and classification
semantics by design.

## Test Surface

Proxy tests live beside the code:

- [src/subsystems/proxy/proxy.test.ts](../../../src/subsystems/proxy/proxy.test.ts) — focused unit
  tests for translation helpers, error classification, abort-reason handling,
  and buffered-limit enforcement
- [src/subsystems/proxy/proxy-runtime.test.ts](../../../src/subsystems/proxy/proxy-runtime.test.ts)
  — in-process runtime tests that drive `proxyChatCompletion` and
  `proxyAnthropicMessage` against stubbed upstreams to exercise the real
  request path, streaming limits, and client-disconnect handling

New proxy behavior should land with one of these two test surfaces extended.

## Design Invariants

- `src/subsystems/proxy/proxy.ts` stays a public barrel. If it starts accreting
  implementation detail, that detail belongs in an implementation module.
- `src/subsystems/proxy/proxy-core.ts` stays the shared request pipeline.
  Listener-specific body shaping, route validation, and response handling stay
  in the listener modules and response-handler modules.
- Translation is a pure, network-free operation. `proxy-translation.ts` must
  not import transport, logging, or observability code.
- Error classification is conservative and stable. Codes are part of the
  client contract and should not be renamed without a deliberate release
  decision.
- Streaming limits are enforced inside `proxy-streaming.ts`. No caller should
  be reinventing idle/lifetime/rate-rate checks elsewhere.
- The proxy emits observations; it never reads them. One-way flow into the
  observability bridge.
- Secrets and raw inbound `authorization` / `x-api-key` values never reach the
  upstream transport or any log line. Provider auth is applied fresh; inbound
  secrets are stripped by the managed-header filter.
