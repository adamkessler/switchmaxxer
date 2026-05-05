import assert from "node:assert/strict";
import test from "node:test";

import { buildRequestExecutionListConditions } from "./request-execution-query";
import { buildFailingRequestExecutionsWhereClause } from "./request-execution-stats";

void test("buildFailingRequestExecutionsWhereClause appends failing outcomes to structured filters", () => {
  const conditions = buildRequestExecutionListConditions({
    routeId: "route-alpha",
    providerId: "provider-alpha"
  });

  assert.deepEqual(buildFailingRequestExecutionsWhereClause(conditions), {
    whereClause:
      "WHERE (route_id = ? OR route_name = ?) AND provider_id = ? AND outcome IN (?, ?, ?, ?, ?)",
    values: [
      "route-alpha",
      "route-alpha",
      "provider-alpha",
      "failed",
      "cancelled",
      "timed_out",
      "rejected",
      "partial"
    ]
  });
});

void test("buildFailingRequestExecutionsWhereClause works without base filters", () => {
  assert.deepEqual(buildFailingRequestExecutionsWhereClause([]), {
    whereClause: "WHERE outcome IN (?, ?, ?, ?, ?)",
    values: ["failed", "cancelled", "timed_out", "rejected", "partial"]
  });
});
