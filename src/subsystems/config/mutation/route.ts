import { setSafeObjectKey, shallowCloneRecordWithSafeKeys } from "../../../platform/object-key-policy";
import { validateMutableRouteEntity } from "./entity-validation";

export type RouteMutationView = {
  name: string;
};

type MutableRouteRecord = Record<string, unknown>;

export function createRouteMutationRuntime<TRouteView extends RouteMutationView>(deps: {
  loadCliReadModel: (configPath?: string) => {
    routesByName: Record<string, TRouteView>;
    modelsByName: Record<string, unknown>;
    providersByName: Record<string, unknown>;
  };
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableRoutes: (document: Record<string, unknown>) => Record<string, unknown>;
  createRouteAlreadyExistsError: (routeId: string) => Error;
  createRouteNotFoundError: (routeId: string) => Error;
  createUnknownModelError: (routeId: string, modelId: string) => Error;
  createUnknownServiceProviderError: (routeId: string, providerId: string) => Error;
  createInvalidInputMutationError: (message: string) => Error;
  createInvalidStoredRouteError: (routeId: string) => Error;
}) {
  function validateRouteConfig(routeId: string, candidate: Record<string, unknown>): Record<string, unknown> {
    try {
      return validateMutableRouteEntity(routeId, candidate);
    } catch (error) {
      throw deps.createInvalidInputMutationError(
        error instanceof Error ? error.message : "route configuration is invalid"
      );
    }
  }

  function assertValidStoredRoute(routeId: string, candidate: Record<string, unknown>): void {
    try {
      validateMutableRouteEntity(routeId, candidate);
    } catch {
      throw deps.createInvalidStoredRouteError(routeId);
    }
  }

  function assertRouteReferencesKnown(
    routeId: string,
    route: Record<string, unknown>,
    readModel: {
      modelsByName: Record<string, unknown>;
      providersByName: Record<string, unknown>;
    }
  ): void {
    const modelId = route["model"] as string;
    if (!readModel.modelsByName[modelId]) {
      throw deps.createUnknownModelError(routeId, modelId);
    }

    const providerId = route["service_provider"] as string;
    if (!readModel.providersByName[providerId]) {
      throw deps.createUnknownServiceProviderError(routeId, providerId);
    }
  }

  function createRoute(
    configPath: string | undefined,
    routeId: string,
    requestedRoute: Record<string, unknown>
  ): { route: TRouteView } {
    const normalizedRoute = validateRouteConfig(
      routeId,
      shallowCloneRecordWithSafeKeys(requestedRoute, "Route field")
    );
    const readModel = deps.loadCliReadModel(configPath);

    if (readModel.routesByName[routeId]) {
      throw deps.createRouteAlreadyExistsError(routeId);
    }

    assertRouteReferencesKnown(routeId, normalizedRoute, readModel);

    deps.mutateConfigDocument(configPath, (document) => {
      setSafeObjectKey(deps.getMutableRoutes(document), routeId, normalizedRoute, "Route name");
    });

    const route = deps.loadCliReadModel(configPath).routesByName[routeId];
    if (typeof route === "undefined") {
      throw deps.createRouteNotFoundError(routeId);
    }

    return { route };
  }

  function updateRoute(
    configPath: string | undefined,
    routeId: string,
    changes: Record<string, unknown>
  ): { route: TRouteView } {
    const readModel = deps.loadCliReadModel(configPath);

    if (!readModel.routesByName[routeId]) {
      throw deps.createRouteNotFoundError(routeId);
    }

    deps.mutateConfigDocument(configPath, (document) => {
      const routes = deps.getMutableRoutes(document);
      const existing = routes[routeId];

      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        throw deps.createInvalidStoredRouteError(routeId);
      }

      assertValidStoredRoute(routeId, existing as MutableRouteRecord);

      const nextRoute: MutableRouteRecord = {
        ...(existing as MutableRouteRecord)
      };

      for (const [key, value] of Object.entries(changes)) {
        if (typeof value === "undefined") {
          continue;
        }

        if ((key === "timeout_ms" || key === "cost") && value === null) {
          delete nextRoute[key];
          continue;
        }

        setSafeObjectKey<unknown>(nextRoute, key, value, "Route field");
      }

      const normalizedRoute = validateRouteConfig(routeId, nextRoute);
      assertRouteReferencesKnown(routeId, normalizedRoute, readModel);
      setSafeObjectKey(routes, routeId, normalizedRoute, "Route name");
    });

    const route = deps.loadCliReadModel(configPath).routesByName[routeId];
    if (typeof route === "undefined") {
      throw deps.createRouteNotFoundError(routeId);
    }

    return { route };
  }

  function deleteRoute(
    configPath: string | undefined,
    routeId: string
  ): { name: string; deleted: true } {
    const route = deps.loadCliReadModel(configPath).routesByName[routeId];

    if (typeof route === "undefined") {
      throw deps.createRouteNotFoundError(routeId);
    }

    deps.mutateConfigDocument(configPath, (document) => {
      delete deps.getMutableRoutes(document)[routeId];
    });

    return {
      name: route.name,
      deleted: true
    };
  }

  return {
    createRoute,
    updateRoute,
    deleteRoute
  };
}
