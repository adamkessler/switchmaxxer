import {
  buildMcpConfigSchemaMetadata,
  buildModelFieldMetadata,
  buildProviderFieldMetadata,
  buildRouteFieldMetadata,
  MCP_ENTITY_STATE_ERROR_CODES
} from "../config/config-metadata";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { loadConfigShowData } from "./config-runtime";
import { buildProviderView, buildRouteView } from "./helpers";
import {
  parseModelsShowArgs,
  parseProvidersShowArgs,
  parseRoutesShowArgs
} from "./parsers";
import { buildMcpErrorEnvelope, type McpErrorEnvelope, type McpSuccessEnvelope } from "./envelope";
import type { McpToolContext } from "./tool-context";

export function buildConfigSchemaToolPayload(): McpSuccessEnvelope {
  return buildSuccessEnvelope("config schema", buildMcpConfigSchemaMetadata());
}

export function buildConfigShowToolPayload(configPath?: string): McpSuccessEnvelope {
  return buildSuccessEnvelope("config show", loadConfigShowData(configPath));
}

export function buildModelsListToolPayload(context: McpToolContext): McpSuccessEnvelope {
  const readModel = context.getReadModel();
  return buildSuccessEnvelope("models list", readModel.models, {
    count: readModel.models.length
  });
}

export function buildModelsShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const { modelId } = parseModelsShowArgs(context.params);
  const model = context.getReadModel().modelsByName[modelId];

  if (!model) {
    return buildMcpErrorEnvelope("models show", MCP_ENTITY_STATE_ERROR_CODES.modelNotFound, `Model '${modelId}' was not found`);
  }

  return buildSuccessEnvelope("models show", model, {
    editability: buildModelFieldMetadata()
  });
}

export function buildProvidersListToolPayload(context: McpToolContext): McpSuccessEnvelope {
  const providers = context.getReadModel().providers.map((provider) => buildProviderView(provider));
  return buildSuccessEnvelope("providers list", providers, {
    count: providers.length
  });
}

export function buildProvidersShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const { providerId } = parseProvidersShowArgs(context.params);
  const provider = context.getReadModel().providersByName[providerId];

  if (!provider) {
    return buildMcpErrorEnvelope(
      "providers show",
      MCP_ENTITY_STATE_ERROR_CODES.providerNotFound,
      `Provider '${providerId}' was not found`
    );
  }

  return buildSuccessEnvelope("providers show", buildProviderView(provider), {
    editability: buildProviderFieldMetadata()
  });
}

export function buildRoutesListToolPayload(context: McpToolContext): McpSuccessEnvelope {
  const routes = context.getReadModel().routes.map((route) => buildRouteView(route));
  return buildSuccessEnvelope("routes list", routes, {
    count: routes.length
  });
}

export function buildRoutesShowToolPayload(context: McpToolContext): McpSuccessEnvelope | McpErrorEnvelope {
  const { routeId } = parseRoutesShowArgs(context.params, "routes_show");
  const route = context.getReadModel().routesByName[routeId];

  if (!route) {
    return buildMcpErrorEnvelope("routes show", MCP_ENTITY_STATE_ERROR_CODES.routeNotFound, `Route '${routeId}' was not found`);
  }

  return buildSuccessEnvelope("routes show", buildRouteView(route), {
    editability: buildRouteFieldMetadata()
  });
}
