import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GATEWAY_OBSERVATION_BATCH_ITEMS,
  normalizeGatewayObservationBatch
} from "./gateway-writer-bounds";

void test("gateway writer bounds accepts in-range batch payloads without warnings", () => {
  const input = [{ record: { id: "obs-1" } }, { record: { id: "obs-2" } }];
  const normalized = normalizeGatewayObservationBatch(input);

  assert.equal(normalized.accepted.length, 2);
  assert.equal(normalized.dropped, 0);
  assert.deepEqual(normalized.warnings, []);
});

void test("gateway writer bounds truncates oversized batch payloads and reports overflow", () => {
  const input = Array.from({ length: MAX_GATEWAY_OBSERVATION_BATCH_ITEMS + 3 }, (_, index) => ({
    record: { id: `obs-${index}` }
  }));

  const normalized = normalizeGatewayObservationBatch(input);

  assert.equal(normalized.accepted.length, MAX_GATEWAY_OBSERVATION_BATCH_ITEMS);
  assert.equal(normalized.dropped, 3);
  assert.deepEqual(normalized.warnings, [
    `Observability batch exceeded ${MAX_GATEWAY_OBSERVATION_BATCH_ITEMS} items; dropped 3 overflow item(s).`
  ]);
  assert.equal(normalized.accepted[0]?.record.id, "obs-0");
  assert.equal(
    normalized.accepted[MAX_GATEWAY_OBSERVATION_BATCH_ITEMS - 1]?.record.id,
    `obs-${MAX_GATEWAY_OBSERVATION_BATCH_ITEMS - 1}`
  );
});

void test("gateway writer bounds rejects non-array batch payloads before write processing starts", () => {
  assert.throws(
    () => {
      normalizeGatewayObservationBatch({ not: "an array" });
    },
    /Gateway observation writer batch payload must be an array/
  );
});
