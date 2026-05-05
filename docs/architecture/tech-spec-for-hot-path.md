# Switchmaxxer Hot Path Tech Spec

This document describes the per-request hot path of Switchmaxxer's gateway: the
code that runs once for every byte of every inbound request and every byte of
every upstream response. The cold path — CLI, MCP, config CRUD, observability
queries, optimize, bench — is out of scope here except where it shares a
boundary with the hot path.

The intent of this document is to lay the hot path open for scrutiny. If you
are trying to make Switchmaxxer faster, this is the surface to reason about.

## Where The Hot Path Lives In The Tree

The hot path is not a single folder. It is a slice that cuts through two
top-level subsystem folders, and it shares the platform module for
cross-cutting primitives.

Hot path code, by file, in approximate execution order:

- [src/subsystems/gateway/runtime.ts](../../src/subsystems/gateway/runtime.ts) —
  the `requestHandler` that every connection's first byte enters. Method/path
  classification, inbound auth resolution, host validation, auth-failure
  rate-limiting, per-caller rate-limiting, runtime control-plane GETs.
- [src/subsystems/gateway/runtime-helpers.ts](../../src/subsystems/gateway/runtime-helpers.ts) —
  helpers for source-IP extraction, JSON content-type detection, loopback host
  classification, runtime-config view assembly, rate-limit header rendering.
- [src/subsystems/gateway/local-gateway-auth.ts](../../src/subsystems/gateway/local-gateway-auth.ts) —
  inbound token state resolution and timing-safe comparison.
- [src/subsystems/gateway/auth-rate-limit.ts](../../src/subsystems/gateway/auth-rate-limit.ts) —
  per-source-IP failed-auth limiter with exponential backoff.
- [src/subsystems/gateway/rate-limit.ts](../../src/subsystems/gateway/rate-limit.ts) +
  [runtime-rate-limits.ts](../../src/subsystems/gateway/runtime-rate-limits.ts) +
  [window-rotation.ts](../../src/subsystems/gateway/window-rotation.ts) —
  global per-caller request-rate limiter and rolling time windows.
- [src/subsystems/gateway/runtime-state-managers.ts](../../src/subsystems/gateway/runtime-state-managers.ts) —
  concurrency caps for in-flight JSON parses and per-IP streaming requests.
- [src/subsystems/gateway/request-dispatch.ts](../../src/subsystems/gateway/request-dispatch.ts) —
  the request-body read, JSON parse, shape validation, and dialect dispatch.
- [src/subsystems/gateway/http-runtime-helpers.ts](../../src/subsystems/gateway/http-runtime-helpers.ts) —
  `readRequestBodyWithLimit` async-iterator body reader with idle/total
  timeouts.
- [src/subsystems/gateway/request-body-types.ts](../../src/subsystems/gateway/request-body-types.ts) —
  `validateGatewayProxyRequestBody` shape validators for OpenAI and Anthropic
  inbound shapes.
- [src/subsystems/proxy/proxy.ts](../../src/subsystems/proxy/proxy.ts) — the
  re-export façade between the gateway and the proxy.
- [src/subsystems/proxy/proxy-anthropic.ts](../../src/subsystems/proxy/proxy-anthropic.ts) +
  [proxy-openai.ts](../../src/subsystems/proxy/proxy-openai.ts) — listener-side
  proxy entry points. They each do one thing: call
  `executeProxyRequest` with the right options bag.
- [src/subsystems/proxy/proxy-core.ts](../../src/subsystems/proxy/proxy-core.ts) —
  `executeProxyRequest`: route resolution, request-body translation, header
  application, upstream fetch dispatch, response handler invocation.
- [src/subsystems/proxy/proxy-forwarding.ts](../../src/subsystems/proxy/proxy-forwarding.ts) —
  upstream request construction, DNS-pinning enforcement at fetch time, the
  context/route resolution glue, and the JSON error envelope.
- [src/subsystems/proxy/proxy-headers.ts](../../src/subsystems/proxy/proxy-headers.ts) —
  inbound and outbound header sanitization, provider auth header injection.
- [src/subsystems/proxy/proxy-translation.ts](../../src/subsystems/proxy/proxy-translation.ts) —
  the bidirectional OpenAI ↔ Anthropic dialect translator for both buffered
  bodies and SSE event streams.
- [src/subsystems/proxy/proxy-streaming.ts](../../src/subsystems/proxy/proxy-streaming.ts) —
  the streaming relay: idle/lifetime timeouts, per-event/total byte caps,
  rate-of-progress monitoring, backpressure, abort propagation.
- [src/subsystems/proxy/proxy-response-buffer.ts](../../src/subsystems/proxy/proxy-response-buffer.ts) +
  [proxy-response-handlers.ts](../../src/subsystems/proxy/proxy-response-handlers.ts) —
  the buffered (non-streaming) upstream reader with byte caps, and the
  buffered-response delivery path.
- [src/subsystems/proxy/proxy-request-shape.ts](../../src/subsystems/proxy/proxy-request-shape.ts) +
  [proxy-upstream-model.ts](../../src/subsystems/proxy/proxy-upstream-model.ts) —
  request shape summary for logs, upstream model id selection.
- [src/subsystems/proxy/http-transport.ts](../../src/subsystems/proxy/http-transport.ts) —
  the `fetch` wrapper that owns timeouts, retry policy, idempotency-key
  semantics, and DNS-pinned dispatch.
- [src/subsystems/proxy/upstream-url.ts](../../src/subsystems/proxy/upstream-url.ts) —
  upstream URL construction.
- [src/subsystems/proxy/provider-endpoint-policy.ts](../../src/subsystems/proxy/provider-endpoint-policy.ts) —
  endpoint URL validation (cold path) and per-request DNS resolution + pinning
  cache (hot path).
- [src/subsystems/proxy/proxy-error-classification.ts](../../src/subsystems/proxy/proxy-error-classification.ts) —
  fetch-error and upstream-status classification for client-facing error
  shaping.

Hot-path *primitives* live under [src/platform/](../../src/platform/):

- [json-bounds.ts](../../src/platform/json-bounds.ts) — bounded `JSON.parse`,
  bounded `JSON.stringify`, raw-text nesting check.
- [request-id.ts](../../src/platform/request-id.ts) — per-request UUID
  attached to the `IncomingMessage` via WeakMap.
- [number-parsing.ts](../../src/platform/number-parsing.ts) — canonical
  integer parsing for `Content-Length`.
- [secret-string.ts](../../src/platform/secret-string.ts) — provider auth
  values, only revealed at header-injection time.
- [error-codes.ts](../../src/platform/error-codes.ts) — the `APP_ERROR_CODES`
  set used in client-facing JSON error envelopes.
- [logger.ts](../../src/platform/logger.ts) — `logLine`, `logDebug`,
  `safeLogField`, `sanitizeLogValue`. Synchronous to stdout.

Approximate hot-path size, in TypeScript LOC: ~5,800 (gateway-side ~1,800,
proxy-side ~3,800, platform primitives ~200).

The cold path that touches the hot path *only at boundaries*: provider auth
key resolution ([src/subsystems/config/provider-auth.ts](../../src/subsystems/config/provider-auth.ts)),
gateway observation recording
([src/subsystems/observability/gateway.ts](../../src/subsystems/observability/gateway.ts)),
and the runtime config snapshot constructed at startup/reload.

## End-to-End Request Flow

Below is the full lifecycle of one inbound request, with every meaningful edge
called out.

### Phase 1 — Connection Acceptance

1. **Node `http.Server` accepts a TCP connection** and parses the HTTP request
   line and headers. Switchmaxxer does not own this code; it is `node:http`,
   which delegates parsing to llhttp under the hood.
2. **`requestHandler` from
   `createGatewayRuntimeRequestHandler` in
   `src/subsystems/gateway/runtime-request-handler.ts`** is invoked with the
   `IncomingMessage` and `ServerResponse` pair. Before anything else,
   `assignRequestId(request)` attaches a `randomUUID()` to a WeakMap keyed by
   the request object and the result is set as the
   `x-switchmaxxer-request-id` response header.

### Phase 2 — Boundary Validation

3. **Method and URL classification.** `request.url` is parsed with the
   `URL` constructor and `http://localhost` as base. Malformed targets get a
   400.
4. **Inbound auth state resolution.** `resolveLocalGatewayInboundAuthState`
   maps `(inbound_api_key_env, allow_unauthenticated_gateway)` config to one
   of: `disabled_explicit`, `token`, `misconfigured`. `misconfigured` is fatal
   for the request — 500.
5. **Loopback host enforcement** for `disabled_explicit` and for the
   `/__switchmaxxer/runtime/...` control-plane paths. The `Host` header must
   resolve to the configured `bind_host` and `port`. Mismatch → 421.
6. **Path classification.** `/v1/chat/completions` and `/anthropic/v1/messages`
   are the data-plane paths. `/health` and `/__switchmaxxer/runtime/config` are
   control-plane paths. Anything else → 404.
7. **Health-path branch** runs auth, auth-rate-limit, health-rate-limit, and
   then the simple JSON `{ status: "ok" | "fatal" }` body.
8. **Inbound token check.** For data-plane and control-plane paths,
   `requestHasExpectedInboundAuth` SHA-256-hashes both tokens and uses
   `crypto.timingSafeEqual`. A failure invokes
   `failedAuthAttemptLimiter.registerFailure(sourceIp)` which can block the
   client with exponential backoff.
9. **Per-caller rate limit.** `rateLimiter.check(gatewayRateLimitKey(request,
   route.trustClass))` on the `requests/window` config. The key combines the
   connected-socket source IP with the route trust class, so data-plane and
   runtime control-plane reads do not starve each other; the limiter is
   windowed via `window-rotation.ts`. Exceeded → 429 with `Retry-After`.
10. **Standard rate-limit headers** applied to the response on accepted
    requests: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

### Phase 3 — Body Read And Parse (in `request-dispatch.ts`)

11. **Transfer-encoding rejection.** Chunked request bodies are explicitly
    refused with 411. Switchmaxxer requires a known `Content-Length`.
12. **`Content-Length` parsing** via `parseCanonicalNonNegativeInteger` (no
    leading `+`, no whitespace, no scientific). Missing or invalid → 411 / 400.
13. **Declared-length cap** against `config.maxPayloadSize`. Over → 413.
14. **`Content-Type` enforcement.** Must be `application/json` (with optional
    charset and parameters). Anything else → 415.
15. **JSON-parse concurrency cap.**
    `jsonParseConcurrencyManager.tryAcquire(maxConcurrentJsonParses)` returns
    a `release` function or `null`. Null → 503. This bounds the number of
    request bodies the process is *simultaneously* willing to read+parse.
16. **Body read loop.** `readRequestBodyWithLimit` iterates
    `request[Symbol.asyncIterator]()` and races each chunk against an idle
    timer (`min(timeoutMs, defaultRequestBodyIdleTimeoutMs)`) and a total
    deadline (`timeoutMs`). Exceeded → 408 with `Connection: close`. Body too
    large mid-stream → 413.
17. **`Buffer.concat(chunks).toString("utf8")`.** The body becomes one UTF-8
    string. This is the first allocation that scales linearly with body size,
    and one of the few places where Node copies bytes purely for shape
    convenience.
18. **`parseJsonWithinBounds`.**
    - Pre-parse: byte-length check against `maxPayloadSize`.
    - Pre-parse: `assertRawJsonNestingWithinBounds` walks the string once
      counting `{` `[` to fail loudly on excessively nested inputs without
      paying for parse first.
    - `JSON.parse` (V8 native).
    - Post-parse: `assertJsonValueWithinBounds` walks the parsed value to
      enforce node count and depth.
19. **Shape validation.** `validateGatewayProxyRequestBody(body,
    "openai" | "anthropic")` enforces the inbound dialect's required fields
    (`model` is a string, `messages` is an array, etc.). Plus
    `validateParsedRequestBodyShape` re-stringifies via
    `safeJsonStringifyWithinBounds` to confirm round-trip size.
20. **Streaming-cap acquisition.** If `parsedBody.stream === true`,
    `streamingRequestConcurrencyManager.tryAcquire(sourceIp,
    maxConcurrentStreamsPerIp)` runs. Null → 429. This caps how many *active
    streams* one source IP can hold open simultaneously.

### Phase 4 — Route Resolution And Translation (in `proxy-core.ts`)

21. **Context construction.** `createContext` builds a `ProxyRequestContext`:
    `{ requestId, caller, bareModel, stream, apiMode, requestStartedAt }`.
    `request_received` observation is recorded here.
22. **Route resolution.** `resolveRoute(config, context)` looks up the
    inbound `model` field in the route catalog. Missing route → 400 or 404
    depending on shape. `validateCommonRouteState` checks the route's
    `service_provider` is configured.
23. **`route_resolved` observation** recorded.
24. **Upstream URL construction.** `createUpstreamUrl(route.baseUrl,
    route.api_mode)` handles the listener vs upstream endpoint composition.
25. **Body translation.** `options.buildRequestBody(route, rawBody)`. There
    are four translation paths:
    - OpenAI listener → OpenAI upstream: pass-through with optional model-id
      patch (`buildPatchedJsonBody`).
    - OpenAI listener → Anthropic upstream: full
      `translateOpenAiToAnthropicRequest`.
    - Anthropic listener → Anthropic upstream: pass-through with optional
      model-id patch.
    - Anthropic listener → OpenAI upstream: full
      `translateAnthropicToOpenAiRequest`.
    The translators do tool-choice mapping, `system`-message extraction,
    `stop`/`stop_sequences` mapping, multi-part content normalization, and
    stream-flag preservation. Unsupported content shapes throw
    `UnsupportedTextContentError` → 400.
26. **Header sanitization.** `sanitizeIncomingHeaders` allocates a fresh
    `Headers` object, drops hop-by-hop headers
    (`connection, keep-alive, proxy-authenticate, proxy-authorization, te,
    trailer, transfer-encoding, upgrade`) and managed headers
    (`accept-encoding, authorization, x-api-key, x-switchmaxxer-inspect,
    x-switchmaxxer-inspect-id, x-switchmaxxer-inspect-token,
    anthropic-version, host, content-length`), validates each remaining header
    value against `/^[\x09\x20-\x7e]*$/` and ≤ 8 KiB, and lower-cases the
    names.
27. **Provider auth header injection.** `applyProviderHeaders` calls
    `resolveRouteApiKey(route)` to unwrap a `SecretString` and sets
    `Authorization: Bearer <key>` for OpenAI mode or
    `x-api-key: <key>` + `anthropic-version: <version>` for Anthropic mode.

### Phase 5 — Upstream Dispatch (in `http-transport.ts`)

28. **DNS-pinning resolution.** `assertResolvedProviderEndpointPolicy` is
    called per request, but it short-circuits to a 30-second cached pinned
    address per `(hostname, port)` key. On miss, `dns.lookup` runs once;
    private/loopback resolutions are rejected when `allow_private_endpoints`
    is false (and *also* cached for 5 min as "rejected" to prevent
    rebinding-style retry storms). Allow-listed private DNS answers are pinned
    like public answers.
29. **`composeSwitchmaxxerFetchSignal`** combines the per-request timeout
    signal with any caller-provided abort signal via `AbortSignal.any`.
30. **`fetch` invocation.**
    - `redirect: "manual"` (no auto-follow, no rebinding via `Location`).
    - `keepalive: true`.
    - `body: rewrittenBody` (string).
    - When a pinned DNS resolution exists, the `fetch` impl is wrapped to
      route the request through the pinned address while preserving the
      original `Host`/SNI.
31. **Retry policy.** Idempotency-aware:
    - Default `maxRetries: 0` for the proxy hot path (set explicitly by
      `proxy-forwarding.ts`).
    - GET would retry on 408/429/502/503/504 with capped exponential backoff.
    - POST never retries unless an `Idempotency-Key` header is present, in
      which case `maxRetries: 1`.
    - Pre-response transport failures (`AbortError`, `ECONNRESET`,
      DNS errors) on POST are retried only with idempotency-key.
32. **Upstream response received.** Either streaming (`response.body` is a
    `ReadableStream`) or buffered. `upstream_request_started` and
    `upstream_response_started` observations recorded.

### Phase 6a — Buffered Response Path (non-streaming requests)

33. **Bounded read.** `BufferedUpstreamReader` reads
    `response.body` chunks until end-of-body or
    `max_buffered_upstream_response_bytes` (default 16 MiB). Oversized → 502.
    Malformed `Content-Length` is ignored (the byte cap is what enforces
    safety).
34. **Response translation** (when listener and upstream dialects differ).
    `translateAnthropicResponse(parsedBody, model)` rebuilds an OpenAI
    `chat.completion` envelope from an Anthropic body, including tool-call
    translation and stop-reason mapping. Pass-through paths skip this.
35. **Header copy.** `copyBufferedResponseHeaders` (drops
    `content-encoding` because the upstream-decompressed body is being
    re-emitted).
36. **`response.end(body)`.** Single buffered write.

### Phase 6b — Streaming Response Path (when the request asked for it)

This is the hottest sub-path because every byte the model produces traverses
it.

37. **`prepareStreamingResponseHeaders`** sets `content-type:
    text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`.
    `client_response_started` recorded once on the first byte.
38. **Reader loop.** Two shapes depending on whether dialect translation is
    needed:
    - **Pass-through (same dialect both sides):** `stream.pipe(response)`
      with `data` events tracked for byte counting and idle reset.
    - **Translating (`pipeAnthropicStreamingToOpenAi` or the symmetric
      direction):** a `getReader()` loop. Each chunk is decoded as UTF-8,
      appended to a string buffer, `parseSseEvents` splits on `\n\n`, each
      event is fed to `translateAnthropicEventToOpenAiChunks` which emits one
      or more SSE chunks in the new dialect, and each chunk is written via
      `writeChunkWithBackpressure` (which `await`s `drain` if `response.write`
      returns false).
39. **Idle timer.** Reset on every chunk; expiry → abort with reason
    `streaming_idle_timeout` and 504.
40. **Lifetime timer.** Single one-shot for `stream_max_lifetime_ms`; expiry
    → abort with reason `upstream_stream_lifetime_exceeded`.
41. **Progress-rate monitor.** Tracks bytes-per-window
    (`stream_min_bytes_per_second` over `stream_rate_window_ms`); below
    threshold → abort with reason `upstream_stream_rate_too_low`.
42. **Per-event byte cap** (`stream_max_event_bytes`, default 1 MiB) and
    **total stream byte cap** (`stream_max_total_bytes`, default 64 MiB).
43. **Client-disconnect propagation.** `response.once("close")` aborts the
    upstream reader and cancels its underlying socket.
44. **Translation state.** A small object
    (`AnthropicToOpenAiStreamState`) tracks placeholder response id, role
    announcement, and tool-call index map across events.

### Phase 7 — Cleanup

45. **Releases.** The `releaseStreamingRequestSlot` (per-IP cap) and
    `releaseJsonParseSlot` (parse cap) are released in `finally` blocks.
46. **Final observation.** `client_response_completed` recorded with
    `total_bytes`, `latency_ms`, terminal status code.
47. **`response.end()`** if not already ended.

The whole sequence is allocation-heavy: each request allocates a `URL`, a
`Headers` object on the inbound side, a `Headers` object on the outbound
side, a `ProxyRequestContext`, a `ProxyExecutionOptions`, the parsed JSON
tree, a stringified outbound body, the response read buffer (or streaming
reader state), and a handful of one-off promises and timers.

## Boundaries And Surfaces

These are the seams that matter for refactor planning, language-port
planning, and bottleneck reasoning. Each boundary is something that could be
moved, swapped, or measured.

### B1 — The Listener Boundary (Node's `http.Server` ↔ Switchmaxxer)

- **Inputs:** `IncomingMessage`, `ServerResponse`.
- **What's on the Node side:** TCP accept, llhttp request parsing, header
  decoding, `Transfer-Encoding: chunked` decoding for inbound bodies (we
  refuse them, but llhttp still handles framing if we got one), keep-alive
  socket reuse.
- **What's on the Switchmaxxer side:** everything in this document.
- **Performance characteristic:** llhttp is fast (C, well-optimized) but
  Node's stream-to-async-iterator adapter and per-event allocation around
  every chunk are not. The body-read loop allocates a new `Promise` and a new
  `setTimeout`/`clearTimeout` pair per chunk read.

### B2 — The Inbound JSON Boundary

- **Inputs:** raw UTF-8 string, byte length.
- **Outputs:** typed parsed body, or a thrown bounded-size error.
- **Surface:** `parseJsonWithinBounds` + `assertRawJsonNestingWithinBounds` +
  `assertJsonValueWithinBounds` + `validateGatewayProxyRequestBody`.
- **Cost shape:** O(body length) for the nesting walk, O(body length) for
  `JSON.parse`, O(parsed-tree size) for the bounds walk, O(body length again)
  for `safeJsonStringifyWithinBounds` round-trip in
  `validateParsedRequestBodyShape`, and O(parsed-tree size) for recursive
  reserved-key rejection in `validateGatewayProxyRequestBody`. The round-trip
  and reserved-key scan guard against prototype-pollution-style payloads but
  are also among the measurable redundant-work points.
- **Concurrency primitive:** `JsonParseConcurrencyManager` (counting
  semaphore over the parse phase).

### B3 — The Translation Boundary

- **Inputs:** parsed body in dialect A, route config.
- **Outputs:** stringified body in dialect B, plus per-stream translator
  state for SSE.
- **Surface:** [proxy-translation.ts](../../src/subsystems/proxy/proxy-translation.ts).
- **Cost shape:** four code paths, two of which are pass-through with at most
  a model-id patch, two of which build an entirely new request body. The
  Anthropic → OpenAI streaming translator is the hottest sub-path: it does
  `decoder.decode` per chunk, string concatenation into a buffer, regex
  normalization (`\r\n` → `\n`, then split on `\n\n`), and per-event JSON
  parse + per-chunk JSON stringify. That's *four* JSON traversals per upstream
  byte in the worst case (decode → buffer → parse → restringify → encode).
- **Determinism:** the only randomness is `randomUUID()` for synthetic stream
  ids and tool-call ids when upstream omits them.

### B4 — The Header Boundary

- **Inputs:** `IncomingHttpHeaders` (Node's lowercase string-keyed object) and
  a `RouteConfig`.
- **Outputs:** a `Headers` object suitable for `fetch`.
- **Cost shape:** linear in header count; the regex `/^[\x09\x20-\x7e]*$/`
  walks each value. Header forwarding allocates a fresh `Headers` object per
  request.
- **Notable:** allocation of a `Headers` object is not free — `URLSearchParams`
  / `Headers` / `URL` are all `undici` C++ class wrappers and creating one
  per request shows up in flamegraphs at high RPS.

### B5 — The DNS-Pinning Boundary

- **Inputs:** parsed upstream `URL`, `allow_private_endpoints`.
- **Outputs:** a `PinnedProviderEndpointResolution | null` (null means "skip
  pinning"), or a thrown `ResolvedPrivateEndpointError`.
- **Surface:** `assertResolvedProviderEndpointPolicy` +
  `fetchWithPinnedDnsResolution`.
- **Cost shape:** O(1) on cache hit (30s TTL), one `dns.lookup` on miss.
- **Tradeoff:** the cache is a `Map` keyed by hostname, with a
  `prunePinnedProviderEndpointResolutionCache` pass on every read. That prune
  is O(n) over the cache. For a typical Switchmaxxer install with <50
  providers this is invisible, but it is technically per-request work.

### B6 — The Upstream Fetch Boundary

- **Inputs:** URL string, `RequestInit`, transport options.
- **Outputs:** a `Response`.
- **Surface:** `fetchWithSwitchmaxxerTransport` /
  `fetchStreamingWithSwitchmaxxerTransport`.
- **What's on the Node side:** undici (HTTP/1.1 only by default; the
  `keepalive: true` flag enables connection pooling). TLS via OpenSSL.
- **What's on the Switchmaxxer side:** retry policy, timeout composition,
  pinned-DNS dispatch wrapping, retry-attempt observations.
- **Performance characteristic:** at low RPS, latency is dominated by
  upstream RTT. At high RPS, latency starts including connection-pool
  contention. Switchmaxxer does not pool per-provider explicitly; it relies
  on undici's default agent.

### B7 — The Streaming Relay Boundary

- **Inputs:** an upstream `Response.body` (`ReadableStream` over fetch's
  internal buffer), the gateway's `ServerResponse` (a Node `Writable`).
- **Outputs:** bytes written to the client, terminating with `data: [DONE]`
  or upstream's terminal event.
- **Surface:** [proxy-streaming.ts](../../src/subsystems/proxy/proxy-streaming.ts).
- **Cost shape:** every chunk traverses
  `getReader().read()` → `decoder.decode(stream: true)` → buffered string
  concat → `parseSseEvents` regex/split → per-event JSON parse →
  per-event translation → per-chunk JSON stringify → `formatSseChunk` →
  `Buffer.byteLength` (for byte counting) → `response.write` →
  optional `await` on `drain`.
- **Resource shape:** four timers per active stream (idle, lifetime,
  progress-window, plus any retry-related). Two AbortController instances.
  An event-listener web on both upstream and downstream streams that has to
  be cleaned up in the `finally`.

### B8 — The Observability Boundary

- **Inputs:** `recordGatewayObservation(...)` calls scattered through the
  hot path (one per ingress, one per route resolution, one per upstream
  start, one per upstream complete, one per client start, one per client
  complete, plus any errors and rate-limit decisions).
- **Outputs:** an enqueue into the gateway observation worker.
- **Surface:**
  [src/subsystems/observability/gateway.ts](../../src/subsystems/observability/gateway.ts) +
  [gateway-observation-records.ts](../../src/subsystems/observability/gateway-observation-records.ts) +
  [gateway-observation-runtime-state.ts](../../src/subsystems/observability/gateway-observation-runtime-state.ts) +
  [gateway-observation-priority.ts](../../src/subsystems/observability/gateway-observation-priority.ts) +
  [gateway-observation-queue.ts](../../src/subsystems/observability/gateway-observation-queue.ts) +
  [gateway-observation-flush.ts](../../src/subsystems/observability/gateway-observation-flush.ts) +
  [gateway-observation-shutdown.ts](../../src/subsystems/observability/gateway-observation-shutdown.ts) +
  [gateway-observation-worker.ts](../../src/subsystems/observability/gateway-observation-worker.ts).
- **Composition:** `gateway.ts` is the facade used by the proxy hot path.
  `gateway-observation-records.ts` builds canonical records,
  `gateway-observation-runtime-state.ts` owns the composed queue/flush/worker
  state, `gateway-observation-priority.ts` classifies drop priority,
  `gateway-observation-queue.ts` owns bounded queueing and drop accounting,
  `gateway-observation-flush.ts` drains queue batches into the worker,
  `gateway-observation-shutdown.ts` performs bounded shutdown drains, and
  `gateway-observation-worker.ts` owns the worker-thread lifecycle and pending
  write acknowledgements.
- **Critical property:** the SQLite write is *asynchronous* and queued. The
  hot path pays the cost of building each observation record and pushing
  into a bounded queue, then returns immediately. The worker drains the
  queue on its own timeline. If the queue fills, observations are dropped —
  the hot path never blocks on disk.
- **Cost shape:** ~6-12 observation records per non-streaming request,
  potentially more for streaming. Each is a small object literal (~5-15
  fields) that is then stringified via `JSON.stringify` inside the worker.

### B9 — The Provider-Auth Boundary

- **Inputs:** a `RouteConfig`.
- **Outputs:** a string API key (or null), once per request.
- **Surface:** `resolveRouteApiKey` in
  [provider-auth.ts](../../src/subsystems/config/provider-auth.ts).
- **Property:** `SecretString.reveal()` is the *only* way to get the
  cleartext key, and CI restricts callers via
  [scripts/check-secret-reveal-allowlist.js](../../scripts/check-secret-reveal-allowlist.js).
  This is a security boundary, not a performance one, but it's load-bearing
  to keep on the hot path.

## Layered View

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Client (OpenAI SDK / Anthropic SDK / curl / etc.)                       │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  HTTP/1.1, keep-alive, JSON or SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Listener — Node http.Server + llhttp                                   │
│  Owns: TCP accept, request line/header parse, chunked dechunking        │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  IncomingMessage / ServerResponse
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Gateway runtime (gateway/runtime.ts)                                   │
│  • request id assign                                                    │
│  • method/path classify, URL parse                                      │
│  • inbound auth resolve + timing-safe compare                           │
│  • host validation for unauth/loopback control plane                    │
│  • auth-failure backoff limiter                                         │
│  • per-caller rate limiter                                              │
│  • health and runtime-config short-circuits                             │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Request dispatch (gateway/request-dispatch.ts)                         │
│  • content-length / transfer-encoding / content-type validation         │
│  • JSON parse concurrency cap                                           │
│  • body read (bounded, idle+total timeouts, async iterator)             │
│  • bounded JSON parse + shape validation                                │
│  • streaming-cap acquisition                                            │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  parsedBody, rawBody
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Proxy execution (proxy/proxy-core.ts)                                  │
│  • route resolution                                                     │
│  • request body translation (4 dialect paths)                           │
│  • header sanitization + provider auth injection                        │
│  • upstream URL construction                                            │
│  • observation hooks                                                    │
└──────┬──────────────────────────────────────────────────────────┬───────┘
       │                                                          │
       ▼                                                          ▼
┌──────────────────────────┐                        ┌─────────────────────┐
│  Endpoint policy         │                        │  HTTP transport     │
│  • DNS pin (30s cache)   │                        │  • timeout compose  │
│  • private addr reject   │ ←─────────── pinned ───│  • retry policy     │
│  • redirect manual       │              resol.    │  • idempotency-key  │
└──────────────────────────┘                        │  • undici fetch     │
                                                    └──────────┬──────────┘
                                                               │ TCP/TLS
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │  Upstream provider  │
                                                    └──────────┬──────────┘
                                                               │
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Response path                                                          │
│  • buffered: bounded read → optional translate → write                  │
│  • streaming: getReader loop → SSE parse → optional translate →         │
│    backpressure-aware write, with idle/lifetime/rate/byte caps          │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
                          Client
```

Sidecar to every layer: the **observability queue**. Sidecar to every layer:
the **logger** (synchronous to stdout/journald). Sidecar to phases 3-7: the
**concurrency caps** (parse manager, streaming manager).

## What Slows It Down: A Bottleneck Inventory

These are ordered roughly by where the cycles actually go in production at
moderate-to-high RPS. The point is not "rewrite it all" — the point is to
know which knobs and which surfaces are worth measuring before changing
anything.

### Big rocks

1. **The dialect translator on streaming responses.** Phase 6b is the
   throughput-limiting code path for any cross-dialect stream. The
   per-chunk decode → buffer → split → JSON-parse → JSON-stringify chain
   does 4-5 traversals over data that the model has already produced once.
   At ~50 tokens/sec sustained, this is fine. At ~500 tokens/sec, this is
   measurable. At ~5,000 tokens/sec (some local Llama setups, or very fast
   provider classes), this becomes the dominant non-IO cost.
2. **`JSON.parse` + the shape round-trip.** Every accepted POST does
   `JSON.parse` (V8, fast), then re-stringifies the parsed object via
   `safeJsonStringifyWithinBounds` for size validation. The round-trip is a
   defensive measure against parsed-tree-larger-than-input attacks but it
   doubles the JSON CPU per request. For 100 KB bodies it's invisible; for
   2 MB bodies (long context windows) it's a noticeable chunk of per-request
   CPU.
3. **`Buffer.concat(chunks).toString("utf8")` on body read.** Allocates one
   final buffer of body size, then allocates the string. For large bodies
   this causes a young-generation GC spike per request.
4. **Per-request `Headers`/`URL`/`Map`/`Set` allocations.** The hot path
   creates a few `Headers` instances, one or two `URL` instances, a couple
   of `Set` lookups against frozen string sets, and a `ProxyRequestContext`
   object. None individually expensive; collectively they show up in
   allocation profiles at high RPS.
5. **Streaming timer churn.** Per-chunk `clearTimeout` + `setTimeout` for
   the idle timer. Node's timer wheel handles this efficiently but at high
   token rates it contributes.
6. **TLS handshake on cold upstream connections.** Switchmaxxer does not
   warm provider pools; the first request to any given provider after a
   cold start pays the full TLS+TCP handshake. After that undici's default
   agent reuses connections.

### Medium rocks

7. **Observation record allocation.** Every request produces 6-12 small
   objects, each with ~10 fields, that are pushed into a queue. The hot
   path doesn't pay disk cost for these but it does pay allocation +
   GC pressure.
8. **DNS pinning cache prune-on-read.** O(n) over cache entries on every
   forwarded request. For typical n=5-50 this is fine; if a deployment ever
   has thousands of provider entries, it would matter.
9. **Inbound header sanitization regex.** Every header value is checked
   against `/^[\x09\x20-\x7e]*$/` — V8's regex engine is good at this but
   it's still per-byte work for a per-request feature.
10. **Logger calls.** `logLine` and `logDebug` are synchronous writes to
    stdout. At debug level this becomes a real bottleneck because each log
    line is `JSON.stringify`'d.
11. **`Buffer.byteLength(chunk)` on each streaming chunk.** It's cheap, but
    it's per-byte-encoded; for SSE translation paths we do this twice
    (input chunk and output chunk).

### Small rocks (worth measuring before optimizing)

12. **WeakMap-based request id storage.** One WeakMap lookup per request to
    avoid stamping the request object directly. Free at our scale.
13. **`URL.canParse` / `new URL` of upstream URL twice** (once in proxy-core
    for `createUpstreamUrl`, once in `forwardUpstreamRequestWithMode` for
    DNS resolution).
14. **`Headers` ↔ plain object conversions** for log sanitization.
15. **Frozen `Set` lookups** for hop-by-hop / managed / sensitive headers.

### What's *not* the bottleneck (despite looking like it could be)

- **Auth rate-limit map operations.** Steady-state lookups are O(1) Map ops.
  Expired-entry pruning and bounded-capacity eviction can scan the failed-auth
  map when a failure is recorded, but the default 10,000-entry cap keeps that
  work small enough to be invisible at this scale.
- **`crypto.timingSafeEqual` + SHA-256 hashing** of inbound tokens. Cheap,
  bounded.
- **Provider endpoint policy validation.** Runs at config load, not per
  request. The DNS pin lookup is per request but is cache-amortized.
- **Observation queue write.** It's a `push` onto an array that the worker
  drains. The hot path doesn't see the SQLite write.

## Tradeoffs Currently Encoded In The Hot Path

Where the current design has explicitly preferred safety/correctness over
speed, and what the price has been:

- **Round-trip JSON validation** trades one extra `JSON.stringify` for
  defense against parsed-shape size attacks. Could be replaced with a
  streaming bounded-parse, at significant complexity cost.
- **Body-read async-iterator + per-chunk timer race** trades one
  `setTimeout/clearTimeout` per chunk for accurate idle-timeout semantics.
  Could be replaced with a single rolling deadline, at the cost of less
  precise idle reporting.
- **Per-request fresh `Headers` allocation** trades object allocation for
  immutability and the absence of cross-request mutation bugs. A hand-built
  case-insensitive dictionary would be cheaper but riskier.
- **DNS pin cache prune-on-read** trades a small per-request scan for a
  guarantee that expired entries vanish without a separate sweep. Could be
  switched to LRU+time-wheel for sub-microsecond reads at large cache
  sizes.
- **Synchronous logger** trades worst-case latency under disk pressure for
  log-line ordering and immediate visibility on crashes. An async logger
  would be faster at high RPS but would risk losing the last few lines on
  abnormal termination.
- **Bounded-size translator** trades a fully-correct streaming SSE
  translator (which would handle arbitrarily large events) for a simpler
  buffer-and-split implementation that fits naturally into the current
  shape. The cap is `stream_max_event_bytes`.
- **`Idempotency-Key`-gated retries** trade upstream resilience for
  guaranteed exactly-once semantics on POSTs. The default `maxRetries: 0`
  for the proxy hot path is conservative; a future "retry-friendly" route
  flag could change this.
- **One process, one event loop.** Switchmaxxer doesn't fork workers per
  CPU. Per-request CPU is bounded by what one V8 isolate can do. This is
  fine for the local-first deployment shape but caps single-process
  throughput.

## Ports To Other Languages: Possibilities And Challenges

This section assumes the question is "what would it look like to extract
the hot path into a non-V8 implementation?" not "should we do it." The
boundaries above are what makes the question answerable.

### Why the hot path is a *plausible* port target

- **Narrow, well-defined surface.** The hot path is bounded by
  - inbound: HTTP request from `node:http`
  - outbound: HTTP request to upstream via `fetch`
  - sideways: a handful of cold-path interfaces
    (provider-auth resolution, observability enqueue, route catalog
    lookup, configuration snapshot, logger).
  Every one of these is already a function call boundary in TypeScript
  today.
- **No external runtime deps.** Today the hot path uses only `node:*`
  built-ins. There is no transitive npm graph to translate.
- **Stateless per-request.** The only mutable cross-request state is the
  pinning cache, the rate-limit windows, the auth-failure map, and the
  concurrency-cap counters. All of these fit in a few hundred bytes per
  entry and have well-defined eviction.
- **Deterministic translation logic.** `proxy-translation.ts` has no IO
  and no clocks (apart from `Date.now()` for synthetic stream `created`
  fields). It is pure transformation; it ports trivially.

### Two realistic shapes

**Shape A — Native addon (Rust via napi-rs, or C via N-API).** Switchmaxxer
stays a Node process; the hot-path module is a `.node` binary that the JS
side `require()`s. The boundary is the existing TypeScript surface:
`requestHandler`, `executeProxyRequest`, `handleGatewayProxyRequest`. All
the cold-path code (CLI, MCP, observability, config CRUD, optimize, bench)
stays as-is.

- **Pros:** keeps the install story "you have Node 22+ and installed the
  source-checkout dependencies." Lets the cold path keep all its existing code. Lets the
  Rust crate own only the bytes-in-flight parts. Each crossing of the
  JS↔native boundary is a real cost, so the boundary must be drawn at the
  right granularity (probably "give me a request object and a response
  object, take this whole request to completion").
- **Cons:** N-API request/response wrapping is non-trivial. Either you
  build an HTTP server in Rust (using `hyper` or `actix`) and let it
  call back into JS for cold-path work, or you keep `node:http` and copy
  every chunk across the boundary. Each option has real costs.
- **Translation surface:** the Rust crate would need to either reimplement
  the dialect translator natively (lots of code, mostly mechanical) or
  call back into JS for translation (moves the hottest sub-path *out* of
  Rust, which defeats the purpose).
- **Concurrency:** Rust gives you real OS-thread parallelism. The JS side
  is single-threaded. A native hot path could process N concurrent streams
  without contending for the V8 event loop, which is a real qualitative
  improvement under load.

**Shape B — Sidecar process.** The hot path becomes a separate executable
(Rust or C) that accepts the same `/v1/chat/completions` and
`/anthropic/v1/messages` HTTP surface and talks to the Node process over
a Unix domain socket for the cold-path operations it needs (route lookup,
auth resolution, observability enqueue).

- **Pros:** clean separation, independent deploy, no FFI marshaling cost.
  Could be implemented in any language.
- **Cons:** introduces a UDS-RPC contract that is now a versioned API
  surface. Two-process operations need supervision (systemd target unit
  that brings up both, restart coordination). Defeats the "one process,
  one config" simplicity that makes Switchmaxxer easy to operate.

Shape A is the more interesting candidate for a real evaluation. Shape B
is more useful as a thought experiment to clarify what the cold-path
surface area actually is.

### Specific challenges

- **`node:http` semantics.** If the hot path stays behind Node's HTTP
  server, every chunk crosses the FFI boundary. If the hot path *replaces*
  the HTTP server with a Rust one, you give up Node's `http.Server`
  ecosystem (signal handling, keep-alive tuning, the existing test harness
  that builds requests via supertest-like patterns). Tests would need to
  drive a real socket against the Rust listener.
- **`AbortController`/`AbortSignal` interop.** The hot path uses these for
  upstream timeouts and client-disconnect propagation. Rust has its own
  cancellation primitives (`tokio::select!`, `CancellationToken`). The
  boundary code would need to translate between the two cleanly without
  leaking either side's cancellation semantics into the other.
- **Streaming bodies.** The translation streaming relay is the most
  intricate piece. It owns three timers, two abort controllers, and a
  full-duplex backpressure-aware copy. Reimplementing this in Rust on top
  of `tokio` is straightforward; reimplementing the *exact* current
  abort/cleanup semantics so the existing integration tests still pass is
  not. Tests like
  [proxy-runtime.anthropic-streaming.test.ts](../../src/subsystems/proxy/proxy-runtime.anthropic-streaming.test.ts)
  verify behaviors like "fails closed when an anthropic stream closes
  mid-SSE-event after partial output" — the new implementation has to
  match those exactly.
- **DNS pinning interop with the Rust HTTP client.** `hyper` and `reqwest`
  have their own connection logic. Pinning to a specific resolved IP while
  preserving the original `Host`/SNI requires custom resolvers or
  connector wiring. Doable; not free.
- **Provider-auth secret crossing.** `SecretString.reveal()` is the only
  way out of the secret type, and CI gates its callers. A Rust hot path
  needs an equivalent boundary with an equivalent CI gate, or it needs
  the JS side to hand it the cleartext at request time (which means
  one cross-FFI string copy per request).
- **Observability enqueue.** Today it's `worker.push(record)` in-process.
  From Rust this becomes either a callback into JS per record (cheap if
  batched, expensive per-call) or a parallel enqueue into a SQLite
  connection that Rust owns. The latter introduces a second writer to the
  observability DB, which is a contract change.
- **Build story.** A Rust hot path means every developer needs `rustc`
  and `cargo`, every CI job needs them, and the npm artifact either ships
  prebuilt addons (linux-x64, linux-arm64, darwin-x64, darwin-arm64,
  win32-x64, plus glibc/musl variants) or forces source compilation at
  install time. This is the user-facing cost.
- **Debuggability.** A V8 stack trace in TypeScript is one of
  Switchmaxxer's better operator-experience properties. Rust panics across
  an FFI boundary land as opaque errors in the JS side unless explicit
  error mapping is built. `--enable-source-maps` does not help for native
  code.

### What a port would *not* fix

- **Upstream RTT.** The dominant per-request latency at low/medium RPS is
  network time to the model provider. No amount of language work changes
  this.
- **Provider rate limits.** OpenAI's TPM caps don't care what language is
  asking.
- **TLS handshake cost on cold connections.** Connection pooling helps
  more than language choice.
- **JSON.parse on the inbound body.** V8's `JSON.parse` is C++ already and
  is fast. Switching to `serde_json` or `simdjson` would help on big
  bodies but is not the first place performance comes from at typical
  Switchmaxxer payload sizes.

### What a port *could* meaningfully fix

- The streaming-translator per-byte multiplier (B3). A native, zero-copy,
  state-machine-driven SSE translator would do roughly 1× work over the
  bytes instead of the current ≈4× (decode, buffer, JSON-parse, JSON-
  stringify). For high-throughput streaming workloads, this is a real win.
- Per-request allocation pressure (B4, B7). Native-side request handling
  with arena/pool allocators instead of fresh-per-request objects.
- True multi-core. The JS event loop is single-threaded; a native server
  could handle N requests on N cores. For local-first single-operator use
  cases this rarely matters; for any deployment past one user, it would.
- Steady-state memory profile. V8's GC is good but still pauses; a Rust
  hot path has predictable per-request memory.

### What a port should preserve, regardless of language

The behavioral contract that the integration suite verifies. Concretely:

- All existing 4xx/5xx error codes and their exact JSON shapes
  ([src/platform/error-codes.ts](../../src/platform/error-codes.ts)).
- DNS pinning, `allow_private_endpoints`, redirect-manual semantics.
- Inbound auth model (env-resolved, ≥32 chars, timing-safe compare,
  exponential auth backoff, loopback enforcement when unauth).
- Per-caller rate limiter and the standard `RateLimit-*` headers.
- Header sanitization (hop-by-hop, managed, value-shape) symmetric on
  ingress and egress.
- Streaming caps (idle/lifetime/byte/event/rate) and the abort propagation
  that goes with them.
- Observation surface — the same record fields hitting the same store, so
  trace/bench/optimize keep working unchanged.
- `Idempotency-Key` retry policy.

If a port is undertaken, the existing `npm run test:integration` suite is
the natural acceptance test. Anything that doesn't pass that suite is not
a drop-in replacement.

## Where To Start, If You Are Trying To Make It Faster

A practical optimization order, cheapest-first:

1. **Measure before optimizing.** Run `npm run perf:gateway` (see
   [src/subsystems/gateway/perf-gateway.ts](../../src/subsystems/gateway/perf-gateway.ts))
   under a representative workload and capture a flamegraph. Don't pick a
   target from this document without confirming it's where your wall time
   actually goes.
2. **Drop the round-trip JSON shape validation** for trusted-shape paths
   if your workload has known-bounded payloads. Replace with a single
   bounded-parse that tracks size during parse instead of after. Saves
   ~30-40% of inbound JSON CPU on large bodies.
3. **Replace per-chunk `setTimeout/clearTimeout`** in the body reader and
   streaming reader with a single rolling deadline checked on each
   iteration. Lower-precision idle reporting, lower allocation pressure.
4. **Inline header sanitization** with a hand-coded byte-level check that
   avoids regex backtracking on common-case ASCII inputs.
5. **Pool the `ProxyRequestContext` and `Headers`** allocations behind an
   object-pool with a per-request reset. Real win at high RPS, real risk
   if you mishandle the reset; only worth doing with a strong test suite
   and isolated benchmarks.
6. **Pre-resolve provider DNS at config load** for known-stable providers
   so the first request doesn't pay the lookup. Refresh on the cache TTL
   schedule.
7. **Make the streaming translator zero-copy** for the pass-through paths
   (already mostly the case via `pipe`) and state-machine-driven for the
   dialect-translation paths. Avoid the JSON-parse-then-stringify step by
   transforming the SSE chunk in-place.
8. **Connection-pool tuning per upstream provider** with explicit
   `Agent`/`Pool` configuration instead of relying on undici's default.
   Useful for stable workloads with a small set of providers.
9. **Only after all of the above:** consider extracting the
   bytes-in-flight portion into a native addon. The TypeScript hot path
   has a lot of headroom before that becomes the highest-value change.

The point of this doc is that you can pick any of those without rewriting
the whole gateway, because each one corresponds to a specific boundary
above. That is what the boundary structure is for.
