import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { pickCostFields } from "../config/model-input-contract";
import type { CliMutationShared } from "./cli-mutations-shared";

export function createCliModelMutations(shared: CliMutationShared) {
  const {
    deps,
    assertSafeCliConfigIdentifier,
    modelMutationRuntime,
    createCliMutationAudit,
    withCliMutationAudit,
    classifyUsageOrMutationFailure,
    classifyMutationMessageFailure
  } = shared;

  const runModelsCreate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseModelsCreateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "models_create",
      targetKind: "model",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "models create",
        failurePrefix: "Models create",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.modelsCreateError)
      },
      () => {
        const modelInput = deps.normalizeModelCreateInput(parsedArgs);
        const { model } = modelMutationRuntime.createModel(configPath, modelInput.name, {
          display_name: modelInput.display_name,
          model_creator: modelInput.model_creator,
          ...(typeof modelInput.cost === "undefined" ? {} : { cost: pickCostFields(modelInput.cost) })
        });
        audit?.succeed({ model_id: model.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("models create", model));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(
          [
            `Model created: ${model.name}`,
            `Display Name: ${model.display_name || "(none)"}`,
            `Creator: ${model.model_creator || "(unknown)"}`,
            `Routes: ${model.route_count}`,
            `Cost: ${deps.formatCostConfig(model.cost)}`
          ].join("\n")
        );
        return 0;
      }
    );
  };

  const runModelsUpdate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseModelsUpdateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "models_update",
      targetKind: "model",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "models update",
        failurePrefix: "Models update",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.modelsUpdateError)
      },
      () => {
        const modelInput = deps.normalizeModelUpdateInput(parsedArgs);
        const { model } = modelMutationRuntime.updateModel(configPath, modelInput.name, {
          ...(typeof modelInput.display_name !== "undefined" ? { display_name: modelInput.display_name } : {}),
          ...(typeof modelInput.model_creator !== "undefined" ? { model_creator: modelInput.model_creator } : {}),
          ...(typeof modelInput.cost !== "undefined"
            ? {
                cost: modelInput.cost === null
                  ? null
                  : pickCostFields(modelInput.cost)
              }
            : {})
        });
        audit?.succeed({ model_id: model.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("models update", model));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(
          [
            `Model updated: ${model.name}`,
            `Display Name: ${model.display_name || "(none)"}`,
            `Creator: ${model.model_creator || "(unknown)"}`,
            `Routes: ${model.route_count}`,
            `Cost: ${deps.formatCostConfig(model.cost)}`
          ].join("\n")
        );
        return 0;
      }
    );
  };

  const runModelsDelete = async (modelName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseConfigCommandArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "models_delete",
      targetKind: "model",
      targetId: modelName,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "models delete",
        failurePrefix: "Models delete",
        classify: (error) => classifyMutationMessageFailure(error, APP_ERROR_CODES.modelsDeleteError, "Unknown models delete error")
      },
      () => {
        assertSafeCliConfigIdentifier(modelName, "Model name");
        const deleted = modelMutationRuntime.deleteModel(configPath, modelName);
        audit?.succeed({ model_id: deleted.name, deleted: true });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("models delete", deleted));
          return 0;
        }
        deps.cliOutputDeps.writeStdout([`Model deleted: ${deleted.name}`, "Deleted: true"].join("\n"));
        return 0;
      }
    );
  };

  return {
    runModelsCreate,
    runModelsUpdate,
    runModelsDelete
  };
}
