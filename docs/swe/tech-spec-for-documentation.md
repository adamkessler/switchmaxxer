# Switchmaxxer Documentation Organization Tech Spec

This document defines how repository documentation is organized inside `docs/`
and why documentation is treated as a first-class engineering concern in
Switchmaxxer.

The goal is to keep documentation easy to navigate, internally consistent,
clear about ownership boundaries, and worthy of a product built with pride of
craftsmanship.

## Motivation

Switchmaxxer should be built to a high standard.

That standard is not only about code quality. It also applies to the clarity of
the system model, the precision of the control surfaces, and the quality of the
written record that supports engineering and product architecture.

Documentation is therefore not treated as a decorative afterthought. It is part
of how the product is designed, understood, maintained, and extended.

Good documentation in this repository should do at least four jobs:

- explain the system clearly to engineers, operators, and product architecture
- constrain implementation by making intended behavior explicit
- preserve intent across time so refactors do not erode the system model
- make change safer by reducing ambiguity at subsystem and boundary surfaces

This is a craftsmanship issue. A system that aims for excellence should not
force its engineers to recover architecture from scattered code and folklore.
The written model of the system should be deliberate, navigable, and
authoritative.

## Spec-Driven By Default

Switchmaxxer should be spec-driven by default.

In this repository, that means specs are not post-hoc summaries written after
implementation. They are design artifacts that help define:

- system vocabulary
- ownership boundaries
- control-plane contracts
- operator workflows
- agent-facing workflows
- error and response contracts
- safety constraints
- future-facing design direction when a behavior is intentionally not yet live

The point of this approach is not paperwork. The point is coherence.

When specs are clear and current:

- software engineering can implement against an explicit contract
- product architecture can reason about the system in stable terms
- documentation stays aligned with the operator and agent surfaces
- tests can be written against intended behavior rather than accidental behavior

That is why documentation placement and documentation quality both matter.

## Core Rule

Organize documentation by domain ownership first, and by document type second.

That means:

- `docs/swe/` is for Switchmaxxer-owned software-engineering technical specs
- domain-specific integration folders keep their own liaison and boundary
  documentation

## Folder Intent

### `docs/swe/`

This folder holds technical specifications for Switchmaxxer's own internal
software surfaces and architecture.

Examples:

- runtime technical specs
- internal operator-surface technical specs
- other Switchmaxxer-owned engineering specs

These documents describe systems that Switchmaxxer owns directly.

### `docs/ecosystem/openclaw/`

This folder holds documentation for the OpenClaw integration domain.

Even when a document is a technical specification, it stays in
`docs/ecosystem/openclaw/` if its main purpose is to define the liaison boundary between
Switchmaxxer and OpenClaw.

The OpenClaw tech spec is the canonical example:

- [tech-spec-for-switchmaxxer-openclaw-plugin.md](../ecosystem/openclaw/tech-spec-for-switchmaxxer-openclaw-plugin.md)

That document should remain in `docs/ecosystem/openclaw/`, not move into `docs/swe/`,
because it is organized around an external singleton integration domain rather
than a Switchmaxxer-owned internal subsystem.

## Placement Rules

When deciding where a document belongs, use this order:

1. Determine who owns the subject matter.
2. Place the document in the folder for that domain.
3. Only then decide whether it is a tech spec, white paper, reference, or
   operator guide.

Examples:

- a Switchmaxxer runtime spec belongs in `docs/swe/`
- a Switchmaxxer MCP internal spec belongs in `docs/swe/`
- an OpenClaw integration boundary spec belongs in `docs/ecosystem/openclaw/`
- a Hermes integration guide belongs in `docs/ecosystem/hermes/`

## Source-Synchronous Policy

Documentation in this repository should stay purely source-synchronous.

That means:

- documents describe the codebase and operator surface as they exist in source
- documents should use present-tense, source-backed wording
- documents should not frame the repo in terms of legacy behavior, migration
  history, changelog narrative, or "implemented today" language
- examples should use syntax, flags, filenames, and command families that match
  the actual codebase

When a document cannot be grounded in source, it should say so explicitly as a
future-facing design note or constraint document rather than describing that
behavior as if it already exists.

This policy exists to protect trust. Documentation should help readers
understand the real system, not a blurred mixture of aspiration, stale history,
and implementation residue.

## Source-Synchronous Docs Sweep

A **source-synchronous docs sweep** is a deliberate repository-wide pass over
documentation to bring it back into alignment with the current codebase.

It is not a style-only proofreading pass. It is a source-backed consistency
check.

The purpose of a docs sweep is to find and correct things like:

- stale filenames and moved-doc links
- outdated command names, flags, config fields, or endpoint paths
- wording that still reflects superseded terminology
- references to removed behavior or older architecture
- internal inconsistencies between related docs
- statements that no longer match the actual source tree

### When To Do A Docs Sweep

A source-synchronous docs sweep is especially appropriate after:

- command-family refactors
- config-contract changes
- naming or terminology shifts
- major spec rewrites
- moving or renaming documentation files
- a concentrated series of code fixes that changed the real system model

### Expected Method

A source-synchronous docs sweep should:

1. scan the relevant docs set, not just one touched file
2. compare documentation wording against the live source tree
3. fix broken or stale links
4. normalize terminology back to the current canonical terms
5. remove or rewrite statements that no longer describe the current system

The goal is not to rewrite everything. The goal is to restore internal
consistency and trust quickly and deliberately.

### Expected Output

After a successful source-synchronous docs sweep:

- links resolve correctly
- related documents use the same current terminology
- docs reflect the current CLI, MCP, runtime, and config surfaces
- stale historical residue is reduced or removed
- readers can move between docs without hitting contradictory statements

## Documentation Roles

Different documents serve different purposes. The repository should preserve
those distinctions clearly.

- technical specs define intended subsystem behavior, contracts, and boundaries
- operator guides explain how to run and manage real surfaces safely
- references document concrete fields, flags, schemas, and commands
- white papers capture broader product or design reasoning
- ecosystem documents define integration boundaries with external systems

The goal is not maximum document count. The goal is a documentation set where
each document has a clear job and readers can predict where to find the answer
they need.

## Anti-Pattern To Avoid

Do not move an integration-domain tech spec into `docs/swe/` only because it
is a technical specification.

That weakens the domain grouping and makes it harder for readers to find all
material related to a single external system.

## Indexing Expectation

The docs index should expose both kinds of material clearly:

- Switchmaxxer-owned technical specs under `docs/swe/`
- integration-domain specs under their domain folders

It should also preserve document-type legibility so readers can distinguish:

- technical specifications
- operator manuals and launch guides
- reference material
- broader architectural discussion
