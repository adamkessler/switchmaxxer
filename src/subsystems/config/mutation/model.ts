import { setSafeObjectKey, shallowCloneRecordWithSafeKeys } from "../../../platform/object-key-policy";
import { validateMutableModelEntity } from "./entity-validation";
import type { SerializedCostConfig } from "../model-input-contract";

export type ModelMutationView = {
  name: string;
  display_name: string;
  model_creator: string;
  route_count: number;
  cost: unknown;
};

type MutableModelRecord = Record<string, unknown>;

export function createModelMutationRuntime(deps: {
  loadCliReadModel: (configPath?: string) => {
    modelsByName: Record<string, ModelMutationView>;
  };
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableModels: (document: Record<string, unknown>) => Record<string, unknown>;
  createModelAlreadyExistsError: (modelId: string) => Error;
  createModelNotFoundError: (modelId: string) => Error;
  createModelInUseError: (modelId: string, routeCount: number) => Error;
  createInvalidInputMutationError: (message: string) => Error;
  createInvalidStoredModelError: (modelId: string) => Error;
}) {
  function validateModelConfig(modelId: string, candidate: Record<string, unknown>): Record<string, unknown> {
    try {
      return validateMutableModelEntity(modelId, candidate);
    } catch (error) {
      throw deps.createInvalidInputMutationError(
        error instanceof Error ? error.message : "model configuration is invalid"
      );
    }
  }

  function assertValidStoredModel(modelId: string, candidate: Record<string, unknown>): void {
    try {
      validateMutableModelEntity(modelId, candidate);
    } catch {
      throw deps.createInvalidStoredModelError(modelId);
    }
  }

  function createModel(
    configPath: string | undefined,
    modelId: string,
    requestedModel: Record<string, unknown>
  ): { model: ModelMutationView; normalizedModel: Record<string, unknown> } {
    const normalizedModel = validateModelConfig(modelId, shallowCloneRecordWithSafeKeys(requestedModel, "Model field"));
    const nextModel: MutableModelRecord = { ...normalizedModel };

    if (nextModel["cost"] === null) {
      delete nextModel["cost"];
    }

    deps.mutateConfigDocument(configPath, (document) => {
      const models = deps.getMutableModels(document);

      if (typeof models[modelId] !== "undefined") {
        throw deps.createModelAlreadyExistsError(modelId);
      }

      setSafeObjectKey(models, modelId, nextModel, "Model name");
    });

    const model = deps.loadCliReadModel(configPath).modelsByName[modelId];
    if (typeof model === "undefined") {
      throw deps.createModelNotFoundError(modelId);
    }

    return { model, normalizedModel: nextModel };
  }

  function updateModel(
    configPath: string | undefined,
    modelId: string,
    changes: {
      display_name?: string;
      model_creator?: string;
      cost?: SerializedCostConfig | null;
    }
  ): { model: ModelMutationView; normalizedModel: Record<string, unknown> } {
    let normalizedModel: Record<string, unknown> | null = null;

    deps.mutateConfigDocument(configPath, (document) => {
      const models = deps.getMutableModels(document);
      const existing = models[modelId];

      if (typeof existing === "undefined") {
        throw deps.createModelNotFoundError(modelId);
      }

      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        throw deps.createInvalidStoredModelError(modelId);
      }

      assertValidStoredModel(modelId, existing as MutableModelRecord);

      const nextValue: MutableModelRecord = { ...(existing as MutableModelRecord) };

      if (typeof changes.display_name !== "undefined") {
        nextValue["display_name"] = changes.display_name;
      }

      if (typeof changes.model_creator !== "undefined") {
        nextValue["model_creator"] = changes.model_creator;
      }

      if (typeof changes.cost !== "undefined") {
        if (changes.cost === null) {
          delete nextValue["cost"];
        } else {
          nextValue["cost"] = changes.cost;
        }
      }

      normalizedModel = validateModelConfig(modelId, nextValue);
      if (normalizedModel["cost"] === null) {
        delete normalizedModel["cost"];
      }
      setSafeObjectKey(models, modelId, normalizedModel, "Model name");
    });

    const model = deps.loadCliReadModel(configPath).modelsByName[modelId];
    if (typeof model === "undefined") {
      throw deps.createModelNotFoundError(modelId);
    }

    return { model, normalizedModel: normalizedModel ?? {} };
  }

  function deleteModel(
    configPath: string | undefined,
    modelId: string
  ): { name: string; deleted: true } {
    const readModel = deps.loadCliReadModel(configPath);
    const model = readModel.modelsByName[modelId];

    if (typeof model === "undefined") {
      throw deps.createModelNotFoundError(modelId);
    }

    if (model.route_count > 0) {
      throw deps.createModelInUseError(modelId, model.route_count);
    }

    deps.mutateConfigDocument(configPath, (document) => {
      delete deps.getMutableModels(document)[modelId];
    });

    return {
      name: model.name,
      deleted: true
    };
  }

  return {
    createModel,
    updateModel,
    deleteModel
  };
}
