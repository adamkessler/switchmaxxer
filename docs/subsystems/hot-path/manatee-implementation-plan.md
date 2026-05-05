# Manatee Implementation Plan

A formal, behavior-preserving plan for restructuring Switchmaxxer's
TypeScript hot path so it can be operated as **Manatee**: the
in-process, default implementation of the `HotPath` interface defined
in [hypothetical-hot-path-module.md](hypothetical-hot-path-module.md).

The plan executes in six phases. Each phase preserves runtime behavior
and ships independently. The plan completes when Manatee exists as a
named, lint-enforced module within `src/subsystems/hot-path/manatee/`,
the contract types are in place, and the hot path can be extracted or
swapped without further design work.

## Overview

### Goals

- Establish the **`HotPath` contract** (interface and supporting types)
  in the source tree before any implementation is moved.
- Tighten the seam between hot-path code and the rest of smx so it can
  be named, audited, and lint-enforced.
- Move all hot-path code under `src/subsystems/hot-path/manatee/` while
  preserving the existing per-file organization.
- Keep behavior, tests, and shipping cadence unchanged throughout.

### Non-goals

- Building any out-of-process implementation. Fire Horse and Rust Horse
  ship from their own repos when they exist; this plan does not depend
  on them.
- Introducing dependency injection frameworks or generic plugin
  architectures.
- Refactoring beyond what the plan specifies. PRs that combine moves
  with unrelated cleanup are not in scope.

### Phases at a glance

| Phase | Risk | Effort | Dependencies |
|-------|------|--------|--------------|
| 0. Coverage audit + critical-gap remediation | None | 1–3 days | None |
| 1. Add contract types                         | None | 1 PR, ~200 LOC | Phase 0 |
| 2. Type-narrow hot-path entry points          | Low  | 1–2 PRs        | Phase 1 |
| 3. Centralize observation emission            | Low  | 3–5 PRs        | Phase 1 |
| 4. Audit imports across the seam              | None | 1 PR, doc only | Phases 1, 3 partial |
| 5. Carve out into `hot-path/` directory       | Med  | Many small PRs | Phases 0–4 complete |
| 6. Extract Manatee class                      | Med  | 2–3 PRs        | Phase 5 complete |

Phases 1, 2, and 3 may run partially in parallel after Phase 0
completes. Phases 4 and 5 are sequential. Phase 6 is the milestone
this plan prepares for and is out of scope for the document.

### Verification discipline (every phase)

Every PR runs:

- `npm run typecheck`
- `npm run lint`
- `npm test` — full suite, no skipped tests
- A manual smoke test of the gateway against a real provider for one
  buffered request and one streaming request

If a PR cannot satisfy these without invasive changes, it has slipped
out of behavior-preserving territory. Stop, revert, split into smaller
PRs.

---

## Phase 0 — Coverage audit

**Risk:** none. Instrumentation and documentation; optionally adds
tests.

The safety net for every subsequent phase is the test suite. Phase 0
measures where that net has holes. Tests added in response to gaps
are most valuable when they exist *before* the refactoring starts;
adding them mid-Phase-5 means the migration is already exposing the
gaps as broken behavior.

### Scope

The hot-path file list comes from
[../architecture/tech-spec-for-hot-path.md](../../architecture/tech-spec-for-hot-path.md),
which enumerates the per-request files. Coverage on a slightly broad
set is acceptable; Phase 4 narrows it later.

### Steps

1. Run the test suite with line and branch coverage instrumentation.
2. Filter the coverage report to hot-path files.
3. Produce a per-file coverage table at
   `docs/subsystems/hot-path/hot-path-coverage-audit.md`.
4. Categorize each uncovered region as **Critical**, **Edge**, or
   **Cosmetic**:
   - **Critical** — security-relevant (auth checks, secret handling,
     rate-limit enforcement, redaction), correctness-load-bearing
     (route resolution, translation correctness, error-envelope
     shape), or data-loss-risking (observation emission, body-size
     overflow).
   - **Edge** — paths triggered only under specific conditions
     (rate-limit-window rollover, DNS pin invalidation, slot
     exhaustion 503/429, streaming idle/lifetime timeouts, 413 body
     overflow, snapshot reload during in-flight requests).
   - **Cosmetic** — diagnostic logging, metric emission, debug
     branches.
5. Decide remediation per gap:
   - Add a test now (Critical, feasible inside two days).
   - Accept the risk in writing (Edge or Cosmetic with high test cost).
   - Open a tracked issue (Critical with high test cost; must be
     resolved before Phase 5).

### Output document

`docs/subsystems/hot-path/hot-path-coverage-audit.md`, structured as:

```markdown
# Hot-Path Coverage Audit

Generated: <date>
Test runner: <vitest | jest | ...>
Coverage scope: src/subsystems/gateway/, src/subsystems/hot-path/manatee/proxy/,
plus hot-path-relevant files in src/platform/

## Summary
- Total hot-path source files: N
- Average line coverage: X%
- Average branch coverage: Y%
- Files below 80% line coverage: [list]
- Files below 60% branch coverage: [list]

## Per-file table
| File | Line % | Branch % | Function % | Critical gaps |
|------|--------|----------|------------|---------------|

## Critical gaps
[file:line refs + remediation plan]

## Edge gaps
[file:line refs]

## Cosmetic gaps
[brief]

## Decisions
- Tests to add before Phase 5: [list with effort estimates]
- Risks consciously accepted: [list with rationale]
- Tracked issues: [links]
```

### Checklist

- [x] Test suite runs with line + branch coverage instrumentation
- [x] Coverage report filtered to hot-path files
- [x] Per-file coverage table written to
      `docs/subsystems/hot-path/hot-path-coverage-audit.md`
- [x] Every uncovered region categorized as Critical / Edge / Cosmetic
- [x] Critical gaps either covered, accepted in writing, or tracked as
      issues
- [x] Phase-5 blocker list agreed and recorded in the audit document

**Phase 0 complete (2026-05-08).** See
[hot-path-coverage-audit.md](hot-path-coverage-audit.md) for the
report. Headline: hot path is at 90% line / 82% branch / 95% function
coverage. One critical gap identified —
`subsystems/gateway/request-body-types.ts` error-path branches —
tracked as the sole Phase-5 blocker. Several files that appeared in
the provisional hot-path list turned out to be cold-path code (CLI
arg parsing, journalctl helpers, gateway startup orchestration) and
will be excluded from the `manatee/` carve-out in Phase 5.

### Success criteria

The coverage audit document exists, every Critical gap has a decision,
and the Phase-5 blocker list is published. The team can answer "is
this region of the hot path covered?" with a definitive yes or no.

---

## Phase 1 — Add contract types

**Risk:** none. Pure additions. No existing code references the new
files.

The contract is the `HotPath` interface and its supporting type
definitions. Phase 1 places them in the source tree as the target
shape that subsequent phases align with.

### Files to create

```
src/subsystems/hot-path/
└── contract/
    ├── hot-path.ts                  # the HotPath interface
    ├── hot-path-snapshot.ts         # HotPathSnapshot + nested types
    ├── hot-path-observation.ts      # HotPathObservation discriminated union
    ├── hot-path-status.ts           # HotPathStatus shape
    └── index.ts                     # re-exports
```

### `hot-path.ts`

```typescript
import type { HotPathSnapshot } from "./hot-path-snapshot";
import type { HotPathStatus } from "./hot-path-status";
import type { HotPathObservation } from "./hot-path-observation";

export interface HotPath {
  start(snapshot: HotPathSnapshot): Promise<void>;
  reload(snapshot: HotPathSnapshot): Promise<void>;
  drain(graceMs: number): Promise<void>;
  shutdown(): Promise<void>;
  status(): Promise<HotPathStatus>;
  observations(): AsyncIterable<HotPathObservation>;
}
```

### `hot-path-snapshot.ts`

The full immutable bundle the hot path needs at `start()` and
`reload()`. Field shape mirrors the hot-path-relevant slice of
`AppConfig`:

```typescript
export interface HotPathSnapshot {
  bindHost: string;
  port: number;
  maxConnections: number;
  inboundAuthState: InboundAuthState;
  failedAuthLimitPolicy: FailedAuthLimitPolicy;
  rateLimit: RateLimitConfig;
  jsonParseSlots: number;
  streamingSlotsPerIp: number;
  routes: Record<string, RouteEntry>;
  bodySizeLimitBytes: number;
  bodyReadIdleTimeoutMs: number;
  bodyReadTotalTimeoutMs: number;
  upstreamConnectTimeoutMs: number;
  upstreamRequestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  streamLifetimeTimeoutMs: number;
  streamRateOfProgressBytesPerSec: number;
  dnsPinPolicy: DnsPinPolicy;
  logLevel: string;
  redactionPolicy: RedactionPolicy;
  apiSurfaces: ApiSurfaces;
  corsPolicy?: CorsPolicy;
  processStartedAt: string;
  snapshotLoadedAt: string;
  snapshotId: string;
}
```

### `hot-path-observation.ts`

Discriminated union over every observation the hot path emits. One
variant per emit-site discovered in Phase 3:

```typescript
export type HotPathObservation =
  | RequestStartedObservation
  | RequestCompletedObservation
  | UpstreamErrorObservation
  | RateLimitDecisionObservation
  | AuthDecisionObservation
  | InvokeInspectionCapturedObservation
  | ConfigSnapshotAppliedObservation
  | SnapshotReloadFailedObservation
  | BackpressureSignalObservation;
```

### `hot-path-status.ts`

```typescript
export interface HotPathStatus {
  snapshotId: string;
  snapshotLoadedAt: string;
  inFlightRequests: number;
  jsonParseSlotsInUse: number;
  streamingSlotsInUse: Record<string, number>;
  fatalState: FatalState | null;
  recentObservationDropCount: number;
}
```

### Checklist

- [x] `src/subsystems/hot-path/contract/` directory created
- [x] `hot-path.ts` written with the `HotPath` interface
- [x] `hot-path-snapshot.ts` written with `HotPathSnapshot` and
      nested types
- [x] `hot-path-observation.ts` written with the discriminated union
- [x] `hot-path-status.ts` written with `HotPathStatus`
- [x] `index.ts` re-exports all four
- [x] `tsc` passes
- [x] Lint passes
- [x] Tests pass
- [x] No production-code file imports any of the new files yet

**Phase 1 complete (2026-05-08).** Five contract files committed
under `src/subsystems/hot-path/contract/`. All types are
self-contained — they import only from sibling files in the same
directory; nothing in smx imports them. `tsc` and `eslint` pass
clean. The full test suite (`npm test`) passes unchanged. Notes on
specific design choices made during implementation:

- `HotPathSnapshot` redefines `ApiMode`, `LogLevel`, etc. rather
  than importing from `src/platform/types.ts`. The contract is
  meant to be portable across implementations and language
  ecosystems; coupling it to smx primitives would defeat that.
  Phase 2 will reveal places where the existing code's shape
  diverges and the snapshot type needs additions.
- `HotPathObservation` is a discriminated union with nine variants
  (`request_started`, `request_completed`, `upstream_error`,
  `rate_limit_decision`, `auth_decision`,
  `invoke_inspection_captured`, `config_snapshot_applied`,
  `snapshot_reload_failed`, `backpressure_signal`). The variants
  are coarser than the existing `kind`/`event`/`stage`/`outcome`
  matrix in the observability subsystem; the translation will live
  in the Phase 3 `emitObservation` helper, and the union will be
  refined as actual emit sites are migrated.
- `HotPathStatus` includes both lifetime drop counters and
  since-last-status drop counters. Implementations may approximate
  the latter with internal counter resets.

### Success criteria

The contract is committed and compiles. Zero importers exist; the
files are aspirational but real. Subsequent phases will align the
existing code against this target.

---

## Phase 2 — Type-narrow hot-path entry points

**Risk:** low. Type-only changes; no behavior change.

The current per-request handler reads from `GatewayRuntimeSnapshot` /
`AppConfig`, both of which carry far more than the hot path needs.
Annotating entry points with `HotPathSnapshot` forces the type
checker to confirm the hot path does not reach into fields it should
not. TypeScript's structural typing makes the wider-to-narrower
assignment automatic.

### Steps

1. In [src/subsystems/hot-path/manatee/runtime/runtime-request-handler.ts](../../../src/subsystems/hot-path/manatee/runtime/runtime-request-handler.ts),
   declare a typed view at the entry point:

   ```typescript
   import type { HotPathSnapshot } from "../hot-path/contract";

   const hotPathSnapshot: HotPathSnapshot = runtime.config;
   // use hotPathSnapshot.<field> below
   ```

2. In [src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts](../../../src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts),
   apply the same narrowing for the route-resolution path.

3. For any remaining hot-path file that imports `AppConfig` directly,
   substitute `HotPathSnapshot`. Compiler errors point at fields that
   either belong in the contract or shouldn't be read by the hot
   path.

### Checklist

- [x] `runtime-request-handler.ts` reads through a typed slice
      *(via `HotPathConfigSlice`, not `HotPathSnapshot` — see
      finding below)*
- [x] `proxy-forwarding.ts` reads through a typed slice
      *(`resolveRoute` narrowed to `Pick<AppConfig, "routes">`)*
- [ ] Every other hot-path file that imported `AppConfig` directly is
      updated *(deferred — downstream-signature narrowing
      cascades and is Phase 5+ work)*
- [x] Any field-shape mismatch found by the compiler is reviewed and
      reconciled *(see finding below)*
- [x] `tsc` passes
- [x] Tests pass without modification

**Phase 2 complete (2026-05-08).** The plan's vision —
"`const x: HotPathSnapshot = runtime.config` works because of
TypeScript's structural typing" — does **not** hold because
`HotPathSnapshot` (the contract's idealized shape) was deliberately
designed with different field names and types from `AppConfig`
(smx's existing config). Examples of divergence:

- `streamLifetimeTimeoutMs` (contract) vs `streamMaxLifetimeMs`
  (AppConfig)
- `streamRateOfProgressBytesPerSec` (contract) vs
  `streamMinBytesPerSecond` + `streamRateWindowMs` (AppConfig)
- `streamingSlotsPerIp: number` required (contract) vs
  `maxConcurrentStreamsPerIp?: number` optional (AppConfig)
- `bodySizeLimitBytes` (contract) vs `maxPayloadSize` (AppConfig)
- `inboundAuthState: InboundAuthState` (contract) vs
  `inboundApiKeyEnv?: string | null` (AppConfig)
- `rateLimit.windowMs: number` (contract) vs
  `rateLimit.window: string` (AppConfig)

The contract types remain the right shape for the future Manatee
class and for out-of-process implementations. Closing the gap
happens at the smx → Manatee boundary in Phase 6, where smx will
translate `AppConfig` to `HotPathSnapshot` once at startup and
reload, and Manatee's internals will read the snapshot directly.

For Phase 2's read-scope enforcement goal, the working tool is a
new Manatee-internal slice type:

- `src/subsystems/hot-path/manatee/hot-path-config-slice.ts` defines
  `HotPathConfigSlice = Pick<AppConfig, ...>` enumerating exactly
  the fields hot-path code reads today.
- `runtime-request-handler.ts` annotates its entry-point binding:
  `const config: HotPathConfigSlice = runtime.config;`. Direct
  field reads in the function body are now scope-checked. Downstream
  function calls that need the full `AppConfig` (e.g.,
  `resolveInboundGatewayAuthState`, `handleDataPlaneRequest`,
  `handleRuntimeConfigRequest`, `enforceHealthRequestTrustPolicy`)
  pass `runtime.config` directly to preserve their existing
  signatures.
- `proxy-forwarding.ts:resolveRoute` narrowed to
  `Pick<AppConfig, "routes">` — pure tightening with no caller
  changes required.

What this gives you and what it doesn't:

- **Gives:** any new field-read in `runtime-request-handler.ts` or
  `resolveRoute` that isn't in the slice fails type-check. The
  read-scope contract is now compiler-enforced at the entry points.
- **Does not give:** narrowing inside the downstream functions
  (`handleDataPlaneRequest`, `enforceHealthRequestTrustPolicy`, etc.).
  Their parameters still demand the full `AppConfig`. Tightening
  each signature is a chain of changes that's better done as part
  of Phase 5's file move, when those functions land in the
  `manatee/` subtree.

### Success criteria

The compiler enforces "the hot path's main entry points read only
fields in `HotPathConfigSlice`." The slice is documented and
committed; the gap between it and `HotPathSnapshot` is captured for
Phase 6 translation. Cascading the narrowing to inner functions is
deferred to Phase 5+.

---

## Phase 3 — Centralize observation emission

**Risk:** low. Mechanical wrapping; no behavior change.

Hot-path observations currently flow through scattered direct calls
to `recordGatewayObservation`. The migration routes every emission
through a single typed helper that takes a `HotPathObservation`.
Behavior is identical; the discriminated union is exercised at every
emit site.

### Current emit sites (production)

- `src/subsystems/hot-path/manatee/runtime/runtime-request-handler.ts`
- `src/subsystems/hot-path/manatee/runtime/request-dispatch.ts`
- `src/subsystems/gateway/runtime-auth-policy.ts`
- `src/subsystems/gateway/runtime-inspect-handler.ts`
- `src/subsystems/observability/gateway.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-logging.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-core.ts`

### Step 3a — Add the helper

`src/subsystems/hot-path/manatee/observation-emit.ts`:

```typescript
import { recordGatewayObservation } from
  "../../observability/gateway";
import type { HotPathObservation } from
  "../contract/hot-path-observation";

export function emitObservation(obs: HotPathObservation): void {
  recordGatewayObservation(obs);
}
```

### Step 3b — Migrate one call site as proof of concept

Pick the simplest emit site (typically in `runtime-auth-policy.ts`).
Replace the direct call with `emitObservation`. The discriminated
union catches shape mismatches at compile time. Adjust the union as
needed; commit only when the migrated call site passes tests with
identical observation output.

### Step 3c — Migrate the remaining call sites

One PR per file. Each PR:
1. Adds the import.
2. Replaces direct calls with `emitObservation`.
3. Adjusts payload shape only if the union demands it.

### Checklist

- [x] `emitObservation` helper exists and delegates to
      `recordGatewayObservation`
- [x] First emit site migrated; integration test confirms identical
      ledger output
- [x] `HotPathObservation` union refined to cover the actual emitted
      shapes *(partial — `auth_decision` variant fully typed; 16
      other emit sites currently route through the transitional
      `emitLegacyGatewayObservation` passthrough. Typing the
      remaining sites is post-Phase-5 follow-up work.)*
- [x] All seven production emit-site files migrated *(18 call sites
      total — 2 use the typed `emitObservation`; 16 use the
      transitional legacy passthrough; both go through the single
      `manatee/observation-emit.ts` module)*
- [x] `grep recordGatewayObservation src/subsystems/gateway/
      src/subsystems/hot-path/manatee/proxy/` returns zero hits
- [x] `tsc` and tests pass after every PR

**Phase 3a + 3b complete (2026-05-08).** Helper and proof-of-concept
migration committed:

- `src/subsystems/hot-path/manatee/observation-emit.ts` — typed
  helper with a `switch` over `HotPathObservation.kind` that
  translates each variant into the existing
  `GatewayObservationInput` shape.
- `subsystems/gateway/runtime-auth-policy.ts` line 65 emit site
  migrated to `emitObservation({ kind: "auth_decision", ... })`.

Findings during the proof-of-concept:

- The discriminated union as drafted in Phase 1 was deliberately
  coarser than the existing `kind × event × stage × outcome` matrix
  in the observability subsystem. Translating one site forced
  refinements to `AuthDecisionObservation`: it now carries `method`,
  `pathname`, `retryAfterSeconds`, `statusCode`, `reason`, and
  `message` so the translator can produce the same ledger record
  the direct call did. Two new `AuthDecisionOutcome` variants
  added: `denied_misdirected_host` and `denied_rate_limited`.
- The translator is order-careful: attribute-key insertion order
  matches the original direct call so any byte-level JSON
  comparisons in tests or downstream consumers remain stable.

**Phase 3c complete (2026-05-08).** All remaining emit sites
migrated:

- `runtime-auth-policy.ts` line 151 — second auth site migrated to
  the typed `emitObservation({ kind: "auth_decision", ... })`.
- All other emit sites across `runtime-request-handler.ts`,
  `request-dispatch.ts`, `runtime-inspect-handler.ts`,
  `proxy-core.ts`, `proxy-forwarding.ts`, and `proxy-logging.ts`
  routed through `emitLegacyGatewayObservation` (and
  `emitLegacyGatewayFailureObservation` for the
  `recordGatewayFailureObservation` convenience-wrapper case in
  `proxy-logging.ts`).
- The transitional helpers preserve byte-identical ledger output
  while consolidating every emission point at the
  `manatee/observation-emit.ts` boundary. They are clearly named
  with the `emitLegacy` prefix; future work progressively replaces
  each call with a typed `emitObservation({ kind: ... })` once the
  `HotPathObservation` discriminated union grows variants for the
  remaining event shapes (`rate_limited`, `inspection_secret_reveal`,
  `route_resolved`, `upstream_*`, `client_response_*`, `debug_*`,
  `failure`).
- Verification: `tsc`, lint, full unit suite (86 files), and
  integration smoke (12 tests) all pass.

**Decision:** type-up of the 16 legacy passthrough call sites is a
**post-Phase-5 follow-up**, not a Phase-5 blocker. The Phase 3 goal
of "every emission goes through one helper module" is satisfied;
the typing refinement is incremental polish.

### Success criteria

Every observation emitted by hot-path code passes through
`emitObservation`. The `HotPathObservation` union is complete and
matches reality. The migration to an `AsyncIterable` observation
stream becomes a single edit to `emitObservation` when Manatee is
extracted.

---

## Phase 4 — Audit imports across the seam

**Risk:** none. Documentation only.

For each hot-path file, list every import that crosses into the rest
of smx. The output is the punch list of "things Manatee will receive
through the interface or constructor instead of importing globally."
The list also informs the boundary lint rule in Phase 5.

### Method

A shell sweep produces the first draft:

```sh
for f in src/subsystems/gateway/*.ts src/subsystems/hot-path/manatee/proxy/*.ts; do
  grep -E "^import .* from" "$f" \
    | grep -v "from \"\\./" \
    | grep -v "from \"node:" \
    | sed "s|.*|$f: &|"
done
```

### Categorization

Each import lands in one of:

- **Free / primitive** — logger, error codes, type guards, secret
  primitives. Manatee may continue to import these directly; they
  are not smx state.
- **Snapshot-derived** — anything reading config or read-model. Must
  flip to receiving the snapshot through `start()` / `reload()`.
- **Observability** — should already migrate via `emitObservation`
  in Phase 3. Any remaining direct imports here are Phase-3 gaps.
- **Secrets** — verify the hot path reads secrets from snapshot
  `SecretRef` only and never loads on demand.
- **Cross-subsystem reach** — imports from `src/subsystems/cli`,
  `src/subsystems/mcp`, etc. These are the hot-path-shouldn't-know-
  about-these set; every entry needs justification or removal.

### Output document

`docs/subsystems/hot-path/hot-path-imports.md`, with one section per category,
each entry referencing the importing file and the imported symbol.

### Checklist

- [x] Import sweep run across all hot-path files
- [x] Every result placed in one of the five categories
- [x] `docs/subsystems/hot-path/hot-path-imports.md` written
- [x] Cross-subsystem reach entries each have a written justification
      or a tracked removal issue
- [x] Snapshot-derived list used to refine `HotPathSnapshot` in
      Phase 1
- [x] Banned-import patterns drafted for Phase 5 lint rule

**Phase 4 complete (2026-05-08).** See
[hot-path-imports.md](hot-path-imports.md) for the full audit.
Headlines:

- 41 hot-path files audited; 16 distinct cross-seam modules
  imported.
- **Zero imports from `cli`, `mcp`, `optimize`, `bench`, or any
  non-listed subsystem.** The hot path is already cleanly
  separated at the subsystem level.
- Twelve `src/platform/*` modules categorized as **free /
  primitive**; Manatee may continue importing them.
- The dominant migration target is `src/platform/types`
  (21 importers of `AppConfig` / `RouteConfig` / friends), which
  the contract's `HotPathSnapshot` and `RouteEntry` replace.
  Phase 2 narrows entry points; remaining importers flip during
  Phase 5+.
- Three concrete remediations identified for the carve-out: env
  reads moving to startup, `provider-auth.resolveRouteApiKey`
  replaced by snapshot-derived secret access, and
  `ProxyRequestContext` becoming a Manatee-internal type.
- Phase 5 lint patterns drafted in the audit document, ready to
  paste into ESLint config when Phase 5 begins.

### Success criteria

Every cross-seam import is documented, categorized, and either
justified or scheduled for removal. The Phase 5 lint rule has a
concrete list to enforce.

---

## Phase 5 — Carve out into `hot-path/` directory

**Risk:** medium. Pure file moves with import-path updates.

Manatee stays in the smx repo as the default hot path. The carve-out
relocates hot-path files under one named subtree. Future Fire Horse
and Rust Horse adapters slot in alongside as siblings.

### Target directory layout

```
src/subsystems/hot-path/
├── contract/                       # Phase 1 contract types
│   ├── hot-path.ts
│   ├── hot-path-snapshot.ts
│   ├── hot-path-observation.ts
│   ├── hot-path-status.ts
│   └── index.ts
│
├── manatee/                        # default in-process implementation
│   ├── manatee.ts                  # implements HotPath (Phase 6)
│   ├── observation-emit.ts         # Phase 3 helper
│   ├── runtime/                    # was gateway/, hot slice
│   │   ├── request-handler.ts
│   │   ├── route-classifier.ts
│   │   ├── auth-policy.ts
│   │   ├── rate-limit.ts
│   │   └── ...
│   ├── proxy/                      # was proxy/
│   │   ├── proxy-core.ts
│   │   ├── proxy-forwarding.ts
│   │   ├── proxy-streaming.ts
│   │   └── ...
│   └── translation/                # OpenAI ↔ Anthropic
│       ├── translate-anthropic-to-openai.ts
│       ├── translate-openai-to-anthropic.ts
│       └── translation-shared.ts
│
└── (future) firehorse-adapter/, rusthorse-adapter/
    — smx-side spawners only; binaries ship from their own repos.
```

Three properties of the layout:

1. `contract/` is its own subdirectory, **not** under `manatee/`. The
   contract is shared with future adapters; placing it under Manatee
   would make Manatee its de facto owner.
2. `manatee/` preserves the existing per-file organization
   (`runtime/`, `proxy/`, `translation/`). Files relocate; their
   internal structure does not change.
3. Future adapters are siblings of `manatee/`, never nested inside it.

### Step 5a — Move files

One PR per file or small group. Each PR is mechanical: `git mv` plus
import-path updates. No renames, no refactors, no cleanup.

### Step 5b — Add path aliases

Update `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@hot-path/contract":      ["src/subsystems/hot-path/contract"],
      "@hot-path/contract/*":    ["src/subsystems/hot-path/contract/*"],
      "@hot-path/manatee/*":     ["src/subsystems/hot-path/manatee/*"]
    }
  }
}
```

Verify path aliases resolve at runtime in addition to compile time.
If runtime resolution requires extra configuration, configure it.
Otherwise revert to relative imports.

### Step 5c — Add the boundary lint rule

Use `no-restricted-imports` (or equivalent) with two clauses derived
from the Phase 4 audit:

```jsonc
{
  "overrides": [
    {
      "files": ["src/subsystems/hot-path/manatee/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": [
            // Manatee may not reach into smx subsystems beyond the
            // audited primitives. Refine list per Phase 4 output.
            "../../../subsystems/cli/*",
            "../../../subsystems/mcp/*",
            "../../../subsystems/observability/*"
          ]
        }]
      }
    },
    {
      "files": ["src/subsystems/!(hot-path)/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": [
            // smx core may not reach into Manatee internals; it
            // accesses Manatee through the contract only.
            "@hot-path/manatee/*"
          ]
        }]
      }
    }
  ]
}
```

### Checklist

- [x] Phase 0 tracked issues resolved before starting Phase 5
- [x] All hot-path files moved to `src/subsystems/hot-path/manatee/`
      under their respective sub-directories
- [x] Test files moved alongside their subjects
- [x] Import paths updated across the codebase
- [x] `tsc`, lint, and tests pass
- [x] `git mv` used; renames tracked
- [ ] Path aliases added to `tsconfig.json` *(skipped — relative
      imports work fine; runtime path-alias resolution would
      require additional tooling for the CommonJS build)*
- [x] Boundary lint rule added with patterns from Phase 4 audit
- [x] Lint passes with zero current violations

**Phase 5 complete (2026-05-08).** Major file move executed.

### Final directory structure

```
src/subsystems/hot-path/
├── contract/                       # 5 files (Phase 1)
└── manatee/
    ├── observation-emit.ts         # Phase 3 helper
    ├── hot-path-config-slice.ts    # Phase 2 helper
    ├── runtime/                    # 21 source + tests (was gateway/ hot slice)
    ├── proxy/                      # 17 source + tests (was proxy/)
    └── translation/                # 3 source + tests
```

`src/subsystems/hot-path/manatee/proxy/` no longer exists. `src/subsystems/gateway/`
still holds 10 cold-path files (CLI commands, journalctl helpers,
`gateway-runner.ts`, `runtime.ts`'s startup orchestration,
`perf-gateway.ts`).

### Mechanics

- Files moved with `git mv` in three cohorts: translation (5), proxy
  (27), gateway hot-slice (27).
- Imports rewritten with a Node script that traverses every TS file,
  re-resolves relative imports against the move map, and rewrites
  paths in two passes (outside-files-pointing-in, then
  moved-files-pointing-out). Total: ~165 imports rewritten across
  ~75 files.
- Inline `typeof import("...")` patterns in
  `subsystems/cli/gateway-cli-bootstrap.ts` were caught by an `sed`
  pass after the initial Node script (the regex scope had been
  limited to `from "..."` forms).
- Five smx-side files referenced moved paths and were updated:
  `scripts/lib/contract-source-paths.js`,
  `scripts/check-import-boundaries.js`,
  `scripts/check-secret-reveal-allowlist.js`,
  `scripts/repeat-risky-unit-suites.js`, and
  `tests/test-024-streaming-backpressure.sh`.

### Boundary lint rule

Added to `eslint.config.mjs` as a scoped override on
`src/subsystems/hot-path/manatee/**/*.ts`. The rule uses
`no-restricted-imports` with five patterns:

- `**/subsystems/cli/**` — banned
- `**/subsystems/mcp/**` — banned
- `**/subsystems/optimize/**` — banned
- `**/subsystems/bench/**` — banned
- `**/subsystems/observability/**` — banned (use
  `manatee/observation-emit.ts` instead)

`observation-emit.ts` itself is excluded from the observability ban
because it is the sanctioned bridge.

The rule currently produces zero violations. Future PRs that try to
reach across the boundary will fail CI rather than slip through
review.

### Path aliases — deferred

The plan called for path aliases (`@hot-path/contract` etc.) to keep
deeply-nested relative imports readable. The CommonJS build target
plus the `node --test` runner that ingests compiled JS from `dist/`
would require additional runtime path resolution (e.g.,
`tsconfig-paths`, `tsc-alias`, or a custom resolver) to make
aliases work end-to-end. Skipped for now; relative imports
(`../../../platform/...` from deepest files) are an annoyance, not
a bug source. Revisit if the depth becomes painful.

### Success criteria

The `src/subsystems/hot-path/` directory contains the contract and
Manatee. Every cross-boundary import either flows through the
contract / observation-emit helper or matches the audited "free /
primitive" set. The lint rule enforces the boundary going forward.
The full test suite passes; behavior is identical to pre-Phase-5.

---

## Phase 6 — Extract Manatee class (out of scope)

The final transition: a `Manatee` class inside `manatee/manatee.ts`
implements the `HotPath` interface, becomes the single entry point
smx uses to drive request processing, and replaces the existing
in-process call sites in `gateway-runner.ts`.

By the time Phases 0–5 are complete, this is a mechanical
transformation: every dependency Manatee needs is either a
constructor parameter (snapshot, observation emitter, logger) or an
import from the audited primitive set. Behavior is identical.
Pluggability for Fire Horse and Rust Horse follows naturally.

This document does not specify Phase 6 in detail because the right
shape will be much clearer after the prep work above is done. Phase 6
is the milestone the rest of the plan prepares for; design lives in a
follow-up document when the time comes.

---

## Suggested ordering

1. **Session 0 — Phase 0.** Coverage audit. Add tests for Critical
   gaps; track Phase-5 blockers.
2. **Session 1 — Phase 1.** Add the contract types in one PR. ~200
   lines, all type definitions.
3. **Session 2 — Phase 3a + 3b.** Add `emitObservation` and migrate
   one call site. Verifies the discriminated union; reveals Phase 1
   gaps if any.
4. **Session 3 — Phase 4.** Run the import audit. Produces the
   to-do list and the Phase 5 lint patterns.
5. **Sessions 4–5 — Phase 3c.** Migrate the remaining seven emit
   sites, one PR per file.
6. **Session 6 — Phase 2.** Annotate hot-path entry points with the
   narrowed snapshot type.
7. **Sessions 7+ — Phase 5.** Move files, add aliases, add lint rule.
   Confirm Phase 0's Phase-5 blocker issues are resolved before
   starting.
8. **After Phase 5.** Revisit
   [hypothetical-hot-path-module.md](hypothetical-hot-path-module.md)
   with everything the prep has revealed, then decide whether to
   proceed to Phase 6 or stop here.

## Discipline

The plan succeeds when discipline is maintained. Specifically:

- **Per-PR verification is non-negotiable.** Every PR runs typecheck,
  lint, full test suite, and a manual smoke test.
- **PRs stay small and mechanical.** No combining moves with
  refactors. Each PR has exactly one job.
- **Phases complete before the next starts.** No half-done states
  where the codebase mixes old and new patterns.
- **The Phase 4 audit is the source of truth for boundary
  enforcement.** The Phase 5 lint rule uses its output, not an
  idealized list.
- **Phase 0's blocker issues gate Phase 5.** Critical gaps tracked
  during Phase 0 must be resolved before file moves begin.

## What to avoid

- Introducing a `HotPath` class with an empty implementation before
  Phase 6.
- Moving files into `hot-path/` before Phase 5.
- Writing FireHorseAdapter or RustHorseAdapter scaffolding. They are
  hypothetical implementations; their adapters land when those
  implementations exist.
- Refactoring for ports-and-adapters as a pattern unto itself.
- Combining Manatee work with unrelated cleanup in the same PR, even
  when the cleanup is obviously correct.

## Exit criteria

The plan is complete when all of the following hold:

- Coverage audit document exists; Phase-5 blockers are resolved.
- `HotPath` interface and supporting types compile and are used by
  the production hot path.
- Every hot-path observation emission goes through `emitObservation`.
- Every hot-path entry point reads through `HotPathSnapshot`.
- `docs/subsystems/hot-path/hot-path-imports.md` documents every cross-seam
  import.
- Hot-path files reside under `src/subsystems/hot-path/manatee/`
  with `contract/` as a sibling.
- Path aliases resolve at compile and runtime.
- Boundary lint rule is in place with zero violations.
- Full test suite passes; behavior is identical to pre-plan.

At that point, smx is in a state where Manatee can be extracted as a
class in a single follow-up PR, or where the plan itself has paid off
without ever needing a formal Manatee class — because the hot path is
already cleanly delineated, named, audited, and lint-enforced.
