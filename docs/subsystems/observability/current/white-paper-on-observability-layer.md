# Switchmaxxer Observability Layer

## Purpose

This document describes the current observability subsystem in the repository.

Use it when:

- understanding how Switchmaxxer persists request telemetry
- grounding trace and benchmark behavior in the shared data model
- separating gateway hot-path work from control-plane observability work

## Core Vocabulary

This subsystem has a few similarly shaped words. Use them consistently so a
new reader can tell whether a sentence is talking about runtime output,
persisted telemetry, a measured run, or an optimization recommendation.

The recommended mental model is:

```text
observations -> traces -> benchmark runs -> optimize runs
```

Canonical wording:

- An **observation** is a raw structured event.
- A **trace** is a request-level story built from observations.
- A **benchmark run** is a measurement session built from traced requests.
- An **optimize run** is a persisted recommendation report, sometimes built
  from a benchmark run.

Use **logs** for human-readable process output. Use **observations** for the
structured rows in the SQLite observability store. Do not call observations
"logs"; they have different storage, lifecycle, and query behavior.

### Vocabulary Table

| Term | Use? | Meaning and guidance |
| --- | --- | --- |
| `log`, `logs`, `logging` | Yes | Human-readable runtime/process output such as journald lines, CLI debug output, warning messages, and gateway logs. Logs can mention request ids, but they are not the SQLite source of truth. |
| `observation`, `observations` | Yes | Raw structured event rows in the observability store. This is the smallest durable telemetry unit. |
| `observing` | Mostly avoid | Too vague for docs. Prefer "recording observations", "observability instrumentation", or "querying the observability store". |
| `observability subsystem` | Yes | The full persisted telemetry subsystem. This includes observations, request executions, benchmark history, optimize history, config mutation events, snapshots, and retention. |
| `observability store` | Yes | The SQLite database backing the observability subsystem. |
| `request execution` | Yes | The derived per-request summary built from observations. Benchmark samples can point at request executions. |
| `trace`, `traces`, `tracing` | Yes | Request-level view built from observations. A trace tells the story of one request/request id. |
| `bench` | Yes, as a command name | The CLI/MCP command family: `smx bench`, `bench_run`, `bench_show`, and related surfaces. In prose, prefer "benchmark run" for persisted history. |
| `benches` | Avoid | Awkward and unclear. Say "benchmark runs". |
| `benchmark` | Yes | Measurement concept. Good as an adjective: benchmark run, benchmark sample, benchmark history. |
| `benchmarks` | Sometimes | Fine generically, but prefer "benchmark runs" when talking about persisted rows. |
| `benchmark run`, `benchmark runs` | Yes, canonical | Persisted measurement sessions in `benchmark_runs`. A benchmark run contains benchmark samples and can be used by latency optimization. |
| `benchmarking` | Yes | The activity/process of measuring route performance. |
| `optimize` | Yes, as a command name | The CLI/MCP command family and action: `smx optimize`, `optimize_run`, `optimize_show`, and related surfaces. |
| `optimizes` | Avoid | Usually awkward. Say "optimization chooses", "optimize ranks", or "the optimize command records". |
| `optimizing` | Use sparingly | Generic activity, not an entity. Prefer "optimization" for the concept and "optimize run" for the persisted report. |
| `optimization` | Yes | General concept: objective selection, scoring, ranking, and recommendation behavior. |
| `optimations` | Avoid | Not a project word. |
| `optimize run`, `optimize runs` | Yes, canonical | Persisted recommendation reports created by `smx optimize`. Use this instead of "optimization run" when referring to records. |
| `optimizing run`, `optimizing runs` | Avoid | Sounds like an active process, not a stored entity. Say "optimize run". |
| `optimization run`, `optimization runs` | Avoid or secondary | Understandable, but less aligned with the command name. Prefer "optimize run". |
| `config mutation event` | Yes | A persisted record of a config-changing action, such as optimize apply or optimize restore. |
| `config snapshot` | Yes | Managed snapshot content stored in SQLite for restore/audit behavior. |
| `optimization mutation` | Avoid | Too ambiguous. Say "optimize apply", "optimize restore", or "optimize-owned config mutation event". |

### Dependency Chain

Tracing is the foundation for request-level telemetry. It builds on gateway and
proxy instrumentation that records observations, then materializes a
request-level summary into `request_executions`.

Benchmarking builds on tracing. A benchmark run sends measured requests through
routes, records benchmark samples, and can link those samples back to request
executions for deeper inspection.

Optimization builds on benchmark machinery when the objective needs live
measurement. Latency optimization creates or uses a benchmark run, then ranks
routes from the measured samples. Cost optimization does not need live
benchmarking; it scores routes from catalog rate cards and the selected
reference token workload.

Optimize apply and restore are not new optimize runs. They are config mutation
actions associated with an optimize run. Those actions are recorded as
config mutation events and use managed config snapshots in the observability
store.

### Cleanup Wording

Cleanup language should follow the entity being cleaned:

- **whole-store prune**: `smx prune --older-than 30d`, which applies general
  observability retention across supported entities.
- **benchmark-history cleanup**: `smx bench prune`, `smx bench delete`, and
  `smx bench clear`, which target benchmark runs and benchmark samples.
- **optimize-history cleanup**: `smx optimize prune`, `smx optimize delete`,
  and `smx optimize clear`, which target optimize runs and optimize-owned
  action history.

Do not document `trace prune`. Trace-only cleanup is misleading because traces
are built from observations and request executions inside the shared
observability store. Trace retention should happen through whole-store prune.

## Current Architecture

Switchmaxxer keeps the hot path lean and persists selected telemetry into one shared store.

Current shape:

- the gateway emits request-path observations
- the observability service persists canonical observation rows
- per-request summaries are materialized into `request_executions`
- benchmarks, optimize command history, cost facts, and optimization facts share the same store
- control-plane surfaces query and maintain that store

This avoids split persistence systems for traces, benchmarks, optimize-history,
and derived request facts.

## Current Store Shape

The current store contains these main tables:

- `observations`
- `request_executions`
- `benchmark_runs`
- `benchmark_samples`
- `optimization_runs`
- `config_snapshots`
- `config_mutation_events`
- `cost_facts`
- `optimization_facts`
- metadata tables used by the local SQLite store

Important current integrity rule:

- dependents of `request_executions(id)` now use `ON DELETE CASCADE` in the schema

## Current Ingestion Model

The current gateway ingestion model records:

- request lifecycle milestones
- route/provider/model identity
- timing fields
- status/outcome data
- request-path debug and measurement events

Synthetic benchmark rows live in the same store but are distinguished by `surface: "benchmark"`.

## Current Operator Surfaces

CLI:

- `switchmaxxer trace list`
- `switchmaxxer trace stats`
- `switchmaxxer trace observations`
- `switchmaxxer trace show`
- `switchmaxxer trace verify`
- `switchmaxxer trace repair`
- `switchmaxxer prune`
- `switchmaxxer ledger list`
- `switchmaxxer ledger show`
- `switchmaxxer bench list`
- `switchmaxxer bench show`
- `switchmaxxer bench prune`
- `switchmaxxer bench delete`
- `switchmaxxer bench clear`
- `switchmaxxer optimize`
- `switchmaxxer optimize list`
- `switchmaxxer optimize show`
- `switchmaxxer optimize apply`
- `switchmaxxer optimize restore`
- `switchmaxxer optimize prune`
- `switchmaxxer optimize delete`
- `switchmaxxer optimize clear`

MCP:

- `trace_list`
- `trace_stats`
- `trace_observations`
- `trace_show`
- `trace_verify`
- `trace_repair`
- `prune`
- `ledger_list`
- `ledger_show`
- `bench_list`
- `bench_show`
- `bench_run`
- `optimize_run`
- `optimize_list`
- `optimize_show`
- `optimize_apply`
- `optimize_restore`

## Current Maintenance Model

Current maintenance tools:

- verification
- repair
- observability-store retention pruning

Retention command map:

| Command family | Canonical wording | What it removes |
| --- | --- | --- |
| `switchmaxxer prune` / `smx prune` | whole-store prune | Observability records eligible under the configured retention policy, including traces, benchmark rows, facts, Control Plane Audit Ledger rows, config mutation events, and snapshots. Optimize run history is cleaned up by `switchmaxxer optimize ...`, not by whole-store prune. |
| `switchmaxxer bench ...` / `smx bench ...` | benchmark-history cleanup | Benchmark runs and benchmark samples only |
| `switchmaxxer optimize ...` / `smx optimize ...` | optimize-history cleanup | Optimize runs plus optimize-owned apply/restore events and orphaned managed snapshots |

Current retention posture:

- retention pruning is a whole-store lifecycle operation, not a trace-only
  operation
- the canonical CLI shape is
  `switchmaxxer prune --older-than <duration>`
- `switchmaxxer trace prune` is intentionally not exposed in the CLI
- the canonical MCP tool is `prune`
- config-driven retention can run at gateway startup and periodically while the gateway is running
- benchmark-history cleanup is surgical CLI cleanup through
  `switchmaxxer bench prune`, `switchmaxxer bench delete`, and
  `switchmaxxer bench clear`; these commands delete benchmark runs and samples
  without deleting the underlying request traces
- optimize-history cleanup is similarly surgical through
  `switchmaxxer optimize prune`, `switchmaxxer optimize delete`, and
  `switchmaxxer optimize clear`; these commands delete optimize runs plus
  optimize-owned apply/restore events and orphaned managed snapshots without
  deleting traces or benchmark rows
- general config mutation events and snapshots are pruned only by whole-store
  retention; optimize-history cleanup may touch only optimize-owned
  apply/restore history

Whole-store verify and repair support bounded batching rather than one unbounded pass.

## Current Limits

The observability subsystem is real and usable, but intentionally scoped:

- it is SQLite-backed and local-first
- it is not a separate distributed telemetry backend
- it is not a browser analytics system
- it is not a multi-tenant audit platform

For exact schema and field-level semantics, also see:

- [tech-spec-for-observability-store-schema.md](../store/tech-spec-for-observability-store-schema.md)
- [field-matrix-for-observability-store.md](../store/field-matrix-for-observability-store.md)
- [tech-spec-for-observation-semantics.md](../contracts/tech-spec-for-observation-semantics.md)
