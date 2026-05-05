# Switchmaxxer Logging and Trace Surface

## Purpose

This document describes the logging and trace surface in the repository.

Use it when:

- debugging runtime behavior
- understanding how logs and persisted observability fit together
- checking which operator commands expose logs versus persisted traces

## Current Model

Switchmaxxer has two distinct observability surfaces:

1. **runtime logs**
2. **persisted observability**

Runtime logs are:

- line-oriented
- written to process output
- captured by journald when the gateway runs as a `systemd` service

Persisted observability is:

- SQLite-backed
- used for traces, benchmarks, verification, repair, and pruning
- queryable through CLI and MCP control-plane surfaces

These surfaces are complementary. Logs are the fast live-debug surface; the observability store is the durable inspection surface.

`smx invoke --inspect` is a third, deliberately narrower local debugging
surface. It captures one non-streaming invoke exchange in memory, renders the
client/proxied/upstream/returned request and response bodies and headers in the
CLI, and then discards the capture. It is not a log stream, trace record, or
persisted observability row.

## Runtime Logging

Runtime logging includes:

- startup logs
- warnings
- request lifecycle logs
- reload failure logs
- gateway/service logs accessible through:
  - `switchmaxxer gateway logs show`
  - `switchmaxxer gateway logs tail`

The effective service unit is configurable through:

- top-level `systemd_unit` in config
- `SWITCHMAXXER_UNIT`

## Log Levels

Log levels:

- `debug`
- `info`
- `warn`
- `error`

Precedence:

1. `switchmaxxer gateway run --log-level ...`
2. `SWITCHMAXXER_LOG_LEVEL`
3. config `log_level`
4. default `info`

The logger snapshots the normalized process log level at startup rather than re-reading it on every hot-path log call.
Later `process.env` changes do not silently change logging behavior mid-run; any in-process change must happen through an explicit runtime override path.

## Current Request Correlation

Switchmaxxer assigns a request id to proxied requests and uses it across:

- gateway request lifecycle logs
- persisted observations
- materialized request executions
- the response header:
  - `x-switchmaxxer-request-id`

This is the main correlation handle across live debugging and persisted trace inspection.

## Journald Surface

`switchmaxxer gateway logs show --format json` returns normalized log records rather than raw journald entries.

Common fields include:

- `timestamp`
- `event`
- `message`
- `request_id`
- `route`
- `provider`
- `model`
- `api_mode`
- `status_code`
- `latency_ms`
- `reason`
- `url`
- `pid`

This is a control-plane view over journald, not a second native Switchmaxxer log store.
Raw text logs use `latency=...ms` and `status=...`; the normalized JSON view
renames those fields to `latency_ms` and `status_code`.

## Persisted Observability Surface

Persisted observability surfaces include:

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

Retention pruning is an observability-store lifecycle operation. It is not
trace-only: it can remove old request traces, benchmark rows, cost facts,
optimization facts, Control Plane Audit Ledger rows, config mutation events,
and managed config snapshots. It does not delete `optimization_runs`; optimize
run history has its own cleanup commands. The canonical operator shape is
`switchmaxxer prune --older-than <duration>`.
`switchmaxxer trace prune` is intentionally not exposed because retention is not
trace-only.

Benchmark-history cleanup is surgical:
`switchmaxxer bench prune`, `switchmaxxer bench delete`, and
`switchmaxxer bench clear`. Those remove benchmark runs and samples only; they
do not delete the persisted request traces behind those benchmark samples.

Optimize-history cleanup has the same narrow shape:
`switchmaxxer optimize prune`, `switchmaxxer optimize delete`, and
`switchmaxxer optimize clear`. Those remove optimize runs plus optimize-owned
committed mutation records and orphaned managed snapshots; they do not delete
traces, benchmark rows, or Control Plane Audit Ledger rows. General control
plane action events, config mutation events, and snapshots are pruned only by
whole-store retention; optimize-history cleanup may touch only optimize-owned
restore data.

These surfaces are backed by:

- `observations`
- `request_executions`
- `benchmark_runs`
- `benchmark_samples`
- `optimization_runs`
- `control_plane_action_events`
- `config_snapshots`
- `config_mutation_events`
- `optimize_mutation_idempotency`
- `cost_facts`
- `optimization_facts`

## Canonical Observation Enums

Operators querying the SQLite observability store should treat the source enums
as the canonical contract for persisted observation rows.

### `OBSERVATION_EVENTS`

- `debug_ingress`
- `debug_route_resolution`
- `debug_upstream_request`
- `debug_upstream_retry`
- `debug_response_path`
- `debug_client_response`
- `debug_error_context`
- `request_received`
- `route_resolved`
- `upstream_request_started`
- `upstream_response_started`
- `upstream_response_completed`
- `client_response_started`
- `client_response_completed`
- `usage_counted`
- `cost_estimated`
- `benchmark_sample_attached`
- `optimization_inputs_recorded`
- `inspection_secret_reveal_requested`
- `rate_limited`
- `auth_failed`
- `auth_rate_limited`

### `OBSERVATION_KINDS`

- `debug`
- `measurement`
- `usage`
- `cost`
- `benchmark`
- `optimization`
- `system`
- `error`

### `OBSERVATION_OUTCOMES`

- `started`
- `in_progress`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`
- `rejected`
- `partial`
- `unknown`

### `OBSERVATION_STAGES`

- `ingress`
- `route_resolution`
- `listener_compatibility`
- `request_shaping`
- `upstream_request`
- `upstream_fetch`
- `upstream_response`
- `response_translation`
- `response_stream`
- `client_response`
- `cost`
- `optimization`

## Current Limits

The logging/trace posture is intentionally modest:

- runtime logs are still human-readable first
- there is no native file-log subsystem
- benchmark, cost, and optimization facts exist in the store, but not every possible higher-order analysis surface is exposed yet
- the observability store uses Node's experimental `node:sqlite` backend
- Node 22+ is required for those observability-backed surfaces
- short-lived CLI and MCP observability reads suppress Node's experimental SQLite warning so machine-readable output stays clean; the gateway server may still show that warning during startup or restart

## Recommended Reading Order

For most operator debugging:

1. `switchmaxxer gateway logs show|tail`
2. `switchmaxxer trace list|show|observations`
3. `switchmaxxer bench show` when the issue is benchmark-specific

For deeper contracts, also see:

- [tech-spec-for-gateway.md](../../gateway/tech-spec-for-gateway.md)
- [white-paper-on-observability-layer.md](white-paper-on-observability-layer.md)
