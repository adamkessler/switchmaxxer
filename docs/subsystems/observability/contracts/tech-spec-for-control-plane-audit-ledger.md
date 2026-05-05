# Tech Spec for Control Plane Audit Ledger

## 1. Purpose

The Control Plane Audit Ledger is the observability record for control-plane
attempts made through Switchmaxxer surfaces such as the CLI and MCP.

The current storage table is:

- `control_plane_action_events`

The Ledger answers:

- who or what attempted a control-plane action
- which surface initiated it
- which model, provider, route, or optimize run it touched
- whether the attempt succeeded, failed, no-opped, or ran as a dry-run
- which committed optimize config mutation resulted from the attempt, when one
  exists
- which structured result or error envelope explains the outcome

The Ledger is part of the observability subsystem. It sits near the end of the
current capability chain:

```text
observation -> trace -> benchmark run -> optimize run -> control-plane action
```

Benchmarking builds on request execution and tracing machinery. Optimizing
builds on benchmark and persisted observability machinery. Apply/restore
actions build on optimize reports and write Ledger rows for operator and agent
attempt history. Model, provider, and route CRUD actions also write Ledger
rows, so routine catalog changes and rejected mutation attempts can be inspected
from one place.

## 2. Current Scope

Current Ledger producers:

- CLI `switchmaxxer models create/update/delete`
- CLI `switchmaxxer providers create/update/delete/set-key/clear-key/set-key-env`
- CLI `switchmaxxer routes create/update/delete`
- CLI `switchmaxxer optimize apply`
- CLI `switchmaxxer optimize restore`
- MCP `models_create/update/delete`
- MCP `providers_create/update/delete/set_key/clear_key/set_key_env`
- MCP `routes_create/update/delete`
- MCP `optimize_apply`
- MCP `optimize_restore`

Current Ledger lifecycle:

- rows are persisted in the local observability SQLite store
- generic config mutation audit is best-effort: a ledger write failure is
  reported as an operator warning, but it does not turn an otherwise valid local
  catalog mutation into a failed mutation
- rows are pruned by whole-store retention through `switchmaxxer prune`, MCP
  `prune`, and configured gateway observability retention
- optimize-history cleanup does not remove Ledger rows; it may remove
  optimize-owned committed mutation rows and orphaned snapshots because those
  rows are restore data for optimize history

Current dedicated Ledger read surface:

- CLI `switchmaxxer ledger list`
- CLI `switchmaxxer ledger show <ledger-event-id>`
- MCP `ledger_list`
- MCP `ledger_show`

Ledger reads are deliberately scoped. They inspect control-plane action events
only, use summary rows for list results, require explicit `show` for full
result/error/metadata envelopes, and are privileged in MCP because audit history
reveals operational details.

## 3. Core Vocabulary

| Term | Meaning |
|---|---|
| **Control Plane Audit Ledger** | The audit history for control-plane attempts |
| **Ledger** | Short name for the Control Plane Audit Ledger |
| **control-plane action event** | One `control_plane_action_events` row |
| **Ledger event id** | The `control_plane_action_events.id` value for a control-plane attempt |
| **optimize action id** | The `config_mutation_events.id` value returned by successful optimize apply/restore mutations as `action_id` |
| **source surface** | The interface that initiated the action, currently `cli` or `mcp` |
| **actor** | The initiating party category, such as operator or agent |
| **operation** | The attempted action, such as `models_update`, `providers_set_key`, `routes_create`, `optimize_apply`, or `optimize_restore` |
| **attempt outcome** | The Ledger status: `started`, `succeeded`, `failed`, `noop`, `dry_run_succeeded`, or `dry_run_failed` |
| **target kind** | The entity family touched by the attempt: `model`, `provider`, or `route` |
| **target id** | The concrete model, provider, or route id touched by the attempt |
| **mutation event id** | Link from successful optimize apply/restore Ledger rows to the committed `config_mutation_events` row; this matches the optimize `action_id` |
| **committed mutation** | An optimize apply/restore config change recorded in `config_mutation_events` |
| **dry-run** | A simulated action that records attempt evidence but does not mutate config |
| **no-op** | A valid action whose target already matched the requested final state |

Avoid using `config_mutation_events` as a generic attempt log. That table is
committed mutation history only. Failed attempts, dry-runs, and no-op outcomes
belong in the Ledger.

## 4. Relationship To Other Observability Entities

### Observations And Traces

Observations are the smallest persisted telemetry facts. Traces are grouped
request stories built from observations.

The Ledger does not replace request tracing. It records control-plane action
attempts: actions that inspect, apply, restore, or otherwise govern gateway
state.

### Benchmark Runs

Benchmark runs measure route behavior and usually generate request execution
and trace data underneath.

Latency optimize runs use benchmark machinery as a subroutine. The Ledger does
not record benchmark samples; it records later control-plane attempts that may
apply an optimize winner.

### Optimize Runs

Optimize runs are persisted recommendation reports in `optimization_runs`.

Ledger rows may reference an optimize run through `optimization_run_id`. This
answers questions such as:

- which recommendation justified this apply attempt
- whether this restore is connected to an earlier apply
- whether a failure came from stale or missing optimize history

### Config Mutation Events

`config_mutation_events` is committed mutation history for optimize
apply/restore. It records effective optimize changes that can serve as restore
points.

The split is:

| Scenario | Ledger Row | Config Mutation Row |
|---|---|---|
| Model/provider/route create succeeds | yes, `succeeded` | no |
| Model/provider/route update validation fails | yes, `failed` | no |
| Provider secret action succeeds | yes, `succeeded` | no |
| Dry-run apply succeeds | yes, `dry_run_succeeded` | no |
| Apply validation fails | yes, `failed` | no |
| Apply is a no-op | yes, `noop` | no |
| Apply changes provider | yes, `succeeded` | yes, `succeeded` |
| Dry-run restore succeeds | yes, `dry_run_succeeded` | no |
| Restore changes provider | yes, `succeeded` | yes, `succeeded` |

Successful optimize apply/restore Ledger rows link to committed mutation rows
through `mutation_event_id`. Generic model/provider/route mutation Ledger rows
usually have `mutation_event_id = null`; their purpose is attempt visibility,
not restore-point storage.

### Config Snapshots

`config_snapshots` stores managed pre-mutation snapshots used by committed
mutation history. The Ledger does not store full config snapshots.

## 5. Current Table Contract

The authoritative schema is exposed through the public
[src/subsystems/observability/schema.ts](../../../../src/subsystems/observability/schema.ts)
facade backed by
[src/subsystems/observability/ostrich/store/schema.ts](../../../../src/subsystems/observability/ostrich/store/schema.ts).

Current table:

```sql
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
  CHECK (operation IN (
    'optimize_apply',
    'optimize_restore',
    'models_create',
    'models_update',
    'models_delete',
    'providers_create',
    'providers_update',
    'providers_delete',
    'providers_set_key',
    'providers_clear_key',
    'providers_set_key_env',
    'routes_create',
    'routes_update',
    'routes_delete'
  )),
  CHECK (status IN ('started', 'succeeded', 'failed', 'noop', 'dry_run_succeeded', 'dry_run_failed')),
  CHECK (target_kind IN ('model', 'provider', 'route'))
);
```

Current status meanings:

| Status | Meaning |
|---|---|
| `started` | The attempt has been opened and not yet completed |
| `succeeded` | The attempt completed successfully and, for mutation operations, committed an effective catalog or config change |
| `failed` | The attempt failed and did not commit a config mutation |
| `noop` | The attempt was valid but did not need to change config |
| `dry_run_succeeded` | The dry-run completed successfully without mutation |
| `dry_run_failed` | The dry-run failed without mutation |

## 6. Common Operator Workflows

### Platform Operator

A platform operator wants to know what changed in the gateway control plane.

Common questions:

- Was a model, provider, or route changed through CLI or MCP?
- Did a catalog mutation fail validation?
- Did a route provider change?
- Which optimize run recommended the change?
- Was the action applied by a person through CLI or by an MCP client?
- Is there a committed mutation id that can be restored?
- Did reload or verify happen after the change?

Useful Ledger filters:

- route id
- target id and target kind
- operation
- status
- recent time range
- source surface
- mutation event id

### SRE Or Incident Responder

An SRE wants to explain a live behavior change during an incident.

Common questions:

- Did routing change near the start of the incident?
- Did a model/provider/route mutation fail near the start of the incident?
- Did an apply fail because auth was missing?
- Did a restore happen after a bad provider switch?
- Are there repeated failed attempts against the same route?

Useful Ledger fields:

- `created_at`
- `finished_at`
- `operation`
- `status`
- `target_id`
- `error_json`
- `result_json`

The Ledger should make failed control-plane actions inspectable without turning
application logs into the only audit source.

### Security And Compliance Operator

A security or compliance operator wants accountability for privileged actions.

Common questions:

- Which actions came from MCP clients?
- Which actions came from human CLI operators?
- Did a dry-run mutate anything?
- Do optimize apply/restore mutations have matching control-plane attempts?
- Do successful optimize apply/restore Ledger rows link to committed mutation
  events?
- Are provider secret-management attempts visible without storing the secret?

Useful Ledger fields:

- `source_surface`
- `actor_kind`
- `actor_id`
- `session_id`
- `target_kind`
- `target_id`
- `mutation_event_id`
- `correlation_ids_json`

For an audit posture, the Ledger records attempts while `config_mutation_events`
records optimize restore-point evidence. This separation keeps intent evidence
separate from rollback evidence and avoids turning ordinary CRUD audit rows into
full config snapshots.

### FinOps Or Cost Operator

A cost operator wants to understand provider switches made for spend control.

Common questions:

- Which route changed because of a cost optimize run?
- What was the optimize run id?
- Did the change succeed, fail, or no-op?
- Was the recommendation applied to the same route or another route targeting
  the same model?

Useful relationships:

- `control_plane_action_events.optimization_run_id -> optimization_runs.id`
- `control_plane_action_events.mutation_event_id -> config_mutation_events.id`

### AI Ecosystem Integrator

An AI ecosystem integrator wires Switchmaxxer into agentic workflows, CI jobs,
or operational runbooks.

Common questions:

- Can an agent prove it only ran a dry-run?
- Can an agent show the optimize action id for a real apply?
- Can a follow-up task restore the exact provider binding changed earlier?
- Can a coordinator distinguish a failed auth preflight from a successful no-op?

The Ledger gives integration code a durable action record, not just terminal
text.

## 7. Common Agent Workflows

### Optimization Agent

An optimization agent can:

1. Run `optimize_run` for cost or latency.
2. Call `optimize_apply` with `dry_run = true`.
3. Inspect the returned action/result envelope.
4. Apply for real when policy allows.
5. Store the returned optimize action id.
6. Restore later through `optimize_restore` when rollback is required.

The agent should treat a `dry_run_succeeded` Ledger row as evidence of a safe
simulation, not as permission that a real apply will always succeed.

### Troubleshooting Agent

A troubleshooting agent can inspect recent action failures to decide the next
step.

Examples:

- inspect recent failed model/provider/route mutation attempts before retrying
- `route_not_found`: refresh config/catalog context or ask the operator for the
  correct route id
- stale optimize run: rerun optimize before applying
- missing auth: ask for credential setup or choose a route whose provider is
  authenticated
- gateway reload or verify failure in result metadata: report that config was
  changed but post-action validation needs attention

### Governance Agent

A governance agent can review control-plane activity for policy compliance.

Examples:

- flag MCP-originated applies outside an allowlisted route set
- detect repeated failed mutation attempts
- confirm that dry-runs did not create `config_mutation_events`
- confirm that successful applies have non-null `mutation_event_id`
- confirm that provider secret actions did not expose secret material in result
  or error envelopes
- summarize all control-plane activity for a daily operator report

### CI Or Release Agent

A CI or release agent can use the Ledger to prove a release script's behavior.

Examples:

- dry-run provider changes during a deployment preview
- apply a known optimize winner after a test gate passes
- restore a route provider during rollback
- attach optimize action ids and Ledger event ids to release logs

### Incident Response Agent

An incident response agent can correlate timeline events:

- request traces show failures or latency changes
- benchmark runs show degraded provider performance
- optimize runs show the recommended replacement
- Ledger rows show attempted catalog changes and apply/restore actions
- config mutation rows show committed optimize provider changes

This is the full observability chain working as a single evidence stream.

## 8. Read Surface Design Guidance

Dedicated Ledger read surfaces expose audit evidence without making operators
write SQL.

Current CLI shape:

```text
switchmaxxer ledger list [--route <route-id>] [--target <id>] [--target-kind <kind>] [--operation <operation>] [--status <status>] [--since <duration>] [--json]
switchmaxxer ledger show <ledger-event-id> [--json]
```

Current MCP shape:

```text
ledger_list
ledger_show
```

Current filters:

- `--route <route-id>` maps to `target_id` for route-targeted events
- `--target <id>`
- `--target-kind model|provider|route`
- `--operation <operation>`
- `--status started|succeeded|failed|noop|dry_run_succeeded|dry_run_failed`
- `--surface cli|mcp`
- `--run-id <optimization-run-id>`
- `--mutation-event-id <event-id>`
- `--since <duration>`
- `--limit <n>`

Useful CLI examples:

```bash
switchmaxxer ledger list --target-kind model --status failed --json
switchmaxxer ledger list --operation providers_update --since 24h
switchmaxxer ledger list --target local_mock --target-kind provider --json
switchmaxxer ledger show <ledger-event-id> --json
```

MCP `ledger_list` accepts the same filters in snake_case:

- `route_id`
- `target_id`
- `target_kind`
- `operation`
- `status`
- `source_surface`
- `session_id`
- `own_session`
- `run_id`
- `mutation_event_id`
- `since`
- `limit`

`own_session: true` constrains MCP results to the caller's current MCP session
id. This gives agents a simple way to inspect their own activity without
needing to know the concrete session id.

Current list output:

```text
CREATED_AT                LEDGER_EVENT_ID  SURFACE  OPERATION         STATUS             TARGET            RUN_ID
2026-04-27T20:10:00.000Z  ...              mcp      optimize_apply    dry_run_succeeded  route:gpt-4o-mini ...
2026-04-27T20:11:00.000Z  ...              cli      models_update     failed             model:gpt-4o-mini  -
```

Current show output includes:

- Ledger event id
- created/finished timestamps
- source surface and actor/session fields
- operation/status
- target kind and target id
- optimize run id
- mutation event id
- result envelope
- error envelope
- correlation ids
- metadata

The CLI and MCP readers share the same `control_plane_action_events` repository
query path. That keeps field names, filters, pagination, and error behavior
aligned.

## 9. Security And Privacy Requirements

Ledger rows must not store provider secrets or raw API keys.

Result, error, correlation, and metadata JSON should remain structured,
redacted, and safe to show in operator diagnostics. Error details should use the
same secret-redaction posture as other observability and CLI/MCP envelopes.

MCP clients are first-class actors in the Ledger. MCP-originated attempts should
be visible in the same table as CLI-originated attempts so operators can answer
"what did the agent try to do?" without joining separate audit systems.

## 10. Shared Idempotency Extraction Criteria

Optimize apply/restore currently has a dedicated
`optimize_mutation_idempotency` table and planned mutation bridge. That
boundary protects retries from duplicating committed optimize mutations or
successful Ledger rows, especially when CLI/MCP callers must run reload or
verification after the catalog write.

Do not extract this into a generic `control_plane_idempotency` primitive just
because the optimize path is now stable. Extraction is justified only when a
second mutation family needs the same behavior:

- a JSON-safe command envelope with a stable intent digest
- pre-mutation acceptance before a local catalog/config write
- replay of completed and failed terminal states
- an unknown-completion state that blocks unsafe retry execution
- caller-owned post-actions that must be folded into the replay payload
- a clear relationship between idempotency state, Ledger attempts, and any
  committed mutation history

Until those conditions exist outside optimize, keep the implementation
optimize-specific and treat it as a reference pattern. The Ledger remains the
operator-facing audit trail; idempotency rows are internal execution state.
Future shared extraction should preserve that split instead of turning the
Ledger into a retry table or making retry state the primary audit record.

## 11. Retention And Cleanup

Ledger rows are whole-store observability history.

Current retention paths:

- `switchmaxxer prune --older-than <duration>`
- MCP `prune`
- configured automatic gateway observability retention

Feature-specific cleanup should not silently remove Ledger rows. For example,
optimize-history cleanup may remove optimize run rows and optimize-owned
restore-point data, but Ledger attempt history remains under whole-store
retention.

This keeps audit evidence lifecycle explicit and predictable.

## 12. Source-Synchronous Pointers

Primary implementation files:

- [src/subsystems/observability/schema.ts](../../../../src/subsystems/observability/schema.ts)
  public schema facade backed by
  [src/subsystems/observability/ostrich/store/schema.ts](../../../../src/subsystems/observability/ostrich/store/schema.ts)
- [src/subsystems/observability/control-plane-actions.ts](../../../../src/subsystems/observability/control-plane-actions.ts)
  public DTO facade backed by
  [src/subsystems/observability/ostrich/ledger/control-plane-actions.ts](../../../../src/subsystems/observability/ostrich/ledger/control-plane-actions.ts)
- [src/subsystems/observability/config-mutation-audit.ts](../../../../src/subsystems/observability/config-mutation-audit.ts)
  public audit facade backed by
  [src/subsystems/observability/ostrich/ledger/config-mutation-audit.ts](../../../../src/subsystems/observability/ostrich/ledger/config-mutation-audit.ts)
- [src/subsystems/observability/optimize-orchestrator.ts](../../../../src/subsystems/observability/optimize-orchestrator.ts)
  public optimize mutation facade backed by
  [src/subsystems/observability/ostrich/optimization/optimize-orchestrator.ts](../../../../src/subsystems/observability/ostrich/optimization/optimize-orchestrator.ts)

Related docs:

- [tech-spec-for-observability-store-schema.md](../store/tech-spec-for-observability-store-schema.md)
- [tech-spec-for-optimize-command.md](tech-spec-for-optimize-command.md)
- [field-matrix-for-observability-store.md](../store/field-matrix-for-observability-store.md)
- [white-paper-on-observability-layer.md](../current/white-paper-on-observability-layer.md)
