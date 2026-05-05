# Hot-Path Coverage Audit

**Generated:** 2026-05-08
**Test runner:** `node --test` (Node 24 built-in test runner, run from
compiled `dist/` via `scripts/run-unit-tests.js`)
**Coverage tool:** `c8` 11.0.0 with `NODE_V8_COVERAGE` capture
**Coverage scope:** `src/subsystems/gateway/`, `src/subsystems/hot-path/manatee/proxy/`,
plus hot-path-relevant files in `src/platform/`

This audit is the deliverable of Phase 0 of the
[Manatee Implementation Plan](manatee-implementation-plan.md). Its
purpose is to identify gaps in the test safety net that subsequent
phases rely on.

## Summary

- **Total hot-path source files audited:** 59
- **Aggregate line coverage:** 89.98% (9,041 / 10,048)
- **Aggregate branch coverage:** 82.49% (1,786 / 2,165)
- **Aggregate function coverage:** 95.34% (430 / 451)
- **Files below 80% line coverage:** 5
- **Files below 60% branch coverage:** 2

Headline finding: **the hot path is well-covered.** All five files
flagged below 80% line coverage are in fact cold-path code that was
included in the provisional hot-path list but does not run on the
per-request path. The single genuine hot-path coverage gap is the
**error-path branches in `request-body-types.ts`** (88% line / 59%
branch), which validate inbound request bodies and currently lack
tests for malformed-input rejection.

## Reproducing the audit

```sh
npm run build
mkdir -p /tmp/smx-coverage && rm -rf /tmp/smx-coverage/*
NODE_V8_COVERAGE=/tmp/smx-coverage node scripts/run-unit-tests.js
npx c8 report --temp-directory /tmp/smx-coverage \
  --reporter json-summary --reporter text-summary \
  --reports-dir /tmp/smx-coverage-report \
  --include 'dist/subsystems/gateway/**' \
  --include 'dist/subsystems/proxy/**' \
  --include 'dist/platform/**' \
  --exclude '**/*.test.js' --exclude '**/*.test-support.js' \
  --exclude '**/perf-gateway.js'
```

## Per-file coverage table

Sorted by line coverage ascending. Files marked **(cold path)** are
included in the audit per the provisional hot-path list from
[../architecture/tech-spec-for-hot-path.md](../../architecture/tech-spec-for-hot-path.md)
but, on inspection, do not run on the per-request hot path. They will
be excluded from the `manatee/` carve-out in Phase 5.

| File | Line % | Branch % | Function % | Notes |
|------|--------|----------|------------|-------|
| `subsystems/gateway/runtime-support.ts` | 46.78 | 46.66 | 60.00 | **(cold path)** CLI args + journalctl helpers |
| `platform/masked-secret.ts` | 61.11 | 100 | 50.00 | **(cold path)** CLI tooling only |
| `subsystems/gateway/runtime.ts` | 65.36 | 61.53 | 60.00 | **(cold path)** `runGatewayRun` startup orchestration |
| `subsystems/gateway/runtime-rate-limits.ts` | 68.42 | 100 | 66.66 | Edge: `createGatewayRuntimeRateLimiter` factory uncovered |
| `platform/log-normalization.ts` | 77.85 | 64.28 | 100 | **(cold path)** `smx gateway logs` JSON parser |
| `subsystems/gateway/rate-limit.ts` | 80.00 | 66.66 | 100 | |
| `platform/concurrency.ts` | 82.08 | 71.42 | 100 | |
| `subsystems/proxy/translate-openai-to-anthropic.ts` | 84.15 | 76.22 | 100 | |
| `subsystems/proxy/proxy-upstream-model.ts` | 84.61 | 75.00 | 100 | |
| `platform/rate-limit-window.ts` | 85.18 | 70.00 | 100 | |
| `subsystems/proxy/proxy-core.ts` | 86.11 | 84.44 | 83.33 | |
| `subsystems/proxy/proxy-streaming.ts` | 86.90 | 86.95 | 86.48 | |
| `subsystems/proxy/http-transport.ts` | 88.05 | 78.57 | 91.30 | |
| **`subsystems/gateway/request-body-types.ts`** | **88.48** | **59.25** | **88.88** | **Critical: error paths uncovered** |
| `subsystems/proxy/translate-anthropic-to-openai.ts` | 89.18 | 75.00 | 100 | |
| `subsystems/proxy/provider-endpoint-policy.ts` | 90.08 | 82.42 | 100 | |
| `subsystems/gateway/data-plane-handler.ts` | 90.19 | 85.71 | 100 | |
| `subsystems/proxy/proxy-error-classification.ts` | 91.07 | 76.10 | 100 | |
| `subsystems/proxy/proxy-response-buffer.ts` | 91.30 | 87.50 | 100 | |
| `subsystems/proxy/proxy-request-shape.ts` | 91.34 | 77.77 | 100 | |
| `platform/logger.ts` | 92.54 | 80.24 | 100 | |
| `subsystems/gateway/auth-rate-limit.ts` | 92.67 | 89.36 | 100 | |
| `subsystems/proxy/translation-shared.ts` | 92.85 | 75.00 | 100 | |
| `subsystems/gateway/runtime-helpers.ts` | 93.13 | 77.41 | 100 | |
| `subsystems/gateway/local-gateway-auth.ts` | 93.47 | 91.07 | 100 | |
| `platform/secret-string.ts` | 93.54 | 100 | 100 | |
| `subsystems/gateway/invoke-inspection-store.ts` | 94.02 | 92.10 | 100 | |
| `subsystems/gateway/runtime-inspect-handler.ts` | 94.44 | 91.66 | 100 | |
| `subsystems/proxy/proxy-response-handlers.ts` | 94.62 | 82.05 | 100 | |
| `platform/http-json.ts` | 95.74 | 91.66 | 100 | |
| `subsystems/gateway/request-dispatch.ts` | 95.98 | 75.86 | 100 | |
| `subsystems/gateway/invoke-inspection.ts` | 96.39 | 92.06 | 100 | |
| `subsystems/gateway/runtime-request-handler.ts` | 96.85 | 87.23 | 75.00 | |
| `subsystems/proxy/upstream-url.ts` | 96.87 | 94.11 | 100 | |
| `subsystems/gateway/http-runtime-helpers.ts` | 97.03 | 87.87 | 100 | |
| `platform/error-detail-sanitizer.ts` | 97.05 | 83.72 | 100 | |
| `platform/object-key-policy.ts` | 97.18 | 95.23 | 100 | |
| `platform/net-utils.ts` | 97.50 | 94.28 | 100 | |
| `subsystems/proxy/proxy-logging.ts` | 97.65 | 67.27 | 100 | |
| `subsystems/proxy/proxy-forwarding.ts` | 97.68 | 82.14 | 100 | |
| `subsystems/gateway/runtime-route-classifier.ts` | 97.97 | 96.29 | 100 | |
| `subsystems/proxy/proxy-headers.ts` | 98.78 | 94.73 | 100 | |
| `platform/error-codes.ts` | 100 | 100 | 100 | |
| `platform/gateway-bind-policy.ts` | 100 | 100 | 100 | |
| `platform/json-bounds.ts` | 100 | 100 | 100 | |
| `platform/number-parsing.ts` | 100 | 92.30 | 100 | |
| `platform/request-id.ts` | 100 | 100 | 100 | |
| `platform/response-envelope.ts` | 100 | 100 | 100 | |
| `platform/type-guards.ts` | 100 | 100 | 100 | |
| `subsystems/gateway/health-handler.ts` | 100 | 100 | 100 | |
| `subsystems/gateway/runtime-auth-policy.ts` | 100 | 97.43 | 100 | |
| `subsystems/gateway/runtime-config-handler.ts` | 100 | 100 | 100 | |
| `subsystems/gateway/runtime-snapshot.ts` | 100 | 78.57 | 100 | |
| `subsystems/gateway/runtime-state-managers.ts` | 100 | 95.45 | 100 | |
| `subsystems/gateway/window-rotation.ts` | 100 | 100 | 100 | |
| `subsystems/proxy/proxy-anthropic.ts` | 100 | 100 | 100 | |
| `subsystems/proxy/proxy-openai.ts` | 100 | 100 | 100 | |
| `subsystems/proxy/proxy-translation.ts` | 100 | 100 | 80.00 | |
| `subsystems/proxy/proxy.ts` | 100 | 100 | 93.33 | |

## Critical gaps

Critical = security-relevant, correctness-load-bearing, or
data-loss-risking.

### `subsystems/gateway/request-body-types.ts` — error-path branches

**Coverage:** 88.48% line / 59.25% branch.

**Uncovered code:**

- `isStringArray` helper at line 42 — never called, because `stop`
  and `stop_sequences` are not exercised with array values during
  tests.
- The `throw` arms of `assertOptionalString`, `assertOptionalNumber`,
  `assertOptionalBoolean`, `assertOptionalArray`, and
  `assertOptionalObjectOrNull` (lines 47-49, 53-55, 65-67, 74-77).
- The "stop / stop_sequences must be a string[]" rejection branches
  (lines 95-96, 116-117).

**Why this matters:** these branches are the gateway's defense against
malformed inbound request bodies. Untested means a client sending a
wrong-shape body might crash the request handler instead of receiving
a clean 400 error envelope. This is a security/correctness concern;
the hot path needs to fail predictably on bad input.

**Remediation:** add unit tests for `validateGatewayProxyRequestBody`
that cover each rejected shape:

- `model` not a string → throws
- `messages` not an array → throws
- `stream` not a boolean → throws
- `max_tokens` not a number → throws
- `metadata` not an object/null → throws
- `tools` not an array → throws
- `stop` not a string or string[] → throws (OpenAI surface)
- `stop_sequences` not a string[] → throws (Anthropic surface)
- nested-bad-key cases for each of the above

**Effort:** ~1 day. The file already has a test partner (the existing
positive-path tests); the negative-path tests slot in alongside.

**Decision:** add tests **before Phase 5**. Tracked as a Phase-5
blocker.

## Edge gaps

Edge = paths triggered only under specific conditions; non-load-bearing
under normal traffic but worth checking.

### `subsystems/gateway/runtime-rate-limits.ts` — factory function

**Coverage:** 68.42% line. The function `createGatewayRuntimeRateLimiter`
(lines 27-38) is uncovered.

**Why uncovered:** the factory is only invoked when no `activeRuntime`
is pre-built. Production always pre-builds via `gateway-runner.ts`;
unit tests invoke the request handler directly with a mocked
snapshot.

**Risk:** low. The factory is a 12-line wrapper that calls
`parseRateLimitWindowMs` (covered in
`platform/rate-limit-window.ts.test`) and `createGlobalRateLimiter`
(covered via `rate-limit.ts` tests). The uncovered code is essentially
"call A, throw on null, call B."

**Remediation:** add a one-test sanity check that constructs a runtime
rate limiter from a representative `AppConfig` and confirms the
returned limiter passes/denies as expected.

**Effort:** ~1 hour.

**Decision:** add a quick test as part of Phase 0 housekeeping. Not a
Phase-5 blocker; risk is low enough to accept if effort overruns.

### `subsystems/gateway/runtime-snapshot.ts` — branch coverage at 78.57%

**Coverage:** 100% line / 78.57% branch / 100% function.

**Why uncovered:** the snapshot reload path has conditional branches
for fields that don't change between reloads; tests that exercise
reloads change different subsets of fields than the uncovered branches
expect.

**Risk:** low. All functions and lines are covered; the missed
branches are conditional pass-through behavior on stable fields.

**Decision:** **risk consciously accepted.** Snapshot reload is also
covered by integration tests in
`runtime-lifecycle.test.ts` and `runtime-control-plane.test.ts`
which exercise full reload sequences. Branch-level coverage is
nice-to-have, not load-bearing.

### Several proxy files at 75–86% branch coverage

`translate-openai-to-anthropic.ts` (76%), `proxy-error-classification.ts`
(76%), `proxy-streaming.ts` (87%), `proxy-core.ts` (84%), `proxy-logging.ts`
(67%) — all sit in the 70–87% branch range with 100% function
coverage.

**Why uncovered:** typically dialect-edge cases — unusual OpenAI
response shapes, rare upstream error classifications, defensive
fall-throughs on streaming-event parsing.

**Risk:** medium-low. These are real hot-path branches but most cover
defensive cases that should not fire under correct upstream behavior.

**Decision:** **risk consciously accepted for Phase 5.** Track as a
follow-up improvement after Phase 5 completes — adding fixture-based
tests for unusual upstream responses is a meaningful test investment
but unrelated to the carve-out.

### `subsystems/proxy/proxy-logging.ts` branch coverage at 67.27%

**Coverage:** 97.65% line / 67.27% branch / 100% function.

**Why uncovered:** the logging path has many short-circuit conditions
(`if (sourceIp)`, `if (level >= debug)`, etc.) whose negative arms
aren't exercised under typical test fixtures.

**Risk:** low. These branches gate log-line *content*; if they
misfire, logs are slightly wrong, but no request behavior changes.

**Decision:** **risk consciously accepted.** Cosmetic from the
hot-path correctness perspective.

## Cosmetic gaps and non-applicable findings

### Cold-path code on the hot-path list

These files appear in the audit because they live in the gateway
subsystem directory but, on inspection, do not run on the per-request
path. They will be excluded from `manatee/` in Phase 5; their
coverage is irrelevant to the Manatee plan.

| File | Why cold-path |
|------|---------------|
| `subsystems/gateway/runtime-support.ts` | Implements `parseGatewayRunArgs`, `parseGatewayLogsArgs`, and the journalctl filter helpers. Used by `smx gateway run` and `smx gateway logs` CLI commands. |
| `subsystems/gateway/runtime.ts` | Most of the file is `runGatewayRun` (the gateway startup orchestrator) and `resolveInboundGatewayAuthState` / `fetchGatewayRuntimeConfigPayload` (used during startup and reload). The hot-path-relevant exports — `beginGatewayGracefulShutdown` — are covered (100%). |
| `platform/masked-secret.ts` | `maskSecretValue` is used only by CLI bootstraps for `smx providers` / `smx gateway status` views. Never called on the per-request path. |
| `platform/log-normalization.ts` | Parses journalctl JSON output for `smx gateway logs`. Never called on the per-request path. |

**Phase 4 implication:** these files must be categorized as cold-path
in the import audit and **must not** be moved into
`src/subsystems/hot-path/manatee/` in Phase 5. They stay where they
are or move into a clearly cold-path location.

### File present in hot-path list but absent from coverage data

`platform/secret-redaction.ts` — does not exist as a separate file.
The redaction logic is inside `platform/secret-string.ts` (which has
93.5% line / 100% branch coverage). The hot-path file list should be
corrected.

## Decisions

### Tests to add before Phase 5 (blocker)

- [x] `subsystems/gateway/request-body-types.ts` — negative-path tests
      for every type-assertion error branch in
      `validateGatewayProxyRequestBody` (both OpenAI and Anthropic
      surfaces). **Resolved 2026-05-08** by adding
      [src/subsystems/hot-path/manatee/runtime/request-body-types.test.ts](../../../src/subsystems/hot-path/manatee/runtime/request-body-types.test.ts)
      with 34 tests covering positive paths, every negative-path
      branch, and reserved-key rejection. Coverage on the source
      file is now **100% line / 100% branch / 100% function**.

### Tests to add as Phase-0 housekeeping (nice-to-have)

- [ ] `subsystems/gateway/runtime-rate-limits.ts` — sanity test for
      `createGatewayRuntimeRateLimiter`. Quick win; not blocking.

### Risks consciously accepted

- `subsystems/gateway/runtime-snapshot.ts` 78.57% branch — covered by
  integration tests; snapshot reload paths are exercised at higher
  level.
- Proxy file branch coverage in the 67–86% range — defensive arms for
  unusual upstream behavior; track as post-Phase-5 improvement, not a
  blocker.
- `proxy-logging.ts` 67% branch — log content cosmetics, not request
  correctness.

### Cold-path files mistakenly in the audit scope

The following files will be excluded from the Phase 5 carve-out into
`manatee/`. Their low coverage is irrelevant to the Manatee plan:

- `subsystems/gateway/runtime-support.ts`
- `platform/masked-secret.ts`
- `platform/log-normalization.ts`
- The `runGatewayRun` / `resolveInboundGatewayAuthState` /
  `fetchGatewayRuntimeConfigPayload` portion of
  `subsystems/gateway/runtime.ts` (the rest of that file —
  `beginGatewayGracefulShutdown` — *is* hot-path-relevant and is
  fully covered).

The hot-path file list at the top of the audit needs to be amended in
the Phase 4 import audit. The `tech-spec-for-hot-path.md` document
already correctly excludes `runtime-support.ts` and `masked-secret.ts`
from its hot-path list; the discrepancy is in the broader provisional
list this audit used.

## Phase-5 blocker list

Resolution of the following gates Phase 5:

1. ~~Add negative-path tests for `request-body-types.ts`~~
   **Resolved 2026-05-08.** Coverage now 100/100/100.

**No outstanding blockers.** All other gaps are either accepted
risks, cold-path code (out of scope), or post-Phase-5 follow-ups.
Phase 5 may proceed.

## Conclusion

The hot path is in good shape from a test-coverage perspective. The
single critical gap is well-understood, low-effort to plug, and
narrowly scoped. The cold-path mis-classifications are useful findings
in their own right — they will narrow the Phase 4 import audit and
make the Phase 5 carve-out cleaner.

The team can proceed with Phase 1 immediately. Phase 5 is gated only
on adding the request-body-types negative-path tests, which is a
~1-day task.
