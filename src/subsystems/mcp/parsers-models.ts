import type { CostConfig } from "../../platform/types";
import { MODEL_INPUT_SHAPES } from "../config/entity-input-shapes";
import {
  getRequiredToolString,
  modelInputContract,
  parseToolArgs
} from "./parsers-shared";

export type ModelsShowArgs = {
  modelId: string;
};

export type ModelsCreateArgs = {
  modelId: string;
  displayName: string;
  modelCreator: string;
  cost: CostConfig | undefined;
  requestedModel: Record<string, unknown>;
};

export type ModelsUpdateArgs = {
  modelId: string;
  displayName?: string;
  modelCreator?: string;
  cost: CostConfig | null | undefined;
};

export type ModelsDeleteArgs = {
  modelId: string;
};

export function parseModelsShowArgs(params: unknown): ModelsShowArgs {
  return parseToolArgs(params, {
    toolName: "models_show",
    allowedFields: MODEL_INPUT_SHAPES.mcp.show,
    validate: (objectParams) => ({ modelId: getRequiredToolString(objectParams, "model_id", "models_show") })
  });
}

export function parseModelsCreateArgs(params: unknown): ModelsCreateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "models_create",
    allowedFields: MODEL_INPUT_SHAPES.mcp.create,
    validate: (validatedParams) => validatedParams
  });
  const normalized = modelInputContract.validateModelCreateInput({
    name: objectParams["model_id"],
    displayName: objectParams["display_name"],
    modelCreator: objectParams["model_creator"],
    cost: objectParams["cost"],
    missingNameMessage: "Tool 'models_create' requires non-empty 'model_id'.",
    missingDisplayNameMessage: "Tool 'models_create' requires non-empty 'display_name'.",
    missingModelCreatorMessage: "Tool 'models_create' requires non-empty 'model_creator'.",
    invalidNameMessage: "Tool 'models_create' requires non-empty 'model_id'.",
    invalidDisplayNameMessage: "Tool 'models_create' requires non-empty 'display_name'.",
    invalidModelCreatorMessage: "Tool 'models_create' requires non-empty 'model_creator'.",
    identifierLabel: "field 'model_id'",
    costFieldName: "field 'cost'"
  });

  return {
    modelId: normalized.name,
    displayName: normalized.display_name,
    modelCreator: normalized.model_creator,
    cost: normalized.cost,
    requestedModel: {
      display_name: normalized.display_name,
      model_creator: normalized.model_creator,
      ...(typeof normalized.cost === "undefined" ? {} : { cost: normalized.cost })
    }
  };
}

export function parseModelsUpdateArgs(params: unknown): ModelsUpdateArgs {
  const objectParams = parseToolArgs(params, {
    toolName: "models_update",
    allowedFields: MODEL_INPUT_SHAPES.mcp.update,
    validate: (validatedParams) => validatedParams
  });
  const normalized = modelInputContract.validateModelUpdateInput({
    name: objectParams["model_id"],
    displayName: objectParams["display_name"],
    modelCreator: objectParams["model_creator"],
    cost: objectParams["cost"],
    missingNameMessage: "Tool 'models_update' requires non-empty 'model_id'.",
    invalidDisplayNameMessage: "field 'display_name' must be a non-empty string",
    invalidModelCreatorMessage: "field 'model_creator' must be a non-empty string",
    identifierLabel: "field 'model_id'",
    costFieldName: "field 'cost'",
    missingUpdateFieldsMessage: "Provide at least one update field for 'models update': 'display_name', 'model_creator', or 'cost'"
  });

  return {
    modelId: normalized.name,
    displayName: normalized.display_name,
    modelCreator: normalized.model_creator,
    cost: normalized.cost
  };
}

export function parseModelsDeleteArgs(params: unknown): ModelsDeleteArgs {
  return parseToolArgs(params, {
    toolName: "models_delete",
    allowedFields: MODEL_INPUT_SHAPES.mcp.delete,
    validate: (objectParams) => ({ modelId: getRequiredToolString(objectParams, "model_id", "models_delete") })
  });
}
