# Observability Docs

This folder documents Switchmaxxer's observability subsystem: runtime logging,
persisted traces, benchmark and optimize history, the Control Plane Audit
Ledger, store maintenance, and the Ostrich implementation boundary.

Start here when you need to know which document owns which part of the system.

## Reading Paths

For a quick conceptual orientation:

- [current/white-paper-on-observability-layer.md](current/white-paper-on-observability-layer.md)
- [current/switchmaxxer-logging-reference.md](current/switchmaxxer-logging-reference.md)

For the current architecture and implementation boundary:

- [current/tech-spec-for-modular-observability-subsystem.md](current/tech-spec-for-modular-observability-subsystem.md)

For CLI, MCP, and persisted behavior contracts:

- [contracts/tech-spec-for-observation-semantics.md](contracts/tech-spec-for-observation-semantics.md)
- [contracts/tech-spec-for-gateway-observation-mapping.md](contracts/tech-spec-for-gateway-observation-mapping.md)
- [contracts/tech-spec-for-benchmarking.md](contracts/tech-spec-for-benchmarking.md)
- [contracts/tech-spec-for-optimize-command.md](contracts/tech-spec-for-optimize-command.md)
- [contracts/tech-spec-for-control-plane-audit-ledger.md](contracts/tech-spec-for-control-plane-audit-ledger.md)
- [contracts/tech-spec-for-observability-ipc-contract.md](contracts/tech-spec-for-observability-ipc-contract.md)

For store shape, schema, and field-level meaning:

- [store/tech-spec-for-observability-store-schema.md](store/tech-spec-for-observability-store-schema.md)
- [store/tech-spec-for-observability-store-implementation.md](store/tech-spec-for-observability-store-implementation.md)
- [store/field-matrix-for-observability-store.md](store/field-matrix-for-observability-store.md)
- [store/schema-decision-checklist-for-observability-store.md](store/schema-decision-checklist-for-observability-store.md)

For historical planning, audits, and carve-out records:

- [plans-and-audits/observability-phase-5-framing.md](plans-and-audits/observability-phase-5-framing.md)
- [plans-and-audits/observability-phase-4a-direct-access-audit.md](plans-and-audits/observability-phase-4a-direct-access-audit.md)
- [plans-and-audits/observability-coverage-audit.md](plans-and-audits/observability-coverage-audit.md)
- [plans-and-audits/ostrich-implementation-plan.md](plans-and-audits/ostrich-implementation-plan.md)
- [plans-and-audits/hypothetical-observability-modules.md](plans-and-audits/hypothetical-observability-modules.md)
- [plans-and-audits/observability-ipc-schema-generation-plan.md](plans-and-audits/observability-ipc-schema-generation-plan.md)

For manual dogfood and fixture-driven checks:

- [tests/test-plan-for-optimize.md](tests/test-plan-for-optimize.md)
- [tests/fixtures](tests/fixtures)

## Directory Roles

`current/` holds active orientation docs. These should answer "what is the
system now?" without requiring the reader to know the project history.

`contracts/` holds normative behavior specs for observable surfaces and data
contracts. CLI, MCP, IPC, gateway observation, benchmark, optimize, and Ledger
behavior should link here.

`store/` holds schema and persistence detail. These docs should stay close to
the SQLite DDL and repository behavior.

`plans-and-audits/` holds historical design records, coverage audits, and phase
framing. These are useful for context, but they are not the first stop for
current behavior.

`tests/` holds manual test plans and fixture files referenced by observability
docs and tests.
