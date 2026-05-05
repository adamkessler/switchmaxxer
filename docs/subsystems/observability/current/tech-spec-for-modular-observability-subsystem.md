# Tech Spec for Modular Observability Subsystem

This document is the root technical overview for a modular
Switchmaxxer observability subsystem. It names the subsystem boundary,
explains why modularity is useful, and introduces three theoretical
implementations of the same observability contract:

- **Ostrich** — the in-process TypeScript implementation, evolved from
  the current observability layer.
- **Osprey** — a future out-of-process Java implementation.
- **Owl** — a future out-of-process Rust implementation.

The goal is not to rewrite observability for its own sake. The goal is
to make the current subsystem easier to reason about by separating the
semantic contract from the implementation that stores, derives, queries,
repairs, and prunes observability data.

## What observability owns

The observability subsystem is the durable telemetry and operational
history layer for smx. It turns runtime and control-plane facts into a
local store that operators, agents, CLI commands, MCP tools, benchmarks,
and optimize workflows can inspect later.

The current mental model is:

```text
observations -> traces -> benchmark runs -> optimize runs -> ledger rows
```

The subsystem owns:

- Canonical persisted observations.
- Request-execution materialization.
- Trace query and verification behavior.
- Benchmark run and benchmark sample history.
- Optimize run history and optimize-owned action history.
- Control Plane Audit Ledger rows.
- Config mutation events and managed config snapshots.
- Cost and optimization facts.
- Store bootstrap, schema integrity, repair, pruning, and retention.
- CLI/MCP-facing read and maintenance behavior over the store.

The subsystem should not own:

- Gateway request handling.
- Route selection or provider forwarding.
- Catalog and config mutation policy outside persisted audit evidence.
- Product decisions made by optimize.
- Human-readable process logging.
- Long-lived service supervision.

The current subsystem is documented in
[white-paper-on-observability-layer.md](white-paper-on-observability-layer.md).
This document sits above that white paper: it describes how the
observability layer could become a named modular subsystem with multiple
implementation strategies.

## Why modularity matters

Observability is already a real subsystem, but its current implementation
is bound tightly to an in-process TypeScript service and a local
`node:sqlite` store. That is a good default. It is simple, local-first,
easy to inspect, and easy to ship with smx.

Modularity is useful only if it makes the boundary more honest:

- Smx surfaces should depend on an observability contract, not on
  incidental SQLite details.
- Gateway and control-plane producers should emit typed facts without
  knowing how those facts are batched, stored, indexed, repaired, or
  pruned.
- Read surfaces should rely on stable query semantics, not on whichever
  implementation happens to back the store.
- Maintenance behavior should be portable enough that an alternative
  engine can pass the same contract tests.

The hard part is scope. Observability is broader than the gateway hot
path. It includes ingestion, persistence, derived read models, retention,
repair, benchmark history, optimize history, and control-plane audit
history. A useful modular design should not pretend those are all the
same kind of work.

## Contract split

The subsystem is designed as split contracts, not one giant
"observability plugin" interface.

The high-level split is:

- **Ingestion contract** — accepts canonical observation and audit
  events, performs validation/redaction/bounds checks, batches writes,
  and reports persistence health.
- **Query contract** — reads traces, request executions, benchmark
  history, optimize history, ledger rows, and derived facts.
- **Maintenance contract** — verifies, repairs, prunes, and reports
  schema/store status.
- **Store lifecycle contract** — opens, initializes, reloads, drains,
  and shuts down the backing implementation.

Ostrich can implement these contracts in-process with direct TypeScript
calls. Osprey and Owl can implement the same contracts through smx-side
adapter objects that supervise an external process.

This split keeps the subsystem grounded. Smx can move one behavior at a
time behind a named port without forcing every trace, benchmark,
optimize, Ledger, and maintenance path through a premature
external-process boundary.

## Common shape

At the subsystem level, the architecture looks like this:

```text
                 smx surfaces and producers
  gateway  CLI  MCP  bench  optimize  config mutation
                         |
                         | typed observability contracts
                         v
                Observability subsystem
                         |
             +-----------+-----------+
             |           |           |
          Ostrich      Osprey        Owl
```

Ostrich is the default implementation and lives in this repo. Osprey and
Owl, if built, should be hidden behind TypeScript adapters that live in
smx. Those adapters implement the smx-facing contracts, spawn the
external process, frame requests and responses, and translate health or
maintenance status back into the same TypeScript shapes.

From smx's point of view, all implementations must preserve the same
operator-facing behavior: traces list the same facts, repairs mean the
same thing, pruning removes the same categories, and failed writes or
schema mismatches surface through the same error envelopes.

## Current port map

The current TypeScript boundary lives in
[../../../src/subsystems/observability/observability-module.ts](../../../../src/subsystems/observability/observability-module.ts).
It is intentionally broader than the initial ingestion-only plan because
the CLI and MCP surfaces now depend on module ports for the major
operator workflows.

| Port | Surface | Contract responsibility |
|------|---------|-------------------------|
| `trace` | CLI/MCP trace reads | List traces, list observations, show one trace, and compute trace stats. |
| `traceMaintenance` | CLI/MCP trace maintenance | Verify and repair request-execution materialization. |
| `retention` | CLI/MCP retention commands | Prune observations and derived data older than a cutoff. |
| `ledger` | CLI/MCP Ledger reads | List and show Control Plane Audit Ledger events. |
| `controlPlaneAudit` | config mutation paths | Start and finish config mutation audit rows. |
| `benchmarkHistory` | CLI benchmark history, MCP benchmark reads, IPC history ops | List, show, prune, delete, and clear stored benchmark runs. The current MCP tool surface exposes list/show only. |
| `benchmarkRuns` | `bench run`, MCP, optimize latency | Execute benchmark operations with the observability store handle hidden behind the port. |
| `optimizationHistory` | CLI optimize history, MCP optimize reads, IPC history ops | List, show, prune, delete, and clear optimize runs. The current MCP tool surface exposes list/show only. |
| `optimizationReports` | optimize cost/latency | Persist cost and latency optimization reports. |
| `optimizeMutations` | optimize apply/restore | Apply and restore optimize-selected config mutations, including deferred Ledger completion. |

The remaining direct `ObservabilityService` use outside the module
boundary should be either an Ostrich implementation detail, an MCP
session-handle adapter used to instantiate Ostrich ports, or test setup.
Low-level helpers such as benchmark execution and optimize orchestration
can still accept an `ObservabilityService` internally; the important
boundary is that CLI/MCP production flows enter through the module ports.

Optimize apply/restore now has one extra internal boundary on top of the
module port: CLI and MCP callers build JSON-safe planned mutation
commands and pass them through the planned optimize idempotency bridge.
That bridge accepts the idempotency key before mutation, returns deferred
Ledger completion to the caller when reload or verification must run
outside the mutation service, and persists the completed replay result
after those post-actions finish. This is the canonical internal
apply/restore mutation boundary for current smx surfaces. It is not the
same thing as accepting framed external `optimizeMutations.apply` or
`optimizeMutations.restore` requests, which remain rejected before
transport.

## IPC boundary status

The first framed IPC boundary now exists as a local contract and
adapter layer. It is not yet an external engine supervisor, but it is
strong enough to describe what Osprey and Owl must preserve.

Current IPC hardening includes:

- a canonical operation list for every current `ObservabilityModule`
  port operation
- request envelope validation before dispatch
- operation-specific payload validation for local framed calls
- stricter external-transport validation that rejects local-only
  payloads such as callbacks, `Date` objects, and optimize mutation
  callbacks
- response envelope validation after transport
- operation-specific success-result validation for every current IPC
  operation
- a coverage guard that fails when an operation is added without an
  explicit result validator

The result validators are intentionally split by domain in source:
trace, benchmark, Ledger/retention/control-plane audit, optimization,
and shared primitives. That split mirrors the port map above and keeps
future Osprey/Owl compatibility work from treating observability as one
undifferentiated JSON shape.

The external adapter currently accepts an injected transport exchange.
It validates requests in external mode, validates the returned response
envelope and operation-specific result shape, and maps malformed frames
or transport failures into stable IPC errors. This makes the adapter
useful as a compatibility boundary before any Java or Rust child process
exists.

## External-engine readiness checklist

The current Osprey/Owl readiness status is intentionally mixed. Some
ports are external-safe enough to model over stdio today; others remain
Ostrich-owned until smx has JSON-safe commands for the local authority
they require.

Ready for external adapter compatibility work:

- trace reads and trace statistics
- trace maintenance verify/repair operations
- whole-store retention/prune operations
- Ledger list/show operations
- control-plane audit start/finish operations
- benchmark history reads and cleanup operations
- benchmark runs with smx-owned `gatewayPreflight`
- optimization history reads and cleanup operations
- optimization report persistence with external-safe timestamps

Still local-only or policy-blocked:

- gateway observation ingestion and worker lifecycle, because current
  behavior is tightly coupled to in-process queueing and shutdown
  semantics
- optimize apply/restore execution, because config reads, catalog
  writes, reload, and verification stay under smx authority
- framed external `optimizeMutations.apply` and
  `optimizeMutations.restore`, which remain rejected until smx needs an
  external process to execute those mutation frames
- any operation that would require an external engine to receive
  callbacks, `Date` objects, mutable config documents, or filesystem
  write authority

Current compatibility evidence:

- module-port contract vectors exercise Ostrich behavior
- the local IPC dispatcher validates framed requests and operation
  results
- generated IPC schemas cover the supported JSON-safe operation shapes
- the external adapter rejects local-only payloads before exchange
- planned optimize mutation tests prove the internal bridge can replay
  completed, failed, and unknown apply/restore outcomes without
  duplicate execution

The next code step for Osprey/Owl should therefore not be "move all
observability out of process." It should be the smallest supervised
transport spike that can satisfy one ready port family end to end while
preserving the same module-port contract tests.

## Ostrich

Ostrich is the in-process TypeScript implementation. It is the improved
version of the current observability layer under
[../../../src/subsystems/observability/](../../../../src/subsystems/observability/).

Ostrich is the reference implementation. It keeps the current
local-first SQLite posture, preserves existing CLI/MCP behavior, and
defines correctness for future implementations. Where the contract is
underspecified, Ostrich's behavior is the expected behavior.

The Ostrich work remains behavior-preserving:

- Name the implementation boundary.
- Keep CLI/MCP production flows on module ports.
- Keep direct SQLite/service access inside Ostrich adapters and tests.
- Run coverage and boundary audits before moving implementation files.
- Avoid introducing an external plugin system unless a second
  implementation is real.

## Osprey

Osprey is the theoretical Java implementation. It would run out of
process and be supervised by smx through a TypeScript adapter.

Its appeal is JVM persistence and service engineering: mature database
libraries, strong concurrency primitives, well-understood long-running
worker behavior, and operational familiarity for JVM-heavy teams.

Osprey only makes sense if it preserves the same observability semantics
as Ostrich. It should not invent a separate telemetry product. It should
accept the same canonical facts, produce the same derived read models,
support equivalent repair and retention behavior, and report status
through the same smx-facing contract.

## Owl

Owl is the theoretical Rust implementation. It would also run out of
process behind a TypeScript adapter.

Its appeal is native startup, predictable memory use, low-overhead
streaming ingestion, strong compile-time modeling of data contracts, and
careful control over persistence paths.

Owl should be treated as a specialized observability engine, not a Rust
rewrite of smx. Smx remains the product and control plane. Owl, if built,
stores and serves observability data through the shared contract.

## How the docs fit together

Start here for the modular subsystem model.

- [tech-spec-for-modular-observability-subsystem.md](tech-spec-for-modular-observability-subsystem.md)
  is this document: the short root overview for the modular
  observability subsystem and the Ostrich / Osprey / Owl framing.
- [hypothetical-observability-modules.md](../plans-and-audits/hypothetical-observability-modules.md)
  is the longer architecture exercise for the three theoretical
  implementations.
- [tech-spec-for-observability-ipc-contract.md](../contracts/tech-spec-for-observability-ipc-contract.md)
  defines the future out-of-process adapter protocol for Osprey and Owl.
- [white-paper-on-observability-layer.md](white-paper-on-observability-layer.md)
  describes the current observability layer and canonical vocabulary.
- [tech-spec-for-observation-semantics.md](../contracts/tech-spec-for-observation-semantics.md)
  defines the semantic contract for persisted observations.
- [tech-spec-for-observability-store-schema.md](../store/tech-spec-for-observability-store-schema.md)
  documents the current SQLite schema.
- [tech-spec-for-observability-store-implementation.md](../store/tech-spec-for-observability-store-implementation.md)
  maps the current implementation files and maintenance paths.
- [tech-spec-for-gateway-observation-mapping.md](../contracts/tech-spec-for-gateway-observation-mapping.md)
  defines gateway runtime-to-observation mapping.
- [tech-spec-for-control-plane-audit-ledger.md](../contracts/tech-spec-for-control-plane-audit-ledger.md)
  defines the Ledger concept and table contract.
- [observability-coverage-audit.md](../plans-and-audits/observability-coverage-audit.md)
  is the Phase 0 safety audit that guided the behavior-preserving
  Ostrich carve-out and records the coverage baseline used for the
  current Phase 5 boundary.
- [ostrich-implementation-plan.md](../plans-and-audits/ostrich-implementation-plan.md)
  is the historical behavior-preserving plan for naming Ostrich and
  extracting the first boundary. It now includes a status update that
  maps the original ingestion-first plan to the completed broader
  Phase 5 carve-out.
- [observability-phase-5-framing.md](../plans-and-audits/observability-phase-5-framing.md)
  records the completed observability equivalent of the hot-path
  end-of-Phase-5 carve-out before any Osprey/Owl work.
- [observability-phase-4a-direct-access-audit.md](../plans-and-audits/observability-phase-4a-direct-access-audit.md)
  is the direct-access audit used before moving files under an
  Ostrich-owned implementation region; it now includes the Phase 5
  completion status.

## Current stopping point

The observability subsystem is now at the intended end-of-Phase-5
stopping point. Ostrich is named, implementation-owned files live under
`src/subsystems/observability/ostrich/`, remaining root files are
documented public facades/contracts/adapters, and import-boundary checks
guard the implementation regions with zero violations. No Osprey/Owl
runtime, engine switch, or external process supervisor exists.

The next behavior-preserving maintenance work is to keep this port map
and facade inventory current whenever new CLI/MCP surfaces are added or
new implementation files move. The shared module-port contract vectors
run through Ostrich and the local IPC dispatcher, and the external
adapter validates both requests and success results before an external
engine exists.

The generated IPC schemas now cover the safer read, history, cleanup,
report persistence, and external benchmark run surfaces. The JSON-safe
optimize mutation boundary in
[tech-spec-for-observability-ipc-contract.md](../contracts/tech-spec-for-observability-ipc-contract.md)
now has TypeScript command types, standalone validators, generated
schemas, deterministic idempotency keys, and a mapper from optimize
mutation plans into external apply/restore command payloads. The
idempotency repository and internal execution harness cover digest
comparison, accepted-key persistence, two-phase caller completion,
completed/failed replay, unknown completion, and digest-mismatch
rejection. The planned apply/restore bridge used by CLI and MCP has
coverage for completed replay, deferred caller completion, failed replay,
unknown-completion replay, and duplicate-execution prevention for both
apply and restore. CLI and MCP optimize apply/restore use that internal
bridge today. The next external transport step is intentionally deferred:
framed external apply/restore requests remain rejected at the operation
boundary until an Osprey/Owl transport needs to execute those mutation
frames.
