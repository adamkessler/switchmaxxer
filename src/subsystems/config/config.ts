import { existsSync } from "node:fs";
import path from "node:path";

import {
  type AppConfig,
  type RouteConfig
} from "../../platform/types";
import {
  isNonEmptyString,
  validateBenchmarkSettings,
  validateMcpSettings,
  logPrivateEndpointProviderWarnings,
  validateModelConfig,
  validateObservabilitySettings,
  validateRouteConfig,
  validateRuntimeSettings,
  validateServiceProviderConfig
} from "./config-validation";
import { MAX_CONFIG_FILE_BYTES, readConfigTextWithinLimit } from "./config-read";
import {
  MIN_INBOUND_API_KEY_LENGTH,
  resolveInboundApiKeyValue
} from "../gateway/local-gateway-auth";
import { assertSafeObjectKey, createStringKeyRecord } from "../../platform/object-key-policy";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";
import { loadOptionalConfiguredSecretsFile } from "./secrets";
import {
  assertRuntimeConfigDoesNotOwnCatalogSections,
  composeConfigDocumentWithCatalog,
  loadCatalogForConfig
} from "./catalog";

const DEFAULT_MAX_PAYLOAD_SIZE = 4_000_000;
const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_MAX_CONNECTIONS = 200;
const DEFAULT_STREAM_MAX_LIFETIME_MS = 10 * 60_000;
const DEFAULT_STREAM_MIN_BYTES_PER_SECOND = 16;
const DEFAULT_STREAM_RATE_WINDOW_MS = 30_000;
const DEFAULT_STREAM_MAX_EVENT_BYTES = 1 * 1024 * 1024;
const DEFAULT_STREAM_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_STREAMS_PER_IP = 8;
const DEFAULT_MAX_CONCURRENT_JSON_PARSES = 4;
const DEFAULT_MAX_BUFFERED_UPSTREAM_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BENCHMARK_MAX_TOKENS = 32;
const DEFAULT_BENCHMARK_ANTHROPIC_VERSION = "2023-06-01";
export const CURRENT_CONFIG_VERSION = 1;

export interface CliValidatedConfigSnapshot {
  sourceFile: string;
  sourcePath: string;
  rawText: string;
  document: Record<string, unknown>;
  providers: Record<string, ReturnType<typeof validateServiceProviderConfig>>;
  models: Record<string, ReturnType<typeof validateModelConfig>>;
  routes: Record<string, RouteConfig>;
  mcp?: AppConfig["mcp"];
}

type ValidatedConfigLoadResult = CliValidatedConfigSnapshot & AppConfig;

function isPositiveVersionInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function migrateConfigDocumentToCurrentVersion(
  document: Record<string, unknown>,
  sourceName: string
): Record<string, unknown> {
  const rawVersion = document["config_version"];

  if (typeof rawVersion === "undefined") {
    return {
      ...document,
      config_version: CURRENT_CONFIG_VERSION
    };
  }

  if (!isPositiveVersionInteger(rawVersion)) {
    throw new Error(`${sourceName} field 'config_version' must be a positive integer when provided.`);
  }

  if (rawVersion > CURRENT_CONFIG_VERSION) {
    throw new Error(
      `${sourceName} uses unsupported future config_version ${rawVersion}. Current supported version is ${CURRENT_CONFIG_VERSION}.`
    );
  }

  if (rawVersion < CURRENT_CONFIG_VERSION) {
    throw new Error(
      `${sourceName} uses unsupported config_version ${rawVersion}. Add a migration path before loading it with this release.`
    );
  }

  return document;
}

function loadJsonObject(configPath: string, sourceName: string): {
  document: Record<string, unknown>;
  rawText: string;
} {
  const rawText = readConfigTextWithinLimit(configPath, {
    logicalName: sourceName
  });

  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(rawText, {
      maxSerializedBytes: MAX_CONFIG_FILE_BYTES
    });
  } catch (error) {
    throw new Error(`${sourceName} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${sourceName} must contain a top-level object.`);
  }

  const document = migrateConfigDocumentToCurrentVersion(parsed, sourceName);

  return {
    document,
    rawText: `${JSON.stringify(document, null, 2)}\n`
  };
}

function loadValidatedConfigSnapshot(
  configPath: string,
  options: {
    requireRuntimeEnv: boolean;
  }
): ValidatedConfigLoadResult {
  const sourceFile = path.basename(configPath);
  const { document: configDocument } = loadJsonObject(configPath, sourceFile);
  assertRuntimeConfigDoesNotOwnCatalogSections(configDocument, sourceFile);
  const catalog = loadCatalogForConfig(configPath);
  const candidate = composeConfigDocumentWithCatalog(configDocument, catalog, sourceFile);
  const rawText = `${JSON.stringify(candidate, null, 2)}\n`;
  const settings = validateRuntimeSettings(candidate, sourceFile, {
    bindHost: DEFAULT_BIND_HOST,
    maxConnections: DEFAULT_MAX_CONNECTIONS,
    maxPayloadSize: DEFAULT_MAX_PAYLOAD_SIZE,
    streamMaxLifetimeMs: DEFAULT_STREAM_MAX_LIFETIME_MS,
    streamMinBytesPerSecond: DEFAULT_STREAM_MIN_BYTES_PER_SECOND,
    streamRateWindowMs: DEFAULT_STREAM_RATE_WINDOW_MS,
    streamMaxEventBytes: DEFAULT_STREAM_MAX_EVENT_BYTES,
    streamMaxTotalBytes: DEFAULT_STREAM_MAX_TOTAL_BYTES,
    maxConcurrentStreamsPerIp: DEFAULT_MAX_CONCURRENT_STREAMS_PER_IP,
    maxConcurrentJsonParses: DEFAULT_MAX_CONCURRENT_JSON_PARSES,
    maxBufferedUpstreamResponseBytes: DEFAULT_MAX_BUFFERED_UPSTREAM_RESPONSE_BYTES,
    shutdownTimeoutMs: 30_000,
    systemdUnit: "switchmaxxer.service"
  });
  const observability = validateObservabilitySettings(candidate, sourceFile);
  const mcp = validateMcpSettings(candidate, sourceFile);
  const benchmark = validateBenchmarkSettings(candidate, sourceFile, {
    defaultMaxTokens: DEFAULT_BENCHMARK_MAX_TOKENS,
    defaultAnthropicVersion: DEFAULT_BENCHMARK_ANTHROPIC_VERSION
  });
  const providerApiKeyOverrides = options.requireRuntimeEnv
    ? loadOptionalConfiguredSecretsFile()?.apiKeyOverrides ?? null
    : null;

  if (options.requireRuntimeEnv && settings.inboundApiKeyEnv) {
    // Honor `SWITCHMAXXER_SECRETS_PATH` overrides for inbound auth too, so a
    // gateway started in an environment that has only the secrets path (no
    // inline `process.env` value) still resolves the inbound token correctly.
    const inboundApiKey = resolveInboundApiKeyValue(settings.inboundApiKeyEnv, providerApiKeyOverrides);

    if (!isNonEmptyString(inboundApiKey)) {
      throw new Error(
        `${sourceFile} requires environment variable '${settings.inboundApiKeyEnv}' for inbound gateway auth, but it is not set or is empty.`
      );
    }

    if (inboundApiKey.length < MIN_INBOUND_API_KEY_LENGTH) {
      throw new Error(
        `${sourceFile} requires environment variable '${settings.inboundApiKeyEnv}' for inbound gateway auth to be at least ${MIN_INBOUND_API_KEY_LENGTH} characters long.`
      );
    }
  }

  const serviceProvidersRecord = candidate["service_providers"];
  if (!isRecord(serviceProvidersRecord)) {
    throw new Error(`${sourceFile} must contain a 'service_providers' object.`);
  }

  const routesRecord = candidate["routes"];
  if (!isRecord(routesRecord)) {
    throw new Error(`${sourceFile} must contain a 'routes' object.`);
  }

  const modelsRecord = candidate["models"];
  if (!isRecord(modelsRecord)) {
    throw new Error(`${sourceFile} must contain a 'models' object.`);
  }

  const providers: Record<string, ReturnType<typeof validateServiceProviderConfig>> = createStringKeyRecord();

  for (const [providerName, provider] of Object.entries(serviceProvidersRecord)) {
    assertSafeObjectKey(providerName, "Provider name");
    providers[providerName] = validateServiceProviderConfig(providerName, provider);
  }
  logPrivateEndpointProviderWarnings(
    Object.entries(providers)
      .filter(([, provider]) => provider.allow_private_endpoints)
      .map(([providerName]) => providerName)
  );

  const models: Record<string, ReturnType<typeof validateModelConfig>> = createStringKeyRecord();

  for (const [modelName, model] of Object.entries(modelsRecord)) {
    assertSafeObjectKey(modelName, "Model name");
    models[modelName] = validateModelConfig(modelName, model);
  }

  const routeEntries = Object.entries(routesRecord);

  if (routeEntries.length === 0) {
    throw new Error(`${sourceFile} must define at least one route.`);
  }

  const routes: Record<string, RouteConfig> = createStringKeyRecord();

  for (const [routeName, route] of routeEntries) {
    assertSafeObjectKey(routeName, "Route name");
    routes[routeName] = validateRouteConfig(routeName, route, providers, models, settings.timeoutMs, {
      requireResolvedProviderAuth: options.requireRuntimeEnv,
      providerApiKeyOverrides
    });
  }

  return {
    sourceFile,
    sourcePath: configPath,
    rawText,
    document: candidate,
    providers,
    models,
    routes,
    ...settings,
    observability,
    mcp,
    benchmark
  };
}

function loadNormalizedConfig(configPath: string): AppConfig {
  return loadValidatedConfigSnapshot(configPath, { requireRuntimeEnv: true });
}

export function loadCliValidatedConfigSnapshot(configPath?: string): CliValidatedConfigSnapshot {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), "config.json");

  if (!existsSync(resolvedPath)) {
    throw new Error(`Unable to find config.json at '${resolvedPath}'.`);
  }

  return loadValidatedConfigSnapshot(resolvedPath, { requireRuntimeEnv: false });
}

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), "config.json");

  if (!existsSync(resolvedPath)) {
    throw new Error(`Unable to find config.json at '${resolvedPath}'.`);
  }

  try {
    return loadNormalizedConfig(resolvedPath);
  } catch (error) {
    throw error;
  }
}
