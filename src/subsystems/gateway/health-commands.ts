import { spawn } from "node:child_process";
import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { parseJsonObjectResponseWithinBounds } from "../../platform/http-json";
import { buildLocalHttpUrl, normalizeHealthProbeHost } from "../../platform/net-utils";
import { parseCanonicalPositiveInteger } from "../../platform/number-parsing";
import { isRecord } from "../../platform/type-guards";

type HealthCheckName = "gateway" | "config" | "providers" | "routes";

type GatewayHealthCheckResult = {
  name: HealthCheckName;
  status: "pass" | "fail";
  reason?: string;
  details?: Record<string, unknown>;
};

type GatewayServiceStatus = {
  available: boolean;
  manager: "systemd";
  unit: string;
  scope: "user" | "system" | null;
  active_state: string | null;
  sub_state: string | null;
  load_state: string | null;
  unit_file_state: string | null;
  main_pid: number | null;
  reason: string | null;
};

export function createGatewayHealthCommands(deps: {
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string,
    missingValueMessage?: string
  ) =>
    | {
        value?: string;
        consumed: number;
        errorMessage?: string;
      }
    | null;
  loadConfig: (configPath?: string) => unknown;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  buildLocalGatewayAuthHeaders: (
    inboundApiKeyEnv: string | null,
    allowUnauthenticatedGateway: boolean,
    oneTrustedOperatorBoundary?: boolean
  ) => Headers;
  resolveSystemdUnitFromDocument: (document: Record<string, unknown>) => string;
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJsonSuccessEnvelope: (
    command: string,
    data: unknown,
    options?: {
      count?: number;
      warnings?: unknown;
      details?: unknown;
      top_level?: Record<string, unknown>;
    }
  ) => void;
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
  parseHealthArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    check: HealthCheckName | "all";
    timeoutMs: number;
    errorMessage?: string;
  };
  normalizeHealthProbeHost: (bindHost: string) => string;
  probeGatewayHealthAtHost: (
    bindHost: string,
    port: number,
    timeoutMs?: number,
    headers?: Headers
  ) => Promise<{ running: boolean; reason?: string; pid?: number; latency_ms?: number; probe_host: string }>;
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
  probeGatewayServiceUnit: (unit: string) => Promise<GatewayServiceStatus>;
  runHealth: (argv: string[], options?: { commandName: "health" | "gateway health" }) => Promise<number>;
} {
  function parseHealthArgs(argv: string[]): {
    configPath?: string;
    json: boolean;
    check: HealthCheckName | "all";
    timeoutMs: number;
    errorMessage?: string;
  } {
    let configPath: string | undefined;
    let json = false;
    let check: HealthCheckName | "all" = "all";
    let timeoutMs = 3000;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      if (arg === "--json") {
        json = true;
        continue;
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--config", "Flag '--config' requires a path value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, json, check, timeoutMs, errorMessage: parsedFlag.errorMessage };
          }

          configPath = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--check");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, json, check, timeoutMs, errorMessage: parsedFlag.errorMessage };
          }

          const nextArg = parsedFlag.value;
          if (nextArg !== "all" && nextArg !== "gateway" && nextArg !== "config" && nextArg !== "providers" && nextArg !== "routes") {
            return {
              configPath,
              json,
              check,
              timeoutMs,
              errorMessage: "Flag '--check' must be one of gateway, config, providers, routes, or all"
            };
          }

          check = nextArg;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--timeout-ms");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, json, check, timeoutMs, errorMessage: parsedFlag.errorMessage };
          }

          if (typeof parsedFlag.value !== "string") {
            return {
              configPath,
              json,
              check,
              timeoutMs,
              errorMessage: "Flag '--timeout-ms' must be a positive integer"
            };
          }

          const parsed = parseCanonicalPositiveInteger(parsedFlag.value);
          if (parsed === null) {
            return {
              configPath,
              json,
              check,
              timeoutMs,
              errorMessage: "Flag '--timeout-ms' must be a positive integer"
            };
          }

          timeoutMs = parsed;
          index += parsedFlag.consumed;
          continue;
        }
      }

      return { configPath, json, check, timeoutMs, errorMessage: `Unknown flag '${arg}'` };
    }

    return { configPath, json, check, timeoutMs };
  }

  async function probeGatewayHealthAtHost(
    bindHost: string,
    port: number,
    timeoutMs = 3000,
    headers = new Headers()
  ): Promise<{ running: boolean; reason?: string; pid?: number; latency_ms?: number; probe_host: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const probeHost = normalizeHealthProbeHost(bindHost);
    const startedAt = Date.now();

    try {
      const response = await fetch(buildLocalHttpUrl(probeHost, port, "/health"), {
        method: "GET",
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          running: false,
          reason: `health endpoint returned HTTP ${response.status}`,
          latency_ms: Date.now() - startedAt,
          probe_host: probeHost
        };
      }

      const payload = await parseJsonObjectResponseWithinBounds(response);

      if (payload["status"] === "ok" && payload["process_integrity_status"] === "ok") {
        return {
          running: true,
          latency_ms: Date.now() - startedAt,
          probe_host: probeHost
        };
      }

      return {
        running: false,
        reason: "health endpoint returned an unexpected payload",
        latency_ms: Date.now() - startedAt,
        probe_host: probeHost
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "health probe timed out"
          : error instanceof Error
            ? error.message
            : "health probe failed";

      return { running: false, reason: message, latency_ms: Date.now() - startedAt, probe_host: probeHost };
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildHealthProbeAuthHeaders(document: Record<string, unknown>): Headers {
    const inboundApiKeyEnv =
      typeof document["inbound_api_key_env"] === "string" && document["inbound_api_key_env"].trim().length > 0
        ? document["inbound_api_key_env"]
        : null;
    const allowUnauthenticatedGateway = document["allow_unauthenticated_gateway"] === true;
    const oneTrustedOperatorBoundary = document["one_trusted_operator_boundary"] === true;

    return deps.buildLocalGatewayAuthHeaders(
      inboundApiKeyEnv,
      allowUnauthenticatedGateway,
      oneTrustedOperatorBoundary
    );
  }

  async function preflightGatewayRouteTests(configPath?: string): Promise<
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
  > {
    const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
    const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;
    const bindHost =
      typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
        ? document["bind_host"]
        : "127.0.0.1";
    const probeHost = normalizeHealthProbeHost(bindHost);
    const healthUrl = typeof port === "number" && port > 0 ? buildLocalHttpUrl(probeHost, port, "/health") : null;

    if (typeof port !== "number" || port <= 0) {
      return {
        ok: false,
        code: APP_ERROR_CODES.invalidConfig,
        message: `Config '${sourcePath}' does not contain a valid numeric 'port'`,
        sourceFile,
        sourcePath,
        bindHost,
        port,
        probeHost,
        healthUrl,
        pid: null,
        latencyMs: null
      };
    }

    let healthProbeHeaders: Headers;
    try {
      healthProbeHeaders = buildHealthProbeAuthHeaders(document);
    } catch (error) {
      return {
        ok: false,
        code: APP_ERROR_CODES.invalidConfig,
        message: error instanceof Error ? error.message : "The selected config file does not define a valid inbound auth mode.",
        sourceFile,
        sourcePath,
        bindHost,
        port,
        probeHost,
        healthUrl,
        pid: null,
        latencyMs: null
      };
    }

    const probe = await probeGatewayHealthAtHost(bindHost, port, 3000, healthProbeHeaders);

    if (!probe.running) {
      return {
        ok: false,
        code: APP_ERROR_CODES.gatewayUnavailable,
        message: `Gateway test preflight failed: ${probe.reason ?? "gateway is not responding"}`,
        sourceFile,
        sourcePath,
        bindHost,
        port,
        probeHost: probe.probe_host,
        healthUrl: buildLocalHttpUrl(probe.probe_host, port, "/health"),
        pid: probe.pid ?? null,
        latencyMs: probe.latency_ms ?? null
      };
    }

    return {
      ok: true,
      sourceFile,
      sourcePath,
      bindHost,
      port,
      probeHost: probe.probe_host,
      healthUrl: buildLocalHttpUrl(probe.probe_host, port, "/health"),
      pid: probe.pid ?? null,
      latencyMs: probe.latency_ms ?? null
    };
  }

  async function probeGatewayServiceUnit(unit: string): Promise<GatewayServiceStatus> {
    const runSystemctlShow = async (
      args: string[]
    ): Promise<{
      ok: boolean;
      scope: "user" | "system";
      properties: Record<string, string>;
      message?: string;
    }> => {
      const scope = args.includes("--user") ? "user" : "system";

      return await new Promise((resolve) => {
        const child = spawn("systemctl", args, {
          stdio: ["ignore", "pipe", "pipe"]
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdoutBuffer += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
          stderrBuffer += chunk.toString();
        });

        child.on("error", (error) => {
          resolve({
            ok: false,
            scope,
            properties: {},
            message: error instanceof Error ? error.message : "Unknown systemd status error"
          });
        });

        child.on("close", (code) => {
          if (code !== 0) {
            resolve({
              ok: false,
              scope,
              properties: {},
              message: stderrBuffer.trim() || `systemctl exited with code ${code ?? 1}`
            });
            return;
          }

          const properties = stdoutBuffer
            .split("\n")
            .filter((line) => line.includes("="))
            .reduce<Record<string, string>>((result, line) => {
              const separatorIndex = line.indexOf("=");
              const key = line.slice(0, separatorIndex);
              const value = line.slice(separatorIndex + 1);
              result[key] = value;
              return result;
            }, {});

          resolve({
            ok: true,
            scope,
            properties
          });
        });
      });
    };

    const propertyArgs = [
      "show",
      "--no-pager",
      "--property=LoadState",
      "--property=ActiveState",
      "--property=SubState",
      "--property=UnitFileState",
      "--property=MainPID",
      "--",
      unit
    ];

    const attempts = [await runSystemctlShow(["--user", ...propertyArgs]), await runSystemctlShow(propertyArgs)];
    const success = attempts.find((attempt) => attempt.ok);

    if (!success) {
      const message =
        attempts[0]?.message && !attempts[0].message.includes(`Unit ${unit} could not be found`)
          ? attempts[0].message
          : attempts[1]?.message || attempts[0]?.message || "Unable to inspect systemd unit";

      return {
        available: false,
        manager: "systemd",
        unit,
        scope: null,
        active_state: null,
        sub_state: null,
        load_state: null,
        unit_file_state: null,
        main_pid: null,
        reason: message
      };
    }

    const mainPid = parseCanonicalPositiveInteger(success.properties["MainPID"]);

    return {
      available: true,
      manager: "systemd",
      unit,
      scope: success.scope,
      active_state: success.properties["ActiveState"] ?? null,
      sub_state: success.properties["SubState"] ?? null,
      load_state: success.properties["LoadState"] ?? null,
      unit_file_state: success.properties["UnitFileState"] ?? null,
      main_pid: mainPid,
      reason: null
    };
  }

  async function runHealth(
    argv: string[],
    options: { commandName: "health" | "gateway health" } = { commandName: "health" }
  ): Promise<number> {
    const parsedArgs = parseHealthArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json, check, timeoutMs } = parsedArgs;
    const checksToRun: HealthCheckName[] = check === "all" ? ["gateway", "config", "providers", "routes"] : [check];

    try {
      const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
      deps.resolveSystemdUnitFromDocument(document);
      const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;
      const bindHost =
        typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
          ? document["bind_host"]
          : "127.0.0.1";
      const modelsRecord = isRecord(document["models"]) ? document["models"] : {};
      const providersRecord = isRecord(document["service_providers"]) ? document["service_providers"] : {};
      const routesRecord = isRecord(document["routes"]) ? document["routes"] : {};

      const modelCount = Object.keys(modelsRecord).length;
      const providerCount = Object.keys(providersRecord).length;
      const routeCount = Object.keys(routesRecord).length;

      let runtimeConfigError: string | null = null;

      try {
        deps.loadConfig(configPath);
      } catch (error) {
        runtimeConfigError = error instanceof Error ? error.message : "Unknown config readiness error";
      }

      const results: GatewayHealthCheckResult[] = [];

      for (const checkName of checksToRun) {
        if (checkName === "gateway") {
          if (typeof port !== "number" || port <= 0) {
            results.push({
              name: "gateway",
              status: "fail",
              reason: "config.json does not contain a valid numeric 'port'",
              details: { port }
            });
            continue;
          }

          let healthProbeHeaders: Headers;
          try {
            healthProbeHeaders = buildHealthProbeAuthHeaders(document);
          } catch (error) {
            results.push({
              name: "gateway",
              status: "fail",
              reason: error instanceof Error ? error.message : "config.json does not define a valid inbound auth mode",
              details: { bind_host: bindHost, port }
            });
            continue;
          }

          const probe = await probeGatewayHealthAtHost(bindHost, port, timeoutMs, healthProbeHeaders);
          results.push({
            name: "gateway",
            status: probe.running ? "pass" : "fail",
            reason: probe.reason,
            details: {
              bind_host: bindHost,
              port,
              pid: probe.pid ?? null,
              health_url: buildLocalHttpUrl(normalizeHealthProbeHost(bindHost), port, "/health"),
              timeout_ms: timeoutMs
            }
          });
          continue;
        }

        if (checkName === "config") {
          results.push({
            name: "config",
            status: runtimeConfigError ? "fail" : "pass",
            reason: runtimeConfigError ?? undefined,
            details: {
              source_file: sourceFile,
              source_path: sourcePath,
              bind_host: bindHost,
              model_count: modelCount,
              provider_count: providerCount,
              route_count: routeCount
            }
          });
          continue;
        }

        if (checkName === "providers") {
          results.push({
            name: "providers",
            status: runtimeConfigError ? "fail" : "pass",
            reason: runtimeConfigError ? `provider readiness depends on config readiness: ${runtimeConfigError}` : undefined,
            details: {
              provider_count: providerCount
            }
          });
          continue;
        }

        results.push({
          name: "routes",
          status: runtimeConfigError ? "fail" : "pass",
          reason: runtimeConfigError ? `route readiness depends on config readiness: ${runtimeConfigError}` : undefined,
          details: {
            route_count: routeCount
          }
        });
      }

      const overallStatus = results.every((result) => result.status === "pass") ? "pass" : "fail";
      const view = {
        overall_status: overallStatus,
        source_file: sourceFile,
        source_path: sourcePath,
        checks: results
      };

      if (json) {
        deps.writeJsonSuccessEnvelope(options.commandName, view);
        return overallStatus === "pass" ? 0 : 1;
      }

      const lines = [
        `Overall Health: ${view.overall_status}`,
        `Config: ${view.source_file}`,
        `Config Path: ${view.source_path}`,
        ""
      ];

      for (const result of results) {
        lines.push(`Check: ${result.name}`);
        lines.push(`Status: ${result.status}`);

        if (result.reason) {
          lines.push(`Reason: ${result.reason}`);
        }

        if (result.details) {
          for (const [key, value] of Object.entries(result.details)) {
            lines.push(`${key}: ${String(value)}`);
          }
        }

        lines.push("");
      }

      deps.writeStdout(lines.join("\n").trimEnd());
      return overallStatus === "pass" ? 0 : 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown health error";

      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.healthError, message);
        return 1;
      }

      deps.writeStderr(`Health failed: ${message}`);
      return 1;
    }
  }

  return {
    parseHealthArgs,
    normalizeHealthProbeHost,
    probeGatewayHealthAtHost,
    preflightGatewayRouteTests,
    probeGatewayServiceUnit,
    runHealth
  };
}
