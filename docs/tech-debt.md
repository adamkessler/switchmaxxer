# Technical Debt

Known technical-debt items worth tracking across refactors.

## Shared Type-Guard Drift

Some small type-guard helpers have historically drifted across the codebase
instead of living behind one shared definition.

This was true for helpers such as:

- `isNonEmptyString`
- `isPositiveInteger`
- `isRecord`

The first two have now started moving toward a shared utility home, but
`isRecord` remains unresolved technical debt.

### Why `isRecord` Is Not A Blind Consolidation

The current `isRecord` copies are not all semantically identical.

Some call sites want:

- any non-null object-like value

Other call sites want:

- a non-null object that is not an array

Those are not the same contract.

Blindly replacing every local `isRecord` with one shared helper would risk
changing runtime behavior in parsing, proxy, and config-read paths that
currently depend on those distinctions.

### Current Rule

Switchmaxxer should not consolidate `isRecord` until the intended semantic
contract is chosen explicitly.

For now:

- generic shared guards may be centralized when their meaning is genuinely
  uniform
- `isRecord` should only be consolidated intentionally, not mechanically

### Next Steps

The staged cleanup path is:

1. inventory the remaining `isRecord` implementations and classify their
   current semantics
2. decide whether the codebase wants one canonical `isRecord` or two explicit
   helpers such as:
   - object-like including arrays
   - record-like excluding arrays
3. replace local implementations only after the semantic split is explicit
4. add focused tests for the chosen shared helper contract so future cleanup
   does not reintroduce drift
