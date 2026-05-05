import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAllowedObservabilityFilterMessage,
  isAllowedObservabilityFilterValue
} from "./filter-value-validation";

void test("isAllowedObservabilityFilterValue accepts listed values", () => {
  assert.equal(isAllowedObservabilityFilterValue("failed", ["failed", "succeeded"] as const), true);
});

void test("isAllowedObservabilityFilterValue rejects unlisted values", () => {
  assert.equal(isAllowedObservabilityFilterValue("bogus", ["failed", "succeeded"] as const), false);
});

void test("buildAllowedObservabilityFilterMessage renders a stable allowed-values message", () => {
  assert.equal(
    buildAllowedObservabilityFilterMessage("field 'outcome'", ["failed", "succeeded"]),
    "field 'outcome' must be one of: failed, succeeded"
  );
});
