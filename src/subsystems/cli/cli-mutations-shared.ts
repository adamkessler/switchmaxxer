import type { AppErrorCode } from "../../platform/error-codes";
import { logWarning, safeErrorMessage } from "../../platform/logger";
import { maskSemiSensitiveEnvVarName } from "../../platform/masked-secret";
import { buildSanitizedErrorEnvelope } from "../../platform/response-envelope";
import { isNonEmptyString } from "../../platform/type-guards";
import type { ProviderReadModel, RouteReadModel } from "../../platform/types";
import { createEntityMutationRuntimes } from "../config/mutation";
import { createProviderAuthInputContract } from "../config/provider-auth-input-contract";
import type {
  ControlPlaneActionOperation,
  ControlPlaneActionTargetKind
} from "../observability/control-plane-actions";
import type { CliBootstrapDeps } from "./cli-bootstrap-types";

export function createCliMutationShared(rawDeps: CliBootstrapDeps) {
  const deps = {
    ...rawDeps,
    ...rawDeps.registrationDeps,
    ...rawDeps.configDeps,
    ...rawDeps.observabilityDeps,
    ...rawDeps.normalizationDeps,
    ...rawDeps.metadataDeps,
    ...rawDeps.formattingDeps,
    ...rawDeps.contractDeps
  };
  const { cliMutationCommandDeps, formattingDeps, contractDeps } = rawDeps;
  const { getMutableConfigSection, createCliMutationError, assertSafeCliConfigIdentifier } = cliMutationCommandDeps;

  const providerAuthInputContract = createProviderAuthInputContract({
    isNonEmptyString,
    assertSafeIdentifier: assertSafeCliConfigIdentifier,
    invalidInputField: (message) => {
      throw createCliMutationError(contractDeps.mcpUsageErrorCodes.invalidInputField, message);
    },
    missingRequiredField: (message) => {
      throw formattingDeps.createCliUsageError(contractDeps.mcpUsageErrorCodes.missingRequiredField, message);
    }
  });

  const {
    modelMutationRuntime,
    providerMutationRuntime,
    providerAuthMutationRuntime,
    routeMutationRuntime
  } = createEntityMutationRuntimes({
    loadCliReadModel: deps.loadCliReadModel,
    mutateConfigDocument: deps.mutateConfigDocument,
    getMutableModels: (document: Record<string, unknown>) => getMutableConfigSection(document, "models"),
    getMutableProviders: (document: Record<string, unknown>) => getMutableConfigSection(document, "service_providers"),
    getMutableRoutes: (document: Record<string, unknown>) => getMutableConfigSection(document, "routes"),
    entityStateErrorCodes: contractDeps.mcpEntityStateErrorCodes,
    createEntityStateError: (code: string, message: string) => createCliMutationError(code, message),
    createInvalidInputMutationError: (message: string) =>
      createCliMutationError(contractDeps.mcpUsageErrorCodes.invalidInputField, message),
    createInvalidConfigMutationError: (message: string) => createCliMutationError("invalid_config_mutation", message)
  });

  const toProviderAuthView = (provider: ProviderReadModel) => ({
    name: provider.name,
    api_mode: provider.api_mode,
    endpoint: provider.endpoint,
    allow_private_endpoints: provider.allow_private_endpoints,
    allow_insecure_http: provider.allow_insecure_http,
    anthropic_version: provider.anthropic_version,
    model_id_format: provider.model_id_format,
    auth_source: provider.auth_source,
    api_key_env: maskSemiSensitiveEnvVarName(provider.api_key_env),
    api_key: provider.api_key_masked
  });

  const renderProviderKeySummary = (prefix: string, providerView: ReturnType<typeof toProviderAuthView>): string =>
    [
      `${prefix}: ${providerView.name}`,
      `Endpoint: ${providerView.endpoint || "(none)"}`,
      `Allow Private Endpoints: ${String(providerView.allow_private_endpoints)}`,
      `Allow Insecure HTTP: ${String(providerView.allow_insecure_http)}`,
      `Anthropic Version: ${providerView.anthropic_version ?? "null"}`,
      `Model ID Format: ${providerView.model_id_format}`,
      `Auth Source: ${providerView.auth_source}`,
      `api_key_env: ${providerView.api_key_env ?? "null"}`,
      `api_key: ${providerView.api_key ?? "null"}`
    ].join("\n");

  const renderProviderSummary = (prefix: string, providerView: ReturnType<typeof toProviderAuthView>): string =>
    [
      `${prefix}: ${providerView.name}`,
      `API Mode: ${providerView.api_mode || "(unknown)"}`,
      `Endpoint: ${providerView.endpoint || "(none)"}`,
      `Allow Private Endpoints: ${String(providerView.allow_private_endpoints)}`,
      `Allow Insecure HTTP: ${String(providerView.allow_insecure_http)}`,
      `Anthropic Version: ${providerView.anthropic_version ?? "null"}`,
      `Model ID Format: ${providerView.model_id_format}`,
      `Auth Source: ${providerView.auth_source}`,
      `api_key_env: ${providerView.api_key_env ?? "null"}`,
      `api_key: ${providerView.api_key ?? "null"}`
    ].join("\n");

  const renderRouteSummary = (prefix: string, route: RouteReadModel): string =>
    [
      `${prefix}: ${route.name}`,
      `Display Name: ${route.display_name || "(none)"}`,
      `Model: ${route.model || "(none)"}`,
      `Service Provider: ${route.service_provider || "(none)"}`,
      `Provider Model ID: ${route.provider_model_id || "(none)"}`,
      `API Mode: ${route.api_mode || "(unknown)"}`,
      `Route Timeout Ms: ${String(route.timeout_ms ?? "(inherit)")}`,
      `Effective Timeout Ms: ${String(route.effective_timeout_ms ?? "(unknown)")}`,
      `Route Cost: ${deps.formatCostConfig(route.cost)}`,
      `Model Cost: ${deps.formatCostConfig(route.model_cost)}`,
      `Effective Cost: ${deps.formatCostConfig(route.effective_cost)}`
    ].join("\n");

  const createCliMutationAudit = (options: {
    operation: ControlPlaneActionOperation;
    targetKind: ControlPlaneActionTargetKind;
    targetId: string | null;
    configPath?: string;
  }) => {
    try {
      const dbPath = deps.resolveObservabilityStorePath();
      const started = deps.observabilityModule.controlPlaneAudit.startConfigMutation({
        dbPath,
        sourceSurface: "cli",
        operation: options.operation,
        targetKind: options.targetKind,
        targetId: options.targetId,
        createdBy: "switchmaxxer cli",
        actorKind: "operator",
        metadata: {
          requested_config_path: options.configPath ?? null,
          observability_store_path: dbPath
        }
      });

      if (!started.storeFound) {
        return null;
      }

      return {
        succeed: (result: Record<string, unknown> = {}) => {
          deps.observabilityModule.controlPlaneAudit.finishConfigMutation({
            dbPath,
            actionId: started.actionId,
            status: "succeeded",
            targetId: options.targetId,
            result
          });
        },
        fail: (error: { code: string; message: string; details?: unknown }) => {
          deps.observabilityModule.controlPlaneAudit.finishConfigMutation({
            dbPath,
            actionId: started.actionId,
            status: "failed",
            targetId: options.targetId,
            error
          });
        },
        close: () => {}
      };
    } catch (error) {
      logWarning(`Unable to open observability store for config mutation audit: ${safeErrorMessage(error)}`);
      return null;
    }
  };

  type CliMutationAuditHandle = ReturnType<typeof createCliMutationAudit>;
  type CliMutationFailureClassification = {
    code: string;
    message: string;
    exitCode: number;
  };

  const withCliMutationAudit = async (
    audit: CliMutationAuditHandle,
    options: {
      json: boolean;
      command: string;
      failurePrefix: string;
      classify: (error: unknown) => CliMutationFailureClassification;
      printUsageOnExit2?: boolean;
    },
    handler: () => Promise<number> | number
  ): Promise<number> => {
    try {
      return await handler();
    } catch (error) {
      const classified = options.classify(error);
      audit?.fail({ code: classified.code, message: classified.message });

      if (options.json) {
        deps.cliOutputDeps.writeJson(
          buildSanitizedErrorEnvelope(options.command, classified.code as AppErrorCode, classified.message)
        );
        return classified.exitCode;
      }

      if (options.printUsageOnExit2 === true && classified.exitCode === 2) {
        deps.cliOutputDeps.printUsageError(classified.message);
        return 2;
      }

      deps.cliOutputDeps.writeStderr(`${options.failurePrefix} failed: ${classified.message}`);
      return classified.exitCode;
    } finally {
      audit?.close();
    }
  };

  const classifyUsageOrMutationFailure = (
    error: unknown,
    fallbackCode: AppErrorCode,
    isUsageMessage: (message: string) => boolean = deps.cliMutationCommandDeps.noUsageMessageMatch
  ): CliMutationFailureClassification =>
    deps.cliMutationCommandDeps.classifyCliUsageFailure(error, {
      usageFallbackCode: fallbackCode,
      mutationFallbackCode: fallbackCode,
      isUsageMessage
    });

  const classifyMutationMessageFailure = (
    error: unknown,
    fallbackCode: AppErrorCode,
    unknownMessage: string
  ): CliMutationFailureClassification => {
    const message = error instanceof Error ? error.message : unknownMessage;
    const classified = deps.classifyMutationError(message, fallbackCode);
    return {
      code: classified.code,
      message,
      exitCode: classified.exitCode
    };
  };

  return {
    deps,
    assertSafeCliConfigIdentifier,
    providerAuthInputContract,
    modelMutationRuntime,
    providerMutationRuntime,
    providerAuthMutationRuntime,
    routeMutationRuntime,
    toProviderAuthView,
    renderProviderKeySummary,
    renderProviderSummary,
    renderRouteSummary,
    createCliMutationAudit,
    withCliMutationAudit,
    classifyUsageOrMutationFailure,
    classifyMutationMessageFailure
  };
}

export type CliMutationShared = ReturnType<typeof createCliMutationShared>;
