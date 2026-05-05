# Observability Coverage Audit

**Generated:** 2026-05-12
**Test runner:** `node --test` (Node 24 built-in test runner, run from
compiled `dist/`)
**Coverage tool:** `c8` 11.0.0 with `NODE_V8_COVERAGE` capture
**Coverage scope:** `src/subsystems/observability/`

This document is the Phase 0 safety audit that guided the Ostrich
implementation plan. It records how much test coverage protected the
observability subsystem before the behavior-preserving modularization
began, and it remains the baseline for judging whether later
implementation moves need additional coverage.

The audit follows the modular scope defined in
[tech-spec-for-modular-observability-subsystem.md](../current/tech-spec-for-modular-observability-subsystem.md).
Files are categorized by contract area so coverage can guide the first
safe Ostrich boundary instead of flattening ingestion, query,
maintenance, lifecycle, benchmark/optimize history, and Ledger behavior
into one score.

## Summary

- **Total observability source files audited:** 53
- **Aggregate line coverage:** 88.12% (9,451 / 10,724)
- **Aggregate branch coverage:** 76.40% (1,179 / 1,543)
- **Aggregate function coverage:** 89.97% (377 / 419)
- **Files below 80% line coverage:** 4
- **Files below 60% branch coverage:** 5

Headline finding: **the observability subsystem is covered well enough
to start planning Ostrich, and the first module-port extraction work can
proceed when each slice stays behavior-preserving.**
The current tests strongly cover store/schema, request-execution
materialization, query helpers, and most ingestion machinery. The main
pre-carve-out gaps are feature-specific history cleanup, optimize
orchestration branch behavior, and the gateway writer protocol type
module appearing as uncovered in all-files coverage. The ingestion
blockers for failure mapping, priority selection, worker state failure,
shutdown drain behavior, and writer runtime behavior have been covered.

## Boundary Audit Update

**Updated:** 2026-05-13

The modular observability boundary now has production ports for the
current CLI/MCP operator surfaces:

- trace query and trace maintenance
- retention pruning
- Ledger read behavior
- config mutation control-plane audit writes
- benchmark history and benchmark run execution
- optimize history, report persistence, and apply/restore mutations

Direct service-handle access in CLI optimize wiring has been removed.
CLI and MCP optimize apply/restore now also flow through the internal
planned optimize mutation idempotency bridge. That bridge owns accepted
idempotency records, deferred caller completion for reload/verification,
completed replay, failed replay, unknown completion, and digest mismatch
handling. Remaining direct `ObservabilityService` usage outside the
module boundary is expected in tests, Ostrich port implementations, and
session/bootstrap adapters that acquire a handle before constructing
Ostrich ports or repositories.

## Phase 5 Status Update

**Updated:** 2026-05-14

The behavior-preserving Ostrich carve-out has reached the intended
end-of-Phase-5 state:

- implementation-owned ingestion, query, maintenance, Ledger,
  benchmark, optimization, and store files live under
  `src/subsystems/observability/ostrich/`
- remaining root production files are public facades, contracts,
  validators, IPC bridges, runtime adapters, or shared primitives
- `scripts/check-import-boundaries.js` guards every Ostrich
  implementation region
- `npm run test:unit`, `npm run lint`, `npm run check:boundaries`, and
  `npm run check:docs` pass
- Osprey and Owl remain theoretical; no external runtime or engine
  switch has been introduced

The per-file coverage table below is still the original Phase 0
snapshot unless a row explicitly notes later focused tests or movement.
Refresh the full coverage numbers before using this document as a
release-quality coverage gate.

## Reproducing the audit

```sh
npm run build
rm -rf /tmp/smx-observability-coverage
mkdir -p /tmp/smx-observability-coverage
NODE_V8_COVERAGE=/tmp/smx-observability-coverage \
  node --enable-source-maps --test --test-force-exit \
  dist/subsystems/observability/*.test.js
npx c8@11.0.0 report --all \
  --temp-directory /tmp/smx-observability-coverage \
  --reporter json-summary --reporter text-summary \
  --reports-dir /tmp/smx-observability-coverage-report-all \
  --include 'dist/subsystems/observability/**' \
  --exclude '**/*.test.js' \
  --exclude '**/*.test-support.js' \
  --exclude '**/test-helpers.js'
```

The scoped observability test run passed:

- 28 test files
- 28 passing
- 0 failing

An attempted full `scripts/run-unit-tests.js` coverage capture failed in
unrelated hot-path/MCP tests:

- `dist/subsystems/hot-path/manatee/proxy/http-transport.test.js`
- `dist/subsystems/hot-path/manatee/proxy/proxy-runtime.anthropic-streaming.test.js`
- `dist/subsystems/mcp/mcp.test.js`

Those failures are outside this audit's scope, but they should be
investigated before treating a full-repo coverage run as a release gate.

## Per-file Coverage Table

Sorted by line coverage ascending.

| File | Contract area | Line % | Branch % | Function % | Notes |
|------|---------------|--------|----------|------------|-------|
| `ostrich/ingestion/gateway-writer-protocol.ts` | Ingestion | 0 | 0 | 0 | Type-only protocol module; c8 counts emitted module scaffolding. |
| `ostrich/maintenance/history-services.ts` | Maintenance | 19.57 | 100 | 28.57 | Direct tests added with the maintenance extraction; refresh coverage after the next full coverage run. |
| `ostrich/maintenance/history-delete.ts` | Maintenance | 43.58 | 69.23 | 71.42 | Direct batch/rollback tests added with the maintenance extraction; refresh coverage after the next full coverage run. |
| `ostrich/optimization/optimize-orchestrator.ts` | Benchmark/optimize | 72.51 | 45.07 | 87.50 | Critical before broader externalization work; moved under Ostrich with a root facade. |
| `ostrich/query/request-execution-verification.ts` | Request execution | 81.37 | 75.00 | 66.66 | |
| `ostrich/ingestion/gateway-writer-worker.ts` | Ingestion | 81.87 | 84.61 | 83.33 | Moved under Ostrich; root facade remains for worker entrypoint imports. |
| `ostrich/ledger/config-mutations.ts` | Ledger | 84.49 | 81.48 | 92.85 | |
| `runtime-loader.ts` | Lifecycle | 84.75 | 75.86 | 90.90 | |
| `contracts.ts` | Shared semantics | 85.54 | 77.19 | 84.61 | |
| `ostrich/ingestion/gateway-observability-runtime.ts` | Ingestion | 85.80 | 76.31 | 84.21 | Moved under Ostrich; root facade remains for gateway/module imports. |
| `ostrich/ledger/control-plane-actions.ts` | Ledger | 87.81 | 58.18 | 100 | Edge: validation/list filter branches below 60%. |
| `ostrich/optimization/optimize-ledger-views.ts` | Benchmark/optimize | 87.97 | 46.73 | 84.00 | Critical: optimize apply/restore branch matrix is broad; moved under Ostrich with a root facade. |
| `ostrich/optimization/optimize-report-builder.ts` | Benchmark/optimize | 88.21 | 74.07 | 95.00 | Moved under Ostrich with a root facade. |
| `ostrich/ingestion/gateway-observation-worker.ts` | Ingestion | 89 | 76.27 | 93.75 | Moved under Ostrich; root facade remains for gateway imports. |
| `ostrich/optimization/optimizations.ts` | Benchmark/optimize | 89.82 | 80.00 | 77.77 | Moved under Ostrich with a root facade. |
| `ostrich/store/store.ts` | Store/schema | 91.07 | 75.70 | 100 | Moved under Ostrich; root facade remains for runtime/test imports. |
| `ostrich/ingestion/gateway-observation-shutdown.ts` | Ingestion | 91.13 | 95 | 100 | Moved under Ostrich; root facade remains for gateway imports. |
| `ostrich/store/sqlite-busy.ts` | Store/schema | 91.76 | 60.00 | 100 | Moved under Ostrich; root facade remains for retry helper imports. |
| `timestamps.ts` | Shared semantics | 92.00 | 88.88 | 100 | |
| `service.ts` | Shared semantics | 92.06 | 80.00 | 77.77 | |
| `ostrich/benchmark/bench-runner.ts` | Benchmark/optimize | 92.56 | 60.86 | 66.66 | Moved under Ostrich; refresh coverage after the next full coverage run. |
| `gateway.ts` | Ingestion | 93.12 | 94.11 | 78.57 | |
| `ostrich/ledger/config-mutation-audit.ts` | Ledger | 93.33 | 58.33 | 100 | Direct tests added for best-effort success/failure branches; refresh coverage after the next full coverage run. |
| `ostrich/benchmark/bench-limits.ts` | Benchmark/optimize | 93.47 | 75.00 | 100 | Moved under Ostrich; root facade remains for parser imports. |
| `json-parse.ts` | Query | 93.50 | 91.66 | 100 | |
| `ostrich/store/store-path-security.ts` | Store/schema | 93.54 | 82.85 | 100 | Moved under Ostrich; root facade remains for runtime-loader imports. |
| `ostrich/ingestion/gateway-observation-queue.ts` | Ingestion | 94.61 | 87.09 | 100 | Moved under Ostrich; root facade remains for gateway imports. |
| `ostrich/query/request-execution-materialization.ts` | Request execution | 93.67 | 78.65 | 100 | |
| `ostrich/query/repository.ts` | Query | 94.35 | 83.33 | 100 | |
| `ostrich/query/request-execution-query.ts` | Request execution | 94.87 | 85.71 | 100 | |
| `ostrich/ingestion/gateway-observation-flush.ts` | Ingestion | 95.59 | 90.32 | 100 | Moved under Ostrich; root facade remains for gateway imports. |
| `ostrich/query/request-executions.ts` | Request execution | 96.18 | 83.20 | 100 | |
| `ostrich/query/where-clause.ts` | Query | 97.29 | 94.73 | 100 | |
| `ostrich/benchmark/benchmarks.ts` | Benchmark/optimize | 97.33 | 63.88 | 100 | Moved under Ostrich; root facade remains for public DTO imports. |
| `ostrich/benchmark/bench-route-selection.ts` | Benchmark/optimize | 97.43 | 90.47 | 100 | Moved under Ostrich; root facade remains for parser imports. |
| `ostrich/maintenance/prune-service.ts` | Maintenance | 99.46 | 80.00 | 100 | |
| `ostrich/benchmark/bench-execution-validation.ts` | Benchmark/optimize | 100 | 100 | 100 | Moved under Ostrich; root facade remains for parser imports. |
| `ostrich/benchmark/bench-path-mode.ts` | Benchmark/optimize | 100 | 100 | 100 | Moved under Ostrich; root facade remains for parser imports. |
| `filter-value-validation.ts` | Query | 100 | 100 | 100 | |
| `ostrich/ingestion/gateway-failure-mapping.ts` | Ingestion | 100 | 100 | 100 | |
| `ostrich/ingestion/gateway-observability-config.ts` | Ingestion | 100 | 100 | 100 | |
| `ostrich/ingestion/gateway-observability-runtime-control.ts` | Ingestion | 100 | 100 | 100 | Moved under Ostrich; root facade remains for isolated runtime reset imports. |
| `ostrich/ingestion/gateway-observation-priority.ts` | Ingestion | 100 | 100 | 100 | |
| `ostrich/ingestion/gateway-observation-records.ts` | Ingestion | 100 | 81.81 | 100 | |
| `ostrich/ingestion/gateway-observation-runtime-state.ts` | Ingestion | 100 | 100 | 100 | Moved under Ostrich; root facade remains for gateway imports. |
| `ostrich/ingestion/gateway-writer-bounds.ts` | Ingestion | 100 | 100 | 100 | |
| `observability-bootstrap.ts` | Store/schema | 100 | 100 | 100 | |
| `prune-validation.ts` | Maintenance | 100 | 100 | 100 | |
| `ostrich/query/request-execution-stats.ts` | Request execution | 100 | 70.00 | 100 | |
| `ostrich/store/schema.ts` | Store/schema | 100 | 100 | 100 | Moved under Ostrich; root facade remains for schema docs/tests. |
| `ostrich/store/store-path.ts` | Store/schema | 100 | 100 | 100 | Moved under Ostrich; root facade remains for runtime-loader imports. |
| `trace-maintenance-validation.ts` | Maintenance | 100 | 100 | 100 | |
| `types.ts` | Shared semantics | 100 | 100 | 100 | |

## Critical Gaps

### Feature-specific history cleanup

Files:

- `ostrich/maintenance/history-services.ts` — 19.57% line / 100% branch / 28.57% function
- `ostrich/maintenance/history-delete.ts` — 43.58% line / 69.23% branch / 71.42% function

Risk:

Benchmark-history and optimize-history cleanup have precise deletion
boundaries. Benchmark cleanup must not delete underlying request traces.
Optimize-history cleanup may delete optimize-owned committed mutation
records and orphaned managed snapshots, but must not sweep unrelated
Ledger or config mutation history.

Decision:

Focused tests were added before the maintenance/history carve-out. Keep
refreshing this section after the next full coverage run, because the
numbers above still reflect the original audit snapshot.

### Optimize orchestration and ledger views

Files:

- `ostrich/optimization/optimize-orchestrator.ts` — 72.51% line / 45.07% branch / 87.50% function
- `ostrich/optimization/optimize-ledger-views.ts` — 87.97% line / 46.73% branch / 84.00% function

Risk:

Optimize apply/restore behavior crosses reports, config mutation, Ledger
rows, snapshots, dry-runs, no-ops, reload metadata, and restore-point
selection. It now also crosses planned idempotency records and replay
semantics for CLI and MCP callers. This is high-value control-plane
behavior and should not be accidentally changed by an observability
modularization.

Decision:

Optimize history and apply/restore have now moved into the Ostrich
implementation region with root facades preserved for public callers.
The current safe boundary remains the module port plus the planned
idempotency bridge; future behavior changes should add focused coverage
for the remaining branch-heavy apply/restore cases before changing
semantics.

## Edge Gaps

### Ledger validation and best-effort audit branches

Files:

- `ostrich/ledger/control-plane-actions.ts` — 87.81% line / 58.18% branch / 100% function
- `ostrich/ledger/config-mutation-audit.ts` — 93.33% line / 58.33% branch / 100% function

Risk:

Branch gaps appear in validation and best-effort failure behavior. The
core write/read paths are covered, but failure reporting should be
preserved if Ledger moves behind a contract.

Decision:

Ledger behavior has moved into the Ostrich implementation region with
root facades preserved for public DTO/type imports. Keep the
best-effort failure branches visible as edge risk for future behavior
changes.

### Protocol module

Files:

- `ostrich/ingestion/gateway-writer-protocol.ts` — 0% line / 0% branch / 0% function

Risk:

`ostrich/ingestion/gateway-writer-protocol.ts` is type-only protocol shape; c8 reports
emitted module scaffolding as uncovered.

Decision:

Treat `ostrich/ingestion/gateway-writer-protocol.ts` as a coverage artifact unless runtime
protocol validators are added.

## Cosmetic Gaps

No cosmetic-only gaps were identified as blockers. Most lower-coverage
files are semantically meaningful enough to classify as Critical or Edge
rather than cosmetic.

## Decisions

- **First safe Ostrich boundary:** ingestion, with the original known
  ingestion branch gaps covered.
- **Module ports are the current service boundary.** Query,
  maintenance, benchmark/optimize history, and Ledger behavior now move
  through explicit ports instead of direct CLI/MCP service calls.
- **Do not start with Osprey or Owl IPC.** The TypeScript boundary should
  be clarified and covered first.
- **Refresh maintenance coverage after extraction.** Direct tests cover
  `ostrich/maintenance/history-services.ts` and
  `ostrich/maintenance/history-delete.ts`; rerun the full coverage audit
  before relying on the original percentages.
- **Treat optimize behavior changes carefully.** Optimize apply/restore
  now has a module port and planned idempotency bridge, and its
  implementation lives under Ostrich. Its branch complexity still means
  semantic changes need focused tests first.

## Exit Criteria

This audit remains useful as the baseline for the completed Ostrich
implementation plan when future work respects these limits:

- keep CLI/MCP production flows on module ports
- treat the type-only `ostrich/ingestion/gateway-writer-protocol.ts` coverage result as an
  artifact unless runtime protocol validators are added
- preserve the focused maintenance/history cleanup tests added during
  extraction
- preserve the optimize module port and planned idempotency bridge before
  changing apply/restore semantics
- use Ostrich as the reference implementation before designing Osprey or
  Owl adapters
