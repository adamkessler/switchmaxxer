# Test Isolation And Cleanup Guide

This note captures the minimum discipline expected for side-effect-heavy tests in Switchmaxxer.

## When To Use These Rules

Apply this guide whenever a test touches one or more of these surfaces:

- HTTP servers or sockets
- timers or delayed callbacks
- child processes
- SQLite files or temp directories
- `process.env`
- `globalThis.fetch` or other global runtime shims
- streaming request/response paths

## Core Rules

- Prefer deterministic synchronization over sleep-based timing.
- If a test allocates a resource, the same helper or test block must own its cleanup.
- Use `finally` for cleanup whenever setup can partially succeed.
- Keep timing-sensitive streaming and socket tests non-concurrent unless there is a strong reason not to.
- If a suite mutates globals or runtime-wide state, assume process isolation is the safe default.

## Shared Helpers

For HTTP server and timer lifecycle management, use:

- `src/platform/test-resource-helpers.ts`

That helper centralizes these patterns:

- tracked timeout registration
- forced timer cleanup
- server socket tracking
- forced socket teardown during close
- deterministic ephemeral-port startup

Do not duplicate ad hoc server/timer cleanup logic in new streaming tests unless the shared helper is genuinely insufficient.

## Preferred Test Shapes

For persisted-data drift checks:

- insert a valid row first
- mutate the stored row directly
- assert that the read path fails loudly

For CLI/runtime checks:

- prefer in-process harnesses when the goal is contract validation
- use child processes only when process boundaries are part of the behavior under test

For aggregate-flake debugging:

- suspect leaked async resources and global-state contamination before assuming a product regression
- rerun the suspect compiled test file directly before debugging the entire suite

## CI Backstop

The repo keeps a repeat-run smoke check for the most side-effect-heavy unit suites. If those suites start flaking again, treat that as broken safety equipment, not as harmless CI noise.
