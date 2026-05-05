import path from "node:path";

import {
  OBSERVABILITY_IPC_CONTRACT_VERSION,
  OBSERVABILITY_IPC_ERROR_CODES,
  isObservabilityIpcOperation,
  type ObservabilityExternalOptimizeApplyCommand,
  type ObservabilityExternalOptimizeRestoreCommand,
  type ObservabilityIpcErrorCode,
  type ObservabilityIpcRequest,
  type ObservabilityIpcResponse
} from "./observability-ipc-contract";
import { isBenchPathModeValue } from "./bench-path-mode";
import {
  CONTROL_PLANE_ACTION_OPERATIONS,
  CONTROL_PLANE_ACTION_SOURCE_SURFACES,
  CONTROL_PLANE_ACTION_TARGET_KINDS
} from "./control-plane-actions";
import { validateTraceMaintenanceScope } from "./trace-maintenance-validation";

export interface ObservabilityIpcInvalidFrame {
  readonly id: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export type ObservabilityIpcRequestValidationResult =
  | {
      readonly ok: true;
      readonly request: ObservabilityIpcRequest;
    }
  | {
      readonly ok: false;
      readonly error: ObservabilityIpcInvalidFrame;
    };

export type ObservabilityIpcResponseValidationResult =
  | {
      readonly ok: true;
      readonly response: ObservabilityIpcResponse;
    }
  | {
      readonly ok: false;
      readonly error: ObservabilityIpcInvalidFrame;
    };

export type ObservabilityIpcTransportMode = "local" | "external";

export interface ObservabilityIpcRequestValidationOptions {
  readonly transport?: ObservabilityIpcTransportMode;
}

export type ObservabilityExternalOptimizeMutationCommandValidationResult =
  | {
      readonly ok: true;
      readonly command: ObservabilityExternalOptimizeApplyCommand | ObservabilityExternalOptimizeRestoreCommand;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly message: string;
        readonly field: string;
      };
    };

const UNKNOWN_FRAME_ID = "unknown";
const OBSERVABILITY_IPC_ERROR_CODE_VALUES = new Set<string>(Object.values(OBSERVABILITY_IPC_ERROR_CODES));
const CONTROL_PLANE_AUDIT_ACTOR_KINDS = ["operator", "agent"] as const;
const CONTROL_PLANE_AUDIT_FINISH_STATUSES = ["succeeded", "failed"] as const;
const OPTIMIZATION_RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
const OPTIMIZE_MUTATION_SOURCE_SURFACES = ["cli", "mcp"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameIdFrom(value: unknown): string {
  if (isRecord(value) && typeof value["id"] === "string" && value["id"].length > 0) {
    return value["id"];
  }

  return UNKNOWN_FRAME_ID;
}

function invalidFrame(value: unknown, message: string, details: Record<string, unknown> = {}): ObservabilityIpcInvalidFrame {
  return {
    id: frameIdFrom(value),
    message,
    details
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0 && value.every((item) => item.length > 0);
}

function isObservabilityIpcErrorCode(value: unknown): value is ObservabilityIpcErrorCode {
  return typeof value === "string" && OBSERVABILITY_IPC_ERROR_CODE_VALUES.has(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isIsoDateTimeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function assertRequiredObject(payload: Record<string, unknown>, field: string): string | null {
  if (!isRecord(payload[field])) {
    return `Observability IPC request payload.${field} must be an object.`;
  }

  return null;
}

function assertOptionalObject(payload: Record<string, unknown>, field: string): string | null {
  if (Object.hasOwn(payload, field) && !isRecord(payload[field])) {
    return `Observability IPC request payload.${field} must be an object when present.`;
  }

  return null;
}

function assertRequiredString(payload: Record<string, unknown>, field: string): string | null {
  if (typeof payload[field] !== "string" || payload[field].length === 0) {
    return `Observability IPC request payload.${field} must be a non-empty string.`;
  }

  return null;
}

function assertRequiredFunction(payload: Record<string, unknown>, field: string): string | null {
  if (typeof payload[field] !== "function") {
    return `Observability IPC request payload.${field} must be a function.`;
  }

  return null;
}

function assertOptionalDate(payload: Record<string, unknown>, field: string): string | null {
  if (Object.hasOwn(payload, field) && !isValidDate(payload[field])) {
    return `Observability IPC request payload.${field} must be a valid Date when present.`;
  }

  return null;
}

function assertOptionalBoolean(payload: Record<string, unknown>, field: string): string | null {
  if (Object.hasOwn(payload, field) && typeof payload[field] !== "boolean") {
    return `Observability IPC request payload.${field} must be a boolean when present.`;
  }

  return null;
}

function assertOptionalNullableString(payload: Record<string, unknown>, field: string): string | null {
  if (
    Object.hasOwn(payload, field) &&
    payload[field] !== null &&
    (typeof payload[field] !== "string" || payload[field].length === 0)
  ) {
    return `Observability IPC request payload.${field} must be a non-empty string or null when present.`;
  }

  return null;
}

function assertOptionalString(payload: Record<string, unknown>, field: string): string | null {
  if (
    Object.hasOwn(payload, field) &&
    (typeof payload[field] !== "string" || payload[field].length === 0)
  ) {
    return `Observability IPC request payload.${field} must be a non-empty string when present.`;
  }

  return null;
}

function assertRequiredBoolean(payload: Record<string, unknown>, field: string): string | null {
  if (typeof payload[field] !== "boolean") {
    return `Observability IPC request payload.${field} must be a boolean.`;
  }

  return null;
}

function assertRequiredKnownString(
  payload: Record<string, unknown>,
  field: string,
  values: readonly string[]
): string | null {
  if (typeof payload[field] !== "string" || !values.includes(payload[field])) {
    return `Observability IPC request payload.${field} must be one of: ${values.join(", ")}.`;
  }

  return null;
}

function assertNullableStringArray(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  if (value !== null && !isNonEmptyStringArray(value)) {
    return `Observability IPC request payload.${field} must be null or a non-empty string array.`;
  }

  return null;
}

function assertRequiredCutoffIso(payload: Record<string, unknown>): string | null {
  if (!isIsoDateTimeString(payload["cutoffIso"])) {
    return "Observability IPC request payload.cutoffIso must be a valid date-time string.";
  }

  return null;
}

function assertRequiredPositiveLimit(payload: Record<string, unknown>): string | null {
  if (!isPositiveInteger(payload["limit"])) {
    return "Observability IPC request payload.limit must be a positive integer.";
  }

  return null;
}

function assertEmptyPayload(payload: Record<string, unknown>): string | null {
  if (Object.keys(payload).length > 0) {
    return "Observability IPC request payload must be empty for this operation.";
  }

  return null;
}

function nonJsonRuntimeValueField(value: unknown, field: string): string | null {
  if (
    typeof value === "function" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    value instanceof Date ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
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

function firstValidationError(
  validators: Array<{
    readonly field: string;
    readonly validate: () => string | null;
  }>
): {
  readonly message: string;
  readonly field: string;
} | null {
  for (const validator of validators) {
    const message = validator.validate();
    if (message !== null) {
      return {
        message,
        field: validator.field
      };
    }
  }

  return null;
}

function validateTraceMaintenancePayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  if (typeof payload["all"] !== "boolean") {
    return {
      message: "Observability IPC request payload.all must be a boolean.",
      field: "payload.all"
    };
  }

  if (
    Object.hasOwn(payload, "traceId") &&
    (typeof payload["traceId"] !== "string" || payload["traceId"].length === 0)
  ) {
    return {
      message: "Observability IPC request payload.traceId must be a non-empty string when present.",
      field: "payload.traceId"
    };
  }

  if (Object.hasOwn(payload, "batchSize") && !isPositiveInteger(payload["batchSize"])) {
    return {
      message: "Observability IPC request payload.batchSize must be a positive integer when present.",
      field: "payload.batchSize"
    };
  }

  const scopeMessage = validateTraceMaintenanceScope({
    all: payload["all"],
    traceId: typeof payload["traceId"] === "string" ? payload["traceId"] : undefined,
    batchSize: typeof payload["batchSize"] === "number" ? payload["batchSize"] : undefined
  });
  if (scopeMessage !== null) {
    return {
      message: `Observability IPC request trace maintenance scope is invalid: ${scopeMessage}.`,
      field: "payload"
    };
  }

  return null;
}

function validateBenchmarkPreflightResult(value: unknown): {
  readonly message: string;
  readonly field: string;
} | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC request payload.gatewayPreflight must be an object.",
      field: "payload.gatewayPreflight"
    };
  }

  const preflight = value;
  const commonError = firstValidationError([
    {
      field: "payload.gatewayPreflight.sourceFile",
      validate: () => assertRequiredString(preflight, "sourceFile")
    },
    {
      field: "payload.gatewayPreflight.sourcePath",
      validate: () => assertRequiredString(preflight, "sourcePath")
    },
    {
      field: "payload.gatewayPreflight.bindHost",
      validate: () => assertRequiredString(preflight, "bindHost")
    },
    {
      field: "payload.gatewayPreflight.probeHost",
      validate: () => assertRequiredString(preflight, "probeHost")
    }
  ]);
  if (commonError !== null) {
    return commonError;
  }

  if (preflight["pid"] !== null && !isNonNegativeInteger(preflight["pid"])) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.pid must be a non-negative integer or null.",
      field: "payload.gatewayPreflight.pid"
    };
  }

  if (preflight["latencyMs"] !== null && (!isFiniteNumber(preflight["latencyMs"]) || preflight["latencyMs"] < 0)) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.latencyMs must be a non-negative number or null.",
      field: "payload.gatewayPreflight.latencyMs"
    };
  }

  if (preflight["ok"] === true) {
    if (!isPositiveInteger(preflight["port"])) {
      return {
        message: "Observability IPC request payload.gatewayPreflight.port must be a positive integer.",
        field: "payload.gatewayPreflight.port"
      };
    }
    if (typeof preflight["healthUrl"] !== "string" || preflight["healthUrl"].length === 0) {
      return {
        message: "Observability IPC request payload.gatewayPreflight.healthUrl must be a non-empty string.",
        field: "payload.gatewayPreflight.healthUrl"
      };
    }

    return null;
  }

  if (preflight["ok"] !== false) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.ok must be a boolean.",
      field: "payload.gatewayPreflight.ok"
    };
  }

  if (preflight["code"] !== "invalid_config" && preflight["code"] !== "gateway_unavailable") {
    return {
      message: "Observability IPC request payload.gatewayPreflight.code must be invalid_config or gateway_unavailable.",
      field: "payload.gatewayPreflight.code"
    };
  }
  if (typeof preflight["message"] !== "string" || preflight["message"].length === 0) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.message must be a non-empty string.",
      field: "payload.gatewayPreflight.message"
    };
  }
  if (preflight["port"] !== null && !isPositiveInteger(preflight["port"])) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.port must be a positive integer or null.",
      field: "payload.gatewayPreflight.port"
    };
  }
  if (
    preflight["healthUrl"] !== null &&
    (typeof preflight["healthUrl"] !== "string" || preflight["healthUrl"].length === 0)
  ) {
    return {
      message: "Observability IPC request payload.gatewayPreflight.healthUrl must be a non-empty string or null.",
      field: "payload.gatewayPreflight.healthUrl"
    };
  }

  return null;
}

function validateBenchmarkRunPayload(
  payload: Record<string, unknown>,
  transport: ObservabilityIpcTransportMode
): {
  readonly message: string;
  readonly field: string;
} | null {
  const baseError = firstValidationError([
    {
      field: "payload.config",
      validate: () => assertRequiredObject(payload, "config")
    },
    {
      field: "payload.routeNames",
      validate: () => {
        if (!isNonEmptyStringArray(payload["routeNames"])) {
          return "Observability IPC request payload.routeNames must be a non-empty string array.";
        }

        return null;
      }
    },
    {
      field: "payload.prompt",
      validate: () => assertRequiredString(payload, "prompt")
    },
    {
      field: "payload.iterations",
      validate: () => {
        if (!isPositiveInteger(payload["iterations"])) {
          return "Observability IPC request payload.iterations must be a positive integer.";
        }

        return null;
      }
    },
    {
      field: "payload.warmup",
      validate: () => {
        if (!isNonNegativeInteger(payload["warmup"])) {
          return "Observability IPC request payload.warmup must be a non-negative integer.";
        }

        return null;
      }
    },
    {
      field: "payload.concurrency",
      validate: () => {
        if (!isPositiveInteger(payload["concurrency"])) {
          return "Observability IPC request payload.concurrency must be a positive integer.";
        }

        return null;
      }
    },
    {
      field: "payload.pathMode",
      validate: () => {
        if (typeof payload["pathMode"] !== "string" || !isBenchPathModeValue(payload["pathMode"])) {
          return "Observability IPC request payload.pathMode must be one of: gateway, direct, both.";
        }

        return null;
      }
    },
    {
      field: "payload.createdBy",
      validate: () => assertRequiredString(payload, "createdBy")
    },
    {
      field: "payload.objective",
      validate: () => assertRequiredString(payload, "objective")
    },
    {
      field: "payload.taskPlanCommandName",
      validate: () => assertRequiredKnownString(payload, "taskPlanCommandName", [
        "bench",
        "bench_run",
        "optimize",
        "optimize_run"
      ])
    }
  ]);
  if (baseError !== null) {
    return baseError;
  }

  if (transport === "local") {
    const preflightMessage = assertRequiredFunction(payload, "preflightGateway");
    return preflightMessage === null
      ? null
      : {
          message: preflightMessage,
          field: "payload.preflightGateway"
        };
  }

  if (Object.hasOwn(payload, "preflightGateway")) {
    return {
      message: "Observability IPC request payload.preflightGateway is local-only; use payload.gatewayPreflight for external transport.",
      field: "payload.preflightGateway"
    };
  }

  return validateBenchmarkPreflightResult(payload["gatewayPreflight"]);
}

function validateOptimizeReferenceTokens(value: unknown, field: string): string | null {
  if (!isRecord(value)) {
    return `Observability IPC request ${field} must be an object.`;
  }

  for (const tokenField of ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"]) {
    if (!isNonNegativeInteger(value[tokenField])) {
      return `Observability IPC request ${field}.${tokenField} must be a non-negative integer.`;
    }
  }

  return null;
}

function validateOptimizeReport(value: unknown, objective: "cost" | "latency"): {
  readonly message: string;
  readonly field: string;
} | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC request payload.report must be an object.",
      field: "payload.report"
    };
  }

  const report = value;
  if (!isRecord(report["run"])) {
    return {
      message: "Observability IPC request payload.report.run must be an object.",
      field: "payload.report.run"
    };
  }

  const run = report["run"];
  if (run["objective"] !== objective) {
    return {
      message: `Observability IPC request payload.report.run.objective must be ${objective}.`,
      field: "payload.report.run.objective"
    };
  }

  if (typeof run["target_model"] !== "string" || run["target_model"].length === 0) {
    return {
      message: "Observability IPC request payload.report.run.target_model must be a non-empty string.",
      field: "payload.report.run.target_model"
    };
  }

  if (
    typeof run["status"] !== "string" ||
    !OPTIMIZATION_RUN_STATUSES.some((status) => status === run["status"])
  ) {
    return {
      message: "Observability IPC request payload.report.run.status must be a known optimization status.",
      field: "payload.report.run.status"
    };
  }

  if (!isRecord(report["candidates"])) {
    return {
      message: "Observability IPC request payload.report.candidates must be an object.",
      field: "payload.report.candidates"
    };
  }

  const candidates = report["candidates"];
  if (
    candidates["requested_routes"] !== null &&
    Object.hasOwn(candidates, "requested_routes") &&
    !isNonEmptyStringArray(candidates["requested_routes"])
  ) {
    return {
      message:
        "Observability IPC request payload.report.candidates.requested_routes must be null or a non-empty string array.",
      field: "payload.report.candidates.requested_routes"
    };
  }

  if (!isStringArray(candidates["resolved_routes"])) {
    return {
      message: "Observability IPC request payload.report.candidates.resolved_routes must be a string array.",
      field: "payload.report.candidates.resolved_routes"
    };
  }

  if (!Array.isArray(candidates["disqualified"])) {
    return {
      message: "Observability IPC request payload.report.candidates.disqualified must be an array.",
      field: "payload.report.candidates.disqualified"
    };
  }

  const tokenError = validateOptimizeReferenceTokens(report["reference_tokens"], "payload.report.reference_tokens");
  if (tokenError !== null) {
    return {
      message: tokenError,
      field: "payload.report.reference_tokens"
    };
  }

  if (!Array.isArray(report["ranking"])) {
    return {
      message: "Observability IPC request payload.report.ranking must be an array.",
      field: "payload.report.ranking"
    };
  }

  if (!isRecord(report["winner"])) {
    return {
      message: "Observability IPC request payload.report.winner must be an object.",
      field: "payload.report.winner"
    };
  }

  const winner = report["winner"];
  if (typeof winner["route_id"] !== "string" || winner["route_id"].length === 0) {
    return {
      message: "Observability IPC request payload.report.winner.route_id must be a non-empty string.",
      field: "payload.report.winner.route_id"
    };
  }

  if (!isFiniteNumber(winner["score"])) {
    return {
      message: "Observability IPC request payload.report.winner.score must be a finite number.",
      field: "payload.report.winner.score"
    };
  }

  if (winner["score_unit"] !== "usd" && winner["score_unit"] !== "ms") {
    return {
      message: "Observability IPC request payload.report.winner.score_unit must be usd or ms.",
      field: "payload.report.winner.score_unit"
    };
  }

  if (!isStringArray(winner["tied_with"])) {
    return {
      message: "Observability IPC request payload.report.winner.tied_with must be a string array.",
      field: "payload.report.winner.tied_with"
    };
  }

  if (!Array.isArray(report["warnings"])) {
    return {
      message: "Observability IPC request payload.report.warnings must be an array.",
      field: "payload.report.warnings"
    };
  }

  return null;
}

function validateOptimizeCandidateRoutes(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return "Observability IPC request payload.candidateRoutes must be an array.";
  }

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      return "Observability IPC request payload.candidateRoutes must contain objects.";
    }

    for (const field of ["name", "model", "service_provider", "provider_model_id", "api_mode"]) {
      if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
        return `Observability IPC request payload.candidateRoutes[].${field} must be a non-empty string.`;
      }
    }
  }

  return null;
}

function validateOptimizationReportPersistPayload(
  payload: Record<string, unknown>,
  objective: "cost" | "latency"
): {
  readonly message: string;
  readonly field: string;
} | null {
  const reportError = validateOptimizeReport(payload["report"], objective);
  if (reportError !== null) {
    return reportError;
  }

  const baseError = firstValidationError([
    {
      field: "payload.candidateRoutes",
      validate: () => validateOptimizeCandidateRoutes(payload["candidateRoutes"])
    },
    {
      field: "payload.requestedRoutes",
      validate: () => assertNullableStringArray(payload, "requestedRoutes")
    },
    {
      field: "payload.createdBy",
      validate: () => assertRequiredString(payload, "createdBy")
    },
    {
      field: "payload.runId",
      validate: () => assertOptionalString(payload, "runId")
    },
    {
      field: "payload.now",
      validate: () => assertOptionalDate(payload, "now")
    }
  ]);
  if (baseError !== null) {
    return baseError;
  }

  if (objective === "cost") {
    const tokenError = validateOptimizeReferenceTokens(payload["referenceTokens"], "payload.referenceTokens");
    if (tokenError !== null) {
      return {
        message: tokenError,
        field: "payload.referenceTokens"
      };
    }

    return null;
  }

  return firstValidationError([
    {
      field: "payload.benchmarkRunId",
      validate: () => assertRequiredString(payload, "benchmarkRunId")
    },
    {
      field: "payload.settings",
      validate: () => assertRequiredObject(payload, "settings")
    }
  ]);
}

function validateOptimizeMutationCommonPayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  return firstValidationError([
    {
      field: "payload.configPath",
      validate: () => {
        if (
          Object.hasOwn(payload, "configPath") &&
          typeof payload["configPath"] !== "undefined" &&
          (typeof payload["configPath"] !== "string" || payload["configPath"].length === 0)
        ) {
          return "Observability IPC request payload.configPath must be undefined or a non-empty string.";
        }

        return null;
      }
    },
    {
      field: "payload.readModel",
      validate: () => assertRequiredObject(payload, "readModel")
    },
    {
      field: "payload.loadReadModel",
      validate: () => assertRequiredFunction(payload, "loadReadModel")
    },
    {
      field: "payload.mutateConfigDocument",
      validate: () => assertRequiredFunction(payload, "mutateConfigDocument")
    },
    {
      field: "payload.getMutableConfigSection",
      validate: () => assertRequiredFunction(payload, "getMutableConfigSection")
    },
    {
      field: "payload.sourceSurface",
      validate: () => assertRequiredKnownString(payload, "sourceSurface", OPTIMIZE_MUTATION_SOURCE_SURFACES)
    },
    {
      field: "payload.createdBy",
      validate: () => assertRequiredString(payload, "createdBy")
    },
    {
      field: "payload.actorKind",
      validate: () => assertRequiredKnownString(payload, "actorKind", CONTROL_PLANE_AUDIT_ACTOR_KINDS)
    },
    {
      field: "payload.actorId",
      validate: () => assertOptionalNullableString(payload, "actorId")
    },
    {
      field: "payload.sessionId",
      validate: () => assertOptionalNullableString(payload, "sessionId")
    },
    {
      field: "payload.dryRun",
      validate: () => assertRequiredBoolean(payload, "dryRun")
    },
    {
      field: "payload.metadata",
      validate: () => assertOptionalObject(payload, "metadata")
    },
    {
      field: "payload.deferLedgerCompletion",
      validate: () => assertOptionalBoolean(payload, "deferLedgerCompletion")
    }
  ]);
}

function validateOptimizeRestoreSelector(value: unknown): {
  readonly message: string;
  readonly field: string;
} | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC request payload.selector must be an object.",
      field: "payload.selector"
    };
  }

  if (value["mode"] === "action") {
    if (typeof value["actionId"] !== "string" || value["actionId"].length === 0) {
      return {
        message: "Observability IPC request payload.selector.actionId must be a non-empty string.",
        field: "payload.selector.actionId"
      };
    }

    return null;
  }

  if (value["mode"] === "run_route") {
    if (typeof value["runId"] !== "string" || value["runId"].length === 0) {
      return {
        message: "Observability IPC request payload.selector.runId must be a non-empty string.",
        field: "payload.selector.runId"
      };
    }
    if (typeof value["routeId"] !== "string" || value["routeId"].length === 0) {
      return {
        message: "Observability IPC request payload.selector.routeId must be a non-empty string.",
        field: "payload.selector.routeId"
      };
    }

    return null;
  }

  return {
    message: "Observability IPC request payload.selector.mode must be action or run_route.",
    field: "payload.selector.mode"
  };
}

function assertOptionalJsonSafeObject(payload: Record<string, unknown>, field: string): string | null {
  if (!Object.hasOwn(payload, field)) {
    return null;
  }

  if (!isRecord(payload[field])) {
    return `Observability IPC request payload.${field} must be an object when present.`;
  }

  const runtimeField = nonJsonRuntimeValueField(payload[field], `payload.${field}`);
  if (runtimeField !== null) {
    return `Observability IPC request ${runtimeField} must be JSON-serializable.`;
  }

  return null;
}

function validateExternalOptimizeMutationCatalogContext(value: unknown): {
  readonly message: string;
  readonly field: string;
} | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC request payload.catalog must be an object.",
      field: "payload.catalog"
    };
  }

  const catalog = value;
  const commonError = firstValidationError([
    {
      field: "payload.catalog.kind",
      validate: () => assertRequiredKnownString(catalog, "kind", ["catalog_snapshot", "narrowed_command_context"])
    },
    {
      field: "payload.catalog.catalogRevision",
      validate: () => assertOptionalNullableString(catalog, "catalogRevision")
    },
    {
      field: "payload.catalog.document",
      validate: () => assertOptionalJsonSafeObject(catalog, "document")
    },
    {
      field: "payload.catalog.targetRoute",
      validate: () => assertOptionalJsonSafeObject(catalog, "targetRoute")
    },
    {
      field: "payload.catalog.winningRoute",
      validate: () => assertOptionalJsonSafeObject(catalog, "winningRoute")
    },
    {
      field: "payload.catalog.restorePoint",
      validate: () => assertOptionalJsonSafeObject(catalog, "restorePoint")
    },
    {
      field: "payload.catalog.providerAuth",
      validate: () => assertOptionalJsonSafeObject(catalog, "providerAuth")
    }
  ]);
  if (commonError !== null) {
    return commonError;
  }

  if (catalog["kind"] === "catalog_snapshot" && !isRecord(catalog["document"])) {
    return {
      message: "Observability IPC request payload.catalog.document must be an object for catalog_snapshot.",
      field: "payload.catalog.document"
    };
  }

  if (catalog["kind"] === "narrowed_command_context" && !isRecord(catalog["targetRoute"])) {
    return {
      message: "Observability IPC request payload.catalog.targetRoute must be an object for narrowed_command_context.",
      field: "payload.catalog.targetRoute"
    };
  }

  return null;
}

function validateExternalOptimizeMutationCompletion(value: unknown): {
  readonly message: string;
  readonly field: string;
} | null {
  if (!isRecord(value)) {
    return {
      message: "Observability IPC request payload.completion must be an object when present.",
      field: "payload.completion"
    };
  }

  const completion = value;
  return firstValidationError([
    {
      field: "payload.completion.reload",
      validate: () => {
        if (!Object.hasOwn(completion, "reload")) {
          return null;
        }

        if (completion["reload"] !== null && !isRecord(completion["reload"])) {
          return "Observability IPC request payload.completion.reload must be an object or null when present.";
        }

        const runtimeField = nonJsonRuntimeValueField(completion["reload"], "payload.completion.reload");
        return runtimeField === null ? null : `Observability IPC request ${runtimeField} must be JSON-serializable.`;
      }
    },
    {
      field: "payload.completion.verification",
      validate: () => {
        if (!Object.hasOwn(completion, "verification")) {
          return null;
        }

        if (completion["verification"] !== null && !isRecord(completion["verification"])) {
          return "Observability IPC request payload.completion.verification must be an object or null when present.";
        }

        const runtimeField = nonJsonRuntimeValueField(completion["verification"], "payload.completion.verification");
        return runtimeField === null ? null : `Observability IPC request ${runtimeField} must be JSON-serializable.`;
      }
    },
    {
      field: "payload.completion.warnings",
      validate: () => {
        if (Object.hasOwn(completion, "warnings") && !isStringArray(completion["warnings"])) {
          return "Observability IPC request payload.completion.warnings must be a string array when present.";
        }

        return null;
      }
    },
    {
      field: "payload.completion.includePostActionResult",
      validate: () => assertOptionalBoolean(completion, "includePostActionResult")
    }
  ]);
}

function validateExternalOptimizeMutationCommonCommand(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  const runtimeField = nonJsonRuntimeValueField(payload, "payload");
  if (runtimeField !== null) {
    return {
      message: `Observability IPC request ${runtimeField} must be JSON-serializable.`,
      field: runtimeField
    };
  }

  const commonError = firstValidationError([
    {
      field: "payload.idempotencyKey",
      validate: () => assertRequiredString(payload, "idempotencyKey")
    },
    {
      field: "payload.dryRun",
      validate: () => assertRequiredBoolean(payload, "dryRun")
    },
    {
      field: "payload.reload",
      validate: () => assertRequiredBoolean(payload, "reload")
    },
    {
      field: "payload.verify",
      validate: () => assertRequiredBoolean(payload, "verify")
    },
    {
      field: "payload.createdBy",
      validate: () => assertRequiredString(payload, "createdBy")
    },
    {
      field: "payload.sourceSurface",
      validate: () => assertRequiredKnownString(payload, "sourceSurface", OPTIMIZE_MUTATION_SOURCE_SURFACES)
    },
    {
      field: "payload.actorKind",
      validate: () => assertRequiredKnownString(payload, "actorKind", CONTROL_PLANE_AUDIT_ACTOR_KINDS)
    },
    {
      field: "payload.actorId",
      validate: () => assertOptionalNullableString(payload, "actorId")
    },
    {
      field: "payload.sessionId",
      validate: () => assertOptionalNullableString(payload, "sessionId")
    },
    {
      field: "payload.metadata",
      validate: () => assertOptionalJsonSafeObject(payload, "metadata")
    }
  ]);
  if (commonError !== null) {
    return commonError;
  }

  const catalogError = validateExternalOptimizeMutationCatalogContext(payload["catalog"]);
  if (catalogError !== null) {
    return catalogError;
  }

  if (Object.hasOwn(payload, "completion")) {
    return validateExternalOptimizeMutationCompletion(payload["completion"]);
  }

  return null;
}

function validateExternalOptimizeApplyCommandPayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  const commonError = validateExternalOptimizeMutationCommonCommand(payload);
  if (commonError !== null) {
    return commonError;
  }

  return firstValidationError([
    {
      field: "payload.runId",
      validate: () => assertRequiredString(payload, "runId")
    },
    {
      field: "payload.targetRouteId",
      validate: () => assertRequiredString(payload, "targetRouteId")
    }
  ]);
}

function validateExternalOptimizeRestoreCommandPayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  const commonError = validateExternalOptimizeMutationCommonCommand(payload);
  if (commonError !== null) {
    return commonError;
  }

  const hasActionId = Object.hasOwn(payload, "actionId");
  const hasRunId = Object.hasOwn(payload, "runId");
  const hasTargetRouteId = Object.hasOwn(payload, "targetRouteId");

  if (hasActionId && (hasRunId || hasTargetRouteId)) {
    return {
      message: "Observability IPC request payload.actionId is mutually exclusive with payload.runId and payload.targetRouteId.",
      field: "payload.actionId"
    };
  }

  if (hasActionId) {
    return assertRequiredString(payload, "actionId") === null
      ? null
      : {
          message: "Observability IPC request payload.actionId must be a non-empty string.",
          field: "payload.actionId"
        };
  }

  const selectorError = firstValidationError([
    {
      field: "payload.runId",
      validate: () => assertRequiredString(payload, "runId")
    },
    {
      field: "payload.targetRouteId",
      validate: () => assertRequiredString(payload, "targetRouteId")
    }
  ]);
  if (selectorError !== null) {
    return selectorError;
  }

  return null;
}

export function validateObservabilityExternalOptimizeApplyCommand(
  value: unknown
): ObservabilityExternalOptimizeMutationCommandValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: {
        message: "Observability IPC request payload must be an object.",
        field: "payload"
      }
    };
  }

  const error = validateExternalOptimizeApplyCommandPayload(value);
  if (error !== null) {
    return {
      ok: false,
      error
    };
  }

  return {
    ok: true,
    command: value as unknown as ObservabilityExternalOptimizeApplyCommand
  };
}

export function validateObservabilityExternalOptimizeRestoreCommand(
  value: unknown
): ObservabilityExternalOptimizeMutationCommandValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: {
        message: "Observability IPC request payload must be an object.",
        field: "payload"
      }
    };
  }

  const error = validateExternalOptimizeRestoreCommandPayload(value);
  if (error !== null) {
    return {
      ok: false,
      error
    };
  }

  return {
    ok: true,
    command: value as unknown as ObservabilityExternalOptimizeRestoreCommand
  };
}

function validateOptimizeMutationPayload(
  payload: Record<string, unknown>,
  kind: "apply" | "restore"
): {
  readonly message: string;
  readonly field: string;
} | null {
  const commonError = validateOptimizeMutationCommonPayload(payload);
  if (commonError !== null) {
    return commonError;
  }

  if (kind === "apply") {
    return firstValidationError([
      {
        field: "payload.runId",
        validate: () => assertRequiredString(payload, "runId")
      },
      {
        field: "payload.targetRouteId",
        validate: () => assertRequiredString(payload, "targetRouteId")
      }
    ]);
  }

  return validateOptimizeRestoreSelector(payload["selector"]);
}

function validateControlPlaneAuditStartPayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  return firstValidationError([
    {
      field: "payload.sourceSurface",
      validate: () =>
        assertRequiredKnownString(payload, "sourceSurface", CONTROL_PLANE_ACTION_SOURCE_SURFACES)
    },
    {
      field: "payload.operation",
      validate: () => assertRequiredKnownString(payload, "operation", CONTROL_PLANE_ACTION_OPERATIONS)
    },
    {
      field: "payload.targetKind",
      validate: () => assertRequiredKnownString(payload, "targetKind", CONTROL_PLANE_ACTION_TARGET_KINDS)
    },
    {
      field: "payload.targetId",
      validate: () => assertOptionalNullableString(payload, "targetId")
    },
    {
      field: "payload.createdBy",
      validate: () => assertRequiredString(payload, "createdBy")
    },
    {
      field: "payload.actorKind",
      validate: () => assertRequiredKnownString(payload, "actorKind", CONTROL_PLANE_AUDIT_ACTOR_KINDS)
    },
    {
      field: "payload.sessionId",
      validate: () => assertOptionalNullableString(payload, "sessionId")
    },
    {
      field: "payload.metadata",
      validate: () => assertOptionalObject(payload, "metadata")
    }
  ]);
}

function validateControlPlaneAuditFinishPayload(payload: Record<string, unknown>): {
  readonly message: string;
  readonly field: string;
} | null {
  const baseError = firstValidationError([
    {
      field: "payload.actionId",
      validate: () => assertOptionalNullableString(payload, "actionId")
    },
    {
      field: "payload.status",
      validate: () => assertRequiredKnownString(payload, "status", CONTROL_PLANE_AUDIT_FINISH_STATUSES)
    },
    {
      field: "payload.targetId",
      validate: () => assertOptionalNullableString(payload, "targetId")
    },
    {
      field: "payload.result",
      validate: () => assertOptionalObject(payload, "result")
    },
    {
      field: "payload.metadata",
      validate: () => assertOptionalObject(payload, "metadata")
    }
  ]);
  if (baseError !== null) {
    return baseError;
  }

  if (Object.hasOwn(payload, "error")) {
    if (!isRecord(payload["error"])) {
      return {
        message: "Observability IPC request payload.error must be an object when present.",
        field: "payload.error"
      };
    }

    const error = payload["error"];
    if (typeof error["code"] !== "string" || error["code"].length === 0) {
      return {
        message: "Observability IPC request payload.error.code must be a non-empty string.",
        field: "payload.error.code"
      };
    }
    if (typeof error["message"] !== "string" || error["message"].length === 0) {
      return {
        message: "Observability IPC request payload.error.message must be a non-empty string.",
        field: "payload.error.message"
      };
    }
  }

  return null;
}

function validateExternalTransportPayload(value: Record<string, unknown>): ObservabilityIpcInvalidFrame | null {
  const operation = value["operation"];
  const payload = value["payload"];
  if (!isRecord(payload) || !isObservabilityIpcOperation(operation)) {
    return null;
  }

  const functionFieldByOperation: Partial<Record<string, readonly string[]>> = {
    "benchmarkRuns.run": ["preflightGateway"],
    "optimizeMutations.apply": ["loadReadModel", "mutateConfigDocument", "getMutableConfigSection"],
    "optimizeMutations.restore": ["loadReadModel", "mutateConfigDocument", "getMutableConfigSection"]
  };

  for (const field of functionFieldByOperation[operation] ?? []) {
    if (typeof payload[field] === "function") {
      return invalidFrame(
        value,
        `Observability IPC external transport payload.${field} must be transport-safe data, not a function.`,
        {
          field: `payload.${field}`,
          operation,
          transport: "external"
        }
      );
    }
  }

  const runtimeField = nonJsonRuntimeValueField(payload, "payload");
  if (runtimeField !== null) {
    return invalidFrame(value, `Observability IPC external transport ${runtimeField} must be JSON-serializable.`, {
      field: runtimeField,
      operation,
      transport: "external"
    });
  }

  return null;
}

function validateOperationPayload(
  value: Record<string, unknown>,
  transport: ObservabilityIpcTransportMode
): ObservabilityIpcInvalidFrame | null {
  const operation = value["operation"];
  const payload = value["payload"];
  if (!isRecord(payload) || !isObservabilityIpcOperation(operation)) {
    return null;
  }

  if (
    transport === "external" &&
    (operation === "optimizeMutations.apply" || operation === "optimizeMutations.restore")
  ) {
    return invalidFrame(
      value,
      `Observability IPC external transport does not support ${operation} until the config mutation command contract exists.`,
      {
        field: "operation",
        operation,
        transport: "external"
      }
    );
  }

  let message: string | null = null;
  let field = "payload";

  switch (operation) {
    case "trace.list":
    case "trace.listObservations":
    case "trace.getStats":
    case "ledger.list":
      message = assertOptionalObject(payload, "filters");
      field = "payload.filters";
      break;
    case "trace.show":
      message = assertRequiredString(payload, "traceId");
      field = "payload.traceId";
      break;
    case "trace.verify":
    case "trace.repair": {
      const maintenanceError = validateTraceMaintenancePayload(payload);
      if (maintenanceError !== null) {
        message = maintenanceError.message;
        field = maintenanceError.field;
      }
      break;
    }
    case "retention.pruneOlderThan":
    case "benchmarkHistory.pruneOlderThan":
    case "optimizationHistory.pruneOlderThan":
      message = assertRequiredCutoffIso(payload);
      field = "payload.cutoffIso";
      break;
    case "ledger.show":
      message = assertRequiredString(payload, "ledgerEventId");
      field = "payload.ledgerEventId";
      break;
    case "benchmarkHistory.list":
    case "optimizationHistory.list":
      message = assertRequiredPositiveLimit(payload);
      field = "payload.limit";
      break;
    case "benchmarkHistory.show":
      message = assertRequiredString(payload, "runId");
      field = "payload.runId";
      break;
    case "benchmarkHistory.deleteRun":
      message = assertRequiredString(payload, "runId");
      field = "payload.runId";
      break;
    case "benchmarkHistory.clear":
    case "optimizationHistory.clear":
      message = assertEmptyPayload(payload);
      break;
    case "optimizationHistory.show":
      message = assertRequiredString(payload, "runId");
      field = "payload.runId";
      break;
    case "optimizationHistory.deleteRun":
      message = assertRequiredString(payload, "runId");
      field = "payload.runId";
      break;
    case "controlPlaneAudit.startConfigMutation": {
      const auditError = validateControlPlaneAuditStartPayload(payload);
      if (auditError !== null) {
        message = auditError.message;
        field = auditError.field;
      }
      break;
    }
    case "controlPlaneAudit.finishConfigMutation": {
      const auditError = validateControlPlaneAuditFinishPayload(payload);
      if (auditError !== null) {
        message = auditError.message;
        field = auditError.field;
      }
      break;
    }
    case "benchmarkRuns.run": {
      const benchmarkError = validateBenchmarkRunPayload(payload, transport);
      if (benchmarkError !== null) {
        message = benchmarkError.message;
        field = benchmarkError.field;
      }
      break;
    }
    case "optimizationReports.persistCost":
    case "optimizationReports.persistLatency": {
      const reportError = validateOptimizationReportPersistPayload(
        payload,
        operation === "optimizationReports.persistCost" ? "cost" : "latency"
      );
      if (reportError !== null) {
        message = reportError.message;
        field = reportError.field;
      }
      break;
    }
    case "optimizeMutations.apply":
    case "optimizeMutations.restore": {
      const mutationError = validateOptimizeMutationPayload(
        payload,
        operation === "optimizeMutations.apply" ? "apply" : "restore"
      );
      if (mutationError !== null) {
        message = mutationError.message;
        field = mutationError.field;
      }
      break;
    }
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }

  if (message === null) {
    return null;
  }

  return invalidFrame(value, message, {
    field,
    operation
  });
}

export function validateObservabilityIpcRequest(
  value: unknown,
  options: ObservabilityIpcRequestValidationOptions = {}
): ObservabilityIpcRequestValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request must be an object.", {
        field: "request"
      })
    };
  }

  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request id must be a non-empty string.", {
        field: "id"
      })
    };
  }

  if (!isObservabilityIpcOperation(value["operation"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request operation is not supported.", {
        field: "operation",
        operation: value["operation"]
      })
    };
  }

  if (typeof value["contract_version"] !== "string") {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request contract_version must be a string.", {
        field: "contract_version"
      })
    };
  }

  if (value["contract_version"] !== OBSERVABILITY_IPC_CONTRACT_VERSION) {
    return {
      ok: false,
      error: invalidFrame(value, `Unsupported observability IPC contract version: ${value["contract_version"]}`, {
        field: "contract_version",
        operation: value["operation"],
        supportedContractVersion: OBSERVABILITY_IPC_CONTRACT_VERSION,
        receivedContractVersion: value["contract_version"]
      })
    };
  }

  const store = value["store"];
  if (!isRecord(store)) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request store must be an object.", {
        field: "store"
      })
    };
  }

  if (typeof store["dbPath"] !== "string" || store["dbPath"].length === 0) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request store.dbPath must be a non-empty string.", {
        field: "store.dbPath"
      })
    };
  }

  if (!path.isAbsolute(store["dbPath"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request store.dbPath must be absolute.", {
        field: "store.dbPath"
      })
    };
  }

  if (!isRecord(value["payload"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC request payload must be an object.", {
        field: "payload",
        operation: value["operation"]
      })
    };
  }

  const operationPayloadError = validateOperationPayload(value, options.transport ?? "local");
  if (operationPayloadError !== null) {
    return {
      ok: false,
      error: operationPayloadError
    };
  }

  if (options.transport === "external") {
    const externalTransportError = validateExternalTransportPayload(value);
    if (externalTransportError !== null) {
      return {
        ok: false,
        error: externalTransportError
      };
    }
  }

  return {
    ok: true,
    request: value as ObservabilityIpcRequest
  };
}

export function validateObservabilityIpcResponse(value: unknown): ObservabilityIpcResponseValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC response must be an object.", {
        field: "response"
      })
    };
  }

  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC response id must be a non-empty string.", {
        field: "id"
      })
    };
  }

  if (!isStringArray(value["warnings"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC response warnings must be an array of strings.", {
        field: "warnings"
      })
    };
  }

  if (value["ok"] === true) {
    if (!Object.hasOwn(value, "result")) {
      return {
        ok: false,
        error: invalidFrame(value, "Observability IPC success response must include result.", {
          field: "result"
        })
      };
    }

    return {
      ok: true,
      response: value as ObservabilityIpcResponse
    };
  }

  if (value["ok"] !== false) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC response ok must be a boolean.", {
        field: "ok"
      })
    };
  }

  const error = value["error"];
  if (!isRecord(error)) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC error response must include an error object.", {
        field: "error"
      })
    };
  }

  if (!isObservabilityIpcErrorCode(error["code"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC error response code is not supported.", {
        field: "error.code",
        code: error["code"]
      })
    };
  }

  if (typeof error["message"] !== "string" || error["message"].length === 0) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC error response message must be a non-empty string.", {
        field: "error.message"
      })
    };
  }

  if (typeof error["retryable"] !== "boolean") {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC error response retryable must be a boolean.", {
        field: "error.retryable"
      })
    };
  }

  if (Object.hasOwn(error, "details") && !isRecord(error["details"])) {
    return {
      ok: false,
      error: invalidFrame(value, "Observability IPC error response details must be an object when present.", {
        field: "error.details"
      })
    };
  }

  return {
    ok: true,
    response: value as ObservabilityIpcResponse
  };
}
