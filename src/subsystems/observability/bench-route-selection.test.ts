import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCH_ROUTE_SELECTION_ISSUES,
  normalizeBenchRouteSelection
} from "./bench-route-selection";

void test("normalizeBenchRouteSelection trims and accepts one explicit route", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      routeName: " route-alpha ",
      maxRoutes: 4
    }),
    {
      ok: true,
      routeNames: ["route-alpha"]
    }
  );
});

void test("normalizeBenchRouteSelection trims and accepts an explicit route list", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      routeNames: [" route-alpha ", "route-beta"],
      maxRoutes: 4
    }),
    {
      ok: true,
      routeNames: ["route-alpha", "route-beta"]
    }
  );
});

void test("normalizeBenchRouteSelection rejects conflicting selectors", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      routeName: "route-alpha",
      routeNames: ["route-beta"],
      maxRoutes: 4
    }),
    {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.conflictingSelectors
    }
  );
});

void test("normalizeBenchRouteSelection rejects missing selectors", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      maxRoutes: 4
    }),
    {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.missingSelector
    }
  );
});

void test("normalizeBenchRouteSelection rejects empty route lists after trimming", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      routeNames: [" route-alpha ", "   "],
      maxRoutes: 4
    }),
    {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.invalidRouteList
    }
  );
});

void test("normalizeBenchRouteSelection rejects route lists above the shared cap", () => {
  assert.deepEqual(
    normalizeBenchRouteSelection({
      routeNames: ["route-a", "route-b", "route-c"],
      maxRoutes: 2
    }),
    {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.tooManyRoutes
    }
  );
});
