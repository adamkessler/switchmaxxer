# Switchmaxxer TUI Boundary Tech Spec

This document records the repo-local constraints for any eventual TUI work.

## Current Status

- no TUI exists in the repo
- the operator control plane is the `switchmaxxer` CLI
- gateway runtime inspection flows through commands like:
  - `switchmaxxer gateway status`
  - `switchmaxxer gateway health`
  - `switchmaxxer gateway logs tail`
  - `switchmaxxer test`

## TUI Boundary

- any TUI should wrap existing control-plane services rather than inventing a second control model
- runtime inspection should stay grounded in the same data exposed through:
  - `switchmaxxer gateway status`
  - `switchmaxxer gateway health`
  - `switchmaxxer gateway runtime config`
  - `switchmaxxer gateway logs show|tail`
  - `switchmaxxer trace ...`

## Constraints

- the CLI remains the source of truth for operator semantics
- machine-readable CLI and MCP contracts should stay stable enough for a TUI to consume
- the TUI should inherit the same gateway/service/control-plane vocabulary as the rest of the project

This file exists to record those constraints, not to describe an implemented surface.
