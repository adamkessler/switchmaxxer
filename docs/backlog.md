# Backlog

Some control-plane features have code scaffolding or stub command surfaces in
the repo but no operator-available execution behavior yet. These surfaces stay
in the backlog until they have real behavior and should remain hidden from
normal help output while still under scaffolding.

## Current Backlog Items

- `optimize` follow-through
  - rollback-on-fail behavior and live policy routing remain deferred
- `config migrate`
  - the command surface is reserved for future schema/version migration work,
    but no migration engine is implemented yet

## Hardening Roadmap Items

- Observability DB fixed data-root allowlist
  - today, `SWITCHMAXXER_OBSERVABILITY_DB` is a trusted local operator override
    with suffix, parent-directory, ownership, mode, and symlink hardening
  - before wider multi-user or service-manager deployment guidance, constrain
    override paths to an approved local data root such as the default
    `.switchmaxxer/` directory or an explicit operator-configured root
  - keep direct arbitrary absolute paths out of the default posture; require a
    deliberate high-trust opt-in for any escape hatch outside the approved root
  - preserve owner-only directory and DB/WAL/SHM permissions after the allowlist
    is added
