# Switchmaxxer MCP Tech Spec

## Purpose

This document defines the `switchmaxxer mcp` implementation.

The goal is to describe the reliable stdio server in source: the
config contract, the supported observability contract, and the
mutation, repair, and benchmark operations available to MCP clients.

## Scope

The supported MCP surface includes:

- `switchmaxxer mcp serve`
- stdio transport
- JSON-RPC framing as newline-delimited JSON (the MCP stdio standard: one JSON-RPC message per `\n`-terminated line)
- supported MCP methods:
  - `initialize`
  - `ping`
  - `tools/list`
  - `tools/call`
- a narrow config-management tool surface:
  - `config_schema`
  - `config_validate`
  - `config_show`
  - `models_list`
  - `models_show`
  - `models_create`
  - `models_update`
  - `models_delete`
  - `providers_list`
  - `providers_show`
  - `providers_create`
  - `providers_update`
  - `providers_delete`
  - `providers_set_key`
  - `providers_clear_key`
  - `providers_set_key_env`
  - `routes_list`
  - `routes_show`
  - `routes_explain`
  - `routes_create`
  - `routes_update`
  - `routes_delete`
- a supported gateway inspection surface:
  - `gateway_health`
  - `gateway_status`
  - `gateway_runtime_config`
- a supported observability surface:
  - `trace_list`
  - `trace_show`
  - `trace_stats`
  - `trace_observations`
  - `trace_verify`
  - `trace_repair`
  - `prune`
  - `ledger_list`
  - `ledger_show`
  - `bench_list`
  - `bench_show`
  - `bench_run`
  - `optimize_list`
  - `optimize_show`
  - `optimize_run`
  - `optimize_apply`
  - `optimize_restore`

This surface does not include:

- resources
- prompts
- streaming tool results
- HTTP transport
- authentication
- broader observability mutation/admin tools beyond `trace_repair`, `prune`,
  and privileged Ledger reads
- benchmark profile/optimization tooling beyond `bench_run`, model-scoped
  `optimize_run`, and provider-scoped `optimize_apply` / `optimize_restore`

## Design Principles

- Reuse the CLI’s machine-facing config contract instead of inventing a second schema.
- Keep the MCP surface narrow even though it includes config mutations.
- Treat tool results as contract-bearing objects, not ad hoc text blobs.
- Preserve the secret-handling posture from the CLI. Provider `api_key` is masked, never returned raw.
- Use JSON-RPC errors for protocol failures and tool-result envelopes for domain-level success/error semantics.
- Keep MCP stricter than the general human CLI where the trust boundary is different.
- Treat MCP config-path selection as a bounded machine-facing input, not as an unrestricted filesystem browsing surface.
- Treat the MCP server as a trusted operator-tooling surface, not as a general-purpose endpoint for untrusted agents.

## Trust Model

Switchmaxxer MCP is currently a local stdio operator surface, not a
multi-tenant or remotely exposed control plane.

That trust assumption is load-bearing today:

- `switchmaxxer mcp serve` opens one trusted local stdio session
- that session receives the capability tiers listed in `mcp.capabilities`
- omitted MCP capability policy defaults to read-only access with a warning
- all three tiers require an explicit config opt-in:
  `["read", "mutation", "privileged"]`
- the server does not currently negotiate or reduce those grants per caller
  beyond the config-level policy

In practical terms, a local MCP client connected over stdio can use stronger
operations only when the config explicitly grants the matching capability:

- `providers_update` when changing provider auth fields such as `api_key_env`
  or `no_auth`
- `providers_set_key`
- `prune`
- `bench_run`
- `optimize_run`
- `optimize_apply`
- `optimize_restore`

Full access should be read as a trusted local operator workflow, not as a safe
default for untrusted agents or future networked transports.

## CLI Surface

### Command

```text
switchmaxxer mcp serve [--config <path>]
switchmaxxer mcp capabilities [--config <path>] [--json]
```

Launch examples for real stdio MCP consumers are documented in [how-to-launch-switchmaxxer-mcp.md](how-to-launch-switchmaxxer-mcp.md).

### Behavior

- Runs until stdin closes.
- Reads MCP messages from stdin as newline-delimited JSON (one JSON-RPC message per `\n`-terminated line, the MCP stdio standard).
- Writes MCP responses to stdout using the same newline-delimited JSON framing.
- Prints the effective granted MCP capability set to stderr at startup.
- Resolves the config path once at startup from:
  - `--config <path>` when provided
  - otherwise `./config.json`
- Bounds config-path resolution to the current working tree.
- Rejects `--config` values that escape the working-tree root via `..` traversal or absolute paths outside that root.
- `mcp capabilities --json` uses the same config resolution and capability
  resolution logic as `mcp serve`, then reports granted tiers plus concrete
  enabled and disabled MCP tool names.

### Module Boundaries

The current MCP implementation is intentionally split so the stdio runner,
request dispatch, and lower-level helpers do not all live in one file.

- [src/subsystems/mcp/mcp.ts](../../../src/subsystems/mcp/mcp.ts)
  - owns the stdio server entrypoint, session lifecycle wiring, and the higher-level tool payload builders
- [src/subsystems/mcp/dispatch.ts](../../../src/subsystems/mcp/dispatch.ts)
  - owns top-level JSON-RPC method dispatch for `initialize`, `ping`, `tools/list`, `tools/call`, notification handling, and protocol-level error responses
- [src/subsystems/mcp/protocol.ts](../../../src/subsystems/mcp/protocol.ts)
  - owns newline-delimited JSON framing, parser buffering, and JSON-RPC protocol write helpers
- [src/subsystems/mcp/parsers.ts](../../../src/subsystems/mcp/parsers.ts)
  - owns typed MCP tool argument parsing
- [src/subsystems/mcp/config-entity-handlers.ts](../../../src/subsystems/mcp/config-entity-handlers.ts)
  - owns config mutation/read payload builders for models, providers, and routes
- [src/subsystems/mcp/session.ts](../../../src/subsystems/mcp/session.ts)
  - owns per-session observability handle lifecycle

The design intent is for [src/subsystems/mcp/mcp.ts](../../../src/subsystems/mcp/mcp.ts) to stay the thin MCP
entry and wiring layer, while branch-heavy request dispatch and narrower helper
concerns remain in the `src/subsystems/mcp/` subtree.

### Config Path Boundary

Switchmaxxer intentionally applies a stricter config-path policy to MCP than to the general CLI.

- Normal CLI `--config` is an operator-directed path selector and remains flexible.
- MCP is a machine-facing control surface and does not treat `--config` as permission to read arbitrary files on disk.
- For MCP, the trusted config root is the process working directory at server startup.
- Relative config paths are resolved inside that root.
- Paths that escape that root are rejected before tool handling begins.
- Existing config targets are also checked after symlink resolution, so an in-root symlink cannot point the MCP server at a config file outside the trusted root.

This distinction is deliberate. The CLI optimizes for human operator flexibility, while the MCP surface optimizes for bounded, predictable filesystem access.

## Frame, Message, And Session Model

Switchmaxxer MCP has three transport layers that are easy to mix up if they are not named clearly:

- **Frame**
  - one stdio transport unit
  - a frame is one JSON-RPC body terminated by a single newline (`\n`)
  - frames exist so the server can tell where one JSON payload ends and the next begins on a byte stream
- **Message**
  - one JSON-RPC request, response, or notification inside a frame
  - in this implementation, one frame carries one JSON-RPC message
  - examples:
    - an `initialize` request
    - a `tools/list` response
    - a notification with no reply
- **Session**
  - the whole lifetime of one `switchmaxxer mcp serve` stdio process
  - a session can contain many frames and many JSON-RPC messages over time
  - session state is what lets the server reuse one observability handle and keep the connection alive across multiple tool calls

In simple terms:

- the **frame** is the transport wrapper
- the **message** is the JSON-RPC content inside that wrapper
- the **session** is the long-lived conversation carried by many frames/messages over one stdio connection

The relationship is:

1. stdin/stdout provides one long byte stream
2. newline-delimited JSON framing cuts that stream into discrete frames (one JSON-RPC message per `\n`-terminated line)
3. each frame contains one JSON-RPC message
4. many framed messages together make up one MCP session

This matters operationally because Switchmaxxer treats framing failures, message failures, and session failures as different kinds of problems:

- a **framing** problem means the byte stream is malformed
- a **message** problem means the JSON-RPC payload was understood structurally but failed protocol or tool handling
- a **session** problem means the whole stdio lifecycle ends, usually because stdin closed or the process is shutting down

That separation is deliberate. A bad frame should not automatically mean the whole session is lost if the parser can resynchronize and continue reading later messages.

## Technical Debt

### Future Transport Scoping

The current MCP implementation is intentionally designed around one stdio
transport per process.

That means session-lifetime cached state such as:

- the observability handle cache
- remembered observability DB-path state

is safely process-local today because one `switchmaxxer mcp serve` process maps
to one long-lived stdio session.

This would not be a safe assumption for a future multiplexed MCP transport such
as HTTP or SSE where one process might serve multiple concurrent connections.

If Switchmaxxer ever adds such a transport, this session state must become:

- connection-scoped rather than process-scoped
- explicitly tied to one transport session instead of one server process
- explicitly granted a capability tier before any tool call is dispatched
- backed by an eviction policy for session state maps, such as TTL or LRU,
  because the current `Map` in `src/subsystems/mcp/session.ts` is only safe
  today because stdio uses one fixed `DEFAULT_MCP_SESSION_ID = "stdio"` entry
- reviewed at transport-introduction time rather than deferred, so dynamic
  session growth is designed intentionally instead of discovered under
  production load

This is future-work technical debt, not a current stdio correctness bug.

### Future Built-In Tool Exposure

The built-in CLI `tool` family currently remains intentionally CLI-only.

Current state:

- CLI exposes:
  - `switchmaxxer tool date`
  - `switchmaxxer tool uptime`
  - `switchmaxxer tool random`
- MCP does not currently expose:
  - `tool_date`
  - `tool_uptime`
  - `tool_random`
- the CLI/MCP parity matrix therefore treats `tool` as intentionally CLI-only
  rather than as an uncovered shared surface

This is the correct current contract. It should not be described as a parity
gap unless MCP support is actually added.

Future decision rule:

- if Switchmaxxer later decides these built-in tools should also be callable
  over MCP, that change should happen as one explicit contract expansion
- the implementation should add:
  - MCP tool definitions
  - tool payload handlers
  - CLI/MCP parity-matrix updates
  - direct parity tests for `date`, `uptime`, and `random`
- the project should not add MCP support for these tools without also moving
  them out of the CLI-only parity bucket at the same time

This is future-work product-surface debt, not a current MCP correctness bug.

### Capability Grants

The MCP dispatcher now treats tool access as an explicit session capability
decision rather than an implicit transport trust assumption.

Tool capability tiers are:

- `read`
- `mutation`
- `privileged`

Current stdio behavior:

- `switchmaxxer mcp serve` requires an existing config file and fails closed
  when the resolved config path is missing
- `mcp.capabilities` in config decides which tool tiers the stdio session
  receives
- `switchmaxxer mcp serve` prints the effective capability tiers and enabled /
  disabled tool counts to stderr before reading protocol messages from stdin
- `switchmaxxer mcp capabilities --json` previews the same grant and the exact
  MCP tools an agent will or will not see
- MCP capability discovery uses static config validation and does not require
  provider runtime env vars merely to initialize the server or list tools
- configs that omit `mcp` or `mcp.capabilities` are treated as read-only in
  memory and emit a warning
- full local control requires an explicit config opt-in:
  `["read", "mutation", "privileged"]`

Future transport rule:

- stdio is the only supported MCP transport today
- any future HTTP, SSE, or multiplexed transport must add authentication and
  explicit capability-grant selection before exposing mutation or privileged
  tools
- a future transport must not treat “can reach the transport” as equivalent to
  full admin authority

## Supported MCP Methods

### `initialize`

Returns:

- `protocolVersion`
- `capabilities.tools.listChanged = false`
- `serverInfo`

### `ping`

Returns an empty result object.

### `tools/list`

Returns the tool list allowed by the current session grant.

Current stdio behavior:

- `tools/list` returns only the tools allowed by the effective
  `mcp.capabilities` grant for the stdio session
- omitted MCP capability policy defaults to read-only, so mutation and
  privileged tools are absent until explicitly configured

Future transport rule:

- networked or multiplexed sessions must continue to expose only the subset of
  tools allowed by their authenticated grant

### `tools/call`

Executes one of the supported tools and returns:

- `structuredContent`
- `content` with a JSON text rendering of that payload
- `isError: true` when the tool-level payload is an error envelope

Dispatcher rule:

- `tools/call` is denied centrally when the selected tool capability is not
  included in the current session grant
- this check is enforced in dispatch, not delegated to transport-specific
  callers

## Tool Contract

### Shared rule

Tool results reuse the CLI JSON envelope shape:

Successful tool result payload:

```json
{
  "ok": true,
  "command": "string",
  "schema_version": "1",
  "data": {}
}
```

Failed tool result payload:

```json
{
  "ok": false,
  "command": "string",
  "schema_version": "1",
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

Failed tool payloads may include a top-level `details` object. MCP sanitizes
that object before returning it to the client/model boundary: sensitive keys
such as tokens, API keys, authorization headers, passwords, and nested
secret-shaped fields are removed, while public metadata such as `api_key_env`
is preserved.

Entity show tools may also include:

```json
{
  "editability": {
    "writable": ["..."],
    "derived": ["..."],
    "effective": ["..."]
  }
}
```

Successful tool payloads may also include:

```json
{
  "count": 1,
  "warnings": ["..."],
  "details": {}
}
```

Counter contract:

- `count` is reserved for list cardinality only
- non-list tools use explicit named counters such as `observation_count`, `sample_count`, or `result_count`
- custom top-level fields must not override reserved envelope fields:
  `ok`, `command`, `schema_version`, `data`, `count`, `warnings`,
  `details`, `normalized_fields`, `editability`, or `error`

## Tool Catalog

This is the full MCP tool surface, grouped by responsibility.

### Config Discovery

#### `config_schema`

Input:

```json
{}
```

Returns the MCP-specific config discovery projection:

- shared entity/field semantics from `switchmaxxer config schema --json`
- without CLI-only affordances like command names, flag names, or structured-input hints

#### `config_show`

Input:

```json
{}
```

Returns the same payload shape as `switchmaxxer config show --json`, including:

- `source_path`
- `source_file`
- `document`

Security note:

- `config_show` returns the full config document projection, not a minimal summary.
- Inline provider `api_key` values are masked.
- Other operationally sensitive fields such as endpoints, provider identifiers, and env-var names remain visible.
- This is intentional for trusted operator tooling.
- The MCP server must not be exposed to untrusted AI agents or other untrusted clients.

#### `config_validate`

Input:

```json
{}
```

Returns the same payload family as `switchmaxxer config validate --json`, including:

- `data.valid`
- `source_file`
- `bind_host`
- `route_count`
- warning passthrough for inline `api_key` overrides

### Model Tools

#### `models_list`

Input:

```json
{}
```

Returns the same payload shape as `switchmaxxer models list --json`.

#### `models_show`

Input:

```json
{
  "model_id": "gpt-4o-mini"
}
```

Returns the same payload shape as `switchmaxxer models show <model-id> --json`.

Not-found behavior:

- tool result payload has `ok: false`
- `error.code = "model_not_found"`
- MCP result sets `isError: true`

#### `models_create`

Input keys:

- `model_id`
- `display_name`
- `model_creator`
- optional `cost`

Returns the same payload shape as `switchmaxxer models create <model-id> --json`.

#### `models_update`

Input keys:

- `model_id`
- optional `display_name`
- optional `model_creator`
- optional `cost`

Returns the same payload shape as `switchmaxxer models update <model-id> --json`.

#### `models_delete`

Input:

```json
{
  "model_id": "gpt-4o-mini"
}
```

Returns the same payload shape as `switchmaxxer models delete <model-id> --json`.

### Provider Tools

#### `providers_list`

Input:

```json
{}
```

Returns the same payload shape as `switchmaxxer providers list --json`, except that any inline `api_key` remains masked.

#### `providers_show`

Input:

```json
{
  "provider_id": "openai_direct"
}
```

Returns the same payload shape as `switchmaxxer providers show <provider-id> --json`.

Provider secret rule:

- `api_key` is masked when present
- `api_key` is never returned raw through MCP

#### `providers_create`

Capability: `mutation`.

Input keys:

- `provider_id`
- `endpoint`
- `api_mode`
- optional `allow_private_endpoints`
- optional `allow_insecure_http`
- optional `anthropic_version`
- optional `model_id_format`

Returns the same payload shape as `switchmaxxer providers create <provider-id> --json`.

Provider auth rule:

- `providers_create` creates provider metadata without inline auth material
- use `providers_set_key` for inline `api_key` material
- use `providers_set_key_env` to attach a provider auth environment variable
- auth-mutating provider tools require the `privileged` capability

Endpoint policy override rule:

- `allow_private_endpoints` is a boolean opt-out from the default private / loopback / link-local endpoint block and defaults to `false`
- `allow_insecure_http` is a boolean opt-out from the default `https`-only requirement and defaults to `false`

These flags intentionally relax `validateProviderEndpointPolicy` and should be used deliberately for localhost, internal-network, or other explicitly trusted setups.

#### `providers_update`

Capability: `mutation` for non-auth provider fields. Updating provider auth
fields such as `api_key_env` or `no_auth` additionally requires the `privileged`
capability.

Input keys:

- `provider_id`
- optional `endpoint`
- optional `api_mode`
- optional `allow_private_endpoints`
- optional `allow_insecure_http`
- optional `anthropic_version`
- optional `api_key_env`
- optional `no_auth`

Returns the same payload shape as `switchmaxxer providers update <provider-id> --json`.

Endpoint policy override rule:

- `allow_private_endpoints` is a boolean opt-out from the default private / loopback / link-local endpoint block and defaults to `false`
- `allow_insecure_http` is a boolean opt-out from the default `https`-only requirement and defaults to `false`

These flags intentionally relax `validateProviderEndpointPolicy` and should be used deliberately for localhost, internal-network, or other explicitly trusted setups.

Inline secret rule:

- `providers_update` does not accept `api_key`
- `providers_update` requires `privileged` when changing `api_key_env` or
  `no_auth`
- use `providers_set_key` or `providers_clear_key` for inline secret mutation

#### `providers_delete`

Input:

```json
{
  "provider_id": "openai_direct"
}
```

Returns the same payload shape as `switchmaxxer providers delete <provider-id> --json`.

#### `providers_set_key`

Input:

```json
{
  "provider_id": "openai_direct",
  "api_key": "sk-..."
}
```

Returns the same masked provider payload shape used by `providers show`.

#### `providers_clear_key`

Input:

```json
{
  "provider_id": "openai_direct"
}
```

Returns the same masked provider payload shape used by `providers show`.

#### `providers_set_key_env`

Input:

```json
{
  "provider_id": "openai_direct",
  "api_key_env": "SWITCHMAXXER_OPENAI_API_KEY"
}
```

Returns the same provider payload shape used by `providers show`.

### Route Tools

#### `routes_list`

Input:

```json
{}
```

Returns the same payload shape as `switchmaxxer routes list --json`.

#### `routes_show`

Input:

```json
{
  "route_id": "gpt-4o-mini"
}
```

Returns the same payload shape as `switchmaxxer routes show <route-id> --json`.

#### `routes_explain`

Input:

```json
{
  "route_id": "gpt-4o-mini"
}
```

Returns the same payload family as `switchmaxxer routes explain <route-id> --json`, including:

- route identity fields
- resolved provider/model/api metadata
- `timeout_ms`
- `effective_timeout_ms`
- `explanation_lines`

#### `routes_create`

Input keys:

- `route_id`
- `model`
- `service_provider`
- `provider_model_id`
- `display_name`
- optional `timeout_ms`
- optional `cost`

Returns the same payload shape as `switchmaxxer routes create <route-id> --json`.

#### `routes_update`

Input keys:

- `route_id`
- optional `model`
- optional `service_provider`
- optional `provider_model_id`
- optional `display_name`
- optional `timeout_ms`
- optional `cost`

Returns the same payload shape as `switchmaxxer routes update <route-id> --json`.

#### `routes_delete`

Input:

```json
{
  "route_id": "gpt-4o-mini"
}
```

Returns the same payload shape as `switchmaxxer routes delete <route-id> --json`.

### Gateway Tools

#### `gateway_health`

Input keys:

- optional `check`
- optional `timeout_ms`

Returns a successful health snapshot payload even when one or more checks fail. `data.overall_status` is the contract-bearing health signal.

#### `gateway_status`

Input:

```json
{}
```

Returns a successful status snapshot payload even when the gateway is stopped. `data.gateway_status` is the contract-bearing runtime signal.
`data.inbound_auth_state` reports whether inbound gateway auth is `enabled`,
`disabled_explicit`, or `misconfigured`; the token is never exposed, and the
env-var name is redacted as `(configured)` when present.

#### `gateway_runtime_config`

Input:

```json
{}
```

Fetches the live runtime-config endpoint for the selected config and returns that payload directly. Unlike `gateway_health` and `gateway_status`, this tool returns an error envelope when the live runtime-config endpoint is unreachable or unauthorized.

### Trace Tools

#### `trace_list`

Input keys:

- optional `route_id`
- optional `provider_id`
- optional `outcome`
- optional `limit`

Example:

```json
{
  "route_id": "route-alpha",
  "provider_id": "provider-main",
  "outcome": "succeeded",
  "limit": 10
}
```

Returns the same payload shape as `switchmaxxer trace list --json`.

#### `trace_show`

Input:

```json
{
  "trace_id": "req-123"
}
```

Returns the same payload shape as `switchmaxxer trace show <trace-id> --json`.

Response includes top-level `observation_count`.

Not-found behavior:

- tool result payload has `ok: false`
- `error.code = "trace_not_found"`
- MCP result sets `isError: true`

#### `trace_stats`

Input keys:

- optional `route_id`
- optional `provider_id`
- optional `outcome`

Returns the same payload shape as `switchmaxxer trace stats --json`.

#### `trace_observations`

Input keys:

- optional `route_id`
- optional `provider_id`
- optional `kind`
- optional `event`
- optional `limit`

Returns the same payload shape as `switchmaxxer trace observations --json`.

#### `trace_verify`

Input:

```json
{
  "trace_id": "req-123"
}
```

Or:

```json
{
  "all": true,
  "batch_size": 250
}
```

Returns the same payload shape as `switchmaxxer trace verify --json`.

`batch_size` is optional and only applies with `all: true`.

Response includes top-level `result_count`.

#### `trace_repair`

Input:

```json
{
  "trace_id": "req-123"
}
```

Or:

```json
{
  "all": true,
  "batch_size": 250
}
```

Returns the same payload shape as `switchmaxxer trace repair --json`.

`batch_size` is optional and only applies with `all: true`.

Response includes top-level `result_count`.

#### `prune`

`prune` applies whole-store observability retention. It is not trace-only: it
can remove old request traces, benchmark rows, cost facts, optimization facts,
config mutation events, and managed config snapshots.

Input keys:

- optional `older_than`

Behavior:

- uses the same retention duration grammar as the whole-store observability
  retention prune command
- if `older_than` is omitted, MCP falls back to `observability.retention.older_than` from config
- returns `deleted_count` at the top level and the full prune result in `data.result`

#### `ledger_list`

`ledger_list` lists Control Plane Audit Ledger events. It is a privileged
observability read because audit history exposes operational control-plane
details.

Input keys:

- optional `route_id`
- optional `target_id`
- optional `target_kind`: `model`, `provider`, or `route`
- optional `operation`: `models_create`, `models_update`, `models_delete`,
  `providers_create`, `providers_update`, `providers_delete`,
  `providers_set_key`, `providers_clear_key`, `providers_set_key_env`,
  `routes_create`, `routes_update`, `routes_delete`, `optimize_apply`, or
  `optimize_restore`
- optional `status`: `started`, `succeeded`, `failed`, `noop`,
  `dry_run_succeeded`, or `dry_run_failed`
- optional `source_surface`: `cli` or `mcp`
- optional `session_id`
- optional `own_session`
- optional `run_id`
- optional `mutation_event_id`
- optional `since`
- optional `limit`

Behavior:

- returns summary rows only
- `own_session: true` filters to the current MCP session id
- `since` uses the same duration grammar as retention filters

#### `ledger_show`

`ledger_show` returns one full Control Plane Audit Ledger event by
`ledger_event_id`, including parsed correlation, result, error, and metadata
objects.

### Benchmark Tools

#### `bench_list`

Input:

```json
{
  "limit": 10
}
```

Returns the same payload shape as `switchmaxxer bench list --json`.

#### `bench_show`

Input:

```json
{
  "run_id": "bench-123"
}
```

Returns the same payload shape as `switchmaxxer bench show <run-id> --json`.

Response includes top-level `sample_count`.

Not-found behavior:

- tool result payload has `ok: false`
- `error.code = "bench_not_found"`
- MCP result sets `isError: true`

#### `bench_run`

Input keys:

- `prompt`
- one of:
  - `route_id`
  - `routes`
- optional `iterations`
- optional `warmup`
- optional `concurrency`
- optional `path_mode`
- optional `timeout_ms`

Example:

```json
{
  "route_id": "gpt-4o-mini",
  "prompt": "ping",
  "iterations": 1,
  "warmup": 0,
  "concurrency": 1,
  "path_mode": "direct"
}
```

MCP input is object-shaped tool input, not CLI syntax:

- use `route_id` for one route or `routes` for multiple routes
- do not send `route`, `model`, `--route`, or `--path`
- the schema does not default to a particular route; it requires exactly one
  of `route_id` or `routes`
- `path_mode` accepts `gateway`, `direct`, or `both` and defaults to `both`

Provider-key resolution follows the process that executes the HTTP request:

- `path_mode: "gateway"` uses the running gateway process and its env/secrets
- `path_mode: "direct"` uses the MCP server process and its env/secrets
- `path_mode: "both"` uses both processes, so both need the relevant provider
  key material

Returns the same payload family as `switchmaxxer bench --json`, including:

- `run`
- `execution`
- `summary`
- `analysis`
- `samples`

Response includes top-level `sample_count`.

#### `optimize_list`

Capability: `read`.

Input:

```json
{
  "limit": 10
}
```

Returns the same payload shape as `switchmaxxer optimize list --json`.

#### `optimize_show`

Capability: `read`.

Input:

```json
{
  "run_id": "optimize-123"
}
```

Returns the same payload shape as `switchmaxxer optimize show <run-id> --json`.

Not-found behavior:

- tool result payload has `ok: false`
- `error.code = "optimize_not_found"`
- MCP result sets `isError: true`

#### `optimize_run`

Capability: `privileged`.

Input keys:

- `model`
- `objective` (`"cost"` or `"latency"`)
- optional `routes`
- optional `input_tokens`
- optional `output_tokens`
- optional `cache_read_tokens`
- optional `cache_write_tokens`
- optional `prompt` for latency optimization
- optional `iterations`
- optional `warmup`
- optional `concurrency`
- optional `path_mode`
- optional `timeout_ms`

Example:

```json
{
  "model": "gpt-4o-mini",
  "objective": "cost",
  "input_tokens": 1000,
  "output_tokens": 1000
}
```

Latency example:

```json
{
  "model": "gpt-4o-mini",
  "objective": "latency",
  "routes": ["gpt-4o-mini", "openrouter-gpt-4o-mini"],
  "prompt": "ping",
  "iterations": 5,
  "warmup": 1,
  "path_mode": "both"
}
```

Returns the same payload family as `switchmaxxer optimize --json`, including
the persisted run id, ranked routes, winner, reference-token settings for cost,
and owned benchmark run details for latency.

#### `optimize_apply`

Capability: `mutation`.

Input keys:

- `run_id`
- `route_id`
- optional `dry_run`
- optional `reload`
- optional `verify`

Example:

```json
{
  "run_id": "optimize-123",
  "route_id": "gpt-4o-mini",
  "reload": true,
  "verify": true
}
```

Applies the persisted winner provider from a completed optimize run to one
existing route by atomically rewriting `routes.<route-id>.service_provider`,
`routes.<route-id>.provider_model_id`, and `routes.<route-id>.cost` to match the
winner. The tool uses the same stale-run checks, detectable auth checks, catalog
validation, and managed observability snapshot/event recording as
`switchmaxxer optimize apply --json`. The returned `mutation` envelope includes
per-field `service_provider`, `provider_model_id`, and `cost` diffs in addition
to the legacy `field`/`from`/`to` keys describing the primary
`service_provider` flip.

When `reload` or `verify` is true on a non-dry-run apply, MCP defers Ledger
completion like the CLI, runs the same gateway reload and route verification
post-actions, and records `reload`, `verification`, and `warnings` in the
tool payload and Ledger result.

#### `optimize_restore`

Capability: `mutation`.

Input keys:

- either `action_id`
- or both `run_id` and `route_id`
- optional `dry_run`
- optional `reload`
- optional `verify`

Example:

```json
{
  "action_id": "4fd6f7aa-0f55-4ccb-b2e5-6d17fd8ce9bb"
}
```

Restores the route changed by a previous `optimize_apply` or CLI
`optimize apply` operation. The restore point comes from the apply action event
in `config_mutation_events`; restore atomically rewrites
`routes.<route-id>.service_provider`, `routes.<route-id>.provider_model_id`, and
`routes.<route-id>.cost` from the apply-time values back to the pre-apply
values captured in the apply event's `before_json`. `run_id` plus `route_id` is
supported as a convenience lookup when the caller does not already have the
apply action id. When requested on a non-dry-run restore, `reload` and `verify`
use the same post-action contract as `optimize_apply`.

## Error Posture

### Protocol errors

These use JSON-RPC errors:

- invalid request
- missing method
- method not found
- malformed framing
- missing required tool name

### Tool/domain errors

These are returned as MCP tool results with:

- `structuredContent` containing the CLI-style error envelope
- `isError: true`

Examples:

- `model_not_found`
- `provider_not_found`
- `route_not_found`
- `trace_not_found`
- `bench_not_found`
- `invalid_tool_input`
- `missing_required_field`
- `invalid_input_field`
- `tool_execution_error`

Operational note:

- generic unexpected handler failures may return `tool_execution_error`
- command-scoped failures may also return tool-specific fallback codes such as `trace_list_error`, `trace_show_error`, `prune_error`, `bench_show_error`, `trace_repair_error`, or `bench_error`

### Runtime warning posture

- the observability store uses Node's experimental `node:sqlite` backend
- Node 22+ is required for observability-backed MCP tools because they rely on built-in `node:sqlite`
- MCP startup no longer loads that backend eagerly for non-observability flows
- MCP suppresses Node's experimental SQLite warning for observability-backed tool calls so JSON-RPC stdio stays clean
- the gateway server may still show that warning during process startup or restart

## Compatibility Posture

Current compatibility expectations:

- additive tools are allowed
- additive fields in tool payloads are allowed
- existing tool names should not be renamed silently
- existing documented input keys should not be renamed silently
- existing documented envelope fields should not be removed silently

## Definition Of Done

- `switchmaxxer mcp serve` exists
- it speaks stdio MCP framing correctly
- `initialize`, `ping`, `tools/list`, and `tools/call` work
- the config CRUD tool set above is implemented
- the observability tool set above is implemented
- tool results reuse the hardened CLI config and observability contracts
- end-to-end shell contract tests exercise both the config and observability MCP surfaces

## Ongoing Maintenance

Keep these things aligned as the MCP surface changes:

1. shell contracts
2. tool catalog and input schemas
3. error-code documentation
4. client-launch notes
