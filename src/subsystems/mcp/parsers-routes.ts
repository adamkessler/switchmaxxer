import type { CostConfig } from "../../platform/types";
import { ROUTE_INPUT_SHAPES } from "../config/entity-input-shapes";
import {
  getOptionalPositiveInteger,
  getRequiredToolString,
  parseToolArgs,
  routeInputContract,
  hasOwnToolField
} from "./parsers-shared";

export type RoutesShowArgs = {
  routeId: string;
};

export type RoutesCreateArgs = {
  routeId: string;
  model: string;
  serviceProvider: string;
  providerModelId: string;
  displayName: string;
  timeoutMs?: number;
  cost: CostConfig | undefined;
};

export type RoutesUpdateArgs = {
  routeId: string;
  model?: string;
  serviceProvider?: string;
  providerModelId?: string;
  displayName?: string;
  timeoutMs?: number | null;
  cost: CostConfig | null | undefined;
};

export type RoutesDeleteArgs = {
  routeId: string;
};

export function parseRoutesShowArgs(
  params: unknown,
  toolName: "routes_show" | "routes_explain" | "routes_delete" = "routes_show"
): RoutesShowArgs {
  return parseToolArgs(params, {
    toolName,
    allowedFields: toolName === "routes_explain" ? ROUTE_INPUT_SHAPES.mcp.explain : ROUTE_INPUT_SHAPES.mcp.show,
    validate: (objectParams) => ({ routeId: getRequiredToolString(objectParams, "route_id", toolName) })
  });
}

export function parseRoutesCreateArgs(params: unknown): RoutesCreateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "routes_create",
    allowedFields: ROUTE_INPUT_SHAPES.mcp.create,
    validate: (validatedParams) => validatedParams
  });
  const normalized = routeInputContract.validateRouteCreateInput({
    name: objectParams["route_id"],
    model: objectParams["model"],
    serviceProvider: objectParams["service_provider"],
    providerModelId: objectParams["provider_model_id"],
    displayName: objectParams["display_name"],
    timeoutMs: getOptionalPositiveInteger(objectParams, "timeout_ms"),
    cost: objectParams["cost"],
    missingNameMessage: "Tool 'routes_create' requires non-empty 'route_id'.",
    missingModelMessage: "Tool 'routes_create' requires non-empty 'model'.",
    missingServiceProviderMessage: "Tool 'routes_create' requires non-empty 'service_provider'.",
    missingProviderModelIdMessage: "Tool 'routes_create' requires non-empty 'provider_model_id'.",
    missingDisplayNameMessage: "Tool 'routes_create' requires non-empty 'display_name'.",
    invalidNameMessage: "Tool 'routes_create' requires non-empty 'route_id'.",
    invalidModelMessage: "Tool 'routes_create' requires non-empty 'model'.",
    invalidServiceProviderMessage: "Tool 'routes_create' requires non-empty 'service_provider'.",
    invalidProviderModelIdMessage: "Tool 'routes_create' requires non-empty 'provider_model_id'.",
    invalidDisplayNameMessage: "Tool 'routes_create' requires non-empty 'display_name'.",
    invalidTimeoutMessage: "field 'timeout_ms' must be a positive integer",
    identifierLabel: "field 'route_id'",
    costFieldName: "field 'cost'"
  });
  return {
    routeId: normalized.name,
    model: normalized.model,
    serviceProvider: normalized.service_provider,
    providerModelId: normalized.provider_model_id,
    displayName: normalized.display_name,
    timeoutMs: normalized.timeout_ms,
    cost: normalized.cost
  };
}

export function parseRoutesUpdateArgs(params: unknown): RoutesUpdateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "routes_update",
    allowedFields: ROUTE_INPUT_SHAPES.mcp.update,
    validate: (validatedParams) => validatedParams
  });
  const timeoutMs = hasOwnToolField(objectParams, "timeout_ms")
    ? objectParams["timeout_ms"] === null
      ? null
      : getOptionalPositiveInteger(objectParams, "timeout_ms")
    : undefined;
  const normalized = routeInputContract.validateRouteUpdateInput({
    name: objectParams["route_id"],
    model: objectParams["model"],
    serviceProvider: objectParams["service_provider"],
    providerModelId: objectParams["provider_model_id"],
    displayName: objectParams["display_name"],
    timeoutMs,
    cost: objectParams["cost"],
    missingNameMessage: "Tool 'routes_update' requires non-empty 'route_id'.",
    invalidModelMessage: "field 'model' must be a non-empty string",
    invalidServiceProviderMessage: "field 'service_provider' must be a non-empty string",
    invalidProviderModelIdMessage: "field 'provider_model_id' must be a non-empty string",
    invalidDisplayNameMessage: "field 'display_name' must be a non-empty string",
    invalidTimeoutMessage: "field 'timeout_ms' must be a positive integer or null",
    identifierLabel: "field 'route_id'",
    costFieldName: "field 'cost'",
    missingUpdateFieldsMessage:
      "Provide at least one update field for 'routes update': 'model', 'service_provider', 'provider_model_id', 'display_name', 'timeout_ms', or 'cost'"
  });
  return {
    routeId: normalized.name,
    model: normalized.model,
    serviceProvider: normalized.service_provider,
    providerModelId: normalized.provider_model_id,
    displayName: normalized.display_name,
    timeoutMs: normalized.timeout_ms,
    cost: normalized.cost
  };
}

export function parseRoutesDeleteArgs(params: unknown): RoutesDeleteArgs {
  const { routeId } = parseToolArgs(params, {
    toolName: "routes_delete",
    allowedFields: ROUTE_INPUT_SHAPES.mcp.delete,
    validate: (objectParams) => ({ routeId: getRequiredToolString(objectParams, "route_id", "routes_delete") })
  });
  return { routeId };
}
