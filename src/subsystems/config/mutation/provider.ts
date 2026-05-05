import { setSafeObjectKey, shallowCloneRecordWithSafeKeys } from "../../../platform/object-key-policy";
import { validateMutableProviderEntity } from "./entity-validation";

type MutableProviderRecord = Record<string, unknown>;

export function createProviderMutationRuntime<TProviderView extends { name: string }>(deps: {
  loadCliReadModel: (configPath?: string) => {
    providersByName: Record<string, TProviderView>;
    routes: Array<{
      name: string;
      service_provider: string;
    }>;
  };
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableProviders: (document: Record<string, unknown>) => Record<string, unknown>;
  createProviderAlreadyExistsError: (providerId: string) => Error;
  createProviderNotFoundError: (providerId: string) => Error;
  createProviderInUseError: (providerId: string, routeCount: number) => Error;
  createInvalidInputMutationError: (message: string) => Error;
  createInvalidStoredProviderError: (providerId: string) => Error;
}) {
  function validateProviderConfig(providerId: string, candidate: Record<string, unknown>): Record<string, unknown> {
    try {
      return validateMutableProviderEntity(providerId, candidate);
    } catch (error) {
      throw deps.createInvalidInputMutationError(
        error instanceof Error ? error.message : "provider configuration is invalid"
      );
    }
  }

  function assertValidStoredProvider(providerId: string, candidate: Record<string, unknown>): void {
    try {
      validateMutableProviderEntity(providerId, candidate);
    } catch {
      throw deps.createInvalidStoredProviderError(providerId);
    }
  }

  function createProvider(
    configPath: string | undefined,
    providerId: string,
    requestedProvider: Record<string, unknown>
  ): { provider: TProviderView; normalizedProvider: Record<string, unknown> } {
    const normalizedProvider = validateProviderConfig(
      providerId,
      shallowCloneRecordWithSafeKeys(requestedProvider, "Provider field")
    );

    deps.mutateConfigDocument(configPath, (document) => {
      const providers = deps.getMutableProviders(document);

      if (typeof providers[providerId] !== "undefined") {
        throw deps.createProviderAlreadyExistsError(providerId);
      }

      setSafeObjectKey(providers, providerId, normalizedProvider, "Provider name");
    });

    const provider = deps.loadCliReadModel(configPath).providersByName[providerId];
    if (typeof provider === "undefined") {
      throw deps.createProviderNotFoundError(providerId);
    }

    return { provider, normalizedProvider };
  }

  function updateProvider(
    configPath: string | undefined,
    providerId: string,
    changes: Record<string, unknown>
  ): { provider: TProviderView; normalizedProvider: Record<string, unknown> } {
    let normalizedProvider: Record<string, unknown> | null = null;

    deps.mutateConfigDocument(configPath, (document) => {
      const providers = deps.getMutableProviders(document);
      const existing = providers[providerId];

      if (typeof existing === "undefined") {
        throw deps.createProviderNotFoundError(providerId);
      }

      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        throw deps.createInvalidStoredProviderError(providerId);
      }

      assertValidStoredProvider(providerId, existing as MutableProviderRecord);

      const nextValue: MutableProviderRecord = {
        ...(existing as MutableProviderRecord)
      };

      for (const [key, value] of Object.entries(changes)) {
        setSafeObjectKey(nextValue, key, value, "Provider field");
      }

      normalizedProvider = validateProviderConfig(providerId, nextValue);
      setSafeObjectKey(providers, providerId, normalizedProvider, "Provider name");
    });

    const provider = deps.loadCliReadModel(configPath).providersByName[providerId];
    if (typeof provider === "undefined") {
      throw deps.createProviderNotFoundError(providerId);
    }

    return { provider, normalizedProvider: normalizedProvider ?? {} };
  }

  function deleteProvider(
    configPath: string | undefined,
    providerId: string
  ): { name: string; deleted: true } {
    const readModel = deps.loadCliReadModel(configPath);
    const provider = readModel.providersByName[providerId];

    if (typeof provider === "undefined") {
      throw deps.createProviderNotFoundError(providerId);
    }

    const dependentRoutes = readModel.routes.filter((route) => route.service_provider === providerId);
    if (dependentRoutes.length > 0) {
      throw deps.createProviderInUseError(providerId, dependentRoutes.length);
    }

    deps.mutateConfigDocument(configPath, (document) => {
      delete deps.getMutableProviders(document)[providerId];
    });

    return {
      name: provider.name,
      deleted: true
    };
  }

  return {
    createProvider,
    updateProvider,
    deleteProvider
  };
}
