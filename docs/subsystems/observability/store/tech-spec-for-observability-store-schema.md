# Switchmaxxer Observability Store Schema Tech Spec

## Purpose

This document summarizes the current SQLite schema used by the observability store.

The authoritative implementation is:

- [src/subsystems/observability/schema.ts](../../../../src/subsystems/observability/schema.ts)
  public facade backed by
  [src/subsystems/observability/ostrich/store/schema.ts](../../../../src/subsystems/observability/ostrich/store/schema.ts)

## Current Metadata Tables

- `store_metadata`
- internal schema bookkeeping tables used by the current bootstrap code

## Current Data Tables

### `observations`

Canonical persisted telemetry rows. These hold:

- request and trace identifiers
- lifecycle event names
- route/provider/model identity
- timing fields
- token and byte counts
- status/outcome data
- optional benchmark/optimization tags

### `request_executions`

Derived per-request summaries built from observations.

These hold:

- request timing milestones
- route/provider/model identity
- outcome and failure-stage data
- observation count
- latency breakdown fields
- token and cost rollups

### `benchmark_runs`

One row per benchmark run.

### `benchmark_samples`

One row per benchmark sample.

Important current FK behavior:

- `request_execution_id -> request_executions(id) ON DELETE CASCADE`

### `optimization_runs`

One row per operator-invoked optimize command. This is command-history state for
`switchmaxxer optimize`, `optimize list`, and `optimize show`, not per-request
telemetry.

### `config_snapshots`

Managed pre-mutation config snapshots. Optimize apply/restore currently writes
catalog snapshots here instead of leaving optimize-specific backup files in the
workspace. Snapshot content is stored as secret-safe JSON: inline provider
`api_key` values are masked before persistence, and the stored hash/byte count
refer to the redacted content.

### `config_mutation_events`

Committed config mutation history. Optimize apply/restore records effective
provider mutations here with action ids, snapshot references, and parent links
for restore actions. Failed attempts, dry-runs, and no-op attempts are not
restore points; they are recorded in `control_plane_action_events`.

Current event rows constrain `source_surface`, `operation`, `status`, and
`target_kind` to the known mutation-history vocabulary. The current optimize
writers create `succeeded` rows for committed provider changes.
`config_mutation_events.status` is intentionally constrained to `succeeded`
because this table is committed mutation history, not attempt history. Failed,
no-op, and dry-run outcomes live in `control_plane_action_events`.

### `control_plane_action_events`

The Control Plane Audit Ledger. These rows record CLI and MCP control-plane
attempts, including started, succeeded, failed, no-op, and dry-run outcomes.
Model/provider/route mutations and optimize apply/restore write ledger rows for
both CLI operators and MCP agents.

For the full Ledger concept, operator workflows, and agent integration use
cases, see
[tech-spec-for-control-plane-audit-ledger.md](../contracts/tech-spec-for-control-plane-audit-ledger.md).

Successful optimize apply/restore mutations link to `config_mutation_events`
through `mutation_event_id`. Generic model/provider/route mutation attempts and
attempts that do not commit an optimize config mutation keep
`mutation_event_id = NULL` and store their result or error envelope in JSON
columns.

Config mutation lifecycle policy:

- general `control_plane_action_events`, `config_mutation_events`, and
  `config_snapshots` are part of
  whole-store observability retention
- they are pruned by `switchmaxxer prune --older-than <duration>`, by MCP
  `prune`, and by configured automatic retention in the gateway runtime
- feature-specific cleanup commands must not delete unrelated config mutation
  history
- optimize-history cleanup is the current narrow exception:
  `switchmaxxer optimize prune`, `switchmaxxer optimize delete`, and
  `switchmaxxer optimize clear` may delete optimize-owned committed mutation
  records and orphaned managed snapshots because those rows are restore data for
  optimize history. Control-plane ledger rows are retained by whole-store
  retention rather than feature-specific cleanup.

### `optimize_mutation_idempotency`

Optimize mutation dispatch has a small idempotency table for JSON-safe
`optimizeMutations.apply` and `optimizeMutations.restore` command payloads.
Current CLI and MCP apply/restore flows use it through an internal planned
mutation bridge. Public framed external apply/restore operation frames are
still rejected before transport, but the same table is the replay substrate
those frames would use if Osprey/Owl execution is enabled later.

Current fields:

- `idempotency_key TEXT PRIMARY KEY`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `finished_at TEXT`
- `operation TEXT NOT NULL`
- `command_digest TEXT NOT NULL`
- `status TEXT NOT NULL`
- `control_plane_action_id TEXT`
- `result_json TEXT NOT NULL`
- `error_json TEXT NOT NULL`

Current constraints:

- `operation IN ('optimizeMutations.apply', 'optimizeMutations.restore')`
- `status IN ('accepted', 'completed', 'failed', 'unknown')`
- `control_plane_action_id -> control_plane_action_events(id) ON DELETE SET NULL`

This table stores replay guarantees for JSON-safe optimize mutation commands.
It should not replace the Ledger: `control_plane_action_events` remains the
operator-facing audit trail, while this table answers whether a retried command
is the same accepted intent, a completed replay, a known failure replay, or an
unknown completion that must not execute again.

`command_digest` is a digest of stable mutation intent, not every descriptive
field in the command payload. The digest intentionally excludes
`idempotency_key` and volatile `catalog` context. This allows a retry after a
successful mutation to replay the completed result even though the current
catalog context now reflects the already-applied change. Fields that change
the requested operation, such as apply run, target route, restore selector,
dry-run mode, reload/verification flags, actor/session metadata, or source
surface, remain part of the digest and reject mismatched retries.

### `cost_facts`

Persisted cost facts linked to request executions.

Important current FK behavior:

- `request_execution_id -> request_executions(id) ON DELETE CASCADE`

### `optimization_facts`

Persisted optimization-oriented facts linked to request executions.

Important current FK behavior:

- `request_execution_id -> request_executions(id) ON DELETE CASCADE`

## Current Indexes

The schema includes indexes for:

- observation time
- observation request correlation
- observation kind/event scans
- request-execution route/provider/outcome scans
- benchmark sample run ordering
- optimization run created-time scans
- control-plane action created-time, operation/target, optimize-run, and
  mutation-event scans
- cost-fact provider/time scans
- optimization-fact route/time scans

## Current Pre-Release Posture

The current schema version is `8`. New stores are created directly from the
current schema, and bootstrap carries narrow in-place migrations for supported
older development stores through version 8.

That means:

- the code carries the current schema directly for new stores
- supported older development stores may be migrated by startup bootstrap
- incompatible store versions fail closed instead of being deleted or silently
  rewritten
- this document describes the schema as it exists now

For field-level meaning, also see:

- [field-matrix-for-observability-store.md](field-matrix-for-observability-store.md)
- [tech-spec-for-observation-semantics.md](../contracts/tech-spec-for-observation-semantics.md)
