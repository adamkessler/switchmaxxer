import type { CostConfig } from "../../../platform/types";
import { APP_ERROR_CODES, type AppErrorCode } from "../../../platform/error-codes";
import { createStandardCrudCommandRegistry, runParsedCrudConfigCommand, writeCrudJsonSuccess, writeCrudNotFound } from "./crud-command-helpers";
import { buildRegisteredFamilyHelpText, matchExactCommand, type CliCommandRegistration } from "../registry";
import { formatColumnAlignedTable } from "../table-format";

export function createRoutesCli(deps: {
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
    routes: Array<{
      name: string;
      display_name: string;
      model: string;
      service_provider: string;
      provider_model_id: string;
      api_mode: string;
      timeout_ms: number | null;
      effective_timeout_ms: number | null;
      cost: CostConfig | null;
      model_cost: CostConfig | null;
      effective_cost: CostConfig | null;
    }>;
    routesByName: Record<
      string,
      {
        name: string;
        display_name: string;
        model: string;
        service_provider: string;
        provider_model_id: string;
        api_mode: string;
        timeout_ms: number | null;
        effective_timeout_ms: number | null;
        cost: CostConfig | null;
        model_cost: CostConfig | null;
        effective_cost: CostConfig | null;
      }
    >;
  };
  runRoutesCreate: (argv: string[]) => Promise<number>;
  runRoutesUpdate: (argv: string[]) => Promise<number>;
  runRoutesDelete: (routeName: string, argv: string[]) => Promise<number>;
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
  buildRouteFieldMetadata: () => unknown;
  formatCostConfig: (value: CostConfig | null | undefined) => string;
  routeNotFoundCode: AppErrorCode;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  getCommandRegistry: () => CliCommandRegistration[];
  handleCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function runRoutesList(argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "routes list",
      errorCode: APP_ERROR_CODES.routesListError,
      failurePrefix: "Routes list",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const routes = readModel.routes.map((route) => ({
        name: route.name,
        display_name: route.display_name,
        model: route.model,
        service_provider: route.service_provider,
        provider_model_id: route.provider_model_id,
        api_mode: route.api_mode,
        timeout_ms: route.timeout_ms,
        effective_timeout_ms: route.effective_timeout_ms,
        cost: route.cost,
        model_cost: route.model_cost,
        effective_cost: route.effective_cost
      }));

      if (json) {
        writeCrudJsonSuccess(deps, "routes list", routes, { count: routes.length });
        return 0;
      }

      if (routes.length === 0) {
        deps.writeStdout("No routes found.");
        return 0;
      }

      deps.writeStdout(formatColumnAlignedTable(routes, [
        { header: "NAME", value: (route) => route.name },
        { header: "DISPLAY_NAME", value: (route) => route.display_name },
        { header: "MODEL", value: (route) => route.model },
        { header: "PROVIDER", value: (route) => route.service_provider },
        { header: "PROVIDER_MODEL", value: (route) => route.provider_model_id },
        { header: "API_MODE", value: (route) => route.api_mode || "(unknown)" },
        { header: "EFFECTIVE_TIMEOUT_MS", value: (route) => route.effective_timeout_ms ?? "(unknown)" },
        { header: "EFFECTIVE_COST", value: (route) => deps.formatCostConfig(route.effective_cost) }
      ]));
      return 0;
      }
    });
  }

  function runRoutesShow(routeName: string, argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "routes show",
      errorCode: APP_ERROR_CODES.routesShowError,
      failurePrefix: "Routes show",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const route = readModel.routesByName[routeName];

      if (!route) {
        return writeCrudNotFound(deps, {
          json,
          command: "routes show",
          notFoundCode: deps.routeNotFoundCode,
          failurePrefix: "Routes show",
          entityLabel: "Route",
          entityName: routeName
        });
      }

      const routeView = {
        name: route.name,
        display_name: route.display_name,
        model: route.model,
        service_provider: route.service_provider,
        provider_model_id: route.provider_model_id,
        api_mode: route.api_mode,
        timeout_ms: route.timeout_ms,
        effective_timeout_ms: route.effective_timeout_ms,
        cost: route.cost,
        model_cost: route.model_cost,
        effective_cost: route.effective_cost
      };

      if (json) {
        writeCrudJsonSuccess(deps, "routes show", routeView, {
          editability: deps.buildRouteFieldMetadata()
        });
        return 0;
      }

      deps.writeStdout(
        [
          `Route: ${routeView.name}`,
          `Display Name: ${routeView.display_name || "(none)"}`,
          `Model: ${routeView.model || "(none)"}`,
          `Service Provider: ${routeView.service_provider || "(none)"}`,
          `Provider Model ID: ${routeView.provider_model_id || "(none)"}`,
          `API Mode: ${routeView.api_mode || "(unknown)"}`,
          `Route Timeout Ms: ${String(routeView.timeout_ms ?? "(inherit)")}`,
          `Effective Timeout Ms: ${String(routeView.effective_timeout_ms ?? "(unknown)")}`,
          `Route Cost: ${deps.formatCostConfig(routeView.cost)}`,
          `Model Cost: ${deps.formatCostConfig(routeView.model_cost)}`,
          `Effective Cost: ${deps.formatCostConfig(routeView.effective_cost)}`
        ].join("\n")
      );
      return 0;
      }
    });
  }

  function runRoutesExplain(routeName: string, argv: string[]): number {
    return runParsedCrudConfigCommand(argv, deps, {
      command: "routes explain",
      errorCode: APP_ERROR_CODES.routesExplainError,
      failurePrefix: "Routes explain",
      run: ({ configPath, json }) => {
      const readModel = deps.loadCliReadModel(configPath);
      const route = readModel.routesByName[routeName];

      if (!route) {
        return writeCrudNotFound(deps, {
          json,
          command: "routes explain",
          notFoundCode: deps.routeNotFoundCode,
          failurePrefix: "Routes explain",
          entityLabel: "Route",
          entityName: routeName
        });
      }

      const explanationLines = [
        `Route Name Meaning: callers use '${route.name}' as the operator-facing route key.`,
        `Display Name Meaning: '${route.display_name || "(none)"}' is the human-facing label stored on this route.`,
        `Canonical Model Meaning: '${route.model || "(none)"}' is the canonical model key referenced by this route.`,
        `Service Provider Meaning: '${route.service_provider || "(none)"}' is the configured provider entry this route uses for upstream transport.`,
        `Provider Model ID Meaning: '${route.provider_model_id || "(none)"}' is the exact model identifier sent to the upstream provider.`,
        `API Mode Meaning: '${route.api_mode || "(unknown)"}' is the outbound API dialect configured on the selected provider.`,
        `Timeout Meaning: route timeout override is '${String(route.timeout_ms ?? "(inherit)")}', and the effective request timeout is '${String(route.effective_timeout_ms ?? "(unknown)")}' milliseconds.`
      ];

      if (json) {
        writeCrudJsonSuccess(deps, "routes explain", {
          name: route.name,
          display_name: route.display_name,
          model: route.model,
          service_provider: route.service_provider,
          provider_model_id: route.provider_model_id,
          api_mode: route.api_mode,
          timeout_ms: route.timeout_ms,
          effective_timeout_ms: route.effective_timeout_ms,
          explanation_lines: explanationLines
        });
        return 0;
      }

      deps.writeStdout(
        [
          `Route: ${route.name}`,
          `Display Name: ${route.display_name || "(none)"}`,
          `Canonical Model: ${route.model || "(none)"}`,
          `Service Provider: ${route.service_provider || "(none)"}`,
          `Provider Model ID: ${route.provider_model_id || "(none)"}`,
          `API Mode: ${route.api_mode || "(unknown)"}`,
          `Route Timeout Ms: ${String(route.timeout_ms ?? "(inherit)")}`,
          `Effective Timeout Ms: ${String(route.effective_timeout_ms ?? "(unknown)")}`,
          "",
          ...explanationLines
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
          summary: "List configured routes",
          usageLines: ["switchmaxxer routes list [--config <path>] [--json]"],
          exampleLines: [
            "switchmaxxer routes list",
            "switchmaxxer routes list --json",
            "switchmaxxer routes list --config ./config.json"
          ],
          run: async (args) => runRoutesList(args)
        },
        show: {
          commandName: "routes show",
          summary: "Show one route",
          usageLines: ["switchmaxxer routes show <route-id> [--config <path>] [--json]"],
          exampleLines: ["switchmaxxer routes show route_id", "switchmaxxer routes show route_id --json"],
          positionalLabel: "<route-id>",
          run: async (name, args) => runRoutesShow(name, args)
        },
        create: {
          commandName: "routes create",
          summary: "Create a route",
          usageLines: [
            "switchmaxxer routes create <route-id> [--model <model-id>] [--service-provider <provider-id>] [--provider-model-id <model-id>] [--display-name <label>] [--timeout-ms <number>] [--cost-input <n> --cost-output <n> --cost-cache-read <n> --cost-cache-write <n>] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: [
            "switchmaxxer routes create route_id --model gpt-4o-mini --service-provider provider_id --provider-model-id gpt-4o-mini --display-name \"Example Route\" --timeout-ms 90000 --cost-input 0.15 --cost-output 0.6 --cost-cache-read 0.15 --cost-cache-write 0.15",
            "echo '{\"name\":\"route_id\",\"model\":\"gpt-4o-mini\",\"service_provider\":\"provider_id\",\"provider_model_id\":\"gpt-4o-mini\",\"display_name\":\"Example Route\",\"timeout_ms\":90000}' | switchmaxxer routes create --stdin"
          ],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runRoutesCreate([name, ...args])
        },
        update: {
          commandName: "routes update",
          summary: "Update a route",
          usageLines: [
            "switchmaxxer routes update <route-id> [--model <model-id>] [--service-provider <provider-id>] [--provider-model-id <model-id>] [--display-name <label>] [--timeout-ms <number>|--clear-timeout-ms] [--cost-input <n> --cost-output <n> --cost-cache-read <n> --cost-cache-write <n>|--clear-cost] [--stdin|--json-input <path>] [--config <path>] [--json]"
          ],
          exampleLines: [
            "switchmaxxer routes update route_id --display-name \"Updated Route Label\" --timeout-ms 120000 --clear-cost",
            "echo '{\"display_name\":\"Updated Route Label\",\"provider_model_id\":\"gpt-4o-mini\",\"timeout_ms\":null}' | switchmaxxer routes update route_id --stdin"
          ],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runRoutesUpdate([name, ...args])
        },
        delete: {
          commandName: "routes delete",
          summary: "Delete a route",
          usageLines: ["switchmaxxer routes delete <route-id> [--config <path>] [--json]"],
          exampleLines: ["switchmaxxer routes delete route_id"],
          positionalLabel: "<name>",
          run: async (name, args) => await deps.runRoutesDelete(name, args)
        },
        extras: [
          deps.createCliCommandRegistration({
        name: "explain",
        commandName: "routes explain",
        summary: "Explain route resolution details",
        usageLines: ["switchmaxxer routes explain <route-id> [--config <path>] [--json]"],
        exampleLines: ["switchmaxxer routes explain route_id", "switchmaxxer routes explain route_id --json"],
        positionals: [{ label: "<route-id>", rejectFlagLike: false }],
        match: matchExactCommand("explain"),
        execute: async (explainArgs, [routeName = ""]) => runRoutesExplain(routeName, explainArgs)
      })
        ]
      }
    );
  }

  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer routes",
      description: "Lists configured routes from the selected Switchmaxxer config file.",
      commands: getCommandRegistry(),
      flags: [
        "--config <path>  Use the specified config file",
        "--json           Emit a simple JSON envelope with count metadata",
        "--stdin          Read one route object from stdin as JSON",
        "--json-input     Read one route object from a JSON file",
        "--model          Set the canonical model for the route",
        "--service-provider  Set the provider backing the route",
        "--provider-model-id  Set the exact upstream model identifier",
        "--display-name   Set the human-facing route label",
        "--cost-input     Set route input token price",
        "--cost-output    Set route output token price",
        "--cost-cache-read  Set route cache-read token price",
        "--cost-cache-write  Set route cache-write token price",
        "--clear-cost     Clear route cost on update"
      ],
      docsPath: "docs/subsystems/config/config-reference.md",
      proTip: "smx routes list is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function handleCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runRegisteredCommandFamily(argv, {
      familyName: "routes",
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
