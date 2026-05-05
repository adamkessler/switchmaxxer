import assert from "node:assert/strict";
import test from "node:test";

import {
  getEnvValue,
  getNonEmptyEnvValue,
  isEnvFlagEnabled,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv,
  resolveNonNegativeIntegerEnv,
  resolvePositiveIntegerEnv
} from "./env";

void test("env helpers centralize string, flag, and integer parsing semantics", () => {
  const env = {
    EMPTY: "",
    SPACES: "  ",
    VALUE: " configured ",
    FLAG_ON: "1",
    FLAG_TRUE: "true",
    POSITIVE: "12",
    ZERO: "0",
    NEGATIVE: "-1",
    INVALID: "abc"
  };

  assert.equal(getEnvValue("VALUE", env), " configured ");
  assert.equal(getEnvValue("MISSING", env), undefined);
  assert.equal(getNonEmptyEnvValue("VALUE", env), " configured ");
  assert.equal(getNonEmptyEnvValue("EMPTY", env), null);
  assert.equal(getNonEmptyEnvValue("SPACES", env), null);

  assert.equal(isEnvFlagEnabled("FLAG_ON", env), true);
  assert.equal(isEnvFlagEnabled("FLAG_TRUE", env), false);
  assert.equal(isEnvFlagEnabled("MISSING", env), false);

  assert.equal(parsePositiveIntegerEnv("POSITIVE", env), 12);
  assert.equal(parsePositiveIntegerEnv("ZERO", env), null);
  assert.equal(parsePositiveIntegerEnv("INVALID", env), null);
  assert.equal(parseNonNegativeIntegerEnv("ZERO", env), 0);
  assert.equal(parseNonNegativeIntegerEnv("NEGATIVE", env), null);

  assert.equal(resolvePositiveIntegerEnv("INVALID", 42, env), 42);
  assert.equal(resolveNonNegativeIntegerEnv("MISSING", 7, env), 7);
});
