# How To Launch Switchmaxxer MCP

## Purpose

This document shows the practical launch patterns for the
`switchmaxxer mcp serve` surface.

The goal is not to document every third-party client UI.
It is to give operators and agent builders a stable, copyable way to launch the Switchmaxxer MCP server over stdio.

## Prerequisites

- the repo is built with `npm run build`
- a working `config.json` exists
- any needed provider env vars are already exported if your MCP workflow will run benchmarks or latency optimizations against real upstreams

Read-only MCP startup, `initialize`, `tools/list`, and `config_show` do not
require provider runtime env vars.

## Canonical Launch Command

Use the built launcher:

```bash
./switchmaxxer mcp serve --config /absolute/path/to/config.json
```

From inside the Switchmaxxer repo, the official shorthand is:

```bash
./smx mcp serve --config /absolute/path/to/config.json
```

If you want a specific observability store path for MCP-driven trace,
benchmark, optimize, ledger, or config mutation audit work:

```bash
SWITCHMAXXER_OBSERVABILITY_DB=/absolute/path/to/observability.sqlite \
  ./switchmaxxer mcp serve --config /absolute/path/to/config.json
```

## Generic Stdio MCP Server Entry

Many MCP clients use a stdio server entry with:

- a command
- an argument list
- optional environment variables

The generic shape looks like:

```json
{
  "command": "/absolute/path/to/switchmaxxer/switchmaxxer",
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
```

If you only need the default observability path, you can omit `SWITCHMAXXER_OBSERVABILITY_DB`.

The `--config` target must already exist. MCP startup fails closed when the
resolved config file is missing.

Provider API keys are only needed for tool calls that execute upstream
requests, such as `bench_run` or latency `optimize_run`. When an MCP client
launches `switchmaxxer mcp serve`, those direct-path calls resolve provider
keys in the MCP server process environment, not in the long-running gateway
process. Pass the relevant `SWITCHMAXXER_*_API_KEY` variables or
`SWITCHMAXXER_SECRETS_PATH` in the client server entry when direct or `both`
path benchmarking should work.

MCP tool access is controlled by the config file:

```json
{
  "mcp": {
    "capabilities": ["read"]
  }
}
```

Omitting `mcp` or `mcp.capabilities` keeps older configs usable but logs a
migration warning and grants read-only access. Use full access only as an
intentional local-control opt-in:

```json
{
  "mcp": {
    "capabilities": ["read", "mutation", "privileged"]
  }
}
```

Preview the effective grant before launching a client:

```bash
./smx mcp capabilities --config /absolute/path/to/config.json --json
```

`mcp serve` also prints the granted capability tiers plus enabled/disabled tool
counts to stderr at startup. MCP protocol responses still go to stdout.

Observability DB path notes:

- the default path is `.switchmaxxer/observability.sqlite` under the current
  working directory
- prefer an absolute path when a long-lived MCP client launches Switchmaxxer
  from a variable working directory
- runtime overrides must use a normal SQLite filename suffix such as `.sqlite`,
  `.sqlite3`, or `.db`
- the SQLite file is tightened to owner-only mode, and the resolved path is
  rejected if the nearest existing parent is a symlink, not owned by the current
  user, or group-/world-writable
- existing DB files are rejected if they are symlinks, non-regular files, not
  owned by the current user, or readable/writable by group/other users
- this is a trusted local operator override; it is hardened for local placement
  mistakes, but it is not yet constrained to a fixed data-root allowlist
- if you do want a temp-backed path for local experiments, create a private
  `0700` subdirectory first and point `SWITCHMAXXER_OBSERVABILITY_DB` there

## In-Repo Example

If the client runs from the Switchmaxxer repo directory and you want to use the in-repo shorthand:

```json
{
  "command": "/absolute/path/to/switchmaxxer/smx",
  "args": [
    "mcp",
    "serve",
    "--config",
    "/absolute/path/to/switchmaxxer/config.json"
  ]
}
```

## Recommended Pathing

Prefer absolute paths for:

- the launcher
- the config file
- the observability DB

That keeps MCP startup predictable when clients launch from arbitrary working directories.

## What The Client Should Expect

The server speaks stdio MCP with:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

Depending on the configured `mcp.capabilities` grant, the tool surface can
include:

- config discovery and CRUD
- config validation
- route explanation
- gateway inspection
- trace read tools
- `trace_repair`
- `prune`
- privileged Ledger read tools
- benchmark read tools
- `bench_run`
- optimize read tools
- `optimize_run`
- config mutation audit rows for model/provider/route changes

For the exact tool catalog, see [tech-spec-for-mcp.md](tech-spec-for-mcp.md).

## Local Smoke Test

If you want to verify the MCP server before wiring it into a client, use the existing shell contracts:

```bash
bash tests/test-015-mcp-serve-contract.sh
bash tests/test-016-mcp-observability-contract.sh
bash tests/test-017-mcp-observability-negative-contract.sh
bash tests/test-018-mcp-observability-ops-contract.sh
bash tests/test-019-mcp-serve-long-lived-session.sh
```

Those cover:

- one-shot config/control-plane behavior
- gateway inspection
- observability reads
- negative/error behavior
- `trace_repair`
- `prune`
- `ledger_list`
- `ledger_show`
- `bench_run`
- long-lived multi-call stdio sessions

`optimize_run`, `optimize_list`, `optimize_show`, `ledger_list`, and
`ledger_show` are covered by the MCP unit test suite.

## Operational Notes

- `config_show` exposes the full config document projection to MCP clients, with inline `api_key` values masked but other operational fields like endpoints, env-var names, and provider IDs still visible
- treat `switchmaxxer mcp serve` as a trusted operator/control-plane surface, not as something to expose to untrusted AI agents
- `providers_show` masks inline `api_key` values; MCP is not a secret-retrieval surface
- `ledger_list` and `ledger_show` are privileged reads because audit history
  exposes operational control-plane details
- `bench_run` may degrade from `both` to `direct` when the gateway path is unavailable, and that warning is returned in the report contract
- `bench_run` input uses MCP field names, not CLI flags: use `route_id` or
  `routes`, and `path_mode`, not `route`, `model`, `--route`, or `--path`
- `bench_run` does not default to `gpt-4o-mini`; it requires exactly one of
  `route_id` or `routes`
- `path_mode: "gateway"` uses the running gateway process and its provider
  key environment; `path_mode: "direct"` uses the MCP server process and its
  provider key environment; `path_mode: "both"` uses both
- `trace_repair`, `prune`, `bench_run`, `optimize_run`, `optimize_apply`,
  `optimize_restore`, and model/provider/route mutation tools may write to the
  observability store, so point `SWITCHMAXXER_OBSERVABILITY_DB` deliberately if
  you do not want the default store
- MCP suppresses Node's experimental SQLite warning for observability-backed tool calls so JSON-RPC stdio stays clean; the gateway server may still show that warning during process startup or restart
- read-only, non-observability startup paths do not load the SQLite backend
  eagerly, so config inspection and help flows stay clean

For an OpenClaw-specific gateway and MCP setup, see
[../../how-to/how-to-connect-openclaw-to-switchmaxxer.md](../../how-to/how-to-connect-openclaw-to-switchmaxxer.md).
