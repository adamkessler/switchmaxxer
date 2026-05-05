# Tech Spec for Benchmarking

## 1. Purpose

This document defines the benchmarking surface in the Switchmaxxer observability subsystem: what `bench` runs measure, how runs and samples are persisted, what guarantees the report shape carries, and how the CLI `bench` family and the MCP `bench_*` tools share a single execution runtime.

Use it when:

- implementing or modifying the `bench-runtime`, `bench-route-selection`, `bench-execution-validation`, `bench-limits`, or `bench-path-mode` modules
- changing the `benchmark_runs` or `benchmark_samples` SQLite tables
- adding or renaming flags on `switchmaxxer bench`, `switchmaxxer bench list`, `switchmaxxer bench show`, `switchmaxxer bench prune`, `switchmaxxer bench delete`, or `switchmaxxer bench clear`
- adding or renaming arguments on the MCP `bench_run`, `bench_list`, or `bench_show` tools
- changing what fields land in the bench report envelope (`run`, `execution`, `summary`, `analysis.by_path`, `samples`)
- reviewing whether a new benchmark feature belongs in this subsystem

This spec is narrower than [white-paper-on-observability-layer.md](../current/white-paper-on-observability-layer.md). The white paper explains the broader observability architecture. This document defines the strict bench-only contract.

For project-wide vocabulary, especially the dependency chain
`observations -> traces -> benchmark runs -> optimize runs`, see
[white-paper-on-observability-layer.md §Core Vocabulary](../current/white-paper-on-observability-layer.md#core-vocabulary).
In this spec, "run" means a benchmark run unless explicitly qualified.

This spec is also narrower than [tech-spec-for-observation-semantics.md](tech-spec-for-observation-semantics.md): bench results are persisted *into* the observability store, but the bench report envelope, the bench limits, and the bench task plan are concerns of this document.

## 2. Scope

In scope:

- bench task planning (route × path × warmup × measured iteration)
- bench execution per task (gateway path and direct-upstream path)
- bench observability persistence (`benchmark_runs`, `benchmark_samples`, and synthetic observation rows)
- bench preflight (when the gateway path is requested)
- bench cancellation semantics (SIGINT in CLI, abort signal in MCP, wall-clock timeout in MCP)
- bench limits and validation contracts shared between CLI and MCP
- bench report shape (`BenchmarkReportView` and its inner views)
- the CLI `bench`, `bench list`, `bench show`, `bench prune`, `bench delete`, `bench clear` commands and the MCP `bench_run`, `bench_list`, `bench_show` tools

Out of scope:

- general observation ingestion (covered by [tech-spec-for-gateway-observation-mapping.md](tech-spec-for-gateway-observation-mapping.md))
- observability store schema and storage internals beyond the two bench tables (covered by [tech-spec-for-observability-store-schema.md](../store/tech-spec-for-observability-store-schema.md) and [tech-spec-for-observability-store-implementation.md](../store/tech-spec-for-observability-store-implementation.md))
- live gateway request observability (covered by [tech-spec-for-observation-semantics.md](tech-spec-for-observation-semantics.md))
- model-capability benchmarking (out of scope for the product entirely; see [../../architecture/industry-directions.md](../../../architecture/industry-directions.md) §Adjacent Category: LLM Benchmarking)

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **bench** | a single invocation of `switchmaxxer bench` or the MCP `bench_run` tool |
| **run** | a persisted `benchmark_runs` row representing one bench invocation. A bench run is a separate entity from an optimize run (`optimization_runs`); see [tech-spec-for-optimize-command.md §5.1](./tech-spec-for-optimize-command.md#51-bench-runs-vs-optimize-runs-are-different-entities) for the contrast. |
| **sample** | a persisted `benchmark_samples` row representing one task-level result inside a run |
| **task** | one (route, path, iteration, warmup-or-measured) tuple inside the run plan |
| **route** | a configured `routes` entry; bench targets one route or a comma-separated set |
| **path** | the request path used to reach the upstream model: `gateway` or `direct` |
| **path mode** | the operator's selection of which paths to run: `gateway`, `direct`, or `both` (default) |
| **warmup** | a non-measured task whose latency is recorded but not aggregated into the run summary |
| **measured** | a task whose latency, ttft, duration, and outcome are aggregated into the run summary |
| **preflight** | the gateway-health check that must succeed before any `gateway`-path tasks run |

## 4. Surfaces

### 4.1 CLI

| Command | Capability | Behavior |
|---|---|---|
| `switchmaxxer bench [flags]` | runs a bench | parses flags, plans tasks, executes, persists, prints a text report or a JSON envelope |
| `switchmaxxer bench list [--limit n] [--json]` | reads bench history | lists persisted runs, newest-first, default limit 25, capped at 200 |
| `switchmaxxer bench show <run-id> [--json]` | reads one run | shows the full report (run header, execution context, summary, by-path analysis, samples) |
| `switchmaxxer bench prune --older-than <duration> [--json]` | prunes bench history | deletes benchmark runs older than the cutoff and their samples |
| `switchmaxxer bench delete <run-id> [--json]` | deletes one run | deletes one benchmark run and its samples |
| `switchmaxxer bench clear [--json]` | clears bench history | deletes all benchmark runs and samples |

`smx` is the official short operator alias and accepts every form above as `smx bench …`.

`bench` flags:

| Flag | Purpose |
|---|---|
| `--route <route-id>` | benchmark exactly one route |
| `--routes <csv>` | benchmark a comma-separated set of routes (mutually exclusive with `--route`) |
| `--prompt <text>` | inline prompt for the workload (mutually exclusive with `--file`) |
| `--file <path>` | read prompt text from a file |
| `--iterations <n>` | number of measured iterations per (route, path); default 3 |
| `--warmup <n>` | number of warmup iterations per (route, path); default 1 |
| `--concurrency <n>` | number of concurrent worker tasks; default 1 |
| `--path <gateway\|direct\|both>` | path-selection mode; default `both` |
| `--timeout-ms <n>` | per-request HTTP timeout (also affects bench preflight) |
| `--config <path>` | override config path |
| `--output <path>` | also write the report to a file (text or JSON depending on `--json`) |
| `--json` | emit a stable JSON envelope to stdout |

`bench prune` adds `--older-than <duration>`, using the same `<number>m|h|d|w`
duration grammar as the top-level observability `prune` command.

### 4.2 MCP

| Tool | Capability | Behavior |
|---|---|---|
| `bench_list` | `read` | mirrors `switchmaxxer bench list` |
| `bench_show` | `read` | mirrors `switchmaxxer bench show` |
| `bench_run` | `privileged` | mirrors `switchmaxxer bench` |

`bench_run` arguments mirror CLI flags with snake_case names: `prompt`, `route_id`, `routes`, `iterations`, `warmup`, `concurrency`, `path_mode` (default `both`), `timeout_ms`. The schema enforces `oneOf` between `route_id` and `routes`.

`bench_run` tool input is not CLI syntax. MCP clients must send `route_id` or
`routes`, not `route`, `model`, `--route`, or `--routes`. There is no implicit
default route; the route selector is required at the typed boundary.

`bench_run` is `privileged` because it executes outbound HTTP requests against upstream providers and writes new rows into the observability store. `bench_list` and `bench_show` are `read` because they only read persisted rows.

### 4.3 Surface parity

The two surfaces share a single execution runtime ([src/subsystems/bench/bench-runtime.ts](../../../../src/subsystems/bench/bench-runtime.ts)) and a single set of public input-validation facades ([bench-execution-validation.ts](../../../../src/subsystems/observability/bench-execution-validation.ts), [bench-route-selection.ts](../../../../src/subsystems/observability/bench-route-selection.ts), [bench-limits.ts](../../../../src/subsystems/observability/bench-limits.ts), [bench-path-mode.ts](../../../../src/subsystems/observability/bench-path-mode.ts)). The implementation lives under [ostrich/benchmark](../../../../src/subsystems/observability/ostrich/benchmark). Behavioral differences:

- error envelopes use the canonical CLI/MCP error codes per [contracts/tech-spec-for-mcp-cli-contract.md](../../../contracts/tech-spec-for-mcp-cli-contract.md)
- the CLI traps `SIGINT` and propagates it through an `AbortController` with a 5-second drain window; the MCP tool wires the session abort signal and additionally enforces a wall-clock cap (default 15 minutes; overridable via `SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS`)
- the CLI allows `--output <path>` to mirror the report to a file; MCP returns the report only inside the success envelope
- the surgical cleanup commands (`bench prune`, `bench delete`, `bench clear`) are CLI-only for now; MCP has the canonical whole-store `prune` tool but no benchmark-specific delete/clear tools

## 5. Configuration

The bench subsystem reads two named blocks from `config.json`:

- `benchmark` — defaults applied to every bench request
- `routes` — the route catalog; bench resolves `--route`/`--routes` against it

`benchmark` block, validated by [validateBenchmarkSettings()](../../../../src/subsystems/config/config-validators-gateway.ts):

| Field | Default | Meaning |
|---|---|---|
| `default_max_tokens` | `32` | injected as `max_tokens` (anthropic) or `max_completion_tokens` (openai) on every bench request body |
| `default_anthropic_version` | `"2023-06-01"` | injected as `anthropic-version` header on direct-path Anthropic-mode requests when the route does not override |

These defaults are intentionally small: bench is for measuring infrastructure (latency, throughput, error behavior), not for measuring model output quality.

The route used by a bench task contributes its `api_mode`, `model`, `baseUrl`, `serviceProvider`, `timeoutMs`, and (for direct-path Anthropic requests) optional `anthropicVersion`.

## 6. Task Planning

### 6.1 Route selection

[bench-route-selection.ts](../../../../src/subsystems/observability/bench-route-selection.ts) is the public facade for the Ostrich benchmark route-selection helper. It normalizes the operator's selection into a non-empty `routeNames: string[]`. Issues are reported as one of:

- `conflicting_selectors` — both `--route`/`route_id` and `--routes`/`routes` were given
- `missing_selector` — neither was given
- `invalid_route_list` — array form was given but is empty or contains a blank entry
- `too_many_routes` — count exceeds `BENCH_MAX_ROUTES`

The CLI maps these to usage errors with the appropriate `MCP_USAGE_ERROR_CODES` value; the MCP layer raises `invalidInputFieldError` with the same mapping.

### 6.2 Path selection

[bench-path-mode.ts](../../../../src/subsystems/observability/bench-path-mode.ts) is the public facade for the Ostrich benchmark path-mode guard. It defines exactly three values: `"gateway"`, `"direct"`, `"both"`. `isBenchPathModeValue()` is the single guard. Any other value is a usage error.

`buildBenchTasks()` expands path mode into a path list (`["gateway"]`, `["direct"]`, or `["gateway", "direct"]`) and emits tasks in this canonical order:

```
for each route in routeNames:
  for each path in paths:
    for warmup in 1..warmup:
      emit task(sample_index++, route, path, warmup, isWarmup=true)
    for iteration in 1..iterations:
      emit task(sample_index++, route, path, iteration, isWarmup=false)
```

`sample_index` is monotonically increasing across the entire run and is the canonical ordering key for samples.

### 6.3 Plan size cap

`assertBenchmarkTaskPlanSize()` rejects plans where `routeCount × pathCount × (warmup + iterations)` exceeds `BENCH_MAX_TOTAL_TASKS` (50,000). The check runs both before preflight (with the requested path mode) and after preflight (with the effective path mode), so degraded plans are revalidated.

### 6.4 Per-axis caps

Defined through the public [bench-limits.ts](../../../../src/subsystems/observability/bench-limits.ts) facade:

| Cap | Value | Enforces |
|---|---|---|
| `BENCH_MAX_ITERATIONS` | 500 | upper bound on `--iterations` / `iterations` |
| `BENCH_MAX_CONCURRENCY` | 16 | upper bound on `--concurrency` / `concurrency` |
| `BENCH_MAX_PROMPT_LENGTH` | 65536 | upper bound on prompt size in characters |
| `BENCH_MAX_ROUTES` | 32 | upper bound on routes per run |
| `BENCH_MAX_TOTAL_TASKS` | 50000 | upper bound on the total expanded plan |

Error messages are deliberately surface-aware: the same cap renders as `'bench'` in CLI output and `'bench_run'` in MCP output so operators can tell which surface raised the failure.

## 7. Preflight

When the requested path mode includes `gateway`, the runtime calls `preflightGatewayRouteTests()` (CLI) or `preflightGatewayBench()` (MCP). Both produce the same `BenchmarkPreflightResult` shape:

- `ok: true` → returns `bindHost`, `port`, `probeHost`, `healthUrl`, `pid`, and `latencyMs`
- `ok: false` with `code: "invalid_config"` → config could not be loaded
- `ok: false` with `code: "gateway_unavailable"` → gateway is not responding to `/health`

`resolveBenchmarkExecutionPlan()` then maps the preflight outcome to one of:

| Requested path mode | Preflight ok | Result |
|---|---|---|
| `direct` | (not run) | run direct-only |
| `gateway` | yes | run gateway-only |
| `gateway` | no | hard fail with the preflight code/message |
| `both` | yes | run both paths |
| `both` | no | run direct-only with a `BenchmarkExecutionWarning` describing the skipped gateway path |

The warning is persisted into `benchmark_runs.settings_json` and surfaced in the report envelope under `execution.warnings`.

## 8. Execution

### 8.1 Concurrency

`runTasksWithConcurrency()` runs at most `concurrency` workers, each pulling tasks from a shared cursor. Worker failures propagate as a single rejection (`Promise.allSettled`-then-throw-first-rejection). The function is the only concurrency primitive bench uses; there is no per-route or per-path queue.

### 8.2 Gateway path

For each `gateway`-path task:

1. build the request body in OpenAI or Anthropic dialect from the route's `api_mode`
2. resolve the local gateway URL via `buildLocalHttpUrl(probeHost, port, path)`
3. attach inbound auth headers from `buildLocalGatewayAuthHeaders()` (or none if the gateway is in explicit unauthenticated mode)
4. POST through `fetchWithSwitchmaxxerTransport()` with `timeoutMs = route.timeoutMs`
5. if the response carries `x-switchmaxxer-request-id`, wait briefly (up to 8 polls × 25 ms) for the matching `request_executions` row written by the gateway
6. if the live row is unavailable (no header, polling timed out, or the gateway returned an error), record a synthetic execution (see §8.4)

Provider auth for gateway-path samples is resolved by the running gateway
process. If a gateway path can invoke a route successfully, it usually means
the gateway service has the required provider env var or secrets file loaded.

### 8.3 Direct path

For each `direct`-path task:

1. build the upstream URL via `createUpstreamUrl(route.baseUrl, route.api_mode)`
2. attach `authorization: Bearer …` (OpenAI mode) or `x-api-key: …` plus `anthropic-version` (Anthropic mode); the API key is resolved from the provider auth via `resolveRouteApiKey(route)`
3. POST through `fetchWithSwitchmaxxerTransport()` with `timeoutMs = route.timeoutMs`
4. always record a synthetic execution (direct-path requests never go through the gateway, so no live `request_executions` row exists)

Provider auth for direct-path samples is resolved by the process running the
bench surface. For MCP, that is the `switchmaxxer mcp serve` process launched
by the MCP client. If an OpenClaw-launched MCP server can inspect routes but a
direct `bench_run` fails for a route such as `gpt-4o-mini`, check that the MCP
server process received `SWITCHMAXXER_OPENAI_API_KEY` or
`SWITCHMAXXER_SECRETS_PATH`.

### 8.4 Synthetic executions

Direct-path samples and any gateway-path samples that could not be linked to a live execution row are persisted via `recordSyntheticBenchmarkExecution()`. This emits a closed sequence of canonical observations (`request_received`, `route_resolved`, `upstream_request_started`, `upstream_response_completed`, `client_response_started`, `client_response_completed`, plus an optional `debug_error_context` for failures) all carrying `surface: "benchmark"` and the run/case identifiers.

The `surface: "benchmark"` marker is load-bearing: trace listings must filter benchmark rows out of normal traffic queries unless they explicitly opt in. See [field-matrix-for-observability-store.md](../store/field-matrix-for-observability-store.md) for the canonical interpretation of the `surface` field.

For direct-path samples, the synthetic execution sets `client_api_mode = "direct-upstream"`. This is the marker that downstream report rendering uses to assign the sample to the `direct` bucket in `analysis.by_path`. See [contracts.ts](../../../../src/subsystems/observability/contracts.ts) `tracePathFromExecution()`.

### 8.5 Failure classification

Per-sample failures are classified into a small enumeration written into the synthetic observation's `attributes_json` as `failure_kind`:

| Reason | failure_kind (gateway path) | failure_kind (direct path) |
|---|---|---|
| HTTP non-2xx | `gateway_http_error` | `direct_http_error` |
| timeout / abort | `gateway_timeout` | `direct_timeout` |
| transport error | `gateway_transport_error` | `direct_transport_error` |
| response body exceeds cap | `gateway_response_too_large` | `direct_response_too_large` |
| cancellation | `gateway_cancelled` | `direct_cancelled` |

Benchmark response reads are bounded by `max_buffered_upstream_response_bytes`
when configured, or by the hard JSON serialized byte cap as a fallback. Failure
reasons derived from response bodies are truncated to a small preview before
being written into `score_json` or synthetic observation metadata.

This classification is intentionally small and stable so report consumers can rely on it.

## 9. Cancellation

The CLI installs a single `SIGINT` listener for the duration of `bench`. On signal:

1. an `AbortController` aborts with a `BenchmarkCancelledError`
2. in-flight tasks see the abort signal and stop after their current HTTP attempt completes
3. `waitForBenchDrainAfterAbort()` allows up to `BENCH_CANCEL_DRAIN_TIMEOUT_MS` (5 s) for outstanding tasks to settle
4. the run status transitions to `"cancelled"` (or `"failed"` for non-cancellation errors)
5. the process exits with code `130` on cancellation

The MCP `bench_run` tool wires the session's abort signal (so caller-initiated cancellation works) and additionally enforces a wall-clock deadline through `AbortSignal.timeout()`. Either trigger produces a `BenchmarkCancelledError` on the same path.

`runTasksWithConcurrency()` re-throws `BenchmarkCancelledError` after all workers settle, so partial results recorded before the abort remain in `benchmark_samples`.

## 10. Persistence

### 10.1 `benchmark_runs` row

Defined in the public [schema.ts](../../../../src/subsystems/observability/schema.ts) facade over `ostrich/store/schema.ts` and the public [benchmarks.ts](../../../../src/subsystems/observability/benchmarks.ts) facade over `ostrich/benchmark/benchmarks.ts`:

| Column | Notes |
|---|---|
| `id` | UUID assigned at run start |
| `name` | `bench-<created_at_iso>` |
| `created_at` | ISO timestamp at run start |
| `created_by` | `"switchmaxxer bench"` (CLI) or `"switchmaxxer mcp"` (MCP) |
| `objective` | `"route_benchmark"` for runs created by the bench surfaces |
| `notes` | currently always `null` |
| `settings_json` | the entire bench plan (route names, prompt size, iterations, warmup, concurrency, timeout, requested + effective path mode, effective + skipped paths, execution warnings) |
| `status` | one of `BENCHMARK_RUN_STATUSES` (`"draft"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`, `"archived"`); the bench surfaces transition `"running"` → `"completed"` / `"failed"` / `"cancelled"` |

`settings_json` is the contract for replaying a run's intent. New per-run inputs added in the future must extend this object rather than land in dedicated columns; `benchmark_runs` columns are reserved for facts that need to be queryable.

### 10.2 `benchmark_samples` row

| Column | Notes |
|---|---|
| `id` | UUID |
| `benchmark_run_id` | foreign key to `benchmark_runs.id` |
| `request_execution_id` | foreign key to `request_executions.id`; cascade-deleted when the underlying execution is pruned |
| `route_id` / `provider_id` / `provider_model_id` | denormalized from the execution at insert time |
| `sample_index` | the canonical ordering key (see §6.2) |
| `started_at` / `completed_at` / `status_code` / `outcome` | mirror the execution |
| `latency_ms` / `ttft_ms` / `duration_ms` | mirror the execution; `latency_ms` is the bench-time end-to-end measurement |
| `input_tokens` / `output_tokens` / `total_tokens` / `estimated_cost_micros` | mirror the execution |
| `is_warmup` | `1` for warmup tasks, `0` for measured tasks |
| `score_*` | reserved for future scoring; bench currently writes nulls |
| `score_json` | bench currently uses this to store the per-sample task metadata (`path`, `route_name`, `iteration`, `phase`, optional `endpoint` / `upstream_url` / `request_id` / `reason` / `failure_kind` / `max_response_bytes` / `response_bytes_read`) |

`score_*` columns will hold structured scoring data when an evaluation surface is added. Until then, `score_json` is a free-form attributes payload — but it must always be valid JSON because [contracts.ts](../../../../src/subsystems/observability/contracts.ts) `benchmarkPathFromSample()` reads `path` from it to assign samples to per-path analysis buckets.

### 10.3 Storage and indexes

Indexes (defined in the public [schema.ts](../../../../src/subsystems/observability/schema.ts) facade over `ostrich/store/schema.ts`):

- `idx_benchmark_samples_run_id ON benchmark_samples(benchmark_run_id)`
- `idx_benchmark_samples_run_sample_index ON benchmark_samples(benchmark_run_id, sample_index)`

The second index is what makes `bench show` ordered listing efficient. Any new query pattern over benchmark samples should add its own index rather than rely on a full scan.

### 10.4 Benchmark History Cleanup

`bench prune`, `bench delete`, and `bench clear` are benchmark-history cleanup
commands. They delete rows from `benchmark_runs` and `benchmark_samples` only.

They intentionally leave `request_executions`, raw `observations`, cost facts,
optimization facts, config mutation events, and managed config snapshots alone.
This keeps benchmark-history cleanup from becoming a hidden trace-retention
command: operators can remove benchmark reports without erasing the underlying
request history that may still be useful for debugging.

The top-level `switchmaxxer prune --older-than <duration>` remains the
canonical whole-store retention command. It may prune traces, benchmark rows,
cost facts, optimization facts, config mutation events, and managed config
snapshots as one lifecycle operation.

## 11. Report Shape

`buildBenchmarkReportView()` produces a `BenchmarkReportView` with this top-level structure:

```
{
  store_path?: string,         // present in CLI / MCP success envelopes
  run: {                       // toBenchmarkRunView output
    run_id, name, created_at, created_by, objective, notes, status,
    settings, parse_warnings, summary
  },
  execution: {                 // benchmarkExecutionViewFromSettings(run.settings)
    requested_path_mode, effective_paths, skipped_paths, warnings
  },
  summary: {                   // benchmarks.summarizeRun(run.id)
    total_samples, measured_samples, warmup_samples,
    success_count, failed_count,
    average_latency_ms, min_latency_ms, max_latency_ms,
    average_ttft_ms, average_duration_ms
  },
  analysis: {
    by_path: BenchmarkPathSummaryView[]
  },
  samples: BenchmarkSampleView[]
}
```

`summary` aggregates over **measured** samples only. Warmup samples are intentionally excluded from `success_count`, `failed_count`, and the latency averages — including them would make the first-call cold-start cost dominate small runs.

`analysis.by_path` partitions samples by their `path` value (read from `score_json` per-sample) and computes:

- per-path measured/warmup counts and outcomes
- per-path averages
- the warmup latency vector, its median, max, and last value
- the first measured latency
- a `first_measured_suspect` boolean flag set when the first measured latency is more than 2× the median of subsequent measured latencies

`first_measured_suspect` is the bench surface's own quality signal that warmup was insufficient; it does not alter the summary.

The text renderer (`renderBenchReportText()`) intentionally surfaces `requested_path_mode`, `effective_paths`, `skipped_paths`, and the warnings list, so an operator running with `--path both` against a stopped gateway can immediately see that they got a direct-only run.

## 12. Error Codes

The bench surfaces use the canonical error code registry per [error-codes-reference.md](../../../contracts/error-codes-reference.md). Surface-specific behavior:

| Surface | Failure | Code | Notes |
|---|---|---|---|
| CLI `bench` | usage / validation failure | one of `MCP_USAGE_ERROR_CODES.{missingRequiredField, invalidInputField, invalidFlagValue}` | exit code 2 |
| CLI `bench` | route not found | `MCP_ENTITY_STATE_ERROR_CODES.routeNotFound` | exit code 1 |
| CLI `bench` | preflight `invalid_config` / `gateway_unavailable` | preflight code passed through | exit code 1 |
| CLI `bench` | execution / unknown failure | `APP_ERROR_CODES.benchError` | exit code 1 |
| CLI `bench` | timeout | `APP_ERROR_CODES.benchError` with the timeout message | exit code 1 |
| CLI `bench` | cancellation | `APP_ERROR_CODES.benchError` with `details.cancel_reason` | exit code 130 |
| CLI `bench list` | execution failure | `APP_ERROR_CODES.benchListError` | exit code 1 |
| CLI `bench show` | run not found | `APP_ERROR_CODES.benchNotFound` | exit code 1 |
| CLI `bench show` | execution failure | `APP_ERROR_CODES.benchShowError` | exit code 1 |
| CLI `bench prune` | missing or invalid `--older-than` | one of `MCP_USAGE_ERROR_CODES.{missingRequiredField, invalidFlagValue}` | exit code 2 |
| CLI `bench prune` | execution failure | `APP_ERROR_CODES.benchError` | exit code 1 |
| CLI `bench delete` | missing `<run-id>` | `MCP_USAGE_ERROR_CODES.missingRequiredField` | exit code 2 |
| CLI `bench delete` | missing run | `APP_ERROR_CODES.benchNotFound` | exit code 1 |
| CLI `bench delete` | execution failure | `APP_ERROR_CODES.benchError` | exit code 1 |
| CLI `bench clear` | execution failure | `APP_ERROR_CODES.benchError` | exit code 1 |
| MCP `bench_run` | usage / validation failure | `APP_ERROR_CODES.invalidInputField` (or as raised by parsers) | error envelope |
| MCP `bench_run` | route not found | `MCP_ENTITY_STATE_ERROR_CODES.routeNotFound` | error envelope |
| MCP `bench_run` | preflight | `APP_ERROR_CODES.gatewayUnavailable` or `APP_ERROR_CODES.invalidConfig` | error envelope |
| MCP `bench_run` | execution / cancellation | `APP_ERROR_CODES.benchError` (via `toEnvelopeFromError`) | error envelope |

A bench run that completes with at least one failed measured sample exits 1 (CLI) or returns a success envelope (MCP); the failed-sample count is in `summary.failed_count` either way. Per-sample failures are *not* an envelope-level error — they are first-class data in the report.

## 13. Tests

Bench-runtime invariants and limits live in colocated unit tests:

- [bench-route-selection.test.ts](../../../../src/subsystems/observability/ostrich/benchmark/bench-route-selection.test.ts)
- [bench-execution-validation.test.ts](../../../../src/subsystems/observability/ostrich/benchmark/bench-execution-validation.test.ts)
- [bench-path-mode.test.ts](../../../../src/subsystems/observability/ostrich/benchmark/bench-path-mode.test.ts)
- [run-command.test.ts](../../../../src/subsystems/cli/commands/bench/run-command.test.ts)
- [bench-run-tool.test.ts](../../../../src/subsystems/mcp/bench-run-tool.test.ts)
- [parsers-bench-gateway.test.ts](../../../../src/subsystems/mcp/parsers-bench-gateway.test.ts)

End-to-end behavior (CLI and MCP envelope shape, error contracts) is covered by the shell tests under `tests/`, particularly the `mcp-cli-contract` and `mcp-suite` tests.

When adding new bench behavior, the rule of thumb:

- **input contract change** → unit test in the relevant `bench-*-validation` or parser test
- **runtime behavior change** → unit test in `run-command.test.ts` and/or `bench-run-tool.test.ts`
- **report-shape change** → assertion in both surfaces' tests *and* an envelope-equivalence assertion in the contract test suite

## 14. Boundaries

The bench subsystem must not:

- write to `benchmark_runs` or `benchmark_samples` outside of `BenchmarkRepository`
- emit observations without `surface: "benchmark"` on synthetic rows
- skip preflight when the requested path mode includes `gateway` (degraded fallback is acceptable; skipping is not)
- introduce per-route concurrency primitives — `runTasksWithConcurrency` is the single concurrency knob
- mix CLI-only or MCP-only logic into [bench-runtime.ts](../../../../src/subsystems/bench/bench-runtime.ts); surface-specific concerns belong in the CLI command files or the MCP tool files

The bench subsystem may:

- read from any config block that affects per-request behavior (`benchmark`, `routes`, `bindHost`, `port`, `inboundApiKeyEnv`, `allowUnauthenticatedGateway`, `timeoutMs`)
- read from any provider auth surface via `resolveRouteApiKey`
- emit synthetic observations into the canonical observability store

## 15. Future Work

These are reserved but not yet implemented; they are documented here so that contributors can shape new bench code in a forward-compatible way:

- **Scoring**: the `score_value`, `score_scale`, `score_direction`, `score_source`, `score_method`, `scored_at` columns on `benchmark_samples` exist for an evaluation surface. When wired up, scoring belongs in a new `bench-scoring` module, not in `bench-runtime.ts`.
- **External prompt suites**: see [../../architecture/industry-directions.md](../../../architecture/industry-directions.md) §"Direction for Switchmaxxer's benchmark surface" for the Promptfoo-import direction.
- **Trace export**: the same document covers the OpenTelemetry/Langfuse-compatible export path. Bench reports already carry the data needed to populate that export.
- **Per-route concurrency or fairness controls**: not implemented today; if needed, must be added at the planning layer (`buildBenchTasks`) or the worker layer (`runTasksWithConcurrency`), not by sprinkling waits into `executeBenchmarkTask`.
