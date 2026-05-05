# Tech Spec for Observation Semantics

## 1. Purpose

This document defines the strict semantic contract for persisted observations in the Switchmaxxer observability subsystem.

Use it when:

- implementing the SQLite-backed observability store
- deciding which runtime facts should be persisted
- building ingestion and materialization logic
- defining CLI, MCP, API, TUI, or browser read models over observability data
- reviewing whether a new observation type belongs in the canonical store

This spec is narrower than the observability white paper. The white paper explains the architecture. This document defines the strict meaning of the records.

---

## 2. Scope

This specification defines:

- what an **observation** is
- which fields are canonical
- how `kind`, `event`, `stage`, `outcome`, and correlation identifiers should be interpreted
- the difference between debug events and measurement milestones
- the rules for request lifecycle observations
- the contract between canonical observations and derived read models

This specification does not fully define:

- the final physical SQLite DDL
- every benchmark or billing query shape
- full retention and compaction policy
- every UI or CLI surface built on top of observations

---

## 3. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as requirement levels for the semantic contract.

---

## 4. Core Definitions

### 4.1 Observation

An **observation** is one persisted record representing a runtime fact, event, milestone, or derived accounting fact captured by the Switchmaxxer observability subsystem.

An observation MUST be:

- timestamped
- attributable to a request, benchmark run, system actor, or runtime context
- semantically typed
- safe to interpret without reading freeform message text

An observation MUST NOT rely on `message` text as its only meaning-bearing field.

### 4.2 Canonical observation

A **canonical observation** is a persisted record in the `observations` table that serves as the system-of-record input for downstream read models.

Canonical observations MUST be append-oriented.

Canonical observations MUST NOT be mutated in place to change their semantic meaning after ingestion, except for narrowly scoped repair or backfill workflows.

### 4.3 Derived read model

A **derived read model** is any summary, materialization, or query-optimized projection built from canonical observations.

Examples:

- `request_executions`
- `benchmark_samples`
- `cost_facts`
- `optimization_facts`

Derived read models MUST NOT introduce semantics that contradict canonical observations.

### 4.4 Debug event

A **debug event** is an explanation-oriented observation intended to describe what Switchmaxxer decided or did during request handling.

Debug events are for:

- operator understanding
- troubleshooting
- lifecycle explanation
- failure localization

Debug events MUST NOT be treated as the canonical benchmark timing substrate.

### 4.5 Measurement milestone

A **measurement milestone** is an observation or derived timestamp representing a latency boundary relevant to benchmarking, tracing, billing timing, or optimization analytics.

Measurement milestones are for:

- duration calculation
- latency attribution
- timing decomposition

Measurement milestones MUST be modeled separately from explanation-oriented debug events, even when both describe the same part of the lifecycle.

---

## 5. Design Principles

### 5.1 Explicit semantics

The semantic meaning of an observation MUST be encoded structurally through fields such as:

- `kind`
- `event`
- `stage`
- `outcome`
- correlation identifiers
- typed attributes

### 5.2 One record, one semantic purpose

Each observation SHOULD have one primary semantic purpose.

Examples:

- explain route resolution
- mark upstream call start
- record billing-relevant usage
- record benchmark-run membership

A single observation SHOULD NOT blur explanation, timing, and accounting if those concerns can be cleanly separated.

### 5.3 Explanation and measurement separation

Switchmaxxer MUST distinguish:

- explanation-oriented lifecycle events
- measurement-oriented lifecycle milestones

For example:

- `debug_upstream_request` explains outbound request preparation
- `upstream_request_started_at` measures the start of the live upstream call

### 5.4 Sparse but typed

Observations MAY be sparse.

Not every field needs to be present for every observation.

However, any populated field MUST retain the same meaning across all observation kinds.

### 5.5 Redaction by default

Observation semantics MUST assume persisted data is redacted or safely summarized unless explicitly approved by policy.

Sensitive payload content MUST NOT be required to understand an observation's meaning.

---

## 6. Canonical Field Contract

The canonical observation model includes the following semantic fields.

### 6.1 Identity fields

- `id`
  - unique identifier for the observation record

- `request_id`
  - identifies the logical client request handled by Switchmaxxer
  - SHOULD be present for all request-scoped observations

- `trace_id`
  - identifies a trace-wide correlation scope
  - MAY equal `request_id` in simple single-span systems
  - SHOULD remain stable across all observations for one end-to-end request trace

- `span_id`
  - identifies a specific execution segment within a trace
  - MAY be absent until multi-span semantics are implemented

- `parent_span_id`
  - identifies the parent of a child span when span semantics exist

### 6.2 Time fields

- `observed_at`
  - the time the runtime fact actually occurred, as best known by Switchmaxxer
  - MUST be the primary event-time field

- `ingested_at`
  - the time the observation was persisted
  - MAY be later than `observed_at`

If both exist, systems MUST prefer `observed_at` for behavioral interpretation and duration calculation.

### 6.3 Classification fields

- `kind`
  - the top-level semantic family of the observation

- `event`
  - the specific observation name within a kind

- `stage`
  - the request-lifecycle stage relevant to this observation, if applicable

- `severity`
  - operator-oriented seriousness level for logs/debugging style observations

- `outcome`
  - normalized terminal or intermediate result classification

### 6.4 Context fields

- `surface`
  - the Switchmaxxer surface or subsystem associated with the observation

- `route_id`
- `route_name`
- `model_id`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`
- `listener`
- `actor`

These fields provide execution context and MUST retain stable meaning when present.

### 6.5 Numeric measurement fields

- `status_code`
- `latency_ms`
- `ttft_ms`
- `duration_ms`
- `request_bytes`
- `response_bytes`
- `input_tokens`
- `output_tokens`
- `total_tokens`
- `estimated_cost_micros`

These fields MUST represent measured or derived numerical facts, not guesses encoded without provenance.

### 6.6 Flexible metadata fields

- `message`
  - human-readable supporting text
  - MUST be secondary to structured fields

- `currency`
- `billing_source`
- `benchmark_run_id`
- `benchmark_case_id`
- `optimization_profile_id`
- `tags_json`
- `attributes_json`

`attributes_json` MAY carry extensible typed metadata, but core semantics MUST NOT depend exclusively on undocumented JSON subfields.

---

## 7. Allowed Semantic Families

The `kind` field SHOULD be restricted to a small stable vocabulary.

Initial allowed `kind` families:

- `debug`
- `measurement`
- `usage`
- `billing`
- `benchmark`
- `optimization`
- `system`
- `error`

Meaning:

- `debug`
  - explanation-oriented operator lifecycle facts

- `measurement`
  - timing boundary or latency-oriented facts

- `usage`
  - token, byte, or throughput-oriented facts

- `billing`
  - cost-oriented or billable-unit facts

- `benchmark`
  - benchmark-run membership or benchmark-evaluation facts

- `optimization`
  - fitness-related or quality-related facts

- `system`
  - control-plane or service-level observability facts not tied to one request lifecycle step

- `error`
  - explicit failure facts when a separate failure-oriented record is semantically useful

New `kind` values SHOULD be added rarely.

---

## 8. Allowed Lifecycle Stages

The `stage` field SHOULD come from a normalized vocabulary.

Initial allowed request-lifecycle stages:

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
- `billing`
- `optimization`

Meaning:

- `ingress`
  - request enters Switchmaxxer and initial request shape is known

- `route_resolution`
  - route lookup and target selection logic

- `listener_compatibility`
  - compatibility enforcement between listener and route/provider capabilities

- `request_shaping`
  - request translation or shaping before dispatch

- `upstream_request`
  - pre-dispatch outbound request preparation

- `upstream_fetch`
  - live outbound call and upstream wait period

- `upstream_response`
  - receipt of upstream response bytes or full upstream completion

- `response_translation`
  - transformation of upstream response into client-facing shape

- `response_stream`
  - streaming response handling after upstream response begins

- `client_response`
  - writing response back to the client

- `billing`
  - cost or billable-unit derivation phase

- `optimization`
  - post-execution optimization feature derivation phase

Stages MUST be interpreted as process boundaries, not as freeform prose labels.

---

## 9. Allowed Outcome Families

The `outcome` field SHOULD use normalized values.

Initial allowed `outcome` values:

- `started`
- `in_progress`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`
- `rejected`
- `partial`
- `unknown`

Meaning:

- `started`
  - work or a stage began

- `in_progress`
  - non-terminal ongoing state

- `succeeded`
  - terminal success

- `failed`
  - terminal failure caused by an error or invalid state

- `cancelled`
  - request or stage ended because cancellation occurred

- `timed_out`
  - request or stage ended due to timeout

- `rejected`
  - request was intentionally refused before normal completion

- `partial`
  - some output or progress was produced, but terminal completeness was not achieved

- `unknown`
  - system cannot reliably determine the final normalized outcome

---

## 10. Initial Event Vocabulary

The `event` field SHOULD come from a controlled vocabulary.

### 10.1 Debug events

Allowed initial debug events:

- `debug_ingress`
- `debug_route_resolution`
- `debug_upstream_request`
- `debug_upstream_retry`
- `debug_response_path`
- `debug_client_response`
- `debug_error_context`

These events MUST remain explanation-oriented.

Their meanings are:

- `debug_ingress`
  - request entered Switchmaxxer

- `debug_route_resolution`
  - Switchmaxxer resolved or attempted to resolve route/provider execution context

- `debug_upstream_request`
  - Switchmaxxer finished preparing the outbound request context

- `debug_upstream_retry`
  - Switchmaxxer scheduled an explicitly allowed pre-response upstream retry;
    attributes record policy, delay, reason, idempotency-key presence, and
    duplicate-risk posture

- `debug_response_path`
  - Switchmaxxer determined how the upstream response would be handled internally

- `debug_client_response`
  - Switchmaxxer completed its own client write-side response handling

- `debug_error_context`
  - lifecycle failed at a specific stage with contextual breadcrumbs

### 10.2 Measurement events

Allowed initial measurement events:

- `request_received`
- `route_resolved`
- `upstream_request_started`
- `upstream_response_started`
- `upstream_response_completed`
- `client_response_started`
- `client_response_completed`

These events MUST be treated as benchmark-grade or trace-grade timing boundaries.

### 10.3 Usage and billing events

Allowed initial usage and billing events:

- `usage_counted`
- `billing_estimated`

### 10.4 Benchmark and optimization events

Allowed initial benchmark and optimization events:

- `benchmark_sample_attached`
- `optimization_inputs_recorded`

New events SHOULD be added only with spec updates or explicit documented review.

---

## 11. Debug Semantics

### 11.1 Debug events explain behavior

Debug events MUST answer questions such as:

- what arrived
- how Switchmaxxer resolved it
- what outbound path it selected
- how it chose to handle the response
- where the lifecycle failed

### 11.2 Debug events are not benchmark timing markers

The following MUST be treated as invalid semantic assumptions:

- "`debug_route_resolution` is the benchmark timestamp for route resolution completion"
- "`debug_upstream_request` is the exact timestamp the upstream call began"
- "`debug_response_path` is the exact timestamp the upstream response arrived"
- "`debug_client_response` proves the remote client received the response"

At most, debug events MAY correlate approximately with nearby milestones.

Benchmark and timing logic MUST use explicit measurement milestones instead.

### 11.3 Debug event requirements

Every debug observation SHOULD include:

- `kind=debug`
- an allowed debug `event`
- `observed_at`
- `request_id`
- relevant lifecycle `stage`

Relevant contextual fields SHOULD be included when known:

- `route_name`
- `provider_id`
- `provider_model_id`
- `client_api_mode`
- `upstream_api_mode`

---

## 12. Measurement Semantics

### 12.1 Measurement milestones are canonical timing boundaries

The following measurement milestones SHOULD be treated as the canonical latency boundaries for request-level timing:

- `request_received`
- `route_resolved`
- `upstream_request_started`
- `upstream_response_started`
- `upstream_response_completed`
- `client_response_started`
- `client_response_completed`

### 12.2 Measurement milestones define derived timestamps

The `request_executions` read model SHOULD materialize these milestone timestamps as:

- `request_received_at`
- `route_resolved_at`
- `upstream_request_started_at`
- `upstream_response_started_at`
- `upstream_response_completed_at`
- `client_response_started_at`
- `client_response_completed_at`

### 12.3 Measurement milestones define derived durations

The following derived durations SHOULD be computed from milestone timestamps:

- `switchmaxxer_pre_upstream_ms`
  - `upstream_request_started_at - request_received_at`

- `upstream_ttft_ms`
  - `upstream_response_started_at - upstream_request_started_at`

- `upstream_duration_ms`
  - `upstream_response_completed_at - upstream_request_started_at`

- `switchmaxxer_post_upstream_ms`
  - `client_response_started_at - upstream_response_started_at`

- `client_write_ms`
  - `client_response_completed_at - client_response_started_at`

- `gateway_residency_ms`
  - `client_response_completed_at - request_received_at`

Implementations MAY add more derived durations later, but these SHOULD be the initial stable ones.

### 12.4 Client delivery boundary

`client_response_completed_at` means:

- Switchmaxxer completed its own response write-side handling

It MUST NOT be interpreted as:

- proof that the remote client definitively received the response

---

## 13. Correlation and Identity Rules

### 13.1 Request-scoped observations

Any observation describing the handling of one client request SHOULD carry `request_id`.

### 13.2 Trace-scoped observations

If `trace_id` is used, all observations belonging to one end-to-end request trace SHOULD share it.

### 13.3 Span semantics

If spans are implemented later:

- one request MAY contain multiple spans
- upstream retry attempts MAY create sibling or child spans
- fallback to another provider MAY create additional spans

Until then, `span_id` and `parent_span_id` MAY remain absent.

### 13.4 Benchmark correlation

Benchmark-related observations SHOULD additionally carry:

- `benchmark_run_id`
- `benchmark_case_id` when relevant

### 13.5 Optimization correlation

Optimization-related observations SHOULD carry `optimization_profile_id` when the corresponding route-policy context is known.

---

## 14. Required Semantics for Canonical Observations

Every canonical observation MUST satisfy these minimum rules:

- MUST include `id`
- MUST include `observed_at`
- MUST include `kind`
- MUST include `event`
- MUST include enough context to interpret its scope
- MUST be understandable without parsing `message`

Request-scoped canonical observations SHOULD also include:

- `request_id`
- relevant `stage`
- relevant route/provider fields when known

If an observation includes numerical latency or token fields, those values SHOULD be attributable to:

- direct measurement
- explicit derivation from canonical measurement milestones
- documented provider-reported usage

---

## 15. Flexible Metadata Rules

### 15.1 `message`

`message` MAY provide human-readable support text.

`message` MUST NOT be the only place where:

- the event type is expressed
- the failure stage is expressed
- the outcome is expressed
- the provider or route identity is expressed

### 15.2 `attributes_json`

`attributes_json` MAY be used for extensibility.

However:

- stable product semantics MUST NOT depend only on undocumented keys inside `attributes_json`
- any key promoted to cross-surface significance SHOULD graduate into a documented first-class field or documented sub-schema

### 15.3 `tags_json`

`tags_json` MAY carry lightweight operator or system labels for filtering, but SHOULD NOT replace typed classification fields.

---

## 16. Failure Semantics

### 16.1 Failure localization

Failures SHOULD be localized using:

- `event`
- `stage`
- `outcome=failed` or another normalized terminal value
- optional reason fields in `attributes_json` or a documented derived field

### 16.2 `debug_error_context`

`debug_error_context` MUST:

- identify the failure stage
- retain `request_id`
- retain route/provider context when known
- provide enough context for operator troubleshooting

### 16.3 Failure reason categories

Failure reasons SHOULD eventually be normalized into a stable documented vocabulary.

Until a fuller list exists, implementations SHOULD at least distinguish:

- route resolution failure
- compatibility rejection
- upstream fetch failure
- upstream timeout
- response translation failure
- response streaming failure
- client write failure
- cancellation

---

## 17. Canonical Versus Derived Contract

### 17.1 Canonical store

The `observations` table is the canonical persisted input for downstream observability features.

### 17.2 Derived tables

Tables such as:

- `request_executions`
- `benchmark_samples`
- `cost_facts`
- `optimization_facts`

are derived read models.

### 17.3 Semantic constraint

Derived tables MUST summarize, project, or materialize semantics already supported by canonical observations.

Derived tables MUST NOT silently redefine:

- timing boundaries
- route/provider identity
- terminal outcome meaning
- billing semantics

### 17.4 Materialization lag

If derived read models lag behind canonical observation ingestion, the canonical observations remain the source of truth.

---

## 18. Security and Redaction Semantics

Observation semantics MUST assume persisted data is safe for the intended local operational context.

That means:

- raw secrets MUST NOT be persisted
- sensitive payload content SHOULD NOT be persisted by default
- persisted usage, timing, and routing facts SHOULD remain interpretable without sensitive prompt or response bodies

If any payload-derived field is persisted, its meaning MUST be explicit:

- character counts
- message counts
- token counts
- presence flags
- redacted excerpts only if policy later allows them

---

## 19. Semantic Stability Rules

This semantic spec is intended to stay stable across:

- SQLite physical schema revisions
- control-plane read-model changes
- new CLI and API surfaces

Therefore:

- existing `kind`, `event`, `stage`, and `outcome` meanings SHOULD NOT drift silently
- renamed meanings SHOULD require explicit documentation and careful review
- new values SHOULD be additive where possible

---

## 20. Initial Compliance Checklist

An implementation is compliant with this semantic spec if it does all of the following:

- persists observations with explicit `kind` and `event`
- distinguishes debug events from measurement milestones
- uses `observed_at` as the primary semantic timestamp
- preserves `request_id` for request-scoped observations
- records benchmark-grade lifecycle boundaries through explicit measurement events
- avoids using `message` as the only meaning-bearing field
- keeps canonical observations as the source of truth for derived read models
- does not interpret `debug_client_response` as proof of remote client receipt

---

## 21. Initial Open Items

The following areas still need a later follow-up spec or addendum:

- full failure-reason vocabulary
- payload persistence policy
- streaming chunk-level observation semantics
- retry and multi-upstream-span semantics
- benchmark score sub-schema
- optimization quality signal sub-schema
- billing-source normalization

These are open refinements, not reasons to leave the core semantics undefined.

---

## 22. Final Recommendation

Switchmaxxer should treat observation semantics as a strict contract, not an implementation detail.

The central rules are:

- observations are the canonical persisted facts
- debug events explain behavior
- measurement milestones define timing boundaries
- derived tables summarize but do not redefine canonical meaning
- structured fields, not freeform prose, carry the product’s durable semantics

That contract is the minimum foundation needed before finalizing the physical schema and ingestion design.
