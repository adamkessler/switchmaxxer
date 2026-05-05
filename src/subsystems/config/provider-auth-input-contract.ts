export type ProviderSetKeyInput = {
  provider_id: string;
  api_key: string;
};

export type ProviderClearKeyInput = {
  provider_id: string;
};

export type ProviderSetKeyEnvInput = {
  provider_id: string;
  api_key_env: string;
};

export function createProviderAuthInputContract(deps: {
  isNonEmptyString: (value: unknown) => value is string;
  assertSafeIdentifier: (value: string, label: string) => void;
  invalidInputField: (message: string) => never;
  missingRequiredField: (message: string) => never;
  rejectMaskedSecretSentinel?: (value: string, field: string) => void;
}) {
  function readRequiredString(value: unknown, missingMessage: string, invalidMessage: string): string {
    if (typeof value === "undefined") {
      deps.missingRequiredField(missingMessage);
    }

    if (!deps.isNonEmptyString(value)) {
      deps.invalidInputField(invalidMessage);
    }

    return value;
  }

  function validateProviderClearKeyInput(options: {
    providerId: unknown;
    missingProviderIdMessage: string;
    invalidProviderIdMessage: string;
    identifierLabel: string;
  }): ProviderClearKeyInput {
    const providerId = readRequiredString(
      options.providerId,
      options.missingProviderIdMessage,
      options.invalidProviderIdMessage
    );
    deps.assertSafeIdentifier(providerId, options.identifierLabel);
    return { provider_id: providerId };
  }

  function validateProviderSetKeyInput(options: {
    providerId: unknown;
    apiKey: unknown;
    missingProviderIdMessage: string;
    invalidProviderIdMessage: string;
    missingApiKeyMessage: string;
    invalidApiKeyMessage: string;
    identifierLabel: string;
    apiKeyFieldLabel: string;
  }): ProviderSetKeyInput {
    const base = validateProviderClearKeyInput({
      providerId: options.providerId,
      missingProviderIdMessage: options.missingProviderIdMessage,
      invalidProviderIdMessage: options.invalidProviderIdMessage,
      identifierLabel: options.identifierLabel
    });
    const apiKey = readRequiredString(options.apiKey, options.missingApiKeyMessage, options.invalidApiKeyMessage);
    deps.rejectMaskedSecretSentinel?.(apiKey, options.apiKeyFieldLabel);

    return {
      provider_id: base.provider_id,
      api_key: apiKey
    };
  }

  function validateProviderSetKeyEnvInput(options: {
    providerId: unknown;
    apiKeyEnv: unknown;
    missingProviderIdMessage: string;
    invalidProviderIdMessage: string;
    missingApiKeyEnvMessage: string;
    invalidApiKeyEnvMessage: string;
    identifierLabel: string;
  }): ProviderSetKeyEnvInput {
    const base = validateProviderClearKeyInput({
      providerId: options.providerId,
      missingProviderIdMessage: options.missingProviderIdMessage,
      invalidProviderIdMessage: options.invalidProviderIdMessage,
      identifierLabel: options.identifierLabel
    });
    const apiKeyEnv = readRequiredString(
      options.apiKeyEnv,
      options.missingApiKeyEnvMessage,
      options.invalidApiKeyEnvMessage
    );

    return {
      provider_id: base.provider_id,
      api_key_env: apiKeyEnv
    };
  }

  return {
    validateProviderSetKeyInput,
    validateProviderClearKeyInput,
    validateProviderSetKeyEnvInput
  };
}
