# How To Connect OpenClaw To Switchmaxxer

## Purpose

This guide captures the practical integration contract for running OpenClaw as a
local Switchmaxxer client.

Use it when you want OpenClaw to:

- send model traffic through the Switchmaxxer gateway
- expose Switchmaxxer route names as OpenClaw model IDs
- launch Switchmaxxer as an MCP server
- run MCP diagnostics such as `routes_explain`, `gateway_status`, and
  `bench_run`

For the lower-level architecture notes, see
[../ecosystem/openclaw/tech-spec-for-switchmaxxer-openclaw-plugin.md](../ecosystem/openclaw/tech-spec-for-switchmaxxer-openclaw-plugin.md).

## Step 0 — Load The Integration Skill Into OpenClaw

> **Do this before you start using OpenClaw agents to call Switchmaxxer.** It
> takes one minute and prevents most of the time-wasting failure modes.

OpenClaw agents that call Switchmaxxer MCP tools (`optimize_run`,
`optimize_apply`, `bench_run`, `routes_*`, etc.) consistently fail without
specific guidance — they confuse routes with models, guess `model_id` instead
of `model`, write wrapper scripts to materialize secrets that Switchmaxxer
already resolves on its own, and restart the wrong process. Load the
integration skill once and the agent skips all of that.

The skill file:

[../ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md](../ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md)

Pick one of the two patterns below.

### Option A — Paste into OpenClaw's agent system prompt

This is the most reliable form: the skill is in the agent's context window for
every turn, with no extra tool call.

1. Open the skill file:

   ```bash
   cat /absolute/path/to/switchmaxxer/docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md
   ```

2. Copy the entire contents.

3. In OpenClaw, open the agent that talks to Switchmaxxer. Locate the agent's
   instructions / system-prompt slot (typical location: agent configuration
   panel, or `~/.openclaw/agents/<id>/agent/...` files). Paste the skill
   contents there. Save.

4. Restart the agent (or start a new conversation) so the new instructions
   take effect.

### Option B — Reference the file at task start

Use this if you'd rather not bake the skill into agent config and prefer a
just-in-time read. Tell the agent at the start of any Switchmaxxer-related
task:

> Before you begin, read
> `/absolute/path/to/switchmaxxer/docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md`
> and treat its rules as authoritative for this task.

The agent reads the file once and proceeds with the right rules loaded. This
costs one tool call per task but keeps agent config untouched.

### Verify the skill loaded

Ask the agent a quick check question whose answer is in the skill:

> Without calling any tool, what is the canonical-model field name for the
> Switchmaxxer MCP `optimize_run` tool, and what is the difference between a
> route and a canonical model in Switchmaxxer?

A loaded agent should answer: the field is `model` (not `model_id`); a route
is a request-level selection key naming a `(model, service_provider,
provider_model_id)` triple, while the canonical model is the model family
(e.g. `gpt-4o-mini`) that one or more routes can target. If the agent
hedges, guesses, or asks to call a tool to find out, the skill is not loaded.

If you skip Step 0, expect the agent to make the failures captured in the
skill's "What This Skill Replaces" section. They are not theoretical.

## Switchmaxxer Side

Keep `config.json` and `catalog.json` next to each other. `config.json` owns
gateway policy, security, MCP, observability, and runtime limits. `catalog.json`
owns `service_providers`, `routes`, and `models`.

A local trusted OpenClaw setup commonly uses:

```json
{
  "bind_host": "127.0.0.1",
  "port": 4080,
  "allow_unauthenticated_gateway": true,
  "one_trusted_operator_boundary": true,
  "mcp": {
    "capabilities": ["read", "mutation", "privileged"]
  }
}
```

With `allow_unauthenticated_gateway: true` and
`one_trusted_operator_boundary: false`, OpenClaw must send:

```text
x-switchmaxxer-local-client: 1
```

With `allow_unauthenticated_gateway: true` and
`one_trusted_operator_boundary: true`, trusted local loopback apps do not need
that marker header. Switchmaxxer still keeps the loopback `Host` checks and
browser-origin / Fetch Metadata rejection behavior.

If you use inbound bearer auth instead, remove `allow_unauthenticated_gateway`,
configure `inbound_api_key_env`, and have OpenClaw send
`Authorization: Bearer <token>`.

After changing gateway code, rebuilding, or changing runtime config, restart the
managed Switchmaxxer gateway:

```bash
npm run build
smx gateway restart
smx gateway health --config ./config.json --json
```

`smx gateway restart` operates the configured user service and does not accept
`--config`; use `smx gateway reload --config ./config.json` for a live config
reload when only reloadable config changed.

## OpenClaw Provider

Point OpenClaw at the OpenAI-compatible Switchmaxxer listener:

```json
{
  "models": {
    "providers": {
      "switchmaxxer": {
        "baseUrl": "http://127.0.0.1:4080/v1",
        "api": "openai-completions",
        "authHeader": false,
        "headers": {
          "X-Switchmaxxer-Caller": "openclaw"
        },
        "request": {
          "allowPrivateNetwork": true
        },
        "models": [
          {
            "id": "MiniMax-M2.7-highspeed",
            "name": "MiniMax M2.7 Highspeed",
            "input": ["text"],
            "reasoning": true,
            "api": "openai-completions"
          },
          {
            "id": "gpt-4o-mini",
            "name": "GPT-4o-Mini",
            "input": ["text", "image"],
            "reasoning": false,
            "api": "openai-completions"
          }
        ]
      }
    }
  }
}
```

If your Switchmaxxer config uses `one_trusted_operator_boundary: false`, add the
local-client marker:

```json
"headers": {
  "x-switchmaxxer-local-client": "1",
  "X-Switchmaxxer-Caller": "openclaw"
}
```

OpenClaw model references should use the Switchmaxxer provider ID plus the exact
Switchmaxxer route key:

```text
switchmaxxer/MiniMax-M2.7-highspeed
switchmaxxer/gpt-4o-mini
switchmaxxer/openrouter-gpt-4o-mini
```

Do not use the upstream provider model ID unless it is also the Switchmaxxer
route key. Switchmaxxer route names are the stable client-facing contract.

Restart OpenClaw after changing its provider/model config:

```bash
openclaw gateway restart
```

For a dev profile, use the matching OpenClaw profile flag, for example:

```bash
openclaw --dev gateway restart
```

## OpenClaw MCP Server Entry

OpenClaw can launch Switchmaxxer as a stdio MCP server:

```json
{
  "mcp": {
    "servers": {
      "switchmaxxer": {
        "command": "/home/adam-kessler/dev/switchmaxxer/smx",
        "args": [
          "mcp",
          "serve",
          "--config",
          "/home/adam-kessler/dev/switchmaxxer/config.json"
        ],
        "env": {
          "SWITCHMAXXER_OBSERVABILITY_DB": "/home/adam-kessler/dev/switchmaxxer/.switchmaxxer/observability.sqlite"
        }
      }
    }
  }
}
```

Use absolute paths for the command, config, and observability DB. MCP clients
often launch servers from a working directory that is not the Switchmaxxer repo.

Preview what OpenClaw's MCP server will expose:

```bash
smx mcp capabilities --config /home/adam-kessler/dev/switchmaxxer/config.json --json
```

Capability tiers:

- `read`: inspect config, routes, gateway state, traces, bench history, and
  optimize history
- `mutation`: create/update/delete normal models, providers, and routes; repair
  traces; apply or restore persisted optimize recommendations
- `privileged`: mutate provider auth material, run `bench_run` and
  `optimize_run`, prune the observability store, and read the Control Plane
  Audit Ledger

Use `["read", "mutation", "privileged"]` only when OpenClaw is intentionally
inside the same trusted local operator boundary as Switchmaxxer.

## Provider Keys And MCP Bench

Provider keys are resolved in the process that performs the upstream call or
preflight check. This is the most common source of confusing OpenClaw MCP
failures (benchmarks, optimize apply, route mutations).

For `bench_run`:

- `path_mode: "gateway"` sends benchmark requests through the running
  Switchmaxxer gateway; the gateway process needs the provider key
- `path_mode: "direct"` sends benchmark requests from the MCP server process;
  the OpenClaw-launched `smx mcp serve` process needs the provider key
- `path_mode: "both"` uses both processes and therefore both environments need
  the relevant provider keys

For `optimize_apply` and route mutations: the MCP server process runs catalog
validation that walks **every route**, not just the optimize target. So a
missing key for any route in the catalog can block an apply targeting an
unrelated route. The apply also runs `providerMissingDetectableAuth` against the
winner provider before mutating.

For example, the `gpt-4o-mini` route uses `openai_direct`, which usually
references:

```json
"api_key_env": "SWITCHMAXXER_OPENAI_API_KEY"
```

If OpenClaw launches `smx mcp serve` without that env var (and without
`SWITCHMAXXER_SECRETS_PATH`), direct-path MCP benchmarks and optimize_apply for
`gpt-4o-mini` can fail even when normal gateway invocations work.

### How `auth_source` Resolution Actually Works

The MCP server's preflight auth check (`providerMissingDetectableAuth`) does
**not** unconditionally probe `process.env`. It first inspects the provider's
resolved `auth_source`:

- if `auth_source === "secrets override"`, the check returns immediately with no
  error — `process.env` is never touched
- if `auth_source === "inline override"` or `"not required"`, the check also
  short-circuits
- only when `auth_source === "env var"` does the check fall through to
  `process.env[provider.api_key_env]`

`auth_source` becomes `"secrets override"` when the SMX read-model loads a
`secrets.json` file that contains an `api_key_overrides` entry for the
provider's `api_key_env`. The read-model finds that file via
`SWITCHMAXXER_SECRETS_PATH` (preferred) or the default
`$XDG_CONFIG_HOME/switchmaxxer/secrets.json` /
`~/.config/switchmaxxer/secrets.json` location.

The practical consequence: **if OpenClaw passes `SWITCHMAXXER_SECRETS_PATH` to
the spawned MCP child and that file contains the key override, you do not need
the corresponding `SWITCHMAXXER_*_API_KEY` env var in the MCP child's
`process.env`.** The two are alternative key-resolution mechanisms, not
complementary requirements.

### Preferred Ways To Make Keys Available

In order of preference for OpenClaw deployments:

1. **`SWITCHMAXXER_SECRETS_PATH` in the MCP server `env`** pointing at a
   chmod-600 `secrets.json`. This is the portable, secret-not-in-config form.
2. Put the key in the environment of the OpenClaw gateway/service before
   OpenClaw starts the MCP server, so the spawned MCP child inherits it.
3. As a local-only last resort, put `SWITCHMAXXER_<PROVIDER>_API_KEY` directly
   in the MCP server `env` entry, and never commit that config.

`config-examples/secrets.example.json` shows the portable file shape:

```json
{
  "api_key_overrides": {
    "SWITCHMAXXER_OPENAI_API_KEY": "replace-with-local-openai-key"
  }
}
```

The recommended OpenClaw MCP env block is:

```json
"env": {
  "SWITCHMAXXER_OBSERVABILITY_DB": "/home/adam-kessler/dev/switchmaxxer/.switchmaxxer/observability.sqlite",
  "SWITCHMAXXER_SECRETS_PATH": "/home/adam-kessler/.config/switchmaxxer/secrets.json"
}
```

After editing the OpenClaw MCP server config, **OpenClaw must re-spawn the MCP
child process** for the new `env` to take effect. Restarting the SMX gateway
does nothing for this — the MCP child is owned by OpenClaw, not by SMX. In most
MCP hosts the re-spawn happens by restarting OpenClaw itself or by closing and
reopening the MCP server connection.

### Verifying The MCP Child Sees The Secrets File

Call the MCP tool `providers_show` through OpenClaw — not the SMX CLI directly,
which would prove only that your shell has the env var, not that the spawned
MCP child does:

```json
{
  "name": "openai_direct"
}
```

Inspect the response's `auth_source` field:

- `"secrets override"` — `SWITCHMAXXER_SECRETS_PATH` reached the MCP child and
  the secrets file contains the override. Optimize apply, bench direct, and
  route mutations will work without needing the raw env var.
- `"env var"` — the secrets file did not provide the override (either the env
  variable did not reach the child, the path is wrong, the file is unreadable,
  or the file does not contain that `api_key_env` key). Apply will fall back to
  the `process.env` check and may fail.
- `"not required"` — the provider does not require a key (e.g. `ollama_local`,
  `switchmaxxer`). No action needed.

If `auth_source` reads `"env var"` when you expected `"secrets override"`,
the failure is in the OpenClaw → MCP child env plumbing, not in SMX.

## MCP `optimize_run` And `optimize_apply` Shape

The MCP `optimize_run` tool's input field for the canonical model is `model`,
**not** `model_id`. Agents commonly guess `model_id` because that name is used
elsewhere in MCP/JSON-RPC ecosystems; the call will fail with an input
validation error. Use:

```json
{
  "model": "gpt-4o-mini",
  "objective": "cost"
}
```

`model` must be a canonical model id from `models.<id>`, not a route id.
`cheap-gpt`, `fast-gpt`, `openrouter-gpt-4o-mini` are routes; `gpt-4o-mini` is
the model. If you want to optimize a specific route, look up the route's `model`
field first via `routes_show` and feed that to `optimize_run`. Passing a route
id where a model id is expected returns `model_not_found`.

`optimize_apply` then takes the resulting `run_id` plus the `route_id` you want
to mutate:

```json
{
  "run_id": "<run-id from optimize_run>",
  "route_id": "cheap-gpt",
  "dry_run": true
}
```

A successful apply atomically rewrites three fields on the target route:
`service_provider`, `provider_model_id`, and `cost`. The returned `mutation`
object exposes per-field `{ changed, from, to }` blocks for each. The
`dry_run: true` form returns the same diff without writing `catalog.json`.

`optimize_restore <action_id>` is the undo; it rewrites those same three fields
back to the values captured in the apply event's `before_json`.

## MCP `bench_run` Shape

MCP tool input is not CLI syntax. Use `route_id` for one route, or `routes` for
many routes:

```json
{
  "route_id": "MiniMax-M2.7-highspeed",
  "prompt": "Return exactly ok.",
  "iterations": 1,
  "warmup": 0,
  "concurrency": 1,
  "path_mode": "gateway"
}
```

Do not send `route`, `model`, `--route`, or `--path` as MCP arguments. The MCP
schema allows only:

- `prompt`
- `route_id`
- `routes`
- `iterations`
- `warmup`
- `concurrency`
- `path_mode`
- `timeout_ms`

If a client appears to benchmark `gpt-4o-mini` after you requested a different
route, inspect the actual MCP tool arguments. In current Switchmaxxer,
`bench_run` does not silently default to `gpt-4o-mini`; it requires exactly one
of `route_id` or `routes`.

## Tool Calls Through MiniMax Routes

Switchmaxxer translates OpenAI tool calls to Anthropic `tool_use` blocks when a
route points to an Anthropic-compatible upstream such as MiniMax. It also
translates upstream `tool_use.input` back to OpenAI
`tool_calls[].function.arguments`.

MiniMax's Anthropic-compatible surface may return `thinking` blocks before a
valid `tool_use`. Current Switchmaxxer intentionally ignores
`thinking` / `redacted_thinking` blocks for OpenAI clients and does not expose
their signatures or private reasoning text.

If OpenClaw reports empty tool arguments through a MiniMax-backed route:

1. rebuild and restart Switchmaxxer so the running gateway has the current
   translator:

   ```bash
   npm run build
   smx gateway restart
   ```

2. probe the route directly:

   ```bash
   curl -sS -X POST http://127.0.0.1:4080/v1/chat/completions \
     -H 'content-type: application/json' \
     -H 'X-Switchmaxxer-Caller: openclaw-diagnostic' \
     -d '{
       "model": "MiniMax-M2.7-highspeed",
       "messages": [
         {
           "role": "user",
           "content": "Call the exec tool with command exactly pwd. Do not answer in text."
         }
       ],
       "tools": [
         {
           "type": "function",
           "function": {
             "name": "exec",
             "description": "Run a shell command",
             "parameters": {
               "type": "object",
               "additionalProperties": false,
               "properties": {
                 "command": { "type": "string" }
               },
               "required": ["command"]
             }
           }
         }
       ],
       "tool_choice": "auto",
       "stream": false,
       "max_tokens": 1024
     }'
   ```

The healthy response contains:

```json
"function": {
  "name": "exec",
  "arguments": "{\"command\":\"pwd\"}"
}
```

For streaming responses, the healthy OpenAI-compatible shape is an initial tool
delta with `arguments: ""`, followed by one or more argument deltas containing
the JSON text.

## Quick Diagnostic Matrix

| Symptom | Likely cause | First check |
|---|---|---|
| Gateway request returns `403` asking for `x-switchmaxxer-local-client` | `allow_unauthenticated_gateway: true` with `one_trusted_operator_boundary: false` | Add the header or set `one_trusted_operator_boundary: true` intentionally |
| OpenClaw cannot call `127.0.0.1:4080` | OpenClaw private-network guard | Set `request.allowPrivateNetwork: true` |
| MCP `tools/list` does not include `bench_run` | Missing `privileged` capability | `smx mcp capabilities --config ./config.json --json` |
| MCP `bench_run` for `gpt-4o-mini` fails but gateway invoke works | MCP server process lacks `SWITCHMAXXER_OPENAI_API_KEY` and `SWITCHMAXXER_SECRETS_PATH` | Use `path_mode: "gateway"`, or add `SWITCHMAXXER_SECRETS_PATH` to the OpenClaw MCP server `env` and re-spawn |
| MCP benchmark seems to ignore a route | Wrong MCP input field or dropped tool args | Use `route_id`, not `route` or CLI flags |
| MiniMax tool calls have empty arguments | Old gateway build or bad streaming/tool translation | Rebuild, restart, and run the direct tool-call probe |
| MCP `optimize_run` returns input validation error | Wrong field name | Use `model`, not `model_id` |
| MCP `optimize_run` returns `model_not_found` | Caller passed a route id where a model id is expected | Look up the route's `model` via `routes_show` first |
| MCP `optimize_apply` fails with "requires environment variable …" even though SMX CLI works | OpenClaw MCP child does not have `SWITCHMAXXER_SECRETS_PATH` (or env var) in its `env` | Verify by calling MCP `providers_show` and checking `auth_source`; restart OpenClaw to re-spawn the MCP child after editing its config |
| Edited OpenClaw MCP server `env` block but nothing changed | OpenClaw did not re-spawn the MCP child process | Restart OpenClaw or close/reopen the MCP server connection — restarting the SMX gateway is unrelated |
| `optimize_apply` succeeded but `provider_model_id` or `cost` look stale on the target route | Old SMX build before the three-field-atomic-mutation fix | Rebuild SMX (`npm run build`) and `smx gateway restart` |

