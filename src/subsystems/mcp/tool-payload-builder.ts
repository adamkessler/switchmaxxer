import { APP_ERROR_CODES, type AppErrorCode as McpErrorCode } from "../../platform/error-codes";
import { logWarning, safeErrorMessage } from "../../platform/logger";
import { buildHandledPayload, runParsedMcpTool, toEnvelopeFromError, type McpErrorEnvelope, type McpSuccessEnvelope } from "./envelope";
import { McpToolError } from "./errors";
import { buildGatewayHealthToolPayload, buildGatewayRuntimeConfigToolPayload, buildGatewayStatusToolPayload } from "./gateway-tools";
import {
  buildConfigSchemaToolPayload,
  buildConfigShowToolPayload,
  buildModelsListToolPayload,
  buildModelsShowToolPayload,
  buildProvidersListToolPayload,
  buildProvidersShowToolPayload,
  buildRoutesListToolPayload,
  buildRoutesShowToolPayload
} from "./read-tools";
import {
  buildBenchListToolPayload as buildBenchListObservabilityToolPayload,
  buildBenchShowToolPayload as buildBenchShowObservabilityToolPayload,
  buildLedgerListToolPayload as buildLedgerListObservabilityToolPayload,
  buildLedgerShowToolPayload as buildLedgerShowObservabilityToolPayload,
  buildPruneToolPayload as buildPruneObservabilityToolPayload,
  buildTraceListToolPayload as buildTraceListObservabilityToolPayload,
  buildTraceObservationsToolPayload as buildTraceObservationsObservabilityToolPayload,
  buildTraceRepairToolPayload as buildTraceRepairObservabilityToolPayload,
  buildTraceShowToolPayload as buildTraceShowObservabilityToolPayload,
  buildTraceStatsToolPayload as buildTraceStatsObservabilityToolPayload,
  buildTraceVerifyToolPayload as buildTraceVerifyObservabilityToolPayload
} from "./observability-tools";
import { buildBenchRunToolPayload } from "./bench-run-tool";
import {
  buildOptimizeApplyToolPayload,
  buildOptimizeListToolPayload,
  buildOptimizeRestoreToolPayload,
  buildOptimizeRunToolPayload,
  buildOptimizeShowToolPayload
} from "./optimize-tools";
import {
  buildConfigValidatePayload,
  buildModelsCreatePayload,
  buildModelsDeletePayload,
  buildModelsUpdatePayload,
  buildProvidersClearKeyPayload,
  buildProvidersCreatePayload,
  buildProvidersDeletePayload,
  buildProvidersSetKeyEnvPayload,
  buildProvidersSetKeyPayload,
  buildProvidersUpdatePayload,
  buildRoutesCreatePayload,
  buildRoutesDeletePayload,
  buildRoutesExplainPayload,
  buildRoutesUpdatePayload
} from "./config-entity-handlers";
import {
  parseModelsCreateArgs,
  parseModelsDeleteArgs,
  parseModelsUpdateArgs,
  parseProvidersClearKeyArgs,
  parseProvidersCreateArgs,
  parseProvidersDeleteArgs,
  parseProvidersSetKeyArgs,
  parseProvidersSetKeyEnvArgs,
  parseProvidersUpdateArgs,
  type ProvidersUpdateArgs,
  parseRoutesCreateArgs,
  parseRoutesDeleteArgs,
  parseRoutesShowArgs,
  parseRoutesUpdateArgs
} from "./parsers";
import { getToolEnvelopeCommand, sessionCanCallTool } from "./tools";
import type { McpToolContext, McpToolRuntimeDeps } from "./tool-context";
import { loadCliReadModel } from "../config/read-model";
import {
  finishConfigMutationControlPlaneAudit,
  startConfigMutationControlPlaneAudit
} from "../observability/config-mutation-audit";
import type {
  ControlPlaneActionOperation,
  ControlPlaneActionTargetKind
} from "../observability/control-plane-actions";
import { resolveObservabilityStorePath, closeObservabilityServiceHandle } from "../observability/runtime-loader";
import { getSessionObservabilityHandle } from "./session";
import type { McpSessionContext } from "./types";

type McpToolPayloadHandler = (
  context: McpToolContext
) => Promise<McpSuccessEnvelope | McpErrorEnvelope> | McpSuccessEnvelope | McpErrorEnvelope;

function requirePrivilegedProviderAuthMutation(
  command: string,
  authFields: string[],
  sessionContext?: McpSessionContext
): void {
  if (authFields.length === 0 || sessionCanCallTool({ capability: "privileged" }, sessionContext)) {
    return;
  }

  throw new McpToolError(
    APP_ERROR_CODES.unsupported,
    `MCP session is not authorized to change provider auth fields through '${command}'.`,
    {
      fields: authFields
    }
  );
}

function getProvidersUpdateAuthFields(args: ProvidersUpdateArgs): string[] {
  return Array.from(
    new Set([
      ...(typeof args.apiKeyEnv !== "undefined" ? ["api_key_env"] : []),
      ...(args.noAuth ? ["no_auth", "api_key", "api_key_env"] : [])
    ])
  );
}

function createMcpMutationAudit(
  context: McpToolContext,
  options: {
    operation: ControlPlaneActionOperation;
    targetKind: ControlPlaneActionTargetKind;
    targetId: string | null;
  }
): null | {
  succeed: (result?: Record<string, unknown>) => void;
  fail: (error: { code: string; message: string; details?: unknown }) => void;
  close: () => void;
} {
  try {
    const dbPath = resolveObservabilityStorePath();
    const ownsHandle = typeof context.sessionContext === "undefined";
    const handle = getSessionObservabilityHandle(context.sessionContext, dbPath, { createIfMissing: true });

    if (!handle) {
      return null;
    }

    const actionId = startConfigMutationControlPlaneAudit({
      repository: handle.service.controlPlaneActions,
      sourceSurface: "mcp",
      operation: options.operation,
      targetKind: options.targetKind,
      targetId: options.targetId,
      createdBy: "switchmaxxer mcp",
      actorKind: "agent",
      sessionId: context.sessionContext?.sessionId ?? null,
      metadata: {
        requested_config_path: context.configPath ?? null,
        observability_store_path: dbPath
      }
    });

    return {
      succeed: (result: Record<string, unknown> = {}) => {
        finishConfigMutationControlPlaneAudit({
          repository: handle.service.controlPlaneActions,
          actionId,
          status: "succeeded",
          targetId: options.targetId,
          result
        });
      },
      fail: (error) => {
        finishConfigMutationControlPlaneAudit({
          repository: handle.service.controlPlaneActions,
          actionId,
          status: "failed",
          targetId: options.targetId,
          error
        });
      },
      close: () => {
        if (ownsHandle) {
          closeObservabilityServiceHandle(handle);
        }
      }
    };
  } catch (error) {
    logWarning(`Unable to open observability store for MCP config mutation audit: ${safeErrorMessage(error)}`);
    return null;
  }
}

async function runAuditedParsedMcpMutation<TArgs>(
  context: McpToolContext,
  command: string,
  fallbackCode: McpErrorCode,
  auditOptions: (args: TArgs) => {
    operation: ControlPlaneActionOperation;
    targetKind: ControlPlaneActionTargetKind;
    targetId: string | null;
  },
  parse: () => TArgs,
  handler: (args: TArgs) => Promise<McpSuccessEnvelope | McpErrorEnvelope> | McpSuccessEnvelope | McpErrorEnvelope
): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  return buildHandledPayload(command, fallbackCode, async () => {
    const args = parse();
    const audit = createMcpMutationAudit(context, auditOptions(args));

    try {
      const envelope = await handler(args);
      if (envelope.ok) {
        audit?.succeed();
      } else {
        audit?.fail({
          code: envelope.error.code,
          message: envelope.error.message,
          details: envelope.details
        });
      }
      return envelope;
    } catch (error) {
      const envelope = toEnvelopeFromError(command, error, fallbackCode);
      audit?.fail({
        code: envelope.error.code,
        message: envelope.error.message,
        details: envelope.details
      });
      return envelope;
    } finally {
      audit?.close();
    }
  });
}

const toolHandlers = new Map<string, McpToolPayloadHandler>([
  ["config_validate", ({ configPath: toolConfigPath }) => buildConfigValidatePayload(toolConfigPath)],
  ["config_schema", () => buildConfigSchemaToolPayload()],
  ["config_show", ({ configPath: toolConfigPath }) => buildConfigShowToolPayload(toolConfigPath)],
  ["trace_list", buildTraceListObservabilityToolPayload],
  ["trace_show", buildTraceShowObservabilityToolPayload],
  ["trace_stats", buildTraceStatsObservabilityToolPayload],
  ["trace_observations", buildTraceObservationsObservabilityToolPayload],
  ["trace_verify", buildTraceVerifyObservabilityToolPayload],
  ["trace_repair", buildTraceRepairObservabilityToolPayload],
  ["prune", buildPruneObservabilityToolPayload],
  ["ledger_list", buildLedgerListObservabilityToolPayload],
  ["ledger_show", buildLedgerShowObservabilityToolPayload],
  ["bench_list", buildBenchListObservabilityToolPayload],
  ["bench_show", buildBenchShowObservabilityToolPayload],
  ["bench_run", buildBenchRunToolPayload],
  ["optimize_list", buildOptimizeListToolPayload],
  ["optimize_show", buildOptimizeShowToolPayload],
  ["optimize_run", buildOptimizeRunToolPayload],
  ["optimize_apply", buildOptimizeApplyToolPayload],
  ["optimize_restore", buildOptimizeRestoreToolPayload],
  ["models_list", buildModelsListToolPayload],
  ["models_show", buildModelsShowToolPayload],
  [
    "models_create",
    (context) =>
      runAuditedParsedMcpMutation(context, "models create", APP_ERROR_CODES.modelsCreateError, (args) => ({
        operation: "models_create",
        targetKind: "model",
        targetId: args.modelId
      }), () => parseModelsCreateArgs(context.params), (args) =>
        buildModelsCreatePayload(args, context.configPath)
      )
  ],
  [
    "models_update",
    (context) =>
      runAuditedParsedMcpMutation(context, "models update", APP_ERROR_CODES.modelsUpdateError, (args) => ({
        operation: "models_update",
        targetKind: "model",
        targetId: args.modelId
      }), () => parseModelsUpdateArgs(context.params), (args) =>
        buildModelsUpdatePayload(args, context.configPath)
      )
  ],
  [
    "models_delete",
    (context) =>
      runAuditedParsedMcpMutation(context, "models delete", APP_ERROR_CODES.modelsDeleteError, (args) => ({
        operation: "models_delete",
        targetKind: "model",
        targetId: args.modelId
      }), () => parseModelsDeleteArgs(context.params), (args) =>
        buildModelsDeletePayload(args, context.configPath)
      )
  ],
  ["providers_list", buildProvidersListToolPayload],
  ["providers_show", buildProvidersShowToolPayload],
  [
    "providers_create",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers create",
        APP_ERROR_CODES.providersCreateError,
        (args) => ({
          operation: "providers_create",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersCreateArgs(context.params),
        (args) => buildProvidersCreatePayload(args, context.configPath)
      )
  ],
  [
    "providers_update",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers update",
        APP_ERROR_CODES.providersUpdateError,
        (args) => ({
          operation: "providers_update",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersUpdateArgs(context.params),
        (args) => {
          requirePrivilegedProviderAuthMutation(
            "providers_update",
            getProvidersUpdateAuthFields(args),
            context.sessionContext
          );
          return buildProvidersUpdatePayload(args, context.configPath);
        }
      )
  ],
  [
    "providers_delete",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers delete",
        APP_ERROR_CODES.providersDeleteError,
        (args) => ({
          operation: "providers_delete",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersDeleteArgs(context.params),
        (args) => buildProvidersDeletePayload(args, context.configPath)
      )
  ],
  [
    "providers_set_key",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers set-key",
        APP_ERROR_CODES.providersSetKeyError,
        (args) => ({
          operation: "providers_set_key",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersSetKeyArgs(context.params),
        (args) => buildProvidersSetKeyPayload(args, context.configPath)
      )
  ],
  [
    "providers_clear_key",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers clear-key",
        APP_ERROR_CODES.providersClearKeyError,
        (args) => ({
          operation: "providers_clear_key",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersClearKeyArgs(context.params),
        (args) => buildProvidersClearKeyPayload(args, context.configPath)
      )
  ],
  [
    "providers_set_key_env",
    (context) =>
      runAuditedParsedMcpMutation(
        context,
        "providers set-key-env",
        APP_ERROR_CODES.providersSetKeyEnvError,
        (args) => ({
          operation: "providers_set_key_env",
          targetKind: "provider",
          targetId: args.providerId
        }),
        () => parseProvidersSetKeyEnvArgs(context.params),
        (args) => buildProvidersSetKeyEnvPayload(args, context.configPath)
      )
  ],
  ["routes_list", buildRoutesListToolPayload],
  ["routes_show", buildRoutesShowToolPayload],
  [
    "routes_explain",
    ({ params: toolParams, configPath: toolConfigPath }) =>
      runParsedMcpTool(
        "routes explain",
        APP_ERROR_CODES.routesExplainError,
        () => parseRoutesShowArgs(toolParams, "routes_explain"),
        (args) => buildRoutesExplainPayload(args, toolConfigPath)
      )
  ],
  [
    "routes_create",
    (context) =>
      runAuditedParsedMcpMutation(context, "routes create", APP_ERROR_CODES.routesCreateError, (args) => ({
        operation: "routes_create",
        targetKind: "route",
        targetId: args.routeId
      }), () => parseRoutesCreateArgs(context.params), (args) =>
        buildRoutesCreatePayload(args, context.configPath)
      )
  ],
  [
    "routes_update",
    (context) =>
      runAuditedParsedMcpMutation(context, "routes update", APP_ERROR_CODES.routesUpdateError, (args) => ({
        operation: "routes_update",
        targetKind: "route",
        targetId: args.routeId
      }), () => parseRoutesUpdateArgs(context.params), (args) =>
        buildRoutesUpdatePayload(args, context.configPath)
      )
  ],
  [
    "routes_delete",
    (context) =>
      runAuditedParsedMcpMutation(context, "routes delete", APP_ERROR_CODES.routesDeleteError, (args) => ({
        operation: "routes_delete",
        targetKind: "route",
        targetId: args.routeId
      }), () => parseRoutesDeleteArgs(context.params), (args) =>
        buildRoutesDeletePayload(args, context.configPath)
      )
  ],
  ["gateway_health", buildGatewayHealthToolPayload],
  ["gateway_status", buildGatewayStatusToolPayload],
  ["gateway_runtime_config", buildGatewayRuntimeConfigToolPayload]
]);

const toolFallbackErrorCodes = new Map<string, McpErrorCode>([
  ["config_validate", APP_ERROR_CODES.invalidConfig],
  ["config_schema", APP_ERROR_CODES.toolExecutionError],
  ["config_show", APP_ERROR_CODES.toolExecutionError],
  ["trace_list", APP_ERROR_CODES.traceListError],
  ["trace_show", APP_ERROR_CODES.traceShowError],
  ["trace_stats", APP_ERROR_CODES.traceStatsError],
  ["trace_observations", APP_ERROR_CODES.traceObservationsError],
  ["trace_verify", APP_ERROR_CODES.traceVerifyError],
  ["trace_repair", APP_ERROR_CODES.traceRepairError],
  ["prune", APP_ERROR_CODES.pruneError],
  ["ledger_list", APP_ERROR_CODES.ledgerListError],
  ["ledger_show", APP_ERROR_CODES.ledgerShowError],
  ["bench_list", APP_ERROR_CODES.benchListError],
  ["bench_show", APP_ERROR_CODES.benchShowError],
  ["bench_run", APP_ERROR_CODES.benchError],
  ["optimize_list", APP_ERROR_CODES.optimizeListError],
  ["optimize_show", APP_ERROR_CODES.optimizeShowError],
  ["optimize_run", APP_ERROR_CODES.optimizeError],
  ["optimize_apply", APP_ERROR_CODES.optimizeError],
  ["optimize_restore", APP_ERROR_CODES.optimizeError],
  ["models_list", APP_ERROR_CODES.modelsListError],
  ["models_show", APP_ERROR_CODES.modelsShowError],
  ["models_create", APP_ERROR_CODES.modelsCreateError],
  ["models_update", APP_ERROR_CODES.modelsUpdateError],
  ["models_delete", APP_ERROR_CODES.modelsDeleteError],
  ["providers_list", APP_ERROR_CODES.providersListError],
  ["providers_show", APP_ERROR_CODES.providersShowError],
  ["providers_create", APP_ERROR_CODES.providersCreateError],
  ["providers_update", APP_ERROR_CODES.providersUpdateError],
  ["providers_delete", APP_ERROR_CODES.providersDeleteError],
  ["providers_set_key", APP_ERROR_CODES.providersSetKeyError],
  ["providers_clear_key", APP_ERROR_CODES.providersClearKeyError],
  ["providers_set_key_env", APP_ERROR_CODES.providersSetKeyEnvError],
  ["routes_list", APP_ERROR_CODES.routesListError],
  ["routes_show", APP_ERROR_CODES.routesShowError],
  ["routes_explain", APP_ERROR_CODES.routesExplainError],
  ["routes_create", APP_ERROR_CODES.routesCreateError],
  ["routes_update", APP_ERROR_CODES.routesUpdateError],
  ["routes_delete", APP_ERROR_CODES.routesDeleteError],
  ["gateway_health", APP_ERROR_CODES.gatewayHealthError],
  ["gateway_status", APP_ERROR_CODES.gatewayStatusError],
  ["gateway_runtime_config", APP_ERROR_CODES.gatewayRuntimeConfigError]
]);

export async function buildToolPayload(
  toolName: string,
  params: unknown,
  configPath?: string,
  sessionContext?: McpSessionContext,
  runtimeDeps?: McpToolRuntimeDeps
): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const readModelContext: { value?: ReturnType<typeof loadCliReadModel> } = {};
  const context: McpToolContext = {
    params,
    configPath,
    sessionContext,
    runtimeDeps,
    getReadModel: () => {
      if (typeof readModelContext.value === "undefined") {
        readModelContext.value = loadCliReadModel(configPath);
      }

      return readModelContext.value;
    }
  };

  const handler = toolHandlers.get(toolName);
  const fallbackCode = toolFallbackErrorCodes.get(toolName);
  if (!handler || !fallbackCode) {
    throw new Error(`buildToolPayload missing dispatch branch for '${toolName}'`);
  }

  return buildHandledPayload(getToolEnvelopeCommand(toolName), fallbackCode, () => handler(context));
}
