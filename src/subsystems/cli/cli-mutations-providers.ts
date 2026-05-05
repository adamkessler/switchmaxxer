import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildSuccessEnvelope, CLI_SCHEMA_VERSION } from "../../platform/response-envelope";
import { isRecord } from "../../platform/type-guards";
import type { CliMutationShared } from "./cli-mutations-shared";

export function createCliProviderMutations(shared: CliMutationShared) {
  const {
    deps,
    assertSafeCliConfigIdentifier,
    providerAuthInputContract,
    providerMutationRuntime,
    providerAuthMutationRuntime,
    toProviderAuthView,
    renderProviderKeySummary,
    renderProviderSummary,
    createCliMutationAudit,
    withCliMutationAudit,
    classifyUsageOrMutationFailure,
    classifyMutationMessageFailure
  } = shared;

  const runProvidersCreate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseProvidersCreateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_create",
      targetKind: "provider",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers create",
        failurePrefix: "Providers create",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.providersCreateError)
      },
      () => {
        const providerInput = deps.normalizeProviderCreateInput(parsedArgs);
        const { provider } = providerMutationRuntime.createProvider(configPath, providerInput.name, {
          endpoint: providerInput.endpoint,
          ...(typeof providerInput.allow_private_endpoints === "undefined"
            ? {}
            : { allow_private_endpoints: providerInput.allow_private_endpoints }),
          ...(typeof providerInput.allow_insecure_http === "undefined"
            ? {}
            : { allow_insecure_http: providerInput.allow_insecure_http }),
          api_mode: providerInput.api_mode,
          ...(typeof providerInput.anthropic_version === "undefined"
            ? {}
            : { anthropic_version: providerInput.anthropic_version }),
          ...(typeof providerInput.model_id_format === "undefined"
            ? {}
            : { model_id_format: providerInput.model_id_format }),
          ...(typeof providerInput.api_key === "undefined" ? {} : { api_key: providerInput.api_key }),
          ...(typeof providerInput.api_key_env === "undefined" ? {} : { api_key_env: providerInput.api_key_env })
        });
        const providerView = toProviderAuthView(provider);
        audit?.succeed({ provider_id: provider.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("providers create", providerView));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderProviderSummary("Provider created", providerView));
        return 0;
      }
    );
  };

  const runProvidersUpdate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseProvidersUpdateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_update",
      targetKind: "provider",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers update",
        failurePrefix: "Providers update",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.providersUpdateError)
      },
      () => {
        const parsedArgsRecord: Record<string, unknown> = isRecord(parsedArgs) ? parsedArgs : {};
        const providerInput = deps.normalizeProviderUpdateInput({
          ...parsedArgs,
          apiKeyStdin: Boolean(parsedArgsRecord["apiKeyStdin"]),
          noAuth: Boolean(parsedArgsRecord["noAuth"]),
          allowPrivateEndpoints: Boolean(parsedArgsRecord["allowPrivateEndpoints"]),
          allowInsecureHttp: Boolean(parsedArgsRecord["allowInsecureHttp"])
        });
        const { provider } = providerMutationRuntime.updateProvider(configPath, providerInput.name, {
          ...(typeof providerInput.endpoint !== "undefined" ? { endpoint: providerInput.endpoint } : {}),
          ...(typeof providerInput.allow_private_endpoints !== "undefined"
            ? { allow_private_endpoints: providerInput.allow_private_endpoints }
            : {}),
          ...(typeof providerInput.allow_insecure_http !== "undefined"
            ? { allow_insecure_http: providerInput.allow_insecure_http }
            : {}),
          ...(typeof providerInput.api_mode !== "undefined" ? { api_mode: providerInput.api_mode } : {}),
          ...(typeof providerInput.api_key_env !== "undefined" ? { api_key_env: providerInput.api_key_env } : {}),
          ...(typeof providerInput.anthropic_version !== "undefined"
            ? { anthropic_version: providerInput.anthropic_version }
            : {}),
          ...(typeof providerInput.model_id_format !== "undefined"
            ? { model_id_format: providerInput.model_id_format }
            : {})
        });
        const providerView = toProviderAuthView(provider);
        audit?.succeed({ provider_id: provider.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("providers update", providerView));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderProviderSummary("Provider updated", providerView));
        return 0;
      }
    );
  };

  const runProvidersDelete = async (providerName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseConfigCommandArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_delete",
      targetKind: "provider",
      targetId: providerName,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers delete",
        failurePrefix: "Providers delete",
        classify: (error) =>
          classifyMutationMessageFailure(error, APP_ERROR_CODES.providersDeleteError, "Unknown providers delete error")
      },
      () => {
        assertSafeCliConfigIdentifier(providerName, "Provider name");
        const deleted = providerMutationRuntime.deleteProvider(configPath, providerName);
        audit?.succeed({ provider_id: deleted.name, deleted: true });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("providers delete", deleted));
          return 0;
        }
        deps.cliOutputDeps.writeStdout([`Provider deleted: ${deleted.name}`, "Deleted: true"].join("\n"));
        return 0;
      }
    );
  };

  const runProvidersSetKey = async (providerName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseProviderSetKeyArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_set_key",
      targetKind: "provider",
      targetId: providerName,
      configPath
    });
    let apiKey = "";
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers set-key",
        failurePrefix: "Providers set-key",
        printUsageOnExit2: true,
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.providersSetKeyError)
      },
      () => {
        try {
          apiKey = deps.readCliStdinSync({ trimTrailingNewlines: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown stdin error";
          audit?.fail({ code: APP_ERROR_CODES.stdinReadError, message });
          if (json) {
            deps.cliOutputDeps.writeJson({
              ok: false,
              command: "providers set-key",
              schema_version: CLI_SCHEMA_VERSION,
              error: { code: APP_ERROR_CODES.stdinReadError, message }
            });
            return 1;
          }
          deps.cliOutputDeps.writeStderr(`Providers set-key failed: ${message}`);
          return 1;
        }
        const normalized = providerAuthInputContract.validateProviderSetKeyInput({
          providerId: providerName,
          apiKey,
          missingProviderIdMessage: "Missing required argument '<provider-id>' for 'providers set-key'",
          invalidProviderIdMessage: "Missing required argument '<provider-id>' for 'providers set-key'",
          missingApiKeyMessage: "No api key was provided on stdin",
          invalidApiKeyMessage: "No api key was provided on stdin",
          identifierLabel: "Provider name",
          apiKeyFieldLabel: "api_key"
        });
        const { provider } = providerAuthMutationRuntime.setProviderInlineApiKey(
          configPath,
          normalized.provider_id,
          normalized.api_key
        );
        const providerView = toProviderAuthView(provider);
        audit?.succeed({ provider_id: provider.name, auth_field: "api_key" });
        if (json) {
          deps.cliOutputDeps.writeJson({
            ok: true,
            command: "providers set-key",
            schema_version: CLI_SCHEMA_VERSION,
            data: providerView
          });
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderProviderKeySummary("Provider inline api_key updated", providerView));
        return 0;
      }
    );
  };

  const runProvidersClearKey = async (providerName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseConfigCommandArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_clear_key",
      targetKind: "provider",
      targetId: providerName,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers clear-key",
        failurePrefix: "Providers clear-key",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.providersClearKeyError, () => false)
      },
      () => {
        const normalized = providerAuthInputContract.validateProviderClearKeyInput({
          providerId: providerName,
          missingProviderIdMessage: "Missing required argument '<provider-id>' for 'providers clear-key'",
          invalidProviderIdMessage: "Missing required argument '<provider-id>' for 'providers clear-key'",
          identifierLabel: "Provider name"
        });
        const { provider } = providerAuthMutationRuntime.clearProviderInlineApiKey(configPath, normalized.provider_id);
        const providerView = toProviderAuthView(provider);
        audit?.succeed({ provider_id: provider.name, auth_field: "api_key" });
        if (json) {
          deps.cliOutputDeps.writeJson({
            ok: true,
            command: "providers clear-key",
            schema_version: CLI_SCHEMA_VERSION,
            data: providerView
          });
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderProviderKeySummary("Provider inline api_key cleared", providerView));
        return 0;
      }
    );
  };

  const runProvidersSetKeyEnv = async (providerName: string, envVarName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseConfigCommandArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "providers_set_key_env",
      targetKind: "provider",
      targetId: providerName,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "providers set-key-env",
        failurePrefix: "Providers set-key-env",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.providersSetKeyEnvError, () => false)
      },
      () => {
        const normalized = providerAuthInputContract.validateProviderSetKeyEnvInput({
          providerId: providerName,
          apiKeyEnv: envVarName,
          missingProviderIdMessage: "Missing required argument '<provider-id>' for 'providers set-key-env'",
          invalidProviderIdMessage: "Missing required argument '<provider-id>' for 'providers set-key-env'",
          missingApiKeyEnvMessage: "Missing required argument '<env_var>' for 'providers set-key-env'",
          invalidApiKeyEnvMessage: "Missing required argument '<env_var>' for 'providers set-key-env'",
          identifierLabel: "Provider name"
        });
        const { provider } = providerAuthMutationRuntime.setProviderApiKeyEnv(
          configPath,
          normalized.provider_id,
          normalized.api_key_env
        );
        const providerView = toProviderAuthView(provider);
        audit?.succeed({ provider_id: provider.name, auth_field: "api_key_env" });
        if (json) {
          deps.cliOutputDeps.writeJson({
            ok: true,
            command: "providers set-key-env",
            schema_version: CLI_SCHEMA_VERSION,
            data: providerView
          });
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderProviderKeySummary("Provider api_key_env updated", providerView));
        return 0;
      }
    );
  };

  return {
    runProvidersCreate,
    runProvidersUpdate,
    runProvidersDelete,
    runProvidersSetKey,
    runProvidersClearKey,
    runProvidersSetKeyEnv
  };
}
