import { logWarning } from "../../platform/logger";
import { assertGatewayBindPolicy } from "../../platform/gateway-bind-policy";
import {
  ALL_MCP_TOOL_CAPABILITIES,
  DEFAULT_MCP_TOOL_CAPABILITIES,
  type McpToolCapability
} from "../../platform/mcp-capabilities";
import { parseRateLimitWindowMs } from "../../platform/rate-limit-window";
import { isRetentionDurationString } from "../../platform/retention-duration";
import { isRecord } from "../../platform/type-guards";
import { normalizeLogLevel, type AppConfig } from "../../platform/types";
import {
  assertOnlyKnownKeys,
  assertValidSwitchmaxxerManagedEnvVarName,
  assertValidSystemdUnitName,
  getNullableStringField,
  isNonEmptyString,
  isPositiveInteger,
  isPositiveNumber
} from "./config-validators-primitives";

const warnedPrivateEndpointProviders = new Set<string>();
const warnedMcpCapabilityMigrationSources = new Set<string>();

export const CONFIG_DOCUMENT_TOP_LEVEL_KEYS = [
  "config_version",
  "port",
  "bind_host",
  "allow_remote_bind",
  "allow_wildcard_bind",
  "max_connections",
  "timeout_ms",
  "stream_idle_timeout_ms",
  "stream_max_lifetime_ms",
  "stream_min_bytes_per_second",
  "stream_rate_window_ms",
  "stream_max_event_bytes",
  "stream_max_total_bytes",
  "max_concurrent_streams_per_ip",
  "max_concurrent_json_parses",
  "max_buffered_upstream_response_bytes",
  "shutdown_timeout_ms",
  "max_payload_size",
  "inbound_api_key_env",
  "allow_unauthenticated_gateway",
  "one_trusted_operator_boundary",
  "allow_unauthenticated_health",
  "rate_limit",
  "systemd_unit",
  "log_level",
  "observability",
  "mcp",
  "service_providers",
  "routes",
  "models",
  "benchmark"
] as const;

export function assertOnlyKnownConfigDocumentKeys(candidate: Record<string, unknown>, sourceName: string): void {
  assertOnlyKnownKeys(candidate, CONFIG_DOCUMENT_TOP_LEVEL_KEYS, sourceName);
}

function logMcpCapabilityMigrationWarning(sourceName: string, fieldName: "mcp" | "mcp.capabilities"): void {
  const warningKey = `${sourceName}:${fieldName}`;
  if (warnedMcpCapabilityMigrationSources.has(warningKey)) {
    return;
  }
  warnedMcpCapabilityMigrationSources.add(warningKey);

  logWarning(
    `${sourceName} omits '${fieldName}'; defaulting MCP sessions to read-only access. ` +
      `Set "mcp": { "capabilities": ["read", "mutation", "privileged"] } only for trusted clients that intentionally need full local control.`
  );
}

export function logPrivateEndpointProviderWarnings(providerNames: readonly string[]): void {
  const newlyWarnedProviders = providerNames.filter((name) => !warnedPrivateEndpointProviders.has(name));
  if (newlyWarnedProviders.length === 0) {
    return;
  }

  for (const name of newlyWarnedProviders) {
    warnedPrivateEndpointProviders.add(name);
  }

  const providerLabel = newlyWarnedProviders.length === 1 ? "service provider" : "service providers";
  const verb = newlyWarnedProviders.length === 1 ? "enables" : "enable";
  const providerList = newlyWarnedProviders.map((name) => `  - ${name}`).join("\n");

  logWarning(
    `The following ${providerLabel} ${verb} 'allow_private_endpoints'.\n` +
      `This permits private-address routing and should only be used for intentionally trusted local or private upstreams. DNS hostnames still use pinned-resolution dispatch:\n` +
      `${providerList}`
  );
}

export function validateRuntimeSettings(
  candidate: Record<string, unknown>,
  sourceName: string,
  defaults: {
    bindHost: string;
    maxConnections: number;
    maxPayloadSize: number;
    streamMaxLifetimeMs: number;
    streamMinBytesPerSecond: number;
    streamRateWindowMs: number;
    streamMaxEventBytes: number;
    streamMaxTotalBytes: number;
    maxConcurrentStreamsPerIp: number;
    maxConcurrentJsonParses: number;
    maxBufferedUpstreamResponseBytes: number;
    shutdownTimeoutMs: number;
    systemdUnit: string;
  }
): {
  port: number;
  bindHost: string;
  maxConnections: number;
  timeoutMs: number;
  streamIdleTimeoutMs: number;
  streamMaxLifetimeMs: number;
  streamMinBytesPerSecond: number;
  streamRateWindowMs: number;
  streamMaxEventBytes: number;
  streamMaxTotalBytes: number;
  maxConcurrentStreamsPerIp: number;
  maxConcurrentJsonParses: number;
  maxBufferedUpstreamResponseBytes: number;
  shutdownTimeoutMs: number;
  maxPayloadSize: number;
  inboundApiKeyEnv: string | null;
  allowUnauthenticatedGateway: boolean;
  oneTrustedOperatorBoundary: boolean;
  allowUnauthenticatedHealth: boolean;
  allowRemoteBind: boolean;
  allowWildcardBind: boolean;
  rateLimit: AppConfig["rateLimit"];
  systemdUnit: string;
  logLevel?: AppConfig["logLevel"];
} {
  assertOnlyKnownConfigDocumentKeys(candidate, sourceName);

  if (!isPositiveNumber(candidate["port"])) {
    throw new Error(`${sourceName} must contain a positive numeric 'port'.`);
  }

  if (!isPositiveNumber(candidate["timeout_ms"])) {
    throw new Error(`${sourceName} must contain a positive numeric 'timeout_ms'.`);
  }

  if (!isPositiveNumber(candidate["stream_idle_timeout_ms"])) {
    throw new Error(`${sourceName} must contain a positive numeric 'stream_idle_timeout_ms'.`);
  }

  const streamMaxLifetimeMs =
    typeof candidate["stream_max_lifetime_ms"] === "undefined"
      ? defaults.streamMaxLifetimeMs
      : candidate["stream_max_lifetime_ms"];

  if (!isPositiveNumber(streamMaxLifetimeMs)) {
    throw new Error(`${sourceName} must contain a positive numeric 'stream_max_lifetime_ms'.`);
  }

  const streamMinBytesPerSecond =
    typeof candidate["stream_min_bytes_per_second"] === "undefined"
      ? defaults.streamMinBytesPerSecond
      : candidate["stream_min_bytes_per_second"];

  if (!isPositiveInteger(streamMinBytesPerSecond)) {
    throw new Error(`${sourceName} must contain a positive integer 'stream_min_bytes_per_second'.`);
  }

  const streamRateWindowMs =
    typeof candidate["stream_rate_window_ms"] === "undefined"
      ? defaults.streamRateWindowMs
      : candidate["stream_rate_window_ms"];

  if (!isPositiveInteger(streamRateWindowMs)) {
    throw new Error(`${sourceName} must contain a positive integer 'stream_rate_window_ms'.`);
  }

  const streamMaxEventBytes =
    typeof candidate["stream_max_event_bytes"] === "undefined"
      ? defaults.streamMaxEventBytes
      : candidate["stream_max_event_bytes"];

  if (!isPositiveInteger(streamMaxEventBytes)) {
    throw new Error(`${sourceName} must contain a positive integer 'stream_max_event_bytes'.`);
  }

  const streamMaxTotalBytes =
    typeof candidate["stream_max_total_bytes"] === "undefined"
      ? defaults.streamMaxTotalBytes
      : candidate["stream_max_total_bytes"];

  if (!isPositiveInteger(streamMaxTotalBytes)) {
    throw new Error(`${sourceName} must contain a positive integer 'stream_max_total_bytes'.`);
  }

  const maxConcurrentStreamsPerIp =
    typeof candidate["max_concurrent_streams_per_ip"] === "undefined"
      ? defaults.maxConcurrentStreamsPerIp
      : candidate["max_concurrent_streams_per_ip"];

  if (!isPositiveInteger(maxConcurrentStreamsPerIp)) {
    throw new Error(`${sourceName} must contain a positive integer 'max_concurrent_streams_per_ip'.`);
  }

  const maxConcurrentJsonParses =
    typeof candidate["max_concurrent_json_parses"] === "undefined"
      ? defaults.maxConcurrentJsonParses
      : candidate["max_concurrent_json_parses"];

  if (!isPositiveInteger(maxConcurrentJsonParses)) {
    throw new Error(`${sourceName} must contain a positive integer 'max_concurrent_json_parses'.`);
  }

  const maxBufferedUpstreamResponseBytes =
    typeof candidate["max_buffered_upstream_response_bytes"] === "undefined"
      ? defaults.maxBufferedUpstreamResponseBytes
      : candidate["max_buffered_upstream_response_bytes"];

  if (!isPositiveInteger(maxBufferedUpstreamResponseBytes)) {
    throw new Error(`${sourceName} must contain a positive integer 'max_buffered_upstream_response_bytes'.`);
  }

  const shutdownTimeoutMs =
    typeof candidate["shutdown_timeout_ms"] === "undefined"
      ? defaults.shutdownTimeoutMs
      : candidate["shutdown_timeout_ms"];

  if (!isPositiveNumber(shutdownTimeoutMs)) {
    throw new Error(`${sourceName} must contain a positive numeric 'shutdown_timeout_ms'.`);
  }

  const bindHost = typeof candidate["bind_host"] === "undefined" ? defaults.bindHost : candidate["bind_host"];

  if (!isNonEmptyString(bindHost)) {
    throw new Error(`${sourceName} must contain a non-empty string 'bind_host'.`);
  }

  if (
    typeof candidate["allow_remote_bind"] !== "undefined" &&
    typeof candidate["allow_remote_bind"] !== "boolean"
  ) {
    throw new Error(`${sourceName} field 'allow_remote_bind' must be a boolean when provided.`);
  }

  const allowRemoteBind = candidate["allow_remote_bind"] === true;

  if (
    typeof candidate["allow_wildcard_bind"] !== "undefined" &&
    typeof candidate["allow_wildcard_bind"] !== "boolean"
  ) {
    throw new Error(`${sourceName} field 'allow_wildcard_bind' must be a boolean when provided.`);
  }

  const allowWildcardBind = candidate["allow_wildcard_bind"] === true;

  const maxConnections =
    typeof candidate["max_connections"] === "undefined" ? defaults.maxConnections : candidate["max_connections"];

  if (!isPositiveInteger(maxConnections)) {
    throw new Error(`${sourceName} must contain a positive integer 'max_connections'.`);
  }

  const maxPayloadSize =
    typeof candidate["max_payload_size"] === "undefined" ? defaults.maxPayloadSize : candidate["max_payload_size"];

  if (!isPositiveInteger(maxPayloadSize)) {
    throw new Error(`${sourceName} must contain a positive integer 'max_payload_size'.`);
  }

  if (
    typeof candidate["inbound_api_key_env"] !== "undefined" &&
    candidate["inbound_api_key_env"] !== null &&
    !isNonEmptyString(candidate["inbound_api_key_env"])
  ) {
    throw new Error(`${sourceName} must contain a non-empty string 'inbound_api_key_env' when provided.`);
  }

  const inboundApiKeyEnv = getNullableStringField(candidate, "inbound_api_key_env", sourceName) ?? null;

  if (inboundApiKeyEnv !== null) {
    assertValidSwitchmaxxerManagedEnvVarName(inboundApiKeyEnv, "inbound_api_key_env", sourceName);
  }

  if (
    typeof candidate["allow_unauthenticated_gateway"] !== "undefined" &&
    typeof candidate["allow_unauthenticated_gateway"] !== "boolean"
  ) {
    throw new Error(`${sourceName} field 'allow_unauthenticated_gateway' must be a boolean when provided.`);
  }

  const allowUnauthenticatedGateway = candidate["allow_unauthenticated_gateway"] === true;

  if (
    typeof candidate["one_trusted_operator_boundary"] !== "undefined" &&
    typeof candidate["one_trusted_operator_boundary"] !== "boolean"
  ) {
    throw new Error(`${sourceName} field 'one_trusted_operator_boundary' must be a boolean when provided.`);
  }

  const oneTrustedOperatorBoundary = candidate["one_trusted_operator_boundary"] === true;

  if (
    typeof candidate["allow_unauthenticated_health"] !== "undefined" &&
    typeof candidate["allow_unauthenticated_health"] !== "boolean"
  ) {
    throw new Error(`${sourceName} field 'allow_unauthenticated_health' must be a boolean when provided.`);
  }

  const allowUnauthenticatedHealth = candidate["allow_unauthenticated_health"] === true;

  if (inboundApiKeyEnv !== null && allowUnauthenticatedGateway) {
    throw new Error(
      `${sourceName} must not set both 'inbound_api_key_env' and 'allow_unauthenticated_gateway'. Choose exactly one inbound auth mode.`
    );
  }

  if (inboundApiKeyEnv === null && !allowUnauthenticatedGateway) {
    throw new Error(
      `${sourceName} must set either 'inbound_api_key_env' or 'allow_unauthenticated_gateway: true'.`
    );
  }

  assertGatewayBindPolicy({
    sourceName,
    bindHost,
    inboundApiKeyEnv,
    allowUnauthenticatedGateway,
    allowRemoteBind,
    allowWildcardBind
  });

  if (!isRecord(candidate["rate_limit"])) {
    throw new Error(`${sourceName} must contain a 'rate_limit' object.`);
  }

  const rateLimit = candidate["rate_limit"];
  assertOnlyKnownKeys(rateLimit, ["requests", "window"], `${sourceName} field 'rate_limit'`);

  if (!isPositiveInteger(rateLimit["requests"])) {
    throw new Error(`${sourceName} field 'rate_limit.requests' must be a positive integer.`);
  }

  if (!isNonEmptyString(rateLimit["window"])) {
    throw new Error(`${sourceName} field 'rate_limit.window' must be a non-empty duration string.`);
  }

  if (parseRateLimitWindowMs(rateLimit["window"]) === null) {
    throw new Error(`${sourceName} field 'rate_limit.window' must be a duration like '250ms', '1s', '5m', or '1h'.`);
  }

  const systemdUnit =
    typeof candidate["systemd_unit"] === "undefined" ? defaults.systemdUnit : candidate["systemd_unit"];

  if (!isNonEmptyString(systemdUnit)) {
    throw new Error(`${sourceName} must contain a non-empty string 'systemd_unit'.`);
  }

  assertValidSystemdUnitName(systemdUnit, sourceName);

  let logLevel: AppConfig["logLevel"];

  if (typeof candidate["log_level"] !== "undefined") {
    const normalized = normalizeLogLevel(candidate["log_level"]);

    if (normalized === null) {
      throw new Error(`${sourceName} must contain a valid 'log_level' value: debug, info, warn, or error.`);
    }

    logLevel = normalized;
  }

  return {
    port: candidate["port"] as number,
    bindHost,
    maxConnections,
    timeoutMs: candidate["timeout_ms"] as number,
    streamIdleTimeoutMs: candidate["stream_idle_timeout_ms"] as number,
    streamMaxLifetimeMs,
    streamMinBytesPerSecond,
    streamRateWindowMs,
    streamMaxEventBytes,
    streamMaxTotalBytes,
    maxConcurrentStreamsPerIp,
    maxConcurrentJsonParses,
    maxBufferedUpstreamResponseBytes,
    shutdownTimeoutMs,
    maxPayloadSize,
    inboundApiKeyEnv,
    allowUnauthenticatedGateway,
    oneTrustedOperatorBoundary,
    allowUnauthenticatedHealth,
    allowRemoteBind,
    allowWildcardBind,
    rateLimit: {
      requests: rateLimit["requests"],
      window: rateLimit["window"]
    },
    systemdUnit,
    logLevel
  };
}

export function validateObservabilitySettings(
  candidate: Record<string, unknown>,
  sourceName: string
): AppConfig["observability"] {
  if (typeof candidate["observability"] === "undefined") {
    return {
      retentionOlderThan: null
    };
  }

  if (!isRecord(candidate["observability"])) {
    throw new Error(`${sourceName} field 'observability' must be an object when provided.`);
  }

  const observability = candidate["observability"];
  assertOnlyKnownKeys(observability, ["retention"], `${sourceName} field 'observability'`);

  if (typeof observability["retention"] === "undefined") {
    return {
      retentionOlderThan: null
    };
  }

  if (!isRecord(observability["retention"])) {
    throw new Error(`${sourceName} field 'observability.retention' must be an object when provided.`);
  }

  const retention = observability["retention"];
  assertOnlyKnownKeys(retention, ["older_than"], `${sourceName} field 'observability.retention'`);

  if (typeof retention["older_than"] === "undefined" || retention["older_than"] === null) {
    return {
      retentionOlderThan: null
    };
  }

  if (!isRetentionDurationString(retention["older_than"])) {
    throw new Error(
      `${sourceName} field 'observability.retention.older_than' must be a duration like '14d', '168h', '30m', or '2w'.`
    );
  }

  return {
    retentionOlderThan: retention["older_than"]
  };
}

export function validateBenchmarkSettings(
  candidate: Record<string, unknown>,
  sourceName: string,
  defaults: {
    defaultMaxTokens: number;
    defaultAnthropicVersion: string;
  }
): AppConfig["benchmark"] {
  if (typeof candidate["benchmark"] === "undefined") {
    return {
      defaultMaxTokens: defaults.defaultMaxTokens,
      defaultAnthropicVersion: defaults.defaultAnthropicVersion
    };
  }

  if (!isRecord(candidate["benchmark"])) {
    throw new Error(`${sourceName} field 'benchmark' must be an object when provided.`);
  }

  const benchmark = candidate["benchmark"];
  assertOnlyKnownKeys(
    benchmark,
    ["default_max_tokens", "default_anthropic_version"],
    `${sourceName} field 'benchmark'`
  );

  const defaultMaxTokens =
    typeof benchmark["default_max_tokens"] === "undefined"
      ? defaults.defaultMaxTokens
      : benchmark["default_max_tokens"];

  if (!isPositiveInteger(defaultMaxTokens)) {
    throw new Error(`${sourceName} field 'benchmark.default_max_tokens' must be a positive integer.`);
  }

  const defaultAnthropicVersion =
    getNullableStringField(
      benchmark,
      "default_anthropic_version",
      `${sourceName} field 'benchmark'`
    ) ?? defaults.defaultAnthropicVersion;

  return {
    defaultMaxTokens,
    defaultAnthropicVersion
  };
}

export function validateMcpSettings(
  candidate: Record<string, unknown>,
  sourceName: string
): {
  capabilities: McpToolCapability[];
} {
  const rawMcp = candidate["mcp"];

  if (typeof rawMcp === "undefined") {
    logMcpCapabilityMigrationWarning(sourceName, "mcp");
    return {
      capabilities: [...DEFAULT_MCP_TOOL_CAPABILITIES]
    };
  }

  if (!isRecord(rawMcp)) {
    throw new Error(`${sourceName} field 'mcp' must be an object when provided.`);
  }

  assertOnlyKnownKeys(rawMcp, ["capabilities"], `${sourceName} field 'mcp'`);

  const rawCapabilities = rawMcp["capabilities"];
  if (typeof rawCapabilities === "undefined") {
    logMcpCapabilityMigrationWarning(sourceName, "mcp.capabilities");
    return {
      capabilities: [...DEFAULT_MCP_TOOL_CAPABILITIES]
    };
  }

  if (!Array.isArray(rawCapabilities)) {
    throw new Error(`${sourceName} field 'mcp.capabilities' must be an array when provided.`);
  }

  const normalizedCapabilities: McpToolCapability[] = [];

  for (const capability of rawCapabilities) {
    if (typeof capability !== "string" || !ALL_MCP_TOOL_CAPABILITIES.includes(capability as McpToolCapability)) {
      throw new Error(
        `${sourceName} field 'mcp.capabilities' may only contain: ${ALL_MCP_TOOL_CAPABILITIES.join(", ")}.`
      );
    }

    if (!normalizedCapabilities.includes(capability as McpToolCapability)) {
      normalizedCapabilities.push(capability as McpToolCapability);
    }
  }

  return {
    capabilities: normalizedCapabilities
  };
}
