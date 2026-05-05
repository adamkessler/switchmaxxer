# Observability IPC Schemas

This directory contains generated schema artifacts for the observability
IPC boundary.

Authoritative TypeScript sources:

- `src/subsystems/observability/observability-ipc-contract.ts`
- `src/subsystems/observability/observability-module.ts`
- `src/subsystems/observability/observability-ipc-validation.ts`
- `src/subsystems/observability/observability-ipc-result-validation.ts`

Generate or check the artifacts with:

```sh
npm run check:observability-ipc-schema
```

Manual edits to `observability-ipc.schema.json` will be overwritten by
`scripts/generate-observability-ipc-schema.js`.

Initial operation-frame schema coverage is intentionally narrow: trace
read, Ledger read, retention prune, benchmark run, benchmark history,
optimization history, and optimization report persistence request and
success-response frames only.

The same artifact also publishes standalone JSON-safe external optimize
mutation command schemas for future apply/restore transport work. Those
commands are not operation-frame schemas and external apply/restore
dispatch remains disabled until the runtime mapping and idempotency
contract are settled.
