import { APP_ERROR_CODES } from "../../platform/error-codes";
import { maskSemiSensitiveEnvVarName } from "../../platform/masked-secret";
import {
  buildLocalGatewayAuthHeaders,
  buildLocalGatewayInboundAuthStateView,
  resolveLocalGatewayInboundAuthState
} from "../gateway/local-gateway-auth";
import { getGatewayHealthProbeMetricsSnapshot } from "../gateway/health-probe-metrics";
import { buildLocalHttpUrl, normalizeHealthProbeHost } from "../../platform/net-utils";
import { parseJsonObjectResponseWithinBounds } from "../../platform/http-json";
import { buildSuccessEnvelope, type ErrorEnvelope, type SuccessEnvelope } from "../../platform/response-envelope";
import type { AppConfig } from "../../platform/types";
import { loadCliValidatedConfigSnapshot, loadConfig } from "../config/config";
import { loadCliReadModel } from "../config/read-model";
import { toEnvelopeFromError } from "./envelope";
import { parseGatewayHealthArgs } from "./parsers";
import type { McpToolContext } from "./tool-context";

type McpSuccessEnvelope = SuccessEnvelope;
type McpErrorEnvelope = ErrorEnvelope<typeof APP_ERROR_CODES[keyof typeof APP_ERROR_CODES]>;
type HealthCheckName = "gateway" | "config" | "providers" | "routes";

function getGatewayFetchContext(configPath?: string): {
  config: ReturnType<typeof loadConfig>;
  readModel: ReturnType<typeof loadCliReadModel>;
  probeHost: string;
  headers: Headers;
  runtimeConfigEndpoint: string;
} {
  const config = loadConfig(configPath);
  const readModel = loadCliReadModel(configPath);
  const probeHost = normalizeHealthProbeHost(config.bindHost);
  const headers = buildLocalGatewayAuthHeaders(
    config.inboundApiKeyEnv,
    config.allowUnauthenticatedGateway === true,
    config.oneTrustedOperatorBoundary === true
  );

  return {
    config,
    readModel,
    probeHost,
    headers,
    runtimeConfigEndpoint: buildLocalHttpUrl(probeHost, config.port, "/__switchmaxxer/runtime/config")
  };
}

async function fetchGatewayRuntimeConfigPayload(
  configPath?: string,
  timeoutMs = 1_000
): Promise<{
  endpoint: string;
  payload: Record<string, unknown>;
}> {
  const context = getGatewayFetchContext(configPath);

  let response: Response;

  try {
    response = await fetch(context.runtimeConfigEndpoint, {
      method: "GET",
      headers: context.headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new Error(`Unable to reach runtime config endpoint at '${context.runtimeConfigEndpoint}': ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`runtime config endpoint returned HTTP ${response.status}`);
  }

  return {
    endpoint: context.runtimeConfigEndpoint,
    payload: await parseJsonObjectResponseWithinBounds(response)
  };
}

export async function buildGatewayRuntimeConfigToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  try {
    const { payload } = await fetchGatewayRuntimeConfigPayload(context.configPath, 1_000);
    return buildSuccessEnvelope("gateway runtime config", payload);
  } catch (error) {
    return toEnvelopeFromError("gateway runtime config", error, APP_ERROR_CODES.gatewayRuntimeConfigError);
  }
}

export async function probeGatewayHealthAtHost(
  bindHost: string,
  port: number,
  timeoutMs = 3000
): Promise<{ running: boolean; reason?: string; pid?: number; latency_ms?: number; probe_host: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const probeHost = normalizeHealthProbeHost(bindHost);
  const startedAt = Date.now();

  try {
    const response = await fetch(buildLocalHttpUrl(probeHost, port, "/health"), {
      method: "GET",
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

export async function buildGatewayHealthToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  const args = parseGatewayHealthArgs(context.params);

  try {
    const checkValue = args.check ?? "all";
    const timeoutMs = args.timeoutMs ?? 3_000;

    const config = loadConfig(context.configPath);
    const readModel = loadCliReadModel(context.configPath);
    const checksToRun: Array<HealthCheckName> =
      checkValue === "all" ? ["gateway", "config", "providers", "routes"] : [checkValue];
    const results: Array<{
      name: HealthCheckName;
      status: "pass" | "fail";
      reason?: string;
      details?: Record<string, unknown>;
    }> = [];

    for (const checkName of checksToRun) {
      if (checkName === "gateway") {
        const probe = await probeGatewayHealthAtHost(config.bindHost, config.port, timeoutMs);
        results.push({
          name: "gateway",
          status: probe.running ? "pass" : "fail",
          reason: probe.reason,
          details: {
            bind_host: config.bindHost,
            port: config.port,
            pid: probe.pid ?? null,
            health_url: buildLocalHttpUrl(normalizeHealthProbeHost(config.bindHost), config.port, "/health"),
            timeout_ms: timeoutMs
          }
        });
        continue;
      }

      if (checkName === "config") {
        results.push({
          name: "config",
          status: "pass",
          details: {
            source_file: config.sourceFile,
            source_path: config.sourcePath,
            bind_host: config.bindHost,
            model_count: readModel.models.length,
            provider_count: readModel.providers.length,
            route_count: readModel.routes.length
          }
        });
        continue;
      }

      if (checkName === "providers") {
        results.push({
          name: "providers",
          status: "pass",
          details: {
            provider_count: readModel.providers.length
          }
        });
        continue;
      }

      results.push({
        name: "routes",
        status: "pass",
        details: {
          route_count: readModel.routes.length
        }
      });
    }

    const overallStatus = results.every((result) => result.status === "pass") ? "pass" : "fail";

    return buildSuccessEnvelope("gateway health", {
      overall_status: overallStatus,
      source_file: config.sourceFile,
      source_path: config.sourcePath,
      checks: results
    });
  } catch (error) {
    return toEnvelopeFromError("gateway health", error, APP_ERROR_CODES.gatewayHealthError);
  }
}

export async function buildGatewayStatusToolPayload(context: McpToolContext): Promise<McpSuccessEnvelope | McpErrorEnvelope> {
  try {
    const config = loadCliValidatedConfigSnapshot(context.configPath) as ReturnType<typeof loadCliValidatedConfigSnapshot> & AppConfig;
    const readModel = loadCliReadModel(context.configPath);
    const health = await probeGatewayHealthAtHost(config.bindHost, config.port);
    const gatewayStatus: "running" | "stopped" = health.running ? "running" : "stopped";
    const probeHost = health.probe_host;
    const listenerAddress = `${config.bindHost}:${config.port}`;
    const healthUrl = buildLocalHttpUrl(probeHost, config.port, "/health");
    const inboundAuthState = buildLocalGatewayInboundAuthStateView(
      resolveLocalGatewayInboundAuthState(config.inboundApiKeyEnv, config.allowUnauthenticatedGateway === true),
      { formatEnvVarName: maskSemiSensitiveEnvVarName }
    );

    return buildSuccessEnvelope("gateway status", {
      gateway_status: gatewayStatus,
      port: config.port,
      bind_host: config.bindHost,
      max_connections: config.maxConnections,
      source_file: config.sourceFile,
      source_path: config.sourcePath,
      systemd_unit: config.systemdUnit,
      route_count: readModel.routes.length,
      model_count: readModel.models.length,
      provider_count: readModel.providers.length,
      pid: health.pid ?? null,
      listener_address: listenerAddress,
      reachable: gatewayStatus === "running",
      health_url: healthUrl,
      health_latency_ms: health.latency_ms ?? null,
      reason: health.reason ?? null,
      inbound_auth_state: inboundAuthState,
      health_probe_metrics: getGatewayHealthProbeMetricsSnapshot(),
      runtime: {
        gateway_status: gatewayStatus,
        pid: health.pid ?? null,
        reason: health.reason ?? null,
        health_latency_ms: health.latency_ms ?? null
      },
      listener: {
        bind_host: config.bindHost,
        port: config.port,
        address: listenerAddress,
        probe_host: probeHost,
        reachable: gatewayStatus === "running",
        health_url: healthUrl
      },
      config: {
        source_file: config.sourceFile,
        source_path: config.sourcePath,
        max_connections: config.maxConnections,
        systemd_unit: config.systemdUnit,
        model_count: readModel.models.length,
        provider_count: readModel.providers.length,
        route_count: readModel.routes.length
      }
    });
  } catch (error) {
    return toEnvelopeFromError("gateway status", error, APP_ERROR_CODES.gatewayStatusError);
  }
}
