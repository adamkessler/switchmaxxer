# Security Tech Spec

## Purpose

This document defines Switchmaxxer's current security posture.

It answers five questions:

1. What Switchmaxxer is trying to defend.
2. What the codebase actively hardens today.
3. Which exploit classes are explicitly mitigated.
4. Which exploit classes are intentionally out of scope or operator-controlled.
5. Which exploit classes are simply irrelevant to this product shape.

This is a current-contract document. It describes the code as it exists today, not historical migration state.

## Product Shape

Switchmaxxer is a local-first operator tool and gateway with three main surfaces:

- a local CLI
- a local MCP surface
- an HTTP gateway that proxies requests to configured upstream model providers

The codebase is not a browser application, not a public multi-tenant SaaS, and not a general-purpose reverse proxy.

## Security Posture

Switchmaxxer is built around a fail-closed, defense-in-depth posture:

- inbound gateway access is authenticated unless the operator explicitly opts into unauthenticated localhost-style operation
- outbound provider routing is hardened against SSRF, private-address resolution, insecure transport, and DNS rebinding by default
- config and observability files are treated as sensitive local assets
- request parsing and response translation are structurally bounded
- secrets are redacted by default in logs, serialization, and operator-facing displays
- local persistence failures are intended to degrade gracefully rather than widen trust

The project assumes hostile inputs on the network surface, malformed config, malicious or buggy upstreams, and accidental operator misconfiguration.

It does not attempt to defend against a fully malicious local user who already controls the same machine, filesystem, or process environment as the Switchmaxxer operator.

## Threat Model

### In Scope

Switchmaxxer actively defends against:

- unauthenticated or weakly authenticated inbound gateway use
- SSRF through provider endpoint configuration
- DNS rebinding between provider hostname resolution and the actual socket connection
- insecure upstream transport by default
- request-header injection and CRLF-style forwarded-header smuggling
- malformed, oversized, or structurally abusive JSON request/config bodies
- prototype-pollution style entity names in config and mutation paths
- accidental secret disclosure through logs, JSON serialization, CLI output, and MCP output
- unsafe config file reads, including symlinked config paths and insecure permissions
- excessive or malformed upstream streaming behavior, including oversized SSE events, total stream overrun, low-throughput dribble, and stream lifetime overrun
- local observability store path and file permission mistakes

### Out Of Scope

Switchmaxxer does not try to defend against:

- a malicious local operator with direct shell, filesystem, or environment-variable access
- compromise of the host operating system
- compromise of third-party upstream providers at the semantic application level
  - Switchmaxxer can bound and sanitize transport behavior, but it cannot prove that a configured public upstream is truthful
- network attackers after an operator explicitly opts into weakened settings such as:
  - `allow_private_endpoints: true`
  - `allow_insecure_http: true`
  - `allow_unauthenticated_gateway: true`

### Deployment Assumptions

The intended secure posture is:

- Switchmaxxer binds locally or to an explicitly controlled interface
- inbound auth is enabled for any non-trivial deployment
- a reverse proxy is not placed in front of the listener unless the operator understands the rate-limit and source-IP consequences
- provider endpoints remain on canonical public HTTPS origins unless the operator explicitly overrides that posture

## Trust Boundaries

The main trust boundaries are:

- inbound client -> gateway
- gateway -> configured upstream provider
- operator config file -> normalized runtime config
- runtime -> observability SQLite store
- runtime secret state -> logs / CLI / MCP output

Most hardening in the codebase exists to keep those boundaries narrow and explicit.

## Beginner Overview: Loopback And Local-Only Hosts

New contributors will see terms like `loopback`, `localhost`, `private
endpoint`, and `local-only` throughout the gateway and provider-endpoint code.
Those terms are related, but they are not identical.

In simple terms:

- a **loopback** host means "this machine talking to itself"
- a **local-only** host usually means a host that is not globally routable on
  the public internet
- a **private/local endpoint** is a broader category than loopback and can
  include RFC1918 space, link-local addresses, and other non-public ranges

Examples of loopback hosts:

- `localhost`
- `127.0.0.1`
- `127.x.x.x`
- `::1`
- IPv4-mapped IPv6 loopback such as `::ffff:127.0.0.1`

Examples of non-loopback but still local/private hosts:

- `10.0.0.5`
- `192.168.1.20`
- `172.16.0.10`
- `169.254.x.x`
- `fe80::...`

Why this matters in Switchmaxxer:

- unauthenticated gateway mode is only allowed when the operator keeps the
  gateway on a loopback-style bind host
- unauthenticated localhost-style requests are accepted only when the request
  also targets an allowed local `Host` value
- provider endpoints are blocked by default when they point at loopback,
  private, link-local, or other non-public destinations unless the operator
  explicitly opts in with `allow_private_endpoints: true`

That means Switchmaxxer uses the same family of host-classification ideas in
two different ways:

- **inbound safety**: deciding whether a request is truly local enough for
  special localhost-only behavior
- **outbound safety**: deciding whether a configured provider endpoint is too
  local/private to allow by default because it could become an SSRF target

The code intentionally centralizes the basic loopback-host check in
[src/platform/net-utils.ts](../../src/platform/net-utils.ts) so the gateway, config validation,
and provider-endpoint policy do not drift on simple cases like `localhost`,
`127.0.0.1`, or `::1`.

The important mental model is:

- **loopback** is the narrowest "same machine" category
- **private/local** is the broader "not public internet" category
- Switchmaxxer treats both as security-relevant, but not interchangeable
  concepts

## Security Controls

### 1. Inbound Authentication

Gateway inbound auth is fail-closed by default in the gateway request handler's
misconfiguration and token-mismatch paths
([src/subsystems/gateway/runtime.ts](../../src/subsystems/gateway/runtime.ts))
and [src/subsystems/gateway/local-gateway-auth.ts](../../src/subsystems/gateway/local-gateway-auth.ts).

Current protections:

- inbound auth tokens come from an environment variable, not from config inline secret text
- configured inbound auth tokens must be at least 32 characters long
- token comparison uses `timingSafeEqual` over SHA-256 digests, not naïve string equality
- misconfigured inbound auth returns failure, not implicit access
- explicit unauthenticated mode is allowed only when the operator chooses it
- explicit unauthenticated mode is documented as a development escape hatch,
  not a normal production posture
- unauthenticated gateway mode now rejects unexpected `Host` headers and only accepts loopback-style targets such as `127.0.0.1`, `localhost`, and `::1`
- unauthenticated gateway proxy POSTs require `Content-Type: application/json`
  and, unless `one_trusted_operator_boundary: true` is explicitly configured,
  `X-Switchmaxxer-Local-Client: 1`
- unauthenticated gateway proxy POSTs reject browser-originated cross-site
  signals such as hostile `Origin`, `Sec-Fetch-Site`, and `Sec-Fetch-Mode`
  values
- gateway request path parsing uses a stable internal base instead of raw
  `Host`, so malformed boundary input is classified by the Host guard as a
  `misdirected_request` instead of surfacing as an internal server error
- malformed request targets are rejected as `invalid_request`

Future tech debt / research item:

- inbound auth currently hashes both the candidate token and expected token with SHA-256 before `timingSafeEqual`
- this keeps the constant-time compare on fixed-length digests and avoids leaking raw token length differences through a length-mismatch fast path
- the extra hash work is probably acceptable today, but it is on a hot request path
- a future gateway perf/security review should explicitly re-evaluate whether the length-normalization benefit is still worth the cost, or whether the inbound token contract should move to a fixed-length direct compare with equally clear documentation

Why that `Host` check matters:

- browsers can be tricked into talking to loopback services through DNS rebinding
- in a rebinding attack, a malicious page loads a hostname it controls, then changes that hostname's DNS answer from a public IP to `127.0.0.1` or another loopback address
- the browser can keep treating the request as the original attacker-controlled origin while sending the actual socket connection to the local machine
- if a local service trusts loopback alone and does not validate `Host`, the malicious page can sometimes drive that local service through the browser
- Switchmaxxer narrows that window in unauthenticated mode by requiring the
  request to target an allowed local `Host`, requiring an explicit local-client
  header unless the trusted-operator boundary is enabled, requiring JSON content
  type, and rejecting cross-site browser request metadata
- loopback no-auth is not considered safe against malicious webpages by itself;
  keep inbound auth enabled for real workflows

### 2. Source-IP Handling And Rate Limiting

Gateway auth backoff keys on the connected socket peer address, not
caller-supplied forwarded headers, through
[`gatewayRequestSourceIp`](../../src/subsystems/gateway/runtime-helpers.ts).
Gateway request limiting uses
[`gatewayRateLimitKey`](../../src/subsystems/gateway/runtime-helpers.ts), which
combines that trusted source IP with the classified route trust class so
data-plane traffic and runtime control-plane reads have separate buckets.

Current protections:

- no blind trust of `X-Forwarded-For`
- spoofed forwarded headers do not bypass the failed-auth limiter
- auth failures escalate to backoff/429 responses
- global request rate limiting emits bounded retry hints

Implication:

- this is the safe default against spoofing
- it is not a trusted-proxy deployment model

### 3. Provider Endpoint Hardening And SSRF Defenses

Outbound provider routing is one of the most security-sensitive surfaces.

The core controls live in:

- [src/subsystems/proxy/provider-endpoint-policy.ts](../../src/subsystems/proxy/provider-endpoint-policy.ts)
- [src/subsystems/proxy/http-transport.ts](../../src/subsystems/proxy/http-transport.ts)
- [src/subsystems/proxy/proxy-forwarding.ts:225](../../src/subsystems/proxy/proxy-forwarding.ts#L225)

Current protections:

- HTTPS is required by default
- URL userinfo is not accepted
- private, loopback, link-local, and other non-public IPs are blocked by default
- hostname resolution is validated before connect
- the resolved IP is pinned into the actual outbound socket connect path
- provider HTTP redirects are not followed automatically
- DNS pinning cache exists, including cached rejection of private-address
  resolutions when private endpoints are not allowed
- private endpoints are allowed only by explicit per-provider opt-in

Private endpoint opt-in:

- when a provider enables `allow_private_endpoints: true`, private DNS answers
  become allowed but hostnames still use pinned-resolution dispatch
- literal IP endpoints and `localhost`-style names skip DNS pinning because
  there is no external DNS hostname to rebind
- operators should still treat this as a trust expansion because Switchmaxxer
  is allowed to contact private-address destinations for that provider

This protects against:

- basic SSRF to localhost and RFC1918-style targets
- DNS rebinding between lookup and connect
- redirect-assisted SSRF from a validated provider endpoint into a local or
  private-address target
- insecure default transport to upstream providers

### 4. Request Header Hardening

Forwarded request headers are sanitized by `sanitizeIncomingHeaders` in
[src/subsystems/proxy/proxy-headers.ts](../../src/subsystems/proxy/proxy-headers.ts).

Current protections:

- hop-by-hop headers are stripped
- managed auth and routing headers are owned by Switchmaxxer, not blindly forwarded from callers
- browser-local context headers (`cookie`, `origin`, `referer`, and caller
  `user-agent`) are stripped or rewritten before provider egress
- forwarded header values must stay within a safe printable range
- forwarded header values are size-capped
- invalid forwarded header values fail the request early

This protects against:

- CRLF/header-smuggling style injection on the forwarded request path
- oversized forwarded header value abuse inside the proxy boundary
- accidental disclosure of local browser app context to upstream providers

### 5. Upstream Response Header Hardening

Upstream response headers are filtered by `copyResponseHeaders` in
[src/subsystems/proxy/proxy-headers.ts](../../src/subsystems/proxy/proxy-headers.ts).

Current protections:

- hop-by-hop headers are stripped
- response header names are validated
- response header values are validated with the same safe-value guard used on ingress
- `set-cookie` and `set-cookie2` are dropped by default

This protects against:

- relaying cookie-setting behavior from hostile or compromised upstreams
- malformed response-header injection from configured providers

### 6. Structured Input Bounding

Switchmaxxer bounds JSON and config parsing before and after parse.

The core controls live in:

- [src/platform/json-bounds.ts](../../src/platform/json-bounds.ts)
- [src/subsystems/config/config-read.ts](../../src/subsystems/config/config-read.ts)
- [src/subsystems/cli/input-utils.ts](../../src/subsystems/cli/input-utils.ts)
- [src/subsystems/cli/structured-input-detect.ts](../../src/subsystems/cli/structured-input-detect.ts)

Current protections:

- config and request bodies are byte-bounded before parse
- CLI structured `--stdin` and `--json-input` bodies are byte-bounded before
  parse
- parsed JSON is depth-bounded
- parsed JSON is node-count bounded
- malformed JSON fails before deeper normalization

This protects against:

- memory abuse through oversized JSON
- deeply nested JSON intended to blow recursion or parser cost
- structurally abusive but byte-small JSON payloads
- agent-fed local CLI input that attempts to exhaust memory before validation

### 7. Config Path And File Hardening

Config file reading is treated as a security boundary.

The core controls live in:

- [src/subsystems/config/config-read.ts](../../src/subsystems/config/config-read.ts)
- [src/subsystems/config/config.ts](../../src/subsystems/config/config.ts)

Current protections:

- symlinked config paths are rejected
- insecure config-file permissions are rejected
- config files containing inline secrets are treated as sensitive local assets
- external top-level config naming is strict and validated
- unsupported fields fail closed instead of being silently accepted in the validated config path
- `secrets.json` path resolution is reserved for sparse machine-local secret
  overrides, defaulting to the operator config directory and supporting
  `SWITCHMAXXER_SECRETS_PATH` for explicit placement
- loaded `secrets.json` files inherit the config reader's symlink rejection,
  size limit, and owner-only file-mode checks
- explicitly configured secrets paths fail closed when absent or symlinked; the
  default secrets path remains optional

This protects against:

- symlink tricks against config reads
- accidental exposure of local config secrets through loose file mode
- typoed or ambiguous config shape reaching the runtime silently

### 8. Secret Handling

Secret-bearing values are intentionally hostile to accidental serialization.

The core controls live in:

- [src/platform/secret-string.ts](../../src/platform/secret-string.ts)
- [src/platform/logger.ts:111](../../src/platform/logger.ts#L111)
- [src/platform/masked-secret.ts](../../src/platform/masked-secret.ts)

Current protections:

- `SecretString` redacts itself through stringification, JSON, and inspect
- log redaction masks bearer tokens, inline API keys, and URL credentials
- log redaction bounds regex work before scanning attacker-influenced text and
  uses a truncation marker when clipping output
- provider `api_key_env` is treated as semi-sensitive in CLI/MCP display surfaces
- full inline provider API keys are not echoed through normal read-model surfaces
- local `secrets.json` files are excluded from git by default
- loaded `secrets.json` values are wrapped in `SecretString`
- the only accepted secrets-file schema today is sparse
  `api_key_overrides`, keyed by `SWITCHMAXXER_...` environment variable names
- provider auth resolves inline `api_key` first for compatibility, then
  matching `secrets.json` overrides for `api_key_env`, then the process
  environment

This protects against:

- accidental secret leaks in logs
- accidental secret leaks in CLI and MCP output
- copy-paste leakage of secret-adjacent environment variable naming

### 9. Provider Auth Resolution

Provider auth is resolved per route with explicit misconfiguration handling in [src/subsystems/config/provider-auth.ts](../../src/subsystems/config/provider-auth.ts) and [src/subsystems/proxy/proxy-core.ts](../../src/subsystems/proxy/proxy-core.ts).

Current protections:

- provider auth precedence is inline `api_key`, then matching `secrets.json`
  override for `api_key_env`, then the real process environment
- missing provider auth env vars fail closed
- whitespace-only env vars are treated as empty
- invalid provider auth returns a controlled `invalid_provider_auth` error instead of a malformed upstream call
- provider auth is not logged in cleartext

### 10. Streaming Hardening

Streaming is one of the highest-risk runtime paths, and the code actively bounds it.

The core controls live in:

- [src/subsystems/proxy/proxy-streaming.ts](../../src/subsystems/proxy/proxy-streaming.ts)
- [src/subsystems/proxy/proxy-forwarding.ts](../../src/subsystems/proxy/proxy-forwarding.ts)
- [src/subsystems/proxy/proxy-response-handlers.ts](../../src/subsystems/proxy/proxy-response-handlers.ts)

Current protections:

- idle streaming behavior is bounded
- absolute stream lifetime is bounded
- sustained bytes-per-second is enforced
- total streamed bytes are bounded
- individual Anthropic SSE event size is bounded
- malformed or incomplete Anthropic SSE framing fails closed

This protects against:

- dribble attacks
- oversized event buffering
- unbounded streaming memory growth
- malformed SSE mid-stream corruption

### 11. Prototype Pollution And Unsafe Keys

Entity names and object keys are guarded in [src/platform/object-key-policy.ts](../../src/platform/object-key-policy.ts).

Current protections:

- reserved JavaScript meta-keys such as `__proto__`, `prototype`, and `constructor` are rejected for persisted entity names
- gateway proxy request bodies reject reserved JavaScript meta-keys recursively
  before proxying or translation

This protects against:

- prototype-pollution style config and mutation attacks
- prototype-pollution style request-body attacks

### 12. Command Injection And Process Launching

Switchmaxxer does not use shell strings for untrusted runtime input.

Current protections:

- there is no `eval`
- there is no dynamic `Function(...)`
- there is no production `new RegExp(...)` built from untrusted input
- process launch paths use argv arrays rather than shell interpolation
- `systemd_unit` values are whitelist-validated in [src/subsystems/config/config-validators-primitives.ts](../../src/subsystems/config/config-validators-primitives.ts)

This protects against:

- classic command-injection through shell string interpolation

### 13. Mass Assignment

CLI and MCP mutation surfaces use explicit field allowlists rather than accepting arbitrary keys.

Current protections:

- CLI mutation commands accept only their documented flags
- MCP tool input schemas set `additionalProperties: false`
- provider secret mutation is split into dedicated commands (`providers_set_key`, `providers_clear_key`, `providers_set_key_env`) instead of a generic bulk update

This protects against:

- clients smuggling unexpected fields (inline `api_key`, hidden overrides, route rewrites) through a broader mutation call

### 14. Observability Store Hardening

The observability store is local SQLite persistence, not a remote database tier.

The core controls live in:

- [src/subsystems/observability/runtime-loader.ts](../../src/subsystems/observability/runtime-loader.ts)
- [src/subsystems/observability/store.ts](../../src/subsystems/observability/store.ts)
- [src/subsystems/observability/gateway-observation-records.ts](../../src/subsystems/observability/gateway-observation-records.ts)
- [src/subsystems/observability/gateway-observation-runtime-state.ts](../../src/subsystems/observability/gateway-observation-runtime-state.ts)
- [src/subsystems/observability/gateway-observation-priority.ts](../../src/subsystems/observability/gateway-observation-priority.ts)
- [src/subsystems/observability/gateway-observation-queue.ts](../../src/subsystems/observability/gateway-observation-queue.ts)
- [src/subsystems/observability/gateway-observation-flush.ts](../../src/subsystems/observability/gateway-observation-flush.ts)
- [src/subsystems/observability/gateway-observation-shutdown.ts](../../src/subsystems/observability/gateway-observation-shutdown.ts)
- [src/subsystems/observability/gateway-observation-worker.ts](../../src/subsystems/observability/gateway-observation-worker.ts)

Current protections:

- observability DB paths are resolved through the shared runtime loader on the CLI, MCP, and gateway surfaces
- the default DB path is `.switchmaxxer/observability.sqlite`; its parent is created private and DB sidecars are tightened owner-only
- runtime DB overrides must use a normal SQLite filename suffix: `.db`, `.sqlite`, or `.sqlite3`
- the path guard rejects overrides whose nearest existing parent is not a real directory, is a symlink, is not owned by the current user, or is group-/world-writable
- existing DB files are rejected if they are symlinks, non-regular files, not owned by the current user, or readable/writable by group/other users
- the store repeats the parent and existing-file checks before SQLite opens the DB so direct/worker callers cannot bypass runtime-loader checks
- the DB file is pre-created with secure permissions
- DB, WAL, and SHM files are tightened to `0600`
- the parent directory is private
- SQLite table-name dynamic points are whitelist-checked
- persistence failures degrade gracefully rather than crashing the gateway
- incompatible observability schema versions fail closed instead of triggering automatic local data deletion

This protects against:

- unsafe local DB placement
- accidental world-readable observability data
- symlink redirection of the observability store
- group-writable parent-directory exposure in multi-user or service-manager environments
- some classes of local schema-path abuse

Config-file operator note:

- insecure `config.json` permissions fail closed on read paths
- required sibling `catalog.json` files use the same hardened reader and must
  also be owner-only, non-symlink files
- provider, route, and model sections must live only in `catalog.json`;
  duplicate ownership across `config.json` and `catalog.json` fails closed
- warnings and errors include the observed numeric mode
- the remediation is printed literally as `chmod 0600 <path>` so incident-time
  recovery does not require guessing the fix

Current scope note:

- `SWITCHMAXXER_OBSERVABILITY_DB` is still treated as a trusted local override
- the code does not yet enforce a fixed data-root allowlist for that override
- that remaining hardening step is tracked as the observability DB fixed
  data-root allowlist roadmap item in [docs/backlog.md](../backlog.md)

## Exploit Classes Explicitly Mitigated

The current codebase meaningfully mitigates:

- SSRF
- DNS rebinding
- request-header injection / CRLF-smuggling on ingress
- prototype pollution through config entity names
- command injection through shell interpolation
- unsafe local config-file reads
- secret leakage through ordinary logging/serialization paths
- malformed or abusive streaming behavior
- timing-leak-prone token comparison
- mass assignment through CLI and MCP mutation surfaces

## Verified Defensive Controls

The following controls were explicitly reviewed and found to be well-defended in the current tree. They are listed here so future readers know they were checked, not skipped.

### SSRF And Private-IP Blocking

Verified in:

- [src/subsystems/proxy/provider-endpoint-policy.ts](../../src/subsystems/proxy/provider-endpoint-policy.ts)

Confirmed behavior:

- private-address blocking covers IPv4 loopback, link-local (`169.254.0.0/16`), RFC1918 space, reserved ranges such as `0.0.0.0/8`, carrier-grade NAT (`100.64.0.0/10`), `192.0.0.0/24`, TEST-NET blocks, and multicast
- IPv6 blocking covers ULA (`fc00::/7`, including both `fc` and `fd` prefixes), link-local (`fe80::/10`), multicast (`ff00::/8`), IPv4/IPv6 translation (`64:ff9b::/96` and `64:ff9b:1::/48`), discard-only (`100::/64`), Teredo (`2001::/32`), benchmarking (`2001:2::/48`), documentation (`2001:db8::/32`), and 6to4 (`2002::/16`)
- non-canonical numeric hostnames such as hexadecimal, decimal-integer, and mixed encodings are rejected before they can be treated as alternate spellings of private targets

### Pinned DNS Resolution

Verified in:

- [src/subsystems/proxy/http-transport.ts](../../src/subsystems/proxy/http-transport.ts)
- [src/subsystems/proxy/provider-endpoint-policy.ts](../../src/subsystems/proxy/provider-endpoint-policy.ts)

Confirmed behavior:

- provider hostnames are resolved once for a request and the pinned IP is reused for the actual socket connect
- provider HTTP redirects are handled manually; the transport returns the 3xx
  response and does not make a second network hop to `Location`
- rejected private-address resolutions are negatively cached for five minutes

### Bearer Token Comparison

Verified in:

- [src/subsystems/gateway/local-gateway-auth.ts](../../src/subsystems/gateway/local-gateway-auth.ts)

Confirmed behavior:

- both candidate and expected bearer tokens are hashed with SHA-256
- `timingSafeEqual` is applied to the digests rather than the raw strings
- hashing equalizes length before comparison, which avoids naïve length-leak behavior
- the minimum accepted inbound token length is 32 characters

### Header Injection Defenses

Verified in:

- [src/subsystems/proxy/proxy-headers.ts](../../src/subsystems/proxy/proxy-headers.ts)

Confirmed behavior:

- forwarded header values are constrained to tab plus printable ASCII, which blocks CRLF-style header injection
- forwarded header names follow an RFC 7230 token-style character policy
- `set-cookie` and `set-cookie2` are stripped from upstream responses before returning them to local clients

### Prototype Pollution Defenses

Verified in:

- [src/platform/object-key-policy.ts](../../src/platform/object-key-policy.ts)
- [src/subsystems/config/mutation/config.ts](../../src/subsystems/config/mutation/config.ts)

Confirmed behavior:

- `__proto__`, `prototype`, and `constructor` are explicitly rejected as persisted config entity names
- the guard is applied during config mutation paths, not just at one read surface

### JSON Bounds

Verified in:

- [src/platform/json-bounds.ts](../../src/platform/json-bounds.ts)
- [src/subsystems/gateway/runtime.ts](../../src/subsystems/gateway/runtime.ts)

Confirmed behavior:

- serialized JSON is bounded at 8 MiB
- parsed JSON is bounded to 64k nodes and depth 256
- the gateway applies these checks around request parsing rather than relying on downstream code to notice abuse later
- gateway request-body reads enforce `max_payload_size` against both declared
  and actual bytes
- gateway request-body reads enforce an idle timeout while streaming the body
- Node's HTTP parser owns request framing; the gateway does not re-interpret
  `Content-Length` / `Transfer-Encoding` semantics on its own

### Streaming Bounds

Verified in:

- [src/subsystems/proxy/proxy-streaming.ts](../../src/subsystems/proxy/proxy-streaming.ts)

Confirmed behavior:

- idle timeout is enforced
- absolute stream lifetime is enforced
- minimum bytes-per-second is enforced
- per-event byte limits are enforced
- total-stream byte limits are enforced

### Secret Wrapping

Verified in:

- [src/platform/secret-string.ts](../../src/platform/secret-string.ts)

Confirmed behavior:

- `SecretString` redacts itself through `toJSON()`, `toString()`, and ordinary inspection
- the raw secret is only available through an explicit `reveal()` call

### Auth Failure Backoff

Verified in:

- [src/subsystems/gateway/auth-rate-limit.ts](../../src/subsystems/gateway/auth-rate-limit.ts)

Confirmed behavior:

- repeated inbound auth failures escalate into bounded backoff and `429` responses instead of allowing unbounded brute-force retries
- unexpected `/health` Host headers in authenticated gateway mode with
  `allow_unauthenticated_health: true` count toward the same failed-auth
  backoff before continuing to return `421` / `429`
- the failed-auth limiter keys on normalized source IP rather than trusting
  `X-Forwarded-For` from untrusted sources
- operational tuning should assume the worst single source-IP case; behind
  shared NAT or a trusted frontend, one shared source IP is the unit of
  backoff accounting
- under bounded cache pressure, failed-auth entries prune drained non-blocked
  windows first, then evict older eligible non-blocked entries before active
  blocked entries, so active backoff state is preserved as long as possible

### SQL Injection Resistance

Verified in:

- [src/subsystems/observability/repository.ts](../../src/subsystems/observability/repository.ts)
- [src/subsystems/observability/service.ts](../../src/subsystems/observability/service.ts)

Confirmed behavior:

- SQL execution uses prepared statements with parameter binding
- the dynamic placeholder helper `buildInClausePlaceholders(...)` generates only `?` placeholder fragments, not interpolated values

### Command-Execution Posture

Verified in:

- [src/app-cli.ts](../../src/app-cli.ts)
- [src/subsystems/gateway/health-commands.ts](../../src/subsystems/gateway/health-commands.ts)
- [src/subsystems/gateway/operator-commands.ts](../../src/subsystems/gateway/operator-commands.ts)

Confirmed behavior:

- the production codebase does not use `eval` or dynamic `Function(...)` for runtime input
- process-launch sites use `spawn(...)` with argv arrays for fixed tools such as `systemctl` and `journalctl`, rather than shell interpolation with untrusted strings
- there is no ordinary shell-string execution path that accepts user-controlled input

### Filesystem Path Posture

Verified in:

- [src/subsystems/config/config-read.ts](../../src/subsystems/config/config-read.ts)
- [src/subsystems/config/config.ts](../../src/subsystems/config/config.ts)

Confirmed behavior:

- config paths come from explicit CLI/config selection and are normalized through resolved local paths
- the reviewed file-access surfaces do not expose a separate path-traversal vector through arbitrary user-controlled path concatenation

### ReDoS Posture

Verified in:

- [src/subsystems/gateway/rate-limit.ts](../../src/subsystems/gateway/rate-limit.ts)
- [src/platform/retention-duration.ts](../../src/platform/retention-duration.ts)

Confirmed behavior:

- the reviewed regexes are anchored and structurally simple
- duration parsing patterns remain linear-time and do not use catastrophic nested alternation

## Exploit Classes Not Fully Mitigated

The following are not fully solved by Switchmaxxer itself and must be understood as residual risk:

- malicious but publicly routable upstreams
  - Switchmaxxer can sanitize transport and some response metadata, but it cannot verify the truthfulness of model output
- trusted-proxy deployments
  - the gateway intentionally does not trust forwarded source-IP headers
- local machine compromise
  - a user who controls the host or process environment can still change config, inspect env vars, or alter runtime state
- explicit operator hardening bypasses
  - enabling private endpoints, insecure HTTP, or unauthenticated gateway mode weakens the default posture by design

## Exploit Classes That Are Irrelevant Here

These classes are largely irrelevant to Switchmaxxer's architecture as a local CLI/gateway/MCP tool:

- CSRF
  - there is no cookie-authenticated browser session model
- XSS
  - the project does not render untrusted HTML to a browser
- open redirect
  - the gateway does not issue redirect-based navigation flows
  - provider redirects are outbound upstream responses, not browser navigation;
    automatic following is disabled as part of the SSRF defense
- XXE
  - the project does not parse XML
- classic IDOR
  - the system is not a multi-user object store with per-user object authorization
- unsafe object deserialization in the Java/JavaScript sense
  - the project parses bounded JSON, not arbitrary executable object graphs

## Operator Responsibilities

The codebase hardens a lot, but secure operation still depends on operator choices:

- keep inbound auth enabled unless the gateway is intentionally local-only and unauthenticated
- prefer `api_key_env` over inline `api_key`
- do not enable `allow_private_endpoints` unless private-address routing is intentionally required
- do not enable `allow_insecure_http` unless plaintext upstream transport is explicitly accepted
- keep config files and observability files on local, access-controlled storage
- do not rely on forwarded-IP trust; the gateway keys auth/rate-limit decisions on the socket peer address

## Summary

Switchmaxxer's security posture is strongest at boundary hardening:

- strict config and request validation
- fail-closed auth behavior
- hardened provider routing
- bounded streaming
- careful secret handling
- secure local file treatment

It is intentionally conservative by default, and where it relaxes security, it generally does so through explicit operator opt-ins rather than silent behavior.
