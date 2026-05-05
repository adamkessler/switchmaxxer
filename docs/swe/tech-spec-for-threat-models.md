# Threat Model Tech Spec

## Purpose

This document records concrete threat scenarios that Switchmaxxer should defend against or intentionally classify as out of scope.

It complements [tech-spec-for-security.md](./tech-spec-for-security.md) by turning broad security posture into testable attack stories.

## Threat Modeling Rules

Each threat model entry should include:

- the protected asset
- the trust boundary crossed by the attacker
- the attempted exploit flow
- the expected control
- the regression tests or verification points that pin the behavior

Security-sensitive local endpoints should fail closed before relying on browser CORS behavior, operator convention, or obscurity of request IDs.

## Runtime Control-Plane Secret Reveal From Browser-Originated Local Requests

### Protected Asset

Switchmaxxer must protect upstream provider credentials, inbound gateway tokens, and secret-bearing runtime inspection captures.

### Trust Boundary

The gateway is a local HTTP server. Browser pages from unrelated origins can still attempt requests to loopback addresses such as `127.0.0.1` or `[::1]`.

When `allow_unauthenticated_gateway: true` is enabled, the gateway intentionally accepts unauthenticated local first-party clients. That does not mean every browser-originated local request should be trusted.

### Attempted Exploit

An attacker-controlled page tries to issue a browser GET to a local runtime endpoint:

```text
GET http://127.0.0.1:<port>/__switchmaxxer/runtime/inspect/<uuid>?include_secrets=true
```

The request has a loopback `Host` header because the browser is genuinely targeting loopback. If the server only checks `Host`, the request can reach runtime inspection handling.

If `include_secrets=true` is honored in unauthenticated mode, the inspection payload can include unredacted `Authorization`, API key, token, or secret-bearing headers from the client-to-gateway and gateway-to-provider exchanges.

Browser CORS may prevent page JavaScript from reading the response body in many configurations, but the server must not rely on CORS as the primary protection for secret-bearing local control-plane data.

### Expected Controls

Runtime control-plane endpoints under `/__switchmaxxer/runtime/*` must apply the same unauthenticated local-client checks as data-plane gateway calls:

- require `x-switchmaxxer-local-client: 1` unless
  `one_trusted_operator_boundary: true` explicitly places loopback callers
  inside the trusted local operator boundary
- reject cross-site `Origin` values
- reject suspicious `Sec-Fetch-Site` metadata
- reject browser navigation, websocket, and `no-cors` fetch modes
- continue requiring loopback source and loopback-compatible `Host`
- enforce these controls in the runtime request wrapper from the route's trust
  class before dispatching to runtime-config or runtime-inspect handlers

Runtime inspection must also treat unredacted secret reveal as privileged:

- inspection capture IDs and read tokens are allocated by the gateway and
  returned in `x-switchmaxxer-inspect-id` and
  `x-switchmaxxer-inspect-token`; callers request capture creation with
  `x-switchmaxxer-inspect: 1` instead of choosing the storage key
- ordinary inspection reads require the matching one-time
  `x-switchmaxxer-inspect-token` before the capture is consumed
- `include_secrets=true` is rejected when the gateway is in explicit unauthenticated mode
- `include_secrets=true` is allowed only after inbound gateway auth has been configured and the request has satisfied that auth
- `include_secrets=true` also requires the gateway process to opt in with `SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`
- gateway-to-provider secret-bearing headers remain redacted even when secret-inclusive inspection is enabled
- every secret-reveal request emits a high-priority gateway observation
- ordinary inspection reads remain redacted by default

### Regression Coverage

Gateway tests should pin:

- unauthenticated runtime config reads reject missing local-client headers by
  default
- unauthenticated runtime config reads accept missing local-client headers when
  `one_trusted_operator_boundary: true`
- unauthenticated runtime config reads reject cross-site browser metadata
- unauthenticated runtime inspection reads reject missing local-client headers
  by default
- unauthenticated runtime inspection reads reject cross-site browser metadata
- unauthenticated unknown runtime control-plane GETs reject before route-specific
  dispatch when local-client proof is missing
- data-plane inspection rejects caller-supplied `x-switchmaxxer-inspect-id` and
  `x-switchmaxxer-inspect-token`
- data-plane inspection returns a gateway-allocated `x-switchmaxxer-inspect-id`
  and `x-switchmaxxer-inspect-token` when the caller sends
  `x-switchmaxxer-inspect: 1`
- inspection reads without the matching read token fail and do not consume the
  capture
- unauthenticated `include_secrets=true` inspection reads are rejected
- authenticated `include_secrets=true` inspection reads are rejected without `SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`
- authenticated and explicitly opted-in `include_secrets=true` inspection reads still redact upstream provider auth headers

## Accidental Remote Gateway Exposure

### Protected Asset

Switchmaxxer must protect upstream provider quota, local runtime assumptions,
and any gateway control surfaces that are intended for local operators.

### Trust Boundary

The default gateway deployment is local-first. Binding to loopback means callers
must already be on the same machine. Binding to `0.0.0.0`, `::`, a LAN address,
or another non-loopback host can cross into a remote network trust boundary.

### Attempted Exploit

An operator intends to run a local authenticated gateway but configures:

```json
{
  "bind_host": "0.0.0.0",
  "inbound_api_key_env": "SWITCHMAXXER_INBOUND_API_KEY"
}
```

Without an explicit remote-bind gate, this can expose the data-plane gateway to
LAN, VPN, container-network, or public callers depending on the host firewall
and deployment shape.

### Expected Controls

Non-loopback listener binds require explicit elevated-mode configuration:

- `allow_remote_bind: true`
- a configured `inbound_api_key_env`
- no `allow_unauthenticated_gateway: true`
- a startup warning that the gateway may be reachable from other machines
- continued loopback gating for runtime control-plane reads

Wildcard listener binds such as `0.0.0.0` and `::` require the additional
`allow_wildcard_bind: true` acknowledgement and emit a stronger warning that
the gateway is binding to all network interfaces.

### Regression Coverage

Gateway/config tests should pin:

- unauthenticated non-loopback binds are rejected
- authenticated non-loopback binds are rejected without `allow_remote_bind: true`
- authenticated non-loopback binds are accepted with `allow_remote_bind: true`
- wildcard binds are rejected without `allow_wildcard_bind: true`
- wildcard binds are accepted only with both remote-bind and wildcard-bind opt-ins
- `allow_remote_bind: true` is rejected without inbound auth
- distinct warning text is produced for explicit non-loopback and wildcard bind
  modes

## Health Host-Header Probing Without Backoff

### Protected Asset

Gateway health endpoints should expose only bounded liveness information and
should not provide an unlimited oracle for local Host-header policy.

### Trust Boundary

`/health` can be intentionally exposed without a bearer token when inbound auth
is configured and `allow_unauthenticated_health: true` is set. That exception is
for loopback-style probes only. A caller that reaches the socket but sends an
unexpected `Host` header is crossing from unauthenticated probing into gateway
trust-policy evaluation.

### Attempted Exploit

A caller repeatedly probes:

```text
GET /health
Host: attacker.example
```

If the gateway answers `421` before touching failed-auth accounting, the caller
can enumerate Host-header acceptance behavior without ever hitting backoff.

### Expected Controls

Unexpected health `Host` values should:

- register a failed-auth attempt keyed by normalized socket source IP
- continue returning `421 misdirected_request` while the source is below the
  failed-auth threshold
- return `429 auth_rate_limited` with `Retry-After` after repeated probes from
  the same source
- avoid trusting `X-Forwarded-For` or other caller-supplied peer metadata
- on loopback, multiple local processes share the same normalized source IP
  bucket, so one noisy local caller can temporarily back off another; this is
  accepted for the current local-first model

### Regression Coverage

Gateway tests should pin:

- the first bad-Host anonymous health probes return `421`
- repeated bad-Host anonymous health probes trip failed-auth backoff and return
  `429`
- anonymous health success does not reset existing failed-auth backoff

## Provider Endpoint Special-Use IP SSRF

### Protected Asset

Switchmaxxer must protect local services, private networks, provider credentials,
and operator machines from configured provider endpoints that route somewhere
other than an intended public upstream provider.

### Trust Boundary

Provider endpoint URLs are operator-controlled configuration and MCP/CLI
mutation input. They cross from persisted config into outbound network
connections made by the gateway process. A hostname or IP literal that looks
harmless at configuration time can still target loopback, private, reserved, or
special-use address space.

### Attempted Exploit

An attacker or mistaken config mutation points a provider endpoint at a special
address:

```text
https://[::1]/v1/chat/completions
https://[fe90::1]/v1/chat/completions
https://[2001::1]/v1/chat/completions
https://[2001:db8::1]/v1/chat/completions
https://[64:ff9b::c000:201]/v1/chat/completions
```

The goal is to make the gateway send provider-shaped traffic to localhost,
link-local infrastructure, reserved documentation/benchmarking ranges, IPv6
transition mechanisms, or an address that DNS later rebinds to private space.

### Expected Controls

Provider endpoint validation and resolution-time policy must:

- reject loopback, unspecified, link-local, multicast, ULA, documentation,
  benchmarking, discard-only, Teredo, 6to4, and IPv4/IPv6 translation literals
  unless `allow_private_endpoints: true` is explicitly set for that provider
- treat
  [`IPV6_SPECIAL_USE_RANGES`](../../src/subsystems/hot-path/manatee/proxy/provider-endpoint-policy.ts#L49-L101)
  as the implementation source of truth for the exact IPv6 special-use range
  list
- treat IPv4-mapped IPv6 literals according to the embedded IPv4 address, so
  `::ffff:127.0.0.1` and `::ffff:192.0.2.1` inherit the IPv4 block policy
- use explicit IPv6 CIDR ranges rather than broad string prefixes; for example,
  Teredo is `2001::/32`, documentation is `2001:db8::/32`, and link-local is
  `fe80::/10`
- continue allowing ordinary public IPv6 provider literals such as
  `2001:4860:4860::8888`
- repeat the same private/special-use check after DNS resolution and pin the
  accepted DNS answer into the socket connection path
- reject automatic HTTP redirect following unless every redirect target is
  revalidated through the same endpoint and DNS policy

The defensive posture is intentionally conservative: documentation and
benchmarking addresses are not private networks, but they are also not valid
production provider destinations and should fail closed.

### Regression Coverage

Proxy tests should pin:

- static URL validation rejects representative IPv4 private/reserved ranges
- static URL validation rejects representative IPv6 special-use ranges,
  including `fe80::/10`, `fc00::/7`, `ff00::/8`, `64:ff9b::/96`,
  `64:ff9b:1::/48`, `100::/64`, `2001::/32`, `2001:2::/48`,
  `2001:db8::/32`, and `2002::/16`
- `2001:0:*` Teredo-style addresses are blocked because they are inside
  `2001::/32`, while ordinary public `2001:*` addresses remain allowed
- `2001:db8::/32` is blocked as documentation/special-use space, not because
  every `2001:*` address is suspicious
- full link-local coverage uses `fe80::/10`, so addresses such as `fe90::1`
  are blocked
- IPv4-mapped IPv6 literals inherit the embedded IPv4 policy
- runtime DNS answers that resolve to private or special-use addresses are
  rejected and negatively cached when private endpoints are not allowed

## Local Probe JSON Resource Exhaustion

### Protected Asset

Gateway control-plane clients must not let malformed local HTTP responses crash
or stall CLI, MCP, or runtime reload/status workflows.

### Trust Boundary

Loopback HTTP responses are local, but they are still bytes from a process behind
a socket. The caller might reach the wrong process, a malformed gateway, or a
future endpoint whose payload shape has drifted.

### Attempted Exploit

A local process answers `/health` or `/__switchmaxxer/runtime/config` with a very
large JSON response or a deeply nested JSON document. If callers parse the body
with `response.json()`, they can buffer and parse unbounded data.

### Expected Controls

Local gateway probes should:

- avoid `response.json()`
- reject oversized responses before buffering when `Content-Length` is present
- stream-read response bodies with an explicit byte cap
- parse through `parseJsonWithinBounds`
- require object payloads before inspecting control-plane fields

### Regression Coverage

Gateway/platform tests should pin:

- declared oversized response bodies are rejected before buffering
- streamed response bodies are rejected when they cross the byte cap
- local runtime-config clients reject oversized probe responses
- health probes return a failed result instead of parsing oversized probe
  responses

## Local Lockfile JSON Resource Exhaustion

### Protected Asset

Config mutation commands must not let malformed local coordination files crash or
stall CLI or MCP mutation workflows.

### Trust Boundary

Config mutation lock files are local filesystem state, but they may be left
behind by interrupted processes, edited by operators, or created by another
local process in the same config directory.

### Attempted Exploit

A local process leaves `${configPath}.lock` as a very large file or a deeply
nested JSON document. If stale-lock recovery reads and parses it without bounds,
config mutation commands can spend excessive memory or CPU before deciding
whether the lock is stale.

### Expected Controls

Config mutation lock metadata should:

- be read with a small byte cap
- be parsed through `parseJsonWithinBounds` with tight depth and node limits
- be treated as optional metadata; malformed or oversized metadata falls back to
  filesystem mtime for stale-lock recovery

### Regression Coverage

Config mutation tests should pin:

- malformed stale lock metadata is reclaimed through mtime fallback
- oversized stale lock metadata is reclaimed through mtime fallback
- valid stale lock metadata is still parsed when the lock file uses secure
  permissions

## Log Redaction Over-Matching And Resource Exhaustion

### Protected Asset

Operational logs and persisted diagnostic messages must protect secrets without
destroying useful non-secret identifiers or spending unbounded CPU on hostile
message text.

### Trust Boundary

Log messages often include attacker-influenced request fields, upstream error
messages, provider response snippets, and local exception text. These strings are
not trusted just because they are on their way to a log sink.

### Attempted Exploit

A caller causes a very large error/log message or a diagnostic token shaped like
`REQ_0123456789abcdef0123456789abcdef`. If the redactor scans the entire string
with broad generic token patterns, it can waste CPU and redact harmless request
or hash identifiers that operators need during debugging.

### Expected Controls

Log redaction should:

- cap the input length before regex scanning
- preserve a truncation marker when text is clipped
- keep explicit known provider-token patterns
- limit generic redaction to contextual secret-key forms such as
  `api_key=...`, `provider_token: ...`, or `client_secret=...`
- avoid redacting ordinary request ids, trace ids, UUIDs, hashes, and checksums

### Regression Coverage

Logger tests should pin:

- known secret shapes are redacted
- contextual env-style secrets keep the key name and redact only the value
- ordinary prefixed ids and hashes are not redacted
- oversized redaction inputs are truncated before scanning the full string
- final sanitized log values include a truncation marker when clipped

## Ephemeral Inspection Capture Retention And Memory Pressure

### Protected Asset

Runtime inspection captures may contain request and response bodies plus local
auth-like metadata. They must remain short-lived debug artifacts, not
long-lived or unbounded in-memory records.

### Trust Boundary

Inspection captures are created by local operator debug flows, but they still
hold caller-controlled data copied from client requests and upstream provider
exchanges. A low-traffic gateway should not retain expired debug data just
because no later inspection request arrived to trigger cleanup, and a noisy
caller should not be able to fill every capture slot with maximum-size payloads
without an aggregate memory ceiling.

### Attempted Exploit

A caller creates an inspected invoke and never reads the capture back. If cleanup
is only lazy, the capture can remain in memory past its TTL until the next
inspection allocation or read touches the store.

A caller can also create inspected invokes with large request and response
bodies. Per-body truncation and capture-count limits bound the current blast
radius, but the store must have its own total byte budget so future increases to
per-capture limits or capture count do not silently expand attacker-controlled
memory.

### Expected Controls

Inspection capture storage should:

- allocate capture ids server-side
- cap capture count, per-body capture bytes, and aggregate store bytes
- prune lazily on allocate/read for immediate correctness
- prune actively on an unref'd interval no longer than half the capture TTL
- evict oldest captures until count, TTL, and byte-budget constraints are all
  satisfied
- expose a disposable store lifecycle and clear the interval during gateway
  graceful shutdown

### Regression Coverage

Gateway tests should pin:

- active prune intervals are scheduled with `unref()` where available
- interval cleanup prunes expired captures and removes request-id bindings
- store byte-budget pruning removes oldest captures and removes request-id
  bindings while preserving newer captures within budget
- store disposal clears the prune interval exactly once
- graceful shutdown disposes request-handler runtime resources once

## Maintenance

When a new endpoint crosses a trust boundary, add a threat entry before or alongside the implementation. The entry should name the abuse case in plain language and point to the controls that make the endpoint safe.
