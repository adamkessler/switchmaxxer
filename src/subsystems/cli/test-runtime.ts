import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { CLI_SCHEMA_VERSION } from "../../platform/response-envelope";
import { buildLocalHttpUrl } from "../../platform/net-utils";
import type { RouteTestResult } from "../hot-path/manatee/proxy/proxy";
import type { AppConfig, ApiMode } from "../../platform/types";

type TestExecutionPath = "gateway" | "direct";

type CliRouteTestResult = RouteTestResult & {
  path: TestExecutionPath;
  gateway_url: string | null;
};

export type TestRoutesOperationView = {
  path: TestExecutionPath;
  source_file: string;
  source_path: string;
  route_count: number;
  passed: number;
  failed: number;
  results: CliRouteTestResult[];
};

export type TestRoutesOperationResult =
  | {
      ok: true;
      data: TestRoutesOperationView;
    }
  | {
      ok: false;
      code: AppErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

export function createTestRuntime(deps: {
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string,
    missingValueMessage?: string
  ) => { consumed: number; value?: string; errorMessage?: string } | null;
  printUsageError: (message: string) => void;
  loadCliReadModel: (configPath?: string) => {
    sourceFile: string;
    sourcePath: string;
    routes: Array<{
      name: string;
      service_provider: string;
      api_mode: "" | ApiMode;
    }>;
    routesByName: Record<string, {
      name: string;
      service_provider: string;
      api_mode: "" | ApiMode;
    } | undefined>;
    providersByName: Record<string, { endpoint: string } | undefined>;
  };
  loadConfig: (configPath?: string) => AppConfig;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  getMutableConfigSection: (
    document: Record<string, unknown>,
    sectionName: "models" | "routes" | "service_providers"
  ) => Record<string, unknown>;
  writeConfigJsonDocument: (targetPath: string, document: Record<string, unknown>) => void;
  normalizeHealthProbeHost: (bindHost: string) => string;
  buildLocalGatewayAuthHeaders: (
    inboundApiKeyEnv: string | null,
    allowUnauthenticatedGateway: boolean,
    oneTrustedOperatorBoundary?: boolean
  ) => Headers;
  preflightGatewayRouteTests: (configPath?: string) => Promise<
    | {
        ok: true;
        sourceFile: string;
        sourcePath: string;
        bindHost: string;
        port: number;
        probeHost: string;
        healthUrl: string;
        pid: number | null;
        latencyMs: number | null;
      }
    | {
        ok: false;
        code: typeof APP_ERROR_CODES.invalidConfig | typeof APP_ERROR_CODES.gatewayUnavailable;
        message: string;
        sourceFile: string;
        sourcePath: string;
        bindHost: string;
        port: number | null;
        probeHost: string;
        healthUrl: string | null;
        pid: number | null;
        latencyMs: number | null;
      }
  >;
  runRouteTestsDetailed: (
    config: AppConfig,
    options: {
      routeName?: string;
      log?: boolean;
      onResult?: (result: RouteTestResult) => void;
    }
  ) => Promise<unknown>;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: AppErrorCode,
    message: string,
    options?: {
      details?: unknown;
      top_level?: Record<string, unknown>;
    }
  ) => void;
}): {
  runTestRoutesCommand: (commandName: "test", argv: string[]) => Promise<number>;
  runTestRoutesOperation: (options: {
    routeName?: string;
    configPath?: string;
    noGateway?: boolean;
    log?: boolean;
    onResult?: (result: CliRouteTestResult, progress: { current: number; total: number }) => void;
  }) => Promise<TestRoutesOperationResult>;
} {
  function parseTestCommandArgs(argv: string[]): {
    routeName?: string;
    configPath?: string;
    json: boolean;
    noGateway: boolean;
    errorMessage?: string;
  } {
    let routeName: string | undefined;
    let configPath: string | undefined;
    let json = false;
    let noGateway = false;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      if (arg === "--json") {
        json = true;
        continue;
      }

      if (arg === "--no-gateway") {
        noGateway = true;
        continue;
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--route", "Flag '--route' requires a route name");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { routeName, configPath, json, noGateway, errorMessage: parsedFlag.errorMessage };
          }

          routeName = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--config", "Flag '--config' requires a path value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { routeName, configPath, json, noGateway, errorMessage: parsedFlag.errorMessage };
          }

          configPath = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      return { routeName, configPath, json, noGateway, errorMessage: `Unknown flag '${arg}'` };
    }

    return { routeName, configPath, json, noGateway };
  }

  function summarizeCliRouteTestResults(results: CliRouteTestResult[]): { passed: number; failed: number } {
    return results.reduce(
      (summary, result) => {
        if (result.status === "pass") {
          summary.passed += 1;
        } else {
          summary.failed += 1;
        }

        return summary;
      },
      { passed: 0, failed: 0 }
    );
  }

  function toCliRouteTestResults(results: RouteTestResult[], path: TestExecutionPath): CliRouteTestResult[] {
    return results.map((result) => ({
      ...result,
      path,
      gateway_url: null
    }));
  }

  function renderRouteTestProgressLine(
    result: CliRouteTestResult,
    progress?: {
      current: number;
      total: number;
    }
  ): string {
    const progressPrefix = progress && progress.total > 0 ? `[${progress.current}/${progress.total}] ` : "";
    const line = `${result.status.toUpperCase()}  ${progressPrefix}${result.route}  path=${result.path}  provider=${result.service_provider}  api=${result.api_mode}  status=${result.status_code}  latency=${result.latency_ms}ms`;

    if (!result.reason) {
      return line;
    }

    return `${line}\nReason: ${result.reason}`;
  }

  function writeRouteTestProgress(
    result: CliRouteTestResult,
    progress?: {
      current: number;
      total: number;
    }
  ): void {
    deps.writeStdout(`${renderRouteTestProgressLine(result, progress)}\n`);
  }

  function renderRouteTestStartText(
    sourceFile: string,
    path: TestExecutionPath,
    routeName: string | undefined,
    routeCount: number
  ): string {
    const lines = ["Starting route tests", `Path: ${path}`, `Config: ${sourceFile}`];

    if (routeName) {
      lines.push(`Route: ${routeName}`);
    }

    lines.push(`Routes Planned: ${routeCount}`);
    lines.push("");
    return lines.join("\n");
  }

  async function runGatewayRouteTestsDetailed(
    configPath?: string,
    routeName?: string,
    options?: {
      log?: boolean;
    }
  ): Promise<{
    sourceFile: string;
    sourcePath: string;
    path: "gateway";
    results: CliRouteTestResult[];
  }> {
    const runtimeConfig = deps.loadConfig(configPath);
    const readModel = deps.loadCliReadModel(configPath);
    const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
    const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;
    const bindHost =
      typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
        ? document["bind_host"]
        : "127.0.0.1";

    if (typeof port !== "number" || port <= 0) {
      throw new Error(`Config '${sourcePath}' does not contain a valid numeric 'port'`);
    }

    const probeHost = deps.normalizeHealthProbeHost(bindHost);
    const inboundApiKeyEnv =
      typeof document["inbound_api_key_env"] === "string" && document["inbound_api_key_env"].trim().length > 0
        ? document["inbound_api_key_env"]
        : null;
    const allowUnauthenticatedGateway = document["allow_unauthenticated_gateway"] === true;
    const oneTrustedOperatorBoundary = document["one_trusted_operator_boundary"] === true;
    let gatewayHeaders: Headers;

    try {
      gatewayHeaders = deps.buildLocalGatewayAuthHeaders(
        inboundApiKeyEnv,
        allowUnauthenticatedGateway,
        oneTrustedOperatorBoundary
      );
    } catch {
      throw new Error(inboundApiKeyEnv !== null
        ? `The selected config file requires inbound gateway auth via env var '${inboundApiKeyEnv}', but it is not set or is empty.`
        : "The selected config file does not define a valid inbound auth mode.");
    }
    const routes = readModel.routes.filter((route) => (routeName ? route.name === routeName : true));

    if (routeName && routes.length === 0) {
      throw new Error(`Route '${routeName}' was not found`);
    }

    const results: CliRouteTestResult[] = [];

    for (const [index, route] of routes.entries()) {
      const api: "openai" | "anthropic" = route.api_mode === "anthropic-messages" ? "anthropic" : "openai";
      const gatewayUrl =
        api === "anthropic"
          ? buildLocalHttpUrl(probeHost, port, "/anthropic/v1/messages")
          : buildLocalHttpUrl(probeHost, port, "/v1/chat/completions");
      const body: Record<string, unknown> = {
        model: route.name,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      };
      const startedAt = Date.now();

      try {
        const requestHeaders = new Headers(gatewayHeaders);
        requestHeaders.set("content-type", "application/json; charset=utf-8");
        requestHeaders.set("accept", "application/json");

        const response = await fetch(gatewayUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(runtimeConfig.timeoutMs)
        });
        const latencyMs = Date.now() - startedAt;
        const rawText = await response.text();
        const reason =
          response.ok
            ? null
            : rawText.trim().length > 0
              ? rawText.trim().replace(/\s+/g, " ").slice(0, 240)
              : `gateway returned HTTP ${response.status}`;

        results.push({
          route: route.name,
          service_provider: route.service_provider,
          api_mode: route.api_mode || "openai-completions",
          path: "gateway",
          gateway_url: gatewayUrl,
          status: response.ok ? "pass" : "fail",
          status_code: response.status,
          latency_ms: latencyMs,
          reason
        });
        if (options?.log !== false) {
          const latestResult = results[results.length - 1];
          if (latestResult) {
            writeRouteTestProgress(latestResult, {
              current: index + 1,
              total: routes.length
            });
          }
        }
      } catch (error) {
        const message =
          error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
            ? `Route test timed out after ${runtimeConfig.timeoutMs}ms`
            : error instanceof Error
              ? error.message
              : "Unknown gateway test error";
        const latencyMs = Date.now() - startedAt;

        results.push({
          route: route.name,
          service_provider: route.service_provider,
          api_mode: route.api_mode || "openai-completions",
          path: "gateway",
          gateway_url: gatewayUrl,
          status: "fail",
          status_code: 502,
          latency_ms: latencyMs,
          reason: message
        });
        if (options?.log !== false) {
          const latestResult = results[results.length - 1];
          if (latestResult) {
            writeRouteTestProgress(latestResult, {
              current: index + 1,
              total: routes.length
            });
          }
        }
      }
    }

    return {
      sourceFile,
      sourcePath,
      path: "gateway",
      results
    };
  }

  function renderRouteTestSummaryText(
    sourceFile: string,
    path: TestExecutionPath,
    results: CliRouteTestResult[]
  ): string {
    const summary = summarizeCliRouteTestResults(results);
    const lines = [
      `Route Test Summary: ${summary.passed} passed, ${summary.failed} failed`,
      `Path: ${path}`,
      `Config: ${sourceFile}`
    ];

    if (results.length === 0) {
      lines.push("Routes Tested: 0");
      lines.push("No routes found.");
    } else {
      lines.push(`Routes Tested: ${results.length}`);
    }

    return lines.join("\n");
  }

  function renderGatewayUnavailableText(details: {
    sourceFile: string;
    bindHost: string;
    port: number | null;
    probeHost: string;
    healthUrl: string | null;
    latencyMs: number | null;
    message: string;
  }): string {
    const lines = [
      "Gateway unavailable",
      `Config: ${details.sourceFile}`,
      `Bind Host: ${details.bindHost}`,
      `Port: ${typeof details.port === "number" ? details.port : "unknown"}`,
      `Probe Host: ${details.probeHost}`
    ];

    if (details.healthUrl) {
      lines.push(`Health URL: ${details.healthUrl}`);
    }

    if (typeof details.latencyMs === "number") {
      lines.push(`Probe Latency: ${details.latencyMs}ms`);
    }

    lines.push(`Reason: ${details.message}`);
    return lines.join("\n");
  }

  async function runTestRoutesOperation(options: {
    routeName?: string;
    configPath?: string;
    noGateway?: boolean;
    log?: boolean;
    onResult?: (result: CliRouteTestResult, progress: { current: number; total: number }) => void;
  }): Promise<TestRoutesOperationResult> {
    try {
      const { routeName, configPath, noGateway = false, log = false } = options;
      const path: TestExecutionPath = noGateway ? "direct" : "gateway";
      const readModel = deps.loadCliReadModel(configPath);
      const plannedRouteCount = readModel.routes.filter((route) => (routeName ? route.name === routeName : true)).length;

      if (!noGateway) {
        const preflight = await deps.preflightGatewayRouteTests(configPath);

        if (!preflight.ok) {
          return {
            ok: false,
            code: preflight.code,
            message: preflight.message,
            details: {
              source_file: preflight.sourceFile,
              source_path: preflight.sourcePath,
              bind_host: preflight.bindHost,
              port: preflight.port,
              probe_host: preflight.probeHost,
              health_url: preflight.healthUrl,
              pid: preflight.pid,
              latency_ms: preflight.latencyMs
            }
          };
        }
      }

      const sourceFile = readModel.sourceFile;
      const sourcePath = readModel.sourcePath;
      const results = noGateway
        ? routeName
          ? await (async () => {
              const directResults: CliRouteTestResult[] = [];
              await deps.runRouteTestsDetailed(deps.loadConfig(configPath), {
                routeName,
                log: false,
                onResult: (result) => {
                  const cliResult = toCliRouteTestResults([result], "direct")[0];
                  if (!cliResult) {
                    return;
                  }
                  const current = directResults.length + 1;
                  directResults.push(cliResult);
                  options.onResult?.(cliResult, { current, total: 1 });
                }
              });
              return directResults;
            })()
          : await (async () => {
              const directResults: CliRouteTestResult[] = [];
              await deps.runRouteTestsDetailed(deps.loadConfig(configPath), {
                log: false,
                onResult: (result) => {
                  const cliResult = toCliRouteTestResults([result], "direct")[0];
                  if (!cliResult) {
                    return;
                  }
                  const current = directResults.length + 1;
                  directResults.push(cliResult);
                  options.onResult?.(cliResult, { current, total: plannedRouteCount });
                }
              });
              return directResults;
            })()
        : (await runGatewayRouteTestsDetailed(configPath, routeName, { log })).results;
      const summary = summarizeCliRouteTestResults(results);
      const view = {
        path,
        source_file: sourceFile,
        source_path: sourcePath,
        route_count: results.length,
        passed: summary.passed,
        failed: summary.failed,
        results
      };

      return {
        ok: true,
        data: view
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown route test error";
      const errorCode =
        /^Route '.+' was not found$/.test(message)
          ? APP_ERROR_CODES.routeNotFound
          : message.includes("inbound gateway auth")
            ? APP_ERROR_CODES.gatewayAuthError
            : message.includes("valid numeric 'port'")
              ? APP_ERROR_CODES.invalidConfig
              : APP_ERROR_CODES.routeTestError;

      return {
        ok: false,
        code: errorCode,
        message
      };
    }
  }

  async function runTestRoutesCommand(commandName: "test", argv: string[]): Promise<number> {
    const parsedArgs = parseTestCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { routeName, configPath, json, noGateway } = parsedArgs;

    if (!json) {
      try {
        const readModel = deps.loadCliReadModel(configPath);
        const path: TestExecutionPath = noGateway ? "direct" : "gateway";
        const plannedRouteCount = readModel.routes.filter((route) => (routeName ? route.name === routeName : true)).length;

        if (!routeName || plannedRouteCount > 0) {
          deps.writeStdout(renderRouteTestStartText(readModel.sourceFile, path, routeName, plannedRouteCount));
        }
      } catch {
        // Let runTestRoutesOperation return the canonical typed error below.
      }
    }

    const result = await runTestRoutesOperation({
      routeName,
      configPath,
      noGateway,
      log: !json,
      onResult: json
        ? undefined
        : (cliResult, progress) => {
            writeRouteTestProgress(cliResult, progress);
          }
    });

    if (result.ok) {
      if (json) {
        deps.writeJson({
          ok: result.data.failed === 0,
          command: commandName,
          schema_version: CLI_SCHEMA_VERSION,
          data: result.data
        });
        return result.data.failed === 0 ? 0 : 1;
      }

      deps.writeStdout(renderRouteTestSummaryText(result.data.source_file, result.data.path, result.data.results));
      return result.data.failed === 0 ? 0 : 1;
    }

    if (json) {
      deps.writeJsonErrorEnvelope(commandName, result.code, result.message, {
        details: result.details
      });
      return 1;
    }

    if (result.code === APP_ERROR_CODES.gatewayUnavailable || result.code === APP_ERROR_CODES.invalidConfig) {
      const details = result.details ?? {};
      deps.writeStderr(
        renderGatewayUnavailableText({
          sourceFile: typeof details["source_file"] === "string" ? details["source_file"] : "(unknown)",
          bindHost: typeof details["bind_host"] === "string" ? details["bind_host"] : "",
          port: typeof details["port"] === "number" ? details["port"] : null,
          probeHost: typeof details["probe_host"] === "string" ? details["probe_host"] : "",
          healthUrl: typeof details["health_url"] === "string" ? details["health_url"] : null,
          latencyMs: typeof details["latency_ms"] === "number" ? details["latency_ms"] : null,
          message: result.message
        })
      );
      return 1;
    }

    deps.writeStderr(`Route tests failed: ${result.message}`);
    return 1;
  }

  return {
    runTestRoutesOperation,
    runTestRoutesCommand
  };
}
