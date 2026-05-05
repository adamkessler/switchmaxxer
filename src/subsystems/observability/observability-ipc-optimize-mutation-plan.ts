import type { SerializedCostConfig } from "../config/model-input-contract";
import type {
  ObservabilityExternalOptimizeApplyCommand,
  ObservabilityExternalOptimizeMutationCatalogContext,
  ObservabilityExternalOptimizeMutationCompletion,
  ObservabilityExternalOptimizeRestoreCommand,
  ObservabilityIpcJsonValue
} from "./observability-ipc-contract";

export type ObservabilityOptimizeMutationPlanCommand =
  | ObservabilityOptimizeMutationPlanApplyCommand
  | ObservabilityOptimizeMutationPlanRestoreCommand;

export type ObservabilityOptimizeMutationPlanApplyCommand =
  ObservabilityOptimizeMutationPlanCommandBase & {
    readonly command: "optimizeMutation.planApply";
    readonly runId: string;
    readonly targetRouteId: string;
  };

export type ObservabilityOptimizeMutationPlanRestoreCommand =
  ObservabilityOptimizeMutationPlanCommandBase & {
    readonly command: "optimizeMutation.planRestore";
    readonly selector:
      | {
          readonly mode: "action";
          readonly actionId: string;
        }
      | {
          readonly mode: "run_route";
          readonly runId: string;
          readonly routeId: string;
        };
  };

export type ObservabilityOptimizeMutationPlanCommandBase = {
  readonly readModel: Record<string, unknown>;
  readonly sourceSurface: "cli" | "mcp";
  readonly createdBy: string;
  readonly actorKind: "operator" | "agent";
  readonly actorId?: string | null;
  readonly sessionId?: string | null;
  readonly dryRun: boolean;
  readonly metadata?: Record<string, unknown>;
};

export type ObservabilityOptimizeMutationRouteProviderTargetPlan = {
  readonly kind: "route_provider_target";
  readonly routeId: string;
  readonly from: ObservabilityOptimizeMutationRouteProviderTargetState;
  readonly to: ObservabilityOptimizeMutationRouteProviderTargetState;
  readonly reason: string;
};

export type ObservabilityOptimizeMutationNoopPlan = {
  readonly kind: "none";
  readonly reason: string;
};

export type ObservabilityOptimizeMutationPlan =
  | ObservabilityOptimizeMutationRouteProviderTargetPlan
  | ObservabilityOptimizeMutationNoopPlan;

export type ObservabilityOptimizeMutationPlanResult = {
  readonly ok: true;
  readonly plan: ObservabilityOptimizeMutationPlan;
  readonly warnings: readonly string[];
};

export type ObservabilityOptimizeMutationRouteProviderTargetState = {
  readonly serviceProvider: string;
  readonly providerModelId: string;
  readonly cost: SerializedCostConfig | null;
};

export type ObservabilityOptimizeMutationPlanValidationResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly field: string;
    };

export type BuildExternalOptimizeMutationCommandOptions = {
  readonly command: ObservabilityOptimizeMutationPlanCommand;
  readonly result: ObservabilityOptimizeMutationPlanResult;
  readonly reload: boolean;
  readonly verify: boolean;
  readonly completion?: ObservabilityExternalOptimizeMutationCompletion;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonJsonRuntimeValue(value: unknown): boolean {
  return (
    typeof value === "function" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    value instanceof Date ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

function nonJsonRuntimeValueField(value: unknown, field: string): string | null {
  if (isNonJsonRuntimeValue(value)) {
    return field;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const itemField = nonJsonRuntimeValueField(item, `${field}[${index}]`);
      if (itemField !== null) {
        return itemField;
      }
    }
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemField = nonJsonRuntimeValueField(item, `${field}.${key}`);
      if (itemField !== null) {
        return itemField;
      }
    }
  }

  return null;
}

function toJsonValue(value: unknown): ObservabilityIpcJsonValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items: ObservabilityIpcJsonValue[] = [];
    for (const item of value) {
      const jsonItem = toJsonValue(item);
      if (typeof jsonItem === "undefined") {
        return undefined;
      }
      items.push(jsonItem);
    }
    return items;
  }

  if (isRecord(value)) {
    const object: Record<string, ObservabilityIpcJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const jsonItem = toJsonValue(item);
      if (typeof jsonItem !== "undefined") {
        object[key] = jsonItem;
      }
    }
    return object;
  }

  return undefined;
}

function toJsonObject(value: unknown): Record<string, ObservabilityIpcJsonValue> {
  const jsonValue = toJsonValue(value);
  return isRecord(jsonValue) ? jsonValue as Record<string, ObservabilityIpcJsonValue> : {};
}

function providerAuthContext(
  readModel: Record<string, unknown>,
  providerIds: readonly string[]
): Record<string, ObservabilityIpcJsonValue> | undefined {
  const providersByName = readModel["providersByName"];
  if (!isRecord(providersByName)) {
    return undefined;
  }

  const context: Record<string, ObservabilityIpcJsonValue> = {};
  for (const providerId of providerIds) {
    const provider = providersByName[providerId];
    if (!isRecord(provider)) {
      continue;
    }

    context[providerId] = {
      auth_source: toJsonValue(provider["auth_source"]) ?? null,
      api_key_env: toJsonValue(provider["api_key_env"]) ?? null
    };
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function catalogContextForPlan(
  command: ObservabilityOptimizeMutationPlanCommand,
  result: ObservabilityOptimizeMutationPlanResult
): ObservabilityExternalOptimizeMutationCatalogContext {
  const baseContext = {
    kind: "narrowed_command_context" as const,
    catalogRevision: isRecord(command.readModel) && typeof command.readModel["sourcePath"] === "string"
      ? command.readModel["sourcePath"]
      : null
  };

  if (result.plan.kind === "none") {
    return {
      ...baseContext,
      targetRoute: {
        reason: result.plan.reason
      }
    };
  }

  const providerAuth = providerAuthContext(command.readModel, [
    result.plan.from.serviceProvider,
    result.plan.to.serviceProvider
  ]);

  const context: Record<string, ObservabilityIpcJsonValue> = {
    ...baseContext,
    targetRoute: {
      routeId: result.plan.routeId,
      ...toJsonObject(result.plan.from)
    },
    winningRoute: {
      routeId: result.plan.routeId,
      ...toJsonObject(result.plan.to)
    }
  };
  if (command.command === "optimizeMutation.planRestore") {
    context["restorePoint"] = {
      selector: toJsonObject(command.selector),
      reason: result.plan.reason
    };
  }
  if (typeof providerAuth !== "undefined") {
    context["providerAuth"] = providerAuth;
  }

  return context as unknown as ObservabilityExternalOptimizeMutationCatalogContext;
}

function commonExternalCommandFields(options: BuildExternalOptimizeMutationCommandOptions) {
  const fields = {
    idempotencyKey: externalOptimizeMutationIdempotencyKey(options.command, options.reload, options.verify),
    dryRun: options.command.dryRun,
    reload: options.reload,
    verify: options.verify,
    createdBy: options.command.createdBy,
    sourceSurface: options.command.sourceSurface,
    actorKind: options.command.actorKind,
    catalog: catalogContextForPlan(options.command, options.result)
  };
  const optionalFields: Record<string, unknown> = {};
  if (Object.hasOwn(options.command, "actorId")) {
    optionalFields["actorId"] = options.command.actorId ?? null;
  }
  if (Object.hasOwn(options.command, "sessionId")) {
    optionalFields["sessionId"] = options.command.sessionId ?? null;
  }
  if (typeof options.command.metadata !== "undefined") {
    optionalFields["metadata"] = toJsonObject(options.command.metadata);
  }
  if (typeof options.completion !== "undefined") {
    optionalFields["completion"] = options.completion;
  }

  return {
    ...fields,
    ...optionalFields
  };
}

export function externalOptimizeMutationIdempotencyKey(
  command: ObservabilityOptimizeMutationPlanCommand,
  reload: boolean,
  verify: boolean
): string {
  if (command.command === "optimizeMutation.planApply") {
    return `apply:${command.runId}:${command.targetRouteId}:${command.dryRun}:${reload}:${verify}`;
  }

  if (command.selector.mode === "action") {
    return `restore:action:${command.selector.actionId}:${command.dryRun}:${reload}:${verify}`;
  }

  return `restore:run_route:${command.selector.runId}:${command.selector.routeId}:${command.dryRun}:${reload}:${verify}`;
}

export function buildExternalOptimizeApplyCommandFromPlan(
  options: BuildExternalOptimizeMutationCommandOptions & {
    readonly command: ObservabilityOptimizeMutationPlanApplyCommand;
  }
): ObservabilityExternalOptimizeApplyCommand {
  return {
    ...commonExternalCommandFields(options),
    runId: options.command.runId,
    targetRouteId: options.command.targetRouteId
  };
}

export function buildExternalOptimizeRestoreCommandFromPlan(
  options: BuildExternalOptimizeMutationCommandOptions & {
    readonly command: ObservabilityOptimizeMutationPlanRestoreCommand;
  }
): ObservabilityExternalOptimizeRestoreCommand {
  const common = commonExternalCommandFields(options);
  if (options.command.selector.mode === "action") {
    return {
      ...common,
      actionId: options.command.selector.actionId
    };
  }

  return {
    ...common,
    runId: options.command.selector.runId,
    targetRouteId: options.command.selector.routeId
  };
}

export function buildExternalOptimizeMutationCommandFromPlan(
  options: BuildExternalOptimizeMutationCommandOptions
): ObservabilityExternalOptimizeApplyCommand | ObservabilityExternalOptimizeRestoreCommand {
  return options.command.command === "optimizeMutation.planApply"
    ? buildExternalOptimizeApplyCommandFromPlan({
        ...options,
        command: options.command
      })
    : buildExternalOptimizeRestoreCommandFromPlan({
        ...options,
        command: options.command
      });
}

function invalid(message: string, field: string): ObservabilityOptimizeMutationPlanValidationResult {
  return {
    ok: false,
    message,
    field
  };
}

function validateOptionalNullableString(value: Record<string, unknown>, key: string, field: string): string | null {
  if (!Object.hasOwn(value, key) || value[key] === null) {
    return null;
  }

  return isNonEmptyString(value[key]) ? null : `${field} must be a non-empty string or null when present.`;
}

function validateCommonCommandFields(command: Record<string, unknown>): ObservabilityOptimizeMutationPlanValidationResult {
  if (!isRecord(command["readModel"])) {
    return invalid("Optimize mutation plan command readModel must be an object.", "readModel");
  }
  if (command["sourceSurface"] !== "cli" && command["sourceSurface"] !== "mcp") {
    return invalid("Optimize mutation plan command sourceSurface must be cli or mcp.", "sourceSurface");
  }
  if (!isNonEmptyString(command["createdBy"])) {
    return invalid("Optimize mutation plan command createdBy must be a non-empty string.", "createdBy");
  }
  if (command["actorKind"] !== "operator" && command["actorKind"] !== "agent") {
    return invalid("Optimize mutation plan command actorKind must be operator or agent.", "actorKind");
  }

  const actorIdMessage = validateOptionalNullableString(command, "actorId", "actorId");
  if (actorIdMessage !== null) {
    return invalid(actorIdMessage, "actorId");
  }
  const sessionIdMessage = validateOptionalNullableString(command, "sessionId", "sessionId");
  if (sessionIdMessage !== null) {
    return invalid(sessionIdMessage, "sessionId");
  }

  if (typeof command["dryRun"] !== "boolean") {
    return invalid("Optimize mutation plan command dryRun must be a boolean.", "dryRun");
  }
  if (Object.hasOwn(command, "metadata") && !isRecord(command["metadata"])) {
    return invalid("Optimize mutation plan command metadata must be an object when present.", "metadata");
  }

  return { ok: true };
}

function validateRestoreSelector(value: unknown): ObservabilityOptimizeMutationPlanValidationResult {
  if (!isRecord(value)) {
    return invalid("Optimize mutation restore plan selector must be an object.", "selector");
  }

  if (value["mode"] === "action") {
    return isNonEmptyString(value["actionId"])
      ? { ok: true }
      : invalid("Optimize mutation restore plan selector actionId must be a non-empty string.", "selector.actionId");
  }

  if (value["mode"] === "run_route") {
    if (!isNonEmptyString(value["runId"])) {
      return invalid("Optimize mutation restore plan selector runId must be a non-empty string.", "selector.runId");
    }
    if (!isNonEmptyString(value["routeId"])) {
      return invalid("Optimize mutation restore plan selector routeId must be a non-empty string.", "selector.routeId");
    }

    return { ok: true };
  }

  return invalid("Optimize mutation restore plan selector mode must be action or run_route.", "selector.mode");
}

function validateSerializedCostConfig(value: unknown, field: string): ObservabilityOptimizeMutationPlanValidationResult {
  if (!isRecord(value)) {
    return invalid(`Optimize mutation plan ${field} must be an object.`, field);
  }

  for (const costField of ["input", "output", "cache_read", "cache_write"]) {
    if (!isFiniteNumber(value[costField]) || value[costField] < 0) {
      return invalid(`Optimize mutation plan ${field}.${costField} must be a non-negative number.`, `${field}.${costField}`);
    }
  }

  return { ok: true };
}

function validateRouteProviderState(
  value: unknown,
  field: string
): ObservabilityOptimizeMutationPlanValidationResult {
  if (!isRecord(value)) {
    return invalid(`Optimize mutation plan ${field} must be an object.`, field);
  }
  if (!isNonEmptyString(value["serviceProvider"])) {
    return invalid(
      `Optimize mutation plan ${field}.serviceProvider must be a non-empty string.`,
      `${field}.serviceProvider`
    );
  }
  if (!isNonEmptyString(value["providerModelId"])) {
    return invalid(
      `Optimize mutation plan ${field}.providerModelId must be a non-empty string.`,
      `${field}.providerModelId`
    );
  }
  if (value["cost"] !== null) {
    return validateSerializedCostConfig(value["cost"], `${field}.cost`);
  }

  return { ok: true };
}

export function validateObservabilityOptimizeMutationPlanCommand(
  value: unknown
): ObservabilityOptimizeMutationPlanValidationResult {
  const runtimeField = nonJsonRuntimeValueField(value, "command");
  if (runtimeField !== null) {
    return invalid("Optimize mutation plan command must be JSON-safe.", runtimeField);
  }

  if (!isRecord(value)) {
    return invalid("Optimize mutation plan command must be an object.", "command");
  }

  const commonResult = validateCommonCommandFields(value);
  if (!commonResult.ok) {
    return commonResult;
  }

  if (value["command"] === "optimizeMutation.planApply") {
    if (!isNonEmptyString(value["runId"])) {
      return invalid("Optimize mutation apply plan command runId must be a non-empty string.", "runId");
    }
    if (!isNonEmptyString(value["targetRouteId"])) {
      return invalid("Optimize mutation apply plan command targetRouteId must be a non-empty string.", "targetRouteId");
    }

    return { ok: true };
  }

  if (value["command"] === "optimizeMutation.planRestore") {
    return validateRestoreSelector(value["selector"]);
  }

  return invalid(
    "Optimize mutation plan command must be optimizeMutation.planApply or optimizeMutation.planRestore.",
    "command"
  );
}

export function validateObservabilityOptimizeMutationPlanResult(
  value: unknown
): ObservabilityOptimizeMutationPlanValidationResult {
  const runtimeField = nonJsonRuntimeValueField(value, "result");
  if (runtimeField !== null) {
    return invalid("Optimize mutation plan result must be JSON-safe.", runtimeField);
  }

  if (!isRecord(value)) {
    return invalid("Optimize mutation plan result must be an object.", "result");
  }
  if (value["ok"] !== true) {
    return invalid("Optimize mutation plan result ok must be true.", "ok");
  }
  if (!Array.isArray(value["warnings"]) || !value["warnings"].every((warning) => isNonEmptyString(warning))) {
    return invalid("Optimize mutation plan result warnings must be a string array.", "warnings");
  }
  if (!isRecord(value["plan"])) {
    return invalid("Optimize mutation plan result plan must be an object.", "plan");
  }

  const plan = value["plan"];
  if (plan["kind"] === "none") {
    return isNonEmptyString(plan["reason"])
      ? { ok: true }
      : invalid("Optimize mutation noop plan reason must be a non-empty string.", "plan.reason");
  }

  if (plan["kind"] !== "route_provider_target") {
    return invalid("Optimize mutation plan kind must be none or route_provider_target.", "plan.kind");
  }
  if (!isNonEmptyString(plan["routeId"])) {
    return invalid("Optimize mutation route provider target plan routeId must be a non-empty string.", "plan.routeId");
  }

  const fromResult = validateRouteProviderState(plan["from"], "plan.from");
  if (!fromResult.ok) {
    return fromResult;
  }
  const toResult = validateRouteProviderState(plan["to"], "plan.to");
  if (!toResult.ok) {
    return toResult;
  }
  if (!isNonEmptyString(plan["reason"])) {
    return invalid("Optimize mutation route provider target plan reason must be a non-empty string.", "plan.reason");
  }

  return { ok: true };
}
