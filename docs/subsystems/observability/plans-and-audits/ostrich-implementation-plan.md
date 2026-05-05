# Ostrich Implementation Plan

A behavior-preserving plan for shaping Switchmaxxer's current
TypeScript observability subsystem into **Ostrich**: the in-process,
default implementation of the modular observability contracts described
in
[tech-spec-for-modular-observability-subsystem.md](../current/tech-spec-for-modular-observability-subsystem.md).

This plan is intentionally conservative. Ostrich starts with the
ingestion boundary because that is the safest useful seam: gateway
producers can hand observations to a named interface while the existing
TypeScript/SQLite implementation continues doing the work underneath.

**Status update, 2026-05-14:** the implementation has reached the
observability equivalent of the hot-path end-of-Phase-5 state. The
initial ingestion-only plan expanded into an `ObservabilityModule` port
map for CLI/MCP-facing query, maintenance, benchmark, optimize, Ledger,
and control-plane audit workflows. Implementation-owned files now live
under `src/subsystems/observability/ostrich/`, root production files are
intentional facades/contracts/adapters, import-boundary checks guard the
Ostrich regions, and Osprey/Owl remain deferred. This document records
the conservative phase logic; the active root contract map and current
stopping point live in
[tech-spec-for-modular-observability-subsystem.md](../current/tech-spec-for-modular-observability-subsystem.md)
and
[observability-phase-5-framing.md](observability-phase-5-framing.md).

## Overview

### Goals

- Name Ostrich as the in-process TypeScript implementation of the
  observability subsystem.
- Establish an explicit ingestion boundary before touching query,
  maintenance, benchmark/optimize history, or Ledger behavior.
- Preserve current SQLite-backed storage, CLI/MCP behavior, retention,
  repair, and request-execution materialization.
- Keep Osprey/Owl IPC out of scope until Ostrich has a stable in-process
  contract.
- Use the coverage audit to choose phase order and identify required
  tests.

### Non-goals

- Building Osprey or Owl.
- Adding a generic plugin system.
- Changing the SQLite schema.
- Moving query, repair, prune, benchmark, optimize, or Ledger behavior
  behind new contracts in the first implementation pass.
- Changing gateway request semantics or observation records.
- Introducing a user-facing observability engine config switch.

### Current safety baseline

The Phase 0 audit is complete:
[observability-coverage-audit.md](observability-coverage-audit.md).

Headline:

- 53 observability source files audited.
- 88.12% aggregate line coverage.
- 76.40% aggregate branch coverage.
- Ingestion branch gaps for failure mapping, priority selection, worker
  state failure, shutdown drain behavior, and writer runtime behavior
  are covered.
- Remaining critical gaps are outside the first ingestion boundary:
  feature-specific history cleanup and optimize apply/restore branch
  complexity.

### Phases at a glance

| Phase | Risk | Effort | Dependencies |
|-------|------|--------|--------------|
| 0. Coverage audit and ingestion gap remediation | Low | complete | None |
| 1. Define module-port contract types | Low | complete | Phase 0 |
| 2. Add Ostrich adapters around current service paths | Low | complete | Phase 1 |
| 3. Route CLI/MCP surfaces through module ports | Medium | complete | Phase 2 |
| 4. Audit remaining direct service-handle usage | Low | complete | Phase 3 |
| 5. Plan and complete the Phase 5 carve-out boundary | Medium | complete | Phase 4 |

Phases 1-4 should be kept narrow. If a change wants to alter
request-execution materialization, trace query behavior, prune behavior,
benchmark/optimize history, or Ledger semantics, it belongs in a later
plan.

### Verification discipline

Every implementation PR should run:

- `npm run build`
- scoped observability tests:
  `node --enable-source-maps --test --test-force-exit dist/subsystems/observability/*.test.js`
- `git diff --check`

When docs links are part of the change, also run `npm run check:docs`.
As of the Phase 5 closure check on 2026-05-14, `npm run check:docs`
passes.

---

## Phase 0 — Coverage audit and ingestion gap remediation

**Risk:** low. Tests and documentation only.

Phase 0 answers whether the first Ostrich boundary can be ingestion. The
answer is yes, with current known ingestion branch gaps covered and the
type-only protocol module documented as a c8 artifact.

### Completed work

- Added the modular observability root spec.
- Added the Ostrich/Osprey/Owl hypothetical modules doc.
- Generated the observability coverage audit.
- Added focused tests for:
  - gateway failure stage/outcome mapping
  - gateway observation priority
  - worker state fatal/exit/pending-write behavior
  - shutdown drain success/failure/loss behavior
  - gateway writer runtime init/write/close/error behavior

### Exit criteria

- [x] Coverage audit exists.
- [x] Files are categorized by contract area.
- [x] Known ingestion branch gaps are covered.
- [x] First safe boundary is identified as ingestion.

---

## Phase 1 — Define module-port contract types

**Risk:** low. Pure additions.

**Status:** superseded and completed by the current
`ObservabilityModule` port map.

The original ingestion-only proposal is kept below as historical context
for why the plan started narrow.

## Historical Phase 1 — Define ingestion contract types

Add the smallest TypeScript contract needed for smx producers to talk to
the in-process observability ingestion implementation without depending
on queue/worker/SQLite details.

### Proposed location

```text
src/subsystems/observability/contract/
├── ingestion.ts
└── index.ts
```

### Proposed shape

Keep this contract intentionally small. It should model what producers
need, not every internal worker operation.

```ts
export interface ObservabilityIngestion {
  recordObservation(item: ObservabilityIngestionItem): Promise<ObservabilityIngestionResult>;
  recordBatch(items: ObservabilityIngestionItem[]): Promise<ObservabilityIngestionBatchResult>;
  drain(): Promise<ObservabilityIngestionDrainResult>;
}
```

The contract should wrap existing types where possible:

- `ObservationRecord`
- `RecordObservationOptions`
- `RecordObservationBatchItem`

Do not move those existing types in Phase 1 unless the compiler requires
it. A contract that starts as a thin facade over current shapes is fine.

### Design constraints

- No Osprey/Owl IPC types.
- No config switch.
- No query methods.
- No maintenance methods.
- No direct SQLite handles in the public contract.
- No worker-thread types in the public contract.

### Exit criteria

- Contract types compile.
- No existing runtime behavior references the new contract yet.
- No tests need to change.

---

## Phase 2 — Add Ostrich ingestion adapter around current runtime

**Risk:** low. New wrapper around existing behavior.

Add an `OstrichIngestion` implementation that delegates to the current
gateway observation runtime and service paths.

### Proposed location

```text
src/subsystems/observability/ostrich/
└── ingestion.ts
```

### Responsibilities

The adapter should own the public ingestion shape and delegate inward:

- enqueue or record observations through existing runtime functions
- expose `recordObservation`
- expose `recordBatch`
- expose `drain`
- translate current drain/loss outcomes into contract results

### Non-responsibilities

The adapter should not:

- open or migrate the SQLite store itself if current lifecycle code does
  that elsewhere
- own retention
- own trace queries
- own optimize/benchmark history
- own Ledger query/write semantics beyond whatever current ingestion
  already records

### Tests

Add focused tests that prove the adapter delegates without changing
behavior. Prefer unit-level tests with fake dependencies if the current
runtime can be injected cleanly; otherwise use the existing SQLite-backed
test style.

### Exit criteria

- `OstrichIngestion` exists and implements the Phase 1 contract.
- Existing gateway observability behavior remains unchanged.
- Scoped observability tests pass.

---

## Phase 3 — Route producers through the adapter

**Risk:** medium. This changes composition, not underlying persistence.

Replace direct producer calls into gateway observability ingestion with
the `ObservabilityIngestion` contract where the seam is natural.

### Candidate producer side

Start with gateway observation producers because they are the reason for
the first boundary:

- gateway request lifecycle observation bridge
- gateway observation flush/drain calls
- gateway shutdown drain
- worker-backed batch persistence

### Rules

- Keep the adapter instantiated in TypeScript.
- Do not add config-driven engine selection.
- Do not change observation record shape.
- Do not change queue limits, priority rules, drain timeouts, or worker
  retry behavior.
- Do not route query or maintenance code through the ingestion contract.

### Tests

Run the full scoped observability test surface. Add regression tests only
where composition changes expose a gap.

### Exit criteria

- Gateway observability producers use the ingestion contract.
- Existing runtime behavior is preserved.
- No CLI/MCP output shape changes.

---

## Phase 4 — Carve ingestion files into Ostrich

**Risk:** medium. Mostly file moves and import updates.

Once smx uses the ingestion contract, move implementation-owned
ingestion files under an Ostrich-owned subtree.

### Proposed shape

```text
src/subsystems/observability/
├── contract/
├── ostrich/
│   └── ingestion/
└── ...
```

Files covered by the ingestion carve-out:

- `ostrich/ingestion/gateway-observability-config.ts`
- `ostrich/ingestion/gateway-observability-runtime.ts`
- `ostrich/ingestion/gateway-observability-runtime-control.ts`
- `ostrich/ingestion/gateway-observation-flush.ts`
- `ostrich/ingestion/gateway-observation-priority.ts`
- `ostrich/ingestion/gateway-observation-queue.ts`
- `ostrich/ingestion/gateway-observation-records.ts`
- `ostrich/ingestion/gateway-observation-runtime-state.ts`
- `ostrich/ingestion/gateway-observation-shutdown.ts`
- `ostrich/ingestion/gateway-observation-worker.ts`
- `ostrich/ingestion/gateway-writer-bounds.ts`
- `ostrich/ingestion/gateway-writer-protocol.ts`
- `ostrich/ingestion/gateway-writer-worker.ts`
- `ostrich/ingestion/gateway-failure-mapping.ts`

Whether `gateway.ts` moves in this phase depends on how much it acts as
the public facade for the broader subsystem. If it is still serving as a
shared observability facade, leave it in place and have it call into
Ostrich ingestion.

### Lint boundary

Add lint rules only after the move is complete and the import shape is
known. The first lint rule should be gentle:

- smx may import the contract and the approved Ostrich factory
- smx should not import Ostrich ingestion internals
- Ostrich ingestion should not import CLI/MCP/query/optimize modules

### Exit criteria

- Ingestion implementation files live under `ostrich/ingestion/`.
- Imports are updated mechanically.
- Scoped observability tests pass.
- `npm run check:boundaries` still passes or is updated intentionally.

---

## Phase 5 — Decide the next boundary

**Risk:** none. Planning only.

After ingestion is behind a contract and carved into Ostrich, choose the
next boundary using coverage and real need. The actual Phase 5 work
continued beyond the initial recommendation, but stayed
behavior-preserving: query, maintenance, Ledger, benchmark,
optimization, and store internals were moved under Ostrich with root
facades preserved for public callers.

### Options

- **Lifecycle next:** name opening/closing/status behavior without
  moving query or maintenance.
- **Query next:** put trace/request-execution reads behind a contract.
- **Maintenance moved:** `ostrich/maintenance/history-services.ts` and
  `ostrich/maintenance/history-delete.ts` now have direct focused tests around
  cleanup behavior; prune/cleanup semantics live under `ostrich/maintenance/`.
- **Stop:** keep only ingestion named for now.

### Recommendation

Stop at the current end-of-Phase-5 boundary unless there is a concrete
reason to continue. The broader carve-out now gives Ostrich a coherent
implementation region without introducing Osprey/Owl runtime selection.
Further work should be framed as a new decision: either ordinary
maintenance inside Ostrich, or a Phase 6-style proposal for a real
external consumer.

## Risks

- **Over-extraction:** pulling the full observability service behind a
  single interface would blur distinct responsibilities.
- **Schema drift:** moving files should not create a second source of
  truth for SQLite shape.
- **CLI/MCP drift:** read-model behavior must not change during
  ingestion work.
- **Future-engine bias:** do not design for Osprey/Owl before Ostrich is
  stable.
- **Coverage complacency:** aggregate coverage is good, but maintenance
  and optimize gaps remain real blockers for their own boundaries.

## Success criteria

Ostrich Phase 1-5 is successful when:

- gateway observability ingestion has a named contract
- Ostrich implements that contract in process
- gateway producers use the contract
- current SQLite-backed behavior is preserved
- ingestion implementation files are visibly owned by Ostrich
- query, maintenance, Ledger, benchmark, optimization, and store
  implementation files are visibly owned by Ostrich or documented as
  public root facades
- import-boundary checks guard every Ostrich implementation region with
  zero violations
- no Osprey/Owl IPC or config switch has been introduced
