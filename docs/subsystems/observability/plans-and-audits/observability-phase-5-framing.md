# Observability Phase 5 Framing

This document defines the target for reaching the observability equivalent of
the hot-path end-of-Phase-5 state.

For the hot path, end of Phase 5 meant:

- the implementation had a named conceptual identity: Manatee
- code lived in a named subsystem region
- contract types existed
- boundary/import audits had been performed
- boundary enforcement existed with zero violations
- Phase 6, making Manatee a concrete `HotPath` implementation, was deferred
  until a second implementation was real enough to justify it

For observability, the analogous goal is **not** to build Osprey or Owl and
not to introduce a user-facing engine switch. The goal is to make Ostrich, the
current in-process TypeScript implementation, a clearly named and guarded
implementation region behind the existing `ObservabilityModule` ports.

## Status check

Completed or substantially complete:

- **Phase 0 — coverage audit.**
  [observability-coverage-audit.md](observability-coverage-audit.md) exists and
  identifies the major safety gaps.
- **Phase 1 — module-port contract types.**
  [../../../src/subsystems/observability/observability-module.ts](../../../../src/subsystems/observability/observability-module.ts)
  defines the current `ObservabilityModule` port map.
- **Phase 2 — Ostrich adapters around current service paths.**
  The module port factories in `observability-module.ts` delegate to current
  TypeScript/SQLite behavior.
- **Phase 3 — CLI/MCP routing through module ports.**
  Major trace, retention, Ledger, benchmark, optimize, and control-plane audit
  flows now enter through module ports.
- **IPC contract scaffolding.**
  Request validation, result validation, generated schemas, and the external
  adapter exist before any Osprey/Owl process exists.
- **Optimize mutation bridge hardening.**
  Planned apply/restore commands, deterministic idempotency keys, deferred
  caller completion, completed replay, failed replay, unknown replay, and
  digest mismatch handling are covered for the current CLI/MCP path.
- **First Phase 4B ingestion slice.**
  Gateway observation runtime, queueing, flushing, shutdown, worker protocol,
  record shaping, failure mapping, queue tunables, priority classification, and
  writer bounds live under
  `src/subsystems/observability/ostrich/ingestion/`, with root gateway
  facades preserving gateway/module/test-support imports.
- **First Phase 4C boundary rule.**
  External production code is blocked from importing `ostrich/ingestion/**`
  directly; it must use the public gateway facade.
- **Query/request-execution Phase 4B slice.**
  Request-execution materialization, queries, stats, verification, repository
  reads, and where-clause helpers live under
  `src/subsystems/observability/ostrich/query/`, with root
  `request-executions.ts` kept as a public DTO facade for CLI/MCP type imports.
- **Maintenance/history Phase 4B slice.**
  History deletion helpers, benchmark/optimization history cleanup services,
  and retention pruning live under
  `src/subsystems/observability/ostrich/maintenance/`, with direct tests for
  batch deletion, rollback, and feature cleanup behavior.
- **Ledger/control-plane Phase 4B slice.**
  Control-plane action persistence, config mutation history, and best-effort
  config mutation audit helpers live under
  `src/subsystems/observability/ostrich/ledger/`, with root facades preserving
  public DTO/type imports.
- **Benchmark Phase 4B slice.**
  Benchmark run persistence, execution planning/runtime orchestration, route
  selection, path-mode validation, and plan-size limits live under
  `src/subsystems/observability/ostrich/benchmark/`, with root `bench-*`
  facades preserving CLI/MCP parser imports and public benchmark DTO imports.
- **Optimization Phase 4B slice.**
  Optimization run persistence, report building, apply/restore orchestration,
  and optimize Ledger view helpers live under
  `src/subsystems/observability/ostrich/optimization/`, with root
  `optimize-*` facades preserving CLI/MCP and IPC-adjacent imports.
- **Store/schema Phase 4B slice.**
  SQLite bootstrap, schema DDL, busy handling, and DB path safety live under
  `src/subsystems/observability/ostrich/store/`, with root store/schema/path
  facades preserving `runtime-loader.ts`, CLI/MCP, and test imports.

Closure state for an end-of-Phase-5 equivalent:

- The default in-process implementation is named **Ostrich** and lives under
  `src/subsystems/observability/ostrich/`.
- The clear public entrypoints for constructing or using the default module are
  `observability-module.ts`, `runtime-loader.ts`, and the gateway facade
  `gateway.ts`.
- Remaining root production files are intentional public contracts, facades,
  validators, IPC bridges, runtime adapters, or shared primitives.
- Import boundary checks cover every Ostrich implementation region with zero
  violations.
- Osprey and Owl remain theoretical; no engine switch, Java process, Rust
  process, or process supervisor has been introduced.

## Phase 5 Closure Inventory

The remaining root files in `src/subsystems/observability/` are intentionally
public or cross-cutting surfaces:

| Category | Root files | Why they stay at root |
|---|---|---|
| Module and gateway entrypoints | `observability-module.ts`, `gateway.ts`, `runtime-loader.ts`, `observability-bootstrap.ts` | Public construction, gateway integration, and CLI composition surfaces. |
| Public facades over Ostrich internals | `bench-*`, `benchmarks.ts`, `config-mutation-audit.ts`, `config-mutations.ts`, `control-plane-actions.ts`, `gateway-observability-runtime*.ts`, `gateway-observation-*`, `gateway-writer-*`, `optimizations.ts`, `optimize-ledger-views.ts`, `optimize-orchestrator.ts`, `optimize-report-builder.ts`, `request-executions.ts`, `schema.ts`, `sqlite-busy.ts`, `store*.ts` | Preserve existing CLI/MCP/gateway/test imports while implementation lives under `ostrich/`. |
| Contracts, DTOs, validators, and primitives | `contracts.ts`, `filter-value-validation.ts`, `json-parse.ts`, `prune-validation.ts`, `timestamps.ts`, `trace-maintenance-validation.ts`, `types.ts` | Shared typed boundaries used by CLI, MCP, IPC, contracts, and Ostrich. |
| IPC bridge and external-compatibility surface | `observability-ipc-*`, `optimize-mutation-idempotency*.ts` | Defines the future Osprey/Owl-compatible protocol without creating an external runtime yet. |
| Test support and contract vectors | `*.test.ts`, `*.test-support.ts`, `test-helpers.ts` | Test-only helpers, fixtures, and contract coverage. |

The corresponding implementation regions are guarded by
`scripts/check-import-boundaries.js`: `ostrich/ingestion`, `ostrich/query`,
`ostrich/maintenance`, `ostrich/ledger`, `ostrich/benchmark`,
`ostrich/optimization`, and `ostrich/store`.

## Phase 5 target

End of Phase 5 for observability means:

```text
src/subsystems/observability/
├── observability-module.ts        # public module contract and approved factory
├── gateway.ts                     # public gateway-observation facade, if retained
├── ostrich/                       # default in-process TypeScript implementation
│   ├── ingestion/
│   ├── query/
│   ├── maintenance/
│   ├── ledger/
│   ├── benchmark/
│   ├── optimization/
│   └── store/
└── ...
```

The exact subdirectory split can change during implementation, but the rule is
stable: code that is implementation detail for the in-process TypeScript
engine should live under `ostrich/`; smx production surfaces should consume the
module ports or approved facades.

## Recommended phase sequence

### Phase 4A — Audit current direct access

Produce a short source audit before moving files:

- production imports of `ObservabilityService`
- production imports of `runtime-loader`
- production imports of gateway observation internals
- direct SQLite/repository construction outside Ostrich implementation and test
  setup
- CLI/MCP paths that already use `ObservabilityModule`

Classify each as:

- **approved public facade**
- **Ostrich implementation detail**
- **session/bootstrap adapter**
- **test-only**
- **move behind module port before Phase 5**

### Phase 4B — Move implementation files mechanically

Move files by domain with no behavior changes. Keep each move small enough that
imports and tests are easy to review.

Suggested order:

1. ingestion and gateway observation internals
2. query/request-execution internals
3. maintenance/prune/history internals
4. Ledger/control-plane audit internals
5. benchmark internals
6. optimization and optimize mutation internals
7. store/lifecycle internals, only if the public entrypoint remains clear

Do not move everything just to satisfy the directory sketch. If a file is an
intentional public facade or cross-domain contract, leave it at the subsystem
root and document why.

### Phase 4C — Add boundary enforcement

After the moves settle, extend `scripts/check-import-boundaries.js` with
observability rules similar in spirit to the hot-path guardrails:

- production CLI/MCP code may import `observability-module.ts`, public MCP/CLI
  adapters, and approved facades
- production CLI/MCP code should not import `ostrich/**` internals directly
- `ostrich/**` should not import CLI or MCP modules
- test files may keep direct access for fixtures and contract vectors

The target is zero violations before declaring Phase 5 complete.

### Phase 5 — Stop and reassess

Once the implementation region and boundary checks are in place, stop before
building Osprey or Owl. At that point observability matches the hot-path
end-of-Phase-5 posture:

- Ostrich is a named implementation region.
- The module contract is the production seam.
- Direct implementation access is audited and guarded.
- External implementations remain theoretical.
- The next step, if ever needed, is a Phase 6 framing decision for a real
  external consumer.

## Non-goals

- Do not introduce a config switch for observability engines.
- Do not spawn Java or Rust processes.
- Do not make optimize apply/restore execution external.
- Do not replace the SQLite schema as part of the carve-out.
- Do not combine file moves with behavior changes.

## Verification

Each implementation slice should run:

```sh
npm run build
npm run check:boundaries
node --enable-source-maps --test --test-force-exit dist/subsystems/observability/*.test.js
git diff --check
```

If a slice touches CLI or MCP wiring, also run the focused CLI/MCP runtime tests
that cover that surface.

## Completion checklist

- [x] Direct access audit exists:
      [observability-phase-4a-direct-access-audit.md](observability-phase-4a-direct-access-audit.md).
- [x] Ostrich implementation files are visibly owned by `ostrich/` or explicitly
      documented as public facades/contracts.
- [x] Production CLI/MCP paths enter through `ObservabilityModule` or approved
      adapters.
- [x] Import boundary checks prevent new production reaches into Ostrich
      internals.
- [x] Scoped observability tests pass after the moves.
- [x] No Osprey/Owl runtime, engine switch, or external process supervisor has
      been introduced.
