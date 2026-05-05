import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import { APP_ERROR_CODES, type AppErrorCode } from "../../../platform/error-codes";
import { maskSemiSensitiveEnvVarName } from "../../../platform/masked-secret";
import { createStandardCrudCommandRegistry, runParsedCrudConfigCommand, writeCrudJsonSuccess, writeCrudNotFound } from "./crud-command-helpers";
import { formatColumnAlignedTable } from "../table-format";

export function createProvidersCli(deps: {
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
    providers: Array<{
      name: string;
      api_mode: string;
      endpoint: string;
      allow_private_endpoints: boolean;
      allow_insecure_http: boolean;
      anthropic_version: string | null;
      model_id_format: string;
      auth_source: string;
      api_key_env: string | null;
      api_key_masked: string | null;
    }>;
    providersByName: Record<
      string,
      {
        name: string;
        api_mode: string;
        endpoint: string;
        allow_private_endpoints: boolean;
        allow_insecure_http: boolean;
        anthropic_version: string | null;
        model_id_format: string;
        auth_source: string;
        api_key_env: string | null;
        api_key_masked: string | null;
      }
    >;
  };
  runProvidersCreate: (argv: string[]) => Promise<number>;
  runProvidersUpdate: (argv: string[]) => Promise<number>;
  runProvidersDelete: (providerName: string, argv: string[]) => Promise<number>;
  runProvidersSetKey: (providerName: string, argv: string[]) => Promise<number>;
  runProvidersClearKey: (providerName: string, argv: string[]) => Promise<number>;
  runProvidersSetKeyEnv: (providerName: string, envVarName: string, argv: string[]) => Promise<number>;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: string,
    message: string,
    options?: { warnings?: unknown; details?: unknown }
  ) => void;
  buildProviderFieldMetadata: () => unknown;
  maskSecretValue: (secret: string | null) => string | null;
  providerNotFoundCode: AppErrorCode;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function runProvidersList(argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "providers list",
      errorCode: APP_ERROR_CODES.providersListError,
      failurePrefix: "Providers list",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const providers = readModel.providers.map((provider) => ({
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
      }));

      if (json) {
        writeCrudJsonSuccess(deps, "providers list", providers, { count: providers.length });
        return 0;
      }

      if (providers.length === 0) {
        deps.writeStdout("No providers found.");
        return 0;
      }

      deps.writeStdout(formatColumnAlignedTable(providers, [
        { header: "NAME", value: (provider) => provider.name },
        { header: "API_MODE", value: (provider) => provider.api_mode || "(unknown)" },
        { header: "ENDPOINT", value: (provider) => provider.endpoint },
        { header: "ANTHROPIC_VERSION", value: (provider) => provider.anthropic_version ?? "null" },
        { header: "MODEL_ID_FORMAT", value: (provider) => provider.model_id_format },
        { header: "AUTH_SOURCE", value: (provider) => provider.auth_source },
        { header: "API_KEY_ENV", value: (provider) => provider.api_key_env ?? "not required" }
      ]));
      return 0;
      }
    });
  }

  function runProvidersShow(providerName: string, argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "providers show",
      errorCode: APP_ERROR_CODES.providersShowError,
      failurePrefix: "Providers show",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const provider = readModel.providersByName[providerName];

      if (!provider) {
        return writeCrudNotFound(deps, {
          json,
          command: "providers show",
          notFoundCode: deps.providerNotFoundCode,
          failurePrefix: "Providers show",
          entityLabel: "Provider",
          entityName: providerName
        });
      }

      const providerView = {
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
      };

      if (json) {
        writeCrudJsonSuccess(deps, "providers show", providerView, {
          editability: deps.buildProviderFieldMetadata()
        });
        return 0;
      }

      deps.writeStdout(
        [
          `Provider: ${providerView.name}`,
          `API Mode: ${providerView.api_mode || "(unknown)"}`,
          `Endpoint: ${providerView.endpoint || "(none)"}`,
          `Allow Private Endpoints: ${String(providerView.allow_private_endpoints)}`,
          `Allow Insecure HTTP: ${String(providerView.allow_insecure_http)}`,
          `Anthropic Version: ${providerView.anthropic_version ?? "null"}`,
          `Model ID Format: ${providerView.model_id_format}`,
          `Auth Source: ${providerView.auth_source}`,
          `api_key_env: ${providerView.api_key_env ?? "null"}`,
          `api_key: ${providerView.api_key ?? "null"}`
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
          summary: "List configured service providers",
          usageLines: ["switchmaxxer providers list [--config <path>] [--json]"],
          exampleLines: [
            "switchmaxxer providers list",
            "switchmaxxer providers list --json",
            "switchmaxxer providers list --config ./config.json"
          ],
          run: async (args) => runProvidersList(args)
        },
        show: {
          commandName: "providers show",
          summary: "Show one service provider",
          usageLines: ["switchmaxxer providers show <provider-id> [--config <path>] [--json]"],
          exampleLines: [
            "switchmaxxer providers show provider_id",
            "switchmaxxer providers show provider_id --json"
          ],
          positionalLabel: "<provider-id>",
          run: async (name, args) => runProvidersShow(name, args)
        },
        create: {
          commandName: "providers create",
          summary: "Create a service provider",
          usageLines: [
            "switchmaxxer providers create <provider-id> [--endpoint <url>] [--allow-private-endpoints] [--allow-insecure-http] [--api-mode <openai-completions|anthropic-messages>] [--anthropic-version <value>] [--model-id-format <passthrough|creator/model>] [--api-key-env <env_var>|--api-key-stdin|--no-auth] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: [
            "switchmaxxer providers create provider_id --endpoint \"https://api.openai.com/v1/chat/completions\" --api-mode openai-completions --api-key-env SWITCHMAXXER_OPENAI_API_KEY",
            "printf 'sk-example' | switchmaxxer providers create provider_id --endpoint \"https://api.openai.com/v1/chat/completions\" --api-mode openai-completions --api-key-stdin",
            "switchmaxxer providers create local_gateway --endpoint \"http://127.0.0.1:4080/v1/chat/completions\" --allow-private-endpoints --allow-insecure-http --api-mode openai-completions --no-auth"
          ],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runProvidersCreate([name, ...args])
        },
        update: {
          commandName: "providers update",
          summary: "Update a service provider",
          usageLines: [
            "switchmaxxer providers update <provider-id> [--endpoint <url>] [--allow-private-endpoints] [--allow-insecure-http] [--api-mode <openai-completions|anthropic-messages>] [--anthropic-version <value>] [--model-id-format <passthrough|creator/model>] [--api-key-env <env_var>|--no-auth] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: ["switchmaxxer providers update provider_id --endpoint \"https://api.openai.com/v1/responses\""],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runProvidersUpdate([name, ...args])
        },
        delete: {
          commandName: "providers delete",
          summary: "Delete a service provider",
          usageLines: ["switchmaxxer providers delete <provider-id> [--config <path>] [--json]"],
          exampleLines: ["switchmaxxer providers delete provider_id"],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runProvidersDelete(name, args)
        },
        extras: [
          deps.createCliCommandRegistration({
        name: "set-key",
        commandName: "providers set-key",
        summary: "Set an inline provider API key",
        usageLines: ["switchmaxxer providers set-key <provider-id> --api-key-stdin [--config <path>] [--json]"],
        exampleLines: ["printf 'sk-example' | switchmaxxer providers set-key provider_id --api-key-stdin"],
        positionals: [{ label: "<provider-id>", rejectFlagLike: false }],
        match: matchExactCommand("set-key"),
        execute: async (setKeyArgs, [providerName = ""]) => deps.runProvidersSetKey(providerName, setKeyArgs)
      }),
      deps.createCliCommandRegistration({
        name: "clear-key",
        commandName: "providers clear-key",
        summary: "Clear an inline provider API key",
        usageLines: ["switchmaxxer providers clear-key <provider-id> [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer providers clear-key provider_id"],
        positionals: [{ label: "<provider-id>", rejectFlagLike: false }],
        match: matchExactCommand("clear-key"),
        execute: async (clearKeyArgs, [providerName = ""]) => deps.runProvidersClearKey(providerName, clearKeyArgs)
      }),
      deps.createCliCommandRegistration({
        name: "set-key-env",
        commandName: "providers set-key-env",
        summary: "Point provider auth at an env var",
        usageLines: ["switchmaxxer providers set-key-env <provider-id> <env_var> [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer providers set-key-env provider_id SWITCHMAXXER_OPENAI_API_KEY"],
        positionals: [
          { label: "<provider-id>", rejectFlagLike: false },
          { label: "<env_var>", rejectFlagLike: false }
        ],
        match: matchExactCommand("set-key-env"),
        execute: async (setKeyEnvArgs, [providerName = "", envVarName = ""]) =>
          deps.runProvidersSetKeyEnv(providerName, envVarName, setKeyEnvArgs)
      })
        ]
      }
    );
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer providers",
      description: "Lists configured service providers from the selected Switchmaxxer config file.",
      commands: getCommandRegistry(),
      flags: [
        "--config <path>  Use the specified config file",
        "--json           Emit a simple JSON envelope with count metadata",
        "--stdin          Read one provider object from stdin as JSON",
        "--json-input     Read one provider object from a JSON file",
        "--endpoint      Set the provider endpoint URL",
        "--allow-private-endpoints  Permit localhost, loopback, link-local, or RFC1918/private endpoints for this provider",
        "--allow-insecure-http      Permit http:// instead of https:// for this provider",
        "--api-mode       Set the provider API dialect",
        "--anthropic-version  Set the provider-specific anthropic-version header value",
        "--model-id-format  Control whether provider_model_id is passed through or composed as creator/model upstream",
        "--api-key-env    Set the env var name used for provider auth",
        "--api-key-stdin  Read the replacement inline api_key from stdin for providers create or providers set-key",
        "--no-auth        Create a provider that does not require auth"
      ],
      docsPath: "docs/subsystems/config/config-reference.md",
      proTip: "smx providers list is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "providers",
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
