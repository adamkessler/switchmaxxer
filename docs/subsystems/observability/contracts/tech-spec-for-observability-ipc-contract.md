# Tech Spec for Observability IPC Contract

This document defines the future IPC boundary for out-of-process
observability implementations. It is the contract Osprey and Owl would
implement behind smx-side adapters while Ostrich remains the in-process
reference implementation.

The goal is compatibility, not novelty. Osprey and Owl should make the
observability engine replaceable without changing CLI, MCP, gateway,
benchmark, optimize, or config mutation behavior.

## Scope

This spec covers the process boundary between smx and an external
observability engine.

In scope:

- protocol version negotiation
- process lifecycle and session lifecycle
- request/response envelope shape
- error and warning envelopes
- store ownership and path handling
- mapping the current `ObservabilityModule` ports to IPC operations
- semantic compatibility with Ostrich

Out of scope:

- building Osprey or Owl
- selecting Java versus Rust
- changing the SQLite schema
- changing CLI/MCP response payloads
- introducing a user-facing engine switch before an external adapter
  exists
- replacing gateway, benchmark, optimize, or config mutation product
  logic

## Reference implementation

Ostrich is the behavioral reference. The TypeScript module contract is
defined in
[../../../src/subsystems/observability/observability-module.ts](../../../../src/subsystems/observability/observability-module.ts).

An external engine is compatible only if its smx adapter can pass the
same module-port contract tests as Ostrich. If this spec conflicts with
observed Ostrich behavior, either Ostrich needs a bug fix or this spec
needs to be updated before Osprey/Owl work proceeds.

## Transport posture

The first IPC transport should be line-delimited JSON over stdio.

Reasons:

- it works for Java and Rust without platform-specific bindings
- it is easy to inspect during development
- it avoids opening a local network listener
- it matches smx's local-first posture
- it keeps supervision in the parent smx process

The protocol should not depend on JSON-RPC. The envelope should be small
and purpose-built so smx can keep the same typed port API internally.

Future transports may be added only behind the same adapter contract.
Transport differences must not leak into CLI/MCP response shapes.

## Payload Transport Modes

The local dispatcher and an external engine use the same operation names,
but not every local payload is suitable for stdio.

- **Local in-process transport** may carry TypeScript runtime values such
  as callbacks and `Date` instances because it never leaves the process.
- **External transport** must carry JSON-serializable data only. It must
  not carry functions, `Date` objects, `undefined`, symbols, bigints, or
  non-finite numbers.

Current in-process-only fields:

| Operation | In-process-only field | Required replacement before stdio ownership |
|-----------|-----------------------|---------------------------------------------|
| `benchmarkRuns.run` | `preflightGateway` | `gatewayPreflight` JSON-safe preflight result |
| `optimizationReports.persistCost` | `now` as `Date` | ISO timestamp string or engine-owned timestamp |
| `optimizationReports.persistLatency` | `now` as `Date` | ISO timestamp string or engine-owned timestamp |
| `optimizeMutations.apply` | `loadReadModel` | smx-owned config/read-model orchestration command |
| `optimizeMutations.apply` | `mutateConfigDocument` | smx-owned config mutation command/result |
| `optimizeMutations.apply` | `getMutableConfigSection` | smx-owned config mutation command/result |
| `optimizeMutations.restore` | `loadReadModel` | smx-owned config/read-model orchestration command |
| `optimizeMutations.restore` | `mutateConfigDocument` | smx-owned config mutation command/result |
| `optimizeMutations.restore` | `getMutableConfigSection` | smx-owned config mutation command/result |

The first external Osprey/Owl adapter rejects local payloads at
validation time instead of attempting to serialize them. Benchmark runs
now have an external-safe preflight replacement. Optimize mutation
operations are rejected at the operation boundary for external
transport until the config mutation command/result contract exists.
Until that contract exists, smx should keep config mutation ownership
in TypeScript and use external engines for observability storage,
query, audit, and history semantics.

External `benchmarkRuns.run` payloads use `gatewayPreflight` instead of
`preflightGateway`. smx owns the actual gateway probe and sends the
precomputed result to the engine:

```json
{
  "gatewayPreflight": {
    "ok": true,
    "sourceFile": "config.json",
    "sourcePath": "/home/me/.config/switchmaxxer/config.json",
    "bindHost": "127.0.0.1",
    "port": 8080,
    "probeHost": "127.0.0.1",
    "healthUrl": "http://127.0.0.1:8080/health",
    "pid": 12345,
    "latencyMs": 8
  }
}
```

Failures use the same camelCase field names and carry
`code = "invalid_config"` or `code = "gateway_unavailable"`, a
non-empty `message`, nullable `port`, nullable `healthUrl`, nullable
`pid`, and nullable `latencyMs`.

### External optimize mutation contract

External Osprey/Owl engines should not receive config mutation
callbacks and should not directly edit `config.json` or `catalog.json`.
The safe boundary is command-oriented:

1. smx loads the read model and resolves the optimization run or restore
   point.
2. smx asks the external engine for an optional mutation plan using
   JSON-safe inputs only.
3. smx validates the plan against the current read model and local
   policy.
4. smx owns the snapshot, config write, read-model reload, Ledger
   event, config-mutation event, gateway reload, and post-action
   verification.
5. smx returns the same local `OptimizeApplyView` or
   `OptimizeRestoreView` result shape after execution.

This keeps local filesystem authority and gateway control in the smx
process while still allowing a future engine to own history lookup,
candidate evaluation, and explanatory plan generation.

The proposed external apply planning payload is:

```json
{
  "command": "optimizeMutation.planApply",
  "runId": "opt-123",
  "targetRouteId": "route-fast",
  "readModel": {
    "sourcePath": "/home/me/.config/switchmaxxer/config.json",
    "routes": {}
  },
  "sourceSurface": "cli",
  "createdBy": "switchmaxxer optimize apply",
  "actorKind": "operator",
  "actorId": null,
  "sessionId": null,
  "dryRun": false,
  "metadata": {}
}
```

Canonical fixture:
[optimize-mutation-plan-apply-command.json](../tests/fixtures/optimize-mutation-plan-apply-command.json)

The proposed external restore planning payload is:

```json
{
  "command": "optimizeMutation.planRestore",
  "selector": {
    "mode": "action",
    "actionId": "action-123"
  },
  "readModel": {
    "sourcePath": "/home/me/.config/switchmaxxer/config.json",
    "routes": {}
  },
  "sourceSurface": "cli",
  "createdBy": "switchmaxxer optimize restore",
  "actorKind": "operator",
  "actorId": null,
  "sessionId": null,
  "dryRun": false,
  "metadata": {}
}
```

Canonical fixture:
[optimize-mutation-plan-restore-command.json](../tests/fixtures/optimize-mutation-plan-restore-command.json)

The external plan result must be declarative. It may recommend no
change, or a single route provider target change:

```json
{
  "ok": true,
  "plan": {
    "kind": "route_provider_target",
    "routeId": "route-fast",
    "from": {
      "serviceProvider": "provider-a",
      "providerModelId": "model-a",
      "cost": null
    },
    "to": {
      "serviceProvider": "provider-b",
      "providerModelId": "model-b",
      "cost": {
        "input": 1.25,
        "output": 2.5,
        "cache_read": 0.25,
        "cache_write": 0.5
      }
    },
    "reason": "Lowest valid cost candidate for the persisted run."
  },
  "warnings": []
}
```

Canonical fixtures:
[optimize-mutation-plan-route-provider-target-result.json](../tests/fixtures/optimize-mutation-plan-route-provider-target-result.json)
and
[optimize-mutation-plan-none-result.json](../tests/fixtures/optimize-mutation-plan-none-result.json).

The first supported plan kind should be `route_provider_target` because
that is the only mutation the current optimize apply/restore service
performs. Additional plan kinds require separate review because they
expand local config authority. smx must reject any plan whose `from`
state no longer matches the current read model, whose `routeId` is not
the selected target route, or whose target provider/model/cost tuple is
not supported by the persisted optimization or restore point.

Until this command/result contract is implemented and validated,
`optimizeMutations.apply` and `optimizeMutations.restore` remain
local-only IPC operations.

## Process lifecycle

External engines are child processes supervised by smx.

Startup sequence:

1. smx resolves the engine executable and store path.
2. smx spawns the child process with inherited environment limited to
   required configuration.
3. smx sends `engine.hello`.
4. the engine responds with `engine.ready`.
5. smx sends `store.open` or `store.init`.
6. smx marks the adapter available only after the store response
   succeeds.

Shutdown sequence:

1. smx stops sending new requests.
2. smx sends `engine.drain` if ingestion or mutation work may be
   pending.
3. smx sends `engine.shutdown`.
4. smx waits for a bounded graceful exit.
5. smx terminates the child if the grace period expires.

Crash rule:

- read operations fail closed with a typed engine error
- write operations report whether completion is known, unknown, or
  definitely failed
- smx should not silently retry non-idempotent mutations unless the
  operation includes an idempotency key

## Version negotiation

The protocol has two versions:

- `protocol_version`: the IPC envelope and operation names
- `contract_version`: the semantic observability contract implemented by
  the engine

The engine must return both in `engine.ready`.

```json
{
  "id": "1",
  "ok": true,
  "result": {
    "engine": "owl",
    "protocol_version": "1",
    "contract_version": "observability-module-v1",
    "capabilities": {
      "gatewayObservationWrites": true,
      "localReadModel": true,
      "retentionPruning": true,
      "gracefulShutdownDrain": true
    }
  }
}
```

Smx must fail closed when the protocol version is unsupported. Contract
version mismatches may fall back to Ostrich only when the operator did
not explicitly request fail-closed behavior.

## Envelope shape

Requests:

```json
{
  "id": "42",
  "operation": "trace.list",
  "contract_version": "observability-module-v1",
  "store": {
    "dbPath": "/absolute/path/to/observability.sqlite"
  },
  "payload": {
    "filters": {
      "limit": 50
    }
  }
}
```

Successful responses:

```json
{
  "id": "42",
  "ok": true,
  "result": {
    "dbPath": "/absolute/path/to/observability.sqlite",
    "storeFound": true,
    "traces": []
  },
  "warnings": []
}
```

Failed responses:

```json
{
  "id": "42",
  "ok": false,
  "error": {
    "code": "observability_engine_unavailable",
    "message": "Observability engine exited before completing trace.list",
    "retryable": false,
    "details": {
      "operation": "trace.list"
    }
  },
  "warnings": []
}
```

Rules:

- `id` is unique per in-flight request.
- `operation` names are stable and map to module ports.
- `payload` contains operation-specific inputs only.
- `store.dbPath` is absolute after smx normalization.
- responses must echo `id`.
- errors must be structured and secret-safe.
- warnings are advisory and must not change the success/failure
  contract.
- successful response `result` values must pass operation-specific
  validation before smx treats them as trusted module output.
- operation coverage is explicit: adding a new IPC operation requires a
  matching result validator, or the coverage guard fails.

The response/result validation surface is domain-split in source so the
boundary remains maintainable:

| Domain | Source module |
|--------|---------------|
| dispatcher and coverage list | `observability-ipc-result-validation.ts` |
| shared primitive guards | `observability-ipc-result-validation-shared.ts` |
| trace results | `observability-ipc-result-validation-trace.ts` |
| benchmark results | `observability-ipc-result-validation-benchmark.ts` |
| retention, Ledger, and control-plane audit results | `observability-ipc-result-validation-ledger.ts` |
| optimize history, report, and mutation results | `observability-ipc-result-validation-optimization.ts` |

This validation is deliberately structural. It does not replace the
semantic module-port contract tests; it rejects malformed IPC frames
before they can be mistaken for valid Ostrich-compatible behavior.

## Store ownership

Smx owns store path resolution. The engine owns store access after a path
is opened.

Rules:

- smx passes absolute store paths only.
- the engine must not expand shell syntax, environment variables, or
  user-home shortcuts in `dbPath`.
- the engine must reject paths outside its configured allowed roots if
  allowed roots are supplied.
- one engine process may serve one store path initially.
- multi-store support requires explicit session identifiers before it is
  added.

For Osprey/Owl, the store may remain SQLite-compatible or become an
engine-owned format. Either way, the smx-facing semantics are the same:
trace reads, benchmark history, optimize history, Ledger reads,
retention, repair, and mutation audit behavior must match Ostrich.

## Operation map

The IPC operation names mirror the current module ports.

| Port | Operation | Payload | Result |
|------|-----------|---------|--------|
| `trace` | `trace.list` | `filters` | `ObservabilityTraceListResult` |
| `trace` | `trace.listObservations` | `filters` | `ObservabilityTraceObservationsResult` |
| `trace` | `trace.getStats` | `filters` | `ObservabilityTraceStatsResult` |
| `trace` | `trace.show` | `traceId` | `ObservabilityTraceShowResult` |
| `traceMaintenance` | `trace.verify` | `all`, `traceId`, `batchSize` | `ObservabilityTraceMaintenanceResult` |
| `traceMaintenance` | `trace.repair` | `all`, `traceId`, `batchSize` | `ObservabilityTraceMaintenanceResult` |
| `retention` | `retention.pruneOlderThan` | `cutoffIso` | `ObservabilityRetentionPruneResult` |
| `ledger` | `ledger.list` | `filters` | `ObservabilityLedgerListResult` |
| `ledger` | `ledger.show` | `ledgerEventId` | `ObservabilityLedgerShowResult` |
| `controlPlaneAudit` | `controlPlaneAudit.startConfigMutation` | audit start fields | `ObservabilityControlPlaneAuditStartResult` |
| `controlPlaneAudit` | `controlPlaneAudit.finishConfigMutation` | audit finish fields | `ObservabilityControlPlaneAuditFinishResult` |
| `benchmarkHistory` | `benchmarkHistory.list` | `limit` | `ObservabilityBenchmarkHistoryListResult` |
| `benchmarkHistory` | `benchmarkHistory.show` | `runId` | `ObservabilityBenchmarkHistoryShowResult` |
| `benchmarkHistory` | `benchmarkHistory.pruneOlderThan` | `cutoffIso` | `ObservabilityBenchmarkHistoryDeleteResult` |
| `benchmarkHistory` | `benchmarkHistory.deleteRun` | `runId` | `ObservabilityBenchmarkHistoryDeleteResult` |
| `benchmarkHistory` | `benchmarkHistory.clear` | none | `ObservabilityBenchmarkHistoryDeleteResult` |
| `benchmarkRuns` | `benchmarkRuns.run` | benchmark operation fields | `ObservabilityBenchmarkRunResult` |
| `optimizationHistory` | `optimizationHistory.list` | `limit` | `ObservabilityOptimizationHistoryListResult` |
| `optimizationHistory` | `optimizationHistory.show` | `runId` | `ObservabilityOptimizationHistoryShowResult` |
| `optimizationHistory` | `optimizationHistory.pruneOlderThan` | `cutoffIso` | `ObservabilityOptimizationHistoryDeleteResult` |
| `optimizationHistory` | `optimizationHistory.deleteRun` | `runId` | `ObservabilityOptimizationHistoryDeleteResult` |
| `optimizationHistory` | `optimizationHistory.clear` | none | `ObservabilityOptimizationHistoryDeleteResult` |
| `optimizationReports` | `optimizationReports.persistCost` | cost report fields | `ObservabilityOptimizationReportPersistResult` |
| `optimizationReports` | `optimizationReports.persistLatency` | latency report fields | `ObservabilityOptimizationReportPersistResult` |
| `optimizeMutations` | `optimizeMutations.apply` | apply mutation fields | `ObservabilityOptimizeApplyMutationResult` |
| `optimizeMutations` | `optimizeMutations.restore` | restore mutation fields | `ObservabilityOptimizeRestoreMutationResult` |

Payloads should be generated from or checked against the TypeScript
contract before an external implementation is treated as compatible.
Operation names should not be renamed for Java or Rust style.

## JSON-safe optimize mutation boundary

`optimizeMutations.apply` and `optimizeMutations.restore` are the only
remaining IPC operations that intentionally cannot cross the external
transport boundary. The local Ostrich path currently passes TypeScript
callbacks for loading the read model, mutating the catalog document, and
selecting the mutable config section. Those callbacks are valid
in-process wiring, but they are not an Osprey/Owl protocol.

The external contract should split optimize mutations into a JSON-safe
command and a JSON-safe result. Smx remains the control plane: it owns
config path resolution, capability checks, CLI/MCP argument parsing, and
operator intent. The observability engine owns persistence, Ledger
linkage, restore-point lookup, stale-run checks, and the same mutation
view shape already returned by Ostrich.

### Command shape

An external optimize mutation command should contain only transport-safe
data:

| Field | Apply | Restore | Notes |
|-------|-------|---------|-------|
| `runId` | required | optional | Required for apply; used with `targetRouteId` as a restore selector when `actionId` is absent. |
| `targetRouteId` | required | optional | The route to mutate or restore. |
| `actionId` | absent | optional | Restore selector for a prior apply action. Mutually exclusive with incomplete `runId`/`targetRouteId` selectors. |
| `idempotencyKey` | required | required | Stable command intent key used to prevent unsafe retries and diagnose unknown completion. |
| `dryRun` | required | required | Preview without writing catalog, snapshots, or mutation history. |
| `reload` | required | required | Request gateway reload after an effective non-dry-run mutation. |
| `verify` | required | required | Request route verification after an effective non-dry-run mutation. |
| `createdBy` | required | required | Human-readable source, such as CLI or MCP. |
| `sourceSurface` | required | required | Stable enum: `cli` or `mcp`. |
| `actorKind` | required | required | Stable enum: `operator` or `agent`. |
| `catalog` | required | required | Validated, JSON-safe catalog snapshot or narrowed catalog command context. |
| `completion` | optional | optional | Reload/verify completion payload when smx performs post-mutation work outside the engine. |

The first implementation should prefer a narrowed catalog command
context over a full raw config object if it can preserve Ostrich
behavior:

- the target route before mutation
- the winning route/provider/model fields needed by apply
- the restore-point provider/model/cost fields needed by restore
- enough provider auth metadata to detect missing environment-backed auth
  without sending raw secrets
- the current catalog revision or content hash if available

If that narrowed context becomes ambiguous, use a full validated
`catalog.json` snapshot with provider secrets redacted and a separate
`catalogRevision` or content hash. Do not send `config.json`, raw API
keys, process-local functions, class instances, `Date` objects, or file
handles.

### Result shape

The external result should reuse the current
`ObservabilityOptimizeApplyMutationResult` and
`ObservabilityOptimizeRestoreMutationResult` envelopes:

- `dbPath`
- `storeFound`
- `result`

The nested mutation service result should remain one of the current
Ostrich-compatible shapes:

- failure with stable `kind`, `code`, `message`, and safe `details`
- dry-run success with the proposed mutation preview
- no-op success when the catalog already matches the requested state
- effective committed success with Ledger action id, optional mutation
  event id, snapshot id, before/after views, warnings, and post-action
  completion fields

Reload and verification are smx control-plane actions, not observability
engine responsibilities. If smx performs them after the engine commits a
mutation, the IPC flow must either:

- include a second `completion` call keyed by the accepted Ledger action,
  or
- keep the mutation call open until smx can supply the completion
  payload.

The first external implementation should use a second completion call
only after the external runtime persists and enforces the explicit
idempotency key. Until then, the safer behavior is to keep framed
external optimize mutations disabled and return
`observability_protocol_mismatch`, as the current adapter does.

### Failure and retry posture

Optimize mutation command payloads carry deterministic idempotency keys,
but external execution remains non-retriable until the runtime persists
and enforces those keys. External adapters must not retry apply/restore
after transport failure or timeout. If the engine accepted the command
and the connection fails before a response is validated, smx should
surface `observability_unknown_completion` and direct the operator to
inspect the Ledger and optimize history.

The generated schema for apply/restore should land only after this
command/result boundary is represented in TypeScript. At that point,
external validation should reject the local callback fields and accept
only the JSON-safe command shape.

The command boundary now has TypeScript types, standalone validators,
generated schemas, deterministic idempotency keys, and a mapper from
optimize mutation plan commands/results to JSON-safe external apply and
restore commands. The internal execution harness now computes the
canonical command digest, records accepted keys, replays completed and
failed records, rejects digest mismatches, and returns
`observability_unknown_completion` for accepted or unknown records.
Framed external `optimizeMutations.apply` and
`optimizeMutations.restore` requests still remain disabled until the
external runtime execution path is connected to real apply/restore
mutation execution.

## Idempotency

Read operations are idempotent.

Cleanup operations are repeatable but not fully idempotent; a second
call may report fewer deleted rows. They must not delete records outside
their documented ownership category.

Write and mutation operations need persisted idempotency enforcement
before smx can safely retry them across process crashes:

- `controlPlaneAudit.startConfigMutation`
- `controlPlaneAudit.finishConfigMutation`
- `benchmarkRuns.run`
- `optimizationReports.persistCost`
- `optimizationReports.persistLatency`
- `optimizeMutations.apply`
- `optimizeMutations.restore`

The standalone external optimize mutation command shape already carries
a deterministic `idempotencyKey`, but framed external apply/restore
execution remains disabled until the external adapter is connected to
the harness-backed runtime execution path. Until then, adapters should
surface unknown completion as an error instead of retrying
automatically.

### Optimize Mutation Enforcement Contract

The first persisted idempotency lane should be scoped to external
optimize mutation commands only. CLI and MCP in-process mutations already
run inside one smx process and should not be forced through this replay
path until the external contract is proven.

Persist each accepted external optimize mutation command before any
catalog write, Ledger finish, reload, or verification side effect. The
record should include:

- `idempotency_key`: the caller-supplied key, unique within the
  observability store
- `operation`: `optimizeMutations.apply` or `optimizeMutations.restore`
- `command_digest`: a canonical SHA-256 digest of the JSON-safe command
  payload with the `idempotencyKey` field removed
- `status`: `accepted`, `completed`, `failed`, or `unknown`
- `control_plane_action_id`: optional Ledger action id once an attempt
  has been opened
- `result_json`: optional JSON-safe result envelope for completed
  attempts
- `error_json`: optional JSON-safe failure envelope for failed attempts
- `created_at`, `updated_at`, and optional `finished_at`

The digest check is the safety boundary. A retry with the same
`idempotencyKey` and the same `command_digest` is the same intent. A
retry with the same key and a different digest is a protocol error and
must not execute. The digest input must use a stable JSON canonicalizer:
object keys sorted recursively, no `undefined`, finite JSON numbers only,
and the already validated external command payload as input. The digest
excludes the idempotency key itself and volatile `catalog` context. The
catalog context is explanatory evidence for validation, diagnostics, and
future out-of-process compatibility, but it can legitimately differ
after the original mutation has already changed the catalog. Stable
intent fields such as operation, run/route or restore selector, dry-run
mode, reload/verification flags, source surface, actor/session metadata,
and completion contract remain part of the digest.

Duplicate handling:

| Existing status | Same digest behavior | Different digest behavior |
|-----------------|----------------------|---------------------------|
| `accepted` | return `observability_unknown_completion` with the known Ledger action id if present; do not execute again | return `observability_protocol_mismatch`; do not execute |
| `completed` | return the persisted result without re-running catalog mutation, reload, or verification | return `observability_protocol_mismatch`; do not execute |
| `failed` | return the persisted failure without re-running catalog mutation, reload, or verification | return `observability_protocol_mismatch`; do not execute |
| `unknown` | return `observability_unknown_completion` with recovery details; do not execute | return `observability_protocol_mismatch`; do not execute |

The runtime should transition `accepted` to `unknown` if the process
cannot determine whether the mutation completed. Examples include a
transport break after the engine accepted the command, an engine crash
while an action is `started`, or a timeout after the engine reports that
mutation work began. A timeout before the record is persisted or before
the command is accepted remains a normal engine-unavailable or timeout
failure and is safe for smx to submit again with the same key.

Persisting the post-action result is part of the idempotency guarantee.
When a retried completed command is replayed, smx must receive the same
mutation result and the same reload/verification completion data that
the original command recorded. If reload or verification are performed
outside the engine, the completion callback must be keyed by the same
`idempotencyKey` and must reject mismatched command digests.

Retention must not delete idempotency records while their referenced
Ledger action, mutation event, or optimize-history run is retained.
After those references are gone, retention may remove old completed or
failed idempotency records. `accepted` and `unknown` records should be
kept until an operator repair or explicit cleanup policy resolves them.

Implementation status:

- `optimize_mutation_idempotency` exists in the SQLite store.
- `OptimizeMutationIdempotencyRepository` owns digest comparison and
  replay-state persistence.
- `executeExternalOptimizeMutationCommand` owns replay handling and the
  future execution callback boundary.
- `executePlannedExternalOptimizeMutationAgainstModule` builds the
  JSON-safe external command from a mutation plan and runs it through
  the in-process module adapter, completing deferred Ledger results
  before idempotency persistence. This is an internal smx-owned bridge,
  not a public framed external IPC operation.
- `beginPlannedExternalOptimizeApplyMutationAgainstModule` supports the
  CLI-style two-phase apply flow: accept the idempotency key before the
  mutation, return the deferred apply result to the caller, then persist
  the completed replay result after reload/verification completion is
  supplied. CLI `optimize apply` and MCP `optimize_apply` now use this
  internal bridge.
- `beginPlannedExternalOptimizeRestoreMutationAgainstModule` mirrors the
  two-phase restore flow so callers can use the same accepted/deferred/
  completed replay boundary. CLI `optimize restore` and MCP
  `optimize_restore` now use this internal bridge.
- external framed apply/restore validation still rejects those operation
  frames before exchange.

## Error codes

The adapter should translate IPC and engine failures into stable smx
error codes.

Recommended initial codes:

| Code | Meaning | Retryable |
|------|---------|-----------|
| `observability_engine_unavailable` | child process missing, crashed, or not ready | false |
| `observability_protocol_mismatch` | unsupported protocol or contract version | false |
| `observability_operation_timeout` | request exceeded its operation timeout | maybe |
| `observability_operation_failed` | engine rejected a valid operation | false |
| `observability_store_unavailable` | store path could not be opened | false |
| `observability_unknown_completion` | non-idempotent write may or may not have completed | false |

The engine may provide detailed internal codes in `details`, but CLI/MCP
surfaces should not expose implementation-specific exception names as
top-level error codes.

## Timeouts and ordering

Each operation class should have a timeout:

- short reads: low seconds
- repair/prune/history cleanup: longer bounded maintenance timeout
- benchmark runs: caller-provided benchmark timeout
- optimize mutations: bounded control-plane mutation timeout
- shutdown drain: short grace period

Ordering rules:

- requests may be concurrent only when the engine declares concurrent
  support
- mutation operations for the same store must be serialized unless the
  contract later proves they are safe to run concurrently
- `engine.drain` must wait for accepted writes before reporting success
- `engine.shutdown` must not start new work

## Security

The IPC contract must preserve the current secret-safe posture.

Rules:

- request and response envelopes must not include raw API keys
- config snapshots must use the same managed snapshot redaction rules as
  Ostrich
- engine stderr must be treated as logs, not machine-readable protocol
- protocol JSON must be read only from stdout
- child process environment should contain only necessary variables
- store paths must be normalized by smx before crossing IPC
- error details must avoid raw prompt bodies and provider credentials

## Compatibility tests

Before Osprey or Owl can be selected by configuration, smx needs shared
contract tests that run against an `ObservabilityModule` factory.

Minimum matrix:

- missing-store behavior for every read and cleanup port
- trace list/show/stats parity against Ostrich fixtures
- benchmark run and benchmark history parity
- optimize report persistence parity
- optimize apply/restore Ledger and snapshot parity
- retention and feature-specific cleanup boundaries
- protocol mismatch and child-process crash behavior
- timeout and unknown-completion behavior for non-idempotent operations

The same test vectors should run against Ostrich, Osprey adapter, and
Owl adapter. Ostrich remains the expected-value generator until a more
formal generated schema exists.

## Open decisions

- Whether request/response schemas should be generated from TypeScript
  types or maintained as separate JSON Schema files. The current
  recommendation is generation from TypeScript, starting with trace-read
  operations; see
  [observability-ipc-schema-generation-plan.md](../plans-and-audits/observability-ipc-schema-generation-plan.md).
- Whether external engines should share the SQLite store format or own a
  separate store format behind the same semantics.
- Whether multi-store support is needed before external engines exist.
- Whether persisted idempotency enforcement should be limited to optimize
  mutation IPC first or generalized to every write port immediately.
- Whether Osprey/Owl should be packaged with smx or discovered through a
  configured executable path.

## Recommended next step

Do not build Osprey or Owl yet. The shared module-port contract harness
now covers the missing-store baseline plus seeded trace, Ledger,
benchmark history, cost and latency optimize persistence, retention, and
feature-specific cleanup behavior, and optimize apply/restore mutation
behavior.

The no-op local IPC skeleton now exists in
`src/subsystems/observability/observability-ipc-contract.ts` and
`src/subsystems/observability/observability-ipc-dispatcher.ts`. It
frames operation requests, keeps `store.dbPath` separate from
operation-specific payloads, maps contract-version mismatches to stable
IPC errors, and dispatches framed calls back into an in-process
`ObservabilityModule`. Runtime envelope guards now live in
`src/subsystems/observability/observability-ipc-validation.ts` and
validate the request/response boundary before any external transport is
introduced. The validation layer includes operation-specific payload
guards for the full current operation list, including trace reads and
maintenance, retention pruning, Ledger reads, Control Plane Audit
start/finish, benchmark history, benchmark runs, optimization history,
optimization report persistence, and optimize mutations.

Operation-specific success-result validation now covers every current
IPC operation. The exported coverage list in
`src/subsystems/observability/observability-ipc-result-validation.ts`
is checked against the canonical operation list, so a new operation
cannot be added silently without an explicit result validator. The
result validators are split by domain modules for trace, benchmark,
Ledger/retention/control-plane audit, optimization, and shared
primitive guards.

The shared `ObservabilityModule` contract vectors now run both directly
against Ostrich and through the local IPC dispatcher, which proves the
current framed request/response path preserves the in-process module
behavior for the covered contract surface. Control Plane Audit
start/finish payloads are guarded with the same canonical Ledger
operation, source, target, actor, and status value sets used by the
in-process repositories. Benchmark run payloads are guarded for the
local framed dispatcher, including route selection, execution counts,
path mode, provenance, and task-plan identity. The current
`preflightGateway` field is still an in-process function and must be
replaced by a transport-safe preflight command or capability field
before any stdio IPC engine can own benchmark runs. Optimize report
persistence payloads are guarded for cost and latency objective shape,
candidate metadata, requested route metadata, reference tokens,
benchmark references, settings, provenance, and local timestamp
injection. Optimize mutation payloads are guarded for the local framed
dispatcher, including apply and restore selectors, read-model/config
mutation callbacks, provenance, dry-run mode, metadata, and deferred
completion flags. The current callback-shaped mutation fields are
in-process only and need transport-safe replacement before Osprey or Owl
can own optimize mutations over stdio. External transport rejects
`optimizeMutations.apply` and `optimizeMutations.restore` at the
operation boundary until that replacement is specified, even if a caller
sends a JSON-safe-looking payload.

The first external adapter boundary now lives in
`src/subsystems/observability/observability-ipc-external-adapter.ts`.
It does not spawn an engine yet; it validates requests in external
transport mode, calls an injected transport exchange, validates engine
responses and operation-specific success results, and maps malformed
frames or transport failures to stable IPC errors. `benchmarkRuns.run`
now has its first transport-safe external payload shape: local dispatch
still requires `preflightGateway`, while external transport requires
`gatewayPreflight`.

The first schema-generation spike described in
[observability-ipc-schema-generation-plan.md](../plans-and-audits/observability-ipc-schema-generation-plan.md)
now generates and checks the trace-read request/success-result schemas
without changing runtime dispatch behavior: `trace.list`,
`trace.listObservations`, `trace.getStats`, and `trace.show`. It also
generates and checks the Ledger read schemas for `ledger.list` and
`ledger.show`, plus the retention prune schema for
`retention.pruneOlderThan`. Benchmark history read schemas now cover
`benchmarkHistory.list` and `benchmarkHistory.show`; benchmark history
cleanup schemas now cover `benchmarkHistory.pruneOlderThan`,
`benchmarkHistory.deleteRun`, and `benchmarkHistory.clear`.
Optimization history read schemas now cover `optimizationHistory.list`
and `optimizationHistory.show`; optimization history cleanup schemas now
cover `optimizationHistory.pruneOlderThan`,
`optimizationHistory.deleteRun`, and `optimizationHistory.clear`.
Optimization report persistence schemas now cover
`optimizationReports.persistCost` and
`optimizationReports.persistLatency`. External benchmark run schemas now
cover `benchmarkRuns.run` with the JSON-safe `gatewayPreflight` payload
shape. Standalone external optimize command schemas now cover the
JSON-safe apply/restore command payloads, while apply/restore operation
frames remain excluded from generated operation coverage. The
generated schema artifact lives in
[../../../src/subsystems/observability/ipc-schemas/observability-ipc.schema.json](../../../../src/subsystems/observability/ipc-schemas/observability-ipc.schema.json),
with generator notes in
[../../../src/subsystems/observability/ipc-schemas/README.md](../../../../src/subsystems/observability/ipc-schemas/README.md).
The next external transport design step remains a transport-safe config
mutation command/result shape for `optimizeMutations.apply` and
`optimizeMutations.restore`.
