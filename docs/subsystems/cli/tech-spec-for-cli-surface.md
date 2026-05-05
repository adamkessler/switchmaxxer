# Switchmaxxer CLI Surface Tech Spec

## Purpose

This document is the source-synchronous CLI surface specification for the
repository.

Use it when:

- checking which command families are present in source
- grounding operator docs and tests in the actual dispatcher
- deciding whether a behavior belongs in the gateway runtime or the control plane

For operator walkthroughs, also see:

- [README.md](../../../README.md)
- [how-to-operate-the-switchmaxxer-gateway.md](../../how-to/how-to-operate-the-switchmaxxer-gateway.md)
- [config-reference.md](../config/config-reference.md)

## Command Families

Implemented and supported:

- `help`
- `version`
- `gateway`
- `config`
- `models`
- `providers`
- `routes`
- `test`
- `trace`
- `prune`
- `ledger`
- `invoke`
- `tool`
- `bench`
- `optimize`
- `mcp`

Present as reserved/unsupported surfaces:

- `config migrate`

Not implemented as CLI families:

- `completion`
- `tui`
- `api`
- `browser`

## Runtime Versus Control Plane

Switchmaxxer keeps a deliberate split between:

- **gateway runtime**
- **control plane**

The gateway runtime is the live HTTP server. It owns:

- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`
- `GET /health`
- `GET /__switchmaxxer/runtime/config`
- `GET /__switchmaxxer/runtime/inspect/<inspection-id>`

The control plane owns:

- config inspection and mutation
- lifecycle commands
- MCP server surfaces
- trace and benchmark inspection
- observability verification, repair, and pruning

## Gateway Surface

Current `gateway` commands:

- `switchmaxxer gateway run [--config <path>] [--host <host>] [--port <number>] [--log-level <debug|info|warn|error>]`
- `switchmaxxer gateway start`
- `switchmaxxer gateway stop`
- `switchmaxxer gateway restart`
- `switchmaxxer gateway enable`
- `switchmaxxer gateway disable`
- `switchmaxxer gateway reload [--config <path>]`
- `switchmaxxer gateway runtime config`
- `switchmaxxer gateway status`
- `switchmaxxer gateway auth`
- `switchmaxxer gateway health [--check <gateway|config|providers|routes|all>] [--timeout-ms <number>]`
- `switchmaxxer gateway logs tail`
- `switchmaxxer gateway logs show`

Important behavior:

- `gateway run` is the canonical foreground entrypoint
- lifecycle commands target the configured `systemd_unit`
- `SWITCHMAXXER_UNIT` can override the configured service unit at runtime
- `gateway reload` verifies adoption by polling the authenticated runtime-config endpoint
- `gateway status --json` includes redacted `inbound_auth_state` so operators
  can distinguish enabled auth, explicitly disabled auth, and auth
  misconfiguration without exposing the token
- `gateway auth --json` is the focused local diagnostic for inbound auth; it
  reports the configured env var, token presence/length validity, and a short
  token fingerprint without printing the token
- `gateway reload --config <path>` uses that config's trusted local
  `bind_host`, `port`, and `systemd_unit` values for the reload request and
  confirmation check
- that reload-confirmation probe derives its local HTTP target from trusted
  config `bind_host` and `port` fields
- this is an accepted trust assumption for today's local-operator model, not a
  general remote-config pattern
- failed reloads keep serving the last good runtime snapshot and surface reload status through `gateway runtime config`

## Config And Entity Management

Config/entity surfaces:

- `switchmaxxer config validate`
- `switchmaxxer config show`
- `switchmaxxer config schema`
- `switchmaxxer config migrate` (reserved/unsupported; hidden from standard help)
- `switchmaxxer config set max_payload_size <bytes>`
- `switchmaxxer config import`
- `switchmaxxer config export`
- `switchmaxxer models list|show|create|update|delete`
- `switchmaxxer providers list|show|create|update|delete`
- `switchmaxxer providers set-key`
- `switchmaxxer providers clear-key`
- `switchmaxxer providers set-key-env`
- `switchmaxxer routes list|show|create|update|delete|explain`

Contract notes:

- `switchmaxxer config validate` is the one static config-validation command
- provider secrets are mutated only through dedicated provider secret commands, not through generic update surfaces
- config writes are atomic
- config import supports `--dry-run` and `--backup`
- config import accepts a full effective config document and writes it back as
  the required local split: runtime fields in `config.json`, catalog fields in
  `catalog.json`
- `config import --backup` backs up both local split files when they exist
- config import dry-run previews redact inline provider `api_key` values in both text and JSON diff output
- config export redacts inline provider `api_key` values by default; full-fidelity secret-bearing backups require `config export --include-secrets --output <path>`
- human-readable list outputs for models, providers, and routes use
  column-aligned tabular text with stable headers; `--json` remains the
  contract surface for automation
- normal CLI `--config` resolution is intentionally flexible for operators and may target any explicitly selected readable path
- path-bounding is not a general CLI rule; stricter config-root constraints belong to narrower machine-facing surfaces like MCP
- scalar numeric CLI arguments use strict canonical numeric parsing instead of
  partial-token parsing; integer flags reject values such as `123abc`, `1.5`,
  `+1`, whitespace-wrapped values, and integers outside JavaScript's safe range

### Input Normalization Boundaries

CLI command handlers rely on a shared input-normalization layer, but that layer
is intentionally being split by responsibility instead of continuing to grow as
one catch-all file.

- [src/subsystems/cli/input-normalization.ts](../../../src/subsystems/cli/input-normalization.ts)
  - now acts as the thin composition layer that wires shared helpers into the entity-specific normalization modules
- [src/subsystems/cli/cost-flag-parser.ts](../../../src/subsystems/cli/cost-flag-parser.ts)
  - owns shared `--cost-*` / `--clear-cost` resolution rules
- [src/subsystems/cli/structured-input-detect.ts](../../../src/subsystems/cli/structured-input-detect.ts)
  - owns shared `--stdin` / `--json-input` mode detection, conflict handling,
    bounded reads, and bounded JSON parsing for entity structured input
- [src/subsystems/cli/model-input-normalization.ts](../../../src/subsystems/cli/model-input-normalization.ts)
  - owns model create/update normalization rules and their structured-input variants
- [src/subsystems/cli/provider-input-normalization.ts](../../../src/subsystems/cli/provider-input-normalization.ts)
  - owns provider auth-field normalization plus provider create/update normalization rules
- [src/subsystems/cli/route-input-normalization.ts](../../../src/subsystems/cli/route-input-normalization.ts)
  - owns route create/update normalization rules, including timeout and cost-field handling

The design intent is the same as the `proxy.ts` and `mcp.ts` cleanups:
cross-cutting parsing rules should move into narrow helper modules first,
while `input-normalization.ts` stays a thin entity-composition layer instead of growing back into a god-file.

Structured JSON input has the same parser-boundary posture as runtime config
and gateway JSON:

- model, provider, and route structured payloads are capped at 64 KiB
  (`MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES`) before JSON parsing
- full `config import` payloads are capped at 8 MiB
  (`MAX_CONFIG_FILE_BYTES`) before JSON parsing
- both stdin and `--json-input` files route through `parseJsonWithinBounds`,
  which checks serialized size, raw nesting depth, and parsed node count
- shared JSON bounds reject raw or parsed nesting deeper than 256 levels and
  parsed structures above 16,000 nodes
- config-import diff and backup reads reject existing target files above the
  shared config-file cap instead of reading them unbounded
- malformed, oversized, or structurally abusive structured input is surfaced as
  `invalid_input_field` when it is part of the caller-provided import/entity
  payload

## Request, Tool, And Benchmark Surfaces

Request-path operator surfaces:

- `switchmaxxer test`
- `switchmaxxer test --route <route-id>`
- `switchmaxxer test --no-gateway`
- `switchmaxxer invoke`
- `switchmaxxer tool date`
- `switchmaxxer tool uptime`
- `switchmaxxer tool random`
- `switchmaxxer bench`
- `switchmaxxer bench list`
- `switchmaxxer bench show`
- `switchmaxxer bench prune`
- `switchmaxxer bench delete`
- `switchmaxxer bench clear`

Important behavior:

- `switchmaxxer test` is a route-path test surface, not a config-validation alias
- `switchmaxxer tool` is a built-in utility surface, not a route alias
- CLI request-path calls use bounded caller-side timeouts
- `switchmaxxer invoke --inspect` is an ephemeral, CLI-only protocol debugging
  surface for non-streaming requests; it renders the four-hop
  `Client -> SMX -> Provider -> SMX -> Client` bodies and headers without
  persisting them
- `switchmaxxer invoke --inspect` requests capture creation with
  `x-switchmaxxer-inspect: 1`; the gateway allocates the inspection id and
  one-time read token, then returns them in `x-switchmaxxer-inspect-id` and
  `x-switchmaxxer-inspect-token`
- the CLI must present `x-switchmaxxer-inspect-token` when reading the capture
  from `GET /__switchmaxxer/runtime/inspect/<inspection-id>`
- `switchmaxxer invoke --inspect` masks secret-bearing headers by default;
  `--include-secrets` deliberately shows local auth-like headers in clear text
  only when the gateway process is opted in with
  `SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1`; upstream provider authorization
  remains redacted
- `bench` and MCP `bench_run` share the same bounded cost caps
- CLI `bench` uses `--path <gateway|direct|both>` as its path-selection control
- MCP `bench_run` uses `path_mode: "gateway" | "direct" | "both"` for the same selection surface
- those CLI and MCP path-selection values should stay aligned as one control-plane contract
- `bench --path both` can degrade to direct-only when the gateway path is unavailable and records that warning in the run result

## Observability Surface

Persisted observability surfaces:

- `switchmaxxer trace list`
- `switchmaxxer trace stats`
- `switchmaxxer trace observations`
- `switchmaxxer trace show`
- `switchmaxxer trace verify`
- `switchmaxxer trace repair`
- `switchmaxxer prune`
- `switchmaxxer ledger list`
- `switchmaxxer ledger show`
- benchmark run inspection through `bench list` and `bench show`
- benchmark-history cleanup through `bench prune`, `bench delete`, and
  `bench clear`
- optimize-history inspection through `optimize list` and `optimize show`
- optimize-history cleanup through `optimize prune`, `optimize delete`, and
  `optimize clear`

Important behavior:

- the observability store is SQLite-backed
- `trace verify` and `trace repair` support batched whole-store maintenance
- retention is a whole observability-store operation, not a trace-only
  operation
- the canonical manual retention command is
  `switchmaxxer prune --older-than <duration>`
- `switchmaxxer trace prune` is intentionally not exposed because it suggests
  trace-only behavior
- retention is also applied automatically by the gateway when configured
- `ledger list` and `ledger show` inspect Control Plane Audit Ledger events;
  list results are summary rows, while show returns the full result/error and
  metadata envelopes for one Ledger event
- `ledger list` can filter by route, generic target id/kind, operation, status,
  source surface, optimize run id, mutation event id, recent duration, and
  result limit
- `bench prune`, `bench delete`, and `bench clear` delete only
  `benchmark_runs` and `benchmark_samples`; they leave trace/request rows alone
- `optimize prune`, `optimize delete`, and `optimize clear` delete optimize
  runs plus optimize-owned apply/restore events and orphaned managed snapshots;
  they leave trace/request and benchmark rows alone
- general config mutation history is pruned by whole-store retention only;
  optimize-history cleanup may touch only optimize-owned apply/restore events
  and orphaned snapshots

## MCP Surface

MCP support is available through:

- `switchmaxxer mcp serve`
- `switchmaxxer mcp capabilities`

MCP scope includes:

- config discovery and validation
- config CRUD for models, providers, and routes
- gateway inspection
- trace inspection, verification, repair, and pruning
- benchmark listing, show, and run
- cost optimization listing, show, and run

Primary contract docs:

- [tech-spec-for-mcp-cli-contract.md](../../contracts/tech-spec-for-mcp-cli-contract.md)
- [tech-spec-for-mcp.md](../mcp/tech-spec-for-mcp.md)

Important boundary rule:

- `switchmaxxer mcp capabilities --json` previews the effective MCP
  capability grant and the concrete enabled/disabled MCP tool names for a
  selected config
- `switchmaxxer mcp serve` prints the effective granted tiers and enabled /
  disabled tool counts to stderr at startup so stdout remains reserved for MCP
  protocol frames
- the CLI and MCP do not share identical `--config` trust rules
- normal CLI `--config` remains flexible for human operators
- the MCP control surface is bounded to the working tree and rejects config paths that escape that root
- CLI-facing gateway command composition lives in
  `src/subsystems/cli/gateway-cli-bootstrap.ts`; gateway runtime modules must
  not import CLI modules

## Out Of Scope

The current source tree intentionally keeps these surfaces out of the supported
CLI contract:

- `optimize` supports persisted cost and latency model-scoped recommendations
  in the CLI and MCP, plus explicit provider apply/restore through both
  surfaces. CLI-only reload/verification flags remain wrapper conveniences
  around the shared mutation service.
- live policy routing and automatic route mutation are not part of the current
  optimize contract
- `config migrate` is a reserved subcommand surface
- there is no TUI
- there is no dedicated HTTP admin API beyond the runtime endpoints
- there is no browser UI

## Source Of Truth

When this document and the code disagree, prefer:

- [src/app-cli.ts](../../../src/app-cli.ts)
- [src/index.ts](../../../src/index.ts)
- [src/subsystems/cli/commands/](../../../src/subsystems/cli/commands/)
- [src/subsystems/cli/app-registry.ts](../../../src/subsystems/cli/app-registry.ts)
- [README.md](../../../README.md)

This file exists to summarize the source-backed surface cleanly.
