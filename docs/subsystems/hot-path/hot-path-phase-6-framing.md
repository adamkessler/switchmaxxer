# Hot-Path Phase 6 Framing

A pre-plan document for **Phase 6** of the Manatee Implementation
Plan: extracting Manatee as a class (or factory) behind the
`HotPath` interface defined in
[hot-path/contract/](../../../src/subsystems/hot-path/contract/).

This document is not the implementation plan. It is the design
framing that should precede the plan: what Phase 6 actually means,
what decisions need to be made, and where the costs and risks live.
The implementation plan gets written *after* the questions here are
answered.

## Status check

Phases 0 through 5 are complete:

- **Phase 0** — coverage audit; one critical gap closed
  ([request-body-types.ts](../../../src/subsystems/hot-path/manatee/runtime/request-body-types.ts)
  now at 100/100/100).
- **Phase 1** — `HotPath` contract types committed under
  `src/subsystems/hot-path/contract/`.
- **Phase 2** — `HotPathConfigSlice` introduced as a Manatee-internal
  type-narrower against `AppConfig`. Found that `HotPathSnapshot`
  (the contract) and `AppConfig` (smx today) are *intentionally*
  shaped differently; bridging them is Phase 6 work.
- **Phase 3** — observation emission centralized through
  `manatee/observation-emit.ts`. Two sites are typed via
  `emitObservation({ kind: "auth_decision", ... })`; the remaining
  16 sites use a transitional `emitLegacyGatewayObservation`
  passthrough.
- **Phase 4** — import audit complete; ~16 cross-seam modules
  categorized; boundary lint patterns drafted.
- **Phase 5** — file move complete. Hot-path code lives under
  `src/subsystems/hot-path/manatee/{runtime,proxy,translation}/`.
  ESLint boundary rule active with zero violations.

The carve-out is done. The hot path is a named, lint-enforced
region. Phase 6 is the next milestone; whether it is the next
*step* is the first question this doc raises.

---

## Section 1: Should we do Phase 6 at all?

This is the most important question. The framing doc opens with it
because the answer reframes everything below.

### The problem

Phase 6 is the move from "hot path is in its own directory" to
"hot path is a class/factory implementing the `HotPath` interface."
Today's code already has the right *shape* (free functions
composed in `gateway-runner.ts`); Phase 6 wraps them in a unified
object that smx interacts with through one entry point.

The work is not free. It changes the startup flow, the per-request
entry point, and how `AppConfig` flows into hot-path code. Bugs
there break requests. The benefit must justify the risk.

### Options (drivers for doing Phase 6)

#### Option A — Driver: pluggability for Fire Horse / Rust Horse

The architecture doc envisions Manatee, Fire Horse, and Rust Horse
as three implementations of the same `HotPath` interface, swappable
by config. For that to work, Manatee has to *be* a HotPath
implementation — i.e., Phase 6 must be done.

- **What goes right:** the architectural vision becomes real. Smx
  acquires a single seam where it can instantiate any HotPath
  implementation. Future Fire Horse / Rust Horse adapters slot in
  without further restructuring.
- **What goes wrong:** Fire Horse and Rust Horse are hypothetical.
  If they never get built, Phase 6's pluggability infrastructure
  is overhead with one consumer, which is exactly the
  "future-proof" anti-pattern the architecture doc warns against.

#### Option B — Driver: internal architectural cleanliness

The lint rule already enforces "Manatee doesn't reach into smx
subsystems." Phase 6 would tighten further: every dependency is a
constructor parameter or an audited primitive. No globals, no
process.env reads at request time, no on-demand secret loading.

- **What goes right:** Manatee becomes ruthlessly testable in
  isolation. Future maintainers see a clean dependency graph.
- **What goes wrong:** the lint rule already catches the worst
  failures. The marginal cleanliness gain may not justify the
  startup-flow risk. Classic OOP-for-its-own-sake risk.

#### Option C — Driver: stop here

The carve-out is sufficient. Manatee as a *concept* exists; smx
treats `src/subsystems/hot-path/manatee/` as the hot-path region.
The lint rule guards the boundary. Phase 6 is deferred indefinitely.

- **What goes right:** zero risk, zero engineering cost. The
  preparatory work pays off as cleanup-and-discipline regardless
  of whether Phase 6 ever happens.
- **What goes wrong:** if Fire Horse or Rust Horse later becomes a
  real project, Phase 6 has to happen anyway, and the deferred
  work has accumulated context cost (people forget what was
  decided).

### Recommendation

**Make Phase 6 contingent on a concrete consumer for the contract.**

If you are committed to building Fire Horse or Rust Horse within
the next quarter or two, do Phase 6 now (Option A). Without that
commitment, Option C is the right answer: the carve-out is real
work that paid off; pluggability infrastructure for an absent
second implementation is not.

Option B alone (cleanliness for cleanliness's sake) is the weakest
case. Most of its benefit was already captured by Phase 5's lint
rule and the coverage audit.

### Clarifying question

> **Is there a concrete plan to build Fire Horse, Rust Horse, or
> any third-party HotPath implementation in the next 1–2 quarters?**
> If yes → Phase 6 has a clear driver (Option A). If no → Option C
> (defer indefinitely) is the right call, and this framing doc
> closes here.

The remainder of this document assumes the answer is "yes" or
"likely yes" and proceeds to lay out the Phase 6 design questions.
If the answer is "no", everything below is theoretical.

---

## Section 2: Top-level clarifying questions

Even if Phase 6 is greenlit, several inputs from you shape the plan.
These are not design questions; they are *project framing* questions
that change the shape of the work.

### Q1. What is the time budget?

- **Days:** Phase 6 narrowly scoped; minimum viable extraction; defer
  every refinement.
- **A week:** standard scope; address the Phase 4 follow-ups (env
  reads to startup, secret materialization, ProxyRequestContext
  placement).
- **A month:** comprehensive — type up the 16 legacy passthrough emit
  sites, fully implement the `observations()` AsyncIterable, retire
  every Phase 4 audit finding.

**Recommendation:** plan for a week. Days is too narrow to address
the real findings; a month conflates Phase 6 with downstream cleanup
that should be its own work.

### Q2. What is the risk tolerance?

- Is the gateway already serving production traffic that depends on
  byte-stable observation output and request handling?
- Are there integration tests in CI that would catch a regression
  before it ships?
- Is there a staging environment with real upstreams?

**Recommendation:** treat the answer as load-bearing. The current
test suite is strong (90% line / 82% branch on hot-path code) and
integration smoke tests cover SSE streaming, but Phase 6 changes
*how the request handler is composed*, not its internals. A staging
soak before merging is worth the effort.

### Q3. Who reviews the changes, and at what cadence?

- One reviewer doing PRs incrementally, or batch review at the end?
- Mechanical-vs-design split: which moves are "trust me, mechanical"
  vs which need careful design discussion?

**Recommendation:** Phase 6 is design-heavy. PRs should be small
enough that each design decision has its own review.

### Q4. Are there constraints on `gateway-runner.ts`?

`gateway-runner.ts` is not in the hot path (Phase 0 confirmed it as
cold-path). But Phase 6 changes how it composes the request handler.
Is `gateway-runner.ts` allowed to be substantially rewritten, or
does it need to keep its current shape?

**Recommendation:** allow it to be rewritten if needed. It is the
seam between smx and Manatee; the Phase 6 design decision lives
partly there.

### Q5. What gets retired vs preserved?

- The 16 `emitLegacyGatewayObservation` sites — type them up in
  Phase 6, or defer?
- The `provider-auth.resolveRouteApiKey` per-request env read —
  refactor in Phase 6, or defer?
- The `ProxyRequestContext` type's location — move now, or defer?

**Recommendation:** these are Phase 4 findings, not Phase 6
prerequisites. Each can be its own follow-up. Phase 6's design
should not block on them.

---

## Section 3: Design decisions

Each section below states a design problem, lays out options with
their pros and cons, identifies what goes right and what goes wrong
under each option, and gives a recommendation with reasoning. Treat
the recommendation as a default to push back on, not a final answer.

### D1. Class shape: how is Manatee constructed?

#### Problem

The contract says Manatee implements the `HotPath` interface
(`start`, `reload`, `drain`, `shutdown`, `status`,
`observations`). The existing hot-path code is a collection of free
functions composed in `gateway-runner.ts`. Phase 6 has to bridge.

#### Options

##### A. Single fat class

```typescript
class Manatee implements HotPath {
  constructor(deps: ManateeDeps) { ... }
  async start(snapshot: HotPathSnapshot): Promise<void> { ... }
  async reload(snapshot: HotPathSnapshot): Promise<void> { ... }
  // every per-request handler as a method
  private async handleDataPlane(...) { ... }
  private async handleControlPlane(...) { ... }
}
```

- **What goes right:** one place to find Manatee. Simplest mental
  model.
- **What goes wrong:** existing code is functional, not OO.
  Wrapping it in a class introduces "this" semantics, makes
  testing per-method awkward, and tends to grow into a god-object.

##### B. Composer / sub-class architecture

`Manatee` is a thin orchestrator holding `DataPlaneHandler`,
`ControlPlaneReadHandler`, `HealthHandler`, etc. as sub-classes.
Each handler has its own dependency injection.

- **What goes right:** idiomatic OO; each handler is independently
  testable.
- **What goes wrong:** adds layers and files for limited benefit.
  Existing code already factored functions cleanly; converting
  each into a class is invented complexity.

##### C. Factory function returning the interface

```typescript
export function createManatee(deps: ManateeDeps): HotPath {
  let snapshot: HotPathSnapshot | null = null;
  return {
    async start(s) { snapshot = s; ... },
    async reload(s) { snapshot = s; ... },
    async drain(graceMs) { ... },
    async shutdown() { ... },
    async status() { return buildStatus(snapshot, deps, ...); },
    observations() { return deps.observationStream; }
  };
}
```

The returned object closes over an internal state cell holding the
current snapshot. Per-request handling is delegated to the existing
free functions, which receive the snapshot as a parameter.

- **What goes right:** minimal churn from existing shape — just
  glue that wraps free functions. Closures handle state. No `this`
  semantics. Easy to test by mocking deps.
- **What goes wrong:** TypeScript classes get better tooling
  support in some editors (autocomplete on `.method()`); a returned
  object literal is slightly less discoverable.

#### Recommendation

**Option C — factory function.** The existing hot path is functional
TypeScript; converting it to OO purely to satisfy a class shape is
the wrong move. The `HotPath` interface is just an object; objects
can be returned from factories. This option preserves the existing
file structure (the free functions in `runtime/`, `proxy/`,
`translation/` stay as they are) and adds a single thin file
`manatee.ts` that orchestrates them.

If a future contributor strongly prefers a class for IDE ergonomics,
flipping a factory to a class is a one-PR change. The reverse is
harder.

### D2. Where does the AppConfig → HotPathSnapshot translator live?

#### Problem

Phase 2 found the two types are intentionally different. Closing
the gap requires a translator. Where does it live?

#### Options

##### A. Inside Manatee (Manatee accepts AppConfig)

Manatee's `start(config: AppConfig)` does the translation
internally.

- **What goes right:** smx doesn't have to know about
  `HotPathSnapshot`.
- **What goes wrong:** Manatee now imports `AppConfig` —
  defeating the entire point of the contract. Out-of-process
  Manatee variants (Fire Horse, Rust Horse) cannot do this.

##### B. Outside Manatee (smx translates at startup; Manatee accepts HotPathSnapshot)

smx has a function `buildHotPathSnapshot(config: AppConfig,
readModel: CliReadModel, ...): HotPathSnapshot` that runs at
startup and reload. Manatee receives the result.

- **What goes right:** Manatee never imports `AppConfig`. The
  contract is preserved. Out-of-process Manatee variants get the
  same translated snapshot over the wire.
- **What goes wrong:** smx needs a new module to host the
  translator; the translation logic has its own correctness
  surface.

##### C. Separate `manatee-bootstrap` module

A named module `src/subsystems/hot-path/manatee-bootstrap.ts` (or
similar) sits *outside* `manatee/` but inside `hot-path/`. It owns
the translator and the smx-side instantiation of Manatee.

- **What goes right:** the translator has a discoverable home next
  to Manatee. Smx imports `createManatee` and
  `buildHotPathSnapshot` from one place.
- **What goes wrong:** mostly the same as B; just a naming
  question.

#### Recommendation

**Option C.** Same content as B, better discoverability. Place the
file at `src/subsystems/hot-path/manatee-bootstrap.ts`. Smx imports
both `createManatee` and `buildHotPathSnapshot` from it. The lint
rule covers `manatee/**` only; `manatee-bootstrap.ts` (sibling
file) is allowed to import `AppConfig`.

### D3. Lifecycle ownership: who owns the HTTP server?

#### Problem

The contract says `HotPath.start(snapshot)` makes the implementation
ready to serve. For out-of-process implementations (Fire Horse,
Rust Horse), this means binding the listening port. For
**in-process Manatee**, the listening port is owned by Node's
`http.Server`, which lives in `gateway-runner.ts`. Manatee does not
naturally own the port.

#### Options

##### A. Manatee owns the port

Manatee creates and binds the `http.Server` itself in `start()`.
`gateway-runner.ts` retires or shrinks substantially.

- **What goes right:** Manatee's `start/drain/shutdown` semantics
  match the contract literally. In-process and out-of-process
  variants are symmetric.
- **What goes wrong:** non-trivial rewrite of startup. TLS
  termination posture, max-connections tuning, graceful shutdown
  with in-flight request tracking — all currently in
  `gateway-runner.ts` — has to move.

##### B. smx (gateway-runner.ts) owns the port; Manatee handles requests

`gateway-runner.ts` keeps its current structure. Manatee exposes a
request handler closure that gateway-runner wires into the server.

- **What goes right:** minimal disruption to startup. Battle-tested
  shutdown / drain / graceful-close logic in gateway-runner stays
  put.
- **What goes wrong:** Manatee's `start/drain/shutdown` methods are
  somewhat misleading — they don't actually own the port. The
  contract semantics drift slightly between in-process and
  out-of-process implementations.

##### C. Hybrid — Manatee receives a server-control handle

`gateway-runner.ts` creates the server, then passes it (or a
control object: `{ close, getInflight, ... }`) to Manatee. Manatee's
`drain()` calls back through that handle.

- **What goes right:** preserves smx's existing server lifecycle
  while letting Manatee implement the contract semantics.
- **What goes wrong:** a control handle is an extra abstraction.
  More moving parts.

#### Recommendation

**Option B, with a documented contract caveat.** In-process
Manatee's `start/drain/shutdown` are best-effort; they delegate to
the supervisor (gateway-runner) which owns the actual server. The
contract documentation should note that in-process implementations
may not own the listening port literally, but must preserve the
behavioral contract (no new requests after `drain`, etc.).

For out-of-process variants, the supervisor is the parent process,
and the variant *does* own its port. The asymmetry is real but
honest.

Option A is overkill for Phase 6's scope. It can be revisited if
the contract symmetry becomes load-bearing.

### D4. Per-request invocation: how does smx call into Manatee?

#### Problem

Today: `gateway-runner.ts` calls `requestHandler` (a closure
returned by `createGatewayRuntimeRequestHandler({...})`). Phase 6
needs a stable way to invoke the per-request entry.

#### Options

##### A. Direct method: `manatee.handleRequest(req, res)`

- **What goes right:** explicit. Easy to call.
- **What goes wrong:** ties Manatee's interface to Node's `http`
  types. Out-of-process variants don't accept Node `IncomingMessage`.

##### B. Manatee returns a handler closure: `manatee.requestHandler()`

The closure has the existing `(req, res) => Promise<void>`
signature. Smx wires it into the HTTP server. The closure is
*not* part of the `HotPath` contract — it's a Manatee-internal
extension.

- **What goes right:** matches today's code shape exactly. The
  closure is a Node-specific detail that lives in Manatee's API,
  not the contract. Out-of-process variants don't need this method
  at all.
- **What goes wrong:** Manatee's interface is now broader than
  `HotPath` — it has the contract methods *plus* a Node-specific
  extension. Some readers may find this awkward.

##### C. Manatee implements Node's listener interface directly

Pass Manatee itself to `http.createServer(manatee)`. Requires
Manatee to be callable with the right signature.

- **What goes right:** very tight integration.
- **What goes wrong:** weird shape for an object. Hard to test.

#### Recommendation

**Option B — closure returned from `requestHandler()`.** The
closure shape is what `gateway-runner.ts` already consumes; nothing
needs to change at the HTTP-server level. The "it's not in the
contract" concern is the right answer: the contract is the
*lifecycle* and *observation* semantics; how requests flow into
the implementation is implementation-specific. In-process Manatee
exposes a Node closure; out-of-process Fire Horse exposes a
listening port.

### D5. Provider-auth secret materialization

#### Problem

Phase 4 found that `proxy-headers.ts` calls
`resolveRouteApiKey(route)` per-request, which reads `process.env`.
For Manatee to be a clean abstraction, secrets should be
materialized once and held in the snapshot, not resolved on every
request.

#### Options

##### A. Materialize at snapshot construction

`buildHotPathSnapshot` reads env vars and resolves all route API
keys at startup. The snapshot's `RouteEntry.upstream.apiKeyRef`
carries the materialized value (still wrapped in a `SecretString`
for redaction safety).

- **What goes right:** zero runtime env reads. Snapshot is
  self-contained. Reload re-materializes (so secret rotation works
  via reload). Out-of-process variants get already-materialized
  secrets over the wire.
- **What goes wrong:** snapshots hold sensitive values in memory.
  In practice, this is no different from `process.env` — the
  process already holds the values — but the redaction policy
  must be airtight (e.g., `runtime-config-handler.ts` returning a
  snapshot view must redact apiKeyRef values).

##### B. Snapshot carries SecretRefs; per-request materialization

`SecretRef` is a thin "tell me what env var or inline material to
look up" record. A `SecretMaterializer` (passed to Manatee at
construction) resolves it per-request.

- **What goes right:** secrets aren't held in the snapshot; lazy
  resolution. Closer to existing `resolveRouteApiKey` behavior.
- **What goes wrong:** per-request indirection. Doesn't solve the
  out-of-process case (the materializer can't be sent over a
  pipe).

##### C. Defer entirely; leave as-is for Phase 6

Phase 6 doesn't address the env read; it stays an in-process call
to `resolveRouteApiKey`. The audit finding becomes a follow-up.

- **What goes right:** smallest Phase 6 scope.
- **What goes wrong:** the contract remains aspirational about
  secret handling. Out-of-process variants can't be designed
  cleanly until this is solved.

#### Recommendation

**Option A.** The risk people fear ("secrets in the snapshot") is
illusory: the process already holds them in `process.env`. The
existing redaction discipline (`runtime-config-handler.ts` masks
sensitive fields, etc.) handles the only real concern. The
simplification — no per-request env reads, snapshot is
self-contained, out-of-process variants work — is large.

This does require a deliberate audit of every place a snapshot
might be serialized for status/inspection views, to confirm
materialized secrets are redacted. That audit is a sub-task of
Phase 6.

### D6. Process.env reads at request time

#### Problem

`runtime-request-handler.ts` calls `isEnvFlagEnabled(...)` per
request. The flag value should be stable for the process lifetime;
reading it per-request is overhead.

#### Options

##### A. Read at startup; snapshot the boolean

`buildHotPathSnapshot` reads env at construction. The snapshot
carries the boolean.

- **What goes right:** zero runtime env reads. Reload re-reads,
  giving runtime opt-in/opt-out via SIGHUP if needed.
- **What goes wrong:** none meaningful.

##### B. Keep per-request reads, but route through a passed-in env reader

- **What goes right:** allows runtime env changes (rare).
- **What goes wrong:** unnecessary indirection for a flag that
  rarely changes.

#### Recommendation

**Option A.** Same reasoning as D5.

### D7. ProxyRequestContext placement

#### Problem

`ProxyRequestContext` (request id, caller IP, bareModel, stream
flag, apiMode, requestStartedAt) is currently in
`src/platform/types.ts`. It is per-request internal state. Phase 4
flagged it.

#### Options

##### A. Move to `src/subsystems/hot-path/manatee/runtime/types.ts`

- **What goes right:** type lives where it's used; matches the
  carve-out posture.
- **What goes wrong:** any platform-side code that references it
  (none today, but possible) would have to import across the
  manatee boundary, which the lint rule blocks.

##### B. Promote to `src/subsystems/hot-path/contract/`

- **What goes right:** part of the contract.
- **What goes wrong:** contract is for snapshot-and-observation
  shape, not per-request internal state. Polluting the contract.

##### C. Leave in `platform/types.ts`

- **What goes right:** zero churn.
- **What goes wrong:** Manatee imports from platform/types
  needlessly; the type isn't a platform primitive.

#### Recommendation

**Option A.** It's per-request internal state; it belongs inside
Manatee. If a non-Manatee module ever needs it, that's a signal
something is wrong, not a reason to elevate the type.

### D8. The 16 legacy passthrough emit sites

#### Problem

Phase 3c migrated all emit sites through `manatee/observation-emit.ts`,
but only two are typed (`auth_decision`). 16 use the
`emitLegacyGatewayObservation` passthrough. The
`HotPathObservation` discriminated union doesn't yet cover the
shapes those 16 sites emit.

#### Options

##### A. Type all 16 in Phase 6

- **What goes right:** Phase 6 ends with a fully-typed observation
  contract. Out-of-process variants can be designed against a
  closed shape.
- **What goes wrong:** Phase 6's risk surface roughly doubles. Each
  emit site needs its variant designed, the union refined, the
  translator updated, behavior verified.

##### B. Defer; ship Phase 6 with the legacy passthrough still in use

- **What goes right:** Phase 6 stays focused on lifecycle and
  composition. Observation typing becomes its own follow-up.
- **What goes wrong:** the contract has a transitional escape
  hatch baked in for longer.

##### C. Type a few; defer the rest

E.g., type the rate-limit and request-completed events (most
common) but leave debug events as passthrough.

- **What goes right:** progress without full risk.
- **What goes wrong:** middle-ground complexity.

#### Recommendation

**Option B.** Phase 6's risk concentration is in startup-flow
changes; conflating it with observation typing dilutes review
attention and increases blast radius. Track typing as
"observation typing follow-up" — a small, easily-grepped
project (search for `emitLegacyGatewayObservation`) that can be
done one PR per call site at any time.

### D9. The `observations()` AsyncIterable

#### Problem

The contract says
`observations(): AsyncIterable<HotPathObservation>`. Today's emit
helper writes to the SQLite ledger directly via
`recordGatewayObservation`. In-process Manatee has no consumer
calling `observations()`.

#### Options

##### A. Implement the AsyncIterable

Manatee buffers observations and yields them. The existing ledger
writer becomes a consumer that iterates `manatee.observations()`.

- **What goes right:** true to the contract. Out-of-process
  variants can serialize from the same source.
- **What goes wrong:** non-trivial refactor of the observability
  subsystem. Risk of breaking ledger writes.

##### B. Stub the AsyncIterable

`observations()` returns an empty iterable for in-process Manatee.
The ledger writer remains plumbed through `recordGatewayObservation`.

- **What goes right:** zero churn to observability subsystem. Phase 6
  ships without changing observation flow.
- **What goes wrong:** in-process Manatee doesn't fully implement
  the contract. The contract test suite (when it exists) would
  reveal this gap.

##### C. Hybrid: AsyncIterable plus current ledger writer

Manatee yields observations via AsyncIterable *and* the helper
continues writing to the ledger directly.

- **What goes right:** in-process Manatee passes a contract-test
  suite. Existing ledger flow unchanged.
- **What goes wrong:** observations are emitted twice (once to
  ledger, once to the iterable). Avoidable duplication.

#### Recommendation

**Option B.** The AsyncIterable's purpose is the wire boundary for
out-of-process variants. In-process Manatee has direct access to
the observability subsystem; routing through an iterable is a
solution to a problem in-process Manatee doesn't have. When Fire
Horse arrives, the iterable becomes load-bearing — at that point
the implementation has to exist anyway.

Document this as a known gap: in-process Manatee doesn't implement
`observations()` meaningfully; it exists as a no-op stub for
contract conformance. Out-of-process variants implement it for
real.

### D10. Test re-organization

#### Problem

Phase 5 moved most hot-path tests alongside their subjects. But
several gateway-side tests cover multiple hot-path files together
and didn't move:

- `gateway-auth-and-rate-limit.test.ts`
- `runtime-control-plane.test.ts`
- `runtime-lifecycle.test.ts`
- `runtime-request-path.test.ts`
- `runtime.test-support.ts`

#### Options

##### A. Move them all into `manatee/runtime/`

- **What goes right:** consistency; all hot-path tests in
  `manatee/`.
- **What goes wrong:** some of these tests cross into cold-path
  concerns (e.g., `runtime-lifecycle.test.ts` covers
  `gateway-runner.ts` indirectly).

##### B. Leave them in `gateway/`

- **What goes right:** honest about scope; they test the
  cold-path/hot-path interface.
- **What goes wrong:** scattered organization.

##### C. Move case by case

- **What goes right:** honest and consistent.
- **What goes wrong:** more thinking per file.

#### Recommendation

**Option C, with a default toward A.** Most of these tests probably
test hot-path behavior even if they were originally written
gateway-side. Where a test genuinely covers cold-path orchestration
(e.g., supervisor lifecycle), keep it in `gateway/`. The rule:
"the test moves with the *predominant subject*."

A 10-minute scan of each test file's `describe`/`it` blocks
settles this case-by-case.

### D11. Phase 6 success criteria — what does "done" mean?

#### Problem

Phase 6 has many possible end states. The plan needs a clear
"here's what's true when we're done" line.

#### Options

##### A. Manatee class exists; gateway-runner instantiates it; nothing else changes

- **What goes right:** smallest possible move. Pluggability seam
  exists.
- **What goes wrong:** doesn't address the snapshot divergence,
  the env reads, the secret materialization. Half a job.

##### B. Above + AppConfig → HotPathSnapshot translator exists

Manatee no longer imports AppConfig. The contract is
load-bearing.

- **What goes right:** clean separation.
- **What goes wrong:** more work; some Phase 4 findings
  (env reads, secret materialization) still open.

##### C. Above + zero `process.env` reads in Manatee + zero on-demand secret resolution

The fully tight version. All snapshot-derived state actually
flows through the snapshot.

- **What goes right:** out-of-process Manatee variants can be
  designed against a closed surface.
- **What goes wrong:** doubles Phase 6's scope.

##### D. Above + observation contract fully typed (no legacy passthroughs)

- **What goes right:** complete contract.
- **What goes wrong:** triples Phase 6's scope. Conflates two
  unrelated concerns.

#### Recommendation

**Option B.** The minimum useful end state. It addresses the
contract divergence (the largest finding) and gives Manatee a
genuine HotPath identity. C is a stretch goal that can ship in
Phase 6 if time permits. D is its own project.

---

## Section 4: Risk assessment

### Risk inventory

1. **Startup-flow regression.** Phase 6 changes how the request
   handler is wired into the HTTP server. Any bug here breaks
   requests in production. *Mitigation:* small PRs, integration
   tests, staging soak.
2. **AppConfig → HotPathSnapshot translation bugs.** A field
   mistranslation manifests as wrong-behavior on all requests.
   *Mitigation:* unit tests for the translator; property tests
   verifying every relevant `AppConfig` field maps to exactly one
   `HotPathSnapshot` field.
3. **Reload regression.** The translator runs on every reload.
   Subtle bugs (e.g., stale references held by closures) could
   silently fail reload. *Mitigation:* explicit reload tests with
   field-level assertions.
4. **Secret-leak via snapshot.** If D5 picks Option A and the
   redaction discipline slips, materialized secrets could appear
   in `runtime-config-handler.ts` output. *Mitigation:* explicit
   audit of every place the snapshot is serialized.
5. **Test scope drift.** D10 case-by-case decisions could
   accumulate inconsistency. *Mitigation:* a one-page rationale
   for each test that doesn't move alongside its subject.

### Risk ordering

Highest risk first:
1. Startup-flow regression (blast radius: every request)
2. Secret-leak via snapshot (blast radius: catastrophic if
   triggered)
3. Translation bugs (blast radius: depends on field)
4. Reload regression (blast radius: every request after reload)
5. Test scope drift (blast radius: confusion, not bugs)

### What would change my risk estimate

- A staging environment available for soak testing → drops 1, 3, 4.
- Existing reload-flow tests → drops 4.
- A redaction-policy contract test → drops 2.
- All three present → Phase 6 becomes low-risk.

---

## Section 5: Recommended next steps

If you decide Phase 6 is on:

1. **Answer the clarifying questions in Section 2.** They shape the
   plan's structure.
2. **Decide the design questions in Section 3.** My recommendations
   are defaults; pushing back is encouraged.
3. **Write the Phase 6 implementation plan.** It mirrors the existing
   Manatee Implementation Plan's structure: phases, checklists, exit
   criteria, verification discipline.
4. **Set up the soak environment.** This is the single highest-leverage
   risk mitigation.

If you decide to defer Phase 6 (Option C in Section 1):

1. **Mark the existing implementation plan complete.** Phases 0–5
   are the deliverable; Phase 6 is parked.
2. **Track the Phase 4 findings** (env reads, secret materialization,
   ProxyRequestContext placement, observation typing) as standalone
   follow-up tasks. Each can be done independently of Phase 6.
3. **Revisit when a concrete consumer for the contract appears.**
   This document remains the framing when the conversation resumes.

---

## Open questions for you

In priority order:

1. **Is Fire Horse or Rust Horse a real upcoming project?** If no,
   Phase 6 should probably be deferred (Section 1, Option C).
2. **Time budget for Phase 6 if it goes ahead?** (Section 2, Q1.)
3. **Risk tolerance — staging available?** (Section 2, Q2.)
4. **D1: factory function (recommended) vs class?**
5. **D5: materialize secrets in snapshot (recommended) vs lazy
   resolution?** (This is the Phase 4 finding most likely to feel
   sensitive.)
6. **D11: Phase 6 success criteria — Option B (recommended) vs
   tighter or looser?**

Other design decisions in Section 3 follow once these are settled.
The implementation plan can then be written with concrete answers
to each.
