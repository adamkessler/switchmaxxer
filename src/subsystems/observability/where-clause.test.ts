import assert from "node:assert/strict";
import test from "node:test";

import { buildRequestExecutionListQuery } from "./request-execution-query";
import { buildWhereClause, whereNonEmptyString } from "./where-clause";

void test("buildWhereClause joins included clauses and preserves bound value order", () => {
  const result = buildWhereClause([
    whereNonEmptyString("request_id = ?", "req-1"),
    null,
    undefined,
    false,
    whereNonEmptyString("(route_id = ? OR route_name = ?)", " route-alpha ", (routeId) => [routeId, routeId]),
    whereNonEmptyString("provider_id = ?", "   "),
    { clause: "status_code >= ?", values: [400] }
  ]);

  assert.deepEqual(result, {
    whereClause: "WHERE request_id = ? AND (route_id = ? OR route_name = ?) AND status_code >= ?",
    values: ["req-1", " route-alpha ", " route-alpha ", 400]
  });
});

void test("buildWhereClause returns an empty query fragment when no filters are present", () => {
  assert.deepEqual(
    buildWhereClause([
      whereNonEmptyString("request_id = ?", undefined),
      whereNonEmptyString("provider_id = ?", "")
    ]),
    {
      whereClause: "",
      values: []
    }
  );
});

void test("buildWhereClause rejects condition/value placeholder drift", () => {
  assert.throws(
    () => buildWhereClause([{ clause: "route_id = ? AND provider_id = ?", values: ["route-alpha"] }]),
    /has 2 placeholder\(s\) but 1 value\(s\)/
  );
});

void test("buildRequestExecutionListQuery keeps route alias filtering and value order shared", () => {
  assert.deepEqual(
    buildRequestExecutionListQuery({
      routeId: "route-alpha",
      providerId: "provider-alpha",
      outcome: "failed"
    }),
    {
      whereClause: "WHERE (route_id = ? OR route_name = ?) AND provider_id = ? AND outcome = ?",
      values: ["route-alpha", "route-alpha", "provider-alpha", "failed"]
    }
  );
});
