import { setSafeObjectKey } from "../../../platform/object-key-policy";
import { isRecord } from "../../../platform/type-guards";

export function createProviderAuthMutationRuntime<TProviderView extends { name: string }>(deps: {
  loadCliReadModel: (configPath?: string) => {
    providersByName: Record<string, TProviderView>;
  };
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableProviders: (document: Record<string, unknown>) => Record<string, unknown>;
  createProviderNotFoundError: (providerId: string) => Error;
  createInvalidStoredProviderError: (providerId: string) => Error;
}) {
  function updateProviderAuthField(
    configPath: string | undefined,
    providerId: string,
    updates: Record<string, unknown>
  ): { provider: TProviderView } {
    deps.mutateConfigDocument(configPath, (document) => {
      const providers = deps.getMutableProviders(document);
      const existing = providers[providerId];

      if (typeof existing === "undefined") {
        throw deps.createProviderNotFoundError(providerId);
      }

      if (!isRecord(existing)) {
        throw deps.createInvalidStoredProviderError(providerId);
      }

      const nextValue: Record<string, unknown> = {
        ...existing
      };

      for (const [key, value] of Object.entries(updates)) {
        setSafeObjectKey(nextValue, key, value, "Provider field");
      }

      setSafeObjectKey(providers, providerId, nextValue, "Provider name");
    });

    const provider = deps.loadCliReadModel(configPath).providersByName[providerId];
    if (typeof provider === "undefined") {
      throw deps.createProviderNotFoundError(providerId);
    }

    return { provider };
  }

  function setProviderInlineApiKey(
    configPath: string | undefined,
    providerId: string,
    apiKey: string
  ): { provider: TProviderView } {
    return updateProviderAuthField(configPath, providerId, { api_key: apiKey });
  }

  function clearProviderInlineApiKey(
    configPath: string | undefined,
    providerId: string
  ): { provider: TProviderView } {
    return updateProviderAuthField(configPath, providerId, { api_key: null });
  }

  function setProviderApiKeyEnv(
    configPath: string | undefined,
    providerId: string,
    apiKeyEnv: string
  ): { provider: TProviderView } {
    return updateProviderAuthField(configPath, providerId, { api_key_env: apiKeyEnv });
  }

  return {
    setProviderInlineApiKey,
    clearProviderInlineApiKey,
    setProviderApiKeyEnv
  };
}
