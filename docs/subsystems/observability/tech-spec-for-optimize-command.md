# Tech Spec for Optimize Command

## 1. Purpose

This document defines the `optimize` surface for Switchmaxxer. The current
source tree implements model-scoped route recommendations with persisted
history, CLI/MCP `cost` and `latency` objectives, and explicit provider
apply/restore commands that can mutate one route's provider binding.
This spec records that current contract and the preferred direction for
deferred policy work
without duplicating benchmarking, route resolution, config mutation, or
observability-store logic.

`switchmaxxer optimize` compares configured routes that target the same
canonical model and produces a ranked recommendation according to an
operator-selected objective. The default optimize run persists history into the
local observability store and does not rewrite the active catalog. Operators may
then explicitly apply a persisted winner to a named route through
`switchmaxxer optimize apply`, and restore that provider mutation through
`switchmaxxer optimize restore`.

Use this document when:

- implementing or modifying the current CLI optimize behavior
- modifying optimize-run persistence or the optimize report envelope
- modifying the shared optimize runtime, mutation service, or persistence paths
- adding or modifying `optimize_*` MCP tools
- deciding whether a proposed optimization feature belongs in Switchmaxxer

This spec is narrower than
[tech-spec-for-benchmarking.md](tech-spec-for-benchmarking.md). Benchmarking
owns request execution, warmup, path planning, sample persistence, gateway
preflight, and bench reports. Optimize may call bench as a subroutine, but it
does not reimplement bench.

For project-wide vocabulary, especially the dependency chain
`observations -> traces -> benchmark runs -> optimize runs`, see
[white-paper-on-observability-layer.md §Core Vocabulary](white-paper-on-observability-layer.md#core-vocabulary).
In this spec, "run" means an optimize run unless explicitly qualified.

This spec is also narrower than
[field-matrix-for-observability-store.md](field-matrix-for-observability-store.md).
The existing `optimization_facts` table is request-oriented derived telemetry.
The `optimization_runs` table described here is command-history state
for optimize invocations. The two concepts are related but not interchangeable.

## 2. Scope

Current implemented scope:

- candidate route selection from the loaded config/catalog read model
- model-scoped route recommendations using required `--model`
- cost optimization using configured route/model cost metadata
- latency optimization by delegating to the existing bench runtime
- text and JSON report rendering
- persistence of optimize command history
- the CLI `optimize list`, `optimize show`, provider-only `optimize apply`,
  provider-only `optimize restore`, and optimize-history cleanup commands
- the MCP `optimize_run`, `optimize_list`, `optimize_show`,
  `optimize_apply`, and `optimize_restore` tools
- stable CLI/MCP usage and error-code contracts

Out of scope:

- automatic live routing or load balancing
- automatic mutation of `catalog.json` during optimize runs
- model-changing apply behavior
- route-policy or load-balancing apply behavior
- model-quality evaluation
- prompt rewriting or prompt optimization
- provider-price discovery or online price scraping
- continuous background optimization
- changing bench task execution or observability-store write ownership
- replacing `routes`, `models`, or `service_providers` catalog semantics

## 3. Current Repo Posture

`optimize` is currently a recommendation surface exposed through CLI and MCP.
Both surfaces support persisted `cost` and `latency` optimization plus explicit
provider apply/restore:

- [src/subsystems/cli/commands/optimize.ts](../../../src/subsystems/cli/commands/optimize.ts)
  implements the CLI default run surface plus `list` / `show` / `apply` /
  `restore` / `prune` / `delete` / `clear`
- [src/subsystems/observability/optimize-report-builder.ts](../../../src/subsystems/observability/optimize-report-builder.ts)
  owns shared candidate selection, cost/latency ranking, report persistence,
  and report rehydration
- [src/subsystems/mcp/optimize-tools.ts](../../../src/subsystems/mcp/optimize-tools.ts)
  exposes the persisted optimize behavior through MCP
- [src/subsystems/cli/app-registry.ts](../../../src/subsystems/cli/app-registry.ts)
  advertises `optimize` in normal help
- [docs/subsystems/cli/tech-spec-for-cli-surface.md](../cli/tech-spec-for-cli-surface.md)
  advertises the deferred policy optimize work in §Out Of Scope
- [docs/backlog.md](../../backlog.md) tracks `optimize` as backlog work

Older scaffold terms such as `create`, `update`, and `simulate` must not
return as v1 behavior. `delete` is reserved for optimize-history cleanup only;
it is not a generic config/entity CRUD operation. The current and intended
shape follows `bench`: a default action for running the operation, `list` and
`show` for persisted history, explicit `apply`/`restore` for controlled
mutation, and explicit cleanup commands for local history lifecycle work.

## 4. Vocabulary

| Term | Meaning |
|---|---|
| **optimize run** | One invocation of `switchmaxxer optimize` or the MCP `optimize_run` tool |
| **target model** | The canonical `models.<model-id>` entry being optimized |
| **candidate route** | A `routes.<route-id>` entry whose `model` equals the target model |
| **objective** | The ranking dimension, initially `cost` or `latency` |
| **score** | Objective-specific numeric ranking value; lower is always better |
| **winner** | The best non-disqualified candidate route |
| **disqualified candidate** | A route that was valid input but could not be scored |
| **owned bench run** | A `benchmark_runs` row created by an optimize run for a measurement-based objective |
| **provider apply** | Explicit mutation that rewrites `routes.<route-id>.service_provider`, `provider_model_id`, and `cost` on the target route to match the persisted winner |
| **provider restore** | Explicit mutation that rewrites `routes.<route-id>.service_provider`, `provider_model_id`, and `cost` back to the pre-apply state recorded in the apply mutation event |
| **rate card** | The catalog `cost` object, priced in USD per 1 million tokens |
| **reference tokens** | The token counts passed to `optimize --objective cost` |
| **reference token workload** | The full cost-scoring request shape: input, output, cache-read, and cache-write token counts |
| **estimated cost** | The resulting USD estimate for the reference token workload |
| **apply action id** | The `config_mutation_events.id` returned by a successful non-dry-run provider apply |
| **control-plane action event** | A `control_plane_action_events` row recording an apply/restore attempt from CLI or MCP, including dry-runs, failures, no-ops, and committed mutations |
| **optimize-history cleanup** | CLI-only deletion of optimize run records plus optimize-owned committed mutation records and orphaned managed snapshots |

For the full Control Plane Audit Ledger concept, including operator and agent
workflows, see
[tech-spec-for-control-plane-audit-ledger.md](tech-spec-for-control-plane-audit-ledger.md).

## 5. Beginner Concept: What Is a Run?

An optimize run is a saved recommendation report. When an operator runs:

```text
switchmaxxer optimize --model gpt-4o-mini --objective cost
```

Switchmaxxer loads the selected config/catalog, finds the routes that target
`gpt-4o-mini`, scores those candidate routes, picks a winner, prints a report,
and saves that report in the local observability SQLite store. The saved report
gets a `run_id`.

The `run_id` is a durable handle for that recommendation. It is not a route, a
provider, or a model. It points to the optimization report that was produced at
one moment in time. Operators can inspect saved runs with:

```text
switchmaxxer optimize list
switchmaxxer optimize show <run-id>
```

Runs make optimize auditable and reversible in spirit:

- `optimize` creates a saved recommendation without mutating the catalog
- `optimize list` shows recent saved recommendations
- `optimize show <run-id>` reopens one recommendation report
- `optimize apply <run-id> --route <route-id>` uses a previous recommendation
  to mutate one named route's provider and returns an apply action id
- `optimize restore <apply-action-id>` restores the provider changed by that
  apply action
- `optimize restore <run-id> --route <route-id>` is a convenience lookup for
  the same apply action when the operator has the run id and route id handy
- `optimize prune`, `optimize delete`, and `optimize clear` are
  optimize-history cleanup commands for old or unwanted local optimize records

For cost objectives, the run stores the configured cost facts and ranking that
were used. For latency objectives, the run also points at the benchmark run that
measured the candidate routes. Apply uses the persisted winner plus freshness
checks against the current catalog so it can reject stale recommendations before
writing.

In short: a run is the recommendation snapshot. Apply and restore are separate
explicit control-plane actions. Every apply/restore attempt from CLI or MCP is
recorded in `control_plane_action_events`; committed provider mutations also get
a `config_mutation_events` restore point and a managed `config_snapshots` row in
SQLite. Optimize-history cleanup removes optimize-owned restore data by optimize
ownership, not by sweeping the whole observability database. Ledger rows remain
under whole-store retention.

### 5.1 Bench Runs vs Optimize Runs Are Different Entities

Switchmaxxer persists two distinct kinds of "run." They live in separate tables,
have separate IDs, and are surfaced by separate CLI and MCP commands.

| Aspect | `benchmark_runs` (bench) | `optimization_runs` (optimize) |
|---|---|---|
| Owning subsystem | bench | optimize |
| Defined in | [tech-spec-for-benchmarking.md](./tech-spec-for-benchmarking.md) | this document |
| Schema / CRUD | [src/subsystems/observability/benchmarks.ts](../../../src/subsystems/observability/benchmarks.ts) | [src/subsystems/observability/optimizations.ts](../../../src/subsystems/observability/optimizations.ts) |
| Child rows | `benchmark_samples` (one per sample) | none — ranked candidates serialized into `result_json` |
| Built by | [`bench-runner.ts`](../../../src/subsystems/observability/bench-runner.ts) | [`buildOptimizationRunRecord`](../../../src/subsystems/observability/optimize-report-builder.ts) |
| What it represents | an executed measurement of one or more routes | a recommendation report for one target model |
| CLI surfaces | `bench`, `bench list`, `bench show` | `optimize`, `optimize list`, `optimize show`, `optimize apply`, `optimize restore`, `optimize prune`, `optimize delete`, `optimize clear` |
| MCP surfaces | `bench_run` | `optimize_run`, `optimize_list`, `optimize_show`, `optimize_apply`, `optimize_restore` |

The relationship is one-way and nullable: `optimization_runs.benchmark_run_id`
is a soft foreign key into `benchmark_runs.id`, populated only when the optimize
run delegated to bench. The reverse direction does not exist — a benchmark run
does not know whether an optimize run owns it.

Three concrete invocation-to-entity patterns capture every case:

- `bench ...` → exactly **one** new `benchmark_runs` row, plus its
  `benchmark_samples` children. No `optimization_runs` row.
- `optimize --objective cost ...` → exactly **one** new `optimization_runs`
  row. `benchmark_run_id = NULL`. Cost optimization scores routes from
  configured cost metadata only and does not measure anything live.
- `optimize --objective latency ...` → exactly **one** new `optimization_runs`
  row **and** one new `benchmark_runs` row (with samples). The
  `optimization_runs` row's `benchmark_run_id` points at the bench row.

Because the foreign key is soft, optimize reports must remain readable after a
whole-store prune removes the owned bench run; see Section 11. Whole-store
prune is staged per entity family — the prune pipeline failure stages
(`config_mutation_events | config_snapshots | benchmark_runs | request_executions | observations`
in [`service.ts`](../../../src/subsystems/observability/service.ts)) confirm
bench data is pruned independently of optimize-history records and config
mutation history, not as a side effect of either.

A useful framing: **`benchmark_runs` is a measurement primitive;
`optimization_runs` is a decision record that may or may not own a
measurement.** The two are deliberately separate so that:

- raw measurements (bench) can be inspected, replayed, and pruned independently
  of the recommendations that consumed them
- a recommendation history (optimize) can be retained without paying the
  storage cost of every per-sample row that backed each decision
- live route policies and per-request `optimization_facts` (Section 11) can
  evolve as a third surface without disturbing either of the two
  command-history tables

## 6. Surfaces

### 6.1 CLI

| Command | Behavior |
|---|---|
| `switchmaxxer optimize [flags]` | runs cost or latency model-scoped optimization, persists the run, and prints text or JSON |
| `switchmaxxer optimize list [--limit <n>] [--json]` | lists persisted optimization runs newest-first |
| `switchmaxxer optimize show <run-id> [--json]` | shows one persisted optimization report |
| `switchmaxxer optimize apply <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]` | applies the persisted winner's provider to one route by mutating only `service_provider` |
| `switchmaxxer optimize restore <apply-action-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]` | restores the provider changed by one previous `optimize apply` action |
| `switchmaxxer optimize restore <run-id> --route <route-id> [--dry-run] [--verify] [--reload] [--config <path>] [--json]` | restores by resolving the matching apply action for a run and route |
| `switchmaxxer optimize prune --older-than <duration> [--json]` | optimize-history cleanup by age: deletes optimize runs older than the cutoff plus optimize-owned committed mutation records and orphaned managed snapshots |
| `switchmaxxer optimize delete <run-id> [--json]` | deletes one optimize run plus optimize-owned committed mutation records and orphaned managed snapshots |
| `switchmaxxer optimize clear [--json]` | deletes all optimize runs plus optimize-owned committed mutation records and orphaned managed snapshots |

`smx` is the official short operator alias and must accept the same forms as
`smx optimize ...`.

The default run form is intentional. Do not add a `run` subcommand in v1 unless
the top-level command registry later standardizes on explicit action verbs for
all operation families. This mirrors `switchmaxxer bench`, where the family
default action runs the operation and `list`/`show` inspect history.

`optimize` flags:

| Flag | Applies to | Purpose |
|---|---|---|
| `--model <model-id>` | all objectives | required target model |
| `--objective <cost\|latency>` | all objectives | required ranking objective |
| `--routes <csv>` | all objectives | optional candidate allow-list; every named route must target `--model` |
| `--input-tokens <n>` | `cost` | reference input token count; default `1000` |
| `--output-tokens <n>` | `cost` | reference output token count; default `1000` |
| `--cache-read-tokens <n>` | `cost` | reference cache-read token count; default `0` |
| `--cache-write-tokens <n>` | `cost` | reference cache-write token count; default `0` |
| `--prompt <text>` | `latency` | inline bench prompt; mutually exclusive with `--file` |
| `--file <path>` | `latency` | read bench prompt from a file |
| `--iterations <n>` | `latency` | passed through to bench |
| `--warmup <n>` | `latency` | passed through to bench |
| `--concurrency <n>` | `latency` | passed through to bench |
| `--path <gateway\|direct\|both>` | `latency` | passed through to bench |
| `--timeout-ms <n>` | `latency` | passed through to bench |
| `--route <route-id>` | `apply`, `restore` | target route whose `service_provider` should change |
| `--dry-run` | `apply`, `restore` | preview the provider mutation without writing `catalog.json` |
| `--verify` | `apply`, `restore` | run `switchmaxxer test --route <route-id>` after mutation and report the result inline |
| `--reload` | `apply`, `restore` | run `switchmaxxer gateway reload` after a changed mutation and report the result inline |
| `--older-than <duration>` | `prune` | cleanup cutoff such as `30d`; required for optimize-history cleanup by age |
| `--config <path>` | all objectives | load the selected `config.json` and required sibling `catalog.json` |
| `--output <path>` | all objectives | also write the optimize report to a file |
| `--json` | all objectives | emit a stable JSON success/error envelope |

Current examples:

```text
switchmaxxer optimize --model gpt-4o-mini --objective cost
switchmaxxer optimize --model claude-sonnet-4-6 --objective cost --input-tokens 2000 --output-tokens 500
switchmaxxer optimize --model gpt-4o-mini --objective latency --routes openrouter-gpt-4o-mini,gpt-4o-mini-direct --prompt "ping" --iterations 5 --path both
switchmaxxer optimize list --json
switchmaxxer optimize show opt_123 --json
switchmaxxer optimize apply opt_123 --route gpt-4o-mini --dry-run
switchmaxxer optimize apply opt_123 --route gpt-4o-mini --reload --verify
switchmaxxer optimize restore opt_123 --route gpt-4o-mini --dry-run
switchmaxxer optimize restore opt_123 --route gpt-4o-mini --reload --verify
switchmaxxer optimize prune --older-than 30d --json
switchmaxxer optimize delete opt_123 --json
switchmaxxer optimize clear --json
```

The last three examples are optimize-history cleanup commands. They are not
whole-store prune. Use `switchmaxxer prune --older-than <duration>` when the
operator intends to apply whole-store observability retention across traces,
benchmarks, optimize-history records, config mutation events, facts, and
snapshots.

#### CLI Command/Flag Cross-Walk

The implemented CLI parser owns the following flag sets. Keep this table in
sync with
[`command-args-optimize.ts`](../../../src/subsystems/cli/command-args-optimize.ts)
and the registered help in
[`commands/optimize.ts`](../../../src/subsystems/cli/commands/optimize.ts).

| CLI form | Parser | Implemented flags | Notes |
|---|---|---|---|
| `optimize` | `parseOptimizeRunArgs` | `--model`, `--objective`, `--routes`, `--input-tokens`, `--output-tokens`, `--cache-read-tokens`, `--cache-write-tokens`, `--prompt`, `--file`, `--iterations`, `--warmup`, `--concurrency`, `--path`, `--timeout-ms`, `--config`, `--output`, `--json` | persists a recommendation run; does not mutate `catalog.json` |
| `optimize list` | `parseOptimizeListArgs` | `--limit`, `--json` | newest-first history read |
| `optimize show` | `parseOptimizeShowArgs` | `--json` | single-run history read |
| `optimize apply` | `parseOptimizeApplyArgs` | `--route`, `--dry-run`, `--verify`, `--reload`, `--config`, `--json` | provider-only route mutation; `--dry-run` returns before reload/verification |
| `optimize restore` | `parseOptimizeApplyArgs` | `--route`, `--dry-run`, `--verify`, `--reload`, `--config`, `--json` | restore by apply action id or by `run_id + route_id`; `--dry-run` returns before reload/verification |
| `optimize prune` | `parseOptimizePruneArgs` | `--older-than`, `--json` | optimize-history cleanup by age |
| `optimize delete` | `parseOptimizeShowArgs` | `--json` | optimize-history cleanup for one run |
| `optimize clear` | `parseOptimizeShowArgs` | `--json` | optimize-history cleanup for all runs |

`--reload` and `--verify` are CLI-only post-action conveniences. They are not
MCP arguments, and they are not part of the shared mutation service contract.
`--verify` is not an automatic default; when explicitly supplied on a
non-dry-run apply or restore, the CLI invokes the existing route test path as
`switchmaxxer test --route <route-id> --json` and records the result inline.

### 6.1.1 Provider Apply

Provider apply is the first explicit optimize mutation surface. It is
intentionally narrow:

- it requires a persisted completed optimize run
- it requires a current target route through `--route`
- the target route must still target the optimize run's target model
- the persisted winner route must still exist and match the persisted winner
  recommendation for model, provider, and provider model id
- the winner provider must still exist
- if provider auth is detectably missing, apply fails before mutation
- the catalog fields rewritten on the target route are
  `routes.<target-route>.service_provider`, `routes.<target-route>.provider_model_id`,
  and `routes.<target-route>.cost`, in the same atomic mutation

The three fields move together because the winner's `provider_model_id` is the
identifier the new upstream actually accepts (e.g. switching from `openrouter`
to `openai_direct` requires changing `openai/gpt-4o-mini` back to `gpt-4o-mini`),
and the winner's `cost` block is the pricing the new upstream actually charges.
Writing only `service_provider` would leave the route unable to dispatch and
its cost reporting stale; rewriting all three keeps the route in a consistent
post-apply state.

The mutation event records the full before/after for all three fields in
`before_json` / `after_json`, so `optimize restore` can round-trip the route to
its exact pre-apply state. The `mutation` shape returned to clients exposes a
per-field diff (`service_provider`, `provider_model_id`, `cost`) where each
entry has `{ changed, from, to }`. The legacy `mutation.field`/`from`/`to`
top-level keys still describe the primary `service_provider` change for
back-compatible renderers.

Provider-owned settings such as `api_mode`, `endpoint`, `api_key_env`,
`anthropic_version`, `model_id_format`, private endpoint policy, and insecure
HTTP policy are accepted from the new provider. Apply does not try to preserve
or override the old provider's effective transport behavior. The resulting
catalog is validated through the normal config mutation path before it is
written.

The post-mutation validator walks every route in the catalog (not just the
target route) and checks each provider's auth resolution. To stay consistent
with how the read-model resolves `auth_source`, the validator honors the
configured Switchmaxxer secrets file: if a provider's `api_key_env` is
satisfied by an entry in `~/.config/switchmaxxer/secrets.json` (or wherever
`SWITCHMAXXER_SECRETS_PATH` points), the validator accepts it without requiring
the env var to also be present in `process.env`. This matters specifically for
MCP-driven mutations where the spawned `smx mcp serve` child has only
`SWITCHMAXXER_SECRETS_PATH` in its environment and not the individual
`SWITCHMAXXER_*_API_KEY` vars: such mutations succeed because the validator
follows the same auth-source resolution rules that `providers_show` reports.
The `inbound_api_key_env` runtime check is a separate code path and continues
to require its env var directly in `process.env`; it does not consult the
secrets file.

`--dry-run` returns the proposed multi-field mutation (service_provider,
provider_model_id, cost) and important derived provider changes without writing
`catalog.json`.

When a non-dry-run apply changes a route, Switchmaxxer writes the current
`catalog.json` into a managed `config_snapshots` row before mutation and writes
a sibling `config_mutation_events` row naming the run id, target route, old
provider, and new provider. The event id is the apply action id used by
`optimize restore <apply-action-id>`.

Every apply attempt also writes a `control_plane_action_events` row. Dry-runs,
failed validation, and no-op attempts finish in the Ledger without creating a
`config_mutation_events` row. Successful effective mutations link the ledger row
to the committed mutation row through `mutation_event_id`.

`--reload` runs the gateway reload path after a changed non-dry-run apply. A
reload failure does not roll back the already-written catalog change; the apply
result remains a success payload with `reload.status = "failed"`, a message,
warnings, and a non-zero process exit. If no catalog change was needed, reload
is reported as skipped.

`--verify` runs the existing route test path for the target route after a
non-dry-run apply. Verification is opt-in, not automatic. A verification
failure also leaves the catalog change intact, reports
`verification.status = "failed"`, includes warnings, and returns non-zero. If
no catalog change was needed, verification still runs when requested so the
operator can test the current route state.

### 6.1.2 Provider Restore

Provider restore is the inverse of provider apply. It is route-scoped and uses
the same DB-backed restore point on CLI and MCP:

- the preferred operator shape is `<apply-action-id>`
- `<run-id> --route <route-id>` remains a convenience lookup for the matching
  apply action
- it reads one `config_mutation_events` row where
  `operation = "optimize_apply"`, `status = "succeeded"`,
  `target_kind = "route"`, and the selected catalog source matches
  `catalog.json`
- the current route must still point at the provider that apply wrote
- the restore provider must still exist, and detectable missing auth fails
  before mutation
- the catalog fields rewritten are
  `routes.<target-route>.service_provider`, `routes.<target-route>.provider_model_id`,
  and `routes.<target-route>.cost`, restored to the values captured in the
  apply event's `before_json`

Restore does not replace the whole catalog with the stored snapshot. Instead,
the apply action is the restore point: the mutation event's recorded
`before_json` captures the pre-apply target route state, so restore rewrites
the same three fields (`service_provider`, `provider_model_id`, `cost`) back to
those captured values. The legacy `mutation.from`/`to` keys describe the
primary `service_provider` flip; `original_provider_model_id` and
`original_cost` on the restore-point view carry the other two fields. This
avoids clobbering unrelated catalog edits made after the apply.

When a non-dry-run apply or restore changes a route, Switchmaxxer writes a
managed pre-mutation `config_snapshots` row and a `config_mutation_events` row.
The apply event has no parent; the restore event has
`parent_event_id = <apply-action-id>`. That gives the operator a chain of
actions and snapshots without leaving optimize-specific text files in the
workspace.

Restore attempts follow the same ledger policy as apply attempts: the attempt is
recorded in `control_plane_action_events`, and only an effective committed
provider mutation gets a `config_mutation_events` restore record.

`--reload` and `--verify` have the same non-dry-run reporting and exit-code
behavior as provider apply. For restore verification, the CLI tests the
restored target route reported by the mutation result.

### 6.1.3 Optimize-History Cleanup

Optimize-history cleanup is CLI-only today and manages records owned by the
optimize command family:

- `optimize prune --older-than <duration>` deletes optimize runs with
  `optimization_runs.created_at` earlier than the computed cutoff
- `optimize delete <run-id>` deletes exactly one optimize run
- `optimize clear` deletes every optimize run

Each optimize-history cleanup command also deletes matching optimize-owned
committed apply/restore `config_mutation_events` and then removes managed
`config_snapshots` that became orphaned by that deletion. The optimize-history
cleanup path deliberately leaves unrelated observability records alone,
including request traces, benchmark rows, cost facts, optimization facts,
non-optimize config mutation events, and `control_plane_action_events`.

General control-plane action history and config mutation history remain governed
by whole-store retention only: top-level `switchmaxxer prune`, MCP `prune`,
startup retention, and periodic gateway retention. Optimize-history cleanup is
allowed to touch only optimize-owned restore data that becomes orphaned as part
of that optimize cleanup operation. The Control Plane Audit Ledger remains a
whole-store retention concern.

Latency optimize runs may have an owned `benchmark_run_id`, but
optimize-history cleanup does not delete `benchmark_runs` or
`benchmark_samples`.
Benchmark rows are cleaned up either through whole-store prune
(`switchmaxxer prune --older-than <duration>`) or through benchmark-history
cleanup (`switchmaxxer bench prune`, `switchmaxxer bench delete`,
`switchmaxxer bench clear`).

`optimize delete <run-id>` returns `optimize_not_found` when the run does not
exist. `optimize prune` and `optimize clear` are idempotent: an empty store or
empty result is a successful no-op with zero delete counts.

### 6.2 MCP

MCP optimize tools are implemented for the same model-scoped run/list/show
contract as the CLI, plus provider apply/restore mutation access:

| Tool | Capability | Behavior |
|---|---|---|
| `optimize_list` | `read` | mirrors `switchmaxxer optimize list --json` |
| `optimize_show` | `read` | mirrors `switchmaxxer optimize show <run-id> --json` |
| `optimize_run` | `privileged` | mirrors `switchmaxxer optimize --json` |
| `optimize_apply` | `mutation` | applies a persisted winner's provider to one route |
| `optimize_restore` | `mutation` | restores the provider changed by a previous optimize apply |

`optimize_run` uses snake_case arguments:

- `model`
- `objective`
- optional `routes`
- optional `input_tokens`
- optional `output_tokens`
- optional `cache_read_tokens`
- optional `cache_write_tokens`
- optional `prompt`
- optional `iterations`
- optional `warmup`
- optional `concurrency`
- optional `path_mode`
- optional `timeout_ms`

MCP latency optimization uses inline `prompt` only and intentionally does not
accept a prompt `file` path. MCP config-path selection is stricter than the
human CLI, and optimize must preserve that boundary.

`optimize_apply` uses snake_case arguments:

- `run_id`
- `route_id`
- optional `dry_run`
- optional `reload`
- optional `verify`

`optimize_restore` accepts either:

- `action_id`
- or `run_id` plus `route_id`
- optional `dry_run`
- optional `reload`
- optional `verify`

MCP apply/restore use the same optimize mutation service as the CLI for
stale-run checks, detectable auth checks, catalog mutation, managed DB
snapshots/events, Ledger rows, and JSON payload shape. Gateway reload and route
verification are explicit MCP booleans that mirror the CLI `--reload` and
`--verify` flow: non-dry-run requests defer Ledger completion until the
post-action payload has been recorded.

`optimize_run` is `privileged` even though the `cost` objective can run without
network calls. The same tool also supports `latency`, which delegates to bench,
performs outbound HTTP, and writes observability rows. If least-privilege
pressure grows, split read-only cost simulation into a separate future tool
rather than making capability checks objective-dependent inside one tool.

### 6.3 Surface Parity

The CLI and MCP surfaces share the implemented cost runtime and provider
mutation service, and should keep objective and mutation work on the same path:

- `optimize-report-builder.ts`
- `optimize-orchestrator.ts`
- `optimize-ledger-views.ts`

Surface-specific code belongs at the edges:

- CLI flag parsing and text output in `src/subsystems/cli/commands/optimize.ts`
  or child files
- MCP schema, parser, and tool payload wiring under `src/subsystems/mcp/`
- shared success/error envelope conventions from existing CLI/MCP code

The JSON payload family returned by MCP should match the CLI `--json` payload
for the same logical input, subject to the established CLI/MCP trust-boundary
differences.

## 7. Configuration And Catalog Inputs

Optimize reads the same loaded application config model as other runtime
surfaces. It must not parse raw JSON directly except through existing config
loading helpers.

Important current ownership:

- `config.json` owns runtime, security, MCP, observability, and gateway settings
- the required sibling `catalog.json` owns `service_providers`, `routes`, and
  `models`
- catalog sections must not be read from `config.json`
- model/provider/route mutation paths write catalog changes back to
  `catalog.json`

Optimize reads:

- `models` to validate `--model`
- `routes` to select candidates and read effective route/model costs
- `service_providers` indirectly through resolved routes for latency runs
- `benchmark` and gateway settings only when delegating to bench
- observability store configuration for optimize-run persistence

Optimize does not introduce an `optimize` block in `config.json` for v1. If
defaults are later needed, prefer explicit CLI/MCP inputs first. Add config only
when there is repeated operator value and a clear source-synchronous docs path.

## 8. Candidate Selection

Candidate selection must operate on validated loaded config, not ad hoc JSON.

Rules:

1. `--model` is required and must reference an existing `models.<model-id>`.
2. Without `--routes`, candidates are all routes where `route.model === model`.
3. With `--routes`, each named route must exist and must have
   `route.model === model`.
4. Candidate names are deduplicated after validation while preserving first
   occurrence order.
5. Fewer than two candidates is an error. A single-route "optimization" is an
   inspection task, not an optimization task.
6. Candidate count must not exceed `BENCH_MAX_ROUTES`, because latency
   optimization delegates to bench and should inherit its planning limits.

Do not normalize by `provider_model_id` when selecting candidates. The canonical
model link is the catalog `route.model` field. Provider model IDs are upstream
transport details and may legitimately differ by provider.

Failure classes:

| Failure | Recommended code | Notes |
|---|---|---|
| missing `--model` | `missing_required_field` | existing usage-code family |
| unknown model | `model_not_found` | existing entity-state code |
| named route not found | `route_not_found` | existing entity-state code |
| named route targets another model | `optimize_route_model_mismatch` | new optimize-specific code |
| no matching routes | `optimize_no_candidates` | new optimize-specific code |
| fewer than two candidates | `optimize_insufficient_candidates` | new optimize-specific code |
| too many candidates | `invalid_flag_value` | same cap family as bench route count |

## 9. Objectives

Objectives are ranking strategies. They produce comparable per-candidate
results, but the runtime owns sorting, tie handling, persistence, and rendering.

Recommended TypeScript shape:

```ts
interface OptimizeObjective {
  name: "cost" | "latency";
  score_unit: "usd" | "ms";
  requires_bench: boolean;
  evaluate(input: OptimizeObjectiveInput): Promise<OptimizeObjectiveResult>;
}
```

The report contract is simpler if every objective follows the same rule:
**lower score is better**. Future objectives where higher is naturally better
must invert their score before returning it.

### 9.1 Cost Objective

The `cost` objective ranks routes by configured effective cost metadata.

The catalog `cost` object is a provider/model rate card, not the optimize
score itself. Rate cards are expressed in USD per 1 million tokens. The optimize
score is the estimated USD cost of a hypothetical reference token workload
against that rate card.

Inputs:

- candidate routes
- effective cost, where route `cost` overrides model `cost`
- reference token workload:
  - `input_tokens`, default `1000`
  - `output_tokens`, default `1000`
  - `cache_read_tokens`, default `0`
  - `cache_write_tokens`, default `0`

Formula:

```text
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

The unit is estimated USD for the reference token workload. It is not a provider
pricing unit and it is not the amount spent to run the optimization command. The
cost object does not currently carry a currency field, so the UI/report must
label this as an estimate based on the operator-maintained catalog values.

#### Cost Score Interpretation

The human-readable cost ranking table uses `SCORE_USD` to match the generic
report fields `score` and `score_unit = "usd"`. For the cost objective,
`SCORE_USD` means estimated USD for the selected reference token workload.

`SCORE_USD` does not mean:

- the raw catalog rate-card value
- a provider pricing unit
- the amount spent to run `switchmaxxer optimize`

Changing `--input-tokens`, `--output-tokens`, `--cache-read-tokens`, or
`--cache-write-tokens` changes the reference token workload and therefore
changes `SCORE_USD`.

Disqualification:

- a candidate without effective cost is disqualified with
  `missing_effective_cost`
- if all candidates are disqualified, the run fails with
  `optimize_objective_no_data`

The `cost` objective must not call upstream providers and must not invoke bench.

### 9.2 Latency Objective

The `latency` objective ranks routes by fresh benchmark measurements.

Inputs passed through to bench:

- resolved candidate route names
- `prompt` from `--prompt` or `--file`
- `iterations`
- `warmup`
- `concurrency`
- `path_mode`
- `timeout_ms`

The implementation must call the bench runtime's programmatic entry point. It
must not duplicate bench preflight, cancellation, sample insertion, synthetic
execution, or path-mode logic.

Scoring rule:

- group returned measured samples by `route_id`
- ignore warmup samples
- ignore failed samples for the median calculation
- score each route by median measured `latency_ms`
- disqualify a candidate if it has no successful measured samples

Do not compute latency ranking from `analysis.by_path`. That bench field is
path-oriented, not route-oriented. Optimize needs route-level ranking, so it
must use the returned sample rows.

The owned bench run should set:

- `created_by = "switchmaxxer optimize"` for CLI
- `created_by = "switchmaxxer mcp optimize"` for MCP
- `objective = "route_optimization"`

Bench's own path fallback behavior applies unchanged. For example, if `--path
both` is requested and gateway preflight fails, bench may degrade to direct-only
with warnings. Optimize should surface those warnings without rewriting them.

### 9.3 Ties

Ties are deterministic:

1. lower score wins
2. exact score ties sort by route name lexicographically

The report should also carry `tied_with` for routes whose score equals the
winner score exactly. Future objectives may add an epsilon, but v1 should avoid
implicit fuzzy comparisons unless a concrete need appears.

## 10. Delegation To Bench

Latency optimize is a bench caller, not a bench fork.

Optimize may:

- call the same runtime path used by CLI `bench` and MCP `bench_run`
- pass candidate route names as bench `routes`
- pass the operator's prompt and execution knobs through unchanged
- read the returned `BenchmarkReportView`
- store the owned `benchmark_run_id` in the optimize result

Optimize must not:

- insert directly into `benchmark_runs`
- insert directly into `benchmark_samples`
- emit synthetic benchmark observations directly
- implement its own gateway preflight
- implement its own direct-upstream request logic
- change bench's `surface: "benchmark"` observation marker

If the existing bench runtime does not expose a clean programmatic entry point
at implementation time, add one there first. Do not call CLI code by shelling
out to `switchmaxxer bench`.

## 11. Persistence

Optimize v1 adds a command-history table named `optimization_runs`.

Current columns:

```sql
CREATE TABLE IF NOT EXISTS optimization_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  created_by TEXT NOT NULL,
  target_model TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  winner_route TEXT,
  benchmark_run_id TEXT,
  settings_json TEXT NOT NULL,
  candidate_snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL
);
```

Current indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_optimization_runs_created_at
  ON optimization_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_optimization_runs_benchmark_run_id
  ON optimization_runs(benchmark_run_id);
```

Status values:

- `running`
- `completed`
- `failed`
- `cancelled`

`benchmark_run_id` should be a soft reference in v1. Optimize reports must
remain readable even if retention later prunes the owned benchmark run.

`candidate_snapshot_json` must be secret-safe. It should include only the
minimal candidate data needed to explain a historical decision:

- route id
- model id
- service provider id
- provider model id
- display name
- api mode
- effective timeout
- effective cost

Do not store provider API keys, raw secrets, or unredacted loaded config.

Relationship to existing `optimization_facts`:

- `optimization_runs` records operator-invoked optimize decisions
- `optimization_facts` remains per-request derived telemetry
- optimize v1 does not need to write `optimization_facts`
- future live route policies may populate `optimization_facts` with
  `optimization_profile_id` or equivalent policy context

Optimize apply/restore also writes generic config mutation history. These
tables are intentionally not optimize-specific; future config-changing
commands can reuse the same event/snapshot lifecycle.

Managed catalog snapshots are secret-aware. The stored `content_json` is the
pre-mutation catalog document with inline provider `api_key` values masked
before persistence. `content_sha256` and `content_bytes` describe that redacted
snapshot content, not the raw source file bytes. Restore uses the structured
mutation history rather than replacing the whole catalog with the stored
snapshot.

```sql
CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_bytes INTEGER NOT NULL,
  retention_expires_at TEXT,
  CHECK (content_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS config_mutation_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  optimization_run_id TEXT,
  snapshot_id TEXT,
  parent_event_id TEXT,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  CHECK (source_surface IN ('cli', 'mcp')),
  CHECK (operation IN ('optimize_apply', 'optimize_restore', 'manual_config_edit')),
  CHECK (status IN ('succeeded')),
  CHECK (target_kind IN ('route'))
);

CREATE TABLE IF NOT EXISTS control_plane_action_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  created_by TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  session_id TEXT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  optimization_run_id TEXT,
  mutation_event_id TEXT,
  correlation_ids_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  error_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  CHECK (source_surface IN ('cli', 'mcp')),
  CHECK (actor_kind IN ('operator', 'agent', 'system', 'unknown')),
  CHECK (operation IN ('optimize_apply', 'optimize_restore')),
  CHECK (status IN ('started', 'succeeded', 'failed', 'noop', 'dry_run_succeeded', 'dry_run_failed')),
  CHECK (target_kind IN ('route'))
);
```

For optimize:

- `control_plane_action_events.operation = "optimize_apply"` or
  `"optimize_restore"` records the attempted control-plane action
- `control_plane_action_events.status` distinguishes committed success, failure,
  no-op, and dry-run outcomes
- restore attempts selected by apply action id may start before the target route
  and run id are known; once the restore point is resolved, the finished Ledger
  row is updated with `target_id` and `optimization_run_id`
- `config_mutation_events.operation = "optimize_apply"` or
  `"optimize_restore"` records only effective committed provider mutations
- `config_mutation_events.status` is constrained to `"succeeded"`; failed,
  no-op, and dry-run outcomes are Ledger statuses, not mutation-history statuses
- `optimization_run_id` keeps the recommendation run id attached to both the
  attempt ledger and committed mutation history
- `mutation_event_id` links a successful effective ledger action to its committed
  mutation row
- `snapshot_id` points at the pre-mutation catalog snapshot stored in SQLite
- `parent_event_id` is set on restore mutation rows and points at the apply
  action id
- general control-plane action events, config mutation events, and snapshots are
  pruned through the whole-store observability prune lifecycle
- optimize-history cleanup may delete optimize-owned committed mutation records
  and orphaned managed snapshots because those rows are restore data for
  optimize history
- optimize-history cleanup must not delete unrelated config mutation records,
  control-plane action events, or snapshots still referenced by remaining events

## 12. Report Shape

`buildOptimizeReportView()` should produce:

```ts
interface OptimizeReportView {
  store_path?: string;
  run: {
    run_id: string;
    created_at: string;
    finished_at: string | null;
    created_by: string;
    status: "running" | "completed" | "failed" | "cancelled";
    target_model: string;
    objective: "cost" | "latency";
  };
  candidates: {
    requested_routes: string[] | null;
    resolved_routes: string[];
    disqualified: Array<{
      route_id: string;
      reason: string;
      message: string;
    }>;
  };
  ranking: OptimizeRankingEntry[];
  winner: {
    route_id: string;
    score: number;
    score_unit: string;
    tied_with: string[];
  } | null;
  bench: {
    run_id: string;
    summary: Record<string, unknown>;
    execution: Record<string, unknown>;
  } | null;
  warnings: OptimizeWarning[];
}

interface OptimizeWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

`OptimizeRankingEntry`:

```ts
interface OptimizeRankingEntry {
  rank: number | null;
  route_id: string;
  display_name: string | null;
  score: number | null;
  score_unit: string;
  objective: string;
  details: Record<string, unknown>;
  disqualified: {
    reason: string;
    message: string;
  } | null;
}
```

For `cost`, `details` should include:

- `reference_tokens`
- `effective_cost`
- `estimated_cost`
- whether route-level cost or model-level cost supplied the value

For `latency`, `details` should include:

- measured sample count
- failed measured sample count
- median latency
- average latency
- min/max latency
- per-path latency summaries for that route

Text output should be a compact operator report:

1. run id, model, objective, and status
2. candidate count and any disqualifications
3. column-aligned ranking table
4. winner line
5. owned bench run id for latency runs
6. warnings

Do not re-render the full bench report inside optimize text output. Operators
can run `switchmaxxer bench show <benchmark-run-id>` for sample-level detail.

## 13. Cancellation

The CLI should mirror bench cancellation:

1. install one `SIGINT` listener for the duration of the optimize run
2. abort in-flight objective evaluation
3. if a latency run has delegated to bench, propagate abort to bench and let
   bench perform its own drain behavior
4. mark the optimize run `cancelled`
5. exit with code `130`

The MCP tool should wire the session abort signal and enforce a wall-clock cap,
following the `bench_run` precedent. The recommended env var is:

```text
SWITCHMAXXER_MCP_OPTIMIZE_RUN_MAX_DURATION_MS
```

A cancelled latency optimization may leave an owned bench run with partial
samples, exactly as bench cancellation does. `optimize show` should render any
partial data that was persisted and clearly mark the optimize run cancelled.

## 14. Error Codes

Use operation-specific app error codes rather than overloading unrelated bench
or trace codes. Provider apply currently reuses `optimize_error` for stale-run
or mutation failures rather than adding a separate apply code.

Recommended additions:

| Code | Meaning |
|---|---|
| `optimize_error` | general optimize execution failure |
| `optimize_list_error` | list failure |
| `optimize_show_error` | show failure |
| `optimize_not_found` | requested optimize run does not exist |
| `optimize_no_candidates` | target model has no candidate routes |
| `optimize_insufficient_candidates` | fewer than two candidate routes |
| `optimize_route_model_mismatch` | explicit route does not target selected model |
| `optimize_objective_no_data` | no candidate can be scored for the selected objective |

Surface mapping:

| Surface | Failure | Code family | Exit/result |
|---|---|---|---|
| CLI `optimize` | usage and validation | existing usage codes | exit 2 |
| CLI `optimize` | unknown model or route | existing entity-state codes | exit 1 |
| CLI `optimize` | candidate/objective failure | optimize-specific code | exit 1 |
| CLI `optimize` | bench delegation failure | bench code where specific, otherwise `optimize_error` | exit 1 |
| CLI `optimize` | cancellation | `optimize_error` with cancel details | exit 130 |
| CLI `optimize list` | execution failure | `optimize_list_error` | exit 1 |
| CLI `optimize show` | missing run | `optimize_not_found` | exit 1 |
| CLI `optimize apply` | missing run | `optimize_not_found` | exit 1 |
| CLI `optimize apply` | missing target route or winner provider | existing entity-state codes | exit 1 |
| CLI `optimize apply` | stale run, auth, validation, or mutation failure | `optimize_error` or specific auth/config code where available | exit 1 |
| CLI `optimize apply` | post-action reload failure with `--reload` | success envelope with `reload.status = "failed"` and warnings | exit 1 |
| CLI `optimize apply` | post-action route verification failure with `--verify` | success envelope with `verification.status = "failed"` and warnings | exit 1 |
| CLI `optimize restore` | missing restore point | `optimize_not_found` | exit 1 |
| CLI `optimize restore` | missing target route or restore provider | existing entity-state codes | exit 1 |
| CLI `optimize restore` | stale restore point, auth, validation, or mutation failure | `optimize_error` or specific auth/config code where available | exit 1 |
| CLI `optimize restore` | post-action reload failure with `--reload` | success envelope with `reload.status = "failed"` and warnings | exit 1 |
| CLI `optimize restore` | post-action route verification failure with `--verify` | success envelope with `verification.status = "failed"` and warnings | exit 1 |
| CLI `optimize prune` | missing or invalid `--older-than` | existing usage codes | exit 2 |
| CLI `optimize prune` | execution failure | `optimize_error` | exit 1 |
| CLI `optimize delete` | missing `<run-id>` | existing usage codes | exit 2 |
| CLI `optimize delete` | missing run | `optimize_not_found` | exit 1 |
| CLI `optimize delete` | execution failure | `optimize_error` | exit 1 |
| CLI `optimize clear` | execution failure | `optimize_error` | exit 1 |
| MCP `optimize_run` | any domain failure | same payload family as CLI JSON | tool result error envelope |
| MCP `optimize_apply` | missing run, stale run, auth, validation, or mutation failure | same payload family as CLI JSON | tool result error envelope |
| MCP `optimize_restore` | missing restore point, stale restore point, auth, validation, or mutation failure | same payload family as CLI JSON | tool result error envelope |

A completed optimize run with one disqualified candidate is not an envelope-level
error when at least one other candidate can be ranked. If all candidates are
disqualified, the run fails with `optimize_objective_no_data`.

## 15. Tests

Recommended unit tests:

- `optimize-candidate-selection.test.ts`
  - unknown model
  - no candidates
  - explicit route not found
  - route/model mismatch
  - dedupe and cap behavior
- `optimize-objective.test.ts`
  - cost formula
  - model cost fallback
  - route cost override
  - missing effective cost disqualification
  - latency scoring from benchmark samples grouped by route
- CLI optimize tests
  - default run command parsing
  - list/show registry behavior
  - prune/delete/clear argument parsing and JSON envelopes
  - prune/delete/clear remove optimize-owned records while preserving unrelated
    observability/config-mutation records
  - text renderer column alignment
  - JSON success/error envelopes
  - SIGINT cancellation path
- MCP optimize tests
  - schema validation
  - capability gating
  - parser parity with CLI
  - abort signal and wall-clock timeout
- observability persistence tests
  - create/update optimization run status
  - list newest-first with limit cap
  - show report from persisted JSON
  - benchmark soft-reference behavior
  - delete one optimize run and its optimize-owned committed mutation
    records/snapshots while leaving control-plane action events under
    whole-store retention
  - prune optimize-history by cutoff without pruning benchmark rows
  - clear optimize-history without deleting non-optimize config mutation events
    or control-plane action events

Recommended integration tests:

- cost optimize over fixture catalog, no network, no bench rows
- latency optimize over fake/stubbed upstream, exactly one owned bench run
- CLI/MCP envelope equivalence for the same logical optimize request
- whole-store prune behavior leaves optimize reports readable when an owned bench
  run is gone
- optimize-history cleanup leaves non-optimize observability records intact
- CLI/MCP apply and restore attempts write `control_plane_action_events` rows
  for dry-run, failed, no-op, and committed outcomes

## 16. Boundaries

The optimize subsystem must not:

- mutate `catalog.json` during optimize run/list/show
- mutate any route field except `service_provider` through provider apply
- invent route aliases or hidden route rewrites
- write directly to `benchmark_runs` or `benchmark_samples`
- duplicate bench HTTP execution, preflight, path planning, or cancellation
- store provider API keys or raw loaded config in optimize-history records
- rank by model quality unless a separate evaluation subsystem exists
- scrape provider pricing at runtime
- make optimization decisions in the gateway hot path

The optimize subsystem may:

- read the loaded config/catalog read model
- read effective route/model cost metadata
- call the bench runtime for measurement-based objectives
- persist optimize command history in `optimization_runs`
- persist apply/restore attempt history in `control_plane_action_events`
- persist committed apply/restore mutation history in `config_mutation_events`
  and managed catalog snapshots in `config_snapshots`
- delete optimize-owned command history through explicit optimize-history cleanup
  commands
- store a secret-safe candidate snapshot for auditability
- surface owned bench run ids for drill-down
- mutate one target route's `service_provider` through explicit CLI provider
  apply/restore

## 17. Future Work

Reserved future work:

- **Module splits**: if optimize grows enough to need smaller internal units,
  candidate selection, objective scoring, report shaping, or persistence can
  split into dedicated modules such as `optimize-candidate-selection.ts`,
  `optimize-objective.ts`, `optimize-report.ts`, or
  `optimize-persistence.ts`.
- **Rollback-on-fail**: add an optional `--rollback-on-fail` mode for apply
  reload/verify failures. This should create an explicit restore event rather
  than silently rewriting config.
- **Balanced objective**: combine normalized latency and cost with explicit
  weights. This should require both cost metadata and fresh bench data.
- **TTFT objective**: rank streaming-heavy routes by measured time to first
  token from benchmark samples.
- **Historical-window objective**: rank from existing request executions or
  optimization facts over a time window. This must label provenance clearly
  because historical traffic is not as controlled as a fresh bench run.
- **Model-agnostic optimization**: find the best route for an objective without
  requiring `--model`. This is deliberately deferred because it changes the
  problem shape from "best route for one canonical model" to "best route across
  the whole catalog." Cost-only scans may be cheap enough when every route has
  effective cost metadata, but latency scans could benchmark hundreds of
  routes, providers, and models, creating real provider spend, quota pressure,
  long runtimes, noisy comparisons, and hard-to-explain quality differences.
  Any future design needs explicit candidate caps, allow/deny selectors,
  budget limits, model-family filters, objective-specific defaults, and clear
  report language that model quality was not evaluated unless a separate
  evaluation subsystem is involved.
- **Policy profiles**: if Switchmaxxer later adds live policy routing, connect
  policies to `optimization_facts` rather than overloading optimize command
  history.
