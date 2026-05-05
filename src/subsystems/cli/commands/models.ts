import type { CostConfig } from "../../../platform/types";
import { APP_ERROR_CODES, type AppErrorCode } from "../../../platform/error-codes";
import { createStandardCrudCommandRegistry, runParsedCrudConfigCommand, writeCrudJsonSuccess, writeCrudNotFound } from "./crud-command-helpers";
import { buildRegisteredFamilyHelpText, type CliCommandRegistration } from "../registry";
import { formatColumnAlignedTable } from "../table-format";

export function createModelsCli(deps: {
  createCliCommandRegistration: (options: {
    name: string;
    commandName?: string;
    summary?: string;
    usageLines?: string[];
    exampleLines?: string[];
    positionals?: Array<{
      label: string;
      rejectFlagLike?: boolean;
    }>;
    match: (argv: string[]) => string[] | null;
    execute?: (argv: string[], positionals: string[]) => Promise<number | undefined> | number | undefined;
  }) => CliCommandRegistration;
  runRegisteredCommandFamily: (
    argv: string[],
    options: {
      familyName: string;
      help: () => void;
      commands: CliCommandRegistration[];
    }
  ) => Promise<number | undefined>;
  parseConfigCommandArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    errorMessage?: string;
  };
  loadCliReadModel: (configPath?: string) => {
    models: Array<{
      name: string;
      display_name: string;
      model_creator: string;
      route_count: number;
      cost: CostConfig | null;
    }>;
    modelsByName: Record<
      string,
      {
        name: string;
        display_name: string;
        model_creator: string;
        route_count: number;
        cost: CostConfig | null;
      }
    >;
  };
  runModelsCreate: (argv: string[]) => Promise<number>;
  runModelsUpdate: (argv: string[]) => Promise<number>;
  runModelsDelete: (modelName: string, argv: string[]) => Promise<number>;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: string,
    message: string,
    options?: {
      warnings?: unknown;
      details?: unknown;
    }
  ) => void;
  buildModelFieldMetadata: () => unknown;
  formatCostConfig: (value: CostConfig | null | undefined) => string;
  modelNotFoundCode: AppErrorCode;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function runModelsList(argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "models list",
      errorCode: APP_ERROR_CODES.modelsListError,
      failurePrefix: "Models list",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const models = readModel.models;

      if (json) {
        writeCrudJsonSuccess(deps, "models list", models, { count: models.length });
        return 0;
      }

      if (models.length === 0) {
        deps.writeStdout("No models found.");
        return 0;
      }

      deps.writeStdout(formatColumnAlignedTable(models, [
        { header: "NAME", value: (model) => model.name },
        { header: "DISPLAY_NAME", value: (model) => model.display_name },
        { header: "CREATOR", value: (model) => model.model_creator },
        { header: "ROUTES", value: (model) => model.route_count },
        { header: "COST", value: (model) => deps.formatCostConfig(model.cost) }
      ]));
      return 0;
      }
    });
  }

  function runModelsShow(modelName: string, argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "models show",
      errorCode: APP_ERROR_CODES.modelsShowError,
      failurePrefix: "Models show",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const model = readModel.modelsByName[modelName];

      if (!model) {
        return writeCrudNotFound(deps, {
          json,
          command: "models show",
          notFoundCode: deps.modelNotFoundCode,
          failurePrefix: "Models show",
          entityLabel: "Model",
          entityName: modelName
        });
      }

      if (json) {
        writeCrudJsonSuccess(deps, "models show", model, {
          editability: deps.buildModelFieldMetadata()
        });
        return 0;
      }

      deps.writeStdout(
        [
          `Model: ${model.name}`,
          `Display Name: ${model.display_name || "(none)"}`,
          `Creator: ${model.model_creator || "(unknown)"}`,
          `Routes: ${model.route_count}`,
          `Cost: ${deps.formatCostConfig(model.cost)}`
        ].join("\n")
      );
      return 0;
      }
    });
  }

  function getCommandRegistry(): CliCommandRegistration[] {
    return createStandardCrudCommandRegistry(
      { createCliCommandRegistration: deps.createCliCommandRegistration },
      {
        list: {
          summary: "List canonical models",
          usageLines: ["switchmaxxer models list [--config <path>] [--json]"],
          exampleLines: [
            "switchmaxxer models list",
            "switchmaxxer models list --json",
            "switchmaxxer models list --config ./config.json"
          ],
          run: async (args) => runModelsList(args)
        },
        show: {
          commandName: "models show",
          summary: "Show one model",
          usageLines: ["switchmaxxer models show <model-id> [--config <path>] [--json]"],
          exampleLines: ["switchmaxxer models show gpt-4o-mini", "switchmaxxer models show gpt-4o-mini --json"],
          positionalLabel: "<model-id>",
          run: async (name, args) => runModelsShow(name, args)
        },
        create: {
          commandName: "models create",
          summary: "Create a model",
          usageLines: [
            "switchmaxxer models create <model-id> [--display-name <value>] [--model-creator <value>] [--cost-input <n> --cost-output <n> --cost-cache-read <n> --cost-cache-write <n>] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: [
            "switchmaxxer models create gpt-4.1 --display-name \"GPT-4.1\" --model-creator openai --cost-input 0.25 --cost-output 1 --cost-cache-read 0.25 --cost-cache-write 0.25",
            "echo '{\"name\":\"gpt-4.1\",\"display_name\":\"GPT-4.1\",\"model_creator\":\"openai\"}' | switchmaxxer models create --stdin",
            "switchmaxxer models create --json-input ./new-model.json"
          ],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runModelsCreate([name, ...args])
        },
        update: {
          commandName: "models update",
          summary: "Update a model",
          usageLines: [
            "switchmaxxer models update <model-id> [--display-name <value>] [--model-creator <value>] [--cost-input <n> --cost-output <n> --cost-cache-read <n> --cost-cache-write <n>|--clear-cost] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: [
            "switchmaxxer models update gpt-4.1 --display-name \"GPT-4.1 (Updated)\" --clear-cost",
            "echo '{\"display_name\":\"GPT-4.1 (Updated)\",\"model_creator\":\"openai\"}' | switchmaxxer models update gpt-4.1 --stdin",
            "switchmaxxer models update gpt-4.1 --json-input ./model-update.json"
          ],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runModelsUpdate([name, ...args])
        },
        delete: {
          commandName: "models delete",
          summary: "Delete a model",
          usageLines: ["switchmaxxer models delete <model-id> [--config <path>] [--json]"],
          exampleLines: ["switchmaxxer models delete gpt-4.1"],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runModelsDelete(name, args)
        }
      }
    );
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer models",
      description: "Lists canonical models from the selected Switchmaxxer config file.",
      commands: getCommandRegistry(),
      flags: [
        "--config <path>  Use the specified config file",
        "--json           Emit a simple JSON envelope with count metadata",
        "--stdin          Read one model object from stdin as JSON",
        "--json-input     Read one model object from a JSON file",
        "--cost-input     Set input token price for the model",
        "--cost-output    Set output token price for the model",
        "--cost-cache-read  Set cache-read token price for the model",
        "--cost-cache-write  Set cache-write token price for the model",
        "--clear-cost     Clear model cost on update"
      ],
      docsPath: "docs/subsystems/config/config-reference.md",
      proTip: "smx models list is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "models",
      help: printHelp,
      commands: getCommandRegistry()
    });
  }

  return {
    getHelpText,
    printHelp,
    getCommandRegistry,
    handleCommand
  };
}
