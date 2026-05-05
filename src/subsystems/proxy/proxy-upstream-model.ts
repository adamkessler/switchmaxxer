import type { RouteConfig } from "../../platform/types";

export function buildUpstreamModel(route: RouteConfig): string {
  if (route.upstreamModelIdFormat === "creator/model") {
    if (route.model.includes("/")) {
      return route.model;
    }

    return `${route.modelCreator}/${route.model}`;
  }

  return route.model;
}
