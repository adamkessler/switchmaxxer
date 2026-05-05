# Tech Spec For Engineering Guardrails

## Purpose

This document captures solid Switchmaxxer implementation patterns that should
be preserved during future development.

It is not a bug list.

It is a guardrail list for areas where the current code is stronger than many
projects of similar size, and where casual refactors could silently weaken the
system.

Use it when:

- planning refactors
- reviewing architecture changes
- changing trust-boundary code
- deciding whether a "cleanup" is actually safe
- onboarding developers who are new to the domain

## How To Read This

Each section answers four questions:

1. What is strong today?
2. Why does it matter?
3. What usually goes wrong in future rewrites?
4. What should contributors preserve?

The goal is not "never change this code."

The goal is:

- understand why it is shaped this way
- keep the underlying invariant intact
- add regression coverage before changing it

## Guardrails

### SSRF And Provider Endpoint Policy

Current strength:

- provider endpoint validation combines:
  - static hostname classification
  - private/local IP blocking
  - DNS resolution checks
  - pinned-resolution connect behavior
  - rejected-resolution caching

Why it matters:

- this is one of the most security-sensitive outbound trust boundaries in the
  product
- "just validate the URL string" is not enough for SSRF-resistant systems

Common failure mode:

- a future simplification keeps URL validation but removes resolution-time or
  connect-time protections

Preserve:

- static classification plus runtime resolution checks
- pinned DNS behavior at socket connect time
- explicit operator opt-in for private/local endpoints
- regression coverage for loopback, link-local, RFC1918, carrier-grade NAT,
  TEST-NET, IPv4-mapped IPv6, and IPv6 special-use CIDR cases

### Inbound Gateway Authentication

Current strength:

- explicit inbound auth mode selection
- minimum token length
- timing-safe digest comparison
- fail-closed behavior for missing or empty env vars
- loopback-only gate for deliberate unauthenticated mode
- local `Host` validation in unauthenticated mode

Why it matters:

- local-first products often get this boundary wrong by treating localhost as
  automatically safe

Common failure mode:

- "developer convenience" changes weaken the fail-closed posture

Preserve:

- one explicit inbound auth mode
- minimum token length invariant
- timing-safe compare semantics
- loopback-only constraint for unauthenticated operation
- local `Host` validation for unauthenticated requests

### Object-Key Safety And Prototype Pollution Defenses

Current strength:

- object-key blocklist enforcement exists at CLI, MCP, config-load, and
  observability-facing boundaries

Why it matters:

- object-key policy is easy to accidentally bypass during input-normalization
  rewrites

Common failure mode:

- a new surface validates shape but forgets to validate keys

Preserve:

- boundary enforcement, not just deep runtime assumptions
- direct tests at each external input surface

### Secret Handling And Redaction

Current strength:

- `SecretString` resists accidental serialization through `toString`,
  `toJSON`, and inspect behavior
- structured redaction and sanitizer logic exists for error details and
  observability persistence

Why it matters:

- secrets usually leak through "debugging convenience" and metadata paths, not
  obvious primary fields

Common failure mode:

- new logging or persistence fields bypass the shared redaction layer

Preserve:

- central redaction/sanitizer usage at persistence and output boundaries
- secret-hostile wrapper behavior
- regression coverage for nested structured metadata, not just plain strings

### Config File Safety

Current strength:

- config reads reject symlinks
- config permissions are checked
- file size is bounded
- writes use atomic rename
- backup/write posture tightens when inline secrets are present

Why it matters:

- config is a trust boundary, not just a convenience file

Common failure mode:

- a new code path reads config directly and bypasses the hardened helpers

Preserve:

- shared hardened config readers and writers
- symlink rejection
- permission checks
- atomic write semantics

### Header Sanitization

Current strength:

- inbound and forwarded header values are tightly constrained
- header names and values are validated before forwarding
- hop-by-hop and unsafe headers are stripped

Why it matters:

- header surfaces are classic places for CRLF and smuggling mistakes

Common failure mode:

- "transparent proxy" cleanup broadens what can be forwarded

Preserve:

- strict validation before forwarding
- bounded lengths
- reserved-name filtering

### Command Execution Safety

Current strength:

- process spawning uses argument-array forms
- systemd unit names are validated against a tight contract

Why it matters:

- shelling out is a common injection boundary

Common failure mode:

- a future convenience helper reintroduces shell parsing or looser unit-name
  handling

Preserve:

- array-form spawn calls
- explicit unit-name validation
- no shell interpolation for operator-controlled values

### SQLite And Observability Store Discipline

Current strength:

- WAL mode
- foreign keys enabled
- parameterized queries
- bounded retry for busy handling
- migration idempotency
- locked-down file mode
- write-path discipline through the gateway writer flow

Why it matters:

- local persistence quality is easy to degrade with "small" shortcuts

Common failure mode:

- direct ad hoc writes bypass the existing store discipline

Preserve:

- parameterized access
- migration idempotency
- WAL and foreign-key assumptions
- disciplined write-path boundaries

### Test Depth And Realism

Current strength:

- strong end-to-end and integration depth
- real HTTP, real SQLite, real CLI invocation, framing recovery, streaming,
  parity, and race coverage

Why it matters:

- some of the best protections in this codebase are credible because they are
  exercised under realistic conditions

Common failure mode:

- contributors replace realistic tests with only small mocks and lose boundary
  confidence

Preserve:

- realistic integration coverage for trust-boundary and transport-heavy code

### Source Placement And Ownership

Current strength:

- Switchmaxxer source is now organized to mirror the docs mental model:
  - subsystem-owned code lives under `src/subsystems/<subsystem>/...`
  - cross-cutting shared code lives under `src/platform/...`
- this matches the way the docs are already organized under
  `docs/subsystems/<subsystem>/...`

Why it matters:

- new contributors can navigate the architecture more easily when docs and
  source describe the system the same way
- ownership stays clearer when subsystem code does not accumulate in a flat
  root `src/` directory
- cross-cutting primitives are easier to recognize when they live in one
  explicit shared area instead of looking like accidental leftovers at root

Common failure mode:

- new files get added to whatever directory is convenient at the moment
- subsystem-owned code drifts back into top-level `src/`
- cross-cutting helpers get mixed into subsystem folders, making ownership less
  obvious and future splits harder

Preserve:

- use this placement rule by default:
  - if a module is primarily owned by one subsystem, place it under
    `src/subsystems/<subsystem>/`
  - if a module is intentionally shared by multiple subsystems, place it under
    `src/platform/`
  - keep root `src/` limited to true entrypoints and top-level orchestration
- when in doubt, choose the directory based on ownership, not just who imports
  it first
- do not create new top-level library-style modules in `src/` unless they are
  deliberate entrypoints
- if a file moves from one ownership class to another over time, move it
  explicitly rather than letting the old placement silently become misleading
- focused local tests for narrow command/runtime seams
- parity and race coverage where the behavior depends on coordination, not just
  pure logic

## Change Policy

If you touch one of the guarded areas above:

1. identify the invariant first
2. add or update focused regression coverage before broad refactors
3. prefer reusing the existing shared helper or boundary module
4. update the relevant tech spec if the real system behavior changes

Questions contributors should ask before changing these areas:

- am I simplifying code, or removing a load-bearing boundary check?
- does this change preserve the same trust model?
- does this new path go through the same hardened helper as the old one?
- do the tests still prove the real-world behavior, not just a mocked version?

## Practical Rule

When a subsystem looks "stricter than necessary," assume it may be preserving a
real invariant until proven otherwise.

Switchmaxxer has several areas where the current implementation is strong
because it layers protections:

- validate early
- validate again at the real boundary
- log safely
- persist safely
- keep the machine-facing contract stable

Future development should preserve that layered posture rather than flatten it
for convenience.
