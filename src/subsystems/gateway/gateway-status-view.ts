import { buildLocalHttpUrl } from "../../platform/net-utils";
import { maskSemiSensitiveEnvVarName } from "../../platform/masked-secret";
import { isRecord } from "../../platform/type-guards";
import {
  buildLocalGatewayInboundAuthStateView,
  resolveLocalGatewayInboundAuthState,
  type LocalGatewayInboundAuthStateView
} from "../hot-path/manatee/runtime/local-gateway-auth";

export type GatewayServiceStatus = {
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

export type GatewayStatusView = {
  gateway_status: "running" | "stopped" | "unknown";
  port: number | null;
  bind_host: string;
  max_connections: number;
  source_file: string;
  source_path: string;
  systemd_unit: string;
  route_count: number;
  model_count: number;
  provider_count: number;
  pid: number | null;
  listener_address: string;
  reachable: boolean;
  health_url: string | null;
  health_latency_ms: number | null;
  reason: string | null;
  inbound_auth_state: LocalGatewayInboundAuthStateView;
  health_probe_metrics: {
    total_requests: number;
    allowed_requests: number;
    rate_limited_requests: number;
    last_seen_at: string | null;
  };
  runtime: {
    gateway_status: "running" | "stopped" | "unknown";
    pid: number | null;
    reason: string | null;
    health_latency_ms: number | null;
  };
  listener: {
    bind_host: string;
    port: number | null;
    address: string;
    probe_host: string | null;
    reachable: boolean;
    health_url: string | null;
  };
  service: GatewayServiceStatus;
  config: {
    source_file: string;
    source_path: string;
    max_connections: number;
    systemd_unit: string;
    one_trusted_operator_boundary: boolean;
    model_count: number;
    provider_count: number;
    route_count: number;
  };
};

export function buildGatewayStatusView(input: {
  sourcePath: string;
  sourceFile: string;
  document: Record<string, unknown>;
  systemdUnit: string;
  bindHost: string;
  port: number | null;
  probeHost: string | null;
  gatewayStatus: "running" | "stopped" | "unknown";
  reason?: string;
  pid: number | null;
  healthLatencyMs: number | null;
  serviceStatus: GatewayServiceStatus;
  healthProbeMetrics: {
    total_requests: number;
    allowed_requests: number;
    rate_limited_requests: number;
    last_seen_at: string | null;
  };
}): GatewayStatusView {
  const routesRecord = isRecord(input.document["routes"]) ? input.document["routes"] : null;
  const modelsRecord = isRecord(input.document["models"]) ? input.document["models"] : null;
  const providersRecord = isRecord(input.document["service_providers"]) ? input.document["service_providers"] : null;
  const inboundApiKeyEnv =
    typeof input.document["inbound_api_key_env"] === "string"
      ? input.document["inbound_api_key_env"]
      : null;
  const allowUnauthenticatedGateway = input.document["allow_unauthenticated_gateway"] === true;
  const oneTrustedOperatorBoundary = input.document["one_trusted_operator_boundary"] === true;

  const routeCount = routesRecord ? Object.keys(routesRecord).length : 0;
  const modelCount = modelsRecord ? Object.keys(modelsRecord).length : 0;
  const providerCount = providersRecord ? Object.keys(providersRecord).length : 0;
  const maxConnections =
    typeof input.document["max_connections"] === "number" && Number.isFinite(input.document["max_connections"])
      ? input.document["max_connections"]
      : 200;
  const listenerAddress = typeof input.port === "number" && input.port > 0 ? `${input.bindHost}:${input.port}` : input.bindHost;
  const healthUrl =
    typeof input.port === "number" && input.port > 0 && input.probeHost
      ? buildLocalHttpUrl(input.probeHost, input.port, "/health")
      : null;

  const runtimeView = {
    gateway_status: input.gatewayStatus,
    pid: input.pid,
    reason: input.reason ?? null,
    health_latency_ms: input.healthLatencyMs
  };

  const listenerView = {
    bind_host: input.bindHost,
    port: input.port,
    address: listenerAddress,
    probe_host: typeof input.port === "number" && input.port > 0 ? input.probeHost : null,
    reachable: input.gatewayStatus === "running",
    health_url: healthUrl
  };

  const configView = {
    source_file: input.sourceFile,
    source_path: input.sourcePath,
    max_connections: maxConnections,
    systemd_unit: input.systemdUnit,
    one_trusted_operator_boundary: oneTrustedOperatorBoundary,
    model_count: modelCount,
    provider_count: providerCount,
    route_count: routeCount
  };
  const inboundAuthState = buildLocalGatewayInboundAuthStateView(
    resolveLocalGatewayInboundAuthState(inboundApiKeyEnv, allowUnauthenticatedGateway),
    { formatEnvVarName: maskSemiSensitiveEnvVarName }
  );

  return {
    gateway_status: input.gatewayStatus,
    port: input.port,
    bind_host: input.bindHost,
    max_connections: maxConnections,
    source_file: input.sourceFile,
    source_path: input.sourcePath,
    systemd_unit: input.systemdUnit,
    route_count: routeCount,
    model_count: modelCount,
    provider_count: providerCount,
    pid: input.pid,
    listener_address: listenerAddress,
    reachable: input.gatewayStatus === "running",
    health_url: healthUrl,
    health_latency_ms: input.healthLatencyMs,
    reason: input.reason ?? null,
    inbound_auth_state: inboundAuthState,
    health_probe_metrics: input.healthProbeMetrics,
    runtime: runtimeView,
    listener: listenerView,
    service: input.serviceStatus,
    config: configView
  };
}

export function renderGatewayStatusText(view: GatewayStatusView): string {
  const lines = [
    "Gateway status snapshot",
    `Config: ${view.config.source_file}`,
    `Runtime: ${view.runtime.gateway_status}  pid=${view.runtime.pid ?? "(unknown)"}  health_latency=${view.runtime.health_latency_ms ?? "(unknown)"}ms`,
    `Listener: ${view.listener.address}  reachable=${view.listener.reachable}  probe_host=${view.listener.probe_host ?? "(unavailable)"}`,
    `Inbound Auth: ${view.inbound_auth_state.status}`,
    `One Trusted Operator Boundary: ${String(view.config.one_trusted_operator_boundary)}`,
    `Service: manager=${view.service.manager}  available=${view.service.available}  scope=${view.service.scope ?? "(unavailable)"}  active=${view.service.active_state ?? "(unavailable)"}  enabled=${view.service.unit_file_state ?? "(unavailable)"}`,
    `Counts: models=${view.config.model_count}  providers=${view.config.provider_count}  routes=${view.config.route_count}`,
    `Health Probes: total=${view.health_probe_metrics.total_requests}  allowed=${view.health_probe_metrics.allowed_requests}  rate_limited=${view.health_probe_metrics.rate_limited_requests}`
  ];

  lines.push("");
  lines.push("Runtime:");
  lines.push(`Gateway Status: ${view.runtime.gateway_status}`);
  lines.push(`PID: ${view.runtime.pid ?? "(unknown)"}`);
  lines.push(`Health Latency: ${view.runtime.health_latency_ms ?? "(unknown)"}ms`);

  lines.push("");
  lines.push("Listener:");
  lines.push(`Bind Host: ${view.listener.bind_host}`);
  lines.push(`Port: ${view.listener.port ?? "(unknown)"}`);
  lines.push(`Address: ${view.listener.address}`);
  lines.push(`Probe Host: ${view.listener.probe_host ?? "(unavailable)"}`);
  lines.push(`Reachable: ${view.listener.reachable}`);
  lines.push(`Health URL: ${view.listener.health_url ?? "(unavailable)"}`);

  lines.push("");
  lines.push("Inbound Auth:");
  lines.push(`Status: ${view.inbound_auth_state.status}`);
  lines.push(`Env Var: ${view.inbound_auth_state.env_var ?? "(none)"}`);
  lines.push(`Reason: ${view.inbound_auth_state.reason ?? "(none)"}`);

  lines.push("");
  lines.push("Health Probe Metrics:");
  lines.push(`Total Requests: ${view.health_probe_metrics.total_requests}`);
  lines.push(`Allowed Requests: ${view.health_probe_metrics.allowed_requests}`);
  lines.push(`Rate Limited Requests: ${view.health_probe_metrics.rate_limited_requests}`);
  lines.push(`Last Seen At: ${view.health_probe_metrics.last_seen_at ?? "(never)"}`);

  lines.push("");
  lines.push("Service:");
  lines.push(`Configured Unit: ${view.systemd_unit}`);
  lines.push(`Manager: ${view.service.manager}`);
  lines.push(`Unit: ${view.service.unit}`);
  lines.push(`Available: ${view.service.available}`);
  lines.push(`Scope: ${view.service.scope ?? "(unavailable)"}`);
  lines.push(`Load State: ${view.service.load_state ?? "(unavailable)"}`);
  lines.push(`Active State: ${view.service.active_state ?? "(unavailable)"}`);
  lines.push(`Sub State: ${view.service.sub_state ?? "(unavailable)"}`);
  lines.push(`Enabled: ${view.service.unit_file_state ?? "(unavailable)"}`);
  lines.push(`Service PID: ${view.service.main_pid ?? "(unknown)"}`);

  lines.push("");
  lines.push("Config:");
  lines.push(`Config: ${view.config.source_file}`);
  lines.push(`Config Path: ${view.config.source_path}`);
  lines.push(`Max Connections: ${view.config.max_connections}`);
  lines.push(`Models: ${view.config.model_count}`);
  lines.push(`Providers: ${view.config.provider_count}`);
  lines.push(`Routes: ${view.config.route_count}`);

  if (view.runtime.reason) {
    lines.push(`Runtime Reason: ${view.runtime.reason}`);
  }

  if (view.service.reason) {
    lines.push(`Service Reason: ${view.service.reason}`);
  }

  return lines.join("\n");
}
