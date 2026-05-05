export const BENCH_ROUTE_SELECTION_ISSUES = {
  conflictingSelectors: "conflicting_selectors",
  missingSelector: "missing_selector",
  invalidRouteList: "invalid_route_list",
  tooManyRoutes: "too_many_routes"
} as const;

export type BenchRouteSelectionIssue =
  (typeof BENCH_ROUTE_SELECTION_ISSUES)[keyof typeof BENCH_ROUTE_SELECTION_ISSUES];

export type BenchRouteSelectionInput = {
  routeName?: string;
  routeNames?: string[];
  maxRoutes: number;
};

export type BenchRouteSelectionResult =
  | {
      ok: true;
      routeNames: string[];
    }
  | {
      ok: false;
      issue: BenchRouteSelectionIssue;
    };

export function normalizeBenchRouteSelection(
  input: BenchRouteSelectionInput
): BenchRouteSelectionResult {
  const normalizedRouteName = typeof input.routeName === "string" ? input.routeName.trim() : undefined;
  const hasRouteName = typeof normalizedRouteName === "string" && normalizedRouteName.length > 0;
  const hasRouteList = typeof input.routeNames !== "undefined";

  if (hasRouteName === hasRouteList) {
    return {
      ok: false,
      issue: hasRouteName
        ? BENCH_ROUTE_SELECTION_ISSUES.conflictingSelectors
        : BENCH_ROUTE_SELECTION_ISSUES.missingSelector
    };
  }

  const normalizedRouteNames = hasRouteName
    ? [normalizedRouteName]
    : normalizeRouteNames(input.routeNames);

  if (normalizedRouteNames === null) {
    return {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.invalidRouteList
    };
  }

  if (normalizedRouteNames.length > input.maxRoutes) {
    return {
      ok: false,
      issue: BENCH_ROUTE_SELECTION_ISSUES.tooManyRoutes
    };
  }

  return {
    ok: true,
    routeNames: normalizedRouteNames
  };
}

function normalizeRouteNames(routeNames: string[] | undefined): string[] | null {
  if (!Array.isArray(routeNames) || routeNames.length === 0) {
    return null;
  }

  const normalized = routeNames.map((routeName) => (typeof routeName === "string" ? routeName.trim() : ""));
  if (normalized.some((routeName) => routeName.length === 0)) {
    return null;
  }

  return normalized;
}
