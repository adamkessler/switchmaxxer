# Skill: Switchmaxxer ↔ OpenClaw Integration

## Purpose

Use this skill when an agent (typically running inside OpenClaw) needs to set
up, debug, or operate the OpenClaw → Switchmaxxer integration via Switchmaxxer's
MCP server.

This skill is for agentic use. It is not a general OpenClaw architecture spec.
It is a practical guide for answering questions like:

- "Optimize the cost of route `cheap-gpt` and apply the change."
- "Why is `optimize_apply` saying my OpenAI key is missing when SMX itself works?"
- "Why does `optimize_run` reject my call?"
- "How do I confirm OpenClaw's MCP child can see Switchmaxxer's secrets file?"
- "Did the route mutation actually rewrite the catalog correctly?"

If you are an agent and the user has loaded this skill, prefer the rules and
recipes here over guessing from tool descriptions. The pitfalls listed below
are real failures observed in production agent sessions, not theoretical.

## When To Use This Skill

Use this skill when:

- the user wants OpenClaw to call any Switchmaxxer MCP tool
- the task involves `optimize_run`, `optimize_apply`, `optimize_restore`,
  `bench_run`, `routes_*`, or `providers_*`
- you need to reason about why an MCP call to Switchmaxxer is failing
- the user mentions `cheap-gpt`, `fast-gpt`, or any other Switchmaxxer route
  name and asks the agent to act on it

Do not use this skill when:

- the user is editing Switchmaxxer config or catalog files directly via shell
  with no MCP involvement
- the task is purely about Hermes (use the Hermes skill instead)

## Core Mental Model

Switchmaxxer exposes three concept tiers. **Confusing them is the most common
agent failure mode.**

| Concept | Examples | Where it appears |
|---|---|---|
| **service provider** | `openai_direct`, `openrouter`, `anthropic_direct`, `minimax_direct`, `gemini`, `ollama_local` | Transport backends |
| **canonical model** | `gpt-4o-mini`, `claude-sonnet-4-6`, `MiniMax-M2.7-highspeed` | The model family |
| **route** | `cheap-gpt`, `fast-gpt`, `openrouter-gpt-4o-mini`, `gpt-4o-mini`, `claude-sonnet-direct` | The request-level selection key |

Routes are the user-facing identifier. A route names a `(model, service_provider, provider_model_id)` triple. **Many routes can target the same model.** `cheap-gpt`, `fast-gpt`, and `gpt-4o-mini` are all separate routes that all serve the canonical model `gpt-4o-mini`.

### The single most common mistake

When the user says "optimize the route `cheap-gpt`", they mean:

1. Look up which model `cheap-gpt` serves (it serves the model `gpt-4o-mini`).
2. Run `optimize_run` with `model: "gpt-4o-mini"` (the canonical model id, NOT the route id).
3. Apply the winner to the route `cheap-gpt` via `optimize_apply` with `route_id: "cheap-gpt"`.

Passing `model: "cheap-gpt"` to `optimize_run` returns `model_not_found` because `cheap-gpt` is a route name, not a model name.

## Critical MCP Tool Field Names

These names trip up agents because they don't match common conventions in other
MCP/JSON-RPC ecosystems.

### `optimize_run`

| ❌ Wrong | ✅ Correct |
|---|---|
| `model_id` | `model` |
| route name as `model` | canonical model id as `model` |

```json
{
  "model": "gpt-4o-mini",
  "objective": "cost"
}
```

Optional inputs: `routes` (CSV of route ids to restrict candidates),
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` for
cost; `prompt`, `iterations`, `warmup`, `concurrency`, `path_mode`,
`timeout_ms` for latency.

The response payload's `data.run.run_id` is the run identifier you pass to
`optimize_apply`. Note: it is **`data.run.run_id`**, not `data.run_id`.

### `optimize_apply`

```json
{
  "run_id": "<from optimize_run>",
  "route_id": "cheap-gpt",
  "dry_run": true
}
```

A successful apply atomically rewrites three fields on the target route:

- `service_provider`
- `provider_model_id`
- `cost`

The returned `mutation` envelope contains:

- legacy `field`/`from`/`to` keys describing the primary `service_provider` flip
- per-field diff blocks `service_provider`, `provider_model_id`, and `cost`,
  each with `{ changed, from, to }`

`dry_run: true` returns the same diff without writing `catalog.json`.

### `optimize_restore`

Pass the `action_id` returned by a previous `optimize_apply`:

```json
{
  "action_id": "<apply action_id>"
}
```

Restore rewrites the same three fields back to the values captured in the
apply event's `before_json`. It is a complete round-trip undo of the apply.

### `bench_run`

```json
{
  "route_id": "gpt-4o-mini",
  "prompt": "Return exactly ok.",
  "iterations": 1,
  "warmup": 0,
  "concurrency": 1,
  "path_mode": "gateway"
}
```

Use `route_id` for one route, `routes` for multiple. **Do not** send `route`,
`model`, `--route`, or `--path` — those are CLI flags, not MCP fields.

`path_mode` choices:

- `"gateway"` — request goes through the Switchmaxxer gateway process
- `"direct"` — request goes from the MCP server process directly to upstream
- `"both"` — both paths are exercised

## The `auth_source` Mechanism (Secrets Resolution)

This is the second most common agent failure. Get it wrong and you'll
incorrectly conclude that `SWITCHMAXXER_*_API_KEY` env vars are required when
they aren't.

### How the preflight auth check actually works

Before mutating, `optimize_apply` calls `providerMissingDetectableAuth` against
the winner provider. This function does **not** unconditionally probe
`process.env`. It first inspects the provider's resolved `auth_source`:

| `auth_source` value | Behavior |
|---|---|
| `"secrets override"` | Returns null (no error). `process.env` is never touched. |
| `"inline override"` | Returns null. |
| `"not required"` | Returns null. |
| `"env var"` | Falls through to `process.env[provider.api_key_env]`. |

`auth_source` becomes `"secrets override"` when Switchmaxxer's read-model
loads a `secrets.json` file containing an `api_key_overrides` entry for the
provider's `api_key_env`. The read-model finds that file via:

- `SWITCHMAXXER_SECRETS_PATH` env var (preferred — explicit and portable), or
- the default `$XDG_CONFIG_HOME/switchmaxxer/secrets.json` /
  `~/.config/switchmaxxer/secrets.json` location

### The practical consequence

**If `SWITCHMAXXER_SECRETS_PATH` is in the OpenClaw MCP child's `env` and the
file contains the relevant override, you do not need `SWITCHMAXXER_*_API_KEY`
in `process.env`.**

These are alternative key-resolution mechanisms, not complementary requirements.
A wrapper script that reads the secrets file and re-exports env vars is
**unnecessary and wrong**. If you are tempted to write one, stop and verify
`auth_source` first using the recipe below.

### The verification recipe

Call MCP `providers_show` through OpenClaw — not the SMX CLI directly, which
proves only that your shell has the env var, not that the spawned MCP child
does:

```json
{
  "name": "openai_direct"
}
```

Inspect the response's `auth_source`:

- `"secrets override"` — secrets file is reaching the MCP child. Apply, bench
  direct, and route mutations will work without any raw env var.
- `"env var"` — secrets file did not provide the override (env var didn't
  reach the child, path is wrong, file is unreadable, or the file does not
  contain that `api_key_env`).
- `"not required"` — provider has no key requirement (e.g. `ollama_local`).

If `auth_source` reads `"env var"` when you expected `"secrets override"`, the
failure is in the OpenClaw → MCP child env plumbing, not in Switchmaxxer.

## Process Boundaries (Where Restarts Apply)

There are **three** independent processes. Restarting the wrong one is a
common time-waster.

| Process | Restarts via | What it knows |
|---|---|---|
| OpenClaw gateway/agent | `openclaw gateway restart` | OpenClaw's own config and the spawned MCP child |
| OpenClaw-spawned `smx mcp serve` (MCP child) | OpenClaw re-spawns it when its own config changes | The `env` block from OpenClaw's MCP server config |
| Switchmaxxer managed gateway | `smx gateway restart` | Catalog, routes, models, providers; serves data-plane traffic |

Rules:

- After editing `catalog.json` directly: `smx gateway reload` or
  `smx gateway restart`.
- After editing the OpenClaw MCP server config's `env` block (e.g. to add
  `SWITCHMAXXER_SECRETS_PATH`): **restart OpenClaw**, not SMX. The MCP child
  re-spawns when OpenClaw restarts.
- Restarting the SMX gateway has no effect on the MCP child's environment.

## Recommended OpenClaw MCP Server Entry

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
          "SWITCHMAXXER_OBSERVABILITY_DB": "/absolute/path/to/switchmaxxer/.switchmaxxer/observability.sqlite",
          "SWITCHMAXXER_SECRETS_PATH": "/home/<user>/.config/switchmaxxer/secrets.json"
        }
      }
    }
  }
}
```

Use absolute paths. MCP clients launch servers from a working directory that
is rarely the Switchmaxxer repo. Do not put raw API keys in this config —
use `SWITCHMAXXER_SECRETS_PATH` and let the read-model resolve them.

## Recipe: "Optimize Route `<route-id>` For Cost And Apply"

Default playbook for cost optimization tasks:

1. **Identify the model.** Call `routes_show` with `name: "<route-id>"`. Read
   the response's `model` field. That is the canonical model id you'll pass to
   `optimize_run`.

2. **Run the optimization.** Call `optimize_run`:

   ```json
   {
     "model": "<canonical model id from step 1>",
     "objective": "cost"
   }
   ```

   Save `data.run.run_id` and inspect `data.winner.route_id`. If the winner is
   the same route the user named, no apply is needed — tell them.

3. **Dry-run the apply.** Call `optimize_apply` with `dry_run: true`. The
   response's `mutation` block shows the three-field diff
   (`service_provider`, `provider_model_id`, `cost`). Show this to the user.

4. **Apply if the user confirms** (or unconditionally if they granted
   advance approval). Call `optimize_apply` again without `dry_run`, optionally
   with `reload: true` so the gateway picks up the new mapping. Save
   `data.action_id` for possible later restore.

5. **Verify the catalog state.** Call `routes_show` again and confirm
   `service_provider`, `provider_model_id`, and `cost` all match the winner.

## Recipe: "Undo An `optimize_apply`"

```json
{
  "action_id": "<the action_id returned by the apply>"
}
```

Pass to `optimize_restore`. It rewrites the same three fields back to the
pre-apply state captured in the apply event. The mutation is observable: the
restore event has `parent_event_id = <apply action_id>` in
`config_mutation_events`.

## Diagnostic Decision Tree

When an MCP call fails, work through this tree before forming a hypothesis:

1. **Is it an input validation error?**
   - "model_id is unknown" → use `model`, not `model_id`.
   - "model not found" → you passed a route id where a model id was expected.
     Look up the route's `model` first.
   - "field 'route_id' is required" → use `route_id` not `route`.

2. **Did `optimize_apply` say "requires environment variable …"?**
   - The error message names a specific provider env var (e.g.
     `SWITCHMAXXER_OPENAI_API_KEY`) and a specific route name. The route named
     in the error is the one whose provider failed auth resolution — not
     necessarily the route you targeted with `optimize_apply`. SMX validates
     every route in the catalog post-mutation, so an unrelated route's missing
     auth can block your apply.
   - Call MCP `providers_show` for that route's `service_provider` (or the
     winner's `service_provider` if the error names the winner).
   - If `auth_source: "secrets override"` → SMX's read-model and mutation
     validator both honor the secrets file. If apply still fails with this
     error after you see "secrets override", you are running an old SMX build
     from before the mutation validator was wired to the secrets file. Rebuild
     SMX (`npm run build`) and force OpenClaw to re-spawn its MCP child by
     restarting OpenClaw. **Do not edit `catalog.json` manually as a
     workaround**; the apply path is correct as of current SMX, and the
     manual edit will skip the snapshot, mutation event, and audit row that
     `optimize_restore` needs.
   - If `auth_source: "env var"` → the OpenClaw MCP child does not have
     `SWITCHMAXXER_SECRETS_PATH` set, or the secrets file does not contain
     the override. Fix OpenClaw's MCP server `env`, then restart OpenClaw.

3. **Did the catalog change but `mutation.changed: false`?**
   - The route was already in the post-apply state from an earlier attempt.
     Check `routes_show` to confirm.

4. **Does the SMX CLI work but MCP doesn't?**
   - The CLI inherits your shell's env; the MCP child does not. The agent's
     diagnosis must be made from MCP-side calls (`providers_show`,
     `gateway_status`), not from running CLI commands in a shell.

## What This Skill Replaces

If you previously read or were trained on:

- "the optimize apply mutation only writes `service_provider`" — **outdated**.
  Apply now writes `service_provider`, `provider_model_id`, and `cost`
  atomically.
- "you must export `SWITCHMAXXER_*_API_KEY` for the MCP child to call upstream
  providers" — **incorrect** when `SWITCHMAXXER_SECRETS_PATH` is configured.
- "MCP `optimize_run` takes `model_id`" — **incorrect**. The field is `model`.
- "restart the SMX gateway after editing OpenClaw MCP config" — **wrong
  process**. Restart OpenClaw.

## Native MCP Tool Access Is Required

The recipes in this skill assume the SMX MCP server's tools are exposed to you
as **native, directly-callable tools** — the same way any other tool from any
other MCP server appears in your tool surface. You should be able to call
`providers_show`, `optimize_run`, `optimize_apply`, etc. with one tool call,
the same way you'd call `read_file`.

SMX uses standard MCP stdio framing (newline-delimited JSON, one JSON-RPC
message per `\n`-terminated line). It is compatible with the official
`@modelcontextprotocol/sdk` and any MCP host that follows the spec. If you
have to fall back to writing your own MCP client, that almost certainly means
**OpenClaw failed to surface the tools to your tool list**, not that SMX is
non-compliant.

If you find yourself doing any of the following to call a Switchmaxxer MCP
tool, **stop and tell the user before proceeding**:

- writing or maintaining a Python MCP client across turns
- constructing `tools/call` JSON-RPC envelopes by hand
- opening a stdio pipe to `smx mcp serve` yourself
- piping or shelling JSON-RPC messages into the MCP server process
- falling back to the SMX CLI because "MCP transport is having an issue"

Those are signs that the host environment (typically OpenClaw) is not
exposing the SMX MCP server's tools as native callable tools, which is a
configuration bug on the host side. SMX itself is fine. The recipes in this
skill will still work via manual MCP-protocol scaffolding, but every step is
slower, more error-prone, and easier to silently get wrong.

When you detect the situation, tell the user something like:

> I don't appear to have native access to the Switchmaxxer MCP tools — I have
> to drive the MCP protocol manually (or fall back to the SMX CLI). This is
> likely an OpenClaw tool-exposure configuration issue, not a Switchmaxxer
> issue. Would you like me to proceed with the manual workaround for this
> single task, or stop so you can fix the host-side wiring first?

Then wait for guidance. **Do not silently substitute SMX CLI calls for MCP
calls.** They have different env scopes and different `auth_source` resolution
and can produce divergent answers (see the `auth_source` section above and
Diagnostic Decision Tree item 4). A correct answer reached via the wrong
transport is still a hazard for the next task.

If the user asks you to proceed manually for a single task, do so, but keep
flagging the wiring issue at task end. The wiring fix is a one-time setup;
silently routing around it compounds.

## This Skill Is Self-Contained

If you are an agent reading this file, treat the rules and recipes above as
the complete reference for OpenClaw → Switchmaxxer MCP usage. **You do not
need to follow any links to other documents to do your job.** Everything
required for the common tasks (route optimization, apply, restore, bench,
provider auth verification) is inline above.

The OpenClaw process does not run inside the Switchmaxxer repository, so
relative paths like `../../...` will not resolve from the agent's working
directory. If the user references a related Switchmaxxer document, ask them
for the absolute path of the Switchmaxxer repo on their machine, then
construct the absolute file path yourself.

## How To Load This Skill Into An OpenClaw Session

Two practical patterns. Both assume the user knows the absolute path of the
Switchmaxxer repository on their machine — call this `<SMX_REPO>` below
(e.g. `/home/adam-kessler/dev/switchmaxxer`).

1. **Agent system prompt / instructions.** Paste the entire contents of this
   file (`<SMX_REPO>/docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md`)
   into OpenClaw's per-agent instructions or system-prompt slot for the
   agent that talks to Switchmaxxer. The agent then has the skill in context
   for every turn with no extra tool calls. This is the most reliable pattern.

2. **Reference at the start of a task.** Tell the agent:

   > Before you begin, read the file at the absolute path
   > `<SMX_REPO>/docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md`
   > and follow its rules as authoritative.

   The user must substitute the real path for `<SMX_REPO>`. The agent reads
   the file once and proceeds with the rules loaded.

The skill is intentionally short enough to fit in any agent's context window
without truncation. Update it when integration behavior changes; do not let
it drift.

## Related Documents (For Humans Browsing The Switchmaxxer Repo)

This section is for human operators reading this file in their editor or on
GitHub. Agents loaded with this skill: skip this section — the skill above
is self-contained.

Paths below are relative to the Switchmaxxer repo root:

- `docs/ecosystem/openclaw/tech-spec-for-switchmaxxer-openclaw-plugin.md`
  — full integration architecture (data model, base URLs, inbound auth)
- `docs/how-to/how-to-connect-openclaw-to-switchmaxxer.md`
  — copyable operator setup guide
- `docs/subsystems/observability/tech-spec-for-optimize-command.md`
  — optimize command internals (what apply mutates, how snapshots work)
- `docs/subsystems/mcp/tech-spec-for-mcp.md`
  — full MCP tool surface and capability tiers
- `docs/swe/project-plan-for-mcp-secrets.md`
  — the secrets-resolution plan with phases and verification recipe
