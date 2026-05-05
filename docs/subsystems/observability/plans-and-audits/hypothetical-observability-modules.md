# Hypothetical Observability Modules: Ostrich, Osprey, Owl

> A design exercise for factoring Switchmaxxer's observability subsystem
> behind explicit contracts, with three implementations:
>
> - **Ostrich** — in-process TypeScript, evolved from the current
>   observability layer.
> - **Osprey** — out-of-process Java.
> - **Owl** — out-of-process Rust.
>
> This is design exploration, not an implementation commitment. The aim
> is to expose the contracts all three would share, the risks of making
> observability modular, and the places where modularity is useful even
> if Ostrich remains the only implementation.

## 1. Framing

The current observability subsystem is local-first, SQLite-backed, and
implemented in TypeScript. It persists canonical observations,
materializes request executions, stores benchmark and optimize history,
records control-plane audit ledger rows, and exposes query/maintenance
surfaces through CLI and MCP.

The hypothesis behind modularizing it:

- Observability has a semantic contract that is larger than SQLite:
  observations, traces, benchmark runs, optimize runs, ledger rows,
  pruning, repair, and schema status all have product meaning.
- The current in-process implementation should remain the default,
  because local SQLite is simple and good enough for the common case.
- Alternative engines are plausible only if they preserve the same
  semantics and are hidden behind smx-side adapters.
- The contract should be split by responsibility. A single giant
  `Observability` interface would obscure the fact that ingestion,
  query, maintenance, and store lifecycle have different risk profiles.

The big picture:

```text
                         smx
   gateway   CLI   MCP   bench   optimize   config mutation
      |       |     |      |        |              |
      +-------+-----+------+--------+--------------+
                              |
                              v
                  Observability contracts
      ingestion | query | maintenance | lifecycle
                              |
        +---------------------+---------------------+
        |                     |                     |
     Ostrich               Osprey                  Owl
  in-process TS       Java child process     Rust child process
```

Ostrich implements the contracts directly. Osprey and Owl are external
engines supervised by smx. Their smx-side adapters implement the
TypeScript contracts and translate calls over an IPC boundary.

## 2. Contract areas

### 2.1 Ingestion

The ingestion contract accepts typed facts from producers:

- gateway request lifecycle observations
- benchmark observations and samples
- optimize run records
- control-plane action events
- committed config mutation events
- managed config snapshots
- cost and optimization facts

It owns validation, redaction, payload bounds, batching, write ordering,
backpressure policy, and failure reporting.

Ingestion is the most likely first modular boundary because it is where
runtime pressure shows up. The gateway must not block indefinitely on
observability persistence, but dropped or degraded writes must still be
visible to operators.

### 2.2 Query

The query contract serves stable read models:

- trace lists and trace details
- raw observations for a request
- request execution summaries
- request stats
- benchmark run history
- optimize run history
- ledger list/show results
- config mutation and snapshot views used by restore workflows

Query modularity is risky because CLI and MCP behavior depends on exact
shape, filtering, sorting, limits, and error envelopes. It should follow
ingestion, not lead it.

### 2.3 Maintenance

The maintenance contract owns:

- verify
- repair
- whole-store prune
- benchmark-history cleanup
- optimize-history cleanup
- schema/store status checks

Maintenance behavior is semantically important. Repair must not invent
facts that contradict canonical observations. Feature-specific cleanup
must not delete unrelated history. Whole-store retention must retain the
same category rules no matter which implementation backs the store.

### 2.4 Store lifecycle

The lifecycle contract owns opening, initializing, draining, shutting
down, and reporting implementation health.

For Ostrich, lifecycle means opening local SQLite, applying the schema,
starting any gateway observation worker, and closing cleanly. For Osprey
and Owl, lifecycle also means spawning a child process, negotiating a
protocol version, sending configuration, and handling crashes.

## 3. Shared invariants

All implementations must preserve these invariants:

- Observations are canonical append-oriented records.
- Request executions are derived from observations.
- Debug events and measurement milestones remain separate concepts.
- Persisted data is redacted or safely summarized by default.
- Config snapshots stored for restore/audit are secret-safe.
- Benchmark history cleanup does not delete underlying request traces.
- Optimize-history cleanup touches only optimize-owned history and
  orphaned managed snapshots.
- Control Plane Audit Ledger rows remain under whole-store retention.
- Incompatible schema or protocol versions fail closed.
- Operator-facing CLI/MCP output remains stable across implementations.

These invariants are more important than implementation language. Osprey
or Owl is only a valid implementation if it can pass the same semantic
tests as Ostrich.

## 4. Ostrich

Ostrich is the improved in-process TypeScript implementation. It is the
current observability subsystem made explicit: named contracts, clearer
file ownership, stronger tests around boundaries, and less incidental
coupling between producers and the SQLite implementation.

Ostrich's strengths:

- Always available in every smx checkout.
- No IPC boundary.
- Easiest implementation to debug and test.
- Direct access to current TypeScript types.
- Best fit for local-first development.

Ostrich's costs:

- Shares smx's event loop and process failure domain.
- Uses Node's SQLite binding and local store posture.
- Can accidentally leak implementation details into smx callers unless
  the contract boundary is enforced.

Ostrich should be the correctness reference. Future Osprey and Owl work
should compare against Ostrich behavior before claiming compatibility.

## 5. Osprey

Osprey is the theoretical Java implementation. It would run as a child
process supervised by smx. A TypeScript `OspreyAdapter` would implement
the smx-facing contracts, send commands to the child, and stream status
or observations back as needed.

Osprey's appeal:

- Mature database and persistence libraries.
- Strong worker and queue patterns.
- Good fit for long-running background maintenance.
- Useful for teams that prefer JVM operations.
- Potential to package as a JVM app, bundled runtime, or native image.

Osprey's risks:

- More distribution complexity than Ostrich.
- Protocol and schema compatibility become release-management problems.
- Query shape drift is easy if Java models evolve separately from TS
  contracts.
- The value is questionable unless observability volume or operational
  needs exceed what Ostrich can comfortably handle.

Osprey should be opt-in. If it is unavailable, smx should continue with
Ostrich rather than refusing to start.

The external process boundary is specified separately in
[tech-spec-for-observability-ipc-contract.md](../contracts/tech-spec-for-observability-ipc-contract.md).

## 6. Owl

Owl is the theoretical Rust implementation. It would also run as a child
process behind a TypeScript adapter.

Owl's appeal:

- Low overhead for high-volume ingestion.
- Predictable memory profile.
- Strong type modeling for persisted contracts.
- Native startup and deployment profile.
- Good fit for strict bounds checks and streaming parsers.

Owl's risks:

- Higher implementation cost for the full query/maintenance surface.
- More careful FFI/IPC protocol design.
- Harder contributor ramp for a TypeScript-first project.
- Schema and semantic drift if the Rust model is not generated from, or
  continuously checked against, the shared contract.

Owl is attractive only if observability needs become performance- or
reliability-sensitive enough to justify a native engine.

## 7. Selection and fallback

Configuration should eventually be able to choose an implementation:

```jsonc
"observability": {
  "engine": {
    "kind": "ostrich" | "osprey" | "owl",
    "binary": "/optional/path/for/external/engines"
  }
}
```

This is intentionally future-looking. The current configuration should
not grow a switch until there is at least one implementation to switch
to or a concrete adapter under construction.

Fallback rule:

- Ostrich is always available.
- Osprey and Owl are optional.
- If an optional implementation is selected but unavailable, smx should
  fall back to Ostrich with a clear warning unless the operator
  explicitly requested fail-closed behavior.

## 8. Recommended path

1. Write the modular root spec.
2. Write this architecture exercise.
3. Produce `observability-coverage-audit.md`, scoped by contract area.
4. Draft an Ostrich implementation plan that is behavior-preserving.
5. Add contract types only where a boundary is about to be enforced.
6. Extract Ostrich internally before designing external-process IPC.
7. Consider Osprey or Owl only when there is a concrete performance,
   reliability, or operational requirement.

The IPC shape for that future work is captured in
[tech-spec-for-observability-ipc-contract.md](../contracts/tech-spec-for-observability-ipc-contract.md).

The first real engineering decision is not Java versus Rust. It is
which contract area deserves a boundary first. The best candidate is
usually ingestion, because it is closest to runtime pressure and already
has a natural queue, flush, worker, and persistence shape.

## 9. Glossary

- **Ostrich** — the in-process TypeScript implementation of the modular
  observability contracts. It evolves from the current observability
  layer and remains the default.
- **Osprey** — a theoretical Java implementation, supervised by smx
  through a TypeScript adapter.
- **Owl** — a theoretical Rust implementation, supervised by smx through
  a TypeScript adapter.
- **Observation** — the smallest canonical persisted telemetry fact.
- **Trace** — a request-level story built from observations.
- **Request execution** — the derived per-request summary built from
  observations.
- **Benchmark run** — a persisted measurement session.
- **Optimize run** — a persisted recommendation report.
- **Control Plane Audit Ledger** — persisted control-plane attempt
  history stored as `control_plane_action_events`.
- **Ingestion contract** — the write-side contract for accepting,
  validating, batching, and persisting observability facts.
- **Query contract** — the read-side contract for traces, benchmark
  history, optimize history, ledger rows, and derived facts.
- **Maintenance contract** — verify, repair, prune, cleanup, and schema
  status behavior.
