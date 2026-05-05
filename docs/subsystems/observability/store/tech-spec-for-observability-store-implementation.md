# Switchmaxxer Observability Store Implementation Tech Spec

## Purpose

This file records the implementation shape of the observability store.

Use it when:

- mapping the codebase to the observability data model
- checking where persistence, derivation, and maintenance logic live
- onboarding to the store implementation without reading the whole source tree first

## Code Map

Primary files:

- [src/subsystems/observability/schema.ts](../../../../src/subsystems/observability/schema.ts)
  public schema facade backed by
  [src/subsystems/observability/ostrich/store/schema.ts](../../../../src/subsystems/observability/ostrich/store/schema.ts)
- [src/subsystems/observability/store.ts](../../../../src/subsystems/observability/store.ts)
  public store facade backed by
  [src/subsystems/observability/ostrich/store/store.ts](../../../../src/subsystems/observability/ostrich/store/store.ts)
- [src/subsystems/observability/service.ts](../../../../src/subsystems/observability/service.ts)
- [src/subsystems/observability/request-executions.ts](../../../../src/subsystems/observability/request-executions.ts)
  public request-execution DTO facade backed by
  [src/subsystems/observability/ostrich/query/request-executions.ts](../../../../src/subsystems/observability/ostrich/query/request-executions.ts)
- [src/subsystems/observability/gateway.ts](../../../../src/subsystems/observability/gateway.ts)
- [src/subsystems/observability/runtime-loader.ts](../../../../src/subsystems/observability/runtime-loader.ts)
  public runtime construction facade for the default Ostrich store/service

## Bootstrap Shape

Bootstrap responsibilities:

- open or create the SQLite DB
- enable foreign keys
- enable WAL
- apply the current schema statements for new stores
- run the narrow in-place migrations that the current bootstrap owns
- seed store metadata

Schema posture:

- the current schema version is `8`
- new stores are created directly at the current schema
- existing development stores from supported versions are migrated in place for
  the historical additions through schema version 8, including
  `attributes_truncated`, `optimization_runs`, config mutation history, the
  Control Plane Audit Ledger, config-mutation audit constraints, and
  `optimize_mutation_idempotency`
- incompatible schema versions still fail closed at open time instead of being
  reset automatically

Future technical debt:

- add an explicit `switchmaxxer observability migrate` command before the
  observability store is treated as a durable operator-facing upgrade surface
- that future command should own broader operator-facing schema-upgrade behavior
  instead of letting startup bootstrap become a general migration framework
- add the fixed approved observability data-root allowlist tracked in [docs/backlog.md](../../../backlog.md), especially before wider long-lived service-manager deployment guidance

Observability DB path posture:

- the default observability DB path is `.switchmaxxer/observability.sqlite` under the current working directory
- the default parent is created as a private directory and the DB/WAL/SHM files are tightened to owner-only mode
- `SWITCHMAXXER_OBSERVABILITY_DB` remains a trusted local operator override, not an untrusted network input
- all live surfaces resolve that override through the shared observability runtime loader before opening the SQLite store
- the runtime-loader policy requires a normal SQLite filename suffix: `.db`, `.sqlite`, or `.sqlite3`
- the nearest existing parent must be a real directory, not a symlink, owned by the current user, and not group- or world-writable
- if the DB path already exists, it must be a regular file, not a symlink, owned by the current user, and inaccessible to group/other users
- the store repeats the parent and existing-file checks before SQLite opens the DB so worker/direct store callers cannot bypass the safety posture
- the current implementation does not yet constrain the override to a fixed data-root allowlist; that follow-up is tracked as a hardening roadmap item

## Ingestion Path

Request-path persistence flow:

1. gateway runtime emits observations
2. observability service persists observation rows
3. request-execution summaries are materialized from observations
4. benchmark and other derived facts are stored in sibling tables

Hot-path tuning:

- debug-only shaping is skipped when debug logging is off
- transport and timeout handling are shared
- request-execution work is cheaper than the original per-event materialization path

Cold-path note:

- stored observability JSON view-shaping now routes through the shared bounded JSON parser instead of raw `JSON.parse`
- that means the current implementation pays for parse plus a bounds walk on this read-model path
- this is intentional safety-over-efficiency tradeoff on a cold path today
- if stored-JSON parsing ever moves onto a hot path, that extra structural walk should be revisited as performance tech debt

## Maintenance Path

Store maintenance supports:

- `verify`
- `repair`
- `prune`

Important behavior:

- `repair()` synthesizes post-repair verification instead of re-running a second expensive verify pass
- whole-store verify/repair uses batching
- whole-store repair uses keyset pagination over `request_id`, not offset
  pagination, so deleting orphan summaries cannot shift later rows out of the
  repair walk
- CLI and MCP both expose batch-size controls for whole-store maintenance

## Integrity Rules

- child facts that reference `request_executions(id)` use `ON DELETE CASCADE`
- prune still deletes in explicit dependency order at the application layer
- the DB now also enforces the dependency directly

## Retention Model

Retention entry points:

- explicit prune through CLI and MCP
- startup prune when retention is configured
- periodic prune in the long-running gateway when retention is configured

Control-plane audit history and config mutation history follow this whole-store
retention model by default. General `control_plane_action_events`,
`config_mutation_events`, and `config_snapshots` are not cleaned up by
feature-specific history commands.

The current exception is optimize-history cleanup:
`switchmaxxer optimize prune`, `switchmaxxer optimize delete`, and
`switchmaxxer optimize clear` may delete optimize-owned committed mutation
records and managed snapshots that become orphaned by those deletions. That
exception exists because those rows are restore data for optimize history, not
because feature cleanup commands are allowed to sweep arbitrary config mutation
rows. The Control Plane Audit Ledger (`control_plane_action_events`) remains
under whole-store retention.

## Test Coverage

Primary regression file:

- [src/subsystems/observability/observability.test.ts](../../../../src/subsystems/observability/observability.test.ts)

Coverage includes:

- persistence
- request-execution materialization
- prune behavior
- cascade behavior
- batch verify/repair behavior
- deletion-heavy whole-store repair across batch boundaries
- transport-abort behavior relevant to observability-backed flows
