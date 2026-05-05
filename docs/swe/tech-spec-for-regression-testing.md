# Switchmaxxer Regression Testing Tech Spec

## Purpose

This document explains how regression testing works in the live repository and
how a software engineer should run regressions for ad hoc verification.

Use it when:

- checking whether a code change needs unit, integration, or both kinds of verification
- choosing the fastest command that still gives meaningful confidence
- running one targeted regression before or after a fix
- understanding why most test commands run against compiled `dist/` output

For adjacent surface specs, also see:

- [tech-spec-for-cli-surface.md](../subsystems/cli/tech-spec-for-cli-surface.md)
- [tech-spec-for-gateway.md](../subsystems/gateway/tech-spec-for-gateway.md)
- [config-reference.md](../subsystems/config/config-reference.md)

## Core Rule

Regression verification should be:

- source-synchronous
- as narrow as practical first
- expanded to broader suites only when the change touches a wider surface

That means the normal engineering flow is:

1. run a focused regression for the exact behavior you changed
2. run the relevant suite for that subsystem if the change crosses a boundary
3. run broader repository suites only when the blast radius justifies it

## Test Layers

Switchmaxxer currently has three practical regression layers.

### 1. Compiled Node test suites

These are the main TypeScript regression suites, compiled to `dist/` and then
run with Node's built-in test runner.

Examples:

- `dist/subsystems/config/config-and-utils.test.js`
- `dist/subsystems/cli/cli.test.js`
- `dist/subsystems/mcp/mcp.test.js`
- `dist/subsystems/proxy/proxy.test.js`
- `dist/subsystems/gateway/runtime-request-path.test.js`
- `dist/subsystems/gateway/runtime-control-plane.test.js`
- `dist/subsystems/gateway/runtime-lifecycle.test.js`
- `dist/subsystems/observability/observability.test.js`

These are the fastest high-signal regressions for most code changes.

### 2. Shell integration suites

These live under `tests/test-*.sh` and are orchestrated by
[scripts/run-integration-tests.js](../../scripts/run-integration-tests.js).

They verify end-to-end CLI, MCP, gateway, and contract behaviors using the real
launcher surfaces.

Examples:

- CLI CRUD flows
- MCP serve contracts
- observability shell flows
- inbound-auth contracts
- backpressure and race-path integration checks

The shell harness is intentionally strict:

- scripts should use `set -euo pipefail`
- JSON contracts should be checked semantically with the shared `jq` helpers in
  [tests/lib/common.sh](../../tests/lib/common.sh), not by raw substring grep
- temp runtime/catalog fixtures should be derived from `config-examples/config.example.json` and
  `config-examples/catalog.example.json`, written as sibling `config.json` and `catalog.json`
  files with `0600` permissions, so tests match the live loader contract
- TCP port selection still has the normal pick-then-bind race, so the harness
  avoids hard-coded ports, uses readiness polling, and keeps retries bounded
- MCP shell-session tests default `MCP_READ_TIMEOUT_SECONDS` to `30` so loaded
  CI runners do not fail too aggressively on slow response framing

### 3. Ad hoc single-test commands

For narrow debugging and fix verification, engineers should often run a single
compiled test file or a single named test using `--test-name-pattern`.

This is the preferred release-cycle workflow for low-risk fixes because it:

- keeps feedback fast
- avoids unrelated suite noise
- makes it obvious which exact contract was verified

## Why Most Unit Regressions Run From `dist/`

The repository's normal test path is:

1. build TypeScript into `dist/`
2. run Node tests from `dist/`

This is intentional.

It verifies:

- the real emitted JavaScript
- import and module-resolution behavior after compilation
- the same runtime shape operators and CI actually execute

The repository keeps source-map support enabled during test execution so stack
traces still point back to the TypeScript sources.

## Test-Only Helpers

Some regression suites use test-only support modules such as
`*.test-support.ts`.

These helpers exist to let source-repo contributors test internal runtime
behavior without turning those seams into supported production APIs.

That distinction matters:

- production/operator validation should go through the real public surfaces:
  CLI commands, gateway requests, MCP requests, and shell integration scripts
- contributor/developer verification may use repo-internal test helpers when a
  unit-style regression needs controlled access to an otherwise private seam

For open-source Switchmaxxer, many operators are also developers. Those users
should still be able to run the full repo test workflow from source. But that
does not mean every test helper should be treated as part of the shipped
runtime surface.

In practice, the intended model is:

- built production artifacts expose the supported operator surfaces
- source-repo test workflows may also use internal test-only helpers
- test-only helpers should be named and located so they are clearly not part of
  the stable runtime API
- non-test modules must not import `*.test-support.ts`; `npm run
  check:boundaries` enforces this so production-adjacent harnesses use neutral
  runtime-control helpers instead of test-only wrappers

Sample expectation for developer-operators:

> `runtime.test-support.ts` is a repo-internal testing seam for contributors
> working from source. It is intentionally not part of the supported production
> runtime surface. If you are operating Switchmaxxer from a built artifact, use
> the public CLI, gateway, and MCP interfaces to validate behavior. If you are
> developing or modifying Switchmaxxer from source, use the repo’s test
> workflow, which includes test-only helpers that are not part of the normal
> operator-facing contract.

When deciding whether a helper should stay in the compiled production tree,
prefer these rules:

- if operators need it to exercise the real product, it should be a documented
  public surface instead of a hidden test seam
- if only contributors need it for internal regression coverage, it should stay
  clearly test-only
- if excluding it from production output would complicate the current
  contributor workflow too much, naming and boundary clarity are still worth
  doing immediately, with output exclusion as a follow-up cleanup

## Standard Commands

### Full unit regression pass

```bash
npm run test:unit
```

What it does:

- runs `npm run build`
- discovers all compiled `*.test.js` files under `dist/`
- executes them with Node's built-in test runner

This is the standard broad engineering regression command.

### Normal full repo regression pass

```bash
npm test
```

What it does:

- runs the unit suite
- then runs the smoke integration suite

Use this when a change touches both code contracts and operator-facing behavior.

### Widest built-in pass

```bash
npm run test:all
```

What it does:

- runs the full unit suite
- then runs the full integration suite set

Use this for wider release verification, not for every small local edit.

## Integration Modes

The shell integration harness supports several modes.

### Smoke integration

```bash
npm run test:integration
```

This runs the curated smoke subset defined in
[scripts/run-integration-tests.js](../../scripts/run-integration-tests.js).

Use it when:

- you changed a user-facing CLI or MCP behavior
- you want fast end-to-end confidence
- you do not need every environment-dependent test

The current smoke subset is the default operator-surface confirmation pass and
should stay green after shell-harness or CLI/MCP contract changes.

### Full integration

```bash
npm run test:integration:all
```

Use this when:

- verifying a larger release candidate
- checking multi-surface behavior changes
- validating shell contracts after control-plane changes

### Self-contained integration

```bash
npm run test:integration:self-contained
```

This excludes the environment-dependent scripts and is useful for local
verification when external credentials or environment-specific flows are not in
scope.

### Environment-dependent integration

```bash
npm run test:integration:env
```

Use this only when the change touches behaviors that depend on the external env
contracts those scripts exercise.

## Recommended Ad Hoc Verification Workflow

### Fastest targeted verification

If you fixed one specific regression, prefer:

```bash
npm run build
node --enable-source-maps --test --test-name-pattern "exact test name here" dist/path/to/suite.test.js
```

Example:

```bash
node --enable-source-maps --test --test-name-pattern "config loaders reject malformed JSON inputs before validation" dist/subsystems/config/config-and-utils.test.js
```

This is the default best-practice command for a narrow fix.

### One full suite for a subsystem

If you changed one subsystem but the change spans several related contracts,
run the whole suite for that subsystem:

```bash
npm run build
node --enable-source-maps --test dist/subsystems/proxy/proxy.test.js
node --enable-source-maps --test dist/subsystems/mcp/mcp.test.js
node --enable-source-maps --test dist/subsystems/cli/cli.test.js
```

Choose the suite that matches the actual blast radius.

### Broad operator-surface confirmation

If the change affects the live CLI, MCP, or gateway path, follow the focused
test with at least the smoke integration suite:

```bash
npm test
```

## Subsystem Guidance

### Config and validation changes

Start with:

```bash
npm run build
node --enable-source-maps --test dist/subsystems/config/config-and-utils.test.js
```

If the change affects CLI config commands too, also run:

```bash
node --enable-source-maps --test dist/subsystems/cli/cli.test.js
```

### Proxy and streaming changes

Start with:

```bash
npm run build
node --enable-source-maps --test dist/subsystems/proxy/proxy.test.js
node --enable-source-maps --test dist/subsystems/config/config-and-utils.test.js
```

`config-and-utils.test.js` matters here because many proxy/runtime regression
contracts live there, including hostile-stream cases.

### Gateway runtime changes

Start with:

```bash
npm run build
node --enable-source-maps --test \
  dist/subsystems/gateway/runtime-request-path.test.js \
  dist/subsystems/gateway/runtime-control-plane.test.js \
  dist/subsystems/gateway/runtime-lifecycle.test.js
```

If the change affects the external operator surface, follow with:

```bash
npm run test:integration
```

### MCP changes

Start with:

```bash
npm run build
node --enable-source-maps --test dist/subsystems/mcp/mcp.test.js
```

If the change affects long-lived stdio behavior or end-to-end serve flows, also
run the relevant shell contracts:

```bash
bash tests/test-015-mcp-serve-contract.sh
bash tests/test-019-mcp-serve-long-lived-session.sh
```

### Observability changes

Start with:

```bash
npm run build
node --enable-source-maps --test dist/subsystems/observability/observability.test.js
```

Then add the runtime-facing observability suites if the change crosses the
gateway or MCP boundary:

```bash
node --enable-source-maps --test dist/subsystems/observability/observability.gateway-runtime.test.js
node --enable-source-maps --test dist/subsystems/observability/observability.mcp-cli.test.js
```

## Named-Test Pattern Guidance

`--test-name-pattern` is the preferred ad hoc tool when:

- you are validating one bug fix
- a large suite has unrelated noise
- you want a precise verification artifact for a review note

Pattern:

```bash
node --enable-source-maps --test --test-name-pattern "exact test title" dist/path/to/file.test.js
```

Best practice:

- use the full exact test name when possible
- run one file only
- avoid broad regexes that accidentally pull in neighboring tests with
  different setup assumptions

## Build Requirement

If you are running any `dist/...test.js` command directly, build first:

```bash
npm run build
```

Do not trust a stale `dist/` tree after changing source.

If you run targeted tests while a build is still in flight, you can get false
results from half-updated compiled output. Treat that as invalid verification
and rerun after the build completes.

## Logs And Failure Triage

The integration harness writes logs under:

- `.switchmaxxer/test-logs/integration/<timestamp>/`

unless `SWITCHMAXXER_TEST_LOG_DIR` overrides the location.

When an integration script fails, the log path printed by
[scripts/run-integration-tests.js](../../scripts/run-integration-tests.js) is
the first place to inspect.

For compiled Node suites:

- source maps are enabled
- stack traces should point back to `src/*.ts`

## What Ad Hoc Verification Should Prove

A regression command is only useful if it proves a real contract.

Good ad hoc verification should answer:

- what exact behavior changed?
- which concrete test proves the new behavior?
- was the change verified at the right layer?

Examples:

- parser fix:
  run one named config regression
- MCP envelope fix:
  run one named MCP regression
- streaming hardening:
  run the exact hostile-stream regression plus the nearby subsystem suite if the
  fix touched shared stream code

## Release-Cycle Guidance

Near release, bias toward:

- lower-risk focused tests first
- exact named regressions for the changed path
- one broader subsystem suite when the fix touches shared code

Avoid using only the widest suite as a substitute for understanding blast
radius. Broad green output is helpful, but exact targeted regressions are what
show a change really closed the intended hole.

## Current Contract Summary

Today the expected engineering regression workflow is:

1. `npm run build`
2. run one or more exact `dist/...test.js` regressions for the changed path
3. run the matching subsystem suite if the fix touched shared code
4. run `npm test` or a relevant integration mode when the operator-facing
   surface changed

That is the repository's best-practice path for ad hoc verification.
