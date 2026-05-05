# Switchmaxxer Tools Tech Spec

## Purpose

This document defines the intended meaning of the current `smx tool`
surface.

`smx tool` is the built-in operator/developer utility family. It is distinct
from configured routes and from MCP tools exposed by `switchmaxxer mcp serve`.

Use this document when:

- designing future operator/developer utility commands
- explaining the difference between CLI tools and MCP tools
- evaluating whether a niche script like `perf-gateway` belongs in the
  supported CLI surface

## Current State

The current source tree has a real built-in utility surface:

- `switchmaxxer tool date`
- `switchmaxxer tool uptime`
- `switchmaxxer tool random`

In the current implementation:

- `tool date` prints today's local date
- `tool uptime` fetches the running gateway runtime config and computes
  elapsed time from the gateway process start timestamp
- `tool random` prints a random value between 0 and 1

This means `tool` is now a true CLI utility family rather than a
route-derived alias.

## Why The Distinction Matters

The route catalog and the CLI utility family serve different jobs:

- routes describe provider/model bindings for request forwarding
- `smx invoke --route ...` calls a configured route
- `smx mcp serve` exposes protocol-level MCP tools to local agent clients
- `smx tool ...` runs a built-in Switchmaxxer utility

Keeping those meanings separate makes help text, docs, and automation easier
to reason about.

## Terminology

This document uses these terms deliberately:

- **Route**
  - a configured runtime mapping from a Switchmaxxer route name to a
    provider, provider model identifier, API mode, and related policy
- **CLI tool**
  - a built-in Switchmaxxer utility action exposed as part of the CLI
- **MCP tool**
  - a tool exposed by `switchmaxxer mcp serve` through MCP
- **Route-derived tool**
  - a route presented through tool-like language rather than as a route

The current recommendation in this document is that CLI tools should
continue to grow as a true built-in utility surface, not become route aliases.

## Why Route-Derived Tools Are Out Of Scope

If a tool is only:

- a route by another name
- invoked through the same underlying code path
- discovered from the same route catalog

then the distinction is mostly vocabulary, not behavior.

That is why route-derived tools are not part of the current CLI surface.

## Recommended Direction

Switchmaxxer should keep `tool` as a real built-in utility concept.

Recommended meaning:

- `smx route ...`
  - manage and inspect runtime routing configuration
- `smx invoke --route ...`
  - call a configured route
- `smx mcp serve`
  - run the MCP server and expose MCP tools
- `smx tool ...`
  - run a built-in operator/developer utility provided by Switchmaxxer

Under this model, `tool` stops being a thin alias for routes and becomes
a home for useful functionality that is currently:

- buried as one-off scripts
- spread across niche command surfaces
- harder to discover than it should be

## Design Principles

Future `smx tool` commands should:

- represent a real built-in utility, not a synonym for an existing route
- be discoverable through one coherent command family
- have operator-facing names and help text
- return consistent machine-readable envelopes when `--json` is used
- remain clearly distinct from MCP tools
- be safe to run from the normal CLI without requiring a direct `node`
  invocation

## Relationship To MCP Tools

Switchmaxxer MCP already has its own real MCP tools, such as:

- `config_show`
- `routes_list`
- `gateway_health`
- `trace_show`
- `bench_run`

Those are control-plane tools exposed through the MCP protocol.

They are not the same thing as the proposed CLI `tool` concept.

Recommended distinction:

- **MCP tools**
  - machine-facing stdio protocol tools for MCP clients
- **CLI tools**
  - built-in utilities for operators and developers using `smx`

This separation should be explicit in docs and help text.

## Current Built-In Tools

The first release of the new model includes:

- `smx tool date`
- `smx tool uptime`
- `smx tool random`

These are intentionally small, but they establish the contract that
`tool` means a built-in utility owned by Switchmaxxer itself.

## Example Direction: Perf Tooling

One clear next candidate is the existing perf harness.

Current state:

- gateway perf benchmarking exists in a standalone script-oriented path
- it is currently reached through a Node-level entrypoint rather than a
  first-class operator command

Recommended future surface:

```bash
smx tool perf-gateway
smx tool perf-gateway --iterations 500 --warmup 50
smx tool perf-gateway --json
```

Meaning:

- run the gateway hot-path performance harness
- expose the capability as an intentional Switchmaxxer tool
- make it discoverable through normal CLI help

Possible future output:

- average latency
- p50 / p95 / p99
- scenario comparison
- observability-on vs observability-off comparisons
- debug logging overhead

This is a good example of code that already exists but does not currently
feel like part of the product surface.

## Example Direction: Inspect Tool

Another strong candidate is a route-turn inspection tool.

Example commands:

```bash
smx tool inspect --route summarizer
smx tool inspect --route summarizer --trace latest
smx tool inspect --route summarizer --format ascii
```

Purpose:

- help an operator visually inspect one request/response turn
- explain where transformations happen
- show what the app sends, what Switchmaxxer forwards, and what returns

Example ASCII-oriented output:

```text
App
  |
  |  POST /v1/chat/completions
  |  model=summarizer
  v
Switchmaxxer
  |
  |  route=summarizer
  |  provider=openai_direct
  |  provider_model_id=gpt-4o-mini
  |  api_mode=openai-completions
  v
Provider
  |
  |  200 OK
  |  completion tokens=143
  v
Switchmaxxer
  |
  |  normalized response
  v
App
```

Possible future features:

- render request/response leg timing
- indicate API mode translation boundaries
- show header/payload redaction markers
- highlight retry/fallback decisions
- compare direct-provider vs gateway-path behavior

This would be especially useful for debugging, onboarding, demos, and
explaining route behavior to operators who do not want to read raw logs.

## Example Direction: Ecosystem Tool

Another strong future direction is ecosystem discovery.

Example commands:

```bash
smx tool ecosystem
smx tool ecosystem --json
smx tool ecosystem --check openclaw
smx tool ecosystem --check langfuse --verbose
```

Purpose:

- detect the presence of ecosystem applications or integrations that may
  use Switchmaxxer
- report likely status, configuration health, or reachable hooks
- give operators a simple "what around me speaks Switchmaxxer?" view

Potential ecosystem checks:

- OpenClaw
- Hermes Agent
- Paperclip.ai
- Langfuse
- Promptfoo
- other future Switchmaxxer-aware apps

Possible future output:

```text
Ecosystem Status

- openclaw: detected, configured, using Switchmaxxer gateway
- hermes-agent: detected, config path found, gateway target unknown
- langfuse: detected, tracing enabled
- promptfoo: not detected
- paperclip.ai: detected, health check failed
```

This would give Switchmaxxer a real operator-utility identity that is not
well served by the current route-derived `tools` concept.

## Other Candidate Tool Families

Plausible future CLI tools include:

- `smx tool doctor`
  - environment and configuration diagnostics
- `smx tool replay-trace`
  - replay a captured trace through a chosen route/provider path
- `smx tool debug-request`
  - run one request with extra inspection or redaction-aware logging
- `smx tool export-observability`
  - produce a portable support/debug bundle
- `smx tool compare-routes`
  - compare two routes for latency, payload shape, or response deltas

These are examples, not a committed roadmap.

## Command Shape Recommendation

Recommended top-level syntax:

```text
smx tool <tool-name> [subcommand] [options]
```

Examples:

```bash
smx tool list
smx tool perf-gateway
smx tool inspect --route summarizer
smx tool ecosystem --json
```

Recommended semantics:

- `smx tool list`
  - list built-in CLI tools
- `smx tool <name>`
  - run or dispatch one built-in tool
- `smx tool <name> --json`
  - return a structured machine-facing envelope

## Recommendation

Preferred current direction:

1. Keep `routes` plus `invoke --route ...` as the canonical route-path
   model.
2. Keep `tool` as the built-in operator/developer utility family.
3. Do not reintroduce route-derived `tools` aliases.
4. Add future built-in utilities under `smx tool ...` when they are
   coherent and genuinely useful.

## Non-Goals

This document does not propose:

- turning CLI tools into MCP tools automatically
- exposing every internal helper as a supported command
- replacing the `routes` family
- changing route invocation semantics directly in this document

## Open Questions

- Which built-in utilities are stable enough to promote first?
- Should `perf-gateway` remain developer-oriented, or become an operator
  surface with bounded supported flags?
- Should `inspect` operate from live requests, traces, fixtures, or all
  three?
- Should `ecosystem` perform only local discovery, or also run network or
  health probes?

## Source Reality Note

As of the current source tree, the implemented surface is `switchmaxxer
tool`, with `date`, `uptime`, and `random` as the first built-in
subcommands.

This document remains intentionally forward-looking about what else can
grow under that model over time.
