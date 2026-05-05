export { createConfigMutationRuntime } from "./config";
import { createModelMutationRuntime, type ModelMutationView } from "./model";
import { createProviderAuthMutationRuntime } from "./provider-auth";
import { createProviderMutationRuntime } from "./provider";
import { createRouteMutationRuntime } from "./route";

type MutationReadModel<
  TModelView extends { name: string; route_count: number },
  TProviderView extends { name: string },
  TRouteView extends { name: string }
> = {
  modelsByName: Record<string, TModelView>;
  providersByName: Record<string, TProviderView>;
  routesByName: Record<string, TRouteView>;
  routes: Array<{
    name: string;
    service_provider: string;
  }>;
};

export function createEntityMutationRuntimes<
  TModelView extends ModelMutationView,
  TProviderView extends { name: string },
  TRouteView extends { name: string },
  TEntityStateErrorCode extends string
>(deps: {
  loadCliReadModel: (configPath?: string) => MutationReadModel<TModelView, TProviderView, TRouteView>;
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableModels: (document: Record<string, unknown>) => Record<string, unknown>;
  getMutableProviders: (document: Record<string, unknown>) => Record<string, unknown>;
  getMutableRoutes: (document: Record<string, unknown>) => Record<string, unknown>;
  entityStateErrorCodes: {
    modelAlreadyExists: TEntityStateErrorCode;
    modelNotFound: TEntityStateErrorCode;
    modelInUse: TEntityStateErrorCode;
    providerAlreadyExists: TEntityStateErrorCode;
    providerNotFound: TEntityStateErrorCode;
    providerInUse: TEntityStateErrorCode;
    routeAlreadyExists: TEntityStateErrorCode;
    routeNotFound: TEntityStateErrorCode;
    unknownModel: TEntityStateErrorCode;
    unknownServiceProvider: TEntityStateErrorCode;
  };
  createEntityStateError: (code: TEntityStateErrorCode, message: string) => Error;
  createInvalidInputMutationError: (message: string) => Error;
  createInvalidConfigMutationError: (message: string) => Error;
}) {
  const modelMutationRuntime = createModelMutationRuntime({
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableModels: deps.getMutableModels,
    createModelAlreadyExistsError: (modelId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.modelAlreadyExists,
        `Model '${modelId}' already exists`
      ),
    createModelNotFoundError: (modelId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.modelNotFound,
        `Model '${modelId}' was not found`
      ),
    createModelInUseError: (modelId: string, routeCount: number) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.modelInUse,
        `Model '${modelId}' cannot be deleted because ${routeCount} route(s) still reference it`
      ),
    createInvalidInputMutationError: deps.createInvalidInputMutationError,
    createInvalidStoredModelError: (modelId: string) =>
      deps.createInvalidConfigMutationError(`Model '${modelId}' must be stored as an object in config.json.`)
  });

  const providerMutationRuntime = createProviderMutationRuntime<TProviderView>({
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableProviders: deps.getMutableProviders,
    createProviderAlreadyExistsError: (providerId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.providerAlreadyExists,
        `Provider '${providerId}' already exists`
      ),
    createProviderNotFoundError: (providerId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.providerNotFound,
        `Provider '${providerId}' was not found`
      ),
    createProviderInUseError: (providerId: string, routeCount: number) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.providerInUse,
        `Provider '${providerId}' cannot be deleted because ${routeCount} route(s) still reference it`
      ),
    createInvalidInputMutationError: deps.createInvalidInputMutationError,
    createInvalidStoredProviderError: (providerId: string) =>
      deps.createInvalidConfigMutationError(`Provider '${providerId}' must be stored as an object in config.json.`)
  });

  const providerAuthMutationRuntime = createProviderAuthMutationRuntime<TProviderView>({
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableProviders: deps.getMutableProviders,
    createProviderNotFoundError: (providerId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.providerNotFound,
        `Provider '${providerId}' was not found`
      ),
    createInvalidStoredProviderError: (providerId: string) =>
      deps.createInvalidConfigMutationError(`Provider '${providerId}' must be stored as an object in config.json.`)
  });

  const routeMutationRuntime = createRouteMutationRuntime<TRouteView>({
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableRoutes: deps.getMutableRoutes,
    createRouteAlreadyExistsError: (routeId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.routeAlreadyExists,
        `Route '${routeId}' already exists`
      ),
    createRouteNotFoundError: (routeId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.routeNotFound,
        `Route '${routeId}' was not found`
      ),
    createUnknownModelError: (routeId: string, modelId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.unknownModel,
        `Route '${routeId}' references unknown model '${modelId}'`
      ),
    createUnknownServiceProviderError: (routeId: string, providerId: string) =>
      deps.createEntityStateError(
        deps.entityStateErrorCodes.unknownServiceProvider,
        `Route '${routeId}' references unknown service provider '${providerId}'`
      ),
    createInvalidInputMutationError: deps.createInvalidInputMutationError,
    createInvalidStoredRouteError: (routeId: string) =>
      deps.createInvalidConfigMutationError(`Route '${routeId}' must be stored as an object in config.json.`)
  });

  return {
    modelMutationRuntime,
    providerMutationRuntime,
    providerAuthMutationRuntime,
    routeMutationRuntime
  };
}
