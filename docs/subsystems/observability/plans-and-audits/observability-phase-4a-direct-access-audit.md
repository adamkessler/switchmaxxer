# Observability Phase 4A Direct-Access Audit

This audit is the first implementation step toward the observability
end-of-Phase-5 target defined in
[observability-phase-5-framing.md](observability-phase-5-framing.md).

The original goal was to classify production access to observability internals
before moving files under an `ostrich/` implementation region. Test fixtures
and `*.test.ts` direct SQLite/service usage were intentionally excluded from
the findings below; those remain useful contract and seed helpers. The audit is
now a historical input to the completed Phase 5 carve-out.

## Summary

The current production boundary is mostly healthy:

- CLI and MCP production flows use `ObservabilityModule` ports for the major
  trace, retention, Ledger, benchmark, optimize, and control-plane audit
  surfaces.
- Remaining direct service-handle access is concentrated in bootstrap/session
  adapters that open or close the local SQLite-backed Ostrich handle.
- Optimize apply/restore has a special internal bridge whose idempotency
  repository is now constructed through the approved
  `createOptimizeMutationIdempotencyRepository()` factory rather than directly
  in CLI/MCP code.
- Parser/type imports from observability modules are mostly public contract
  helpers rather than runtime implementation reaches.

The main Phase 5 work is not to invent a new contract. It is to move
implementation files into an Ostrich-owned region and then enforce that
production surfaces consume approved ports/facades instead of internals.

## Approved Public Facades

These modules are allowed to remain importable from outside `ostrich/` after
the carve-out because they are part of the smx-facing observability surface.

| Module | Current consumers | Classification |
|---|---|---|
| `observability-module.ts` | CLI, MCP, gateway, hot-path observation bridge | Approved module contract and default Ostrich factory surface. |
| `gateway.ts` | gateway runtime, hot-path observation bridge through `observability-module.ts` | Approved gateway observation facade unless replaced by a narrower ingestion facade. |
| `contracts.ts` | CLI/MCP rendering and payload code | Approved DTO/type surface for rendered observability results. |
| `types.ts` | MCP parsers/tools, hot-path tests | Approved observation vocabulary surface. |
| validation helpers such as `prune-validation.ts`, `trace-maintenance-validation.ts`, `filter-value-validation.ts`, `bench-execution-validation.ts`, and `bench-route-selection.ts` | CLI/MCP parsers | Approved parser/validation helpers unless later folded into module ports. |

## Session And Bootstrap Adapters

These direct runtime-handle imports are acceptable today because they create or
close the local Ostrich store handle before module ports can operate.

| File | Direct access | Classification | Phase 5 action |
|---|---|---|---|
| `src/subsystems/mcp/session.ts` | `openObservabilityService`, `openExistingObservabilityService`, `closeObservabilityServiceHandle` | MCP session/bootstrap adapter | Keep as an approved adapter or move behind an Ostrich lifecycle factory. |
| `src/subsystems/mcp/observability-tools.ts` | `closeObservabilityServiceHandle`, `ObservabilityRuntimeHandle` | MCP handle lifecycle adapter | Keep until session owns all closing, then reevaluate. |
| `src/subsystems/mcp/bench-run-tool.ts` | `closeObservabilityServiceHandle` | MCP benchmark handle cleanup | Keep as adapter glue; prefer central session cleanup later. |
| `src/subsystems/mcp/tool-payload-builder.ts` | `resolveObservabilityStorePath`, `closeObservabilityServiceHandle` | MCP payload/bootstrap adapter | Keep as adapter glue; avoid importing deeper Ostrich internals. |
| `src/subsystems/cli/cli-bootstrap.ts` | `openExistingObservabilityService`, `closeObservabilityServiceHandle` | CLI bootstrap adapter for optimize mutation bridge | Keep as an approved adapter while the planned mutation bridge still needs a local store handle. |
| `src/subsystems/mcp/optimize-tools.ts` | `closeObservabilityServiceHandle` | MCP optimize adapter cleanup | Keep as an approved adapter while the planned mutation bridge still needs a local store handle. |

## Moved Behind A Narrow Factory

These were the clearest production reaches around the module ports. They are no
longer raw repository construction sites; CLI and MCP now call an approved
observability-owned factory.

| File | Direct access | Why it exists | Recommended action |
|---|---|---|---|
| `src/subsystems/cli/cli-bootstrap.ts` | `createOptimizeMutationIdempotencyRepository()` | Builds the planned optimize mutation bridge for CLI apply/restore. | Keep the factory as the approved bridge while the planned mutation/IPC surface remains public. |
| `src/subsystems/mcp/optimize-tools.ts` | `createOptimizeMutationIdempotencyRepository()` | Same bridge construction for MCP apply/restore. | Use the same approved factory as CLI. |

## Ostrich Implementation Details

These direct references are internal to `src/subsystems/observability/` and
became implementation details under `ostrich/` as files moved.

| Area | Current files | Phase 5 action |
|---|---|---|
| Gateway observation ingestion | `gateway-observability-*`, `gateway-observation-*`, `gateway-writer-*`, `gateway-failure-mapping.ts` | Move under `ostrich/ingestion/` unless kept as public facade/contract types. |
| Store/lifecycle | `runtime-loader.ts`, `ostrich/store/store.ts`, `ostrich/store/store-path*.ts`, `ostrich/store/schema.ts`, `ostrich/store/sqlite-busy.ts`, `observability-bootstrap.ts` | Store implementation moved under `ostrich/store/`; `runtime-loader.ts`, `store.ts`, `schema.ts`, `sqlite-busy.ts`, and store-path root files remain approved construction/public facades. |
| Query/request execution | `ostrich/query/repository.ts`, `ostrich/query/request-execution-*`, `ostrich/query/request-executions.ts`, `ostrich/query/where-clause.ts` | Moved under `ostrich/query/`; `request-executions.ts` remains as a root DTO facade for CLI/MCP type imports. |
| Maintenance/history | `ostrich/maintenance/prune-service.ts`, `ostrich/maintenance/history-delete.ts`, `ostrich/maintenance/history-services.ts` | Moved under `ostrich/maintenance/`; direct history delete/service tests cover the riskiest cleanup helpers. |
| Ledger/control-plane audit | `ostrich/ledger/control-plane-actions.ts`, `ostrich/ledger/config-mutation-audit.ts`, `ostrich/ledger/config-mutations.ts` | Moved under `ostrich/ledger/`; root facades preserve parser-facing DTO/type imports. |
| Benchmark | `ostrich/benchmark/bench-*`, `ostrich/benchmark/benchmarks.ts` | Moved under `ostrich/benchmark/`; root `bench-*` and `benchmarks.ts` facades preserve parser constants and public DTO/type imports. |
| Optimization | `ostrich/optimization/optimizations.ts`, `ostrich/optimization/optimize-*` | Moved core optimize repositories, report builders, orchestrators, and ledger views under `ostrich/optimization/`; root optimize facades and planned mutation/IPC files remain public while external compatibility work exists. |

## Test-Only Direct Access

Direct imports of `ObservabilityService`, `bootstrapObservabilityStore`,
`DatabaseSync`, repositories, and runtime handles in `*.test.ts` files are
classified as **test-only**. They are allowed for fixture seeding, migration
tests, contract vectors, and precise DB assertions. Boundary checks should
continue to ignore test files or explicitly allow these imports in tests.

Examples:

- `src/subsystems/cli/cli.runtime-surfaces.test.ts`
- `src/subsystems/mcp/mcp.test.ts`
- `src/subsystems/observability/*.test.ts`

## Boundary Rule Candidates

After implementation files move under `src/subsystems/observability/ostrich/`,
extend `scripts/check-import-boundaries.js` with rules like:

- production files outside `src/subsystems/observability/` must not import
  `src/subsystems/observability/ostrich/**`
- production CLI/MCP files may import:
  - `observability-module.ts`
  - approved parser/type helpers
  - approved lifecycle/session adapter helpers
  - approved planned optimize mutation bridge factory
- `src/subsystems/observability/ostrich/**` must not import
  `src/subsystems/cli/**` or `src/subsystems/mcp/**`
- test files may import Ostrich internals for fixtures and contract vectors

## Phase 5 Status

**Updated:** 2026-05-14

This audit has served its implementation purpose. The Phase 4B file
moves and Phase 4C boundary rules are complete, and the current
end-of-Phase-5 state is tracked in
[observability-phase-5-framing.md](observability-phase-5-framing.md).

Completed slices:

- gateway observation ingestion internals moved under `ostrich/ingestion/`
  while `gateway.ts` remains the public facade
- query/request-execution internals moved under `ostrich/query/`
- maintenance/prune/history internals moved under `ostrich/maintenance/`
- Ledger/control-plane audit internals moved under `ostrich/ledger/`
- benchmark internals moved under `ostrich/benchmark/`
- optimization internals moved under `ostrich/optimization/`
- store/schema/path/busy internals moved under `ostrich/store/`
- import-boundary rules now guard every Ostrich implementation region

The direct idempotency repository reach has already been reduced to an approved
factory, and CLI/MCP optimize apply/restore use the planned idempotency bridge.
