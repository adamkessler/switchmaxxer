# Gateway Observation Mapping Tech Spec

## 1. Purpose

This document defines the exact mapping from the Switchmaxxer gateway runtime lifecycle into canonical observations for the observability store.

Use it when:

- implementing the observation ingestion path
- deciding which gateway events should persist directly
- deciding which measurement milestones must be emitted or derived
- implementing `request_executions` materialization
- verifying that runtime semantics match the observability schema

This document is the concrete ingestion contract between:

- the gateway runtime
- the canonical `observations` table
- the derived `request_executions` table

---

## 2. Scope

This mapping covers the gateway request lifecycle in [src/subsystems/proxy/proxy.ts](../../../src/subsystems/proxy/proxy.ts).

It includes:

- explicit debug events
- generic request/response log lines
- measurement milestones required by the observability design
- failure-stage mapping into canonical observations

It leaves out:

- benchmark-run initiated traffic
- cost fact materialization
- optimization fact materialization
- full span/attempt modeling
- chunk-level stream persistence

---

## 3. Guiding Rules

The runtime-to-observation mapping must follow these rules:

- debug lifecycle events remain explanation-oriented
- benchmark and latency timing comes from measurement milestones, not debug timestamps
- canonical observations are append-only
- `request_executions` is derived from observations
- generic text log lines are not the long-term semantic contract if a better structured event exists

Summary:

- current debug events persist as `kind=debug`
- measurement milestones persist as `kind=measurement`
- request summaries derive from both

---

## 4. Current Gateway Runtime Sources

The current runtime exposes three classes of request-path observability signals:

### 4.1 Explicit debug events

From the current gateway code:

- `debug_ingress`
- `debug_route_resolution`
- `debug_upstream_request`
- `debug_upstream_retry`
- `debug_response_path`
- `debug_client_response`
- `debug_error_context`

These are explicit and already structurally named in log output.

### 4.2 Generic request/response log lines

The gateway also emits generic lines:

- `--> REQUEST`
- `<-- RESPONSE`

These normalize into generic `request` and `response` JSON log events in the log normalizer.

These are useful for operator logs, but they should not become the primary persisted semantic model for canonical observations.

### 4.3 Measurement milestones required by the observability design

The observability design requires canonical measurement events:

- `request_received`
- `route_resolved`
- `upstream_request_started`
- `upstream_response_started`
- `upstream_response_completed`
- `client_response_started`
- `client_response_completed`

Not all of these exist as explicit runtime events. Some are added or derived in the runtime/observability path.

---

## 5. Canonical Mapping Overview

The mapping is:

| Runtime source | Persisted observation kind | Persisted observation event | Notes |
|---|---|---|---|
| explicit debug event | `debug` | same event name | persisted directly |
| generic `REQUEST` log | none as canonical event | none | superseded by `request_received` plus `debug_ingress` |
| generic `RESPONSE` log | none as canonical event | none | superseded by `client_response_completed` plus `debug_client_response` |
| request lifecycle milestone | `measurement` | milestone event | emitted or derived explicitly |
| failure context | `error` or `debug`-context-bearing failure record | `debug_error_context` in the current store | keep event name for compatibility, treat semantically as failure-bearing |

Policy:

- persist explicit debug events directly
- do not persist `request` and `response` as first-class canonical observation events
- persist measurement milestones as first-class canonical observations

---

## 6. Direct Debug Event Mapping

## 6.1 `debug_ingress`

### Runtime source

Emitter:

- `logDebugIngress(...)`

### Persisted observation

- `kind = debug`
- `event = debug_ingress`
- `stage = ingress`
- `surface = gateway`

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `client_api_mode`

### Event-specific mapped fields

- `attributes_json.method`
- `attributes_json.path`
- `actor` from caller display label
- `attributes_json.listener_api_mode`
- `attributes_json.stream`
- `attributes_json.route_hint`
- `attributes_json.message_count`
- `attributes_json.has_system_message`
- `attributes_json.prompt_chars`
- `attributes_json.tool_count`
- `attributes_json.has_metadata`
- `attributes_json.max_tokens`
- `attributes_json.temperature`

Caller display-label source rule:

- `actor` is derived from the gateway caller display-label contract, not from a raw
  arbitrary field copy
- current precedence is:
  1. `x-switchmaxxer-caller`
  2. `x-switchmaxxer-client`
  3. `x-client-name`
  4. socket remote address fallback
- the resolved caller display label is normalized before persistence:
  - empty values are ignored
  - control characters are replaced with spaces
  - the final value is bounded to 128 characters

For the full header-family semantics and trust model, see
[tech-spec-for-gateway.md](../gateway/tech-spec-for-gateway.md).

### `request_executions` effect

- create summary row if absent
- set `request_received_at` if not already set
- set `started_at`
- set `client_api_mode`

### Matching measurement milestone

- `request_received`

---

## 6.2 `debug_route_resolution`

### Runtime source

Emitter:

- `logDebugRouteResolution(...)`

### Persisted observation

- `kind = debug`
- `event = debug_route_resolution`
- `stage = route_resolution`
- `surface = gateway`

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `client_api_mode`

### Event-specific mapped fields

- `attributes_json.route_hint`
- `attributes_json.resolved`
- `route_id`
- `route_name`
- `provider_id`
- `provider_model_id`
- `upstream_api_mode`

### `request_executions` effect

- if resolution succeeded:
  - set `route_id`
  - set `route_name`
  - set `provider_id`
  - set `provider_model_id`
  - set `upstream_api_mode`

### Matching measurement milestone

- `route_resolved`

### Notes

This debug event explains the resolution outcome, but it is not itself the benchmark timing source.

---

## 6.3 `debug_upstream_request`

### Runtime source

Current emitter:

- `logDebugUpstreamRequest(...)`

### Persisted observation

- `kind = debug`
- `event = debug_upstream_request`
- `stage = upstream_request`
- `surface = gateway`

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `route_id`
- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`

### Event-specific mapped fields

- `attributes_json.forward_mode`
- `attributes_json.timeout_ms`
- `attributes_json.url`
- `attributes_json.upstream_model`
- `request_bytes` from `body_bytes`
- `attributes_json.auth_attached`
- `attributes_json.anthropic_version`

### `request_executions` effect

- no timing milestone should be set purely from this debug event
- may update request byte counts and effective upstream context

### Matching measurement milestone

- `upstream_request_started`

### Notes

This debug event is the last explanation step before the live upstream call. The actual benchmark boundary is the moment the call begins.

## 6.3.1 `debug_upstream_retry`

### Runtime source

Emitted only when the transport schedules an explicitly allowed pre-response
upstream retry.

### Persisted observation

- `kind = debug`
- `event = debug_upstream_retry`
- `stage = upstream_fetch`
- `surface = gateway`

### Required / important fields

- standard request/route/provider context
- `attributes_json.retry_attempt`
- `attributes_json.retry_next_delay_ms`
- `attributes_json.retry_reason`
- `attributes_json.retry_policy`
- `attributes_json.retry_idempotency_key_present`
- `attributes_json.retry_duplicate_risk`

### `request_executions` effect

- no timing milestone is set from this debug event
- the event is informational context for duplicate-risk and retry-policy review

---

## 6.4 `debug_response_path`

### Runtime source

Current emitter:

- `logDebugResponsePath(...)`

### Persisted observation

- `kind = debug`
- `event = debug_response_path`
- `stage = upstream_response` or `response_stream`
- `surface = gateway`

### Stage selection rule

Use:

- `stage = upstream_response` when the event is recording the initial response-handling choice after upstream response availability
- `stage = response_stream` only for stream-pipeline-specific follow-on failures or downstream streaming behavior

For the event as emitted in source, the best default is:

- `stage = upstream_response`

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`

### Event-specific mapped fields

- `attributes_json.translated`
- `attributes_json.response_mode`
- `status_code` from `upstream_status_code`

### `request_executions` effect

- may set `status_code` if not already known
- may help determine buffered vs stream path

### Matching measurement milestone

- `upstream_response_started`

### Notes

This debug event explains the chosen response path. It does not define the first-byte timestamp by itself.

---

## 6.5 `debug_client_response`

### Runtime source

Current emitter:

- `logDebugClientResponse(...)`

### Persisted observation

- `kind = debug`
- `event = debug_client_response`
- `stage = client_response`
- `surface = gateway`

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`
- `status_code`

### Event-specific mapped fields

- `attributes_json.total_time_ms`

### `request_executions` effect

- can help validate terminal summary completion
- should not be the only source for `client_response_completed_at`

### Matching measurement milestone

- `client_response_completed`

### Notes

This event means Switchmaxxer completed its own delivery work. It does not mean the remote client definitely received the response.

---

## 6.6 `debug_error_context`

### Runtime source

Current emitter:

- `logDebugErrorContext(...)`

### Persisted observation

Current mapping:

- `kind = error`
- `event = debug_error_context`
- `surface = gateway`
- `stage = <emitted stage>`
- `outcome = failed` or `rejected` or `cancelled` depending on failure class

### Required carried fields

- `observed_at`
- `request_id`
- `surface`
- `kind`
- `event`
- `stage`
- `client_api_mode`
- `route_name` if known
- `provider_id` if known
- `provider_model_id` if known
- `upstream_api_mode` if known

### Event-specific mapped fields

- `attributes_json.reason`

### Outcome mapping guidance

Current mapping:

- `request_validation` -> `rejected`
- `route_resolution` -> `rejected`
- `listener_compatibility` -> `rejected`
- `upstream_fetch` with timeout -> `timed_out`
- `upstream_fetch` with connectivity/runtime failure -> `failed`
- `response_translation` -> `failed`
- `response_stream` idle timeout -> `timed_out`
- `client_response` broken pipe caused by client abort -> `cancelled`
- `client_response` unexpected write-side failure -> `failed`

### `request_executions` effect

- set terminal `outcome`
- set `failure_stage`
- set `failure_reason`
- set `completed_at` if terminal

---

## 7. Measurement Milestone Mapping

These are the benchmark-grade timing observations that the first implementation should emit or derive explicitly.

## 7.1 `request_received`

### Source

Derived from request context creation and ingress start.

### Persisted observation

- `kind = measurement`
- `event = request_received`
- `stage = ingress`
- `surface = gateway`
- `observed_at = context.requestStartedAt`

### Required fields

- `request_id`
- `client_api_mode`
- `actor`
- `route_name` if request model is already known

### `request_executions` effect

- set `request_received_at`
- set `started_at`

---

## 7.2 `route_resolved`

### Source

Emit when route resolution completes successfully.

### Persisted observation

- `kind = measurement`
- `event = route_resolved`
- `stage = route_resolution`
- `surface = gateway`

### Required fields

- `request_id`
- `route_id`
- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`

### `request_executions` effect

- set `route_resolved_at`
- set route/provider context if not already present

---

## 7.3 `upstream_request_started`

### Source

Emit at the actual boundary where the live upstream fetch begins.

### Persisted observation

- `kind = measurement`
- `event = upstream_request_started`
- `stage = upstream_fetch`
- `surface = gateway`

### Required fields

- `request_id`
- `route_id`
- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`

### `request_executions` effect

- set `upstream_request_started_at`
- allow calculation of `switchmaxxer_pre_upstream_ms`

---

## 7.4 `upstream_response_started`

### Source

Emit when the first upstream response data becomes available to Switchmaxxer.

### Persisted observation

- `kind = measurement`
- `event = upstream_response_started`
- `stage = upstream_response`
- `surface = gateway`

### Semantics

- streaming: first chunk or first response bytes received
- non-streaming: first moment the response body becomes available to read

### `request_executions` effect

- set `upstream_response_started_at`
- allow calculation of `upstream_ttft_ms`

---

## 7.5 `upstream_response_completed`

### Source

Emit when Switchmaxxer has fully received the upstream response body.

### Persisted observation

- `kind = measurement`
- `event = upstream_response_completed`
- `stage = upstream_response`
- `surface = gateway`

### `request_executions` effect

- set `upstream_response_completed_at`
- allow calculation of `upstream_duration_ms`

---

## 7.6 `client_response_started`

### Source

Emit when Switchmaxxer begins writing the response back to the client.

### Persisted observation

- `kind = measurement`
- `event = client_response_started`
- `stage = client_response`
- `surface = gateway`

### `request_executions` effect

- set `client_response_started_at`
- allow calculation of `switchmaxxer_post_upstream_ms`

---

## 7.7 `client_response_completed`

### Source

Emit when Switchmaxxer completes its own response write-side work.

### Persisted observation

- `kind = measurement`
- `event = client_response_completed`
- `stage = client_response`
- `surface = gateway`

### `request_executions` effect

- set `client_response_completed_at`
- set `completed_at`
- allow calculation of:
  - `client_write_ms`
  - `gateway_residency_ms`

### Notes

This is the correct boundary for Switchmaxxer completion. It is not proof of remote client receipt.

---

## 8. Generic `REQUEST` and `RESPONSE` Log Line Policy

Current generic log lines:

- `--> REQUEST`
- `<-- RESPONSE`

Policy for canonical persistence:

- do not persist them as first-class canonical `event` values
- keep them in runtime logs for operator continuity
- treat them as compatibility logs, not the durable semantic contract

Reason:

- `debug_ingress` plus `request_received` is more precise than `request`
- `debug_client_response` plus `client_response_completed` is more precise than `response`

---

## 9. Current Event-to-Observation Table

| Current runtime source | Current source status | Persist canonical observation? | Observation kind | Observation event | Stage | Updates `request_executions`? |
|---|---|---|---|---|---|---|
| `debug_ingress` | emitted in source | yes | `debug` | `debug_ingress` | `ingress` | yes |
| `debug_route_resolution` | emitted in source | yes | `debug` | `debug_route_resolution` | `route_resolution` | yes |
| `debug_upstream_request` | emitted in source | yes | `debug` | `debug_upstream_request` | `upstream_request` | yes |
| `debug_upstream_retry` | emitted on allowed retry | yes | `debug` | `debug_upstream_retry` | `upstream_fetch` | yes |
| `debug_response_path` | emitted in source | yes | `debug` | `debug_response_path` | `upstream_response` | yes |
| `debug_client_response` | emitted in source | yes | `debug` | `debug_client_response` | `client_response` | yes |
| `debug_error_context` | emitted in source | yes | `error` | `debug_error_context` | emitted stage | yes |
| `--> REQUEST` | emitted in source | no | n/a | n/a | n/a | no |
| `<-- RESPONSE` | emitted in source | no | n/a | n/a | n/a | no |
| request context creation | implicit in source | yes | `measurement` | `request_received` | `ingress` | yes |
| successful route resolution completion | implicit in source | yes | `measurement` | `route_resolved` | `route_resolution` | yes |
| actual upstream fetch start | implicit in source | yes | `measurement` | `upstream_request_started` | `upstream_fetch` | yes |
| first upstream response data available | implicit in source | yes | `measurement` | `upstream_response_started` | `upstream_response` | yes |
| full upstream response received | implicit in source | yes | `measurement` | `upstream_response_completed` | `upstream_response` | yes |
| first client write begins | implicit in source | yes | `measurement` | `client_response_started` | `client_response` | yes |
| response write completes | implicit in source | yes | `measurement` | `client_response_completed` | `client_response` | yes |

---

## 10. Materialization Rules for `request_executions`

For each request:

- create the summary row at `request_received`
- enrich route/provider context at `route_resolved`
- set upstream milestones from:
  - `upstream_request_started`
  - `upstream_response_started`
  - `upstream_response_completed`
- set client milestones from:
  - `client_response_started`
  - `client_response_completed`
- update summary outcome from terminal failure/success observations
- update `partial_output` separately from terminal cause

Derived timing fields should be computed only when the necessary milestone timestamps exist.

---

## 11. Minimum Implementation Requirements

The first implementation slice must at minimum:

- preserve all current explicit debug events as canonical observations
- add or derive the seven measurement milestones
- stop relying on generic `request` and `response` as canonical persisted event names
- populate `request_executions` from the canonical observation stream
- support failure-stage and failure-reason propagation from `debug_error_context`

---

## 12. Final Recommendation

The correct ingestion model is:

- keep the explicit debug lifecycle
- persist it directly as `kind=debug`
- add explicit benchmark-grade measurement milestones
- persist those as `kind=measurement`
- map `debug_error_context` into failure-bearing canonical observations
- derive `request_executions` from the combined stream

That gives Switchmaxxer a durable observability model that matches the current gateway design while tightening semantics enough for persistence, timing analysis, and operator tooling.
