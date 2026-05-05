# Switchmaxxer OpenClaw Tight Integration Tech Spec

This document describes the tightest practical integration between OpenClaw
and Switchmaxxer using OpenClaw's existing provider, config, and model catalog
surfaces.

Documentation placement note:

- this document stays under `docs/ecosystem/openclaw/`
- it should not be moved into `docs/swe/` with Switchmaxxer-owned internal tech
  specs
- the organizing principle is domain ownership first: `docs/swe/` is for
  Switchmaxxer's internal software-engineering specs, while `docs/ecosystem/openclaw/`
  holds boundary documents for the OpenClaw integration domain

The primary goal is tight integration:

- OpenClaw should treat Switchmaxxer as the main LLM boundary
- OpenClaw should select Switchmaxxer routes as its effective model ids
- OpenClaw configuration and runtime materialization should stay aligned

The secondary goal is a clean current integration boundary:

- keep room for a Switchmaxxer-specific visual component in OpenClaw without
  making the integration depend on that UI

This is an educational technical spec. It explains how the pieces fit together
 and what the preferred integration shape should be.

Current Switchmaxxer integration note:

- the live operator/runtime surface is now centered on `switchmaxxer gateway ...`
- current troubleshooting should still start with logs-first LWTS observability, but Switchmaxxer now also has a real persisted trace and benchmark store through `switchmaxxer trace ...` and `switchmaxxer bench ...`

## Core Idea

Switchmaxxer should sit between OpenClaw and upstream model vendors.

In the preferred setup:

- OpenClaw does not primarily talk to OpenAI, Anthropic, MiniMax, or
  OpenRouter directly
- OpenClaw talks to one or more Switchmaxxer listeners
- OpenClaw sends the Switchmaxxer route name in the `model` field
- Switchmaxxer resolves that route to the real upstream provider and model

That means the integration contract is simple:

- OpenClaw provider id: `switchmaxxer`
- OpenClaw model id: a Switchmaxxer route name
- OpenClaw provider base URL: the appropriate Switchmaxxer listener root

For active debugging, the most relevant current Switchmaxxer operator commands are:

- `switchmaxxer gateway status --json`
- `switchmaxxer test --route <route-id>`
- `switchmaxxer invoke --route <route-id> ...`
- `switchmaxxer invoke --route <route-id> ... --inspect`
- `switchmaxxer gateway logs show --format json`
- `switchmaxxer gateway logs tail --format json`

Use `--inspect` for a single non-streaming reproduction when you need to see
exactly what OpenClaw sent to Switchmaxxer, what Switchmaxxer sent upstream, and
what came back. Secret-bearing headers are masked unless the local operator adds
`--include-secrets` and has opted the gateway process in with
`SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`; upstream provider authorization remains
redacted.

OpenClaw itself does not need to send `x-switchmaxxer-inspect`,
`x-switchmaxxer-inspect-id`, or `x-switchmaxxer-inspect-token` for normal model
traffic. Those headers are part of Switchmaxxer's local operator inspection
handshake: the CLI requests a capture with `x-switchmaxxer-inspect: 1`, the
gateway allocates the capture id and one-time read token, and the gateway
returns them in `x-switchmaxxer-inspect-id` and
`x-switchmaxxer-inspect-token`. If OpenClaw cannot emit custom debug headers out
of the box, the integration still works; only the optional inspect capture flow
needs those headers.

Example:

- OpenClaw model ref: `switchmaxxer/openrouter-gpt-4o-mini`
- request body model field sent to Switchmaxxer: `openrouter-gpt-4o-mini`
- Switchmaxxer route resolution:
  - route name: `openrouter-gpt-4o-mini`
  - upstream provider: `openrouter`
  - upstream provider model id: `openai/gpt-4o-mini`

## What The Code Already Does

The important OpenClaw behavior is already present.

OpenClaw config is the source layer:

- `openclaw.json` can define `models.providers.*`
- `agents.defaults.models` can restrict the allowed model refs
- `agents.defaults.model` can select the primary and fallback model refs

OpenClaw runtime materializes providers into the local agent state:

- `src/agents/models-config.ts` writes `agent/models.json`
- `src/agents/models-config.plan.ts` merges explicit and implicit provider data
- `src/agents/models-config.merge.ts` preserves some existing provider fields in
  merge mode

OpenClaw then reads that materialized file as the runtime model catalog:

- `src/agents/model-catalog.ts`
- `src/agents/pi-model-discovery.ts`
- `src/agents/pi-embedded-runner/run.ts`

This is the key integration model:

- `openclaw.json` is the intended config source of truth
- `~/.openclaw/agents/<id>/agent/models.json` is the runtime materialization
- the two should agree

The tight integration goal is therefore not to bypass `models.json`, but to
ensure it is generated from an explicit and stable Switchmaxxer provider
definition in `openclaw.json`.

## Switchmaxxer Data Model

Switchmaxxer exposes three major concepts:

- `service_providers`
- `routes`
- `models`

### Service Providers

`service_providers` are Switchmaxxer's transport backends.

Examples:

- `openai_direct`
- `anthropic_direct`
- `openrouter`
- `minimax_direct`
- `switchmaxxer`
- `switchmaxxer_anthropic`
- `ollama_local`

These are not the main ids OpenClaw users should select.

They are backend routing targets used internally by Switchmaxxer.

### Routes

`routes` are the most important integration object for OpenClaw.

Each route has:

- a route name
- a canonical model family
- a provider-specific upstream model id
- a target Switchmaxxer service provider
- a display name

Examples:

- `gpt-4o-mini`
- `claude-sonnet-4-6`
- `MiniMax-M2.7-highspeed`
- `openrouter-gpt-4o-mini`
- `claude-sonnet-via-openrouter`
- `llama-local`

For OpenClaw, these route names should be treated as the effective model ids.

### Models

Switchmaxxer `models` are canonical metadata rows.

They are useful for:

- display labels
- grouping aliases
- tracking model creators

But they are not the main request-level selection key.

The request-level selection key should remain the Switchmaxxer route name.

## OpenClaw Data Model

The OpenClaw side of the integration should use these concepts.

### Provider Namespace

Use `switchmaxxer` as the primary provider namespace.

This gives model refs such as:

- `switchmaxxer/gpt-4o-mini`
- `switchmaxxer/claude-sonnet-4-6`
- `switchmaxxer/MiniMax-M2.7-highspeed`
- `switchmaxxer/openrouter-gpt-4o-mini`

If a second listener family is exposed separately, use a second provider id:

- `switchmaxxer-anthropic`

That should stay optional, not required for the integration contract.

### Model Rows

Each OpenClaw model row should correspond to one Switchmaxxer route.

Recommended mapping:

| Switchmaxxer | OpenClaw |
| --- | --- |
| `routes.<routeName>` | `models.providers.switchmaxxer.models[].id` |
| `routes.<routeName>.display_name` | `models.providers.switchmaxxer.models[].name` |
| `routes.<routeName>.model` | optional aliasing or diagnostics only |
| `routes.<routeName>.service_provider` | optional diagnostics only |
| `routes.<routeName>.provider_model_id` | optional diagnostics only |

The OpenClaw model id should be the exact route name.

### Base URL Mapping

For the config you shared, the recommended listener roots are:

- OpenAI-compatible listener:
  - `http://localhost:4080/v1`
- Anthropic-compatible listener:
  - `http://localhost:4080/anthropic`

That lines up with Switchmaxxer endpoints such as:

- `http://localhost:4080/v1/chat/completions`
- `http://localhost:4080/anthropic/v1/messages`

And maps naturally to OpenClaw provider APIs:

- `openai-completions`
- `anthropic-messages`

## Inbound Auth Contract

Switchmaxxer's inbound listener runs in one of three states, surfaced by
`smx gateway auth`:

- `enabled` — `inbound_api_key_env` is set to a Switchmaxxer-managed env var
  whose value is at least 32 characters; clients must send
  `Authorization: Bearer <token>` on every request
- `disabled_explicit` — `allow_unauthenticated_gateway: true` is set; no bearer
  token is required, but each request must satisfy three lighter checks
- `misconfigured` — `inbound_api_key_env` is set but the env var is missing,
  empty, or shorter than 32 chars; every request returns
  `500 inbound_auth_misconfigured` until fixed

The `disabled_explicit` mode is the default local-development shape and the one
most likely to surprise an OpenClaw operator. In that mode, Switchmaxxer
enforces:

1. `Host` header must be a loopback host or the configured `bindHost` on the
   configured port; anything else returns `421 Misdirected Request`. This blocks
   DNS-rebinding attacks where a remote site resolves to `127.0.0.1`.
2. The opt-in marker header `x-switchmaxxer-local-client: 1` must be present on
   data-plane and control routes unless `one_trusted_operator_boundary: true`
   is configured; without the header in the default mode, the gateway returns
   `403` with the message
   `Unauthenticated gateway requests require header 'x-switchmaxxer-local-client: 1'.`
3. The `Origin` header, if present, must point at a loopback host; cross-site
   browser origins return `403`.

In the default mode, these three checks substitute for a bearer token: real
local CLI/agent clients (curl, OpenClaw, in-process scripts) can trivially set
the marker header, while a browser tab on `evil.com` cannot, because
Switchmaxxer never returns the CORS preflight that would permit a custom header
cross-origin. With `one_trusted_operator_boundary: true`, Switchmaxxer skips
the marker-header requirement but keeps the loopback Host and browser-origin
checks.

### What this means for OpenClaw

- in `disabled_explicit` mode with `one_trusted_operator_boundary: false`,
  **OpenClaw must send the literal header
  `x-switchmaxxer-local-client: 1` on every outbound request** to the
  Switchmaxxer listener
- in `disabled_explicit` mode with `one_trusted_operator_boundary: true`,
  OpenClaw can call the loopback listener without the local-client marker header
- in `enabled` mode OpenClaw must send `Authorization: Bearer <token>` and
  should **not** send the marker header
- in `misconfigured` mode no client can succeed; fix the env var on the
  Switchmaxxer side first

OpenClaw exposes static per-provider headers in two equivalent slots — pick
whichever you already use:

- `models.providers.<id>.headers` — provider-level static headers, merged into
  every request
- `models.providers.<id>.request.headers` — per-request override headers,
  merged after default attribution and auth resolution

Because `127.0.0.1` is in a private address range, OpenClaw's outbound HTTP
guard (`fetchWithSsrFGuard`) blocks the request by default. Set
`models.providers.<id>.request.allowPrivateNetwork: true` for the Switchmaxxer
provider to opt this loopback boundary in.

### Recommended OpenClaw provider entry for `disabled_explicit` mode

```json
{
  "models": {
    "providers": {
      "switchmaxxer": {
        "baseUrl": "http://127.0.0.1:4080/v1",
        "api": "openai-completions",
        "authHeader": false,
        "headers": {
          "x-switchmaxxer-local-client": "1"
        },
        "request": {
          "allowPrivateNetwork": true
        }
      }
    }
  }
}
```

CLI form (avoids hand-editing JSON, mirrors what `openclaw config schema` exposes):

```bash
openclaw config set models.providers.switchmaxxer.baseUrl "http://127.0.0.1:4080/v1"
openclaw config set models.providers.switchmaxxer.api "openai-completions"
openclaw config set models.providers.switchmaxxer.authHeader false
openclaw config set models.providers.switchmaxxer.headers \
  '{"x-switchmaxxer-local-client":"1"}' --strict-json
openclaw config set models.providers.switchmaxxer.request.allowPrivateNetwork true
```

### Switching to `enabled` mode

When the deployment graduates from local development to anything reachable
beyond loopback, switch Switchmaxxer to bearer-token mode:

1. set `inbound_api_key_env` in `config.json` (e.g.
   `SWITCHMAXXER_INBOUND_API_KEY`) to a Switchmaxxer-managed env var name
2. export that env var with a 32+ character random token before the gateway
   process starts (or restart the systemd unit so it picks up the value)
3. remove `allow_unauthenticated_gateway` from `config.json`
4. `smx gateway reload` and confirm `smx gateway auth` reports `Status: enabled`

Then update OpenClaw:

1. drop the `x-switchmaxxer-local-client` header from
   `models.providers.switchmaxxer.headers`
2. wire the bearer token through OpenClaw's auth path — the recommended shape is
   to set `models.providers.switchmaxxer.apiKey` to a SecretRef pointing at the
   same env var, with `authHeader: true` to force `Authorization: Bearer …`
3. confirm Switchmaxxer accepts traffic by hitting the gateway with the same
   token from the OpenClaw host: `curl -H "Authorization: Bearer $TOKEN"
   http://127.0.0.1:4080/health`

In `enabled` mode the marker header is ignored, so leaving it on the request
during a phased migration is harmless.

### Diagnosing inbound-auth issues from the Switchmaxxer side

Two operator commands are the canonical first stops:

- `smx gateway auth [--json]` — prints the active inbound auth state
  (`enabled` / `disabled_explicit` / `misconfigured`), the env var name, the
  configured min-length policy, and a token fingerprint when one is loaded
- `smx gateway logs tail --format json --follow` — every rejected request is
  logged with the rejection reason
  (`missing or invalid local-client header`, `cross-site Origin header`,
  `unexpected Host`, `inbound_auth_misconfigured`)

If OpenClaw cannot connect, run those two commands first; they identify
whether the failure is on the Switchmaxxer policy side, the OpenClaw header
side, or the Switchmaxxer config side.

## MCP Control Plane Integration

OpenClaw can also launch Switchmaxxer as an MCP server over stdio. This is a
control-plane integration, separate from model traffic through the gateway.

Recommended server entry shape:

```json
{
  "mcp": {
    "servers": {
      "switchmaxxer": {
        "command": "/absolute/path/to/switchmaxxer/smx",
        "args": [
          "mcp",
          "serve",
          "--config",
          "/absolute/path/to/switchmaxxer/config.json"
        ],
        "env": {
          "SWITCHMAXXER_OBSERVABILITY_DB": "/absolute/path/to/switchmaxxer/.switchmaxxer/observability.sqlite"
        }
      }
    }
  }
}
```

The effective MCP tool surface is controlled by Switchmaxxer's `mcp.capabilities`
config. Use `["read"]` for inspection-only OpenClaw sessions. Add `mutation` or
`privileged` only when OpenClaw is intentionally inside the same trusted local
operator boundary as Switchmaxxer.

`bench_run` is the main place where provider-key ownership can be surprising:

- `path_mode: "gateway"` uses the running Switchmaxxer gateway process
- `path_mode: "direct"` uses the OpenClaw-launched MCP server process
- `path_mode: "both"` uses both

That means a route such as `gpt-4o-mini` can work through normal gateway
traffic while direct MCP benchmarking fails if the MCP server process did not
receive `SWITCHMAXXER_OPENAI_API_KEY` or `SWITCHMAXXER_SECRETS_PATH`.

The MCP server's preflight auth check honors the same `auth_source` field the
read-model exposes for `providers_show`. When `SWITCHMAXXER_SECRETS_PATH` is
set in the MCP child's `env` and the file contains an
`api_key_overrides` entry for the relevant `api_key_env`, `auth_source` becomes
`"secrets override"` and the env-var check is skipped entirely. The
recommended verification recipe — call MCP `providers_show` for the upstream
provider and inspect `auth_source` — is documented in the operator how-to.

`bench_run` tool input uses MCP field names, not CLI flags. Send `route_id` or
`routes`, plus `path_mode`; do not send `route`, `model`, `--route`, or
`--path`. Likewise, `optimize_run` takes `model` (a canonical model id, not a
route id) and `objective`; agents that guess `model_id` will get an input
validation error.

`optimize_apply` and `optimize_restore` mutate three fields atomically on the
target route — `service_provider`, `provider_model_id`, and `cost` — so the
post-apply route is consistent with the new upstream's identifier and pricing,
not just its provider id.

When OpenClaw edits the MCP server `env` block, OpenClaw must re-spawn the MCP
child process for the change to take effect. Restarting the SMX gateway has no
effect on the MCP child, which is owned by OpenClaw.

For the copyable operator guide, see
[../../how-to/how-to-connect-openclaw-to-switchmaxxer.md](../../how-to/how-to-connect-openclaw-to-switchmaxxer.md).

For an agent-loadable skill that captures the integration gotchas in a
condensed, instruction-shaped form (intended to be pasted into OpenClaw's
agent instructions or read at task start), see
[switchmaxxer-openclaw-integration-skill.md](switchmaxxer-openclaw-integration-skill.md).

## Preferred Tight Integration Shape

The preferred shape is config-first and explicit.

### Principle 1: Declare Switchmaxxer In `openclaw.json`

Do not rely only on agent-local cached state.

Even though OpenClaw runs from `agent/models.json`, the Switchmaxxer provider
should be explicitly declared in `openclaw.json` so the runtime file is
reproducible and understandable.

Recommended shape:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "switchmaxxer": {
        "baseUrl": "http://127.0.0.1:4080/v1",
        "api": "openai-completions",
        "authHeader": false,
        "headers": {
          "x-switchmaxxer-local-client": "1",
          "X-Switchmaxxer-Caller": "openclaw"
        },
        "request": {
          "allowPrivateNetwork": true
        },
        "models": [
          {
            "id": "gpt-4o-mini",
            "name": "GPT-4o-Mini",
            "input": ["text", "image"],
            "reasoning": false
          },
          {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6",
            "input": ["text", "image"],
            "reasoning": false
          },
          {
            "id": "MiniMax-M2.7-highspeed",
            "name": "MiniMax M2.7 Highspeed",
            "input": ["text"],
            "reasoning": true
          },
          {
            "id": "openrouter-gpt-4o-mini",
            "name": "GPT-4o-Mini (via OpenRouter)",
            "input": ["text", "image"],
            "reasoning": false
          }
        ]
      }
    }
  }
}
```

### Principle 2: Use Route Names As OpenClaw Model Ids

The exact Switchmaxxer route key should be the model id that OpenClaw selects and
sends.

That means:

- OpenClaw model ref: `switchmaxxer/openrouter-gpt-4o-mini`
- outgoing request model field: `openrouter-gpt-4o-mini`

Switchmaxxer then maps that route to the upstream provider.

This is the cleanest contract because it avoids leaking upstream provider ids
back into OpenClaw.

It also aligns with Switchmaxxer's current observability model because:

- the route name remains the stable request key
- the gateway returns `x-switchmaxxer-request-id`
- the same `request_id` can be used to follow the request through normalized gateway logs and the persisted `switchmaxxer trace` surface

### Principle 3: Curate The OpenClaw Allowlist

Use `agents.defaults.models` as the curated allowlist of Switchmaxxer-backed
model refs.

Recommended shape:

```json
{
  "agents": {
    "defaults": {
      "models": {
        "switchmaxxer/MiniMax-M2.7-highspeed": {},
        "switchmaxxer/claude-sonnet-4-6": {},
        "switchmaxxer/gpt-4o-mini": {},
        "switchmaxxer/openrouter-gpt-4o-mini": {}
      },
      "model": {
        "primary": "switchmaxxer/openrouter-gpt-4o-mini",
        "fallbacks": [
          "switchmaxxer/gpt-4o-mini",
          "switchmaxxer/claude-sonnet-4-6"
        ]
      }
    }
  }
}
```

This gives OpenClaw:

- a strict set of route-backed models
- a clear default
- a stable fallback order

### Principle 4: Keep Direct Upstream Providers Optional

If Switchmaxxer is the main LLM boundary, direct upstream providers should not be
the main operator-facing surface.

That means:

- direct provider plugins may still exist
- direct provider auth may still exist
- but the normal operator flow should point at `switchmaxxer/*` refs

This keeps operational control concentrated in Switchmaxxer.

## Data Dictionary

This is the recommended shared vocabulary for a tight integration.

### `switchmaxxer provider`

An OpenClaw provider entry that points at a Switchmaxxer listener.

Required fields:

- `id`
- `baseUrl`
- `api`
- `models`

Recommended fields:

- `headers`
- `request.allowPrivateNetwork`
- `authHeader: false` when no auth header is required at the Switchmaxxer boundary

### `switchmaxxer route model`

An OpenClaw model row whose id is a Switchmaxxer route name.

Required fields:

- `id`
- `name`

Recommended fields:

- `input`
- `reasoning`
- `contextWindow`
- `maxTokens`
- `cost`

### `canonical model`

The Switchmaxxer-level abstract model family from `routes.<id>.model`.

Examples:

- `gpt-4o-mini`
- `claude-sonnet-4-6`

This is useful for metadata and grouping, but should not replace the route id
as the OpenClaw request model id.

### `upstream provider`

The Switchmaxxer `service_provider` that ultimately receives the request.

Examples:

- `openai_direct`
- `anthropic_direct`
- `openrouter`
- `minimax_direct`

This is valuable for diagnostics and UI integration, but not required for normal
OpenClaw inference behavior.

## Configuration Recommendations

### Recommended Baseline

For the tight integration shape described here:

- define `models.providers.switchmaxxer` explicitly in `openclaw.json`
- use `baseUrl: "http://127.0.0.1:4080/v1"`
- use `api: "openai-completions"`
- send the `x-switchmaxxer-local-client: 1` header in `disabled_explicit` mode
  unless `one_trusted_operator_boundary: true` is configured, or wire
  `Authorization: Bearer <token>` in `enabled` mode (see "Inbound Auth Contract")
- set `request.allowPrivateNetwork: true` so OpenClaw's outbound HTTP guard
  permits the loopback target
- use route names as model ids
- use `agents.defaults.models` as the curated exposure set
- use `agents.defaults.model.primary` and `fallbacks` for the default route

This is enough to make OpenClaw send its LLM traffic through Switchmaxxer in a
clean and stable way.

### Anthropic Listener

Do not require a second provider immediately.

Because your Switchmaxxer OpenAI-compatible listener can expose routes backed by
OpenAI, Anthropic, MiniMax, OpenRouter, and local services, a single
`switchmaxxer` provider is enough for this integration.

A second provider is still useful later if OpenClaw needs:

- native Anthropic wire semantics
- Anthropic-only route curation
- transport-specific debugging

If added later, use:

- provider id: `switchmaxxer-anthropic`
- base URL: `http://localhost:4080/anthropic`
- api: `anthropic-messages`

### Alias Discipline

Switchmaxxer may expose multiple route aliases for the same canonical model.

Examples from your config:

- `openrouter-gpt-4o-mini`
- `gpt-4o-mini-via-openrouter`
- `claude-sonnet-via-openrouter`
- `openrouter-claude-sonnet-4-6`

OpenClaw should not expose every alias by default.

Preferred rule:

- Switchmaxxer may expose multiple aliases for one canonical route surface
- OpenClaw should expose only the curated route set needed for users and agents

This avoids a noisy picker and avoids duplicate-seeming model choices.

### Secrets

Switchmaxxer itself may carry the upstream provider credentials.

That means the OpenClaw-to-Switchmaxxer boundary can often be:

- local
- unauthenticated
- loopback only

If that is the intended deployment shape, OpenClaw should not require fake API
keys like `"not-needed"` in the long-term source config.

Preferred direction:

- no fake credential values in user-facing config
- explicit `authHeader: false` where applicable
- loopback binding plus request policy controls

## Why This Does Not Require A New Plugin Yet

OpenClaw already has the right seams for this integration:

- custom providers with `baseUrl`, `api`, headers, and model lists
- agent default model selection
- allowlisted agent model catalogs
- runtime materialization into `agent/models.json`

So the integration should stay config-first.

That keeps the integration:

- small
- understandable
- debuggable
- aligned with current OpenClaw architecture

## Future Extension Point: Switchmaxxer Visual Component

The UI component is a real next step, but it should be treated as an extension
of the tight integration, not a prerequisite for it.

Any UI built on top of this integration should answer operator questions such as:

- which Switchmaxxer routes are exposed to OpenClaw
- which route is the current default
- which upstream provider each route maps to
- whether a route is direct, proxied, or local

Recommended component ideas:

- a Switchmaxxer provider card in the Control UI
- a route table derived from the curated OpenClaw provider catalog
- optional diagnostics showing canonical model and upstream provider

This document does not require those components for the integration contract.

The immediate integration target is:

- explicit Switchmaxxer provider config in `openclaw.json`
- stable materialization into `agent/models.json`
- route-backed model selection throughout OpenClaw

## Summary

The preferred integration is:

- one primary OpenClaw provider named `switchmaxxer`
- one primary Switchmaxxer listener at `http://127.0.0.1:4080/v1`
- Switchmaxxer route names used as OpenClaw model ids
- explicit provider declaration in `openclaw.json`
- inbound auth aligned with `smx gateway auth`:
  `x-switchmaxxer-local-client: 1` header in `disabled_explicit` mode unless
  `one_trusted_operator_boundary: true`, bearer token in `enabled` mode
- `request.allowPrivateNetwork: true` so OpenClaw's HTTP guard permits the
  loopback target
- curated `agents.defaults.models`
- default and fallback route selection in `agents.defaults.model`

This gives OpenClaw a tight Switchmaxxer integration without requiring a new
plugin, while keeping a clean path open for a Switchmaxxer visual
component in the UI.
