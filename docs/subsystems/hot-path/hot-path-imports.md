# Hot-Path Import Audit

**Generated:** 2026-05-08
**Scope:** every `import` from a non-relative-sibling location made by
files in the canonical hot-path file list.
**Method:** AST-aware sweep over hot-path files (Phase 4 of the
Manatee Implementation Plan). Multi-line imports collapsed and parsed
as single statements; relative imports that cross subsystem
boundaries (e.g., `proxy/...` importing `../../platform/...`) are
included in the audit.

This audit is the to-do list for the Manatee carve-out and the source
list for the Phase 5 boundary lint rule. The categorization below
informs which imports stay (free/primitive), which migrate through the
contract (snapshot-derived), which migrate through `emitObservation`
(observability), and which need justification or removal
(cross-subsystem reach).

## Files audited

| Subsystem | File count |
|-----------|------------|
| `src/subsystems/gateway/` (hot slice) | 21 |
| `src/subsystems/hot-path/manatee/proxy/` | 19 |
| `src/subsystems/hot-path/manatee/` | 1 |
| **Total** | **41** |

Cold-path files surfaced by the Phase 0 coverage audit
(`runtime-support.ts`, `runtime.ts`'s `runGatewayRun` portion,
`masked-secret.ts`, `log-normalization.ts`) are excluded from this
audit. They are not part of the Manatee carve-out.

## Summary

Cross-seam imports come from sixteen distinct modules. None of the
hot-path files reach into `src/subsystems/cli`, `src/subsystems/mcp`,
`src/subsystems/optimize`, `src/subsystems/bench`, or any other
non-listed subsystem. The only cross-subsystem reaches are into
`subsystems/observability` (expected; Phase 3 migrates these) and
`subsystems/config/provider-auth` (one localized dependency,
discussed below).

The dominant cross-seam dependency is `src/platform/types` (21
importers), used for `AppConfig`, `RouteConfig`, `ProxyRequestContext`,
`ApiMode`, etc. — exactly the surface that `HotPathSnapshot` in the
contract is intended to replace. Phase 2 narrows hot-path entry points
to the contract type; the remaining `AppConfig` importers will
progressively flip during the carve-out.

## Categorization

### 1. Free / primitive (Manatee may continue importing)

These utilities are stateless or carry only declarative data. They
are safe for Manatee to import directly because they neither hold
smx state nor expose other smx subsystems.

| Module | Used for | Importers |
|--------|----------|-----------|
| `src/platform/error-codes` | `APP_ERROR_CODES` constant set | 7 |
| `src/platform/json-bounds` | bounded `JSON.parse` / `JSON.stringify` with limits | 7 |
| `src/platform/type-guards` | `isRecord`, `isObjectLike` | 7 |
| `src/platform/logger` | `logDebug`, `logLine`, `sanitizeLogValue`, `safeErrorMessage`, `redactAbsolutePaths`, `isDebugLoggingEnabled` | 5 |
| `src/platform/request-id` | `assignRequestId`, `getOrAssignRequestId` | 4 |
| `src/platform/number-parsing` | `parseCanonicalNonNegativeInteger` | 4 |
| `src/platform/secret-string` | `SecretString` type, `REDACTED_SECRET` sentinel | 3 |
| `src/platform/net-utils` | `isLoopbackHostname`, `normalizeHostname` | 2 |
| `src/platform/rate-limit-window` | `parseRateLimitWindowMs` | 1 |
| `src/platform/object-key-policy` | `assertNoReservedObjectKeysDeep` | 1 |
| `src/platform/response-envelope` | `CLI_SCHEMA_VERSION` constant | 1 |
| `src/platform/masked-secret` | `maskSemiSensitiveEnvVarName` (single use in `runtime-helpers.ts`) | 1 |

These twelve modules are the hot-path-eligible primitive set. The
Phase 5 lint rule will allow Manatee imports of these without
restriction.

### 2. Snapshot-derived (must flow through the contract)

These imports represent smx config or runtime state and must move to
flowing through `HotPathSnapshot` (or its derived types) once Manatee
is extracted.

| Module | Used for | Importers | Disposition |
|--------|----------|-----------|-------------|
| `src/platform/types` | `AppConfig`, `RouteConfig`, `ApiMode`, `ApiSurface`, `ProxyRequestContext`, `ErrorBody`, `apiModeFromSurface` | 21 | **Phase 2 narrows entry points to `HotPathSnapshot`. Remaining importers flip during Phase 5+ as Manatee is extracted.** |
| `src/platform/env` | `isEnvFlagEnabled`, `getEnvValue` | 2 | **Snapshot-derive at startup; Manatee should not read process env on the request path.** Currently used in `runtime-request-handler.ts` (feature flag) and `local-gateway-auth.ts` (token resolution). |
| `src/subsystems/config/provider-auth` | `ProviderAuthMisconfiguredError`, `resolveRouteApiKey` | 2 | **Resolution moves to snapshot SecretRef materialization.** `proxy-forwarding.ts` imports the error class only; `proxy-headers.ts` imports `resolveRouteApiKey`, which reads `process.env`. Long-term Manatee receives materialized secrets via `SecretRef` and a snapshot-internal materializer. |

#### `src/platform/types` — the dominant migration

Twenty-one of the forty-one hot-path files import `AppConfig`,
`RouteConfig`, `ProxyRequestContext`, or related types. The contract
in [src/subsystems/hot-path/contract/](../../../src/subsystems/hot-path/contract/)
defines `HotPathSnapshot` and `RouteEntry` as drop-in replacements
for the per-request use of `AppConfig` and `RouteConfig`. Phase 2
narrows the entry points; subsequent migration converts internal uses
incrementally.

The `ProxyRequestContext` type (currently a flat record carrying
requestId, caller, bareModel, stream, apiMode, requestStartedAt) is
hot-path-internal state that doesn't belong in the snapshot. It will
either become a contract-level `HotPathRequestContext` type or remain
as a Manatee-internal type once the carve-out moves these files into
`hot-path/manatee/`.

### 3. Observability (Phase 3 migration target)

Imports of `recordGatewayObservation` and friends are migrating to
`emitObservation`. As of 2026-05-08, one of seven hot-path emit sites
(in `runtime-auth-policy.ts`) has been migrated; six remain.

| Module | Used for | Importers | Disposition |
|--------|----------|-----------|-------------|
| `src/subsystems/observability/gateway` | `recordGatewayObservation`, `recordGatewayFailureObservation` | 8 | 7 hot-path emit sites + 1 helper (`hot-path/manatee/observation-emit.ts`). Phase 3c migrates the remaining 6 emit sites. The helper's import is permanent — it bridges the contract to the existing ledger format. |
| `src/subsystems/observability/gateway` | `GatewayObservationInput` type | 1 | Public transitional facade import. Permanent until the ledger format consumes `HotPathObservation` directly. |

#### Phase 3c migration targets (6 remaining)

These hot-path files still import `recordGatewayObservation`
directly:

- `src/subsystems/hot-path/manatee/runtime/runtime-request-handler.ts`
- `src/subsystems/hot-path/manatee/runtime/request-dispatch.ts`
- `src/subsystems/gateway/runtime-auth-policy.ts` (one site migrated;
  one remains at line 153)
- `src/subsystems/gateway/runtime-inspect-handler.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-core.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-forwarding.ts`
- `src/subsystems/hot-path/manatee/proxy/proxy-logging.ts` (also imports
  `recordGatewayFailureObservation`)

Phase 3c migrates these one PR per file. Each migration may force
small refinements to the `HotPathObservation` discriminated union,
following the pattern established in Phase 3b for `auth_decision`.

### 4. Secrets

Hot-path secret-handling imports fall into two camps:

| Module | Importer pattern |
|--------|------------------|
| `src/platform/secret-string` (Free / primitive) | `SecretString` type and `REDACTED_SECRET` sentinel only — type-level and constant-level uses. No on-demand secret loading. |
| `src/subsystems/config/provider-auth` (Snapshot-derived) | `resolveRouteApiKey` reads `process.env[route.apiKeyEnv]` at call time — that *is* on-demand secret loading. The materialized value should come from the snapshot. |

The hot path does **not** reach into a secrets store on the request
path beyond `resolveRouteApiKey`. That single function is the only
on-demand-secret concern, and migrating it is the snapshot-derived
disposition above.

### 5. Cross-subsystem reach

| Module | Importing files | Justification |
|--------|-----------------|---------------|
| `src/subsystems/observability/*` | 7 emit sites + 1 helper | Expected; Phase 3 migrates emit sites through `emitObservation`. |
| `src/subsystems/config/provider-auth` | 2 (proxy-forwarding, proxy-headers) | Localized; resolution moves to snapshot SecretRef materialization. |

**No imports from `cli`, `mcp`, `optimize`, `bench`, or any other
non-listed subsystem.** The hot path is already cleanly separated at
the subsystem level.

## Phase 5 boundary lint rule

The Phase 5 lint configuration is built directly from the categories
above. Patterns to ban for hot-path code (files under
`src/subsystems/hot-path/manatee/`) once the carve-out completes:

```jsonc
{
  "overrides": [
    {
      "files": ["src/subsystems/hot-path/manatee/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": [
            // No reaching into smx subsystems other than observability
            // (which goes through manatee/observation-emit.ts) and
            // provider-auth (deprecated; remove once SecretRef
            // materialization replaces it).
            "**/subsystems/cli/**",
            "**/subsystems/mcp/**",
            "**/subsystems/optimize/**",
            "**/subsystems/bench/**",
            "**/subsystems/config/**",
            // observability/gateway only via the helper file
            {
              "group": ["**/subsystems/observability/**"],
              "importNames": ["recordGatewayObservation",
                              "recordGatewayFailureObservation"],
              "message": "Use emitObservation from manatee/observation-emit.ts instead."
            },
            // platform/types is replaced by hot-path/contract types
            {
              "group": ["**/platform/types"],
              "importNames": ["AppConfig", "RouteConfig"],
              "message": "Use HotPathSnapshot / RouteEntry from hot-path/contract instead."
            }
          ]
        }]
      }
    },
    {
      "files": ["src/subsystems/!(hot-path)/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": [
            // smx core may not reach into Manatee internals; access is
            // through the contract types only.
            "**/hot-path/manatee/**"
          ]
        }]
      }
    }
  ]
}
```

The exact `no-restricted-imports` shape varies by ESLint version and
plugin config; the patterns above are the source-of-truth list for
implementation.

## Findings to act on

1. **`src/platform/env` should not be read on the request path.**
   Two hot-path files (`runtime-request-handler.ts`,
   `local-gateway-auth.ts`) call `isEnvFlagEnabled` and `getEnvValue`
   at request time. These reads should move to startup (snapshot
   construction) so the snapshot carries the resolved values. Tracked
   for Phase 5+.
2. **`provider-auth.resolveRouteApiKey` is the last on-demand secret
   read.** The contract's `SecretRef` already accommodates a
   materialized-value indirection; Phase 5+ replaces the call with
   snapshot-derived secret access. The `ProviderAuthMisconfiguredError`
   class can be elevated to `src/platform/errors` (or similar) and
   become a free/primitive import.
3. **`ProxyRequestContext` placement.** Currently in `platform/types`.
   It is per-request internal state, not a snapshot field, and
   doesn't belong in `HotPathSnapshot`. Decision: it will become a
   Manatee-internal type once the carve-out completes; no new
   contract type is needed.
4. **The hot-path scope is already clean at the subsystem level.**
   Zero imports from `cli`, `mcp`, `optimize`, `bench`. The boundary
   lint rule mostly enforces what already holds.

## Phase 4 conclusion

The hot path's cross-seam dependencies are well-bounded. The
boundary that the Phase 5 lint rule will enforce is mostly a
formalization of the existing layout, with three concrete
remediations identified for the Manatee carve-out: type-narrowing
through `HotPathSnapshot` (Phase 2, in progress), observation
emission migration (Phase 3, in progress), and snapshot-derived
secret resolution (Phase 5+).

Phase 5 can proceed once the remaining Phase 3 emit sites are
migrated and Phase 2 type-narrowing has flipped the dominant
`AppConfig` importers.
