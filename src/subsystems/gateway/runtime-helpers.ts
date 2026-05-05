import type { IncomingMessage, ServerResponse } from "node:http";

import { redactAbsolutePaths } from "../../platform/logger";
import { maskSemiSensitiveEnvVarName } from "../../platform/masked-secret";
import {
  describeLocalGatewayInboundAuthState,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
} from "./local-gateway-auth";
import type { LocalGatewayInboundAuthState } from "./local-gateway-auth";
import { isLoopbackHostname, normalizeHostname } from "../../platform/net-utils";
import { getOrAssignRequestId } from "../../platform/request-id";
import type { ApiMode, AppConfig, ProxyRequestContext } from "../../platform/types";
import type {
  GatewayFatalState,
  GatewayReadModel,
  GatewayReloadState
} from "./runtime-snapshot";
import type { RuntimeRoute } from "./runtime-route-classifier";

const MAX_RUNTIME_INSPECTION_ERROR_LENGTH = 256;
const GATEWAY_BEARER_TOKEN_PATTERN = /^Bearer ([A-Za-z0-9._~+/\-=]+)$/;

export type UnauthenticatedGatewayLocalClientRejection = {
  statusCode: 403 | 415;
  message: string;
  logReason: string;
};

function getSingleHeaderValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function requestHasJsonContentType(request: IncomingMessage): boolean {
  const contentType = getSingleHeaderValue(request.headers["content-type"]);

  if (contentType === null) {
    return false;
  }

  return (contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "") === "application/json";
}

function originTargetsAllowedLocalHost(origin: string, config: Pick<AppConfig, "bindHost">): boolean {
  if (origin.trim().toLowerCase() === "null") {
    return false;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return false;
  }

  const hostname = normalizeGatewayHostname(parsedOrigin.hostname);
  const configuredBindHost = normalizeGatewayHostname(config.bindHost);
  return isLoopbackGatewayHost(hostname) || hostname === configuredBindHost;
}

export function validateUnauthenticatedGatewayLocalClientRequest(
  request: IncomingMessage,
  config: Pick<AppConfig, "bindHost" | "oneTrustedOperatorBoundary">
): UnauthenticatedGatewayLocalClientRejection | null {
  if (config.oneTrustedOperatorBoundary !== true) {
    const localClientHeader = getSingleHeaderValue(request.headers[LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]);
    if (localClientHeader?.trim() !== LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE) {
      return {
        statusCode: 403,
        message: `Unauthenticated gateway requests require header '${LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER}: ${LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE}'.`,
        logReason: "missing or invalid local-client header"
      };
    }
  }

  const origin = getSingleHeaderValue(request.headers.origin);
  if (origin !== null && !originTargetsAllowedLocalHost(origin, config)) {
    return {
      statusCode: 403,
      message: "Unauthenticated gateway requests do not accept cross-site browser origins.",
      logReason: "cross-site Origin header"
    };
  }

  const secFetchSite = getSingleHeaderValue(request.headers["sec-fetch-site"])?.trim().toLowerCase() ?? null;
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return {
      statusCode: 403,
      message: "Unauthenticated gateway requests do not accept cross-site browser fetch metadata.",
      logReason: `suspicious Sec-Fetch-Site '${secFetchSite}'`
    };
  }

  const secFetchMode = getSingleHeaderValue(request.headers["sec-fetch-mode"])?.trim().toLowerCase() ?? null;
  if (secFetchMode === "no-cors" || secFetchMode === "navigate" || secFetchMode === "websocket") {
    return {
      statusCode: 403,
      message: "Unauthenticated gateway requests do not accept browser navigation or no-cors modes.",
      logReason: `suspicious Sec-Fetch-Mode '${secFetchMode}'`
    };
  }

  return null;
}

export function requestHasExpectedInboundAuth(
  request: IncomingMessage,
  expectedToken: string,
  timingSafeTokenMatches: (providedToken: string, expectedToken: string) => boolean
): boolean {
  const authorization = request.headers.authorization;
  const apiKeyHeader = request.headers["x-api-key"];

  if (typeof apiKeyHeader === "string" && timingSafeTokenMatches(apiKeyHeader, expectedToken)) {
    return true;
  }

  if (typeof authorization === "string") {
    const match = GATEWAY_BEARER_TOKEN_PATTERN.exec(authorization);

    if (match !== null && typeof match[1] === "string" && timingSafeTokenMatches(match[1], expectedToken)) {
      return true;
    }
  }

  return false;
}

export function classifyGatewayApiMode(pathname: string): ApiMode | null {
  if (pathname === "/v1/chat/completions") {
    return "openai-completions";
  }

  if (pathname === "/anthropic/v1/messages") {
    return "anthropic-messages";
  }

  return null;
}

export function normalizeGatewaySourceIp(rawSourceIp: string | undefined): string {
  if (typeof rawSourceIp !== "string") {
    return "unknown";
  }

  const normalized = rawSourceIp.trim().toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return normalized.slice("::ffff:".length);
  }

  return normalized.length > 0 ? normalized : "unknown";
}

export function gatewayRequestSourceIp(request: IncomingMessage): string {
  return normalizeGatewaySourceIp(request.socket.remoteAddress);
}

export function gatewayRateLimitKey(request: IncomingMessage, trustClass: RuntimeRoute["trustClass"]): string {
  return `${gatewayRequestSourceIp(request)}:${trustClass}`;
}

export function normalizeGatewayHostname(rawHostname: string): string {
  return normalizeHostname(rawHostname);
}

export function isLoopbackGatewayHost(rawHostname: string): boolean {
  return isLoopbackHostname(rawHostname);
}

export function isAllowedUnauthenticatedGatewayHost(
  hostHeader: string | undefined,
  request: IncomingMessage,
  config: Pick<AppConfig, "bindHost" | "port">
): boolean {
  if (typeof hostHeader !== "string" || hostHeader.trim().length === 0) {
    return false;
  }

  const sourceIp = normalizeGatewaySourceIp(request.socket.remoteAddress);
  if (sourceIp !== "127.0.0.1" && sourceIp !== "::1" && sourceIp !== "0:0:0:0:0:0:0:1") {
    return false;
  }

  let parsedHost: URL;
  try {
    parsedHost = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }

  const hostname = normalizeGatewayHostname(parsedHost.hostname);
  const configuredBindHost = normalizeGatewayHostname(config.bindHost);

  if (parsedHost.port.length > 0 && Number(parsedHost.port) !== config.port) {
    return false;
  }

  return isLoopbackGatewayHost(hostname) || hostname === configuredBindHost;
}

export function buildGatewayRateLimitContext(request: IncomingMessage, apiMode: ApiMode): ProxyRequestContext {
  return {
    requestId: getOrAssignRequestId(request),
    caller: gatewayRequestSourceIp(request),
    bareModel: "",
    stream: false,
    apiMode,
    requestStartedAt: Date.now()
  };
}

export function buildGatewayAuthContext(request: IncomingMessage, pathname: string): ProxyRequestContext {
  return {
    requestId: getOrAssignRequestId(request),
    caller: gatewayRequestSourceIp(request),
    bareModel: "",
    stream: false,
    apiMode: classifyGatewayApiMode(pathname) ?? "openai-completions",
    requestStartedAt: Date.now()
  };
}

export function handleHealth(response: ServerResponse, fatalState?: GatewayFatalState): void {
  const processIntegrityStatus = fatalState?.processIntegrityStatus ?? "ok";
  const body = `${JSON.stringify({
    status: processIntegrityStatus === "ok" ? "ok" : "error",
    process_integrity_status: processIntegrityStatus
  })}\n`;

  response.statusCode = processIntegrityStatus === "ok" ? 200 : 503;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

export function handleHealthRateLimited(response: ServerResponse, retryAfterSeconds: number): void {
  const body = `${JSON.stringify({
    status: "rate_limited"
  })}\n`;

  response.statusCode = 429;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("retry-after", String(retryAfterSeconds));
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

export function applyRateLimitHeaders(
  response: ServerResponse,
  requests: number,
  decision: { remaining: number; resetAtMs: number },
  nowMs = Date.now()
): void {
  const rateLimitResetSeconds = Math.max(0, Math.ceil((decision.resetAtMs - nowMs) / 1_000));
  response.setHeader("ratelimit-limit", String(requests));
  response.setHeader("ratelimit-remaining", String(decision.remaining));
  response.setHeader("ratelimit-reset", String(rateLimitResetSeconds));
}

export function sanitizeRuntimeInspectionError(message: string | null): string | null {
  if (typeof message !== "string" || message.trim().length === 0) {
    return null;
  }

  let sanitized = redactAbsolutePaths(message.split(/\r?\n/, 1)[0]?.trim() ?? "");

  if (sanitized.length > MAX_RUNTIME_INSPECTION_ERROR_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_RUNTIME_INSPECTION_ERROR_LENGTH - 3)}...`;
  }

  return sanitized.length > 0 ? sanitized : null;
}

export function summarizeProviderEndpointForRuntimeView(endpoint: string): Record<string, unknown> {
  try {
    const parsed = new URL(endpoint);
    return {
      endpoint_origin: parsed.origin,
      endpoint_pathname: parsed.pathname,
      endpoint_has_query: parsed.search.length > 0
    };
  } catch {
    return {
      endpoint_origin: null,
      endpoint_pathname: null,
      endpoint_has_query: false
    };
  }
}

export function buildRuntimeConfigView(options: {
  config: AppConfig;
  readModel: GatewayReadModel;
  loadedAt: string;
  reloadState: GatewayReloadState;
  fatalState: GatewayFatalState;
  processStartedAt: string;
  resolveConfiguredSystemdUnit: (config: Pick<AppConfig, "systemdUnit">) => string;
  resolveInboundGatewayAuthState: (config: AppConfig) => LocalGatewayInboundAuthState;
}): Record<string, unknown> {
  const inboundAuth = describeLocalGatewayInboundAuthState(options.resolveInboundGatewayAuthState(options.config));

  return {
    source_file: options.readModel.sourceFile,
    started_at: options.processStartedAt,
    loaded_at: options.loadedAt,
    last_reload_status: options.reloadState.lastReloadStatus,
    last_reload_error: sanitizeRuntimeInspectionError(options.reloadState.lastReloadError),
    last_reload_attempted_at: options.reloadState.lastReloadAttemptedAt,
    last_reload_succeeded_at: options.reloadState.lastReloadSucceededAt,
    process_integrity_status: options.fatalState.processIntegrityStatus,
    last_fatal_error: sanitizeRuntimeInspectionError(options.fatalState.lastFatalError),
    last_fatal_at: options.fatalState.lastFatalAt,
    bind_host: options.config.bindHost,
    port: options.config.port,
    max_connections: options.config.maxConnections,
    timeout_ms: options.config.timeoutMs,
    stream_idle_timeout_ms: options.config.streamIdleTimeoutMs,
    stream_max_lifetime_ms: options.config.streamMaxLifetimeMs,
    stream_min_bytes_per_second: options.config.streamMinBytesPerSecond,
    stream_rate_window_ms: options.config.streamRateWindowMs,
    stream_max_event_bytes: options.config.streamMaxEventBytes,
    stream_max_total_bytes: options.config.streamMaxTotalBytes,
    max_concurrent_streams_per_ip: options.config.maxConcurrentStreamsPerIp ?? 8,
    max_concurrent_json_parses: options.config.maxConcurrentJsonParses ?? 4,
    max_buffered_upstream_response_bytes: options.config.maxBufferedUpstreamResponseBytes ?? 16 * 1024 * 1024,
    shutdown_timeout_ms: options.config.shutdownTimeoutMs,
    max_payload_size: options.config.maxPayloadSize,
    systemd_unit: options.resolveConfiguredSystemdUnit(options.config),
    observability: {
      retention: {
        older_than: options.config.observability.retentionOlderThan
      }
    },
    rate_limit: {
      requests: options.config.rateLimit.requests,
      window: options.config.rateLimit.window
    },
    inbound_auth_status: inboundAuth.status,
    inbound_auth_env_var: maskSemiSensitiveEnvVarName(inboundAuth.envVar),
    allow_unauthenticated_gateway: options.config.allowUnauthenticatedGateway === true,
    one_trusted_operator_boundary: options.config.oneTrustedOperatorBoundary === true,
    allow_unauthenticated_health: options.config.allowUnauthenticatedHealth === true,
    allow_remote_bind: options.config.allowRemoteBind === true,
    allow_wildcard_bind: options.config.allowWildcardBind === true,
    route_count: options.readModel.routes.length,
    model_count: options.readModel.models.length,
    provider_count: options.readModel.providers.length,
    models: options.readModel.models.map((model) => ({
      name: model.name,
      display_name: model.display_name,
      model_creator: model.model_creator,
      route_count: model.route_count
    })),
    providers: options.readModel.providers.map((provider) => ({
      name: provider.name,
      ...summarizeProviderEndpointForRuntimeView(provider.endpoint),
      allow_private_endpoints: provider.allow_private_endpoints,
      allow_insecure_http: provider.allow_insecure_http,
      api_mode: provider.api_mode,
      anthropic_version: provider.anthropic_version,
      api_key_env: maskSemiSensitiveEnvVarName(provider.api_key_env),
      api_key: provider.api_key_masked,
      auth_source: provider.auth_source
    })),
    routes: options.readModel.routes.map((route) => ({
      name: route.name,
      display_name: route.display_name,
      model: route.model,
      service_provider: route.service_provider,
      provider_model_id: route.provider_model_id,
      api_mode: route.api_mode
    }))
  };
}
