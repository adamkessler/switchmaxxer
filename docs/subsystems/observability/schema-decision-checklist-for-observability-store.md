# Observability Store Design Checklist

## Purpose

This checklist records the design constraints that the current observability store is expected to satisfy.

Use it when:

- reviewing schema changes
- checking whether a new persisted field belongs in the store
- keeping the store aligned with CLI and MCP observability surfaces

## Current Design Rules

### 1. One Store, Multiple Read Surfaces

The observability subsystem uses one SQLite store for:

- traces
- request summaries
- benchmarks
- cost facts
- optimization facts

### 2. Observations Are Canonical

`observations` is the canonical event table.

Other request-oriented views derive from it.

### 3. Request Executions Are Summaries

`request_executions` is a derived summary surface, not the canonical event log.

### 4. Synthetic Benchmark Rows Must Stay Distinct

Synthetic benchmark telemetry may share the store, but it must stay distinguishable from gateway request telemetry through explicit fields such as `surface`.

### 5. Referential Integrity Lives In The DB

Child tables that point at `request_executions(id)` should rely on foreign keys and `ON DELETE CASCADE`, not only application delete ordering.

### 6. Maintenance Must Be Bounded

Whole-store verify and repair paths must support bounded batching rather than one unbounded walk.

### 7. Retention Is A Standing Policy

When retention is configured, the gateway should continue applying it over time rather than pruning only once.

### 8. CLI And MCP Must Share Observability Contracts

If CLI exposes a trace/benchmark maintenance or inspection knob that is meant to be machine-usable, MCP should expose the same contract unless there is a deliberate reason to keep MCP narrower.

### 9. Counts Must Be Strict

List cardinality and deleted-row counts should use distinct fields and names. Avoid overloading generic `count`.

### 10. Pre-Release Simplicity Wins

Because the codebase is still under active development with no external install base, prefer:

- a clean current schema snapshot
- clear integrity rules
- easy local DB reset

over carrying unnecessary long-lived schema-management complexity.
