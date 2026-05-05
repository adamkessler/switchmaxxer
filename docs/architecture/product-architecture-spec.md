# Product Architecture Spec

## Purpose

This document describes the current product architecture embodied by the codebase.

Use it when:

- deciding whether a feature belongs on the gateway hot path or in the control plane
- grounding CLI, MCP, and observability behavior in one model
- orienting new contributors to the main runtime/data/surface split

## Core Split

Switchmaxxer is built around two primary domains:

- **gateway runtime**
- **control plane**

The gateway runtime is intentionally lean. It owns:

- HTTP listeners
- route resolution
- provider compatibility checks
- upstream forwarding
- streaming/buffered response handling
- request-path logs and observations

The control plane owns:

- CLI
- MCP
- config mutation
- gateway lifecycle management
- trace and benchmark inspection
- observability verification, repair, and pruning

## Runtime Taxonomy

In this codebase, "runtime" does not simply mean "code that happens to execute."

It means a module or subsystem layer that owns live operational behavior while
Switchmaxxer is doing real work.

Typical runtime responsibilities include:

- coordinating execution-time decisions
- managing active state or service handles
- enforcing boundary behavior during live requests or jobs
- orchestrating a subsystem's operational flow rather than just transforming
  data

This produces three useful runtime categories.

### 1. Long-Lived Runtimes

These are process-like or server-like runtimes that stay active until they are
stopped.

Current examples:

- **gateway runtime**
  - the long-running HTTP server
  - owns inbound auth, request parsing, rate limiting, proxy dispatch,
    runtime-config inspection, and request-path observability emission
- **MCP runtime**
  - the long-running stdio MCP server
  - owns MCP request handling, tool execution, session capability behavior, and
    MCP-facing control-plane access

### 2. Job-Scoped Runtimes

These runtimes are active for the duration of one bounded task or workflow,
then terminate.

Current example:

- **bench runtime**
  - the benchmark execution engine used by CLI and MCP bench surfaces
  - owns benchmark task construction, gateway/direct path selection,
    concurrency, cancellation, and benchmark sample/request-execution capture

The bench runtime is operationally significant, but it is not a daemon. It is
closer to a job runner than a persistent server.

### 3. Runtime Coordination Layers

These are not top-level long-lived runtimes, but they still deserve "runtime"
language because they coordinate live subsystem behavior at execution time.

Current examples:

- **config mutation runtime**
  - owns lock/read/mutate/normalize/validate/write flow for config mutation
- **observability runtime loader**
  - owns execution-time opening and resolution of observability services and
    SQLite store handles
- **gateway runtime helpers / request helpers**
  - own live request-path behavior such as body reading, auth-context building,
    sanitization, and runtime support logic

These modules are runtime-oriented because they coordinate operational flow.
They are not merely parsers, contracts, serializers, or pure helpers.

## CLI Relationship To Runtimes

The CLI is not itself "the runtime."

It is the terminal control-plane surface that dispatches into subsystem logic.

Examples:

- `switchmaxxer gateway run`
  - starts the gateway runtime
- `switchmaxxer mcp serve`
  - starts the MCP runtime
- `switchmaxxer bench run`
  - invokes the bench runtime
  - and may exercise the gateway runtime when benchmarking the gateway path
- `switchmaxxer config ...`
  - invokes config read/mutation logic
  - but does not start a long-lived runtime
- `switchmaxxer trace ...`
  - invokes observability service and loader logic
  - but does not start the gateway runtime

So the right mental model is:

- CLI = user-facing command surface
- runtime = subsystem operational behavior layer
- one CLI command may invoke a runtime, a job-scoped runtime, or a narrower
  runtime-coordination layer depending on the command family

## Core Data Model

The current product data model centers on:

- `models`
- `service_providers`
- `routes`

Current semantic roles:

- `routes` are the stable invocation surface
- `models` are the canonical semantic catalog
- `service_providers` are the concrete upstream transport/config layer
- `provider_model_id` is the exact upstream wire id

## Runtime Entry Points

The gateway serves:

- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`
- `GET /health`
- `GET /__switchmaxxer/runtime/config`

Current behavior:

- OpenAI listener can bridge to Anthropic upstreams when the selected route uses `anthropic-messages`
- Anthropic listener stays dialect-strict
- inbound auth is optional and config-driven
- `/health` stays minimal and unauthenticated
- `/__switchmaxxer/runtime/config` is protected when inbound auth is enabled

## Current Operator Surfaces

### CLI

Current real CLI families:

- `gateway`
- `config`
- `models`
- `providers`
- `routes`
- `test`
- `trace`
- `invoke`
- `tool`
- `bench`
- `optimize` (cost and latency model-scoped recommendations)
- `mcp`

Reserved but unsupported:

- `config migrate`

### MCP

Current MCP surface includes:

- config discovery and validation
- model/provider/route CRUD
- gateway inspection
- trace inspection, verify, repair, and prune
- benchmark listing, show, and run

### TUI / API / Browser

These are not implemented in the current repo.

This architecture document only records the boundary they would need to respect:

- reuse control-plane services
- do not move control-plane work into the gateway hot path

## Observability Subsystem

Switchmaxxer has a real persisted observability subsystem.

Current store-backed concepts:

- observations
- request executions
- benchmark runs and samples
- optimization runs
- cost facts
- optimization facts

Current operator surfaces built on that store:

- `trace ...`
- `bench list`
- `bench show`
- `optimize list`
- `optimize show`
- MCP trace and benchmark tools

## Security And Trust Boundary Notes

Current architectural posture includes:

- explicit provider endpoint policy
- optional inbound gateway auth
- dedicated provider secret mutation commands
- atomic config writes
- schema-driven MCP validation

## Architecture Source Of Truth

When this document and the implementation disagree, prefer:

- [src/index.ts](../../src/index.ts)
- [src/subsystems/hot-path/manatee/proxy/proxy.ts](../../src/subsystems/hot-path/manatee/proxy/proxy.ts) (public barrel)
- [src/subsystems/hot-path/manatee/proxy/proxy-core.ts](../../src/subsystems/hot-path/manatee/proxy/proxy-core.ts)
- [src/subsystems/hot-path/manatee/proxy/proxy-openai.ts](../../src/subsystems/hot-path/manatee/proxy/proxy-openai.ts)
- [src/subsystems/hot-path/manatee/proxy/proxy-anthropic.ts](../../src/subsystems/hot-path/manatee/proxy/proxy-anthropic.ts)
- [src/subsystems/config/config.ts](../../src/subsystems/config/config.ts)
- [src/subsystems/mcp/mcp.ts](../../src/subsystems/mcp/mcp.ts)
- [src/subsystems/observability/service.ts](../../src/subsystems/observability/service.ts)
