const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const CANONICAL_NON_NEGATIVE_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const CANONICAL_FINITE_NUMBER_PATTERN = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$/;

function parseCanonicalInteger(value: string | undefined, pattern: RegExp): number | null {
  if (typeof value !== "string" || !pattern.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseCanonicalPositiveInteger(value: string | undefined): number | null {
  return parseCanonicalInteger(value, CANONICAL_POSITIVE_INTEGER_PATTERN);
}

export function parseCanonicalNonNegativeInteger(value: string | undefined): number | null {
  return parseCanonicalInteger(value, CANONICAL_NON_NEGATIVE_INTEGER_PATTERN);
}

export function parseCanonicalFiniteNumber(value: string | undefined): number | null {
  if (typeof value !== "string" || !CANONICAL_FINITE_NUMBER_PATTERN.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
