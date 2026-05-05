# Switchmaxxer Config Reference

## Purpose

This document describes the current `config.json` contract as implemented in the
live codebase.

Use it when:

- authoring or reviewing a Switchmaxxer config
- deciding which settings belong on the gateway runtime versus provider/route
  definitions
- wiring operator automation, MCP workflows, or local-first clients to the
  current config surface

Example config note:

- [config.example.json](../../../config-examples/config.example.json) is a fuller reference example,
  not a minimal starter file
- [catalog.example.json](../../../config-examples/catalog.example.json) shows the required
  `catalog.json` shape for provider, route, and model definitions
- [secrets.example.json](../../../config-examples/secrets.example.json) shows the sparse local
  `secrets.json` shape without using real provider keys
- it intentionally shows important runtime, capacity, and security-related
  knobs with safe or conservative defaults so operators can see the supported
  surface in one place

For mutation flows and machine-facing envelopes, also see:

- [tech-spec-for-cli-surface.md](../cli/tech-spec-for-cli-surface.md)
- [tech-spec-for-mcp-cli-contract.md](../../contracts/tech-spec-for-mcp-cli-contract.md)

## Top-Level Runtime Fields

Current top-level runtime fields include:

- `config_version`
- `bind_host`
- `allow_remote_bind`
- `allow_wildcard_bind`
- `port`
- `timeout_ms`
- `stream_idle_timeout_ms`
- `stream_max_lifetime_ms`
- `stream_min_bytes_per_second`
- `stream_rate_window_ms`
- `stream_max_event_bytes`
- `stream_max_total_bytes`
- `max_concurrent_streams_per_ip`
- `max_connections`
- `max_concurrent_json_parses`
- `max_buffered_upstream_response_bytes`
- `max_payload_size`
- `rate_limit`
- `log_level`
- `shutdown_timeout_ms`
- `systemd_unit`
- `inbound_api_key_env`
- `allow_unauthenticated_gateway`
- `one_trusted_operator_boundary`
- `allow_unauthenticated_health`
- `benchmark`
- `mcp`
- `observability`

`service_providers`, `models`, and `routes` are not valid `config.json` fields.
They must live together in the required sibling `catalog.json`.

Switchmaxxer rejects unknown keys at every config object level. Typos like
`max_payload_siz` fail validation instead of being silently ignored.

## External Naming Policy

Switchmaxxer uses:

- `snake_case` for all external serialized surfaces
- `camelCase` only for internal TypeScript and runtime objects

Current contract:

- external config fields use canonical `snake_case`
- unsupported top-level camelCase runtime spellings fail closed as unsupported
  fields
- config mutation and export paths emit canonical `snake_case`

Config file permission note:

- `config.json` should normally be owner-only readable and writable
- recommended mode: `0600`
- the shared config reader rejects files with any group or world permission
  bits set, including group-readable files
- rejection messages include the observed numeric mode and an explicit
  remediation command, for example:
  `Run: chmod 0600 /path/to/config.json`

Local catalog-file location note:

- `catalog.json` is a required sibling of the selected `config.json`
- it owns `service_providers`, `models`, and `routes`
- it should use `catalog_version: 1`
- it must contain all three catalog sections, even when they are empty
- those three sections must be absent from `config.json`; duplicate ownership
  fails closed
- a missing `catalog.json` is a setup error, not a fallback mode that allows
  `service_providers`, `models`, or `routes` back into `config.json`
- `catalog.json` is read through the same hardened file reader as `config.json`,
  so it must not be a symlink and must use owner-only permissions
- local `catalog.json` files are gitignored; use
  [catalog.example.json](../../../config-examples/catalog.example.json) as the tracked template
- CLI and MCP model/provider/route mutation paths preserve catalog ownership and
  write those entity changes back to `catalog.json`
- those mutation paths also write best-effort Control Plane Audit Ledger rows
  to the local observability store, so successful and failed catalog changes can
  be inspected later with `switchmaxxer ledger list`

Current `catalog.json` schema:

```json
{
  "catalog_version": 1,
  "service_providers": {},
  "routes": {},
  "models": {}
}
```

Local secrets-file location note:

- `secrets.json` is reserved for sparse, machine-local secret overrides
- default path: `${XDG_CONFIG_HOME}/switchmaxxer/secrets.json` when
  `XDG_CONFIG_HOME` is set, otherwise `${HOME}/.config/switchmaxxer/secrets.json`
- if neither home location is available, the fallback path is
  `./secrets.json` in the current working directory
- `SWITCHMAXXER_SECRETS_PATH` can point to an explicit secrets file; explicit
  secrets paths must not be symlinks
- local `secrets.json` files are gitignored and must use owner-only
  permissions when loaded
- the current secrets reader accepts only a sparse `api_key_overrides` object
  whose keys are `SWITCHMAXXER_...` environment variable names and whose values
  are non-empty strings
- provider auth resolves inline `api_key` first for compatibility, then
  `api_key_env` through a matching `secrets.json` override when present, then
  the real environment variable
- an explicit `SWITCHMAXXER_SECRETS_PATH` fails closed when the target file is
  missing or symlinked; absent default secrets files are ignored

Current `secrets.json` schema:

```json
{
  "api_key_overrides": {
    "SWITCHMAXXER_OPENAI_API_KEY": "sk-local-override..."
  }
}
```

Absent keys mean "use the configured environment variable." Present keys mean
"this local machine has an explicit override for that environment variable name."

Secrets-file coverage across SMX surfaces:

All auth-resolution paths in SMX — both upstream provider auth and inbound
gateway auth — honor `SWITCHMAXXER_SECRETS_PATH`:

- the read-model (`providers_show` / `routes_show` / `optimize_run`) reflects
  `auth_source: "secrets override"` for any provider whose `api_key_env` has
  an entry in `secrets.json`
- the runtime upstream-call path uses the secrets-file value when the env var
  is not set in the calling process
- the optimize/route-mutation post-mutation validator accepts the secrets-file
  override when walking every route to check provider auth resolution
- the production config validator (`smx gateway start`, `smx config validate`)
  accepts a secrets-file value for `inbound_api_key_env` when the env var is
  unset in the process
- the request-time gateway inbound auth resolver loads the secrets file once
  at gateway-runtime startup and uses it as the fallback for
  `inbound_api_key_env` resolution on every authenticated request, so
  `Authorization: Bearer …` matching works without the env var being exported

That coverage is what makes MCP-driven `optimize_apply` and full bearer-token
gateway operation work in an OpenClaw MCP child or systemd unit whose only
configured env entry is `SWITCHMAXXER_SECRETS_PATH`. Place every required
token in `secrets.json` and you do not need to materialize them as
individual env vars in any process.

### `config_version`

The config schema version for the document.

Current value:

```json
"config_version": 1
```

Current version policy:

- new and rewritten configs should carry `config_version: 1`
- unversioned `config.json` files are treated as version 1 input and are
  normalized by adding the field during load/write flows
- future breaking schema changes should increment `config_version` and add an
  explicit migration path before validation

Switchmaxxer supports `config_version: 1`. Loading a higher version produces an
error; add an explicit migration path before incrementing the version.

### `bind_host`

The bind address for the gateway runtime.

Common value:

```json
"bind_host": "127.0.0.1"
```

The default and recommended value is loopback-only. Non-loopback values make the
gateway reachable beyond the local machine in many deployments and require
`allow_remote_bind: true` plus `inbound_api_key_env`. Wildcard values such as
`0.0.0.0` or `::` listen on every interface and also require
`allow_wildcard_bind: true`.

### `allow_remote_bind`

Explicit opt-in for authenticated non-loopback gateway listeners.

Default:

```json
"allow_remote_bind": false
```

When `false`, `bind_host` must stay on a loopback-style address such as
`127.0.0.1`, `localhost`, or `::1`.

When `true`:

- `inbound_api_key_env` is required
- `allow_unauthenticated_gateway: true` is forbidden
- the gateway emits a startup warning that it may be reachable from other
  machines
- runtime control-plane routes remain loopback-gated by the request wrapper
- wildcard `bind_host` values still require `allow_wildcard_bind: true`

This setting is an elevated deployment mode for operators who intentionally
want the data-plane gateway listener to be reachable from another host. Protect
the inbound token as a real network credential and monitor upstream provider
quota.

### `allow_wildcard_bind`

Separate opt-in for authenticated wildcard gateway listeners.

Default:

```json
"allow_wildcard_bind": false
```

When `false`, `bind_host` must not be `0.0.0.0`, `::`, or another recognized
wildcard bind form. Wildcard listeners bind to all network interfaces on the
host, which can include LAN, VPN, container, and public interfaces depending on
the deployment.

When `true`:

- `bind_host` must be a wildcard bind value such as `0.0.0.0` or `::`
- `allow_remote_bind: true` is also required
- `inbound_api_key_env` is required
- `allow_unauthenticated_gateway: true` is forbidden
- the gateway emits a distinct startup warning that it is binding to all
  interfaces

Use this only when the host firewall and network placement are part of the
deployment plan.

### `port`

Required. The gateway listener port.

### `timeout_ms`

Required. The upstream request timeout for non-streaming request handling.

### `stream_idle_timeout_ms`

Required. The maximum idle time allowed while a stream is open.

Streaming note:

- streaming routes are governed by `stream_idle_timeout_ms` and
  `stream_max_lifetime_ms`
- the gateway also enforces a minimum sustained streaming progress rate using
  `stream_min_bytes_per_second` over `stream_rate_window_ms`
- those stream-specific bounds apply even when a route-level or top-level
  `timeout_ms` would otherwise be longer or shorter
- `timeout_ms` remains the primary upstream timeout for non-streaming request
  handling

### `stream_max_lifetime_ms`

The absolute maximum lifetime for a streaming upstream response, even if bytes
continue arriving before the idle timer expires.

Current default:

```json
"stream_max_lifetime_ms": 600000
```

### `stream_min_bytes_per_second`

The minimum sustained byte rate required while a streaming response remains
open. This protects the gateway from peers that keep a stream alive by
dribbling tiny fragments just before the idle timer would expire.

Current default:

```json
"stream_min_bytes_per_second": 16
```

### `stream_rate_window_ms`

The rolling enforcement window used with `stream_min_bytes_per_second`.

Current default:

```json
"stream_rate_window_ms": 30000
```

### `stream_max_event_bytes`

The maximum size of one in-progress SSE event buffer while Switchmaxxer is
translating streamed upstream responses.

Current default:

```json
"stream_max_event_bytes": 1048576
```

### `stream_max_total_bytes`

The maximum total number of bytes accepted from one streaming upstream
response before the gateway aborts the stream.

Current default:

```json
"stream_max_total_bytes": 67108864
```

### `max_concurrent_streams_per_ip`

The maximum number of concurrent streaming gateway requests allowed from one
source IP at a time.

Current default:

```json
"max_concurrent_streams_per_ip": 8
```

Current behavior:

- applies only to streaming proxy requests
- counts active in-flight streams per normalized source IP
- rejects new streaming requests with HTTP `429` once the source reaches the
  configured cap
- releases the slot automatically when the stream completes, fails, or the
  downstream connection closes

Operator guidance:

- keep this small unless your trusted callers intentionally multiplex many
  long-lived streams through one source IP
- raise it carefully when the gateway sits behind a reverse proxy or NAT that
  causes many trusted clients to share one apparent source address
- remember this limit complements arrival rate limiting; it protects resource
  occupancy, not request burst rate

Current source-IP trust model:

- Switchmaxxer keys inbound auth backoff and streaming concurrency limits from
  the connected socket peer address
- it does not trust `X-Forwarded-For` or `X-Real-IP` headers by default
- when deploying behind a reverse proxy, rate limiting and stream caps will
  apply to the proxy's source address, so many clients can collapse into one
  shared limiter bucket
- in that topology, one attacker can potentially trigger failed-auth backoff
  for other clients sharing the same apparent proxy IP
- prefer running the Switchmaxxer listener directly rather than placing a
  general reverse proxy in front of it unless you intentionally accept that
  shared-bucket behavior
- if Switchmaxxer gains forwarded-IP trust in a future release, it should stay
  behind an explicit trusted-proxy configuration model rather than implicitly
  trusting caller-supplied headers
- do not rely on caller-supplied forwarded-IP headers for limiter identity
  without an explicit trusted-proxy configuration model

### `max_concurrent_json_parses`

The maximum number of request bodies Switchmaxxer will read and parse as JSON
at the same time across the whole process.

Current default:

```json
"max_concurrent_json_parses": 4
```

Current behavior:

- applies to JSON request-body read plus parse work for the gateway's POST API
  surfaces
- rejects excess concurrent parse work with HTTP `503` and
  `request_parse_capacity_exceeded`
- limits aggregate request-body memory pressure before proxy dispatch begins

Operator guidance:

- lower this if you want a tighter memory ceiling when `max_payload_size` is
  large
- raise it carefully if many trusted callers submit large non-streaming JSON
  requests concurrently
- the rough body-buffer ceiling is approximately
  `max_concurrent_json_parses * max_payload_size` before accounting for parsed
  object overhead, stream buffers, and normal process memory

### `max_buffered_upstream_response_bytes`

The maximum size of a non-streaming upstream response body that Switchmaxxer
will buffer before returning it to the client or translating it between API
surfaces.

Current default:

```json
"max_buffered_upstream_response_bytes": 16777216
```

Current behavior:

- applies only to non-streaming upstream responses
- covers both pass-through buffered bodies and translated buffered JSON bodies
- also caps benchmark response reads on gateway and direct benchmark paths
- rejects oversized upstream bodies with HTTP `502` and proxy error body code
  `upstream_response_too_large`; this is a proxy-compatible response code, not
  a CLI/MCP envelope `APP_ERROR_CODES` value

Operator guidance:

- keep this comfortably above normal provider response sizes, but low enough
  that one hostile upstream cannot OOM the process with a giant buffered body
- this limit is separate from `stream_max_event_bytes` and `stream_max_total_bytes`,
  which protect the streaming path

### `max_connections`

The gateway's maximum concurrent connection allowance.

### `max_payload_size`

Maximum accepted request-body size in bytes.

The shipped posture is intentionally conservative rather than allowing very
large JSON bodies by default.

Current default and example baseline:

```json
"max_payload_size": 4000000
```

Operator guidance:

- keep the default for normal text-first gateway traffic
- increase it intentionally only when callers truly need larger inline payloads
- remember that larger limits increase memory pressure and trust-boundary risk

Multimodal note:

- image, audio, and video workflows may require a higher payload limit when
  clients send inline media data rather than URLs or object-store references
- large multimodal payloads are a deployment-specific choice, not the baseline
  recommended posture

### `rate_limit`

Required global gateway request budget.

Current shape:

```json
"rate_limit": {
  "requests": 50,
  "window": "1s"
}
```

Current behavior:

- applies one global limit across live proxied gateway request paths
- uses a fixed-window counter rather than a token bucket or sliding window
- returns HTTP `429` with `Retry-After` when exceeded
- records a gateway observability event for the rejection

Burst characteristic:

- fixed-window limiting allows boundary bursts
- a client can send up to `requests` near the end of one window and another
  `requests` immediately after the next window starts
- in practice, short instantaneous bursts can therefore approach roughly
  `2 * requests` around window boundaries

Operator implication:

- choose conservative `requests` values when protecting fragile upstreams
- if smoother enforcement matters, prefer a smaller trusted caller set or run
  behind an additional rate limiter with token-bucket or sliding-window behavior

Operator guidance when the gateway keeps exceeding this limit:

- first confirm whether the traffic is legitimate sustained load or an avoidable burst pattern
- reduce caller concurrency or add retry jitter if clients are stampeding the gateway
- raise `rate_limit.requests` if legitimate traffic regularly exceeds the configured budget
- lengthen `rate_limit.window` if short spikes are expected and a wider smoothing window is acceptable
- split traffic across multiple gateway instances if one process should not absorb the full workload

Example higher-throughput posture:

```json
"rate_limit": {
  "requests": 200,
  "window": "1s"
}
```

Tradeoff:

- higher limits reduce client-facing `429` responses
- higher limits also weaken protection against upstream cost spikes and gateway overload
- fixed-window limits are simple and predictable, but they do not smooth bursts
  as well as token-bucket or sliding-window strategies

### `log_level`

Current supported runtime log levels are the standard gateway levels such as:

- `info`
- `debug`
- `warn`
- `error`

CLI flag and environment override config when present.

### `shutdown_timeout_ms`

Graceful shutdown deadline before the gateway forces process exit.

Example:

```json
"shutdown_timeout_ms": 30000
```

### `systemd_unit`

The configured unit name used by:

- `switchmaxxer gateway start|stop|restart|enable|disable|reload`
- `switchmaxxer gateway status`
- `switchmaxxer gateway logs show|tail`

Default:

```json
"systemd_unit": "switchmaxxer.service"
```

`SWITCHMAXXER_UNIT` can override this at runtime.

### `inbound_api_key_env`

Optional environment variable name that enables inbound gateway auth.

When configured, gateway paths require the configured token, including
`/health` unless `allow_unauthenticated_health: true` is explicitly enabled.
The gateway accepts either:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`

Local CLI surfaces that call the live gateway automatically send that token when
this field is configured.

Example:

```json
"inbound_api_key_env": "SWITCHMAXXER_INBOUND_API_KEY"
```

Config-referenced secret env var names must use the `SWITCHMAXXER_` prefix.

By default, config validation, startup, and reload fail fast if this env var is
missing or empty.

When configured, the resolved inbound auth token must be at least 32
characters long. Shorter tokens are refused during config validation, gateway
startup, and gateway reload.

### `allow_unauthenticated_gateway`

Optional explicit opt-in for deliberately unauthenticated development gateway
setups.

Default:

```json
"allow_unauthenticated_gateway": false
```

When `true`, the gateway starts without inbound auth. This is a development-only
escape hatch for direct local clients, not a normal production posture.

`inbound_api_key_env` and `allow_unauthenticated_gateway` are mutually
exclusive. One inbound auth mode must be selected explicitly.

Switchmaxxer also requires `bind_host` to stay on a loopback address such as
`127.0.0.1`, `localhost`, or `::1` when
`allow_unauthenticated_gateway: true` is enabled.

`allow_remote_bind: true` does not weaken this rule. Remote bind mode requires
inbound auth and cannot be combined with unauthenticated gateway mode.

By default, unauthenticated gateway proxy requests must still look like
intentional local client calls:

- `Content-Type: application/json`
- `X-Switchmaxxer-Local-Client: 1`
- no cross-site browser request signals such as hostile `Origin`,
  `Sec-Fetch-Site`, or `Sec-Fetch-Mode` values

Loopback-only no-auth mode is not safe against malicious webpages by itself.
Browsers can send requests to `127.0.0.1`; these extra checks make
browser-originated drive-by POSTs fail closed, but inbound auth remains the
recommended posture.

### `one_trusted_operator_boundary`

Optional explicit opt-in for treating loopback unauthenticated gateway callers
as already inside one trusted local operator boundary.

Default:

```json
"one_trusted_operator_boundary": false
```

When `false`, `allow_unauthenticated_gateway: true` keeps the existing local
client marker requirement: data-plane and runtime control-plane callers must
send `X-Switchmaxxer-Local-Client: 1`.

When `true` and `allow_unauthenticated_gateway: true`, local trusted apps such
as OpenClaw do not need to send `X-Switchmaxxer-Local-Client: 1`. Switchmaxxer
still requires loopback socket and `Host` checks and still rejects cross-site
browser request signals such as hostile `Origin`, `Sec-Fetch-Site`, or
`Sec-Fetch-Mode` values.

### `allow_unauthenticated_health`

Optional explicit opt-in for unauthenticated local health probes when
`inbound_api_key_env` is configured.

Default:

```json
"allow_unauthenticated_health": false
```

When `false`, `GET /health` requires the same inbound bearer token as the rest
of the gateway. Local CLI health probes send that token automatically when the
selected config defines `inbound_api_key_env`.

When `true`, `GET /health` may be called without credentials, but only through
the existing unauthenticated host checks and health rate limit. Use this only
for trusted local probe infrastructure that cannot attach the gateway token.

### `mcp`

Optional nested MCP capability policy.

Current nested shape:

```json
{
  "mcp": {
    "capabilities": ["read"]
  }
}
```

Supported nested fields:

- `capabilities`

Current behavior:

- `mcp.capabilities` controls which MCP tool capability classes are granted to
  new MCP sessions
- supported values are `read`, `mutation`, and `privileged`
- when `mcp` or `mcp.capabilities` is omitted, Switchmaxxer logs a defaulting
  warning and treats MCP sessions as read-only
- `switchmaxxer mcp serve` fails closed if the resolved config file does not
  exist
- `switchmaxxer mcp serve` prints the effective granted tiers and enabled /
  disabled tool counts to stderr at startup
- `switchmaxxer mcp capabilities --json` previews the same grant and concrete
  enabled/disabled tool names without starting the stdio server
- an empty array is allowed and exposes no MCP tools
- unknown capability names are rejected during config validation

Operator guidance:

- use `["read"]` for read-only inspection workflows
- use `["read", "mutation"]` when callers may update config but should not use
  privileged maintenance operations
- use `["read", "mutation", "privileged"]` only when the MCP client should be
  intentionally granted full local control, including the ability to perform
  sensitive local maintenance actions such as secret mutation or prune-style
  operations

### `observability`

Optional nested observability configuration.

Current nested shape:

```json
{
  "observability": {
    "retention": {
      "older_than": "14d"
    }
  }
}
```

Current behavior:

- `observability.retention.older_than` is the configured default cutoff for
  whole observability-store retention
- the canonical manual command is
  `switchmaxxer prune --older-than <duration>`
- `switchmaxxer prune --config <path>` uses this value when `--older-than` is
  omitted
- when that retention value is configured, the observability runtime applies a
  prune pass on startup and then continues pruning periodically during
  long-lived gateway runs
- retention durations use the `<number>m|h|d|w` grammar and are capped at
  10 years to avoid silently invalid cutoff timestamps

## Provider Fields

Each `service_providers.<provider-id>` entry describes one outbound provider
binding.

Current provider fields include:

- `endpoint`
- `api_mode`
- `anthropic_version`
- `model_id_format`
- `api_key_env`
- `api_key`
- `allow_private_endpoints`
- `allow_insecure_http`

Provider field matrix:

| Field | Required | Notes |
| --- | --- | --- |
| `endpoint` | yes | concrete upstream URL |
| `api_mode` | yes | `openai-completions` or `anthropic-messages` |
| `api_key_env` | conditional | preferred normal auth path |
| `api_key` | conditional | inline secret escape hatch; use sparingly |
| `anthropic_version` | optional | usually needed for Anthropic-style providers |
| `model_id_format` | optional | useful for creator-prefixed providers such as OpenRouter |
| `allow_private_endpoints` | optional | permits private, loopback, and link-local provider destinations |
| `allow_insecure_http` | optional | required for `http://` upstreams |

Current auth rule:

- each provider must define exactly one auth posture:
  `api_key_env`, `api_key`, or an explicit no-auth persisted shape
- for no-auth local providers such as Ollama, set `api_key` to `null` and omit
  `api_key_env`

Security note:

- `allow_private_endpoints` is not just "allow RFC1918 or loopback targets"
- DNS hostnames still use pinned-resolution dispatch when this flag is enabled
- only use it for intentionally trusted private-address routing where the
  provider destination and network path are under operator control

### `endpoint`

Concrete upstream endpoint URL.

Required query parameters are preserved intentionally. That means Azure-style provider endpoints such as `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-15-preview` remain intact after Switchmaxxer shapes the final upstream URL.

URL fragments are stripped during validation and normalization. A configured value like `https://api.example.com/v1/chat/completions?api-version=2024-02-15-preview#ignored-fragment` is treated as `https://api.example.com/v1/chat/completions?api-version=2024-02-15-preview`.

Current validation requires:

- a valid URL
- `http:` or `https:`

### `api_mode`

Canonical outbound wire dialect.

Current supported values:

- `openai-completions`
- `anthropic-messages`

### `anthropic_version`

Optional Anthropic API version header value for Anthropic-style providers.

### `model_id_format`

Controls how `routes.<route-id>.provider_model_id` is sent upstream for this provider.

Current supported values:

- `passthrough`
- `creator/model`

Behavior:

- `passthrough` sends `provider_model_id` exactly as configured on the route
- `creator/model` composes `<model_creator>/<provider_model_id>` when the route value does not already contain `/`

Use `creator/model` for providers that expect creator-prefixed model IDs, such as OpenRouter-style routing.

### `api_key_env`

Preferred environment variable name for upstream credentials.

Config-referenced secret env var names must use the `SWITCHMAXXER_` prefix.
At runtime, this name can be satisfied either by the process environment or by
a matching sparse `secrets.json` entry in `api_key_overrides`.

Example values:

- `SWITCHMAXXER_OPENAI_API_KEY`
- `SWITCHMAXXER_ANTHROPIC_API_KEY`
- `SWITCHMAXXER_OPENROUTER_API_KEY`

### `api_key`

Inline plaintext secret fallback for temporary local research or one-off operator
testing.

Current rules:

- supported in config
- treated as a temporary-use escape hatch rather than the recommended path
- masked in display surfaces
- not returned raw through CLI or MCP show surfaces
- dedicated secret mutation commands are preferred over general update flows
- config files and backups containing inline `api_key` values are written with restrictive permissions

Best practice:

- prefer `api_key_env` for normal, persistent, or shared operation
- use inline `api_key` only when you intentionally need a short-lived local override

For no-auth local providers such as Ollama, set `api_key` to `null` and omit
`api_key_env`.

CLI and MCP mutation surfaces may offer a `no_auth` convenience input, but
`no_auth` is not a persisted `config.json` provider field. Those surfaces
translate the operator intent into the stored config shape above.

### `allow_private_endpoints`

Opt-in escape hatch that allows private, loopback, or link-local upstream
targets.

Without it, provider endpoint validation blocks local/private destinations.
Switchmaxxer also re-checks provider DNS resolution at request dispatch time,
so hostnames that later resolve to private or loopback addresses are blocked
too unless this flag is `true`.

Provider HTTP redirects are not followed automatically. If a validated provider
endpoint returns a `3xx Location` pointing at localhost, link-local, or a
private-address target, Switchmaxxer returns the redirect response instead of
making a second network hop. Any future redirect-following behavior must
re-apply the provider endpoint policy to each `Location` target before connect.

Trade-off:

- enabling this flag permits private-address routing for that provider
- DNS hostnames still use pinned-resolution dispatch: the resolved address is
  cached for the normal pin TTL and the socket connection uses the pinned
  address
- literal IP endpoints and `localhost`-style names do not use DNS pinning
  because there is no DNS hostname to rebind
- use it only when private-address routing is intentionally required and the
  provider destination and network path are trusted for that use

Operator signal:

- Switchmaxxer logs a warning when a provider enables `allow_private_endpoints`
  so the broadened private-routing posture is visible at load time

### `allow_insecure_http`

Opt-in escape hatch that allows `http://` provider endpoints.

Without it, insecure HTTP provider endpoints are rejected.

## Model Fields

Each `models.<model-id>` entry describes a canonical model.

Current common fields:

- `display_name`
- `model_creator`
- `cost`

Model field matrix:

| Field | Required | Notes |
| --- | --- | --- |
| `display_name` | yes | operator-facing display label |
| `model_creator` | yes | canonical creator namespace such as `openai` or `anthropic` |
| `cost` | optional | default pricing metadata for routes that do not override it |

`cost` uses the external naming policy:

| Field | Required | Notes |
| --- | --- | --- |
| `input` | yes | input-token price metadata |
| `output` | yes | output-token price metadata |
| `cache_read` | yes | cache-read price metadata |
| `cache_write` | yes | cache-write price metadata |

Routes and providers derive transport/runtime behavior from this model catalog,
but the model entry itself is provider-agnostic.

## Route Fields

Each `routes.<route-id>` entry describes the stable invocation surface used by
clients.

Current common fields:

- `display_name`
- `model`
- `service_provider`
- `provider_model_id`
- optional `timeout_ms`
- `cost`

Route field matrix:

| Field | Required | Notes |
| --- | --- | --- |
| `display_name` | yes | operator-facing route label |
| `model` | yes | must reference a defined `models.<model-id>` entry |
| `service_provider` | yes | must reference a defined `service_providers.<provider-id>` entry |
| `provider_model_id` | yes | concrete upstream model id sent to the provider |
| `timeout_ms` | optional | per-route override of top-level `timeout_ms` |
| `cost` | optional | route-local pricing override; wins over model cost |

Important current semantics:

- `model` points at the canonical model entry
- `service_provider` chooses the transport binding
- `provider_model_id` is the exact upstream model id
- `timeout_ms` overrides the top-level `timeout_ms` default for this route only
- route cost overrides model cost when both are present

## Secret Handling Notes

Current secret posture:

- `providers show` and related surfaces return masked `api_key`
- provider read surfaces report `auth_source` as `inline override`,
  `secrets override`, `env var`, or `not required`
- MCP is not a secret-retrieval surface
- inline secret rotation belongs to:
  - `switchmaxxer providers set-key`
  - `switchmaxxer providers clear-key`
  - `switchmaxxer providers set-key-env`

## MCP Transport Trust Boundary

`switchmaxxer mcp serve` is a stdio server, not an authenticated network service.

Switchmaxxer does not add transport-level authentication to the stdin/stdout pipe
itself. The trust boundary is the MCP client, launcher, or local execution
environment that owns that stdio pair.

In practice:

- safe: a trusted local editor, agent runner, or wrapper process launches `switchmaxxer mcp serve`
- not safe: exposing the stdio pair to untrusted callers and assuming Switchmaxxer will authenticate them

Operators should treat MCP stdio access as privileged local process access. If a
workflow needs stronger caller isolation or transport authentication, that must
be enforced by the parent client, launcher, or surrounding execution
environment.

## Display And Export Notes

`switchmaxxer config show` is a redacted normalized display surface.

That means:

- inline secrets are masked
- the document is re-serialized
- formatting and whitespace are not part of the contract

`switchmaxxer config export` is redacted by default for stdout, JSON envelopes,
and file output. Inline provider `api_key` values are masked for safe
inspection and sharing.

`switchmaxxer config import` accepts the full effective document shape produced
by export, but writes the local files back in split form: runtime fields in
`config.json`, and `service_providers`, `models`, and `routes` in
`catalog.json`. When `--backup` is used, both local split files are backed up
when they exist.

`switchmaxxer config import --dry-run` also treats preview output as a display
surface. Inline provider `api_key` values are masked in text and JSON diff
output, and redacted secret-only changes are reported without exposing the raw
secret values.

Use `switchmaxxer config export --include-secrets --output <path>` only when you
need a full-fidelity backup that preserves inline provider `api_key` values.
That output is secret-bearing and should be stored and shared with the same care
as live provider credentials.
### `benchmark`

Optional benchmark-runtime defaults used by `switchmaxxer bench` and MCP
`bench_run`.

Supported nested fields:

- `default_max_tokens`
- `default_anthropic_version`

Example:

```json
"benchmark": {
  "default_max_tokens": 32,
  "default_anthropic_version": "2023-06-01"
}
```

These defaults are used only when a benchmark request needs them and a more
specific route/provider value is not already present.
