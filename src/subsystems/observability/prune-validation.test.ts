import assert from "node:assert/strict";
import test from "node:test";

import {
  PRUNE_OLDER_THAN_MESSAGE,
  validatePruneOlderThan
} from "./prune-validation";

void test("validatePruneOlderThan accepts valid retention durations", () => {
  assert.equal(validatePruneOlderThan("14d"), null);
});

void test("validatePruneOlderThan rejects invalid retention durations", () => {
  assert.equal(validatePruneOlderThan("tomorrow"), PRUNE_OLDER_THAN_MESSAGE);
});

void test("validatePruneOlderThan allows omitted explicit duration", () => {
  assert.equal(validatePruneOlderThan(undefined), null);
});
