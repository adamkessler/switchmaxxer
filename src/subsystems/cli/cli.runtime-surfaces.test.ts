import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildErrorEnvelope } from "../../platform/response-envelope";
import type { AppConfig } from "../../platform/types";
import { run } from "../../index";
import { withLogWriters } from "../../platform/logger";
import { captureCliIo, parseCliEnvelope, runWithCapturedIo, test } from "./cli.test-support";
import { readLongFlagValue } from "./input-utils";
import { createInvokeRuntime } from "./invoke-runtime";
import { createTestRuntime } from "./test-runtime";
import { loadConfig } from "../config/config";
import {
  INVOKE_INSPECTION_REQUEST_HEADER,
  INVOKE_INSPECTION_RESPONSE_HEADER,
  INVOKE_INSPECTION_TOKEN_HEADER
} from "../gateway/invoke-inspection";
import { ObservabilityService } from "../observability/service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "../observability/store";
import { seedSuccessfulRequest } from "../observability/test-helpers";
import {
  catalogPathForConfigForTests,
  copyExampleConfigPairForTests,
  readJsonForTests,
  writeSecureJsonForTests
} from "../config/config-file.test-support";
import { getMcpHelpText } from "../mcp/mcp";

void test("runCli routes tool help through the tool command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["tool", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer tool/);
  assert.match(stdout, /date\s+Print today's local date/);
  assert.match(stdout, /uptime\s+Print the running gateway uptime/);
  assert.match(stdout, /random\s+Print a random number between 0 and 1/);
  assert.equal(stderr, "");
});

void test("runCli tool date prints today's date to stdout", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["tool", "date"]);

  assert.equal(result, 0);
  assert.match(stdout, /^\d{4}-\d{2}-\d{2}\n$/);
  assert.equal(stderr, "");
});

void test("runCli tool random prints a number between 0 and 1", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["tool", "random"]);

  assert.equal(result, 0);
  const value = Number.parseFloat(stdout.trim());
  assert.equal(Number.isFinite(value), true);
  assert.equal(value >= 0, true);
  assert.equal(value < 1, true);
  assert.equal(stderr, "");
});

void test("CLI command-family help surfaces include docs footers", async () => {
  const helpCases: Array<{ argv: string[]; docsPath: string }> = [
    { argv: ["config", "--help"], docsPath: "docs/subsystems/config/config-reference.md" },
    { argv: ["models", "--help"], docsPath: "docs/subsystems/config/config-reference.md" },
    { argv: ["providers", "--help"], docsPath: "docs/subsystems/config/config-reference.md" },
    { argv: ["routes", "--help"], docsPath: "docs/subsystems/config/config-reference.md" },
    { argv: ["gateway", "--help"], docsPath: "docs/subsystems/gateway/tech-spec-for-gateway.md" },
    { argv: ["mcp", "--help"], docsPath: "docs/subsystems/mcp/how-to-launch-switchmaxxer-mcp.md" },
    { argv: ["test", "--help"], docsPath: "docs/subsystems/cli/tech-spec-for-tools.md" },
    { argv: ["tool", "--help"], docsPath: "docs/subsystems/cli/tech-spec-for-tools.md" },
    { argv: ["invoke", "--help"], docsPath: "docs/subsystems/cli/tech-spec-for-tools.md" },
    { argv: ["bench", "--help"], docsPath: "docs/subsystems/observability/tech-spec-for-benchmarking.md" },
    { argv: ["optimize", "--help"], docsPath: "docs/subsystems/observability/tech-spec-for-optimize-command.md" },
    { argv: ["ledger", "--help"], docsPath: "docs/subsystems/observability/tech-spec-for-control-plane-audit-ledger.md" },
    { argv: ["trace", "--help"], docsPath: "docs/subsystems/observability/tech-spec-for-observation-semantics.md" },
    {
      argv: ["prune", "--help"],
      docsPath: "docs/subsystems/observability/tech-spec-for-observability-store-implementation.md"
    }
  ];

  for (const helpCase of helpCases) {
    const { result, stdout, stderr } = await runWithCapturedIo(helpCase.argv);

    assert.equal(result, 0, helpCase.argv.join(" "));
    assert.match(stdout, /^Docs:\n  docs\//m, helpCase.argv.join(" "));
    assert.match(stdout, new RegExp(helpCase.docsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), helpCase.argv.join(" "));
    assert.equal(stderr, "", helpCase.argv.join(" "));
  }
});

void test("MCP protocol help includes an operator docs footer", () => {
  const helpText = getMcpHelpText();

  assert.match(helpText, /^Docs:\n  docs\/subsystems\/mcp\/how-to-launch-switchmaxxer-mcp\.md$/m);
});

void test("runCli read-style commands honor --json with standard envelopes", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-json-contract-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousEnv = {
    dbPath: process.env["SWITCHMAXXER_OBSERVABILITY_DB"],
    inbound: process.env["SWITCHMAXXER_INBOUND_API_KEY"],
    openai: process.env["SWITCHMAXXER_OPENAI_API_KEY"],
    anthropic: process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"],
    openrouter: process.env["SWITCHMAXXER_OPENROUTER_API_KEY"],
    minimax: process.env["SWITCHMAXXER_MINIMAX_API_KEY"]
  };
  const cases: Array<{
    argv: string[];
    expectedExit: 0 | 1;
    command: string;
  }> = [
    { argv: ["config", "validate", "--config", configPath, "--json"], expectedExit: 0, command: "config validate" },
    { argv: ["config", "show", "--config", configPath, "--json"], expectedExit: 0, command: "config show" },
    { argv: ["config", "schema", "--json"], expectedExit: 0, command: "config schema" },
    { argv: ["config", "export", "--config", configPath, "--json"], expectedExit: 0, command: "config export" },
    { argv: ["models", "list", "--config", configPath, "--json"], expectedExit: 0, command: "models list" },
    { argv: ["models", "show", "gpt-4o-mini", "--config", configPath, "--json"], expectedExit: 0, command: "models show" },
    { argv: ["providers", "list", "--config", configPath, "--json"], expectedExit: 0, command: "providers list" },
    { argv: ["providers", "show", "openai_direct", "--config", configPath, "--json"], expectedExit: 0, command: "providers show" },
    { argv: ["routes", "list", "--config", configPath, "--json"], expectedExit: 0, command: "routes list" },
    { argv: ["routes", "show", "gpt-4o-mini", "--config", configPath, "--json"], expectedExit: 0, command: "routes show" },
    { argv: ["routes", "explain", "gpt-4o-mini", "--config", configPath, "--json"], expectedExit: 0, command: "routes explain" },
    { argv: ["trace", "list", "--limit", "10", "--json"], expectedExit: 0, command: "trace list" },
    { argv: ["trace", "show", "missing-trace-id", "--json"], expectedExit: 1, command: "trace show" },
    { argv: ["bench", "list", "--limit", "10", "--json"], expectedExit: 0, command: "bench list" },
    { argv: ["bench", "show", "missing-bench-run-id", "--json"], expectedExit: 1, command: "bench show" },
    { argv: ["optimize", "list", "--limit", "10", "--json"], expectedExit: 0, command: "optimize list" },
    { argv: ["optimize", "show", "missing-optimize-run-id", "--json"], expectedExit: 1, command: "optimize show" },
    { argv: ["ledger", "list", "--limit", "10", "--json"], expectedExit: 0, command: "ledger list" },
    { argv: ["ledger", "show", "missing-ledger-event-id", "--json"], expectedExit: 1, command: "ledger show" }
  ];

  try {
    copyExampleConfigPairForTests(configPath);
    const store = bootstrapObservabilityStore({ dbPath });
    closeObservabilityStore(store);
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";

    for (const contractCase of cases) {
      const { result, stdout, stderr } = await runWithCapturedIo(contractCase.argv);
      assert.equal(result, contractCase.expectedExit, contractCase.argv.join(" "));
      assert.equal(stderr, "", contractCase.argv.join(" "));
      const payload = parseCliEnvelope(stdout);
      assert.equal(payload["command"], contractCase.command);
      assert.equal(payload["ok"], contractCase.expectedExit === 0);
    }
  } finally {
    for (const [key, value] of [
      ["SWITCHMAXXER_OBSERVABILITY_DB", previousEnv.dbPath],
      ["SWITCHMAXXER_INBOUND_API_KEY", previousEnv.inbound],
      ["SWITCHMAXXER_OPENAI_API_KEY", previousEnv.openai],
      ["SWITCHMAXXER_ANTHROPIC_API_KEY", previousEnv.anthropic],
      ["SWITCHMAXXER_OPENROUTER_API_KEY", previousEnv.openrouter],
      ["SWITCHMAXXER_MINIMAX_API_KEY", previousEnv.minimax]
    ] as const) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli tool uptime returns a typed gateway_unavailable envelope when the gateway is not running", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-tool-uptime-"));
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousAnthropicKey = process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  const previousMiniMaxKey = process.env["SWITCHMAXXER_MINIMAX_API_KEY"];
  try {
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";
    const configPath = path.join(tempDir, "config.json");
    copyExampleConfigPairForTests(configPath);
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    config["port"] = 47831;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    chmodSync(configPath, 0o600);

    const { result, stdout, stderr } = await runWithCapturedIo(["tool", "uptime", "--config", configPath, "--json"]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      ok: boolean;
      command: string;
      schema_version: string;
      error: { code: string; message: string };
      details?: Record<string, unknown>;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.command, "tool uptime");
    assert.equal(payload.schema_version, "1");
    assert.equal(payload.error.code, "gateway_unavailable");
    assert.match(payload.error.message, /Unable to reach runtime config endpoint/);
    assert.equal(payload.details?.["source_file"], "config.json");
    assert.equal(payload.details?.["bind_host"], "127.0.0.1");
    assert.equal(payload.details?.["port"], 47831);
  } finally {
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    if (typeof previousOpenAiKey === "string") {
      process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENAI_API_KEY"];
    }
    if (typeof previousAnthropicKey === "string") {
      process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = previousAnthropicKey;
    } else {
      delete process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
    }
    if (typeof previousOpenRouterKey === "string") {
      process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = previousOpenRouterKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
    }
    if (typeof previousMiniMaxKey === "string") {
      process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = previousMiniMaxKey;
    } else {
      delete process.env["SWITCHMAXXER_MINIMAX_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize help exposes cost and latency recommendation surfaces", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["optimize", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer optimize/);
  assert.match(stdout, /estimated cost or measured latency/);
  assert.match(stdout, /--objective <name>/);
  assert.match(stdout, /--objective latency/);
  assert.match(stdout, /optimize restore <run-id> --route <route-id>/);
  assert.match(stdout, /optimize-history cleanup commands/);
  assert.match(stdout, /whole-store pruning/);
  assert.doesNotMatch(stdout, /optimize simulate/);
  assert.equal(stderr, "");
});

void test("runCli optimize list handles empty optimize-history records", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-list-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

  try {
    const emptyStore = bootstrapObservabilityStore({ dbPath });
    closeObservabilityStore(emptyStore);

    const { result, stdout, stderr } = await runWithCapturedIo(["optimize", "list", "--json"]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as {
      ok: boolean;
      command: string;
      count: number;
      data: {
        runs: unknown[];
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "optimize list");
    assert.equal(payload.count, 0);
    assert.deepEqual(payload.data.runs, []);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize cost ranks model-scoped routes without mutating config", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

  try {
    copyExampleConfigPairForTests(configPath);
    const config = readJsonForTests(configPath);
    config["bind_host"] = "127.0.0.2";
    config["port"] = 47832;
    writeSecureJsonForTests(configPath, config);
    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const models = catalog["models"] as Record<string, Record<string, unknown>>;
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    const directRoute = routes["gpt-4o-mini"];
    if (directRoute) {
      delete directRoute["cost"];
    }
    models["gpt-4o-mini"] = {
      ...(models["gpt-4o-mini"] ?? {}),
      cost: {
        input: 0.15,
        output: 0.6,
        cache_read: 0.075,
        cache_write: 0.15
      }
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      cost: {
        input: 0.3,
        output: 1.2,
        cache_read: 0.15,
        cache_write: 0.3
      }
    };
    writeSecureJsonForTests(catalogPath, catalog);

    const beforeCatalogText = readFileSync(catalogPath, "utf8");
    const { result, stdout, stderr } = await runWithCapturedIo([
      "optimize",
      "--model",
      "gpt-4o-mini",
      "--objective",
      "cost",
      "--config",
      configPath,
      "--json"
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.equal(readFileSync(catalogPath, "utf8"), beforeCatalogText);

    const payload = parseCliEnvelope(stdout) as unknown as {
      ok: boolean;
      command: string;
      count: number;
      data: {
        run: {
          run_id: string;
          persisted: boolean;
          created_at: string;
          finished_at: string;
          created_by: string;
          target_model: string;
          objective: string;
        };
        store_path: string;
        ranking: Array<{
          rank: number;
          route_id: string;
          score: number;
          details: {
            cost_source: string;
          };
        }>;
        winner: {
          route_id: string;
          score: number;
        };
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.command, "optimize");
    assert.equal(payload.count, 2);
    assert.equal(payload.data.run.persisted, true);
    assert.equal(typeof payload.data.run.run_id, "string");
    assert.equal(payload.data.run.created_by, "switchmaxxer optimize");
    assert.equal(payload.data.store_path, dbPath);
    assert.equal(payload.data.run.target_model, "gpt-4o-mini");
    assert.equal(payload.data.run.objective, "cost");
    assert.equal(payload.data.winner.route_id, "gpt-4o-mini");
    assert.equal(payload.data.ranking[0]?.route_id, "gpt-4o-mini");
    assert.equal(payload.data.ranking[0]?.rank, 1);
    assert.equal(payload.data.ranking[0]?.details.cost_source, "model");
    assert.equal(payload.data.ranking[1]?.route_id, "openrouter-gpt-4o-mini");
    assert.equal(payload.data.ranking[1]?.details.cost_source, "route");

    const listResult = await runWithCapturedIo(["optimize", "list", "--json"]);
    assert.equal(listResult.result, 0);
    assert.equal(listResult.stderr, "");
    const listPayload = parseCliEnvelope(listResult.stdout) as {
      ok: boolean;
      command: string;
      count: number;
      data: {
        runs: Array<{
          run_id: string;
          target_model: string;
          objective: string;
          winner_route: string;
        }>;
      };
    };
    assert.equal(listPayload.ok, true);
    assert.equal(listPayload.command, "optimize list");
    assert.equal(listPayload.count, 1);
    assert.equal(listPayload.data.runs[0]?.run_id, payload.data.run.run_id);
    assert.equal(listPayload.data.runs[0]?.target_model, "gpt-4o-mini");
    assert.equal(listPayload.data.runs[0]?.objective, "cost");
    assert.equal(listPayload.data.runs[0]?.winner_route, "gpt-4o-mini");

    const showResult = await runWithCapturedIo(["optimize", "show", payload.data.run.run_id, "--json"]);
    assert.equal(showResult.result, 0);
    assert.equal(showResult.stderr, "");
    const showPayload = parseCliEnvelope(showResult.stdout) as {
      ok: boolean;
      command: string;
      count: number;
      data: {
        run: {
          run_id: string;
          persisted: boolean;
        };
        winner: {
          route_id: string;
        };
        ranking: unknown[];
      };
    };
    assert.equal(showPayload.ok, true);
    assert.equal(showPayload.command, "optimize show");
    assert.equal(showPayload.count, 2);
    assert.equal(showPayload.data.run.run_id, payload.data.run.run_id);
    assert.equal(showPayload.data.run.persisted, true);
    assert.equal(showPayload.data.winner.route_id, "gpt-4o-mini");
    assert.equal(showPayload.data.ranking.length, 2);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize cost text output documents score units", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-text-"));
  const configPath = path.join(tempDir, "config.json");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(tempDir, "observability.sqlite");

  try {
    copyExampleConfigPairForTests(configPath);

    const { result, stdout, stderr } = await runWithCapturedIo([
      "optimize",
      "--model",
      "gpt-4o-mini",
      "--objective",
      "cost",
      "--config",
      configPath
    ]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Reference Tokens: input=1000 output=1000 cacheRead=0 cacheWrite=0/);
    assert.match(stdout, /Winner: .+ \([0-9.]+ USD\)/);
    assert.match(stdout, /\bSCORE_USD\b/);
    assert.doesNotMatch(stdout, /\bEST_USD\b/);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize apply mutates only the target route provider to the persisted winner", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-apply-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousEnv = {
    dbPath: process.env["SWITCHMAXXER_OBSERVABILITY_DB"],
    inbound: process.env["SWITCHMAXXER_INBOUND_API_KEY"],
    openai: process.env["SWITCHMAXXER_OPENAI_API_KEY"],
    anthropic: process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"],
    openrouter: process.env["SWITCHMAXXER_OPENROUTER_API_KEY"],
    minimax: process.env["SWITCHMAXXER_MINIMAX_API_KEY"]
  };
  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
  process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
  process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
  process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
  process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";

  try {
    copyExampleConfigPairForTests(configPath);
    const configDocument = readJsonForTests(configPath);
    configDocument["port"] = 49999;
    writeSecureJsonForTests(configPath, configDocument);
    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const routes = catalog["routes"] as Record<string, Record<string, unknown>>;
    routes["gpt-4o-mini"] = {
      ...(routes["gpt-4o-mini"] ?? {}),
      service_provider: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      cost: {
        input: 1,
        output: 1,
        cache_read: 1,
        cache_write: 1
      }
    };
    routes["openrouter-gpt-4o-mini"] = {
      ...(routes["openrouter-gpt-4o-mini"] ?? {}),
      service_provider: "openrouter",
      provider_model_id: "openai/gpt-4o-mini",
      cost: {
        input: 0.1,
        output: 0.1,
        cache_read: 0.1,
        cache_write: 0.1
      }
    };
    const originalTargetRoute = structuredClone(routes["gpt-4o-mini"]);
    writeSecureJsonForTests(catalogPath, catalog);

    const optimizeResult = await runWithCapturedIo([
      "optimize",
      "--model",
      "gpt-4o-mini",
      "--objective",
      "cost",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(optimizeResult.result, 0);
    assert.equal(optimizeResult.stderr, "");
    const optimizePayload = parseCliEnvelope(optimizeResult.stdout) as {
      data: {
        run: { run_id: string };
        winner: { route_id: string };
      };
    };
    assert.equal(optimizePayload.data.winner.route_id, "openrouter-gpt-4o-mini");

    const dryRunResult = await runWithCapturedIo([
      "optimize",
      "apply",
      optimizePayload.data.run.run_id,
      "--route",
      "gpt-4o-mini",
      "--config",
      configPath,
      "--dry-run",
      "--json"
    ]);
    assert.equal(dryRunResult.result, 0);
    assert.equal(dryRunResult.stderr, "");
    const dryRunPayload = parseCliEnvelope(dryRunResult.stdout) as {
      command: string;
      data: {
        dry_run: boolean;
        mutation: { from: string; to: string };
        after: { service_provider: string; api_mode: string };
      };
    };
    assert.equal(dryRunPayload.command, "optimize apply");
    assert.equal(dryRunPayload.data.dry_run, true);
    assert.deepEqual(dryRunPayload.data.mutation, {
      field: "service_provider",
      from: "openai_direct",
      to: "openrouter",
      service_provider: {
        changed: true,
        from: "openai_direct",
        to: "openrouter"
      },
      provider_model_id: {
        changed: true,
        from: "gpt-4o-mini",
        to: "openai/gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: { input: 1, output: 1, cache_read: 1, cache_write: 1 },
        to: { input: 0.1, output: 0.1, cache_read: 0.1, cache_write: 0.1 }
      }
    });
    assert.equal(dryRunPayload.data.after.service_provider, "openrouter");
    assert.equal(dryRunPayload.data.after.api_mode, "openai-completions");
    assert.deepEqual((readJsonForTests(catalogPath)["routes"] as Record<string, unknown>)["gpt-4o-mini"], originalTargetRoute);
    const dryRunLedgerDb = new DatabaseSync(dbPath);
    const dryRunLedgerRow = dryRunLedgerDb
      .prepare(
        `
          SELECT source_surface, operation, status, target_id, optimization_run_id, mutation_event_id
          FROM control_plane_action_events
          WHERE operation = 'optimize_apply'
            AND status = 'dry_run_succeeded'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get() as {
        source_surface?: string;
        operation?: string;
        status?: string;
        target_id?: string;
        mutation_event_id?: string | null;
      } | undefined;
    dryRunLedgerDb.close();
    assert.equal(dryRunLedgerRow?.source_surface, "cli");
    assert.equal(dryRunLedgerRow?.operation, "optimize_apply");
    assert.equal(dryRunLedgerRow?.status, "dry_run_succeeded");
    assert.equal(dryRunLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(dryRunLedgerRow?.mutation_event_id, null);

    const applyResult = await runWithCapturedIo([
      "optimize",
      "apply",
      optimizePayload.data.run.run_id,
      "--route",
      "gpt-4o-mini",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(applyResult.result, 0);
    assert.equal(applyResult.stderr, "");
    const applyPayload = parseCliEnvelope(applyResult.stdout) as {
      data: {
        dry_run: boolean;
        changed: boolean;
        action_id: string | null;
        snapshot: {
          source_kind: string;
          snapshot_id: string;
          source_path: string;
          content_sha256: string;
          content_bytes: number;
        } | null;
        mutation: { from: string; to: string };
      };
    };
    assert.equal(applyPayload.data.dry_run, false);
    assert.equal(applyPayload.data.changed, true);
    assert.equal(typeof applyPayload.data.action_id, "string");
    assert.equal(applyPayload.data.snapshot?.source_kind, "catalog");
    assert.equal(typeof applyPayload.data.snapshot?.snapshot_id, "string");
    assert.equal(applyPayload.data.snapshot?.source_path, catalogPath);
    assert.equal(typeof applyPayload.data.snapshot?.content_sha256, "string");
    assert.equal(typeof applyPayload.data.snapshot?.content_bytes, "number");
    assert.deepEqual(applyPayload.data.mutation, {
      field: "service_provider",
      from: "openai_direct",
      to: "openrouter",
      service_provider: {
        changed: true,
        from: "openai_direct",
        to: "openrouter"
      },
      provider_model_id: {
        changed: true,
        from: "gpt-4o-mini",
        to: "openai/gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: { input: 1, output: 1, cache_read: 1, cache_write: 1 },
        to: { input: 0.1, output: 0.1, cache_read: 0.1, cache_write: 0.1 }
      }
    });
    const applySnapshotDb = new DatabaseSync(dbPath);
    const applySnapshotRow = applySnapshotDb
      .prepare("SELECT content_json FROM config_snapshots WHERE id = ?")
      .get(applyPayload.data.snapshot?.snapshot_id ?? "") as { content_json?: string } | undefined;
    const applyEventRow = applySnapshotDb
      .prepare("SELECT snapshot_id, operation, target_id FROM config_mutation_events WHERE id = ?")
      .get(applyPayload.data.action_id ?? "") as { snapshot_id?: string; operation?: string; target_id?: string } | undefined;
    const applyLedgerRow = applySnapshotDb
      .prepare("SELECT source_surface, operation, status, mutation_event_id FROM control_plane_action_events WHERE mutation_event_id = ?")
      .get(applyPayload.data.action_id ?? "") as {
        source_surface?: string;
        operation?: string;
        status?: string;
        mutation_event_id?: string | null;
      } | undefined;
    applySnapshotDb.close();
    assert.equal(applyEventRow?.operation, "optimize_apply");
    assert.equal(applyEventRow?.target_id, "gpt-4o-mini");
    assert.equal(applyEventRow?.snapshot_id, applyPayload.data.snapshot?.snapshot_id);
    assert.equal(applyLedgerRow?.source_surface, "cli");
    assert.equal(applyLedgerRow?.operation, "optimize_apply");
    assert.equal(applyLedgerRow?.status, "succeeded");
    assert.equal(applyLedgerRow?.mutation_event_id, applyPayload.data.action_id);
    const snapshotCatalog = JSON.parse(applySnapshotRow?.content_json ?? "{}") as Record<string, unknown>;
    const snapshotRoute = (snapshotCatalog["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.deepEqual(snapshotRoute, originalTargetRoute);

    const writtenCatalog = readJsonForTests(catalogPath);
    const writtenRoute = (writtenCatalog["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.deepEqual(writtenRoute, {
      ...originalTargetRoute,
      service_provider: "openrouter",
      provider_model_id: "openai/gpt-4o-mini",
      cost: { input: 0.1, output: 0.1, cache_read: 0.1, cache_write: 0.1 }
    });
    const loaded = loadConfig(configPath);
    assert.equal(loaded.routes["gpt-4o-mini"]?.serviceProvider, "openrouter");
    assert.equal(loaded.routes["gpt-4o-mini"]?.api_mode, "openai-completions");

    const restoreDryRunResult = await runWithCapturedIo([
      "optimize",
      "restore",
      applyPayload.data.action_id ?? "",
      "--config",
      configPath,
      "--dry-run",
      "--json"
    ]);
    assert.equal(restoreDryRunResult.result, 0);
    assert.equal(restoreDryRunResult.stderr, "");
    const restoreDryRunPayload = parseCliEnvelope(restoreDryRunResult.stdout) as {
      command: string;
      data: {
        dry_run: boolean;
        changed: boolean;
        restore_point: {
          action_id: string;
          snapshot: { snapshot_id: string } | null;
        };
        mutation: { field: string; from: string; to: string };
        after: { service_provider: string; api_mode: string };
      };
    };
    assert.equal(restoreDryRunPayload.command, "optimize restore");
    assert.equal(restoreDryRunPayload.data.dry_run, true);
    assert.equal(restoreDryRunPayload.data.changed, true);
    assert.equal(restoreDryRunPayload.data.restore_point.action_id, applyPayload.data.action_id);
    assert.equal(restoreDryRunPayload.data.restore_point.snapshot?.snapshot_id, applyPayload.data.snapshot?.snapshot_id);
    assert.deepEqual(restoreDryRunPayload.data.mutation, {
      field: "service_provider",
      from: "openrouter",
      to: "openai_direct",
      service_provider: {
        changed: true,
        from: "openrouter",
        to: "openai_direct"
      },
      provider_model_id: {
        changed: true,
        from: "openai/gpt-4o-mini",
        to: "gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: { input: 0.1, output: 0.1, cache_read: 0.1, cache_write: 0.1 },
        to: { input: 1, output: 1, cache_read: 1, cache_write: 1 }
      }
    });
    assert.equal(restoreDryRunPayload.data.after.service_provider, "openai_direct");
    assert.equal(restoreDryRunPayload.data.after.api_mode, "openai-completions");
    assert.equal(
      ((readJsonForTests(catalogPath)["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"])?.["service_provider"],
      "openrouter"
    );
    const restoreDryRunLedgerDb = new DatabaseSync(dbPath);
    const restoreDryRunLedgerRow = restoreDryRunLedgerDb
      .prepare(
        `
          SELECT source_surface, operation, status, target_id, optimization_run_id, mutation_event_id
          FROM control_plane_action_events
          WHERE operation = 'optimize_restore'
            AND status = 'dry_run_succeeded'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get() as {
        source_surface?: string;
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
        mutation_event_id?: string | null;
      } | undefined;
    restoreDryRunLedgerDb.close();
    assert.equal(restoreDryRunLedgerRow?.source_surface, "cli");
    assert.equal(restoreDryRunLedgerRow?.operation, "optimize_restore");
    assert.equal(restoreDryRunLedgerRow?.status, "dry_run_succeeded");
    assert.equal(restoreDryRunLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(restoreDryRunLedgerRow?.optimization_run_id, optimizePayload.data.run.run_id);
    assert.equal(restoreDryRunLedgerRow?.mutation_event_id, null);

    const restoreResult = await runWithCapturedIo([
      "optimize",
      "restore",
      applyPayload.data.action_id ?? "",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(restoreResult.result, 0);
    assert.equal(restoreResult.stderr, "");
    const restorePayload = parseCliEnvelope(restoreResult.stdout) as {
      data: {
        dry_run: boolean;
        changed: boolean;
        action_id: string | null;
        snapshot: {
          source_kind: string;
          snapshot_id: string;
          source_path: string;
        } | null;
        mutation: { field: string; from: string; to: string };
      };
    };
    assert.equal(restorePayload.data.dry_run, false);
    assert.equal(restorePayload.data.changed, true);
    assert.equal(typeof restorePayload.data.action_id, "string");
    assert.equal(restorePayload.data.snapshot?.source_kind, "catalog");
    assert.equal(restorePayload.data.snapshot?.source_path, catalogPath);
    assert.deepEqual(restorePayload.data.mutation, {
      field: "service_provider",
      from: "openrouter",
      to: "openai_direct",
      service_provider: {
        changed: true,
        from: "openrouter",
        to: "openai_direct"
      },
      provider_model_id: {
        changed: true,
        from: "openai/gpt-4o-mini",
        to: "gpt-4o-mini"
      },
      cost: {
        changed: true,
        from: { input: 0.1, output: 0.1, cache_read: 0.1, cache_write: 0.1 },
        to: { input: 1, output: 1, cache_read: 1, cache_write: 1 }
      }
    });
    const restoreSnapshotDb = new DatabaseSync(dbPath);
    const restoreSnapshotRow = restoreSnapshotDb
      .prepare("SELECT content_json FROM config_snapshots WHERE id = ?")
      .get(restorePayload.data.snapshot?.snapshot_id ?? "") as { content_json?: string } | undefined;
    const restoreEventRow = restoreSnapshotDb
      .prepare("SELECT parent_event_id, operation, target_id FROM config_mutation_events WHERE id = ?")
      .get(restorePayload.data.action_id ?? "") as { parent_event_id?: string; operation?: string; target_id?: string } | undefined;
    const restoreLedgerRow = restoreSnapshotDb
      .prepare("SELECT source_surface, operation, status, target_id, optimization_run_id, mutation_event_id FROM control_plane_action_events WHERE mutation_event_id = ?")
      .get(restorePayload.data.action_id ?? "") as {
        source_surface?: string;
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
        mutation_event_id?: string | null;
      } | undefined;
    restoreSnapshotDb.close();
    assert.equal(restoreEventRow?.operation, "optimize_restore");
    assert.equal(restoreEventRow?.target_id, "gpt-4o-mini");
    assert.equal(restoreEventRow?.parent_event_id, applyPayload.data.action_id);
    assert.equal(restoreLedgerRow?.source_surface, "cli");
    assert.equal(restoreLedgerRow?.operation, "optimize_restore");
    assert.equal(restoreLedgerRow?.status, "succeeded");
    assert.equal(restoreLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(restoreLedgerRow?.optimization_run_id, optimizePayload.data.run.run_id);
    assert.equal(restoreLedgerRow?.mutation_event_id, restorePayload.data.action_id);
    const restoreSnapshotCatalog = JSON.parse(restoreSnapshotRow?.content_json ?? "{}") as Record<string, unknown>;
    const restoreSnapshotRoute = (restoreSnapshotCatalog["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.equal(restoreSnapshotRoute?.["service_provider"], "openrouter");

    const restoredCatalog = readJsonForTests(catalogPath);
    const restoredRoute = (restoredCatalog["routes"] as Record<string, Record<string, unknown>>)["gpt-4o-mini"];
    assert.deepEqual(restoredRoute, originalTargetRoute);
    const staleRestoreResult = await runWithCapturedIo([
      "optimize",
      "restore",
      optimizePayload.data.run.run_id,
      "--route",
      "gpt-4o-mini",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(staleRestoreResult.result, 1);
    assert.equal(staleRestoreResult.stderr, "");
    const staleRestorePayload = parseCliEnvelope(staleRestoreResult.stdout) as {
      error: { code: string; message: string };
    };
    assert.equal(staleRestorePayload.error.code, APP_ERROR_CODES.optimizeError);
    assert.match(staleRestorePayload.error.message, /currently uses provider 'openai_direct'/);
    const failedRestoreLedgerDb = new DatabaseSync(dbPath);
    const failedRestoreLedgerRow = failedRestoreLedgerDb
      .prepare(
        `
          SELECT operation, status, target_id, optimization_run_id, mutation_event_id
          FROM control_plane_action_events
          WHERE operation = 'optimize_restore'
            AND status = 'failed'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get() as {
        operation?: string;
        status?: string;
        target_id?: string | null;
        optimization_run_id?: string | null;
        mutation_event_id?: string | null;
      } | undefined;
    failedRestoreLedgerDb.close();
    assert.equal(failedRestoreLedgerRow?.operation, "optimize_restore");
    assert.equal(failedRestoreLedgerRow?.status, "failed");
    assert.equal(failedRestoreLedgerRow?.target_id, "gpt-4o-mini");
    assert.equal(failedRestoreLedgerRow?.optimization_run_id, optimizePayload.data.run.run_id);
    assert.equal(failedRestoreLedgerRow?.mutation_event_id, null);

    writtenRoute["service_provider"] = "openai_direct";
    writeSecureJsonForTests(catalogPath, writtenCatalog);
    const checkedApplyResult = await runWithCapturedIo([
      "optimize",
      "apply",
      optimizePayload.data.run.run_id,
      "--route",
      "gpt-4o-mini",
      "--config",
      configPath,
      "--verify",
      "--json"
    ]);
    assert.equal(checkedApplyResult.result, 1);
    assert.equal(checkedApplyResult.stderr, "");
    const checkedApplyPayload = parseCliEnvelope(checkedApplyResult.stdout) as {
      ok: boolean;
      warnings?: string[];
      data: {
        changed: boolean;
        reload: null;
        verification: { status: string; exit_code: number; message: string };
        warnings: string[];
      };
    };
    assert.equal(checkedApplyPayload.ok, true);
    assert.equal(checkedApplyPayload.data.changed, true);
    assert.equal(checkedApplyPayload.data.reload, null);
    assert.equal(checkedApplyPayload.data.verification.status, "failed");
    assert.equal(checkedApplyPayload.data.verification.exit_code, 1);
    assert.match(checkedApplyPayload.data.verification.message, /verification failed|gateway|Gateway|Unable to reach/);
    assert.equal(checkedApplyPayload.data.warnings.length >= 1, true);
    assert.equal((checkedApplyPayload.warnings?.length ?? 0) >= 1, true);
  } finally {
    for (const [key, value] of [
      ["SWITCHMAXXER_OBSERVABILITY_DB", previousEnv.dbPath],
      ["SWITCHMAXXER_INBOUND_API_KEY", previousEnv.inbound],
      ["SWITCHMAXXER_OPENAI_API_KEY", previousEnv.openai],
      ["SWITCHMAXXER_ANTHROPIC_API_KEY", previousEnv.anthropic],
      ["SWITCHMAXXER_OPENROUTER_API_KEY", previousEnv.openrouter],
      ["SWITCHMAXXER_MINIMAX_API_KEY", previousEnv.minimax]
    ] as const) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli ledger list and show inspect Control Plane Audit Ledger events", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-ledger-read-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    service.controlPlaneActions.createEvent({
      id: "ledger-cli-read-test",
      created_at: "2026-04-27T10:00:00.000Z",
      finished_at: "2026-04-27T10:00:01.000Z",
      created_by: "test-suite",
      source_surface: "mcp",
      actor_kind: "agent",
      actor_id: null,
      session_id: "session-a",
      operation: "optimize_apply",
      status: "failed",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: "run-ledger-cli",
      mutation_event_id: null,
      correlation_ids_json: "{\"schema_version\":\"1\",\"run_id\":\"run-ledger-cli\"}",
      result_json: "{}",
      error_json: "{\"schema_version\":\"1\",\"code\":\"route_not_found\"}",
      metadata_json: "{\"schema_version\":\"1\",\"dry_run\":false}"
    });
    closeObservabilityStore(store);

    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;

    const listResult = await runWithCapturedIo([
      "ledger",
      "list",
      "--surface",
      "mcp",
      "--session-id",
      "session-a",
      "--status",
      "failed",
      "--json"
    ]);
    assert.equal(listResult.result, 0);
    assert.equal(listResult.stderr, "");
    const listPayload = parseCliEnvelope(listResult.stdout) as {
      command: string;
      count: number;
      data: {
        events: Array<Record<string, unknown>>;
      };
    };
    assert.equal(listPayload.command, "ledger list");
    assert.equal(listPayload.count, 1);
    assert.equal(listPayload.data.events[0]?.["ledger_event_id"], "ledger-cli-read-test");
    assert.equal(listPayload.data.events[0]?.["status"], "failed");
    assert.equal(Object.hasOwn(listPayload.data.events[0] ?? {}, "error"), false);

    const showResult = await runWithCapturedIo(["ledger", "show", "ledger-cli-read-test", "--json"]);
    assert.equal(showResult.result, 0);
    assert.equal(showResult.stderr, "");
    const showPayload = parseCliEnvelope(showResult.stdout) as {
      command: string;
      data: {
        event: Record<string, unknown>;
      };
    };
    const shownError = showPayload.data.event["error"] as Record<string, unknown>;
    assert.equal(showPayload.command, "ledger show");
    assert.equal(showPayload.data.event["ledger_event_id"], "ledger-cli-read-test");
    assert.equal(shownError["code"], "route_not_found");

    const missingResult = await runWithCapturedIo(["ledger", "show", "missing-ledger-event", "--json"]);
    assert.equal(missingResult.result, 1);
    assert.equal(missingResult.stderr, "");
    const missingPayload = parseCliEnvelope(missingResult.stdout) as {
      error: { code: string };
    };
    assert.equal(missingPayload.error.code, APP_ERROR_CODES.ledgerNotFound);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli config mutations write Control Plane Audit Ledger events", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-mutation-ledger-"));
  const configPath = path.join(tempDir, "config.json");
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];
  const previousOpenAiKey = process.env["SWITCHMAXXER_OPENAI_API_KEY"];
  const previousAnthropicKey = process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
  const previousOpenRouterKey = process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
  const previousMiniMaxKey = process.env["SWITCHMAXXER_MINIMAX_API_KEY"];

  try {
    copyExampleConfigPairForTests(configPath);
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    process.env["SWITCHMAXXER_INBOUND_API_KEY"] = "0123456789abcdef0123456789abcdef";
    process.env["SWITCHMAXXER_OPENAI_API_KEY"] = "test-openai-key";
    process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = "test-anthropic-key";
    process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = "test-openrouter-key";
    process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = "test-minimax-key";

    const createResult = await runWithCapturedIo([
      "models",
      "create",
      "ledger-audit-model",
      "--display-name",
      "Ledger Audit Model",
      "--model-creator",
      "test-suite",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(createResult.result, 0, createResult.stdout || createResult.stderr);

    const failedUpdate = await runWithCapturedIo([
      "models",
      "update",
      "definitely-missing-ledger-model",
      "--display-name",
      "Nope",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(failedUpdate.result, 1);

    const store = bootstrapObservabilityStore({ dbPath });
    try {
      const service = new ObservabilityService(store.db);
      const successEvents = service.controlPlaneActions.listEvents({
        operation: "models_create",
        targetKind: "model",
        targetId: "ledger-audit-model"
      });
      assert.equal(successEvents.length, 1);
      assert.equal(successEvents[0]?.status, "succeeded");
      assert.equal(successEvents[0]?.source_surface, "cli");

      const failedEvents = service.controlPlaneActions.listEvents({
        operation: "models_update",
        targetKind: "model",
        targetId: "definitely-missing-ledger-model"
      });
      assert.equal(failedEvents.length, 1);
      assert.equal(failedEvents[0]?.status, "failed");
      assert.match(failedEvents[0]?.error_json ?? "", /model_not_found/);
    } finally {
      closeObservabilityStore(store);
    }
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    if (typeof previousOpenAiKey === "string") {
      process.env["SWITCHMAXXER_OPENAI_API_KEY"] = previousOpenAiKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENAI_API_KEY"];
    }
    if (typeof previousAnthropicKey === "string") {
      process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"] = previousAnthropicKey;
    } else {
      delete process.env["SWITCHMAXXER_ANTHROPIC_API_KEY"];
    }
    if (typeof previousOpenRouterKey === "string") {
      process.env["SWITCHMAXXER_OPENROUTER_API_KEY"] = previousOpenRouterKey;
    } else {
      delete process.env["SWITCHMAXXER_OPENROUTER_API_KEY"];
    }
    if (typeof previousMiniMaxKey === "string") {
      process.env["SWITCHMAXXER_MINIMAX_API_KEY"] = previousMiniMaxKey;
    } else {
      delete process.env["SWITCHMAXXER_MINIMAX_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli ledger commands emit typed observability error codes for invalid store paths", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-ledger-error-test-"));
  const invalidStorePath = path.join(tempDir, "observability.txt");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = invalidStorePath;

    const listResult = await runWithCapturedIo(["ledger", "list", "--json"]);
    assert.equal(listResult.result, 1);
    assert.equal((parseCliEnvelope(listResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.ledgerListError);

    const showResult = await runWithCapturedIo(["ledger", "show", "ledger-123", "--json"]);
    assert.equal(showResult.result, 1);
    assert.equal((parseCliEnvelope(showResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.ledgerShowError);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize json covers cost-only error contracts", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-errors-"));
  const configPath = path.join(tempDir, "config.json");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = path.join(tempDir, "observability.sqlite");

  async function runOptimizeJson(args: string[]) {
    const result = await runWithCapturedIo(["optimize", ...args, "--json", "--config", configPath]);
    assert.equal(result.stderr, "");
    return {
      result: result.result,
      payload: parseCliEnvelope(result.stdout) as unknown as {
        ok: boolean;
        error: {
          code: string;
          message: string;
        };
      }
    };
  }

  try {
    copyExampleConfigPairForTests(configPath);
    const catalogPath = catalogPathForConfigForTests(configPath);
    const catalog = readJsonForTests(catalogPath);
    const models = catalog["models"] as Record<string, Record<string, unknown>>;
    models["empty-model"] = {
      display_name: "Empty Model",
      model_creator: "test"
    };
    writeSecureJsonForTests(catalogPath, catalog);

    const noCandidates = await runOptimizeJson(["--model", "empty-model", "--objective", "cost"]);
    assert.equal(noCandidates.result, 1);
    assert.equal(noCandidates.payload.error.code, APP_ERROR_CODES.optimizeNoCandidates);

    const insufficientCandidates = await runOptimizeJson(["--model", "llama3.2", "--objective", "cost"]);
    assert.equal(insufficientCandidates.result, 1);
    assert.equal(insufficientCandidates.payload.error.code, APP_ERROR_CODES.optimizeInsufficientCandidates);

    const routeMismatch = await runOptimizeJson([
      "--model",
      "gpt-4o-mini",
      "--objective",
      "cost",
      "--routes",
      "openrouter-claude-sonnet-4-6,gpt-4o-mini"
    ]);
    assert.equal(routeMismatch.result, 1);
    assert.equal(routeMismatch.payload.error.code, APP_ERROR_CODES.optimizeRouteModelMismatch);

    const costlessCatalog = readJsonForTests(catalogPath);
    const costlessModels = costlessCatalog["models"] as Record<string, Record<string, unknown>>;
    const costlessRoutes = costlessCatalog["routes"] as Record<string, Record<string, unknown>>;
    delete costlessModels["gpt-4o-mini"]?.["cost"];
    delete costlessRoutes["gpt-4o-mini"]?.["cost"];
    delete costlessRoutes["openrouter-gpt-4o-mini"]?.["cost"];
    writeSecureJsonForTests(catalogPath, costlessCatalog);

    const noCostData = await runOptimizeJson(["--model", "gpt-4o-mini", "--objective", "cost"]);
    assert.equal(noCostData.result, 1);
    assert.equal(noCostData.payload.error.code, APP_ERROR_CODES.optimizeObjectiveNoData);

    const missingConfigResult = await runWithCapturedIo([
      "optimize",
      "--model",
      "gpt-4o-mini",
      "--objective",
      "cost",
      "--json",
      "--config",
      path.join(tempDir, "missing-config.json")
    ]);
    assert.equal(missingConfigResult.result, 1);
    assert.equal(missingConfigResult.stderr, "");
    assert.equal(
      (parseCliEnvelope(missingConfigResult.stdout) as { error: { code: string } }).error.code,
      APP_ERROR_CODES.optimizeError
    );

    const missingRunResult = await runWithCapturedIo(["optimize", "show", "missing-run", "--json"]);
    assert.equal(missingRunResult.result, 1);
    assert.equal(missingRunResult.stderr, "");
    assert.equal(
      (parseCliEnvelope(missingRunResult.stdout) as { error: { code: string } }).error.code,
      APP_ERROR_CODES.optimizeNotFound
    );

    const missingRestorePointResult = await runWithCapturedIo([
      "optimize",
      "restore",
      "missing-run",
      "--route",
      "gpt-4o-mini",
      "--config",
      configPath,
      "--json"
    ]);
    assert.equal(missingRestorePointResult.result, 1);
    assert.equal(missingRestorePointResult.stderr, "");
    assert.equal(
      (parseCliEnvelope(missingRestorePointResult.stdout) as { error: { code: string } }).error.code,
      APP_ERROR_CODES.optimizeNotFound
    );

    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = tempDir;
    const listFailure = await runWithCapturedIo(["optimize", "list", "--json"]);
    assert.equal(listFailure.result, 1);
    assert.equal(listFailure.stderr, "");
    assert.equal(
      (parseCliEnvelope(listFailure.stdout) as { error: { code: string } }).error.code,
      APP_ERROR_CODES.optimizeListError
    );

    const showFailure = await runWithCapturedIo(["optimize", "show", "missing-run", "--json"]);
    assert.equal(showFailure.result, 1);
    assert.equal(showFailure.stderr, "");
    assert.equal(
      (parseCliEnvelope(showFailure.stdout) as { error: { code: string } }).error.code,
      APP_ERROR_CODES.optimizeShowError
    );
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli optimize prune, delete, and clear manage optimize-history records only", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-optimize-history-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  function seedOptimizeRun(service: ObservabilityService, runId: string, createdAt: string): void {
    service.optimizations.createRun({
      id: runId,
      created_at: createdAt,
      finished_at: createdAt,
      created_by: "test-suite",
      target_model: "gpt-4o-mini",
      objective: "cost",
      status: "completed",
      winner_route: "openrouter-gpt-4o-mini",
      benchmark_run_id: null,
      settings_json: "{}",
      candidate_snapshot_json: "{}",
      result_json: "{}",
      warnings_json: "[]"
    });
    service.configMutations.createSnapshot({
      id: `snapshot-${runId}`,
      created_at: createdAt,
      created_by: "test-suite",
      source_kind: "catalog",
      source_path: path.join(tempDir, "catalog.json"),
      content_sha256: `sha-${runId}`,
      content_json: "{\"catalog_version\":1}",
      content_bytes: 21,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: `event-${runId}`,
      created_at: createdAt,
      created_by: "test-suite",
      source_surface: "cli",
      operation: "optimize_apply",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: runId,
      snapshot_id: `snapshot-${runId}`,
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openrouter\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    });
  }

  function seedUnrelatedConfigMutation(service: ObservabilityService): void {
    service.configMutations.createSnapshot({
      id: "snapshot-unrelated-config-edit",
      created_at: "1999-01-01T00:00:00.000Z",
      created_by: "test-suite",
      source_kind: "catalog",
      source_path: path.join(tempDir, "catalog.json"),
      content_sha256: "sha-unrelated-config-edit",
      content_json: "{\"catalog_version\":1}",
      content_bytes: 21,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: "event-unrelated-config-edit",
      created_at: "1999-01-01T00:00:00.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      operation: "manual_config_edit",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      snapshot_id: "snapshot-unrelated-config-edit",
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openai_direct\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    });
  }

  function seedBenchmarkRun(service: ObservabilityService): void {
    const requestId = "req-optimize-cleanup-bench-survivor";
    seedSuccessfulRequest(service, requestId);
    service.benchmarks.createRun({
      id: "optimize-cleanup-bench-survivor",
      name: "optimize-cleanup-bench-survivor",
      created_at: "2000-01-01T00:00:00.000Z",
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: "{}",
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: "sample-optimize-cleanup-bench-survivor",
      benchmark_run_id: "optimize-cleanup-bench-survivor",
      request_execution_id: requestId,
      route_id: "gpt-4o-mini",
      provider_id: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      sample_index: 0,
      started_at: "2000-01-01T00:00:00.000Z",
      completed_at: "2000-01-01T00:00:00.000Z",
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 100,
      ttft_ms: 10,
      duration_ms: 100,
      input_tokens: 5,
      output_tokens: 5,
      total_tokens: 10,
      estimated_cost_micros: 1,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: null
    });
  }

  function rowCount(tableName: string): number {
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | undefined;
      return row?.count ?? 0;
    } finally {
      db.close();
    }
  }

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedOptimizeRun(service, "old-optimize-run", "2000-01-01T00:00:00.000Z");
    seedOptimizeRun(service, "new-optimize-run", "2999-01-01T00:00:00.000Z");
    seedOptimizeRun(service, "clear-optimize-run-a", "2999-01-02T00:00:00.000Z");
    seedOptimizeRun(service, "clear-optimize-run-b", "2999-01-03T00:00:00.000Z");
    seedUnrelatedConfigMutation(service);
    seedBenchmarkRun(service);
    closeObservabilityStore(store);

    const pruneResult = await runWithCapturedIo(["optimize", "prune", "--older-than", "30d", "--json"]);
    assert.equal(pruneResult.result, 0);
    const prunePayload = parseCliEnvelope(pruneResult.stdout) as {
      data: {
        scope: string;
        older_than: string;
        result: {
          optimization_runs_deleted: number;
          config_mutation_events_deleted: number;
          config_snapshots_deleted: number;
          total_deleted: number;
        };
      };
    };
    assert.equal(prunePayload.data.scope, "older_than");
    assert.equal(prunePayload.data.older_than, "30d");
    assert.deepEqual(prunePayload.data.result, {
      optimization_runs_deleted: 1,
      config_mutation_events_deleted: 1,
      config_snapshots_deleted: 1,
      total_deleted: 3
    });
    assert.equal(rowCount("optimization_runs"), 3);
    assert.equal(rowCount("config_mutation_events"), 4);
    assert.equal(rowCount("config_snapshots"), 4);
    assert.equal(rowCount("benchmark_runs"), 1);
    assert.equal(rowCount("benchmark_samples"), 1);

    const deleteResult = await runWithCapturedIo(["optimize", "delete", "new-optimize-run", "--json"]);
    assert.equal(deleteResult.result, 0);
    const deletePayload = parseCliEnvelope(deleteResult.stdout) as {
      data: { result: { total_deleted: number } };
    };
    assert.equal(deletePayload.data.result.total_deleted, 3);
    assert.equal(rowCount("optimization_runs"), 2);
    assert.equal(rowCount("config_mutation_events"), 3);
    assert.equal(rowCount("config_snapshots"), 3);
    assert.equal(rowCount("benchmark_runs"), 1);
    assert.equal(rowCount("benchmark_samples"), 1);

    const clearResult = await runWithCapturedIo(["optimize", "clear", "--json"]);
    assert.equal(clearResult.result, 0);
    const clearPayload = parseCliEnvelope(clearResult.stdout) as {
      data: { result: { optimization_runs_deleted: number; total_deleted: number } };
    };
    assert.equal(clearPayload.data.result.optimization_runs_deleted, 2);
    assert.equal(clearPayload.data.result.total_deleted, 6);
    assert.equal(rowCount("optimization_runs"), 0);
    assert.equal(rowCount("config_mutation_events"), 1);
    assert.equal(rowCount("config_snapshots"), 1);
    assert.equal(rowCount("benchmark_runs"), 1);
    assert.equal(rowCount("benchmark_samples"), 1);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli bench prune, delete, and clear manage benchmark history only", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-bench-history-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  function seedBenchmarkRun(service: ObservabilityService, runId: string, createdAt: string): void {
    const requestId = `req-${runId}`;
    seedSuccessfulRequest(service, requestId);
    service.benchmarks.createRun({
      id: runId,
      name: runId,
      created_at: createdAt,
      created_by: "test-suite",
      objective: "route_benchmark",
      notes: null,
      settings_json: "{}",
      status: "completed"
    });
    service.benchmarks.insertSample({
      id: `sample-${runId}`,
      benchmark_run_id: runId,
      request_execution_id: requestId,
      route_id: "gpt-4o-mini",
      provider_id: "openai_direct",
      provider_model_id: "gpt-4o-mini",
      sample_index: 0,
      started_at: createdAt,
      completed_at: createdAt,
      status_code: 200,
      outcome: "succeeded",
      latency_ms: 100,
      ttft_ms: 10,
      duration_ms: 100,
      input_tokens: 5,
      output_tokens: 5,
      total_tokens: 10,
      estimated_cost_micros: 1,
      is_warmup: 0,
      score_value: null,
      score_scale: null,
      score_direction: null,
      score_source: null,
      score_method: null,
      scored_at: null,
      score_json: null
    });
  }

  function rowCount(tableName: string): number {
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | undefined;
      return row?.count ?? 0;
    } finally {
      db.close();
    }
  }

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    seedBenchmarkRun(service, "old-bench-run", "2000-01-01T00:00:00.000Z");
    seedBenchmarkRun(service, "new-bench-run", "2999-01-01T00:00:00.000Z");
    seedBenchmarkRun(service, "clear-bench-run-a", "2999-01-02T00:00:00.000Z");
    seedBenchmarkRun(service, "clear-bench-run-b", "2999-01-03T00:00:00.000Z");
    closeObservabilityStore(store);

    const missingDeleteResult = await runWithCapturedIo(["bench", "delete", "missing-bench-run", "--json"]);
    assert.equal(missingDeleteResult.result, 1);
    const missingDeletePayload = parseCliEnvelope(missingDeleteResult.stdout) as {
      ok: boolean;
      command: string;
      error: { code: string; message: string };
      details: { run_id: string; store_path: string };
    };
    assert.equal(missingDeletePayload.ok, false);
    assert.equal(missingDeletePayload.command, "bench delete");
    assert.equal(missingDeletePayload.error.code, APP_ERROR_CODES.benchNotFound);
    assert.equal(missingDeletePayload.error.message, "Benchmark run 'missing-bench-run' was not found");
    assert.equal(missingDeletePayload.details.run_id, "missing-bench-run");
    assert.equal(missingDeletePayload.details.store_path, dbPath);
    assert.equal(rowCount("benchmark_runs"), 4);
    assert.equal(rowCount("benchmark_samples"), 4);

    const pruneResult = await runWithCapturedIo(["bench", "prune", "--older-than", "30d", "--json"]);
    assert.equal(pruneResult.result, 0);
    const prunePayload = parseCliEnvelope(pruneResult.stdout) as {
      data: {
        scope: string;
        older_than: string;
        result: {
          benchmark_runs_deleted: number;
          benchmark_samples_deleted: number;
          total_deleted: number;
        };
      };
    };
    assert.equal(prunePayload.data.scope, "older_than");
    assert.equal(prunePayload.data.older_than, "30d");
    assert.deepEqual(prunePayload.data.result, {
      benchmark_runs_deleted: 1,
      benchmark_samples_deleted: 1,
      total_deleted: 2
    });
    assert.equal(rowCount("benchmark_runs"), 3);
    assert.equal(rowCount("benchmark_samples"), 3);
    assert.equal(rowCount("request_executions"), 4);

    const deleteResult = await runWithCapturedIo(["bench", "delete", "new-bench-run", "--json"]);
    assert.equal(deleteResult.result, 0);
    const deletePayload = parseCliEnvelope(deleteResult.stdout) as {
      data: { result: { total_deleted: number } };
    };
    assert.equal(deletePayload.data.result.total_deleted, 2);
    assert.equal(rowCount("benchmark_runs"), 2);
    assert.equal(rowCount("benchmark_samples"), 2);
    assert.equal(rowCount("request_executions"), 4);

    const clearResult = await runWithCapturedIo(["bench", "clear", "--json"]);
    assert.equal(clearResult.result, 0);
    const clearPayload = parseCliEnvelope(clearResult.stdout) as {
      data: { result: { benchmark_runs_deleted: number; benchmark_samples_deleted: number; total_deleted: number } };
    };
    assert.equal(clearPayload.data.result.benchmark_runs_deleted, 2);
    assert.equal(clearPayload.data.result.benchmark_samples_deleted, 2);
    assert.equal(clearPayload.data.result.total_deleted, 4);
    assert.equal(rowCount("benchmark_runs"), 0);
    assert.equal(rowCount("benchmark_samples"), 0);
    assert.equal(rowCount("request_executions"), 4);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli hides unsupported config migrate scaffolding from config help", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "--help"]);

  assert.equal(result, 0);
  assert.doesNotMatch(stdout, /config migrate/);
  assert.equal(stderr, "");
});

void test("runCli help topics include optimize once the recommendation surface is implemented", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["help"]);

  assert.equal(result, 0);
  assert.match(stdout, /\n  optimize\s+Recommend, apply, or restore a route provider for a model/);
  assert.equal(stderr, "");
});

void test("runCli enforces declarative unsupported metadata for config migrate", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["config", "migrate"]);

  assert.equal(result, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /config migrate is currently unsupported: config migration is not implemented yet/);
});

void test("runCli routes mcp help through the mcp command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["mcp", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer mcp/);
  assert.match(stdout, /mcp serve/);
  assert.match(stdout, /mcp capabilities/);
  assert.match(stdout, /serve\s+Run the MCP stdio server/);
  assert.match(stdout, /capabilities\s+Show granted MCP capabilities and visible tools/);
  assert.match(stdout, /invoke surface is intentionally CLI-only/i);
  assert.equal(stderr, "");
});

void test("runCli mcp capabilities reports granted capabilities and visible tools", async () => {
  const tempDir = mkdtempSync(path.join(process.cwd(), ".tmp-switchmaxxer-cli-mcp-capabilities-"));
  const configPath = path.join(tempDir, "config.json");
  const previousEnv = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries({
    SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef",
    SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key",
    SWITCHMAXXER_ANTHROPIC_API_KEY: "test-anthropic-key",
    SWITCHMAXXER_OPENROUTER_API_KEY: "test-openrouter-key",
    SWITCHMAXXER_MINIMAX_API_KEY: "test-minimax-key"
  })) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    copyExampleConfigPairForTests(configPath);
    const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    document["mcp"] = {
      capabilities: ["read", "mutation"]
    };
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    chmodSync(configPath, 0o600);

    const { result, stdout, stderr } = await runWithCapturedIo([
      "mcp",
      "capabilities",
      "--config",
      configPath,
      "--json"
    ]);
    const payload = parseCliEnvelope(stdout);
    const data = payload["data"] as Record<string, unknown>;
    const enabledTools = data["enabled_tools"] as string[];
    const disabledTools = data["disabled_tools"] as string[];

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.equal(payload["command"], "mcp capabilities");
    assert.deepEqual(data["capabilities"], ["read", "mutation"]);
    assert.ok(enabledTools.includes("config_show"));
    assert.ok(enabledTools.includes("models_create"));
    assert.ok(enabledTools.includes("providers_create"));
    assert.ok(disabledTools.includes("providers_set_key"));
    assert.ok(disabledTools.includes("providers_set_key_env"));
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli routes mcp serve usage errors through captured stderr", async () => {
  let loggedStderr = "";
  const { result, stdout, stderr } = await withLogWriters(
    {
      stderr: (message) => {
        loggedStderr += message;
      }
    },
    async () => await runWithCapturedIo(["mcp", "serve", "--config"])
  );

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.equal(stderr, "");
  assert.match(loggedStderr, /Flag '--config' requires a value/);
});

void test("runCli bench read commands keep benchmark error-code contracts wired", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-bench-contracts-"));

  assert.equal(APP_ERROR_CODES.benchListError, "bench_list_error");
  assert.equal(APP_ERROR_CODES.benchShowError, "bench_show_error");

  try {
    const listResult = await captureCliIo(
      async (io) =>
        await run(["bench", "list", "--json"], {
          ...io,
          env: {
            ...io.env,
            SWITCHMAXXER_OBSERVABILITY_DB: ""
          },
          cwd: () => tempDir
        })
    );

    assert.equal(listResult.result, 0);

    const showResult = await captureCliIo(
      async (io) =>
        await run(["bench", "show", "run-123", "--json"], {
          ...io,
          env: {
            ...io.env,
            SWITCHMAXXER_OBSERVABILITY_DB: ""
          },
          cwd: () => tempDir
        })
    );

    assert.equal(showResult.result, 1);
    const payload = parseCliEnvelope(showResult.stdout) as unknown as {
      ok: boolean;
      command: string;
      schema_version: string;
      error: { code: string; message: string };
      details: { store_path: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.command, "bench show");
    assert.equal(payload.schema_version, "1");
    assert.equal(payload.error.code, APP_ERROR_CODES.benchNotFound);
    assert.equal(payload.error.message, "Benchmark run 'run-123' was not found");
    assert.equal(typeof payload.details.store_path, "string");
    assert.match(payload.details.store_path, /\.switchmaxxer\/observability\.sqlite$/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli trace commands emit typed observability error codes for invalid store paths", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-trace-error-test-"));
  const invalidStorePath = path.join(tempDir, "observability.sqlite");
  mkdirSync(invalidStorePath, { recursive: true });

  async function runTraceWithInvalidStore(argv: string[]) {
    return await captureCliIo(
      async (io) =>
        await run(argv, {
          ...io,
          env: {
            ...io.env,
            SWITCHMAXXER_OBSERVABILITY_DB: invalidStorePath
          }
        })
    );
  }

  try {
    const listResult = await runTraceWithInvalidStore(["trace", "list", "--json"]);
    assert.equal(listResult.result, 1);
    assert.equal((parseCliEnvelope(listResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.traceListError);

    const showResult = await runTraceWithInvalidStore(["trace", "show", "trace-123", "--json"]);
    assert.equal(showResult.result, 1);
    assert.equal((parseCliEnvelope(showResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.traceShowError);

    const statsResult = await runTraceWithInvalidStore(["trace", "stats", "--json"]);
    assert.equal(statsResult.result, 1);
    assert.equal((parseCliEnvelope(statsResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.traceStatsError);

    const observationsResult = await runTraceWithInvalidStore(["trace", "observations", "--json"]);
    assert.equal(observationsResult.result, 1);
    assert.equal((parseCliEnvelope(observationsResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.traceObservationsError);

    const verifyResult = await runTraceWithInvalidStore(["trace", "verify", "--all", "--json"]);
    assert.equal(verifyResult.result, 1);
    assert.equal((parseCliEnvelope(verifyResult.stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.traceVerifyError);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli prune applies whole-store observability retention with config fallback", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-prune-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const configPath = path.join(tempDir, "config.json");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    copyExampleConfigPairForTests(configPath);
    const config = readJsonForTests(configPath);
    config["observability"] = {
      retention: {
        older_than: "30d"
      }
    };
    writeSecureJsonForTests(configPath, config);

    const store = bootstrapObservabilityStore({ dbPath });
    closeObservabilityStore(store);

    const { result, stdout, stderr } = await runWithCapturedIo(["prune", "--config", configPath, "--json"]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as {
      command: string;
      data: {
        store_path: string;
        older_than: string;
        result: {
          status: string;
          cutoff_at: string;
          failure_stage: string | null;
          failure_message: string | null;
          observations_deleted: number;
          request_executions_deleted: number;
          benchmark_runs_deleted: number;
          benchmark_samples_deleted: number;
          cost_facts_deleted: number;
          optimization_facts_deleted: number;
          control_plane_action_events_deleted: number;
          config_mutation_events_deleted: number;
          config_snapshots_deleted: number;
          total_deleted: number;
        };
      };
      count: number;
    };
    assert.equal(payload.command, "prune");
    assert.equal(payload.data.store_path, dbPath);
    assert.equal(payload.data.older_than, "30d");
    assert.equal(payload.data.result.status, "completed");
    assert.equal(typeof payload.data.result.cutoff_at, "string");
    assert.equal(payload.data.result.failure_stage, null);
    assert.equal(payload.data.result.failure_message, null);
    assert.equal(payload.data.result.observations_deleted, 0);
    assert.equal(payload.data.result.request_executions_deleted, 0);
    assert.equal(payload.data.result.benchmark_runs_deleted, 0);
    assert.equal(payload.data.result.benchmark_samples_deleted, 0);
    assert.equal(payload.data.result.cost_facts_deleted, 0);
    assert.equal(payload.data.result.optimization_facts_deleted, 0);
    assert.equal(payload.data.result.control_plane_action_events_deleted, 0);
    assert.equal(payload.data.result.config_mutation_events_deleted, 0);
    assert.equal(payload.data.result.config_snapshots_deleted, 0);
    assert.equal(payload.data.result.total_deleted, 0);
    assert.equal(payload.count, 0);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli prune --older-than applies whole-store retention and reports every delete count", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-prune-direct-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  function rowCount(tableName: string): number {
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number } | undefined;
      return row?.count ?? 0;
    } finally {
      db.close();
    }
  }

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    service.configMutations.createSnapshot({
      id: "snapshot-old-whole-store-prune",
      created_at: "2000-01-01T00:00:00.000Z",
      created_by: "test-suite",
      source_kind: "catalog",
      source_path: path.join(tempDir, "catalog.json"),
      content_sha256: "sha-old-whole-store-prune",
      content_json: "{\"catalog_version\":1}",
      content_bytes: 21,
      retention_expires_at: null
    });
    service.configMutations.createEvent({
      id: "event-old-whole-store-prune",
      created_at: "2000-01-01T00:00:00.000Z",
      created_by: "test-suite",
      source_surface: "cli",
      operation: "manual_config_edit",
      status: "succeeded",
      target_kind: "route",
      target_id: "gpt-4o-mini",
      optimization_run_id: null,
      snapshot_id: "snapshot-old-whole-store-prune",
      parent_event_id: null,
      before_json: "{\"service_provider\":\"openai_direct\"}",
      after_json: "{\"service_provider\":\"openai_direct\"}",
      metadata_json: "{\"schema_version\":\"1\"}"
    });
    closeObservabilityStore(store);

    const { result, stdout, stderr } = await runWithCapturedIo(["prune", "--older-than", "30d", "--json"]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as {
      command: string;
      data: {
        store_path: string;
        older_than: string;
        result: {
          status: string;
          cutoff_at: string;
          failure_stage: string | null;
          failure_message: string | null;
          observations_deleted: number;
          request_executions_deleted: number;
          benchmark_runs_deleted: number;
          benchmark_samples_deleted: number;
          cost_facts_deleted: number;
          optimization_facts_deleted: number;
          control_plane_action_events_deleted: number;
          config_mutation_events_deleted: number;
          config_snapshots_deleted: number;
          total_deleted: number;
        };
      };
      count: number;
    };
    assert.equal(payload.command, "prune");
    assert.equal(payload.data.store_path, dbPath);
    assert.equal(payload.data.older_than, "30d");
    assert.equal(payload.data.result.status, "completed");
    assert.equal(typeof payload.data.result.cutoff_at, "string");
    assert.equal(payload.data.result.failure_stage, null);
    assert.equal(payload.data.result.failure_message, null);
    assert.equal(payload.data.result.observations_deleted, 0);
    assert.equal(payload.data.result.request_executions_deleted, 0);
    assert.equal(payload.data.result.benchmark_runs_deleted, 0);
    assert.equal(payload.data.result.benchmark_samples_deleted, 0);
    assert.equal(payload.data.result.cost_facts_deleted, 0);
    assert.equal(payload.data.result.optimization_facts_deleted, 0);
    assert.equal(payload.data.result.control_plane_action_events_deleted, 0);
    assert.equal(payload.data.result.config_mutation_events_deleted, 1);
    assert.equal(payload.data.result.config_snapshots_deleted, 1);
    assert.equal(payload.data.result.total_deleted, 2);
    assert.equal(payload.count, 2);
    assert.equal(rowCount("config_mutation_events"), 0);
    assert.equal(rowCount("config_snapshots"), 0);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli prune emits typed observability error codes for invalid store paths", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-prune-error-test-"));
  const invalidStorePath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  mkdirSync(invalidStorePath, { recursive: true });

  try {
    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = invalidStorePath;
    const { result, stdout, stderr } = await runWithCapturedIo(["prune", "--older-than", "30d", "--json"]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as {
      command: string;
      error: { code: string };
    };
    assert.equal(payload.command, "prune");
    assert.equal(payload.error.code, APP_ERROR_CODES.pruneError);
  } finally {
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli providers set-key json emits stdin_read_error when stdin reading fails", async () => {
  const { result, stdout, stderr } = await captureCliIo(async (io) =>
    await run([
      "providers",
      "set-key",
      "provider_id",
      "--json",
      "--api-key-stdin"
    ], {
      ...io,
      stdin: {
        isTTY: false,
        readAllSync: () => {
          throw new Error("stdin exploded");
        },
        readAll: async () => "unused"
      }
    })
  );

  assert.equal(result, 1);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "providers set-key",
    schema_version: "1",
    error: {
      code: APP_ERROR_CODES.stdinReadError,
      message: "stdin exploded"
    }
  });
});

void test("runCli invoke json emits invoke_error when inbound auth env is missing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const inboundEnv = "SWITCHMAXXER_TEST_INBOUND_API_KEY";
  const previousInboundEnv = process.env[inboundEnv];

  try {
    copyExampleConfigPairForTests(configPath);
    const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    document["inbound_api_key_env"] = inboundEnv;
    delete document["allow_unauthenticated_gateway"];
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
    chmodSync(configPath, 0o600);
    delete process.env[inboundEnv];

    const { result, stdout, stderr } = await runWithCapturedIo([
      "invoke",
      "--route",
      "gpt-4o-mini",
      "--prompt",
      "hello",
      "--json",
      "--config",
      configPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.deepEqual(parseCliEnvelope(stdout), {
      ok: false,
      command: "invoke",
      schema_version: "1",
      error: {
        code: APP_ERROR_CODES.invokeError,
        message: `The selected config file requires inbound gateway auth via env var '${inboundEnv}', but it is not set or is empty.`
      }
    });
  } finally {
    if (typeof previousInboundEnv === "string") {
      process.env[inboundEnv] = previousInboundEnv;
    } else {
      delete process.env[inboundEnv];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli invoke rejects partial numeric flag tokens", async () => {
  const cases: Array<{ flag: string; value: string; message: RegExp }> = [
    { flag: "--temperature", value: "0.7x", message: /Flag '--temperature' must be numeric/ },
    { flag: "--max-tokens", value: "32x", message: /Flag '--max-tokens' must be a positive integer/ },
    { flag: "--timeout-ms", value: "1000ms", message: /Flag '--timeout-ms' must be a positive integer/ }
  ];

  for (const { flag, value, message } of cases) {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "invoke",
      "--route",
      "demo-route",
      "--prompt",
      "hello",
      flag,
      value
    ]);

    assert.equal(result, 2, `${flag}=${value}`);
    assert.equal(stdout, "", `${flag}=${value}`);
    assert.match(stderr, message, `${flag}=${value}`);
  }
});

void test("runCli invoke enforces inspect mode flag boundaries", async () => {
  const cases: Array<{ args: string[]; message: RegExp }> = [
    { args: ["--inspect", "--stream"], message: /Flag combination '--inspect --stream' is not supported/ },
    { args: ["--inspect", "--json"], message: /Flag combination '--inspect --json' is not supported/ },
    { args: ["--include-secrets"], message: /Flag '--include-secrets' requires '--inspect'/ }
  ];

  for (const { args, message } of cases) {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "invoke",
      "--route",
      "demo-route",
      "--prompt",
      "hello",
      ...args
    ]);

    assert.equal(result, 2, args.join(" "));
    if (args.includes("--json")) {
      assert.match(stdout, message, args.join(" "));
      assert.equal(stderr, "", args.join(" "));
    } else {
      assert.equal(stdout, "", args.join(" "));
      assert.match(stderr, message, args.join(" "));
    }
  }
});

void test("invoke runtime inspect uses server-allocated inspection ids", async () => {
  const originalFetch = globalThis.fetch;
  const inspectionId = "44444444-4444-4444-8444-444444444444";
  const inspectionToken = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const observedRequests: Array<{ url: string; method: string; headers: Headers }> = [];
  let stdout = "";
  let stderr = "";
  const runtime = createInvokeRuntime({
    readLongFlagValue,
    printUsageError: (message) => {
      stderr += `${message}\n`;
    },
    readCliStdin: async () => "hello",
    loadCliReadModel: () => ({
      routesByName: {
        demo: {
          api_mode: "openai-completions"
        }
      }
    }),
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {
        port: 47831,
        allow_unauthenticated_gateway: true
      }
    }),
    buildLocalGatewayAuthHeaders: () => new Headers([["x-switchmaxxer-local-client", "1"]]),
    writeJsonErrorEnvelope: () => {
      throw new Error("writeJsonErrorEnvelope should not be called");
    },
    writeJsonSuccessEnvelope: () => {
      throw new Error("writeJsonSuccessEnvelope should not be called");
    },
    writeStderr: (message) => {
      stderr += message;
    },
    writeStdout: (message) => {
      stdout += message;
    },
    defaultCliFetchTimeoutMs: 1000,
    routeNotFoundCode: APP_ERROR_CODES.routeNotFound
  });

  try {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      observedRequests.push({ url, method, headers });

      if (url.includes("/__switchmaxxer/runtime/inspect/")) {
        assert.equal(url, `http://127.0.0.1:47831/__switchmaxxer/runtime/inspect/${inspectionId}`);
        assert.equal(headers.get(INVOKE_INSPECTION_TOKEN_HEADER), inspectionToken);

        return new Response(
          `${JSON.stringify({
            data: {
              capture: {
                id: inspectionId,
                created_at: "2026-05-02T00:00:00.000Z",
                completed_at: "2026-05-02T00:00:01.000Z",
                include_secrets: false,
                client_to_smx: null,
                smx_to_provider: null,
                provider_to_smx: null,
                smx_to_client: null
              }
            }
          })}\n`,
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8"
            }
          }
        );
      }

      return new Response(
        `${JSON.stringify({
          id: "chatcmpl-cli-inspect",
          choices: [
            {
              message: {
                role: "assistant",
                content: "hello from cli inspect"
              }
            }
          ]
        })}\n`,
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            [INVOKE_INSPECTION_RESPONSE_HEADER]: inspectionId,
            [INVOKE_INSPECTION_TOKEN_HEADER]: inspectionToken
          }
        }
      );
    }) as typeof fetch;

    const result = await runtime.runInvoke(["--route", "demo", "--prompt", "hello", "--inspect"]);

    assert.equal(result, 0);
    assert.equal(stderr, "");
    assert.match(stdout, new RegExp(`Invoke inspection: ${inspectionId}`));
    assert.equal(observedRequests.length, 2);
    assert.equal(observedRequests[0]?.method, "POST");
    assert.equal(observedRequests[0]?.headers.get(INVOKE_INSPECTION_REQUEST_HEADER), "1");
    assert.equal(observedRequests[0]?.headers.get(INVOKE_INSPECTION_RESPONSE_HEADER), null);
    assert.equal(observedRequests[0]?.headers.get(INVOKE_INSPECTION_TOKEN_HEADER), null);
    assert.equal(observedRequests[1]?.method, "GET");
    assert.equal(observedRequests[1]?.url, `http://127.0.0.1:47831/__switchmaxxer/runtime/inspect/${inspectionId}`);
    assert.equal(observedRequests[1]?.headers.get(INVOKE_INSPECTION_TOKEN_HEADER), inspectionToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("runCli test json emits route_test_error for unexpected config read failures", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const missingConfigPath = path.join(tempDir, "missing-config.json");

  try {
    const { result, stdout, stderr } = await runWithCapturedIo([
      "test",
      "--json",
      "--config",
      missingConfigPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    assert.equal((parseCliEnvelope(stdout) as { error: { code: string } }).error.code, APP_ERROR_CODES.routeTestError);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("runCli test json reports config failure before route execution when inbound gateway auth env is missing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-test-"));
  const configPath = path.join(tempDir, "config.json");
  const inboundEnv = "SWITCHMAXXER_TEST_INBOUND_GATEWAY_AUTH";
  const previousInboundEnv = process.env[inboundEnv];

  try {
    copyExampleConfigPairForTests(configPath);
    const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    document["inbound_api_key_env"] = inboundEnv;
    delete document["allow_unauthenticated_gateway"];
    writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
    chmodSync(configPath, 0o600);
    delete process.env[inboundEnv];

    const { result, stdout, stderr } = await runWithCapturedIo([
      "test",
      "--json",
      "--config",
      configPath
    ]);

    assert.equal(result, 1);
    assert.equal(stderr, "");
    const payload = parseCliEnvelope(stdout) as unknown as {
      ok: boolean;
      command: string;
      schema_version: string;
      error: { code: string; message: string };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.command, "test");
    assert.equal(payload.schema_version, "1");
    assert.equal(payload.error.code, APP_ERROR_CODES.invalidConfig);
    assert.match(payload.error.message, /Gateway inbound auth env var 'SWITCHMAXXER_TEST_INBOUND_GATEWAY_AUTH' is not set or is empty/);
  } finally {
    if (typeof previousInboundEnv === "string") {
      process.env[inboundEnv] = previousInboundEnv;
    } else {
      delete process.env[inboundEnv];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("test runtime emits gateway_auth_error when a healthy gateway config has missing inbound auth material", async () => {
  let stdout = "";
  const runtime = createTestRuntime({
    readLongFlagValue,
    printUsageError: () => {},
    loadCliReadModel: () => ({
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      routes: [
        {
          name: "demo-route",
          service_provider: "demo-provider",
          api_mode: "openai-completions"
        }
      ],
      routesByName: {
        "demo-route": {
          name: "demo-route",
          service_provider: "demo-provider",
          api_mode: "openai-completions"
        }
      },
      providersByName: {
        "demo-provider": {
          endpoint: "https://example.test/v1"
        }
      }
    }),
    loadConfig: () => ({ timeoutMs: 1000 }) as AppConfig,
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {
        bind_host: "127.0.0.1",
        port: 47831,
        inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_GATEWAY_AUTH"
      }
    }),
    getMutableConfigSection: () => {
      throw new Error("getMutableConfigSection should not be called");
    },
    writeConfigJsonDocument: () => {
      throw new Error("writeConfigJsonDocument should not be called");
    },
    normalizeHealthProbeHost: (bindHost) => bindHost,
    buildLocalGatewayAuthHeaders: () => {
      throw new Error("missing inbound auth");
    },
    preflightGatewayRouteTests: async () => ({
      ok: true,
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      bindHost: "127.0.0.1",
      port: 47831,
      probeHost: "127.0.0.1",
      healthUrl: "http://127.0.0.1:47831/health",
      pid: null,
      latencyMs: null
    }),
    runRouteTestsDetailed: async () => {
      throw new Error("runRouteTestsDetailed should not be called");
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJson: (value) => {
      stdout = `${JSON.stringify(value)}\n`;
    },
    writeJsonErrorEnvelope: (command, code, message, options) => {
      stdout = `${JSON.stringify(buildErrorEnvelope(command, code, message, options))}\n`;
    }
  });

  const result = await runtime.runTestRoutesCommand("test", ["--json"]);

  assert.equal(result, 1);
  const payload = parseCliEnvelope(stdout) as unknown as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, APP_ERROR_CODES.gatewayAuthError);
  assert.match(payload.error.message, /SWITCHMAXXER_TEST_INBOUND_GATEWAY_AUTH/);
});

void test("test runtime brackets IPv6 loopback gateway URLs", async () => {
  const originalFetch = globalThis.fetch;
  let stdout = "";
  let observedUrl: string | null = null;
  const runtime = createTestRuntime({
    readLongFlagValue,
    printUsageError: () => {},
    loadCliReadModel: () => ({
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      routes: [
        {
          name: "demo-route",
          service_provider: "demo-provider",
          api_mode: "openai-completions"
        }
      ],
      routesByName: {
        "demo-route": {
          name: "demo-route",
          service_provider: "demo-provider",
          api_mode: "openai-completions"
        }
      },
      providersByName: {
        "demo-provider": {
          endpoint: "https://example.test/v1"
        }
      }
    }),
    loadConfig: () => ({ timeoutMs: 1000 }) as AppConfig,
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {
        bind_host: "::1",
        port: 47831,
        allow_unauthenticated_gateway: true
      }
    }),
    getMutableConfigSection: () => {
      throw new Error("getMutableConfigSection should not be called");
    },
    writeConfigJsonDocument: () => {
      throw new Error("writeConfigJsonDocument should not be called");
    },
    normalizeHealthProbeHost: (bindHost) => bindHost,
    buildLocalGatewayAuthHeaders: () => new Headers(),
    preflightGatewayRouteTests: async () => ({
      ok: true,
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      bindHost: "::1",
      port: 47831,
      probeHost: "::1",
      healthUrl: "http://[::1]:47831/health",
      pid: null,
      latencyMs: null
    }),
    runRouteTestsDetailed: async () => {
      throw new Error("runRouteTestsDetailed should not be called");
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJson: (value) => {
      stdout = `${JSON.stringify(value)}\n`;
    },
    writeJsonErrorEnvelope: (command, code, message, options) => {
      stdout = `${JSON.stringify(buildErrorEnvelope(command, code, message, options))}\n`;
    }
  });

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      observedUrl = String(input);

      return new Response("{}\n", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }) as typeof fetch;

    const result = await runtime.runTestRoutesCommand("test", ["--json"]);

    assert.equal(result, 0);
    assert.equal(observedUrl, "http://[::1]:47831/v1/chat/completions");
    const payload = parseCliEnvelope(stdout) as unknown as {
      data: {
        results: Array<{ gateway_url: string }>;
      };
    };
    assert.equal(payload.data.results[0]?.gateway_url, "http://[::1]:47831/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
