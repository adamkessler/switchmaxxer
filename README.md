# Switchmaxxer

Switchmaxxer is for AI ecosystem integrators who need one secure, local, observable control point from which to manage their complex multi-provider LLM environments.

Switchmaxxer is a local-first LLM gateway: an API-compatible reverse proxy that sits between applications and one or more upstream LLM providers, translating between provider dialects and applying per-route policy from local JSON config/catalog files. It is not a general forward proxy; clients point at Switchmaxxer as the API origin and Switchmaxxer chooses the upstream route. Operators drive it from a CLI; AI agents drive it from a matching MCP surface.

Switchmaxxer is AI-native infrastructure for the ecosystem layer. Models,
providers, routes, provider dialects, observability, benchmarking, and
optimization are first-class control-plane concerns. The CLI is the operator's
hand, MCP is the agent's glove, and observability is the gateway's eyes. Human
operators and AI agents can inspect the same runtime state, manage the same
route catalog, run the same benchmarks, and apply the same cost or speed
optimizations through tightly aligned contracts.

It exposes two inbound API shapes on one port:

- OpenAI-compatible chat completions at `/v1/chat/completions`
- Anthropic-compatible messages at `/anthropic/v1/messages`

The gateway is the long-running runtime/server. It resolves route names from the required sibling `catalog.json`, reads runtime policy from `config.json`, forwards requests to the correct upstream provider, injects auth, and keeps the outbound provider dialect explicit with `api_mode`. Clients point their SDK at Switchmaxxer as if it were the origin; Switchmaxxer decides which upstream actually serves the request.

If you want one local control point for models, providers, routes, and runtime behavior instead of hard-coding provider logic into every client, this is what Switchmaxxer is for.

[Quick Start](#quick-start) · [Golden Path](#golden-path) · [Why Switchmaxxer](#why-switchmaxxer) · [Common Commands](#common-commands) · [Run As A systemd User Service](#run-as-a-systemd-user-service) · [Configuration](#configuration) · [Tests](#tests) · [Disclaimers](#disclaimers)

## Disclaimers

Switchmaxxer is a hobby project in **public pre-release beta**. Expect rough edges. By default it runs as a **single-operator system** with one trusted user — it is not designed to enforce isolation between multiple users sharing the same machine, and it is not a hostile multi-tenant boundary out of the box. If you are not comfortable with security hardening and access control, do not run it. If your deployment involves multiple users or any internet-reachable surface, review the hardened configuration options before rolling it out.

Full text: [DISCLAIMER.md](DISCLAIMER.md).

## Why Switchmaxxer

- one local endpoint for many upstream providers
- provider-agnostic API translation between OpenAI and Anthropic dialects, controlled per route via `api_mode`
- explicit route names so clients do not need provider-specific model wiring
- per-route policy (timeouts, streaming limits, upstream model ID, display name) without client-side code changes
- operator-friendly config and CLI for models, providers, and routes
- a matching MCP surface so AI agents can read, mutate, benchmark, optimize, apply, and restore the same surfaces as human operators
- tight CLI/MCP/observability contracts that keep human workflows and agent workflows aligned
- local-first SQLite-backed observability, tracing, benchmarking, optimization history, config mutation history, snapshots, and retention, all running in-process
- an integrated capability stream from observations to traces to benchmark runs to optimize runs
- safer local defaults like loopback binding and config validation
- direct testing, invocation, health, reload, and log inspection from the same tool

Who it is for:

- AI ecosystem integrators who want one stable local LLM endpoint
- app developers who have unlimited needs for flexibility
- agent builders who want agents to manage LLM gateway routes, run benchmarks,
  and apply cost or speed optimizations without rewriting every client
- operators who want runtime visibility and config-driven routing
- local AI workflows that need one trusted gateway between applications and providers

## Vocabulary

Switchmaxxer uses this runtime vocabulary:

- `gateway`: the live long-running Switchmaxxer runtime/server
- `service`: the OS-managed background form of that gateway, typically via `systemd --user`
- `control plane`: the operator and automation surfaces that inspect or manage the gateway, including the CLI and MCP surfaces

Architecturally, the gateway is a reverse proxy for LLM API traffic. The client
does not ask Switchmaxxer to tunnel to an arbitrary destination; it calls a
stable local API surface, and Switchmaxxer resolves the configured route to an
upstream provider.

The short mental model is:

- `switchmaxxer gateway ...` operates the runtime
- the configured `systemd_unit` user service manages the background packaging of that runtime
- the CLI is a control-plane client talking to or operating the gateway
- the MCP server is the agent-facing control-plane surface
- the observability store is the durable local memory for observations, traces, benchmark runs, optimize runs, mutation events, and snapshots

## Current Capabilities

Switchmaxxer exposes these capabilities:

- local gateway runtime with OpenAI and Anthropic listeners
- config validation and inspection
- CRUD for `models`, `providers`, and `routes`
- route testing and direct gateway invocation
- gateway status, health, reload, runtime inspection, and journald-backed logs
- persisted observability through a local SQLite store plus `switchmaxxer trace` inspection, verification, and repair commands
- whole-store observability retention through `switchmaxxer prune`
- Control Plane Audit Ledger inspection through `switchmaxxer ledger list` and
  `switchmaxxer ledger show`
- persisted benchmarking through `switchmaxxer bench`, `bench list`, `bench show`, `bench prune`, `bench delete`, and `bench clear`
- persisted route optimization recommendations through `switchmaxxer optimize`, `optimize list`, `optimize show`, `optimize apply`, `optimize restore`, `optimize prune`, `optimize delete`, and `optimize clear`
- cost optimization from catalog rate cards and reference token workloads
- latency optimization through the benchmark runtime
- Control Plane Audit Ledger rows for CLI/MCP model, provider, route, and
  optimize apply/restore attempts, including failed attempts
- managed config mutation events and SQLite-backed snapshots for optimize
  apply/restore auditability
- MCP tools for trace inspection/repair, whole-store prune, privileged Ledger
  list/show, benchmark run/list/show, optimize run/list/show, and optimize
  apply/restore

Observability runtime note:

- Switchmaxxer currently uses Node's experimental `node:sqlite` backend for the local observability store
- the experimental SQLite warning is contained to observability-backed CLI entrypoint commands such as `trace`, `bench`, `optimize`, `ledger`, and config mutation commands that write audit rows
- non-observability CLI entrypoint startup paths like `help`, `version`, and read-only config inspection do not load the SQLite runtime
- operator-managed whole-store retention is available through `switchmaxxer prune --older-than <duration>`
- `switchmaxxer prune --config <path>` can read an optional nested config default from `observability.retention.older_than`
- when `observability.retention.older_than` is configured, the gateway applies a retention prune pass at startup and then continues pruning periodically while the long-lived runtime stays up
- the repository expects Node 22+ because observability-backed surfaces depend on built-in `node:sqlite`

Reserved surfaces:

- `switchmaxxer config migrate`

## Requirements

- Node.js 22+ (a `.nvmrc` is provided at the repo root; run `nvm use` in the
  project directory to auto-switch if you use nvm, fnm, or another
  `.nvmrc`-aware version manager)

Runtime note:

- Switchmaxxer currently requires Node 22+ because observability-backed surfaces depend on built-in `node:sqlite`
- CLI entrypoint commands such as `trace`, `bench`, `ledger`, config mutations, and observability-backed MCP operations may still emit Node's experimental SQLite warning on stderr
- core non-observability CLI entrypoint flows like `help`, `version`, and read-only config inspection do not require the SQLite runtime at startup

## Install

This public beta is intentionally distributed from source rather than the npm
registry. `package.json` has `"private": true` set deliberately and
`npm install -g switchmaxxer` will not work. Install from the Git repository.

```bash
git clone https://github.com/adamkessler/switchmaxxer.git
cd switchmaxxer
npm install
npm run build
```

The repo ships two equivalent launchers at the project root: `./switchmaxxer`
(canonical) and `./smx` (shorthand). Use whichever you prefer when working from
the checkout.

If you want a fresh-machine operator walkthrough for Ubuntu, use
[docs/how-to/how-to-install-switchmaxxer-on-ubuntu.md](docs/how-to/how-to-install-switchmaxxer-on-ubuntu.md).

The `./switchmaxxer` and `./smx` launchers check for missing or stale `dist/`
output before they start. If you pull source changes or edit `src/` locally,
rerun `npm run build` when the launcher tells you the compiled output is out of
date.

## Quick Start

1. Create local config and catalog files from the examples:

```bash
cp config-examples/config.example.json config.json
cp config-examples/catalog.example.json catalog.json
chmod 0600 config.json catalog.json
```

`config.json` holds runtime, security, MCP, observability, and gateway settings.
`catalog.json` holds `service_providers`, `routes`, and `models`. Those catalog
sections must never be present in `config.json`, even when they are empty.

The example config grants MCP clients read-only access by default:

- `read`: inspection only
- `mutation`: can edit ordinary config such as models, routes, and non-secret provider fields
- `privileged`: can touch secrets, pruning, benchmark execution, and other high-trust operations

Only add `mutation` or `privileged` to `mcp.capabilities` for trusted local automation that intentionally needs that level of control.

2. Export the provider keys you actually plan to use:

```bash
export SWITCHMAXXER_OPENAI_API_KEY=...
export SWITCHMAXXER_ANTHROPIC_API_KEY=...
export SWITCHMAXXER_MINIMAX_API_KEY=...
export SWITCHMAXXER_INBOUND_API_KEY=...
```

Or keep provider keys in a local owner-only secrets file while leaving
`config.json` portable:

```bash
mkdir -p ~/.config/switchmaxxer
cp config-examples/secrets.example.json ~/.config/switchmaxxer/secrets.json
chmod 0600 ~/.config/switchmaxxer/secrets.json
$EDITOR ~/.config/switchmaxxer/secrets.json
```

`secrets.json` is sparse: keep only the `api_key_overrides` entries you need,
replace placeholder values before running the gateway, and continue to reference
the same `SWITCHMAXXER_*` names from provider `api_key_env` fields in
`catalog.json`.

For shell-driven installs, another convenient pattern is to keep simple
`SWITCHMAXXER_*=...` assignments in an owner-only file such as
`~/.config/switchmaxxer/shell.env`, then source it from `~/.bashrc` with
`set -a` so new interactive shells export those variables automatically. Keep
that file to plain assignments only, because sourcing it executes shell code.
Services launched by `systemd` do not read `~/.bashrc`; use the service
`EnvironmentFile=` instead.

3. Validate the config:

```bash
./switchmaxxer config validate
```

4. Start the Switchmaxxer Gateway:

```bash
./switchmaxxer gateway run
```

By default it binds to:

```text
127.0.0.1:4080
```

5. In another terminal, send a request:

```bash
curl http://127.0.0.1:4080/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $SWITCHMAXXER_INBOUND_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "Reply with exactly: switchmaxxer-ok" }
    ]
  }'
```

At that point, you have a working local gateway:

- clients can call `http://127.0.0.1:4080/v1/chat/completions`
- route names in `catalog.json` become the `model` values clients send
- Switchmaxxer decides which provider and provider model ID to use behind that route

Keep inbound gateway auth enabled for normal use, including loopback use. If you
are doing local development and intentionally need the no-auth escape hatch, you
can switch `config.json` to `"allow_unauthenticated_gateway": true` and remove
`inbound_api_key_env`.

That mode is not a browser-safety boundary: malicious webpages can try to send
requests to loopback services. Switchmaxxer therefore requires unauthenticated
gateway POSTs to include `Content-Type: application/json` and
`X-Switchmaxxer-Local-Client: 1`, and rejects cross-site browser request
signals such as hostile `Origin` or Fetch Metadata headers.

If `one_trusted_operator_boundary: true` is set alongside
`allow_unauthenticated_gateway: true`, trusted local apps do not need to send
`X-Switchmaxxer-Local-Client: 1`; the loopback Host and browser-origin checks
still apply.

## Golden Path

If you want the shortest useful operator flow, this is it:

```bash
cp config-examples/config.example.json config.json
cp config-examples/catalog.example.json catalog.json
chmod 0600 config.json catalog.json
export SWITCHMAXXER_OPENAI_API_KEY=...
export SWITCHMAXXER_INBOUND_API_KEY=...
./switchmaxxer config validate
./switchmaxxer gateway run
./switchmaxxer test --route gpt-4o-mini
./switchmaxxer invoke --route gpt-4o-mini --prompt "hello"
```

That path validates config, starts the gateway, proves one route through the real runtime path, and then sends a one-off request through the same route.

Short terminal transcript:

```text
$ ./switchmaxxer gateway run
Gateway listening on 127.0.0.1:4080

$ ./switchmaxxer test --route gpt-4o-mini
Starting route tests
Path: gateway
Config: /absolute/path/to/config.json
Route: gpt-4o-mini
Routes Planned: 1

PASS  [1/1] gpt-4o-mini  path=gateway  provider=openai_direct  api=openai-completions  status=200  latency=214ms

Route Test Summary: 1 passed, 0 failed
Path: gateway
Config: /absolute/path/to/config.json
Routes Tested: 1

$ ./switchmaxxer invoke --route gpt-4o-mini --prompt "hello"
Hello! How can I help?
```

`invoke` and `bench` both apply a 60-second client-side timeout by default. Override that per call with `--timeout-ms <number>` when you need a tighter or longer bound.

For one-off protocol debugging, `invoke` also supports an ephemeral inspection
view:

```bash
./switchmaxxer invoke --route gpt-4o-mini --prompt "hello" --inspect
```

`--inspect` renders a four-panel ASCII view of the non-streaming request and
response bodies and headers across `Client -> SMX`, `SMX -> Provider`,
`Provider -> SMX`, and `SMX -> Client`. Secret-bearing headers are masked by
default; add `--include-secrets` only when you intentionally need raw auth-like
headers in the terminal. Inspection captures are local, in-memory, protected by
a one-time read token, and are not written to logs or the observability store.

Benchmark path-selection alignment:

- CLI uses `switchmaxxer bench --path <gateway|direct|both>`
- MCP `bench_run` uses `path_mode` with the same `gateway|direct|both` values

## Exit Codes

Switchmaxxer CLI commands use a small stable exit-code contract:

- `0`: success
- `1`: runtime or operational failure
- `2`: usage error, invalid flags, or missing required arguments

If you need machine-readable failure detail, prefer `--json` and inspect `error.code` instead of branching on shell exit codes beyond `0/1/2`.

## Run As A systemd User Service

If you want Switchmaxxer to keep running in the background for your user account, a `systemd --user` service is the simplest path.

1. Build Switchmaxxer:

```bash
npm install
npm run build
```

2. Create the user-service directory:

```bash
mkdir -p ~/.config/systemd/user
```

3. Create `~/.config/systemd/user/switchmaxxer.service`:

```ini
[Unit]
Description=Switchmaxxer LLM Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/switchmaxxer
ExecStart=/absolute/path/to/switchmaxxer/switchmaxxer gateway run --config /absolute/path/to/switchmaxxer/config.json
Restart=on-failure
RestartSec=2
EnvironmentFile=%h/.config/switchmaxxer/switchmaxxer.env

[Install]
WantedBy=default.target
```

Replace `/absolute/path/to/switchmaxxer` with your real repo path.

Create `~/.config/switchmaxxer/switchmaxxer.env` with the provider keys you actually use:

```bash
mkdir -p ~/.config/switchmaxxer
cat > ~/.config/switchmaxxer/switchmaxxer.env <<'EOF'
SWITCHMAXXER_OPENAI_API_KEY=...
SWITCHMAXXER_ANTHROPIC_API_KEY=...
SWITCHMAXXER_MINIMAX_API_KEY=...
EOF
chmod 0600 ~/.config/switchmaxxer/switchmaxxer.env
```

4. Reload the user service manager, then enable and start the service:

```bash
systemctl --user daemon-reload
./switchmaxxer gateway enable
./switchmaxxer gateway start
```

`systemctl --user daemon-reload` is still needed here because the CLI does not install or reload unit files.

If you install under a different unit name, set top-level `systemd_unit` in `config.json` or override it at runtime with `SWITCHMAXXER_UNIT`. Gateway service control, status, reload, and log commands use that effective unit name.

When `inbound_api_key_env` is configured, local CLI surfaces that call the live gateway, such as `invoke`, gateway-backed `test`, `bench --path gateway`, and `gateway runtime config`, automatically send the configured inbound token rather than assuming localhost is implicitly trusted.

By default, startup, reload, and config validation fail fast if that env var is
missing or empty. `allow_unauthenticated_gateway: true` is a development-only
escape hatch, not a substitute for inbound auth.

When inbound auth is enabled, the configured token must be at least 32
characters long.

Gateway startup also requires a top-level `rate_limit` policy:

```json
"rate_limit": {
  "requests": 50,
  "window": "1s"
}
```

When the runtime exceeds that global request budget, it returns HTTP `429` with
`Retry-After` and records a gateway observability event.

5. Check status:

```bash
systemctl --user status "${SWITCHMAXXER_UNIT:-switchmaxxer.service}"
./switchmaxxer gateway status --json
./switchmaxxer gateway health --json
```

The CLI status view complements raw `systemctl` output:

- `gateway status` tells you whether the configured listener is actually reachable
- the nested `service` block shows `systemd` unit state when the bus is available
- `gateway health` stays focused on automation-friendly readiness checks

6. Manage the service lifecycle:

```bash
./switchmaxxer gateway start
./switchmaxxer gateway stop
./switchmaxxer gateway restart
./switchmaxxer gateway enable
./switchmaxxer gateway disable
```

7. Reload config after safe config changes:

```bash
./switchmaxxer gateway reload
```

8. Inspect recent service logs with:

```bash
systemctl --user status "${SWITCHMAXXER_UNIT:-switchmaxxer.service}"
journalctl --user -u "${SWITCHMAXXER_UNIT:-switchmaxxer.service}" -n 50 --no-pager
```

## Common Commands

Core gateway operations:

```bash
./switchmaxxer --help
./switchmaxxer version
./switchmaxxer gateway run
./switchmaxxer gateway run --config ./config.json
./switchmaxxer gateway run --host 127.0.0.1 --port 4081
./switchmaxxer gateway status --json
./switchmaxxer gateway health --json
./switchmaxxer gateway runtime config --json
```

`gateway status --json` reports four useful sections:

- `runtime`: high-level gateway runtime state and PID
- `listener`: bind host, port, address, reachability, and health probe latency
- `service`: best-effort `systemd` unit details when available
- `config`: config source path plus model/provider/route counts

`gateway runtime config --json` exposes the live authenticated runtime snapshot, including `loaded_at`, reload-state fields, and fatal process-integrity fields so failed reloads and fatal async runtime faults remain observable while shutdown is in progress.

For a `systemd`-managed service:

```bash
./switchmaxxer gateway start
./switchmaxxer gateway stop
./switchmaxxer gateway restart
./switchmaxxer gateway reload
./switchmaxxer gateway reload --config ./config.json
./switchmaxxer gateway reload --json
./switchmaxxer gateway logs show --lines 50
./switchmaxxer gateway logs tail --lines 100
./switchmaxxer gateway logs show --format json --lines 20
```

The logs surface:

- prefers `systemd --user` journald entries and falls back to the system journal
- returns normalized JSON log entries instead of raw journald payload blobs
- includes `request_id` correlation for proxied requests
- preserves explicit debug lifecycle events in JSON mode, including `debug_error_context`
- supports debug logging through either:
  - `switchmaxxer gateway run --log-level debug`
  - `SWITCHMAXXER_LOG_LEVEL=debug`
  - top-level config `"log_level": "debug"`
- resolves log-level precedence as: CLI flag, then environment, then config, then default `info`

Config inspection and movement:

```bash
./switchmaxxer config validate
./switchmaxxer config validate --json
./switchmaxxer config show
./switchmaxxer config show --json
./switchmaxxer config export --output ./switchmaxxer-redacted.json
./switchmaxxer config export --include-secrets --output ./switchmaxxer-backup.json
./switchmaxxer config import --json-input ./switchmaxxer-backup.json
./switchmaxxer config import --json-input ./switchmaxxer-backup.json --dry-run
./switchmaxxer config import --json-input ./switchmaxxer-backup.json --backup
./switchmaxxer config set max_payload_size 4000000
```

`config show` is a redacted normalized display surface, not a byte-for-byte dump of `config.json`. Inline secrets are masked and the document is re-serialized as clean JSON for safe inspection. `config export` is also redacted by default for stdout, JSON, and file output. `config import` accepts the same full effective document shape and writes it back into the required split files: runtime fields in `config.json`, catalog fields in `catalog.json`. `config import --backup` backs up both local split files when they exist. `config import --dry-run` redacts inline provider `api_key` values in preview diffs, including JSON envelopes. Use `config export --include-secrets --output <path>` only for full-fidelity backups that must preserve inline provider `api_key` values; treat those files as secret-bearing.

Entity CRUD:

```bash
./switchmaxxer models list --json
./switchmaxxer models create gpt-4.1 --display-name "GPT-4.1" --model-creator openai
./switchmaxxer models update gpt-4.1 --display-name "GPT-4.1 (Updated)"
./switchmaxxer models delete gpt-4.1

./switchmaxxer providers list --json
./switchmaxxer providers create provider_id --endpoint "https://api.openai.com/v1/chat/completions" --api-mode openai-completions --api-key-env SWITCHMAXXER_OPENAI_API_KEY
./switchmaxxer providers update provider_id --endpoint "https://api.openai.com/v1/chat/completions"
printf 'sk-example' | ./switchmaxxer providers set-key provider_id --api-key-stdin
./switchmaxxer providers delete provider_id

./switchmaxxer routes list --json
./switchmaxxer routes create route_id --model gpt-4o-mini --service-provider provider_id --provider-model-id gpt-4o-mini --display-name "Example Route" --timeout-ms 90000
./switchmaxxer routes update route_id --display-name "Updated Route Label" --clear-timeout-ms
./switchmaxxer routes delete route_id
```

Observability and retention:

```bash
./switchmaxxer trace list
./switchmaxxer trace stats
./switchmaxxer trace observations
./switchmaxxer trace show <request-id>
./switchmaxxer trace verify --json
./switchmaxxer trace repair --json
./switchmaxxer prune --older-than 30d
./switchmaxxer prune --config ./config.json --json
./switchmaxxer ledger list --target-kind route --status failed --json
./switchmaxxer ledger list --operation providers_update --since 24h
./switchmaxxer ledger show <ledger-event-id> --json
```

The observability capability stream is:

```text
observations -> traces -> benchmark runs -> optimize runs -> ledger events
```

`switchmaxxer prune` is the whole-store retention command. Use
`switchmaxxer bench prune/delete/clear` for benchmark-history cleanup and
`switchmaxxer optimize prune/delete/clear` for optimize-history cleanup.
Use `switchmaxxer ledger list/show` to inspect successful and failed
control-plane attempts, including model/provider/route mutations and optimize
apply/restore attempts.

Benchmarking:

```bash
./switchmaxxer bench --route gpt-4o-mini --prompt "Say pong" --iterations 5
./switchmaxxer bench --routes gpt-4o-mini,openrouter-gpt-4o-mini --path both --json
./switchmaxxer bench list
./switchmaxxer bench show <run-id>
./switchmaxxer bench prune --older-than 30d --json
./switchmaxxer bench delete <run-id> --json
./switchmaxxer bench clear --json
```

Route optimization:

```bash
./switchmaxxer optimize --model gpt-4o-mini --objective cost
./switchmaxxer optimize --model gpt-4o-mini --objective cost --input-tokens 2000 --output-tokens 500 --json
./switchmaxxer optimize --model gpt-4o-mini --objective latency --prompt "Say pong" --iterations 5
./switchmaxxer optimize list
./switchmaxxer optimize show <run-id>
./switchmaxxer optimize apply <run-id> --route gpt-4o-mini --dry-run --json
./switchmaxxer optimize apply <run-id> --route gpt-4o-mini --reload --verify
./switchmaxxer optimize restore <apply-action-id> --reload --verify
./switchmaxxer optimize prune --older-than 30d --json
./switchmaxxer optimize delete <run-id> --json
./switchmaxxer optimize clear --json
```

Cost optimization scores a reference token workload against catalog rate cards.
Latency optimization reuses the benchmark runtime and persists the benchmark
run that supports the recommendation. Apply and restore are explicit config
mutation actions backed by managed SQLite snapshots.

The MCP surface exposes the same recommendation and mutation lifecycle through
`optimize_run`, `optimize_list`, `optimize_show`, `optimize_apply`, and
`optimize_restore`. Privileged MCP clients can inspect the Control Plane Audit
Ledger through `ledger_list` and `ledger_show`.

Testing and invocation:

```bash
./switchmaxxer test
./switchmaxxer test --route gpt-4o-mini
./switchmaxxer test --no-gateway
./switchmaxxer invoke --route gpt-4o-mini --prompt "hello"
./switchmaxxer tool date
./switchmaxxer tool uptime
./switchmaxxer tool random
```

Testing semantics:

- `switchmaxxer test` runs route tests through the live gateway by default
- `switchmaxxer test --route <route-id>` narrows that same test flow to one route
- `switchmaxxer test --no-gateway` runs the same route tests directly against upstream providers
- `switchmaxxer config validate` is the canonical static config validation command
- text-mode `switchmaxxer test` prints a short start header, then streams one result per route as each inner test finishes, then prints a concise summary
- gateway-mode tests fail fast with a structured `gateway_unavailable` error when the configured gateway is not reachable

Preferred shorthand:

- `switchmaxxer` is the canonical command name in docs
- `smx` is the official in-repo shorthand when you are working from the Switchmaxxer directory

## Configuration

Switchmaxxer loads `config.json` from the current working directory unless you pass `--config`, and it requires a sibling `catalog.json` next to the selected config file. `config.json` owns runtime, security, MCP, observability, and gateway settings. `catalog.json` owns `service_providers`, `routes`, and `models`, and must contain all three sections even when they are empty. CLI and MCP model/provider/route mutations write catalog changes back to `catalog.json`.

If `catalog.json` is missing, that is a setup error. It is never a fallback mode
that allows `service_providers`, `routes`, or `models` back into `config.json`.

The mental model is:

- `models` are the canonical catalog
- `service_providers` are the concrete upstream endpoints
- `routes` are the stable names your clients use
- `gateway` is the long-running runtime/server that listens, routes, proxies, and exposes operational surfaces

That keeps application code simple while letting operators change provider bindings behind the route layer.

Top-level fields:

- `bind_host`: local interface to bind the gateway to; defaults to `127.0.0.1`
- `allow_remote_bind`: explicit opt-in for authenticated non-loopback gateway listeners
- `allow_wildcard_bind`: separate opt-in for wildcard listeners such as `0.0.0.0` or `::`
- `inbound_api_key_env`: environment variable that holds the inbound gateway token
- `allow_unauthenticated_gateway`: explicit local-development opt-out for inbound gateway auth
- `one_trusted_operator_boundary`: opt-in to skip the unauthenticated local-client marker header for trusted loopback apps
- `allow_unauthenticated_health`: explicit opt-out for `/health` authentication
- `rate_limit`: inbound request rate limit settings
- `mcp`: MCP capability settings
- `observability`: observability retention and store settings
- `systemd_unit`: managed service unit name
- `log_level`: runtime log verbosity
- `max_connections`: maximum concurrent TCP connections accepted by the gateway; defaults to `200`
- `port`: local listening port
- `timeout_ms`: upstream request timeout in milliseconds
- `stream_idle_timeout_ms`: maximum idle time for an active streaming response
- `stream_min_bytes_per_second`: minimum streaming throughput over the rate window
- `stream_rate_window_ms`: streaming throughput measurement window
- `stream_max_lifetime_ms`: absolute lifetime cap for one streaming upstream response
- `stream_max_event_bytes`: maximum in-progress SSE event size during stream translation
- `stream_max_total_bytes`: maximum total bytes accepted from one streaming upstream response
- `max_concurrent_streams_per_ip`: per-client stream concurrency cap
- `max_concurrent_json_parses`: concurrent JSON parse cap
- `max_buffered_upstream_response_bytes`: upstream response buffering cap
- `shutdown_timeout_ms`: graceful shutdown deadline before a forced exit
- `max_payload_size`: maximum accepted inbound request body size in bytes
- `benchmark`: benchmark-runtime defaults such as `default_max_tokens` and `default_anthropic_version`

Unknown config keys are rejected rather than silently ignored, so typos like
`max_payload_siz` fail fast during config load and validation.

Provider fields:

- `endpoint`
- `api_mode`
- `api_key_env`
- optional inline override: `api_key`
- optional Anthropic-only version pin: `anthropic_version`

Route fields:

- `model`
- `service_provider`
- `provider_model_id`
- `display_name`
- optional `timeout_ms` to override the top-level `timeout_ms` default for that route

Files:

- runtime config example: [config-examples/config.example.json](config-examples/config.example.json)
- required catalog example: [config-examples/catalog.example.json](config-examples/catalog.example.json)
- local secrets example: [config-examples/secrets.example.json](config-examples/secrets.example.json)
- local active config: `config.json` after you create it from the example
- local active catalog: `catalog.json` beside `config.json` after you create it
  from the example
- local active secrets: `~/.config/switchmaxxer/secrets.json` when you need
  machine-specific provider key overrides

## Endpoints

- `GET /health` (minimal liveness response; authenticated by default when gateway auth is enabled)
- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`

## Listener Rules

- OpenAI listener: `http://<host>:<port>`
- Anthropic listener: `http://<host>:<port>/anthropic`
- the Anthropic listener only accepts routes where `api_mode` is `anthropic-messages`

Some Anthropic-compatible clients auto-detect Anthropic mode when their configured base URL ends with `/anthropic`.

Optional caller display-label headers checked in order:

- `x-switchmaxxer-caller`
- `x-switchmaxxer-client`
- `x-client-name`

These values are untrusted attribution metadata for logs and observations, not
authentication or rate-limit identity.

## Security Notes

- Switchmaxxer binds to `127.0.0.1` by default.
- Prefer `api_key_env` over inline `api_key` values.
- Sparse local API-key overrides can live in gitignored `secrets.json`
  (`$XDG_CONFIG_HOME/switchmaxxer/secrets.json`,
  `$HOME/.config/switchmaxxer/secrets.json`, or `SWITCHMAXXER_SECRETS_PATH`);
  explicit secrets paths must not be symlinks.
- `switchmaxxer config validate` warns about inline plaintext `api_key` usage.
- config and catalog reads, startup, and reload fail closed when `config.json`
  or `catalog.json` has group or world permission bits, including
  group-readable, group-writable, world-readable, or world-writable modes; use
  `chmod 0600 config.json catalog.json`
- loaded `secrets.json` files follow the same owner-only file-mode posture; use
  `chmod 0600 /path/to/secrets.json`
- the live runtime-config endpoint is intended for local/admin use behind the loopback default

## Route Names In The Example Catalog

OpenAI-style routes:

- `gpt-4o-mini`
- `openrouter-gpt-4o-mini`
- `llama-local`

Anthropic-style routes:

- `claude-sonnet-4-6`
- `MiniMax-M2.7-highspeed`
- `openrouter-claude-sonnet-4-6`

## Supported vs. Stubbed Surfaces

Supported surfaces:

- `gateway run`
- `gateway start`
- `gateway stop`
- `gateway restart`
- `gateway enable`
- `gateway disable`
- `gateway reload`
- `gateway runtime config`
- `gateway status`
- `gateway health`
- `gateway logs show`
- `gateway logs tail`
- `config validate`
- `config show`
- `config import`
- `config export`
- `config set max_payload_size`
- `models`, `providers`, `routes`
- `test`
- `invoke`
- `tool date`
- `tool uptime`
- `tool random`
- `trace list`
- `trace stats`
- `trace observations`
- `trace show`
- `trace verify`
- `trace repair`
- `prune`
- `ledger list`
- `ledger show`
- `bench`
- `bench list`
- `bench show`
- `bench prune`
- `bench delete`
- `bench clear`
- `optimize`
- `optimize list`
- `optimize show`
- `optimize apply`
- `optimize restore`
- `optimize prune`
- `optimize delete`
- `optimize clear`

Reserved surfaces:

- `config migrate`

## Tests

The test suite is a source-checkout development surface. It is available in
the Git repository and is intentionally excluded from the future npm package
artifact.

Recommended source-checkout entry points:

- `npm run lint`
  Runs the type-aware ESLint layer for TypeScript correctness checks, including `no-floating-promises`, `no-misused-promises`, and `no-explicit-any` outside the command-adapter carve-outs.
- `npm run test:unit`
  Runs the fast local TypeScript unit layer: build, config/proxy/MCP logic tests, and perf math tests.
- `npm run test:integration`
  Runs the clean-clone smoke shell suite and captures per-test logs under `.switchmaxxer/test-logs/integration/<timestamp>/` by default.
- `npm run test:integration:self-contained`
  Runs the broader non-env shell suite for local contract coverage beyond the smoke path.
- `npm run test:integration:env`
  Runs the explicit operator-environment shell tests that depend on a live gateway and usable real config/runtime state.
- `npm run test:integration:all`
  Runs every integration shell test across both tiers.
- `npm run test:all`
  Runs the canonical full local verification sweep: `npm run test:unit` and then `npm run test:integration:all`.
- `npm test`
  Runs the local-safe suite entry points: `npm run test:unit` and then `npm run test:integration`.

Examples:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:all
npm run test:integration:self-contained
npm run test:integration:env
npm test
```

Build/runtime debug note:

- `npm run build` emits JavaScript source maps into `dist/`.
- The main Node entry points (`start`, `test:unit`, `test:observability`, and `perf:gateway`) run with `--enable-source-maps`, so stack traces map back to `src/` instead of only showing compiled `dist/` frames.

Local integration-test prerequisites:

- `jq`
  Required for shell-test JSON assertions.

If you want the integration logs somewhere else, set `SWITCHMAXXER_TEST_LOG_DIR` before running any `npm run test:integration*` command.

## Release Process

Switchmaxxer uses normal semantic versioning. The package version is `0.0.4`,
with release notes tracked in [CHANGELOG.md](CHANGELOG.md).

Recommended manual release flow:

- update `CHANGELOG.md`
- run `npm run check:docs`, `npm run check:boundaries`, `npm run test:unit`, and `npm run check:pack`
- inspect the package dry-run output for accidental local files, secrets, source tests, or internal readiness docs
- run `npm version patch`, `npm version minor`, or `npm version major`
- push the release commit and Git tag with `git push && git push --tags`

The `npm version` lifecycle runs the local release gate first:

- `npm run lint`
- `npm run test:unit`

npm publishing is intentionally disabled for this public beta. `package.json`
contains `"private": true` and `npm publish` will refuse to upload. The
package boundary (`files` allowlist, `.npmignore`, `npm pack --dry-run`) is
still checked in CI so the boundary stays clean, but distribution is via
source checkout from GitHub only. Users should `git clone` and `npm install`
locally; there is no `npm install -g switchmaxxer` path for this release.

## Docs By Goal

- Running the gateway:
  [docs/how-to/how-to-operate-the-switchmaxxer-gateway.md](docs/how-to/how-to-operate-the-switchmaxxer-gateway.md)
- Connect OpenClaw to Switchmaxxer:
  [docs/how-to/how-to-connect-openclaw-to-switchmaxxer.md](docs/how-to/how-to-connect-openclaw-to-switchmaxxer.md)
- OpenClaw agent integration skill (load this into OpenClaw agents that talk to Switchmaxxer):
  [docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md](docs/ecosystem/openclaw/switchmaxxer-openclaw-integration-skill.md)
- CLI rollout and command surface:
  [docs/subsystems/cli/tech-spec-for-cli-surface.md](docs/subsystems/cli/tech-spec-for-cli-surface.md)
- MCP launch and consumer examples:
  [docs/subsystems/mcp/how-to-launch-switchmaxxer-mcp.md](docs/subsystems/mcp/how-to-launch-switchmaxxer-mcp.md)
- Config reference:
  [docs/subsystems/config/config-reference.md](docs/subsystems/config/config-reference.md)
- Error-code reference:
  [docs/contracts/error-codes-reference.md](docs/contracts/error-codes-reference.md)
- Logging and trace reference:
  [docs/subsystems/observability/current/switchmaxxer-logging-reference.md](docs/subsystems/observability/current/switchmaxxer-logging-reference.md)
