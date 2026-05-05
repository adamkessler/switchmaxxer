import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCanonicalFiniteNumber,
  parseCanonicalNonNegativeInteger,
  parseCanonicalPositiveInteger
} from "./number-parsing";

void test("canonical positive integer parsing rejects partial and non-canonical tokens", () => {
  assert.equal(parseCanonicalPositiveInteger("123"), 123);

  for (const value of ["123abc", "1.5", "+1", " 123", "123 ", "01", "0", "9007199254740992"]) {
    assert.equal(parseCanonicalPositiveInteger(value), null, value);
  }
});

void test("canonical non-negative integer parsing accepts zero and rejects partial tokens", () => {
  assert.equal(parseCanonicalNonNegativeInteger("0"), 0);
  assert.equal(parseCanonicalNonNegativeInteger("123"), 123);

  for (const value of ["123abc", "1.5", "+1", " 123", "123 ", "01", "9007199254740992"]) {
    assert.equal(parseCanonicalNonNegativeInteger(value), null, value);
  }
});

void test("canonical finite number parsing rejects partial tokens while preserving decimals", () => {
  assert.equal(parseCanonicalFiniteNumber("0.7"), 0.7);
  assert.equal(parseCanonicalFiniteNumber("-1.25"), -1.25);

  for (const value of ["1abc", " 1", "1 ", "", "Infinity", "NaN", "0x10"]) {
    assert.equal(parseCanonicalFiniteNumber(value), null, value);
  }
});
