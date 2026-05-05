# How To Operate The Switchmaxxer Gateway

## Purpose

This document is the operator's manual for the `smx gateway`.

Use it when you need to:

- start or stop the gateway
- confirm that the listener is healthy
- inspect live runtime state
- read logs
- validate config before rollout
- test routes through the live gateway
- understand the main operational controls and failure modes

This is an operations document, not a protocol deep dive. It focuses on how to run and manage the gateway safely.

## What The Gateway Is

The Switchmaxxer Gateway is the long-running HTTP runtime that accepts client LLM requests and forwards them to configured upstream providers.

In normal operation it:

- listens on a configured host and port
- accepts OpenAI-compatible requests on `/v1/chat/completions`
- accepts Anthropic-compatible requests on `/anthropic/v1/messages`
- resolves the configured route
- applies provider auth
- forwards the request upstream
- returns the upstream response in the expected API mode

## Operator Vocabulary

- `gateway`: the live Switchmaxxer HTTP runtime
- `service`: the OS-managed background form of that gateway, usually via `systemd --user`
- `listener`: the bound host/port the gateway serves on
- `route`: the named runtime mapping a client selects through the `model` field
- `control plane`: the operator-facing surfaces used to inspect and manage the gateway, starting with the `smx` CLI

The gateway's data-plane architecture is a reverse proxy for LLM API traffic:
clients call Switchmaxxer as the API origin, and Switchmaxxer resolves the
configured route to an upstream provider. It is not a general forward proxy
where clients choose arbitrary destinations to tunnel through.

## Provider Secret Inputs

Provider entries should normally keep portable `api_key_env` names in
`config.json`. The actual key material can come from either the process
environment or a sparse local secrets file.

Environment-variable path:

```bash
export SWITCHMAXXER_OPENAI_API_KEY='replace-with-your-openai-key'
```

For interactive shell operation, you can keep those assignments in an
owner-only shell env file and source it from `~/.bashrc`:

```bash
mkdir -p ~/.config/switchmaxxer
chmod 0700 ~/.config/switchmaxxer
cat > ~/.config/switchmaxxer/shell.env <<'EOF'
SWITCHMAXXER_OPENAI_API_KEY=replace-with-your-openai-key
SWITCHMAXXER_ANTHROPIC_API_KEY=replace-with-your-anthropic-key
EOF
chmod 0600 ~/.config/switchmaxxer/shell.env
```

```bash
# Switchmaxxer API keys
set -a
[ -f ~/.config/switchmaxxer/shell.env ] && source ~/.config/switchmaxxer/shell.env
set +a
```

Keep `shell.env` to simple `KEY=value` assignments because `source` executes
the file as shell code. Commands launched from that shell inherit the keys.
Services launched by `systemd` do not read `~/.bashrc`; use the service
`EnvironmentFile=` for managed gateway processes.

Local secrets-file path:

```bash
mkdir -p ~/.config/switchmaxxer
cp config-examples/secrets.example.json ~/.config/switchmaxxer/secrets.json
chmod 0600 ~/.config/switchmaxxer/secrets.json
$EDITOR ~/.config/switchmaxxer/secrets.json
```

At runtime, provider auth precedence is inline `api_key`, then a matching
`secrets.json` `api_key_overrides` entry, then the real environment variable.
Operator read surfaces report `auth_source` without printing the secret value.

## Fastest Safe Operator Flow

If you want the shortest sane operator workflow, use:

```bash
smx config validate
smx gateway start
smx gateway status --json
smx test --route gpt-4o-mini
smx invoke --route gpt-4o-mini --prompt "hello"
```

That sequence:

- validates the config and required inputs
- starts the managed gateway
- confirms the listener is actually reachable
- proves one route through the live gateway
- sends one real one-off request through the same route

When a route reaches the gateway but behaves differently than an upstream
provider expects, add `--inspect` to the one-off invoke:

```bash
smx invoke --route gpt-4o-mini --prompt "hello" --inspect
```

`--inspect` shows the non-streaming request and response bodies and headers at
four points: client to Switchmaxxer, Switchmaxxer to provider, provider to
Switchmaxxer, and Switchmaxxer back to the client. This is the fastest local
view for AI ecosystem integrators who need to confirm model ids, API-mode
translation, provider headers, and response shape. Secret-bearing headers are
masked by default. Add `--include-secrets` only on a trusted terminal when you
intentionally need to see local auth-like headers and have opted the gateway
process in with `SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`. Upstream provider
authorization remains redacted even in this mode.

## Startup Models

Switchmaxxer supports two common operator patterns.

Managed service:

```bash
smx gateway start
smx gateway stop
smx gateway restart
smx gateway enable
smx gateway disable
```

Foreground process:

```bash
smx gateway run
smx gateway run --log-level debug
```

Use the managed-service path for normal workstation or long-running local deployments. Use `gateway run` when you want foreground logs, fast iteration, or debugging.

## Lifecycle Commands

Common lifecycle commands:

```bash
smx gateway start
smx gateway stop
smx gateway restart
smx gateway reload
smx gateway status --json
smx gateway runtime config --json
```

Meaning:

- `gateway start`: asks the configured supervisor to start the gateway service
- `gateway stop`: stops the managed gateway service
- `gateway restart`: performs a full stop/start cycle
- `gateway reload`: sends an in-process config reload signal instead of a full restart
- `gateway status`: gives the best high-level operator summary
- `gateway runtime config`: shows the live process view of the loaded runtime configuration

## Health And Status

Use these as your first checks:

```bash
smx gateway status --json
smx gateway auth --json
smx gateway health
smx gateway runtime config --json
```

`gateway status --json` is the best default operator summary because it combines:

- runtime process state
- listener reachability
- service-manager state when available
- config path
- route/provider/model counts
- redacted `inbound_auth_state` (`enabled`, `disabled_explicit`, or `misconfigured`)
- aggregate `health_probe_metrics` counters for `/health` traffic

`GET /health` is intentionally minimal. It is a liveness probe, not a full diagnostic dump.

Use `gateway auth --json` when you need a focused local auth diagnostic before
startup, during key rotation, or during an incident. It does not print the
inbound token; when a usable token is present it prints a short fingerprint for
verification.

Health-probe observability note:

- `/health` requests are not stored as normal trace observations
- high probe traffic therefore does not appear in `trace list` counts
- use `smx gateway status --json` or MCP `gateway_status` to inspect the
  lightweight `health_probe_metrics` aggregate instead

## Listener Addresses And Endpoints

Default listener:

```text
127.0.0.1:4080
```

Default OpenAI-compatible base URL:

```text
http://localhost:4080
```

Default Anthropic-compatible base URL:

```text
http://localhost:4080/anthropic
```

Main endpoints:

- `GET /health`
- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`

Clients that expect Anthropic Messages mode from the base URL should be pointed at a base URL ending in `/anthropic`.

## Config And Readiness

Before starting or reloading the gateway, validate config readiness:

```bash
smx config validate
```

This is the right first step when you change:

- routes
- providers
- models
- listener settings
- inbound auth settings
- provider env vars

Validation catches configuration problems before you hit the live request path.

One important boundary note:

- on OpenAI-listener routes that translate to Anthropic upstreams, some client
  request fields such as `temperature`, `top_p`, and `metadata` are
  intentionally passed through to Anthropic rather than fully re-validated by
  Switchmaxxer first
- OpenAI tool definitions, tool choices, assistant tool calls, and client tool
  results are translated into Anthropic tool definitions, `tool_use`, and
  `tool_result` structures; Switchmaxxer does not run provider-requested tools
- if those values are malformed for Anthropic, you may see an upstream `400`
  from Anthropic rather than a local Switchmaxxer validation error

## Inbound Auth

If inbound auth is configured, all non-`/health` gateway endpoints require the configured inbound token.

Accepted client auth forms:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`

The local `smx` CLI automatically sends the configured inbound token for its own gateway-backed operator commands, including:

- `smx invoke`
- gateway-backed `smx test`
- `smx bench --path gateway`
- `smx gateway runtime config`

If inbound auth is misconfigured, the gateway should fail closed rather than silently accepting requests.

Unauthenticated local-only development mode note:

- keep inbound auth enabled for normal use, including loopback use
- `allow_unauthenticated_gateway: true` is intended only as a development
  escape hatch for direct local binds
- the gateway decides whether a request is "local" from the connected socket
  address plus the request `Host` header
- it does not trust `X-Forwarded-For`, `X-Real-IP`, or similar proxy headers for
  that decision
- unauthenticated gateway POSTs must include `Content-Type: application/json`
  and `X-Switchmaxxer-Local-Client: 1`
- if `one_trusted_operator_boundary: true` is also set, trusted local apps such
  as OpenClaw do not need to send `X-Switchmaxxer-Local-Client: 1`
- browser-originated cross-site signals such as hostile `Origin`,
  `Sec-Fetch-Site`, or `Sec-Fetch-Mode` values are rejected
- loopback no-auth is not safe against malicious webpages by itself; browsers
  can send requests to local services even when they cannot read the response
- if you place a reverse proxy in front of the listener, the gateway may only
  see the proxy's socket address rather than the original caller
- do not assume unauthenticated mode remains safely "localhost-only" behind a
  general reverse proxy unless a future release adds an explicit trusted-proxy
  model for that boundary

Reverse proxy and source-IP note:

- the failed-auth limiter and main per-caller rate limiter also key on the
  connected socket peer address, not on forwarded client-IP headers
- this is intentional because Switchmaxxer currently expects to be the edge
  listener for auth and abuse controls
- if you run it behind a reverse proxy anyway, multiple callers may collapse
  into the proxy's IP and therefore share one failed-auth or rate-limit bucket
- current proxy deployments should enforce any client-aware abuse controls
  upstream, at the proxy layer
- future first-class proxy support should only trust forwarded client-IP
  headers behind an explicit `trusted_proxies` allowlist

## Route Testing

Useful route-test commands:

```bash
smx test
smx test --route gpt-4o-mini
smx test --no-gateway
smx test --route gpt-4o-mini --no-gateway
```

Use them like this:

- `smx test`: test all configured routes through the live gateway
- `smx test --route <id>`: test one route through the live gateway
- `smx test --no-gateway`: bypass the gateway and test direct upstream reachability
- `smx test --route <id> --no-gateway`: isolate one route and its provider wiring

This distinction is useful operationally:

- gateway-mode testing answers "is the whole gateway path working?"
- direct-mode testing answers "is the route/provider configuration itself working?"

## Logging

Primary log commands:

```bash
smx gateway logs show --lines 50
smx gateway logs tail --lines 100
smx gateway logs show --format json --lines 20
```

Important logging notes:

- the CLI prefers `journalctl --user -u <effective-unit>` and falls back when needed
- request-path logs include a `request_id`
- proxied responses include `x-switchmaxxer-request-id`
- log-level precedence is: CLI flag, then environment, then config, then default `info`

Useful debug modes:

```bash
smx gateway run --log-level debug
SWITCHMAXXER_LOG_LEVEL=debug smx gateway run
```

For a single non-streaming request, prefer `smx invoke --inspect` when you need
the actual client/proxied/upstream/returned bodies and headers. Debug logs
explain gateway decisions over time; inspect mode shows the concrete protocol
payloads for one local invoke. Inspect captures are in-memory, one-time runtime
data and are not written to logs or the observability store.

Representative debug lifecycle events include:

- `debug_ingress`
- `debug_route_resolution`
- `debug_upstream_request`
- `debug_upstream_retry`
- `debug_response_path`
- `debug_client_response`
- `debug_error_context`

## Live Runtime Fields Worth Knowing

`smx gateway runtime config --json` exposes useful live-process state such as:

- `started_at`
- `loaded_at`
- `last_reload_status`
- `last_reload_error`
- `last_reload_attempted_at`
- `last_reload_succeeded_at`
- `process_integrity_status`
- `last_fatal_error`
- `last_fatal_at`

This is the best place to inspect what the running process believes is true right now.

## Runtime Defaults

The shipped example config uses:

- request timeout: `15000ms`
- streaming idle timeout: `120000ms`
- max concurrent connections: `200`
- max inbound payload size: `4000000 bytes`

Always confirm the live values with `smx gateway runtime config --json` if you are diagnosing behavior on a running gateway.

## Common Operator Scenarios

Gateway will not start:

- run `smx config validate`
- inspect `smx gateway logs show --lines 100`
- confirm required env vars are set
- confirm the configured bind host/port are valid

Gateway starts but tests fail:

- run `smx gateway status --json`
- run `smx test --route <route-id>`
- compare with `smx test --route <route-id> --no-gateway`
- inspect logs for route resolution and upstream errors

Gateway is up but clients get auth errors:

- confirm inbound auth is intentionally enabled
- confirm the client is sending the expected bearer token or `x-api-key`
- confirm the CLI-selected config matches the gateway's config path

Config changed but behavior did not:

- run `smx gateway reload`
- inspect `smx gateway runtime config --json`
- check `last_reload_status` and `last_reload_error`

## Practical Operator Checklist

Before rollout:

- run `smx config validate`
- confirm required provider env vars are present
- confirm inbound auth policy is intentional
- confirm bind host and port are correct

After startup:

- run `smx gateway status --json`
- run `smx test --route <known-good-route>`
- verify logs are readable

During incident response:

- capture `smx gateway status --json`
- capture `smx gateway runtime config --json`
- capture recent logs
- compare gateway-mode and direct-mode route tests

## Reverse Proxy Note

Switchmaxxer is designed to key failed-auth backoff and streaming concurrency
limits from the directly connected socket peer address.

That is the safe default because it avoids blindly trusting
`X-Forwarded-For` / `X-Real-IP` headers from callers.

Operational consequence:

- if you place a reverse proxy in front of the Switchmaxxer listener, the
  gateway may only see the proxy's IP
- many downstream clients can then collapse into one shared limiter bucket
- one attacker can trigger failed-auth backoff that affects other clients
  arriving through the same proxy address

Preferred deployment shape:

- expose the Switchmaxxer listener directly on its intended bind host
- do not rely on a general reverse proxy in front of it for routine local
  deployments unless you explicitly accept the shared-bucket limiter behavior
- especially do not use reverse-proxied unauthenticated mode as a substitute
  for direct local binding; the loopback-only trust rule is based on the socket
  peer the gateway actually sees

If a future release adds forwarded-IP trust, it should be behind an explicit
trusted-proxy configuration model rather than implicit header trust.

## Related Docs

- [config-reference.md](../subsystems/config/config-reference.md)
- [how-to-launch-switchmaxxer-mcp.md](../subsystems/mcp/how-to-launch-switchmaxxer-mcp.md)
- [tech-spec-for-cli-surface.md](../subsystems/cli/tech-spec-for-cli-surface.md)
- [tech-spec-for-gateway.md](../subsystems/gateway/tech-spec-for-gateway.md)
