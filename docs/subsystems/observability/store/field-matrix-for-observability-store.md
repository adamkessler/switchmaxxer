# Field Matrix for the Observability Store

## 1. Purpose

This document translates the locked observability-store decisions into a field-by-field contract for the current store.

Use it when:

- drafting the SQLite DDL
- implementing observation ingestion
- implementing derived-table materialization
- reviewing requiredness, nullability, and semantic meaning
- checking whether a new field belongs in the current store or should stay out of scope

This document is the bridge between:

- the observability white paper
- the observation semantics spec
- the schema decision checklist
- the final SQLite schema

---

## 2. Scope

This matrix covers:

- the canonical `observations` table
- the primary derived table `request_executions`
- the main derived/control-plane tables:
  - `benchmark_runs`
  - `benchmark_samples`
  - `optimization_runs`
  - `config_snapshots`
  - `config_mutation_events`
  - `control_plane_action_events`
  - `optimize_mutation_idempotency`
  - `cost_facts`
  - `optimization_facts`

This is a semantic matrix, not final SQL.

Column types are given in practical SQLite-oriented terms, but the purpose here is to lock meaning and requiredness more than exact DDL syntax.

---

## 3. Conventions

### Requiredness

- `required`
  - required for every row in that table

- `conditional`
  - required only when a semantic condition is true

- `optional`
  - allowed to be null

### Source of truth

- `canonical`
  - written as part of canonical observation ingestion

- `derived`
  - materialized from canonical observations

- `control-plane`
  - primary entity managed by operator-facing workflows

### Type notation

Suggested SQLite-oriented conventions:

- `text`
- `integer`
- `real`
- `json_text`
- `boolean_int`

`boolean_int` means an integer constrained to `0` or `1`.

---

## 4. Canonical Table: `observations`

The `observations` table is the canonical system of record for persisted observability facts.

### 4.1 Identity and time fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | canonical | unique observation identifier | stable primary key |
| `observed_at` | `text` | required | canonical | event-time when the observed fact occurred | primary semantic timestamp |
| `ingested_at` | `text` | conditional | canonical | time observation was persisted | may equal `observed_at` in simple ingestion |
| `request_id` | `text` | conditional | canonical | logical client request identifier | required for request-scoped observations |
| `trace_id` | `text` | optional | canonical | trace-wide correlation identifier | optional |
| `span_id` | `text` | optional | canonical | execution-segment identifier | span semantics are not first-class |
| `parent_span_id` | `text` | optional | canonical | parent span identifier | optional current placeholder |

### 4.2 Classification fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `surface` | `text` | required | canonical | subsystem or interface that emitted the fact | required on all canonical observations |
| `kind` | `text` | required | canonical | top-level semantic family | current allowed values: `debug`, `measurement`, `usage`, `cost`, `benchmark`, `optimization`, `system`, `error` |
| `event` | `text` | required | canonical | specific observation name | globally unique stable strings |
| `stage` | `text` | conditional | canonical | request lifecycle stage | required for request-scoped lifecycle observations |
| `severity` | `text` | optional | canonical | operator-oriented seriousness level | not a substitute for `kind` or `outcome` |
| `outcome` | `text` | conditional | canonical | normalized result classification | required on terminal, failure, and summary observations; optional on intermediate facts |

### 4.3 Context fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `route_id` | `text` | conditional | canonical | stable route identifier | required after route resolution succeeds for request-scoped observations |
| `route_name` | `text` | conditional | canonical | caller/operator route name | required after route resolution succeeds for request-scoped observations |
| `model_id` | `text` | optional | canonical | canonical model identity | optional when not yet known |
| `provider_id` | `text` | optional | canonical | execution provider identity | optional before provider selection |
| `provider_model_id` | `text` | optional | canonical | provider wire-model identifier | optional before provider selection |
| `client_api_mode` | `text` | conditional | canonical | client-facing API dialect | required for request-scoped observations |
| `upstream_api_mode` | `text` | optional | canonical | upstream-facing API dialect | optional before upstream selection |
| `listener` | `text` | optional | canonical | ingress listener identity | optional but expected for gateway request handling |
| `actor` | `text` | optional | canonical | initiating actor or automation identity | optional for non-actor-scoped facts |

### 4.4 Numeric and measurement fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `status_code` | `integer` | conditional | canonical | relevant HTTP/status code | required when response status is known |
| `latency_ms` | `integer` | optional | canonical | generic latency measure for the observation | avoid overloading when a specific derived metric exists |
| `ttft_ms` | `integer` | optional | canonical | time-to-first-token or time-to-first-byte style metric | usually more appropriate in derived summaries |
| `duration_ms` | `integer` | optional | canonical | observation-scoped duration | optional for milestone rows |
| `request_bytes` | `integer` | optional | canonical | request byte size | summarized form only |
| `response_bytes` | `integer` | optional | canonical | response byte size | summarized form only |
| `input_tokens` | `integer` | optional | canonical | prompt/input token count | present only when known |
| `output_tokens` | `integer` | optional | canonical | completion/output token count | present only when known |
| `total_tokens` | `integer` | optional | canonical | total tokens | present only when known |
| `estimated_cost_micros` | `integer` | optional | canonical | estimated cost in micro-units | present only when cost estimation exists |

### 4.5 Auxiliary metadata fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `message` | `text` | optional | canonical | human-readable supporting text | must never be sole carrier of meaning |
| `currency` | `text` | optional | canonical | cost currency code | required when `estimated_cost_micros` is present in cost-oriented rows |
| `billing_source` | `text` | optional | canonical | provenance of cost estimate | optional |
| `benchmark_run_id` | `text` | conditional | canonical | owning benchmark run | required for benchmark-associated observations |
| `benchmark_case_id` | `text` | optional | canonical | benchmark case identity | optional |
| `optimization_profile_id` | `text` | conditional | canonical | optimization-profile identity | required when optimization context exists |
| `tags_json` | `json_text` | optional | canonical | lightweight filter labels | not a replacement for typed fields |
| `attributes_json` | `json_text` | optional | canonical | extensible typed metadata | must not be sole home of stable core semantics |

### 4.6 Event vocabulary for `observations.event`

Allowed events:

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

### 4.7 Stage vocabulary for `observations.stage`

Allowed stages:

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

### 4.8 Outcome vocabulary for `observations.outcome`

Allowed outcomes:

- `started`
- `in_progress`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`
- `rejected`
- `partial`
- `unknown`

### 4.9 Special semantic notes for `observations`

- `surface` is mandatory on all canonical observations.
- `request_id` is mandatory for request-scoped observations.
- `route_id` and `route_name` are required once route resolution succeeds for request-scoped observations.
- `client_api_mode` is required for request-scoped observations.
- `trace_id` is optional.
- full request and response bodies are not persisted.
- payload sampling is not allowed.
- terminal cause and partialness are distinct concepts.
- `partial_output` should be represented as a separate structured field or fact rather than relying only on `outcome=partial`.

---

## 5. Derived Table: `request_executions`

`request_executions` is the primary per-request derived summary table.

Source of truth:

- derived from canonical observations

Maintenance model:

- incrementally materialized
- rebuildable from canonical observations

### 5.1 Identity and lifecycle fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | derived | summary row identifier | primary key |
| `request_id` | `text` | required | derived | logical client request identifier | unique or near-unique per logical request |
| `started_at` | `text` | required | derived | start of request execution summary | typically aligns with `request_received_at` |
| `completed_at` | `text` | conditional | derived | terminal completion time | null while in progress |
| `request_received_at` | `text` | required | derived | request entered Switchmaxxer | canonical timing milestone |
| `route_resolved_at` | `text` | conditional | derived | route resolution completed | absent if rejected before resolution completes |
| `upstream_request_started_at` | `text` | conditional | derived | live upstream call started | absent if no upstream attempt occurred |
| `upstream_response_started_at` | `text` | conditional | derived | first upstream response data became available | TTFT anchor |
| `upstream_response_completed_at` | `text` | conditional | derived | full upstream response received by Switchmaxxer | absent for early failure |
| `client_response_started_at` | `text` | conditional | derived | Switchmaxxer began writing response to client | absent if no client response began |
| `client_response_completed_at` | `text` | conditional | derived | Switchmaxxer completed its own write-side response handling | not proof of remote client receipt |

### 5.2 Context and result fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `route_id` | `text` | conditional | derived | resolved route identity | absent for pre-resolution failure |
| `route_name` | `text` | conditional | derived | resolved route name | absent for pre-resolution failure |
| `model_id` | `text` | optional | derived | canonical model identity | optional |
| `provider_id` | `text` | optional | derived | final or effective provider identity | may reflect winning/final attempt in fallback scenarios |
| `provider_model_id` | `text` | optional | derived | final provider model identifier | optional before provider selection |
| `client_api_mode` | `text` | required | derived | client-facing API mode | request-scoped invariant |
| `upstream_api_mode` | `text` | optional | derived | upstream-facing API mode | optional if upstream not reached |
| `status_code` | `integer` | conditional | derived | effective response status code | required once response status is known |
| `outcome` | `text` | required | derived | terminal request execution outcome | summary rows are terminal/result-bearing |
| `failure_stage` | `text` | optional | derived | stage where terminal failure occurred | required on failed/rejected/timed_out cases where known |
| `failure_reason` | `text` | optional | derived | normalized failure reason or summary text | current summary text may remain lightweight |
| `observation_count` | `integer` | required | derived | number of linked observations | useful for diagnostics |

### 5.3 Measurement, usage, and cost fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `latency_ms` | `integer` | optional | derived | high-level latency if separately surfaced | optional in favor of more specific metrics |
| `ttft_ms` | `integer` | optional | derived | high-level TTFT if separately surfaced | optional in favor of `upstream_ttft_ms` |
| `duration_ms` | `integer` | optional | derived | total duration if separately surfaced | often equals `gateway_residency_ms` |
| `input_tokens` | `integer` | optional | derived | total input tokens | optional when unknown |
| `output_tokens` | `integer` | optional | derived | total output tokens | optional when unknown |
| `total_tokens` | `integer` | optional | derived | total tokens | optional when unknown |
| `estimated_cost_micros` | `integer` | optional | derived | effective estimated cost | optional when no estimate exists |
| `currency` | `text` | conditional | derived | effective cost currency | required when cost exists |

### 5.4 Stable derived timing metrics

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `switchmaxxer_pre_upstream_ms` | `integer` | conditional | derived | time spent in Switchmaxxer before live upstream call began | derived from milestone timestamps |
| `upstream_ttft_ms` | `integer` | conditional | derived | upstream time to first response data | derived from milestone timestamps |
| `upstream_duration_ms` | `integer` | conditional | derived | total upstream duration | derived from milestone timestamps |
| `switchmaxxer_post_upstream_ms` | `integer` | conditional | derived | time between first upstream response and first client write | derived from milestone timestamps |
| `client_write_ms` | `integer` | conditional | derived | time Switchmaxxer spent writing to client | derived from milestone timestamps |
| `gateway_residency_ms` | `integer` | conditional | derived | total time request spent inside Switchmaxxer | derived from milestone timestamps |

### 5.5 Timing Fields Not First-Class In The Current Store

These are not first-class fields in the current store:

- `route_resolution_ms`
- separate translation duration fields

### 5.6 Partialness and interruption notes

- `partial_output` SHOULD exist as a separate structured field or fact in the final schema or linked derived model.
- `outcome=partial` MAY still appear where semantically appropriate, but it is not the only way partialness is represented.
- client-aborted disconnects should typically map to `outcome=cancelled`.
- transport/runtime write-side failures should typically map to `outcome=failed`.

---

## 6. Control-Plane Table: `benchmark_runs`

`benchmark_runs` is a control-plane primary entity, not a purely derived table.

Source of truth:

- control-plane

Mutability:

- configuration mutable only in `draft`
- configuration immutable once execution begins
- descriptive metadata may remain lightly editable later

### 6.1 Core fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | control-plane | benchmark run identifier | primary key |
| `name` | `text` | required | control-plane | human-readable benchmark run name | operator-facing |
| `created_at` | `text` | required | control-plane | creation timestamp | immutable |
| `created_by` | `text` | optional | control-plane | creator identity | optional |
| `objective` | `text` | required | control-plane | benchmark objective | e.g. latency, cost, quality |
| `notes` | `text` | optional | control-plane | operator notes | lightly editable |
| `settings_json` | `json_text` | required | control-plane | run configuration | frozen once run leaves `draft` |
| `status` | `text` | required | control-plane | lifecycle state | allowed states: `draft`, `running`, `completed`, `failed`, `cancelled`, `archived` |

---

## 7. Derived Table: `benchmark_samples`

`benchmark_samples` is execution-linked observability data.

Source of truth:

- derived from canonical observations plus benchmark-run membership

Maintenance model:

- hybrid
- incrementally materialized and rebuildable

### 7.1 Core fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | derived | benchmark sample identifier | primary key |
| `benchmark_run_id` | `text` | required | derived | owning benchmark run | foreign key to control-plane entity |
| `request_execution_id` | `text` | required | derived | linked request execution | one sample maps to exactly one request execution |
| `route_id` | `text` | conditional | derived | route under test | usually present |
| `provider_id` | `text` | optional | derived | provider used for the execution | optional before effective provider known |
| `provider_model_id` | `text` | optional | derived | provider model used | optional |
| `sample_index` | `integer` | required | derived | sample ordering within the run | stable within run |
| `started_at` | `text` | required | derived | sample start time | usually from request execution |
| `completed_at` | `text` | conditional | derived | sample completion time | null while running |
| `status_code` | `integer` | conditional | derived | response status | optional before completion |
| `outcome` | `text` | required | derived | sample outcome | summary-level result |
| `latency_ms` | `integer` | optional | derived | sample latency measure | optional when using more specific metrics |
| `ttft_ms` | `integer` | optional | derived | sample TTFT measure | optional |
| `duration_ms` | `integer` | optional | derived | sample duration measure | optional |
| `input_tokens` | `integer` | optional | derived | input tokens | optional |
| `output_tokens` | `integer` | optional | derived | output tokens | optional |
| `total_tokens` | `integer` | optional | derived | total tokens | optional |
| `estimated_cost_micros` | `integer` | optional | derived | sample estimated cost | optional |
| `score_json` | `json_text` | optional | derived | flexible detailed scoring payload | remains flexible |
| `is_warmup` | `boolean_int` | conditional | derived | warmup indicator | recommended in final schema because warmups may be included, flagged, or excluded |

### 7.2 Score modeling rule

`score_json` remains flexible, but fields needed for:

- filtering
- sorting
- ranking
- aggregation

should not live only inside `score_json`.

The final schema SHOULD promote a small normalized comparison contract to first-class fields if benchmarking workflows need it immediately.

---

## 8. Control-Plane Table: `optimization_runs`

`optimization_runs` is command-history state for operator-invoked optimize
decisions. It is separate from `optimization_facts`, which remains per-request
derived telemetry.

Source of truth:

- control-plane

Maintenance model:

- inserted by `switchmaxxer optimize`
- read by `switchmaxxer optimize list` and `switchmaxxer optimize show`
- stores secret-safe snapshots only

### 8.1 Core fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | control-plane | optimize run identifier | primary key |
| `created_at` | `text` | required | control-plane | creation timestamp | immutable |
| `finished_at` | `text` | optional | control-plane | completion timestamp | present for completed v1 runs |
| `created_by` | `text` | required | control-plane | creator identity | `switchmaxxer optimize` for CLI v1 |
| `target_model` | `text` | required | control-plane | model-scoped optimize target | v1 is always model-scoped |
| `objective` | `text` | required | control-plane | optimize objective | v1 supports CLI/MCP `cost` and `latency` |
| `status` | `text` | required | control-plane | lifecycle state | v1 writes `completed` |
| `winner_route` | `text` | optional | control-plane | winning route id | null when no winner exists |
| `benchmark_run_id` | `text` | optional | control-plane | soft benchmark reference | populated for latency objective |
| `settings_json` | `json_text` | required | control-plane | request settings | objective-specific settings and requested routes |
| `candidate_snapshot_json` | `json_text` | required | control-plane | secret-safe candidate snapshot | no API keys or raw config |
| `result_json` | `json_text` | required | control-plane | persisted optimize report | used by `optimize show` |
| `warnings_json` | `json_text` | required | control-plane | optimize warnings | JSON array |

### 8.2 Managed config mutation tables

`config_snapshots` stores managed pre-mutation catalog snapshots for explicit
operator mutations. `config_mutation_events` stores committed mutation records:
effective config changes that can act as restore points. Attempt-level audit
history lives in `control_plane_action_events`.

`config_snapshots` core fields:

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | control-plane | snapshot id | primary key |
| `created_at` | `text` | required | control-plane | creation timestamp | immutable |
| `created_by` | `text` | required | control-plane | creator identity | CLI or MCP surface |
| `source_kind` | `text` | required | control-plane | snapshotted config kind | optimize currently writes `catalog` |
| `source_path` | `text` | required | control-plane | source file path | used to match restore to the selected config |
| `content_sha256` | `text` | required | control-plane | snapshot content hash | over `content_json` text |
| `content_json` | `json_text` | required | control-plane | redacted snapshot content | inline provider `api_key` values are masked before storage |
| `content_bytes` | `integer` | required | control-plane | snapshot byte size | non-negative |
| `retention_expires_at` | `text` | optional | control-plane | snapshot-specific expiration | prune also uses global cutoff |

`config_mutation_events` core fields:

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | control-plane | mutation event id | primary key |
| `created_at` | `text` | required | control-plane | event timestamp | immutable |
| `created_by` | `text` | required | control-plane | creator identity | CLI or MCP surface |
| `source_surface` | `text` | required | control-plane | invoking surface | constrained to `cli`, `mcp` |
| `operation` | `text` | required | control-plane | mutation kind | constrained to `optimize_apply`, `optimize_restore`, `manual_config_edit` |
| `status` | `text` | required | control-plane | mutation outcome | constrained to `succeeded`; failed, no-op, and dry-run attempt outcomes live in `control_plane_action_events` |
| `target_kind` | `text` | required | control-plane | target entity kind | constrained to `route` |
| `target_id` | `text` | required | control-plane | target entity id | route id for optimize |
| `optimization_run_id` | `text` | optional | control-plane | optimize run correlation | set for optimize apply/restore |
| `snapshot_id` | `text` | optional | control-plane | pre-mutation snapshot reference | FK to `config_snapshots` |
| `parent_event_id` | `text` | optional | control-plane | action parent | restore points at apply |
| `before_json` | `json_text` | required | control-plane | pre-mutation target state | secret-safe route/provider view |
| `after_json` | `json_text` | required | control-plane | post-mutation target state | secret-safe route/provider view |
| `metadata_json` | `json_text` | required | control-plane | operation-specific metadata | includes optimize mutation details |

`control_plane_action_events` core fields:

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | control-plane | Ledger event id | primary key |
| `created_at` | `text` | required | control-plane | action start timestamp | immutable |
| `finished_at` | `text` | optional | control-plane | action finish timestamp | set when the attempt completes |
| `created_by` | `text` | required | control-plane | creator identity | CLI or MCP surface |
| `source_surface` | `text` | required | control-plane | invoking surface | constrained to `cli`, `mcp` |
| `actor_kind` | `text` | required | control-plane | actor category | constrained to `operator`, `agent`, `system`, `unknown` |
| `actor_id` | `text` | optional | control-plane | actor identifier | reserved for richer identity |
| `session_id` | `text` | optional | control-plane | control-plane session id | set by MCP sessions when available |
| `operation` | `text` | required | control-plane | attempted operation | constrained to `optimize_apply`, `optimize_restore` |
| `status` | `text` | required | control-plane | attempt outcome | `started`, `succeeded`, `failed`, `noop`, `dry_run_succeeded`, `dry_run_failed` |
| `target_kind` | `text` | required | control-plane | target entity kind | constrained to `route` |
| `target_id` | `text` | optional | control-plane | target entity id | route id when known |
| `optimization_run_id` | `text` | optional | control-plane | optimize run correlation | set for optimize apply/restore when known |
| `mutation_event_id` | `text` | optional | control-plane | committed mutation link | FK to `config_mutation_events`; null for dry-runs, failures, and no-ops |
| `correlation_ids_json` | `json_text` | required | control-plane | cross-entity ids | run id, target route, and operation |
| `result_json` | `json_text` | required | control-plane | attempt result | `{}` until finished or when no result detail exists |
| `error_json` | `json_text` | required | control-plane | attempt error | `{}` unless the action failed |
| `metadata_json` | `json_text` | required | control-plane | operation metadata | flags such as dry-run, reload, verify, or restore selector |

Lifecycle policy:

- general control-plane action history, config mutation history, and config
  snapshots are retained until whole-store retention removes them
- whole-store retention enters through top-level `switchmaxxer prune`, MCP
  `prune`, startup retention, or periodic gateway retention
- benchmark-history cleanup does not delete control-plane action events, config
  mutation events, or snapshots
- optimize-history cleanup may delete optimize-owned committed mutation records
  and orphaned managed snapshots because those rows are restore data for optimize
  history
- optimize-history cleanup does not delete `control_plane_action_events`; the
  Ledger is managed by whole-store retention
- optimize-history cleanup must preserve non-optimize mutation records and
  snapshots still referenced by remaining events

`optimize_mutation_idempotency` core fields:

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `idempotency_key` | `text` | required | external IPC | replay key | primary key; supplied by external optimize command |
| `created_at` | `text` | required | runtime | first acceptance timestamp | immutable |
| `updated_at` | `text` | required | runtime | last status transition | ISO 8601 UTC timestamp |
| `finished_at` | `text` | optional | runtime | terminal timestamp | set for completed or failed records |
| `operation` | `text` | required | external IPC | operation name | `optimizeMutations.apply` or `optimizeMutations.restore` |
| `command_digest` | `text` | required | runtime | command intent digest | canonical SHA-256 of validated command without `idempotencyKey` |
| `status` | `text` | required | runtime | replay state | `accepted`, `completed`, `failed`, or `unknown` |
| `control_plane_action_id` | `text` | optional | runtime | Ledger action link | FK to `control_plane_action_events`; set when action opened |
| `result_json` | `json_text` | required | runtime | completed result replay | `{}` until completed |
| `error_json` | `json_text` | required | runtime | failed or unknown replay detail | `{}` until failed or unknown |

This table is only for external optimize mutation replay. It must not be pruned
while its referenced Ledger action, optimize run, or mutation event is still
retained.

---

## 9. Derived Table: `cost_facts`

`cost_facts` is the cost-oriented derived table.

Source of truth:

- derived from canonical observations

Maintenance model:

- hybrid, but may be incrementally materialized for fast reads

Current cost posture:

- estimate-only

### 9.1 Core fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | derived | cost fact identifier | primary key |
| `request_execution_id` | `text` | required | derived | linked request execution | source execution |
| `observed_at` | `text` | required | derived | time cost fact was observed or materialized | time anchor |
| `provider_id` | `text` | optional | derived | provider identity | optional for local/no-provider cases |
| `provider_model_id` | `text` | optional | derived | provider model identity | optional |
| `route_id` | `text` | conditional | derived | route identity | usually present |
| `currency` | `text` | required | derived | cost currency | required even for zero-cost cases if normalized convention requires it |
| `estimated_cost_micros` | `integer` | required | derived | estimated cost in micro-units | may be zero |
| `billable_input_tokens` | `integer` | optional | derived | billable input tokens | optional when unknown |
| `billable_output_tokens` | `integer` | optional | derived | billable output tokens | optional when unknown |
| `billable_total_tokens` | `integer` | optional | derived | billable total tokens | optional when unknown |
| `billing_dimensions_json` | `json_text` | optional | derived | provider-specific billing dimensions | flexible |
| `supersedes_cost_fact_id` | `text` | optional | derived | prior cost fact superseded by this one | supports correction chain |
| `is_current` | `boolean_int` | conditional | derived | whether this is the latest effective cost fact | recommended for fast reads |
| `cost_fact_version` | `integer` | optional | derived | version within correction chain | optional convenience field |
| `cost_fact_kind` | `text` | required | derived | cost fact role | current allowed values should include at least `estimate`, `correction` |

### 9.2 Cost semantics

- corrections create new facts
- old estimates may be superseded
- old cost facts are not overwritten in place
- zero-cost local inference is represented as explicit zero estimated cost with normal usage facts

---

## 10. Derived Table: `optimization_facts`

`optimization_facts` is the optimization-oriented derived table.

Source of truth:

- derived from canonical observations

Maintenance model:

- hybrid
- incrementally materialized and rebuildable

Current optimization posture:

- canonical optimization facts are per request
- aggregate-window optimization views are derived later as needed

### 10.1 Core fields

| Field | Type | Requiredness | Source | Meaning | Notes |
|---|---|---|---|---|---|
| `id` | `text` | required | derived | optimization fact identifier | primary key |
| `observed_at` | `text` | required | derived | optimization fact timestamp | time anchor |
| `route_id` | `text` | conditional | derived | route identity | usually present |
| `provider_id` | `text` | optional | derived | provider identity | optional if not known |
| `provider_model_id` | `text` | optional | derived | provider model identity | optional |
| `optimization_profile_id` | `text` | conditional | derived | optimization profile identity | required when profile context exists |
| `request_execution_id` | `text` | required | derived | source request execution | one fact per request |
| `outcome` | `text` | required | derived | request result classification | derived from request execution |
| `latency_ms` | `integer` | optional | derived | optimization-relevant latency | optional if more specific metrics are used elsewhere |
| `duration_ms` | `integer` | optional | derived | request duration | optional |
| `total_tokens` | `integer` | optional | derived | total token usage | optional |
| `estimated_cost_micros` | `integer` | optional | derived | estimated cost | optional |
| `quality_signal_json` | `json_text` | optional | derived | quality signal payload | flexible with minimum sub-schema |
| `fitness_inputs_json` | `json_text` | optional | derived | fitness inputs used by optimization logic | flexible but documented |

### 10.2 Quality signal rule

`quality_signal_json`:

- is not completely freeform
- may remain flexible
- should follow a documented minimum sub-schema plus optional extra fields
- may carry automated signals, human signals, or both

If a quality signal field is needed for:

- filtering
- ranking
- aggregation
- stable cross-surface interpretation

it should not live only as an undocumented JSON key.

---

## 11. Fields Intentionally Unlocked

These areas are intentionally not fully locked in this matrix:

- first-class span columns beyond nullable placeholders
- full conditional-population matrix for every optional field
- summarized-only payload field list
- route-policy linkage in optimization facts
- chunk-level stream observation persistence

These should not block the current DDL so long as the schema keeps enough room for additive evolution.

---

## 12. Current Relationship To The Schema

This matrix aligns with:

- [tech-spec-for-observability-store-schema.md](tech-spec-for-observability-store-schema.md)

That schema document carries the concrete:

- concrete table definitions
- primary keys
- foreign keys
- indexes
- constraints
- metadata tables

Use this matrix for field meaning and the schema doc for table shape.
