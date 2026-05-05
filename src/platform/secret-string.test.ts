import assert from "node:assert/strict";
import test from "node:test";
import util from "node:util";

import { REDACTED_SECRET, SecretString } from "./secret-string";

void test("SecretString reveals only through explicit reveal and redacts common serialization paths", () => {
  const rawSecret = "top-secret-value";
  const secret = new SecretString(rawSecret);
  const nodeInspectCustom = Symbol.for("nodejs.util.inspect.custom");
  const nodeInspect = (secret as unknown as { [nodeInspectCustom]: () => string })[nodeInspectCustom];
  const utilInspect = (secret as unknown as { [util.inspect.custom]: () => string })[util.inspect.custom];

  assert.equal(secret.reveal(), rawSecret);
  assert.equal(secret.toString(), REDACTED_SECRET);
  assert.equal(String(secret), REDACTED_SECRET);
  assert.equal(`${secret}`, REDACTED_SECRET);
  assert.equal(util.format("%s", secret), REDACTED_SECRET);
  assert.equal(secret.toJSON(), REDACTED_SECRET);
  assert.equal(JSON.stringify(secret), JSON.stringify(REDACTED_SECRET));
  assert.equal(JSON.stringify({ secret }), JSON.stringify({ secret: REDACTED_SECRET }));
  assert.equal(nodeInspect.call(secret), REDACTED_SECRET);
  assert.equal(utilInspect.call(secret), REDACTED_SECRET);
  assert.equal(util.inspect(secret), REDACTED_SECRET);
  assert.doesNotMatch(util.inspect({ secret }), new RegExp(rawSecret));
});
