import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCliAppRegistries } from "./app-registry";
import { createBenchCli } from "./commands/bench";
import { createConfigCli } from "./commands/config";
import { createGatewayCli } from "./commands/gateway";
import { createLedgerCli } from "./commands/ledger";
import { createMcpCli } from "./commands/mcp";
import { createModelsCli } from "./commands/models";
import { createOptimizeCli } from "./commands/optimize";
import { createProvidersCli } from "./commands/providers";
import { createRoutesCli } from "./commands/routes";
import { createToolCli } from "./commands/tool";
import { createTraceCli } from "./commands/trace";
import { run, type CliIo } from "../../index";
import { handleMcpRequestForTests } from "../mcp/mcp";
import { getToolDefinitions } from "../mcp/tools";
import { copyExampleConfigPairForTests } from "../config/config-file.test-support";
import { BENCH_MAX_PROMPT_LENGTH } from "../observability/bench-limits";
import { closeObservabilityServiceHandle, openObservabilityService } from "../observability/runtime-loader";
import { seedSuccessfulRequest } from "../observability/test-helpers";
import {
  buildRegisteredFamilyHelpText,
  createCliCommandFamilyRegistration,
  createCliCommandRegistration,
  type CliCommandRegistration
} from "./registry";

const EXAMPLE_CONFIG_ENV = {
  SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef",
  SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key",
  SWITCHMAXXER_ANTHROPIC_API_KEY: "test-anthropic-key",
  SWITCHMAXXER_OPENROUTER_API_KEY: "test-openrouter-key",
  SWITCHMAXXER_MINIMAX_API_KEY: "test-minimax-key"
} as const;

type TestMcpCapability = "read" | "mutation" | "privileged";

const FULL_MCP_CAPABILITIES: TestMcpCapability[] = ["read", "mutation", "privileged"];
const MUTATION_PARITY_MCP_TEMP_PARENT = mkdtempSync(
  path.join(process.cwd(), ".tmp-switchmaxxer-cli-parity-mcp-")
);
const READ_PARITY_TRACE_ID = "req-read-parity";
const READ_PARITY_BENCH_RUN_ID = "bench-read-parity";
const READ_PARITY_OPTIMIZE_RUN_ID = "opt-read-parity";
const READ_PARITY_LEDGER_EVENT_ID = "ledger-read-parity";

test.afterEach(() => {
  rmSync(MUTATION_PARITY_MCP_TEMP_PARENT, { recursive: true, force: true });
  mkdirSync(MUTATION_PARITY_MCP_TEMP_PARENT, { recursive: true, mode: 0o700 });
});

test.after(() => {
  rmSync(MUTATION_PARITY_MCP_TEMP_PARENT, { recursive: true, force: true });
});

function createSecureExampleConfigCopy(
  prefix: string,
  parentDir: string = tmpdir(),
  options: {
    mcpCapabilities?: TestMcpCapability[];
  } = {}
): { tempDir: string; configPath: string } {
  const tempDir = mkdtempSync(path.join(parentDir, prefix));
  const configPath = path.join(tempDir, "config.json");
  copyExampleConfigPairForTests(configPath);
  if (options.mcpCapabilities) {
    const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    document["mcp"] = {
      capabilities: options.mcpCapabilities
    };
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    chmodSync(configPath, 0o600);
  }
  return { tempDir, configPath };
}

function createMutationParityMcpConfigCopy(prefix: string): { tempDir: string; configPath: string } {
  return createSecureExampleConfigCopy(prefix, MUTATION_PARITY_MCP_TEMP_PARENT, {
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
}

function writeJsonInputFile(tempDir: string, fileName: string, payload: Record<string, unknown>): string {
  const inputPath = path.join(tempDir, fileName);
  writeFileSync(inputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return inputPath;
}

async function withEnvironmentVariables<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
}

async function withExampleConfigEnv<T>(fn: () => Promise<T>): Promise<T> {
  return await withEnvironmentVariables(EXAMPLE_CONFIG_ENV, fn);
}

function seedReadParityObservabilityStore(dbPath: string): void {
  const handle = openObservabilityService(dbPath, { sqliteExperimentalWarning: "suppress" });

  try {
    seedSuccessfulRequest(handle.service, READ_PARITY_TRACE_ID);
    handle.service.benchmarks.createRun({
      id: READ_PARITY_BENCH_RUN_ID,
      name: "read-parity-bench",
      created_at: "2026-04-18T14:10:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: "CLI/MCP read parity fixture",
      settings_json: JSON.stringify({
        requested_path_mode: "direct",
        effective_paths: ["direct"],
        skipped_paths: [],
        warnings: []
      }),
      status: "completed"
    });
    handle.service.benchmarks.insertSample({
      id: "bench-read-parity-sample",
      benchmark_run_id: READ_PARITY_BENCH_RUN_ID,
      request_execution_id: READ_PARITY_TRACE_ID,
      route_id: "route-alpha",
      provider_id: "provider-main",
      provider_model_id: "provider-model-1",
      sample_index: 0,
      started_at: "2026-04-18T14:10:01.000Z",
      completed_at: "2026-04-18T14:10:01.150Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 150,
      ttft_ms: 80,
      duration_ms: 150,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      estimated_cost_micros: 4500,
      is_warmup: 0,
      score_value: 0.95,
      score_scale: "0_to_1",
      score_direction: "higher_is_better",
      score_source: "synthetic",
      score_method: "latency",
      scored_at: "2026-04-18T14:10:01.160Z",
      score_json: JSON.stringify({ path: "direct" })
    });

    const referenceTokens = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_write_tokens: 0
    };
    const optimizeReport = {
      run: {
        run_id: READ_PARITY_OPTIMIZE_RUN_ID,
        persisted: true,
        created_at: "2026-04-18T14:20:00.000Z",
        finished_at: "2026-04-18T14:20:01.000Z",
        created_by: "test-suite",
        status: "completed",
        target_model: "gpt-4o-mini",
        objective: "cost"
      },
      candidates: {
        requested_routes: null,
        resolved_routes: ["gpt-4o-mini"],
        disqualified: []
      },
      reference_tokens: referenceTokens,
      bench: null,
      ranking: [
        {
          rank: 1,
          objective: "cost",
          route_id: "gpt-4o-mini",
          display_name: "GPT-4o Mini",
          model: "gpt-4o-mini",
          service_provider: "openai_direct",
          provider_model_id: "gpt-4o-mini",
          score: 0.001,
          score_unit: "usd",
          details: {
            reference_tokens: referenceTokens,
            effective_cost: {
              input: 0.15,
              output: 0.6,
              cache_read: 0.075,
              cache_write: 0.15
            },
            cost_source: "route",
            estimated_cost: 0.001
          },
          disqualified: null
        }
      ],
      winner: {
        route_id: "gpt-4o-mini",
        score: 0.001,
        score_unit: "usd",
        tied_with: []
      },
      warnings: []
    };
    handle.service.optimizations.createRun({
      id: READ_PARITY_OPTIMIZE_RUN_ID,
      created_at: "2026-04-18T14:20:00.000Z",
      finished_at: "2026-04-18T14:20:01.000Z",
      created_by: "test-suite",
      target_model: "gpt-4o-mini",
      objective: "cost",
      status: "completed",
      winner_route: "gpt-4o-mini",
      benchmark_run_id: null,
      settings_json: JSON.stringify({ objective: "cost" }),
      candidate_snapshot_json: JSON.stringify([]),
      result_json: JSON.stringify(optimizeReport),
      warnings_json: JSON.stringify([])
    });

    handle.service.controlPlaneActions.createEvent({
      id: READ_PARITY_LEDGER_EVENT_ID,
      created_at: "2026-04-18T14:30:00.000Z",
      finished_at: "2026-04-18T14:30:01.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      actor_kind: "operator",
      actor_id: null,
      session_id: null,
      operation: "models_create",
      status: "succeeded",
      target_kind: "model",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      mutation_event_id: null,
      correlation_ids_json: JSON.stringify({ schema_version: "1" }),
      result_json: JSON.stringify({ schema_version: "1", model_id: "gpt-4o-mini" }),
      error_json: JSON.stringify({}),
      metadata_json: JSON.stringify({ fixture: "read-parity" })
    });
  } finally {
    closeObservabilityServiceHandle(handle);
  }
}

async function withMockGatewayFetch<T>(
  runtimeConfigPayload: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: unknown }).url ?? input);

    if (url.endsWith("/__switchmaxxer/runtime/config")) {
      return new Response(JSON.stringify(runtimeConfigPayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: `Unexpected test fetch URL '${url}'` }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runCliJson(argv: string[]): Promise<Record<string, unknown>> {
  return await runCliJsonWithExit(argv, 0);
}

async function runCliJsonWithExit(
  argv: string[],
  expectedExitCode: number,
  assertionMessage?: string
): Promise<Record<string, unknown>> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (message: string) => {
      stdout += message;
    },
    stderr: (message: string) => {
      stderr += message;
    },
    stdin: {
      isTTY: false,
      readAllSync: () => "",
      readAll: async () => ""
    },
    env: { ...process.env },
    cwd: () => process.cwd()
  };

  const result = await run(argv, io);
  assert.equal(result, expectedExitCode, assertionMessage);
  if (expectedExitCode === 0) {
    assert.equal(stderr, "");
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function callTool(name: string, args: unknown, configPath: string): Promise<Record<string, unknown>> {
  return (await callToolWithMetadata(name, args, configPath)).payload;
}

async function callToolWithMetadata(
  name: string,
  args: unknown,
  configPath: string
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const response = await handleMcpRequestForTests({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args }
  }, configPath);

  const result = response.response?.["result"] as Record<string, unknown>;
  const content = result["content"] as Array<Record<string, unknown>>;
  const text = content[0]?.["text"];
  if (typeof text !== "string") {
    throw new Error(`MCP tool '${name}' did not return serialized content text`);
  }
  return {
    payload: JSON.parse(text) as Record<string, unknown>,
    isError: result["isError"] === true
  };
}

function getEnvelopeError(payload: Record<string, unknown>): Record<string, unknown> {
  const error = payload["error"];
  assert.equal(payload["ok"], false);
  assert.equal(typeof error, "object");
  assert.notEqual(error, null);
  assert.equal(Array.isArray(error), false);
  return error as Record<string, unknown>;
}

function assertSameMutationErrorCode(
  cliPayload: Record<string, unknown>,
  mcpPayload: Record<string, unknown>
): void {
  const cliError = getEnvelopeError(cliPayload);
  const mcpError = getEnvelopeError(mcpPayload);

  assert.equal(cliPayload["command"], mcpPayload["command"]);
  assert.equal(cliPayload["schema_version"], mcpPayload["schema_version"]);
  assert.equal(cliError["code"], mcpError["code"]);
  assert.notEqual(mcpError["code"], "unsupported", "MCP parity fixture must grant mutation capabilities");
}

type RejectionParityContext = {
  cliConfigPath: string;
  mcpConfigPath: string;
  tempDir: string;
};

type RejectionParityCase = {
  name: string;
  cli: (context: RejectionParityContext) => string[];
  cliExitCode: 1 | 2;
  mcp: string;
  mcpArgs: (context: RejectionParityContext) => Record<string, unknown>;
};

const REJECTION_PARITY_CASES: RejectionParityCase[] = [
  {
    name: "missing required field",
    cli: (context) => [
      "providers",
      "create",
      "rejection-provider-missing-endpoint",
      "--json",
      "--config",
      context.cliConfigPath,
      "--api-mode",
      "openai-completions",
      "--no-auth"
    ],
    cliExitCode: 2,
    mcp: "providers_create",
    mcpArgs: () => ({
      provider_id: "rejection-provider-missing-endpoint",
      api_mode: "openai-completions"
    })
  },
  {
    name: "empty-string field",
    cli: (context) => [
      "models",
      "create",
      "--json",
      "--config",
      context.cliConfigPath,
      "--json-input",
      writeJsonInputFile(context.tempDir, "empty-model-creator.json", {
        name: "rejection-model-empty-creator",
        display_name: "Empty Creator",
        model_creator: ""
      })
    ],
    cliExitCode: 2,
    mcp: "models_create",
    mcpArgs: () => ({
      model_id: "rejection-model-empty-creator",
      display_name: "Empty Creator",
      model_creator: ""
    })
  },
  {
    name: "conflicting input modes",
    cli: (context) => [
      "providers",
      "update",
      "openai_direct",
      "--json",
      "--config",
      context.cliConfigPath,
      "--endpoint",
      "https://example.invalid/v1/chat/completions",
      "--api-mode",
      "openai-completions",
      "--api-key-env",
      "SWITCHMAXXER_REJECTION_PARITY_PROVIDER_KEY",
      "--no-auth"
    ],
    cliExitCode: 2,
    mcp: "providers_update",
    mcpArgs: () => ({
      provider_id: "openai_direct",
      endpoint: "https://example.invalid/v1/chat/completions",
      api_key_env: "SWITCHMAXXER_REJECTION_PARITY_PROVIDER_KEY",
      no_auth: true
    })
  },
  {
    name: "unknown additional field",
    cli: (context) => [
      "models",
      "create",
      "--json",
      "--config",
      context.cliConfigPath,
      "--json-input",
      writeJsonInputFile(context.tempDir, "unknown-model-field.json", {
        name: "rejection-model-unknown-field",
        display_name: "Unknown Field",
        model_creator: "openai",
        unknown_field: true
      })
    ],
    cliExitCode: 2,
    mcp: "models_create",
    mcpArgs: () => ({
      model_id: "rejection-model-unknown-field",
      display_name: "Unknown Field",
      model_creator: "openai",
      unknown_field: true
    })
  },
  {
    name: "unknown nested field",
    cli: (context) => [
      "routes",
      "update",
      "gpt-4o-mini",
      "--json",
      "--config",
      context.cliConfigPath,
      "--json-input",
      writeJsonInputFile(context.tempDir, "unknown-route-cost-field.json", {
        cost: {
          input: 0.1,
          output: 0.2,
          cache_read: 0.05,
          cache_write: 0.05,
          cacheRead: 0.05
        }
      })
    ],
    cliExitCode: 2,
    mcp: "routes_update",
    mcpArgs: () => ({
      route_id: "gpt-4o-mini",
      cost: {
        input: 0.1,
        output: 0.2,
        cache_read: 0.05,
        cache_write: 0.05,
        cacheRead: 0.05
      }
    })
  },
  {
    name: "prototype-pollution key",
    cli: (context) => [
      "models",
      "create",
      "__proto__",
      "--json",
      "--config",
      context.cliConfigPath,
      "--display-name",
      "Reserved Model",
      "--model-creator",
      "openai"
    ],
    cliExitCode: 2,
    mcp: "models_create",
    mcpArgs: () => ({
      model_id: "__proto__",
      display_name: "Reserved Model",
      model_creator: "openai"
    })
  },
  {
    name: "oversized string",
    cli: (context) => [
      "bench",
      "--route",
      "gpt-4o-mini",
      "--prompt",
      "x".repeat(BENCH_MAX_PROMPT_LENGTH + 1),
      "--json",
      "--config",
      context.cliConfigPath
    ],
    cliExitCode: 2,
    mcp: "bench_run",
    mcpArgs: () => ({
      route_id: "gpt-4o-mini",
      prompt: "x".repeat(BENCH_MAX_PROMPT_LENGTH + 1)
    })
  }
];

function assertSameSuccessEnvelope(
  cliPayload: Record<string, unknown>,
  mcpPayload: Record<string, unknown>
): void {
  assert.equal(cliPayload["ok"], true);
  assert.equal(mcpPayload["ok"], true);
  assert.equal(cliPayload["command"], mcpPayload["command"]);
  assert.equal(cliPayload["schema_version"], mcpPayload["schema_version"]);
}

function assertSameSuccessDataPayload(
  cliPayload: Record<string, unknown>,
  mcpPayload: Record<string, unknown>
): void {
  assertSameSuccessEnvelope(cliPayload, mcpPayload);
  assert.deepEqual(cliPayload["data"], mcpPayload["data"]);
}

function getCliTopLevelCommandNames(): string[] {
  const registries = buildCliAppRegistries({
    runCliEntrypoint: async (_commandName, argv, runCommand) => await runCommand(argv),
    printConfigHelp: () => undefined,
    printGatewayHelp: () => undefined,
    printTestHelp: () => undefined,
    printBenchHelp: () => undefined,
    printLedgerHelp: () => undefined,
    printModelsHelp: () => undefined,
    printProvidersHelp: () => undefined,
    printPruneHelp: () => undefined,
    printRoutesHelp: () => undefined,
    printToolHelp: () => undefined,
    printOptimizeHelp: () => undefined,
    printTraceHelp: () => undefined,
    writeMcpHelp: () => undefined,
    printInvokeHelp: () => undefined,
    printTopLevelHelp: () => undefined,
    printVersion: () => undefined,
    printHelpTopic: () => false,
    printUsageError: () => undefined,
    handleConfigCommand: async () => 0,
    handleGatewayCommand: async () => 0,
    handleTestCommand: async () => 0,
    handleBenchCommand: async () => 0,
    handleLedgerCommand: async () => 0,
    handleModelsCommand: async () => 0,
    handleProvidersCommand: async () => 0,
    handlePruneCommand: async () => 0,
    handleRoutesCommand: async () => 0,
    handleToolCommand: async () => 0,
    handleOptimizeCommand: async () => 0,
    handleTraceCommand: async () => 0,
    handleMcpCommand: async () => 0,
    runInvokeCommand: async () => 0,
    runDefaultGatewayEntry: async () => 0
  });

  return registries.cliCommandRegistry.map((command) => command.name).sort();
}

function createRegistryInspectionDeps(): Record<string, unknown> {
  const noop = () => undefined;
  const noopAsync = async () => undefined;

  const commandRegistrationDeps = {
    printUsageError: noop,
    runUnsupportedCommand: () => 2,
    runWithUsageContext: async <T>(_context: { command: string; json: boolean }, fn: () => Promise<T>) => await fn()
  };

  return new Proxy<Record<string, unknown>>(
    {
      assertBenchmarkPromptLength: noop,
      benchLimits: {
        maxConcurrency: 1,
        maxIterations: 1,
        maxPromptLength: 1,
        maxRoutes: 1
      },
      buildRegisteredFamilyHelpText,
      closeObservabilityServiceHandle: noop,
      createCliCommandFamilyRegistration: (options: Parameters<typeof createCliCommandFamilyRegistration>[0]) =>
        createCliCommandFamilyRegistration(options, {
          isHelpFlag: () => false,
          printUsageError: noop
        }),
      createCliCommandRegistration: (options: Parameters<typeof createCliCommandRegistration>[0]) =>
        createCliCommandRegistration(options, commandRegistrationDeps),
      createCliUsageError: (code: string, message: string) => Object.assign(new Error(message), { code }),
      defaultCliFetchTimeoutMs: 1,
      loadConfig: () => ({}),
      mcpEntityStateErrorCodes: {
        routeNotFound: "route_not_found"
      },
      mcpUsageErrorCodes: {
        incompleteCostFlags: "incomplete_cost_flags",
        invalidFlagValue: "invalid_flag_value",
        invalidInputField: "invalid_input_field",
        missingRequiredField: "missing_required_field"
      },
      noUsageMessageMatch: () => false,
      parseGatewayRunArgs: () => ({}),
      printUsageError: noop,
      readLongFlagValue: () => null,
      runHelpAwareCommand: noopAsync,
      runRegisteredCommandFamily: noopAsync,
      writeJson: noop,
      writeJsonErrorEnvelope: noop,
      writeJsonSuccessEnvelope: noop,
      writeStderr: noop,
      writeStdout: noop
    },
    {
      get(target, property) {
        if (typeof property === "string" && property in target) {
          return target[property];
        }

        return noopAsync;
      }
    }
  );
}

function commandSurfaces(prefix: string, commands: CliCommandRegistration[]): string[] {
  return commands.map((command) => command.commandName ?? `${prefix} ${command.name}`);
}

function createCliForInspection<T>(factory: (deps: never) => T): T {
  return factory(createRegistryInspectionDeps() as never);
}

function getCliVerbSurfaceNames(): string[] {
  const bench = createCliForInspection(createBenchCli);
  const config = createCliForInspection(createConfigCli);
  const gateway = createCliForInspection(createGatewayCli);
  const ledger = createCliForInspection(createLedgerCli);
  const mcp = createCliForInspection(createMcpCli);
  const models = createCliForInspection(createModelsCli);
  const optimize = createCliForInspection(createOptimizeCli);
  const providers = createCliForInspection(createProvidersCli);
  const routes = createCliForInspection(createRoutesCli);
  const tool = createCliForInspection(createToolCli);
  const trace = createCliForInspection(createTraceCli);

  return [
    "bench",
    "invoke",
    "optimize",
    "prune",
    "test",
    ...commandSurfaces("bench", bench.getCommandRegistry()),
    ...commandSurfaces("config", config.getCommandRegistry()),
    ...commandSurfaces("gateway", gateway.getLeafCommandRegistry())
      .filter((surface) => surface !== "gateway runtime" && surface !== "gateway logs"),
    ...commandSurfaces("gateway runtime", gateway.getRuntimeCommandRegistry()),
    ...commandSurfaces("gateway logs", gateway.getLogsCommandRegistry()),
    ...commandSurfaces("ledger", ledger.getCommandRegistry()),
    ...commandSurfaces("mcp", mcp.getCommandRegistry()),
    ...commandSurfaces("models", models.getCommandRegistry()),
    ...commandSurfaces("optimize", optimize.getCommandRegistry()),
    ...commandSurfaces("providers", providers.getCommandRegistry()),
    ...commandSurfaces("routes", routes.getCommandRegistry()),
    ...commandSurfaces("tool", tool.getCommandRegistry()),
    ...commandSurfaces("trace", trace.getCommandRegistry())
  ].sort();
}

type CliMcpParityEntry =
  | {
      cli: string;
      mcp: string;
    }
  | {
      cli: string;
      cliOnly: string;
    };

const CLI_MCP_PARITY_MATRIX: readonly CliMcpParityEntry[] = [
  { cli: "bench", mcp: "bench_run" },
  { cli: "bench clear", cliOnly: "Benchmark-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "bench delete", cliOnly: "Benchmark-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "bench list", mcp: "bench_list" },
  { cli: "bench prune", cliOnly: "Benchmark-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "bench show", mcp: "bench_show" },
  { cli: "config export", cliOnly: "Exports local config files and may include secrets; MCP intentionally exposes only redacted config_show." },
  { cli: "config import", cliOnly: "Bulk config replacement is local-file/stdin oriented and remains CLI-only." },
  { cli: "config migrate", cliOnly: "Reserved unsupported migration scaffold; no MCP tool until migration exists." },
  { cli: "config schema", mcp: "config_schema" },
  { cli: "config set", cliOnly: "Ad hoc scalar config mutation remains CLI-only; MCP exposes typed entity mutation tools instead." },
  { cli: "config show", mcp: "config_show" },
  { cli: "config validate", mcp: "config_validate" },
  { cli: "gateway auth", cliOnly: "Local inbound-auth diagnostics inspect environment variables and token fingerprints; MCP exposes only redacted status." },
  { cli: "gateway disable", cliOnly: "System service control remains operator-local." },
  { cli: "gateway enable", cliOnly: "System service control remains operator-local." },
  { cli: "gateway health", mcp: "gateway_health" },
  { cli: "gateway logs show", cliOnly: "Gateway log access remains CLI-only until MCP log redaction and volume limits are specified." },
  { cli: "gateway logs tail", cliOnly: "Long-lived log following is not exposed through request/response MCP tools." },
  { cli: "gateway reload", cliOnly: "Standalone gateway reload remains operator-local; optimize_apply exposes a scoped reload post-action." },
  { cli: "gateway restart", cliOnly: "System service control remains operator-local." },
  { cli: "gateway run", cliOnly: "Foreground server lifecycle is a local operator action, not an MCP tool." },
  { cli: "gateway runtime config", mcp: "gateway_runtime_config" },
  { cli: "gateway start", cliOnly: "System service control remains operator-local." },
  { cli: "gateway status", mcp: "gateway_status" },
  { cli: "gateway stop", cliOnly: "System service control remains operator-local." },
  { cli: "invoke", cliOnly: "Direct request invocation is an operator CLI workflow, not a config/control MCP tool." },
  { cli: "ledger list", mcp: "ledger_list" },
  { cli: "ledger show", mcp: "ledger_show" },
  { cli: "mcp capabilities", cliOnly: "Previews the MCP server's own granted tool set before launch, so it is an operator CLI diagnostic." },
  { cli: "mcp serve", cliOnly: "Starts the MCP server itself, so it cannot be an MCP tool." },
  { cli: "models create", mcp: "models_create" },
  { cli: "models delete", mcp: "models_delete" },
  { cli: "models list", mcp: "models_list" },
  { cli: "models show", mcp: "models_show" },
  { cli: "models update", mcp: "models_update" },
  { cli: "optimize", mcp: "optimize_run" },
  { cli: "optimize apply", mcp: "optimize_apply" },
  { cli: "optimize clear", cliOnly: "Optimization-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "optimize delete", cliOnly: "Optimization-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "optimize list", mcp: "optimize_list" },
  { cli: "optimize prune", cliOnly: "Optimization-history destructive maintenance stays operator-local until MCP cleanup policy is defined." },
  { cli: "optimize restore", mcp: "optimize_restore" },
  { cli: "optimize show", mcp: "optimize_show" },
  { cli: "providers clear-key", mcp: "providers_clear_key" },
  { cli: "providers create", mcp: "providers_create" },
  { cli: "providers delete", mcp: "providers_delete" },
  { cli: "providers list", mcp: "providers_list" },
  { cli: "providers set-key", mcp: "providers_set_key" },
  { cli: "providers set-key-env", mcp: "providers_set_key_env" },
  { cli: "providers show", mcp: "providers_show" },
  { cli: "providers update", mcp: "providers_update" },
  { cli: "prune", mcp: "prune" },
  { cli: "routes create", mcp: "routes_create" },
  { cli: "routes delete", mcp: "routes_delete" },
  { cli: "routes explain", mcp: "routes_explain" },
  { cli: "routes list", mcp: "routes_list" },
  { cli: "routes show", mcp: "routes_show" },
  { cli: "routes update", mcp: "routes_update" },
  { cli: "test", cliOnly: "Route test execution is a CLI workflow with gateway/process assumptions." },
  { cli: "tool date", cliOnly: "Developer/operator utility command; intentionally outside MCP tool parity." },
  { cli: "tool random", cliOnly: "Developer/operator utility command; intentionally outside MCP tool parity." },
  { cli: "tool uptime", cliOnly: "Developer/operator utility command; MCP has gateway_status for gateway state." },
  { cli: "trace list", mcp: "trace_list" },
  { cli: "trace observations", mcp: "trace_observations" },
  { cli: "trace repair", mcp: "trace_repair" },
  { cli: "trace show", mcp: "trace_show" },
  { cli: "trace stats", mcp: "trace_stats" },
  { cli: "trace verify", mcp: "trace_verify" }
];

const MCP_ONLY_TOOLS: readonly string[] = [];
const READ_STYLE_PRIVILEGED_MCP_TOOLS = new Set(["ledger_list", "ledger_show", "trace_repair"]);
const READ_DATA_PARITY_MCP_TOOLS = [
  "bench_list",
  "bench_show",
  "config_validate",
  "gateway_health",
  "gateway_runtime_config",
  "ledger_list",
  "ledger_show",
  "models_list",
  "models_show",
  "optimize_list",
  "optimize_show",
  "providers_list",
  "providers_show",
  "routes_explain",
  "routes_list",
  "routes_show",
  "trace_list",
  "trace_observations",
  "trace_repair",
  "trace_show",
  "trace_stats",
  "trace_verify"
] as const;
const READ_DATA_PARITY_EXCEPTIONS = [
  {
    mcp: "config_schema",
    reason: "CLI schema includes CLI flag metadata; MCP schema intentionally exposes the MCP argument projection."
  },
  {
    mcp: "config_show",
    reason: "CLI show preserves a redacted raw_text view; MCP show returns a parsed redacted document for tool clients."
  },
  {
    mcp: "gateway_status",
    reason: "CLI status includes system service-manager probes; MCP status currently reports listener/config state only."
  }
] as const;

function getMappedMcpToolNames(): Set<string> {
  return new Set(CLI_MCP_PARITY_MATRIX.flatMap((entry) => ("mcp" in entry ? [entry.mcp] : [])));
}

function getSharedReadStyleMcpToolNames(): string[] {
  const mappedMcpTools = getMappedMcpToolNames();
  return getToolDefinitions()
    .filter((tool) => tool.capability === "read" || READ_STYLE_PRIVILEGED_MCP_TOOLS.has(tool.name))
    .map((tool) => tool.name)
    .filter((toolName) => mappedMcpTools.has(toolName))
    .sort();
}

void test("CLI and MCP parity matrix explicitly accounts for every current CLI verb and MCP tool", () => {
  const cliCommands = getCliTopLevelCommandNames();
  const cliSurfaces = getCliVerbSurfaceNames();
  const mcpTools = getToolDefinitions().map((tool) => tool.name).sort();

  const mappedCliCommands = [...new Set(CLI_MCP_PARITY_MATRIX.map((entry) => entry.cli.split(" ")[0]))].sort();
  assert.deepEqual(
    cliCommands,
    mappedCliCommands,
    "Every top-level CLI command should have at least one verb-level parity entry."
  );

  const mappedCliSurfaces = CLI_MCP_PARITY_MATRIX.map((entry) => entry.cli).sort();
  assert.deepEqual(
    cliSurfaces,
    mappedCliSurfaces,
    "Every CLI verb should be explicitly marked shared-with-MCP or intentionally CLI-only."
  );

  for (const entry of CLI_MCP_PARITY_MATRIX) {
    if ("cliOnly" in entry) {
      assert.notEqual(entry.cliOnly.trim(), "", `CLI-only surface '${entry.cli}' must document why it is not MCP-exposed.`);
    }
  }

  const mappedMcpTools = CLI_MCP_PARITY_MATRIX.flatMap((entry) => ("mcp" in entry ? [entry.mcp] : [])).sort();
  const explicitMcpCoverage = [...mappedMcpTools, ...MCP_ONLY_TOOLS].sort();
  assert.deepEqual(
    mcpTools,
    explicitMcpCoverage,
    "Every MCP tool should be explicitly mapped to a CLI surface or intentionally marked MCP-only."
  );
});

void test("CLI and MCP read parity coverage explicitly exercises or explains every read-style tool", () => {
  const exercised = new Set(READ_DATA_PARITY_MCP_TOOLS);
  const excepted = new Set(READ_DATA_PARITY_EXCEPTIONS.map((entry) => entry.mcp));

  for (const exception of READ_DATA_PARITY_EXCEPTIONS) {
    assert.notEqual(exception.reason.trim(), "", `Read parity exception '${exception.mcp}' must document why data differs.`);
  }

  assert.deepEqual(
    [...exercised, ...excepted].sort(),
    getSharedReadStyleMcpToolNames(),
    "Every shared read-style MCP tool should be covered by a CLI/MCP data parity case or an explicit exception."
  );
});

void test("MCP schemas do not expose CLI-only include-secrets inspection controls", () => {
  for (const tool of getToolDefinitions()) {
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /include[_-]secrets/);
  }
});

void test("MCP optimize apply and restore schemas expose CLI post-action controls", () => {
  for (const toolName of ["optimize_apply", "optimize_restore"]) {
    const tool = getToolDefinitions().find((candidate) => candidate.name === toolName);
    assert.ok(tool);
    const properties = (tool.inputSchema["properties"] ?? {}) as Record<string, unknown>;
    assert.deepEqual(properties["reload"], { type: "boolean" });
    assert.deepEqual(properties["verify"], { type: "boolean" });
  }
});

void test("CLI and MCP rejection parity cases return matching error codes", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-rejection-parity-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-rejection-parity-mcp-");
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-rejection-parity-inputs-"));

  try {
    await withExampleConfigEnv(async () => {
      for (const rejectionCase of REJECTION_PARITY_CASES) {
        const context: RejectionParityContext = {
          cliConfigPath: cliConfig.configPath,
          mcpConfigPath: mcpConfig.configPath,
          tempDir
        };
        const cliPayload = await runCliJsonWithExit(
          rejectionCase.cli(context),
          rejectionCase.cliExitCode,
          rejectionCase.name
        );
        const { payload: mcpPayload, isError } = await callToolWithMetadata(
          rejectionCase.mcp,
          rejectionCase.mcpArgs(context),
          context.mcpConfigPath
        );

        assert.equal(isError, true, rejectionCase.name);
        assertSameMutationErrorCode(cliPayload, mcpPayload);
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP config/entity read tools return the same data payloads", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy(".tmp-switchmaxxer-cli-read-parity-config-", process.cwd(), {
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });

  const cases: Array<{
    cli: string[];
    mcp: string;
    args: Record<string, unknown>;
  }> = [
    { cli: ["config", "validate"], mcp: "config_validate", args: {} },
    { cli: ["models", "list"], mcp: "models_list", args: {} },
    { cli: ["models", "show", "gpt-4o-mini"], mcp: "models_show", args: { model_id: "gpt-4o-mini" } },
    { cli: ["providers", "list"], mcp: "providers_list", args: {} },
    { cli: ["providers", "show", "openai_direct"], mcp: "providers_show", args: { provider_id: "openai_direct" } },
    { cli: ["routes", "list"], mcp: "routes_list", args: {} },
    { cli: ["routes", "show", "gpt-4o-mini"], mcp: "routes_show", args: { route_id: "gpt-4o-mini" } },
    { cli: ["routes", "explain", "gpt-4o-mini"], mcp: "routes_explain", args: { route_id: "gpt-4o-mini" } },
    { cli: ["gateway", "health", "--check", "config"], mcp: "gateway_health", args: { check: "config" } }
  ];

  try {
    await withExampleConfigEnv(async () => {
      for (const parityCase of cases) {
        const cliPayload = await runCliJson([...parityCase.cli, "--json", "--config", configPath]);
        const mcpPayload = await callTool(parityCase.mcp, parityCase.args, configPath);
        assertSameSuccessDataPayload(cliPayload, mcpPayload);
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP gateway runtime config read tool returns the same data payload", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy(".tmp-switchmaxxer-cli-read-parity-gateway-", process.cwd(), {
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
  const runtimeConfigPayload = {
    source_file: "config.json",
    bind_host: "127.0.0.1",
    port: 4080,
    routes: ["gpt-4o-mini"],
    generated_at: "2026-04-18T14:40:00.000Z"
  };

  try {
    await withExampleConfigEnv(async () => {
      await withMockGatewayFetch(runtimeConfigPayload, async () => {
        const cliPayload = await runCliJson([
          "gateway",
          "runtime",
          "config",
          "--json",
          "--config",
          configPath
        ]);
        const mcpPayload = await callTool("gateway_runtime_config", {}, configPath);

        assertSameSuccessDataPayload(cliPayload, mcpPayload);
      });
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP observability read tools return the same data payloads", async () => {
  const { tempDir, configPath } = createSecureExampleConfigCopy(".tmp-switchmaxxer-cli-read-parity-observability-", process.cwd(), {
    mcpCapabilities: FULL_MCP_CAPABILITIES
  });
  const dbPath = path.join(tempDir, "observability.sqlite");
  const cases: Array<{
    cli: string[];
    mcp: string;
    args: Record<string, unknown>;
  }> = [
    {
      cli: ["trace", "list", "--route", "route-alpha", "--limit", "10", "--json"],
      mcp: "trace_list",
      args: { route_id: "route-alpha", limit: 10 }
    },
    {
      cli: ["trace", "show", READ_PARITY_TRACE_ID, "--json"],
      mcp: "trace_show",
      args: { trace_id: READ_PARITY_TRACE_ID }
    },
    {
      cli: ["trace", "stats", "--route", "route-alpha", "--json"],
      mcp: "trace_stats",
      args: { route_id: "route-alpha" }
    },
    {
      cli: ["trace", "observations", "--route", "route-alpha", "--limit", "10", "--json"],
      mcp: "trace_observations",
      args: { route_id: "route-alpha", limit: 10 }
    },
    {
      cli: ["trace", "verify", READ_PARITY_TRACE_ID, "--json"],
      mcp: "trace_verify",
      args: { trace_id: READ_PARITY_TRACE_ID }
    },
    {
      cli: ["trace", "repair", READ_PARITY_TRACE_ID, "--json"],
      mcp: "trace_repair",
      args: { trace_id: READ_PARITY_TRACE_ID }
    },
    {
      cli: ["bench", "list", "--limit", "10", "--json"],
      mcp: "bench_list",
      args: { limit: 10 }
    },
    {
      cli: ["bench", "show", READ_PARITY_BENCH_RUN_ID, "--json"],
      mcp: "bench_show",
      args: { run_id: READ_PARITY_BENCH_RUN_ID }
    },
    {
      cli: ["optimize", "list", "--limit", "10", "--json"],
      mcp: "optimize_list",
      args: { limit: 10 }
    },
    {
      cli: ["optimize", "show", READ_PARITY_OPTIMIZE_RUN_ID, "--json"],
      mcp: "optimize_show",
      args: { run_id: READ_PARITY_OPTIMIZE_RUN_ID }
    },
    {
      cli: [
        "ledger",
        "list",
        "--target",
        "gpt-4o-mini",
        "--target-kind",
        "model",
        "--operation",
        "models_create",
        "--limit",
        "10",
        "--json"
      ],
      mcp: "ledger_list",
      args: {
        target_id: "gpt-4o-mini",
        target_kind: "model",
        operation: "models_create",
        limit: 10
      }
    },
    {
      cli: ["ledger", "show", READ_PARITY_LEDGER_EVENT_ID, "--json"],
      mcp: "ledger_show",
      args: { ledger_event_id: READ_PARITY_LEDGER_EVENT_ID }
    }
  ];

  try {
    seedReadParityObservabilityStore(dbPath);

    await withEnvironmentVariables({
      ...EXAMPLE_CONFIG_ENV,
      SWITCHMAXXER_OBSERVABILITY_DB: dbPath
    }, async () => {
      for (const parityCase of cases) {
        const cliPayload = await runCliJson(parityCase.cli);
        const mcpPayload = await callTool(parityCase.mcp, parityCase.args, configPath);
        assertSameSuccessDataPayload(cliPayload, mcpPayload);
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP optimize cost return the same recommendation payload shape", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-optimize-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-optimize-mcp-");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  function normalizeOptimizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload["data"] as Record<string, unknown>;
    return {
      candidates: data["candidates"],
      reference_tokens: data["reference_tokens"],
      ranking: (data["ranking"] as Array<Record<string, unknown>>).map((entry) => ({
        rank: entry["rank"],
        route_id: entry["route_id"],
        score: entry["score"],
        cost_source: (entry["details"] as Record<string, unknown>)["cost_source"]
      })),
      winner: data["winner"]
    };
  }

  try {
    await withExampleConfigEnv(async () => {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(cliConfig.tempDir, "cli-observability.sqlite");
      const cliPayload = await runCliJson([
        "optimize",
        "--model",
        "gpt-4o-mini",
        "--objective",
        "cost",
        "--json",
        "--config",
        cliConfig.configPath
      ]);

      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(mcpConfig.tempDir, "mcp-observability.sqlite");
      const mcpPayload = await callTool("optimize_run", {
        model: "gpt-4o-mini",
        objective: "cost"
      }, mcpConfig.configPath);

      assertSameSuccessEnvelope(cliPayload, mcpPayload);
      assert.deepEqual(normalizeOptimizePayload(cliPayload), normalizeOptimizePayload(mcpPayload));
    });
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP optimize apply and restore expose the same mutation payload shape", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-optimize-apply-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-optimize-apply-mcp-");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  function routeProvider(configPath: string, routeId: string): string {
    const catalog = JSON.parse(readFileSync(path.join(path.dirname(configPath), "catalog.json"), "utf8")) as Record<string, unknown>;
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    return routes[routeId]?.["service_provider"] as string;
  }

  function makeOpenrouterCheapest(configPath: string): void {
    const catalogPath = path.join(path.dirname(configPath), "catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Record<string, unknown>;
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    routes["gpt-4o-mini"] = {
      ...(routes["gpt-4o-mini"] ?? {}),
      cost: {
        input: 9,
        output: 9,
        cache_read: 9,
        cache_write: 9
      }
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      cost: {
        input: 0.01,
        output: 0.01,
        cache_read: 0.01,
        cache_write: 0.01
      }
    };
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  }

  function normalizeApplyPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload["data"] as Record<string, unknown>;
    return {
      ok: payload["ok"],
      command: payload["command"],
      target_route: data["target_route"],
      winner_route: data["winner_route"],
      dry_run: data["dry_run"],
      changed: data["changed"],
      mutation: data["mutation"],
      before: data["before"],
      after: data["after"],
      has_snapshot: data["snapshot"] !== null,
      reload: data["reload"],
      verification: data["verification"],
      warnings: data["warnings"]
    };
  }

  function normalizeRestorePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload["data"] as Record<string, unknown>;
    const restorePoint = data["restore_point"] as Record<string, unknown>;
    return {
      ok: payload["ok"],
      command: payload["command"],
      target_route: data["target_route"],
      dry_run: data["dry_run"],
      changed: data["changed"],
      mutation: data["mutation"],
      restore_point_mutation: restorePoint["mutation"],
      before: data["before"],
      after: data["after"],
      has_snapshot: data["snapshot"] !== null,
      reload: data["reload"],
      verification: data["verification"],
      warnings: data["warnings"]
    };
  }

  try {
    await withExampleConfigEnv(async () => {
      assert.equal(routeProvider(cliConfig.configPath, "gpt-4o-mini"), "openai_direct");
      assert.equal(routeProvider(mcpConfig.configPath, "gpt-4o-mini"), "openai_direct");
      makeOpenrouterCheapest(cliConfig.configPath);
      makeOpenrouterCheapest(mcpConfig.configPath);

      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(cliConfig.tempDir, "cli-observability.sqlite");
      const cliRunPayload = await runCliJson([
        "optimize",
        "--model",
        "gpt-4o-mini",
        "--objective",
        "cost",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      const cliRunData = cliRunPayload["data"] as Record<string, unknown>;
      const cliRun = cliRunData["run"] as Record<string, unknown>;
      assert.equal((cliRunData["winner"] as Record<string, unknown>)["route_id"], "openrouter-gpt-4o-mini");
      const cliRunId = cliRun["run_id"] as string;

      const cliDryRunApplyPayload = await runCliJson([
        "optimize",
        "apply",
        cliRunId,
        "--route",
        "gpt-4o-mini",
        "--dry-run",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      assert.equal(routeProvider(cliConfig.configPath, "gpt-4o-mini"), "openai_direct");

      const cliApplyPayload = await runCliJson([
        "optimize",
        "apply",
        cliRunId,
        "--route",
        "gpt-4o-mini",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      assert.equal(routeProvider(cliConfig.configPath, "gpt-4o-mini"), "openrouter");

      const cliRestorePayload = await runCliJson([
        "optimize",
        "restore",
        cliRunId,
        "--route",
        "gpt-4o-mini",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      assert.equal(routeProvider(cliConfig.configPath, "gpt-4o-mini"), "openai_direct");

      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(mcpConfig.tempDir, "mcp-observability.sqlite");
      const mcpRunPayload = await callTool("optimize_run", {
        model: "gpt-4o-mini",
        objective: "cost"
      }, mcpConfig.configPath);
      const mcpRunData = mcpRunPayload["data"] as Record<string, unknown>;
      const mcpRun = mcpRunData["run"] as Record<string, unknown>;
      assert.equal((mcpRunData["winner"] as Record<string, unknown>)["route_id"], "openrouter-gpt-4o-mini");
      const mcpRunId = mcpRun["run_id"] as string;

      const mcpDryRunApplyPayload = await callTool("optimize_apply", {
        run_id: mcpRunId,
        route_id: "gpt-4o-mini",
        dry_run: true
      }, mcpConfig.configPath);
      assert.equal(routeProvider(mcpConfig.configPath, "gpt-4o-mini"), "openai_direct");

      const mcpApplyPayload = await callTool("optimize_apply", {
        run_id: mcpRunId,
        route_id: "gpt-4o-mini"
      }, mcpConfig.configPath);
      assert.equal(routeProvider(mcpConfig.configPath, "gpt-4o-mini"), "openrouter");

      const mcpRestorePayload = await callTool("optimize_restore", {
        run_id: mcpRunId,
        route_id: "gpt-4o-mini"
      }, mcpConfig.configPath);
      assert.equal(routeProvider(mcpConfig.configPath, "gpt-4o-mini"), "openai_direct");

      assertSameSuccessEnvelope(cliDryRunApplyPayload, mcpDryRunApplyPayload);
      assertSameSuccessEnvelope(cliApplyPayload, mcpApplyPayload);
      assertSameSuccessEnvelope(cliRestorePayload, mcpRestorePayload);
      assert.deepEqual(normalizeApplyPayload(cliDryRunApplyPayload), normalizeApplyPayload(mcpDryRunApplyPayload));
      assert.deepEqual(normalizeApplyPayload(cliApplyPayload), normalizeApplyPayload(mcpApplyPayload));
      assert.deepEqual(normalizeRestorePayload(cliRestorePayload), normalizeRestorePayload(mcpRestorePayload));
    });
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP models create return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-models-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-models-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPayload = await runCliJson([
        "models",
        "create",
        "parity-model",
        "--json",
        "--config",
        cliConfig.configPath,
        "--display-name",
        "Parity Model",
        "--model-creator",
        "switchmaxxer"
      ]);
      const mcpPayload = await callTool("models_create", {
        model_id: "parity-model",
        display_name: "Parity Model",
        model_creator: "switchmaxxer"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP models update return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-models-update-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-models-update-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "models",
        "create",
        "parity-model-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--display-name",
        "Original Model",
        "--model-creator",
        "switchmaxxer"
      ]);
      await callTool("models_create", {
        model_id: "parity-model-update",
        display_name: "Original Model",
        model_creator: "switchmaxxer"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "models",
        "update",
        "parity-model-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--display-name",
        "Updated Parity Model",
        "--model-creator",
        "switchmaxxer-updated"
      ]);
      const mcpPayload = await callTool("models_update", {
        model_id: "parity-model-update",
        display_name: "Updated Parity Model",
        model_creator: "switchmaxxer-updated"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP models delete return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-models-delete-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-models-delete-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "models",
        "create",
        "parity-model-delete",
        "--json",
        "--config",
        cliConfig.configPath,
        "--display-name",
        "Delete Model",
        "--model-creator",
        "switchmaxxer"
      ]);
      await callTool("models_create", {
        model_id: "parity-model-delete",
        display_name: "Delete Model",
        model_creator: "switchmaxxer"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "models",
        "delete",
        "parity-model-delete",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      const mcpPayload = await callTool("models_delete", {
        model_id: "parity-model-delete"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP providers create return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-providers-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-providers-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPayload = await runCliJson([
        "providers",
        "create",
        "parity-provider",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://example.invalid/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ]);
      const mcpPayload = await callTool("providers_create", {
        provider_id: "parity-provider",
        endpoint: "https://example.invalid/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP providers update return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-providers-update-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-providers-update-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "providers",
        "create",
        "parity-provider-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://example.invalid/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ]);
      await callTool("providers_create", {
        provider_id: "parity-provider-update",
        endpoint: "https://example.invalid/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "providers",
        "update",
        "parity-provider-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://api.example.invalid/v1/messages",
        "--api-mode",
        "anthropic-messages",
        "--anthropic-version",
        "2023-06-01",
        "--allow-private-endpoints"
      ]);
      const mcpPayload = await callTool("providers_update", {
        provider_id: "parity-provider-update",
        endpoint: "https://api.example.invalid/v1/messages",
        api_mode: "anthropic-messages",
        anthropic_version: "2023-06-01",
        allow_private_endpoints: true
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP providers delete return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-providers-delete-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-providers-delete-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "providers",
        "create",
        "parity-provider-delete",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://example.invalid/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ]);
      await callTool("providers_create", {
        provider_id: "parity-provider-delete",
        endpoint: "https://example.invalid/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "providers",
        "delete",
        "parity-provider-delete",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      const mcpPayload = await callTool("providers_delete", {
        provider_id: "parity-provider-delete"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP routes create return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-routes-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-routes-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPayload = await runCliJson([
        "routes",
        "create",
        "parity-route",
        "--json",
        "--config",
        cliConfig.configPath,
        "--model",
        "gpt-4o-mini",
        "--service-provider",
        "openai_direct",
        "--provider-model-id",
        "gpt-4o-mini",
        "--display-name",
        "Parity Route"
      ]);
      const mcpPayload = await callTool("routes_create", {
        route_id: "parity-route",
        model: "gpt-4o-mini",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        display_name: "Parity Route"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP routes update return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-routes-update-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-routes-update-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "routes",
        "create",
        "parity-route-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--model",
        "gpt-4o-mini",
        "--service-provider",
        "openai_direct",
        "--provider-model-id",
        "gpt-4o-mini",
        "--display-name",
        "Original Route"
      ]);
      await callTool("routes_create", {
        route_id: "parity-route-update",
        model: "gpt-4o-mini",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        display_name: "Original Route"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "routes",
        "update",
        "parity-route-update",
        "--json",
        "--config",
        cliConfig.configPath,
        "--display-name",
        "Updated Parity Route",
        "--provider-model-id",
        "gpt-4o-mini-2024-08-06",
        "--timeout-ms",
        "45000"
      ]);
      const mcpPayload = await callTool("routes_update", {
        route_id: "parity-route-update",
        display_name: "Updated Parity Route",
        provider_model_id: "gpt-4o-mini-2024-08-06",
        timeout_ms: 45000
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP routes delete return the same normalized data payload", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-routes-delete-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-routes-delete-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      await runCliJson([
        "routes",
        "create",
        "parity-route-delete",
        "--json",
        "--config",
        cliConfig.configPath,
        "--model",
        "gpt-4o-mini",
        "--service-provider",
        "openai_direct",
        "--provider-model-id",
        "gpt-4o-mini",
        "--display-name",
        "Delete Route"
      ]);
      await callTool("routes_create", {
        route_id: "parity-route-delete",
        model: "gpt-4o-mini",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        display_name: "Delete Route"
      }, mcpConfig.configPath);

      const cliPayload = await runCliJson([
        "routes",
        "delete",
        "parity-route-delete",
        "--json",
        "--config",
        cliConfig.configPath
      ]);
      const mcpPayload = await callTool("routes_delete", {
        route_id: "parity-route-delete"
      }, mcpConfig.configPath);

      assertSameSuccessDataPayload(cliPayload, mcpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP routes create return the same reference error envelopes", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-routes-reference-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-routes-reference-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliUnknownModelPayload = await runCliJsonWithExit([
        "routes",
        "create",
        "parity-route-unknown-model",
        "--json",
        "--config",
        cliConfig.configPath,
        "--model",
        "missing-model",
        "--service-provider",
        "openai_direct",
        "--provider-model-id",
        "gpt-4o-mini",
        "--display-name",
        "Unknown Model Route"
      ], 1);
      const mcpUnknownModelPayload = await callTool("routes_create", {
        route_id: "parity-route-unknown-model",
        model: "missing-model",
        service_provider: "openai_direct",
        provider_model_id: "gpt-4o-mini",
        display_name: "Unknown Model Route"
      }, mcpConfig.configPath);

      assert.deepEqual(cliUnknownModelPayload["error"], mcpUnknownModelPayload["error"]);

      const cliUnknownProviderPayload = await runCliJsonWithExit([
        "routes",
        "create",
        "parity-route-unknown-provider",
        "--json",
        "--config",
        cliConfig.configPath,
        "--model",
        "gpt-4o-mini",
        "--service-provider",
        "missing-provider",
        "--provider-model-id",
        "gpt-4o-mini",
        "--display-name",
        "Unknown Provider Route"
      ], 1);
      const mcpUnknownProviderPayload = await callTool("routes_create", {
        route_id: "parity-route-unknown-provider",
        model: "gpt-4o-mini",
        service_provider: "missing-provider",
        provider_model_id: "gpt-4o-mini",
        display_name: "Unknown Provider Route"
      }, mcpConfig.configPath);

      assert.deepEqual(cliUnknownProviderPayload["error"], mcpUnknownProviderPayload["error"]);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP model mutations share validation error codes", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-model-negative-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-model-negative-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const emptyCreatorInput = writeJsonInputFile(cliConfig.tempDir, "empty-model-creator.json", {
        name: "parity-model-empty-creator",
        display_name: "Empty Creator",
        model_creator: ""
      });
      const cliEmptyCreatorPayload = await runCliJsonWithExit([
        "models",
        "create",
        "--json",
        "--config",
        cliConfig.configPath,
        "--json-input",
        emptyCreatorInput
      ], 2);
      const mcpEmptyCreatorPayload = await callTool("models_create", {
        model_id: "parity-model-empty-creator",
        display_name: "Empty Creator",
        model_creator: ""
      }, mcpConfig.configPath);

      assertSameMutationErrorCode(cliEmptyCreatorPayload, mcpEmptyCreatorPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP provider mutations share validation error codes", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-provider-negative-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-provider-negative-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPrivateEndpointPayload = await runCliJsonWithExit([
        "providers",
        "create",
        "parity-provider-private-endpoint",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://127.0.0.1/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ], 1);
      const mcpPrivateEndpointPayload = await callTool("providers_create", {
        provider_id: "parity-provider-private-endpoint",
        endpoint: "https://127.0.0.1/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      assertSameMutationErrorCode(cliPrivateEndpointPayload, mcpPrivateEndpointPayload);

      const cliInsecureHttpPayload = await runCliJsonWithExit([
        "providers",
        "create",
        "parity-provider-insecure-http",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "http://example.invalid/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ], 1);
      const mcpInsecureHttpPayload = await callTool("providers_create", {
        provider_id: "parity-provider-insecure-http",
        endpoint: "http://example.invalid/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      assertSameMutationErrorCode(cliInsecureHttpPayload, mcpInsecureHttpPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP route mutations share validation error codes", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-route-negative-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-route-negative-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const invalidTimeoutInput = writeJsonInputFile(cliConfig.tempDir, "invalid-route-timeout.json", {
        timeout_ms: 0
      });
      const cliInvalidTimeoutPayload = await runCliJsonWithExit([
        "routes",
        "update",
        "gpt-4o-mini",
        "--json",
        "--config",
        cliConfig.configPath,
        "--json-input",
        invalidTimeoutInput
      ], 2);
      const mcpInvalidTimeoutPayload = await callTool("routes_update", {
        route_id: "gpt-4o-mini",
        timeout_ms: 0
      }, mcpConfig.configPath);

      assertSameMutationErrorCode(cliInvalidTimeoutPayload, mcpInvalidTimeoutPayload);

      const emptyProviderModelInput = writeJsonInputFile(cliConfig.tempDir, "empty-provider-model-id.json", {
        provider_model_id: ""
      });
      const cliEmptyProviderModelPayload = await runCliJsonWithExit([
        "routes",
        "update",
        "gpt-4o-mini",
        "--json",
        "--config",
        cliConfig.configPath,
        "--json-input",
        emptyProviderModelInput
      ], 2);
      const mcpEmptyProviderModelPayload = await callTool("routes_update", {
        route_id: "gpt-4o-mini",
        provider_model_id: ""
      }, mcpConfig.configPath);

      assertSameMutationErrorCode(cliEmptyProviderModelPayload, mcpEmptyProviderModelPayload);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP models update return the same error envelope for missing update fields", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-models-update-error-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-models-update-error-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPayload = await runCliJsonWithExit([
        "models",
        "update",
        "parity-model-error",
        "--json",
        "--config",
        cliConfig.configPath
      ], 2);
      const mcpPayload = await callTool("models_update", {
        model_id: "parity-model-error"
      }, mcpConfig.configPath);

      assert.deepEqual(cliPayload["error"], mcpPayload["error"]);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});

void test("CLI and MCP provider mutations share entity-validation failures", async () => {
  const cliConfig = createSecureExampleConfigCopy("switchmaxxer-cli-parity-provider-validation-cli-");
  const mcpConfig = createMutationParityMcpConfigCopy(".tmp-switchmaxxer-cli-parity-provider-validation-mcp-");

  try {
    await withExampleConfigEnv(async () => {
      const cliPayload = await runCliJsonWithExit([
        "providers",
        "create",
        "private-provider",
        "--json",
        "--config",
        cliConfig.configPath,
        "--endpoint",
        "https://127.0.0.1/v1/chat/completions",
        "--api-mode",
        "openai-completions",
        "--no-auth"
      ], 1);
      const mcpPayload = await callTool("providers_create", {
        provider_id: "private-provider",
        endpoint: "https://127.0.0.1/v1/chat/completions",
        api_mode: "openai-completions"
      }, mcpConfig.configPath);

      assert.deepEqual(cliPayload["error"], mcpPayload["error"]);
    });
  } finally {
    rmSync(cliConfig.tempDir, { recursive: true, force: true });
    rmSync(mcpConfig.tempDir, { recursive: true, force: true });
  }
});
