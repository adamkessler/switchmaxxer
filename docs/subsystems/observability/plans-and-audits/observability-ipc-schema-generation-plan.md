# Observability IPC Schema Generation Plan

This note decides how Switchmaxxer should approach generated schemas for
the observability IPC boundary before any Osprey or Owl engine exists.
It is intentionally a spike plan, not a commitment to generate schemas
for the whole subsystem in one pass.

## Recommendation

Generate JSON Schema artifacts from the TypeScript IPC contract, then
check those generated artifacts into the repo.

The source of truth should remain TypeScript because Ostrich is the
reference implementation and the current `ObservabilityModule` port
types already define the in-process contract. Generated JSON Schema
should be a transport artifact for external implementations, not a
second hand-maintained contract.

Hand-maintained schemas would make drift likely: TypeScript callers,
runtime IPC validators, docs, and Osprey/Owl authors could each end up
reading slightly different contracts. Generation keeps the external
schema close to the same source used by the local dispatcher and tests.

## Scope

The first schema spike covered one low-risk operation:

- `trace.list` request payload
- `trace.list` success result
- shared request/response envelope references needed by that operation

`trace.list` is a good first target because it is read-only,
idempotent, already covered by module-port vectors, already covered by
runtime request and result validators, and does not involve local-only
callbacks or control-plane mutation authority.

The first expansion added the rest of the trace-read lane:
`trace.listObservations`, `trace.getStats`, and `trace.show` request and
success-result schemas. This proves the generated artifact can publish
multiple request shapes, shared trace record shapes, canonical
observation records, stats summaries, and trace detail responses.

The second expansion added the Ledger read lane: `ledger.list` and
`ledger.show` request and success-result schemas. This keeps schema
publication focused on read-only external compatibility while adding the
Control Plane Audit Ledger event record shape.

The third expansion added `retention.pruneOlderThan` request and
success-result schemas. This is the first maintenance operation in the
generated artifact, but it remains a contained shape: a cutoff payload
and nullable prune-count result envelope.

The fourth expansion started the benchmark history lane with read
operations: `benchmarkHistory.list` and `benchmarkHistory.show` request
and success-result schemas. Cleanup operations stay separate because
they introduce delete-count result shapes and broader completion
semantics.

The fifth expansion completed the benchmark history lane with
`benchmarkHistory.pruneOlderThan`, `benchmarkHistory.deleteRun`, and
`benchmarkHistory.clear` request and success-result schemas.

The sixth expansion started the optimization history lane with read
operations: `optimizationHistory.list` and `optimizationHistory.show`
request and success-result schemas. Cleanup operations stay separate
because they introduce optimization delete-count result shapes.

The seventh expansion completed the optimization history lane with
`optimizationHistory.pruneOlderThan`, `optimizationHistory.deleteRun`,
and `optimizationHistory.clear` request and success-result schemas.

The eighth expansion added optimization report persistence schemas for
`optimizationReports.persistCost` and `optimizationReports.persistLatency`.
These publish the shared optimize report view and the objective-specific
persist payloads without changing runtime dispatch behavior.

The ninth expansion added the external-safe `benchmarkRuns.run` schema.
Request payloads use `gatewayPreflight` and intentionally reject the
local-only `preflightGateway` function field.

The tenth expansion added standalone JSON-safe external optimize
mutation command schemas for future apply/restore transport work,
including the required deterministic `idempotencyKey`. These schemas
cover the command payloads only; `optimizeMutations.apply` and
`optimizeMutations.restore` operation frames remain intentionally
excluded until the runtime mapping and idempotency enforcement contract
are settled.

Remaining generated-schema work should not add optimize mutation
operation frames until the JSON-safe command shapes are mapped to the
runtime and the idempotency enforcement contract exists.

## Artifact layout

Use a generated schema directory under the observability subsystem:

```text
src/subsystems/observability/ipc-schemas/
├── observability-ipc.schema.json
└── README.md
```

The first file can contain a single schema document with `$defs` for
shared envelope shapes and operation-specific request/result shapes. A
single file is easier for Java and Rust consumers to load during early
spikes. Split files can come later if the schema grows too large.

The generated `README.md` should say which script produced the schemas,
which TypeScript source files are authoritative, and that manual edits
will be overwritten.

## Generator posture

Prefer a deterministic local script over introducing a broad framework.
The script should:

- read TypeScript IPC types from
  `src/subsystems/observability/observability-ipc-contract.ts`
- emit stable JSON with sorted keys where practical
- fail if the generated file differs from the checked-in schema
- run in CI through an npm script once the first schema lands

The first spike may use a dedicated TypeScript-to-schema library if it
keeps the script small and deterministic. If that adds too much tool
weight, hand-writing a tiny schema emitter for `trace.list` is
acceptable only as a temporary proof of layout, with a follow-up task to
replace it before expanding coverage.

## Validation Layers

Generated schemas should complement, not replace, the current runtime
guards.

Current layers:

- request envelope validation before dispatch
- operation-specific payload validation for local and external
  transport modes
- response envelope validation after transport
- operation-specific success-result validation for every current IPC
  operation
- module-port contract vectors against Ostrich and the local IPC
  dispatcher

Generated schemas add a publication layer for Osprey/Owl authors and
can eventually become fixtures for cross-language compatibility tests.
The TypeScript runtime should keep its explicit validators even after
schemas exist, because those validators define smx-side fail-closed
behavior and error details.

## Compatibility Rules

Generated schemas must preserve the current protocol posture:

- operation names stay exact and TypeScript-style
- `contract_version` remains required
- `store.dbPath` remains separated from operation payloads
- external transport payloads exclude local-only runtime values
- success results include the same `dbPath` and `storeFound` envelope
  fields used by the current module results
- error responses are structured and secret-safe

Schema validation should not bless a response as semantically correct.
It only proves shape. The module-port contract tests still decide
whether an implementation behaves like Ostrich.

## Exit Criteria for the First Spike

The first schema spike is complete:

- `trace.list` request and success-result schemas are generated.
- `trace.listObservations` request and success-result schemas are generated.
- `trace.getStats` request and success-result schemas are generated.
- `trace.show` request and success-result schemas are generated.
- `ledger.list` request and success-result schemas are generated.
- `ledger.show` request and success-result schemas are generated.
- `retention.pruneOlderThan` request and success-result schemas are generated.
- `benchmarkHistory.list` request and success-result schemas are generated.
- `benchmarkHistory.show` request and success-result schemas are generated.
- `benchmarkHistory.pruneOlderThan` request and success-result schemas are generated.
- `benchmarkHistory.deleteRun` request and success-result schemas are generated.
- `benchmarkHistory.clear` request and success-result schemas are generated.
- `optimizationHistory.list` request and success-result schemas are generated.
- `optimizationHistory.show` request and success-result schemas are generated.
- `optimizationHistory.pruneOlderThan` request and success-result schemas are generated.
- `optimizationHistory.deleteRun` request and success-result schemas are generated.
- `optimizationHistory.clear` request and success-result schemas are generated.
- `optimizationReports.persistCost` request and success-result schemas are generated.
- `optimizationReports.persistLatency` request and success-result schemas are generated.
- External `benchmarkRuns.run` request and success-result schemas are generated.
- Standalone external optimize apply/restore command schemas are generated.
- A check script fails when the checked-in schema is stale.
- Docs link the generated schema artifact from the IPC contract spec.
- Focused IPC tests and `npm run check:docs` pass.
- The spike does not change runtime dispatch behavior.

## Later Expansion Order

After the trace-read, Ledger read, retention prune, benchmark history,
optimization history, optimization report, external benchmark run, and
standalone external optimize command lanes, expand in this order:

1. Optimize mutation operation frames only after the JSON-safe command
   shapes are mapped to runtime execution and an idempotency enforcement
   contract exists.

This order keeps schema work aligned with the safest external IPC
surface first, then grows toward operations with more authority and more
open transport questions.
