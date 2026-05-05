# Tech Spec for Modular Hot-Path Subsystem

This document is the root technical overview for Switchmaxxer's
modular hot-path subsystem. It defines the hot path as a boundary,
explains why that boundary is useful, and introduces three theoretical
implementations of the same contract:

- **Manatee** — the in-process TypeScript implementation that ships
  with smx.
- **Fire Horse** — a future out-of-process Java 21 implementation.
- **Rust Horse** — a future out-of-process Rust implementation.

The important idea is not "rewrite the gateway in another language."
The important idea is smaller and sharper: the per-request hot path is
the part of smx that can be named, constrained, tested, and eventually
swapped behind one contract, while the rest of smx remains the control
plane that owns config, CLI, MCP, observability, persistence, and
process supervision.

## What the hot path is

The hot path is the code that executes for each gateway request. It
accepts an inbound HTTP request, authenticates and rate-limits it,
selects a route, translates request and response shapes between API
dialects, forwards to the upstream provider, streams or buffers the
response, emits observations, and returns a stable gateway result to
the caller.

The hot path should stay focused on work that must happen while a
request is in flight:

- HTTP request and response handling.
- Body-size limits and request-shape validation.
- Local gateway auth and client rate limits.
- Route selection against an immutable config snapshot.
- Provider request construction.
- OpenAI/Anthropic translation.
- Buffered and streaming upstream forwarding.
- Error classification and gateway error-envelope construction.
- Structured observation emission.
- Health and read-only runtime inspection surfaces that must share the
  data port.

The hot path should not own cold-path concerns:

- Config file parsing and mutation.
- Catalog loading.
- CLI and MCP command handling.
- Observability storage.
- Optimization and bench workflows.
- Secret discovery from disk or environment at request time.
- Long-lived operational policy that can be resolved before requests
  arrive.

The detailed per-file inventory of the original TypeScript hot path
lives in
[../architecture/tech-spec-for-hot-path.md](../../architecture/tech-spec-for-hot-path.md).
This document sits above that inventory: it describes the modular
subsystem the inventory is being shaped into.

## Why modularity matters

Modularity gives smx one stable seam between the control plane and the
request path. Smx can continue to own the product surface and operational
state, while the hot path receives only the immutable data and primitive
services it needs to answer requests.

That seam matters for three reasons.

First, it protects the current implementation. Even if Manatee remains
the only implementation forever, naming the hot path makes the boundary
auditable. It becomes possible to lint against accidental imports from
cold-path subsystems, test the request path as a subsystem, and review
changes with a clear question: "does this belong on the request path?"

Second, it makes the contract explicit. The hot path should start from
an immutable `HotPathSnapshot`, expose lifecycle/status operations, emit
typed `HotPathObservation` events, and avoid reaching back into smx for
mutable global state. Those expectations live in
[../../src/subsystems/hot-path/contract/](../../../src/subsystems/hot-path/contract/).

Third, it makes alternate implementations possible without turning smx
into a plugin framework. Manatee can be an in-process object. Fire Horse
and Rust Horse can be child processes hidden behind smx-side adapters.
From smx's point of view, all three are selected, started, reloaded,
drained, observed, and shut down through the same `HotPath` contract.

## The common shape

At the subsystem level, the architecture looks like this:

```text
              smx control plane
  config  catalog  CLI  MCP  observability
                 |
                 | HotPathSnapshot + lifecycle calls
                 v
           HotPath contract
                 |
        +--------+---------+
        |        |         |
     Manatee  Fire Horse  Rust Horse
```

Manatee implements the contract directly in TypeScript. Fire Horse and
Rust Horse, if built, are reached through TypeScript adapter objects
inside smx. Those adapters implement `HotPath`, spawn the external
process, translate method calls into framed control messages, and stream
observations back into smx.

The adapters are the key distinction: smx does not become a Java or Rust
application, and the external hot paths do not become peer services with
their own product authority. Smx remains the supervisor and source of
truth. Alternative hot paths are replaceable request engines.

## Manatee

Manatee is the default and reference hot path. It lives in this repo
under [../../src/subsystems/hot-path/manatee/](../../../src/subsystems/hot-path/manatee/)
and is always available because it ships with smx.

Manatee's job is to preserve today's behavior while making the hot path
visible as a subsystem. It uses the same runtime as smx, calls TypeScript
functions directly, and has no IPC boundary. That makes it the easiest
implementation to run, debug, test, and compare against.

Manatee is also the correctness oracle for any future implementation.
Where the contract is not yet precise enough, Manatee defines the
expected behavior. Fire Horse and Rust Horse should be validated against
Manatee, not invented as independent gateways.

The behavior-preserving migration plan for carving the existing
TypeScript request path into Manatee is
[manatee-implementation-plan.md](manatee-implementation-plan.md). The
follow-up design framing for extracting Manatee behind an actual
class/factory is
[hot-path-phase-6-framing.md](hot-path-phase-6-framing.md).

## Fire Horse

Fire Horse is the theoretical Java 21 implementation of the same hot
path. It would run out of process, own the data-port request loop, and be
spawned and supervised by smx through a smx-side `FireHorseAdapter`.

Its appeal is JVM gateway engineering: mature HTTP libraries, strong
streaming primitives, virtual threads, modern garbage collectors, and the
option to ship either a JVM distribution or a GraalVM native image. It is
an opt-in performance and operations choice for teams that are already
comfortable with the modern JVM.

Fire Horse must not define a different product. It receives snapshots
from smx, emits observations back to smx, and implements the same routing,
auth, translation, streaming, error, and status semantics as Manatee.

The deeper design exploration is in
[hypothetical-hot-path-module.md](hypothetical-hot-path-module.md),
especially its Fire Horse section.

## Rust Horse

Rust Horse is the theoretical Rust implementation of the same hot path.
Like Fire Horse, it would run as a child process behind a smx-side
adapter. Unlike Fire Horse, its center of gravity is native startup,
predictable memory use, low per-request overhead, and strong compile-time
ownership guarantees.

Rust Horse is the "fastest possible request engine" version of the
architecture. It would likely use a Rust HTTP stack and streaming JSON
tools, while preserving the same external contract and operational model
as Manatee and Fire Horse.

Rust Horse should not force Rust into the rest of smx. The control plane
stays TypeScript. The Rust binary handles request traffic only because
that is the narrow slice where a native implementation may justify its
cost.

The deeper design exploration is in
[hypothetical-hot-path-module.md](hypothetical-hot-path-module.md),
especially its Rust Horse section.

## How the docs fit together

Start here when you need the high-level subsystem model.

- [tech-spec-for-modular-hot-path-subsystem.md](tech-spec-for-modular-hot-path-subsystem.md)
  is this document: the short root overview for the modular subsystem
  and the Manatee / Fire Horse / Rust Horse framing.
- [../architecture/tech-spec-for-hot-path.md](../../architecture/tech-spec-for-hot-path.md)
  is the canonical inventory of the original per-request hot path and
  its performance/portability analysis.
- [hypothetical-hot-path-module.md](hypothetical-hot-path-module.md)
  is the long-form architecture exploration for all three
  implementations and the adapter model.
- [manatee-implementation-plan.md](manatee-implementation-plan.md)
  is the behavior-preserving plan for carving the existing TypeScript
  hot path into Manatee.
- [hot-path-coverage-audit.md](hot-path-coverage-audit.md)
  records the test coverage baseline that made the Manatee carve-out
  safe enough to execute.
- [hot-path-imports.md](hot-path-imports.md)
  audits cross-boundary imports and explains which dependencies are
  allowed, transitional, or targeted for cleanup.
- [hot-path-phase-6-framing.md](hot-path-phase-6-framing.md)
  frames the next decision: whether Manatee should become a concrete
  class/factory behind the `HotPath` contract now, later, or only when
  Fire Horse or Rust Horse becomes real.

## Current status

The hot path is currently carved out as Manatee source under
`src/subsystems/hot-path/manatee/`, with shared contract types under
`src/subsystems/hot-path/contract/`. The boundary is lint-enforced, and
Manatee remains behavior-preserving relative to the previous in-process
TypeScript gateway path.

Fire Horse and Rust Horse are theoretical. They are useful because they
force the contract to be honest: if a dependency, config shape, or
observation path only works because Manatee is in the same Node process
as smx, it is not truly part of the modular hot-path contract yet.
