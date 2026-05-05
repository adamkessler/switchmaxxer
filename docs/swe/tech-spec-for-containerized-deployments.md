# Tech Spec For Containerized Deployments

## Purpose

This document captures the current Switchmaxxer assumptions and caveats for
containerized deployments.

Use it when:

- evaluating whether a local-first runtime assumption still holds inside a
  container
- reasoning about PID, filesystem, or network behavior under namespaces
- documenting operational differences between workstation-style and
  container-style installs

This is not a full deployment guide. It is a boundary and assumptions document.

## Current Posture

Switchmaxxer is still primarily designed around a local-operator trust model.

That means many current runtime and control-plane behaviors assume:

- the operator controls the local filesystem
- config mutation is a local trusted action
- local loopback and local process state are meaningful coordination surfaces
- CLI and gateway interactions happen within one trusted machine boundary

These assumptions can still be acceptable in containers, but they need to be
read through the lens of namespaces, orchestrators, and shared runtime
environments.

## Container-Relevant Assumptions

### Config Trust

The current system treats local config as trusted operator input.

Examples:

- CLI reload confirmation builds its probe target from local `bind_host` and
  `port` config fields
- config mutation lock files are treated as a local coordination mechanism; the
  metadata parser is size/depth bounded and falls back to filesystem age when
  metadata is malformed

This is acceptable for today's local/container operator model, but it would
need review if config ever became remotely mutable or sync-driven.

### Local Networking

Loopback and bind-host semantics can differ in containers from workstation
usage.

Operators should be explicit about:

- whether the gateway is intended to bind only inside the container
- whether published ports expose the listener beyond the local host
- whether `/health` and other listener surfaces remain appropriately scoped

### PID And Namespace Semantics

Switchmaxxer currently uses `process.kill(pid, 0)` as part of stale lock
recovery for config mutation locks.

Current behavior:

- `ESRCH` is treated as "PID is not live"
- `EPERM` is treated as "PID exists but is not signalable"

This is the normal and correct interpretation on a conventional local machine.

## Stale Lock Caveat In Containers

In some container or PID-namespace configurations, `process.kill(pid, 0)` may
return `EPERM` even when the original lock-owning process no longer exists in
the current effective deployment context.

Operational consequence:

- a stale config mutation lock may be treated as live for longer than necessary
- recovery then falls back to the existing age-based stale-lock timeout rather
  than reclaiming the lock immediately

Current posture:

- acceptable for current local-first and light container use
- not ideal for highly orchestrated or cross-namespace config-mutation flows

The practical effect today is bounded:

- stale locks are still reclaimable by age
- they are not treated as permanently live
- the main cost is temporary config-mutation delay rather than silent
  corruption

## Current Recommendation

For current containerized deployments:

- treat config mutation as a trusted local maintenance action
- expect lock recovery to be conservative rather than aggressive
- prefer one clear config-mutating actor at a time
- avoid assuming PID liveness checks have perfect cross-namespace meaning

If Switchmaxxer ever grows stronger container-native config orchestration, this
area should be revisited with a more namespace-aware lock strategy.

## Future Hardening Direction

If containerized deployment becomes a primary target, likely improvement areas
include:

- container-aware or namespace-aware lock ownership checks
- stronger lock metadata than PID alone
- deployment-mode-specific stale-lock policy
- clearer separation between workstation assumptions and orchestrated runtime
  assumptions
