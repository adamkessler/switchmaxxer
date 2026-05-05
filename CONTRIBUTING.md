# Contributing to Switchmaxxer

Switchmaxxer is a local-first LLM gateway. Contributions that make it clearer, safer, and more reliable are especially valuable.

## Quick Links

- **README:** [README.md](README.md)
- **License:** [LICENSE](LICENSE)
- **Gateway Operations Guide:** [docs/how-to/how-to-operate-the-switchmaxxer-gateway.md](docs/how-to/how-to-operate-the-switchmaxxer-gateway.md)
- **Docs Index:** [docs/docs-index.md](docs/docs-index.md)
- **Product Architecture:** [docs/architecture/product-architecture-spec.md](docs/architecture/product-architecture-spec.md)

## Project Roles

- **Adam Kessler** — Product Architect
  - GitHub: https://github.com/adamkessler/switchmaxxer

## What Helps Most

- bug fixes and focused improvements
- docs changes that make current behavior clearer
- CLI/help consistency work
- tests that cover real operator workflows
- reliability improvements in the gateway request path

For broader features or architectural changes, start with a written proposal in repo docs or explain the shape clearly in your PR description before implementing a large change.

## Contribution Guidelines

- Keep PRs focused. One change or one tightly related set of changes per PR.
- Prefer correctness, clarity, and operator trust over cleverness.
- Do not mix unrelated refactors into a bug fix.
- Do not revert or overwrite work you did not author unless the change is explicitly part of the task.
- Preserve Switchmaxxer's local-first gateway posture: local config, local CLI/MCP control surfaces, and no required hosted control plane.
- Keep defaults conservative: inbound gateway auth enabled, MCP read-only unless explicitly expanded, ordinary output redacted, and local files owner-only where required.
- Treat new CLI flags, config fields, MCP tools, JSON fields, and documented terms as stable public surface area that needs tests and docs.

## Before You Open a PR

- Build the project locally:

```bash
npm install
npm run build
```

- Run the most relevant smoke tests for the area you changed:

```bash
npm run test:unit
npm run test:integration
./tests/test-001-model-create-delete.sh
./tests/test-002-provider-create-delete.sh
./tests/test-003-route-create-delete.sh
./tests/test-006-test-command-path-semantics.sh
```

- Additional integration tiers:
  - `npm run test:integration:self-contained` for the broader non-env shell suite
  - `npm run test:integration:env` for tests that expect a live gateway and usable real config/runtime state

- CI policy for this repo:
  - `fast-checks` covers lint plus `npm test` for quick feedback
  - `self-contained-integration` covers `npm run test:integration:self-contained`
  - for public beta readiness, a green PR should mean both deterministic CI tiers are passing
  - env/live-runtime checks remain separate because they depend on external runtime state

- If your change affects gateway runtime behavior, verify the real runtime path when practical:
  - `switchmaxxer gateway run`
  - `switchmaxxer gateway status --json`
  - `switchmaxxer gateway health --json`
  - `switchmaxxer test --route <route-id>`
  - `switchmaxxer invoke --route <route-id> ...`

- If your change affects docs, make sure the docs still match the code.

## PR Expectations

Please include:

- what changed
- why it changed
- how you tested it
- any limitations or known follow-up work

Strong PRs for this repo usually:

- explain the operator impact
- mention any config or behavior changes
- call out any security or reliability tradeoffs

## Coding Standards

- Use TypeScript and existing project patterns unless there is a strong reason not to.
- Prefer ASCII in source files unless the file already uses non-ASCII intentionally.
- Keep comments short and meaningful.
- Favor explicit, readable behavior over abstraction for its own sake.
- Maintain stable CLI behavior and machine-readable JSON contracts where they already exist.
- If you add a new `APP_ERROR_CODES` entry or other machine-facing error code, add coverage for it in the same change.
- Do not extend [scripts/error-code-coverage-baseline.json](scripts/error-code-coverage-baseline.json) for a new code unless there is an explicit, documented exception and follow-up plan.
- For cross-subsystem imports, prefer the documented public barrel for that subsystem rather than importing an internal `*-core.ts` module directly.

## Test Isolation Standards

- For side-effect-heavy tests, follow [docs/swe/test-isolation-and-cleanup-guide.md](docs/swe/test-isolation-and-cleanup-guide.md).
- In particular, streaming, socket, timer, child-process, temp-db, and global-mocking tests must own cleanup explicitly and should prefer deterministic synchronization over sleep-based timing.

## Docs Standards

- Use `switchmaxxer` as the canonical command name in docs.
- Mention `smx` as the shorthand operator alias.
- Clearly distinguish between:
  - implemented behavior
  - unsupported stub surfaces
  - future roadmap ideas

## AI-Assisted Contributions

AI-assisted PRs are welcome.

If you used AI tools to help with a contribution, please say so in the PR description and briefly note:

- what tool you used
- what parts were AI-assisted
- what you personally verified

The important standard is not whether AI was used. The standard is whether the contributor understands and validated the change.

## Current Priorities

The highest-leverage contributions currently improve one of these areas:

- reliability of the gateway request path
- config safety and operator trust
- CLI clarity and consistency
- documentation accuracy
- test coverage for real operator workflows

## Report a Vulnerability

If you find a security issue, please report it privately to the maintainer rather than opening a public exploit report first.

For now, include:

1. Title
2. Affected area
3. Severity assessment
4. Reproduction steps
5. Real impact
6. Suggested remediation if you have one

Until a dedicated public security contact is published, use the maintainer contact path associated with this repository.
