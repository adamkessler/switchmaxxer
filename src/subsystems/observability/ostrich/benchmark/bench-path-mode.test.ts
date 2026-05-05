import assert from "node:assert/strict";
import test from "node:test";

import { isBenchPathModeValue } from "./bench-path-mode";

void test("isBenchPathModeValue accepts the supported shared bench path modes", () => {
  assert.equal(isBenchPathModeValue("gateway"), true);
  assert.equal(isBenchPathModeValue("direct"), true);
  assert.equal(isBenchPathModeValue("both"), true);
});

void test("isBenchPathModeValue rejects unsupported shared bench path modes", () => {
  assert.equal(isBenchPathModeValue(undefined), false);
  assert.equal(isBenchPathModeValue("invalid"), false);
});
