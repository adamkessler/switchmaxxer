import type { McpToolCapability } from "./mcp-capabilities";

export type ApiMode = "openai-completions" | "anthropic-messages";
export type ApiSurface = "openai" | "anthropic";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type ModelIdFormat = "passthrough" | "creator/model";

export const API_MODES = ["openai-completions", "anthropic-messages"] as const;
export const MODEL_ID_FORMATS = ["passthrough", "creator/model"] as const;

export interface CostConfig {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function normalizeApiMode(value: unknown): ApiMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "openai":
    case "openai-completions":
    case "chat_completions":
    case "chat-completions":
      return "openai-completions";
    case "anthropic":
    case "anthropic_messages":
    case "anthropic-messages":
      return "anthropic-messages";
    default:
      return null;
  }
}

export function isApiMode(value: unknown): value is ApiMode {
  return normalizeApiMode(value) !== null;
}

export function normalizeModelIdFormat(value: unknown): ModelIdFormat | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "passthrough":
      return "passthrough";
    case "creator/model":
    case "creator_and_model":
    case "creator-model":
      return "creator/model";
    default:
      return null;
  }
}

export function normalizeLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
      return "warn";
    case "error":
      return "error";
    default:
      return null;
  }
}

export function apiModeFromSurface(surface: ApiSurface): ApiMode {
  return surface === "anthropic" ? "anthropic-messages" : "openai-completions";
}

export interface RouteConfig {
  serviceProvider: string;
  api_mode: ApiMode;
  anthropicVersion: string | null;
  upstreamModelIdFormat?: ModelIdFormat;
  modelCreator: string;
  model: string;
  baseUrl: string;
  allowPrivateEndpoints: boolean;
  apiKeyEnv: string | null;
  inlineApiKey: import("./secret-string").SecretString | null;
  apiKeyOverride?: import("./secret-string").SecretString | null;
  cost: CostConfig | null;
  modelCost: CostConfig | null;
  routeTimeoutMs: number | null;
  timeoutMs: number;
}

export interface GlobalRateLimitConfig {
  requests: number;
  window: string;
}

export interface AppConfig {
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
  maxConcurrentStreamsPerIp?: number;
  maxConcurrentJsonParses?: number;
  maxBufferedUpstreamResponseBytes?: number;
  shutdownTimeoutMs?: number;
  maxPayloadSize: number;
  inboundApiKeyEnv?: string | null;
  allowUnauthenticatedGateway?: boolean;
  oneTrustedOperatorBoundary?: boolean;
  allowUnauthenticatedHealth?: boolean;
  allowRemoteBind?: boolean;
  allowWildcardBind?: boolean;
  rateLimit: GlobalRateLimitConfig;
  systemdUnit: string;
  observability: {
    retentionOlderThan: string | null;
  };
  mcp?: {
    capabilities: McpToolCapability[];
  };
  benchmark: {
    defaultMaxTokens: number;
    defaultAnthropicVersion: string;
  };
  logLevel?: LogLevel;
  sourceFile: string;
  sourcePath: string;
  routes: Record<string, RouteConfig>;
}

export interface ModelReadModel {
  name: string;
  display_name: string;
  model_creator: string;
  route_count: number;
  cost: CostConfig | null;
}

export interface ProviderReadModel {
  name: string;
  endpoint: string;
  api_mode: ApiMode | "";
  anthropic_version: string | null;
  model_id_format: ModelIdFormat;
  api_key_env: string | null;
  api_key_masked: string | null;
  allow_private_endpoints: boolean;
  allow_insecure_http: boolean;
  auth_source: "inline override" | "secrets override" | "env var" | "not required";
}

export interface RouteReadModel {
  name: string;
  model: string;
  service_provider: string;
  provider_model_id: string;
  display_name: string;
  api_mode: ApiMode | "";
  cost: CostConfig | null;
  model_cost: CostConfig | null;
  effective_cost: CostConfig | null;
  timeout_ms: number | null;
  effective_timeout_ms: number | null;
}

export interface CliReadModel {
  sourceFile: string;
  sourcePath: string;
  rawText: string;
  models: ModelReadModel[];
  modelsByName: Record<string, ModelReadModel>;
  providers: ProviderReadModel[];
  providersByName: Record<string, ProviderReadModel>;
  routes: RouteReadModel[];
  routesByName: Record<string, RouteReadModel>;
}

export interface ErrorBody {
  error: {
    message: string;
    type: "switchmaxxer_error";
    code: string;
  };
}

export interface ProxyRequestContext {
  requestId: string;
  caller: string;
  bareModel: string;
  stream: boolean;
  apiMode: ApiMode;
  requestStartedAt: number;
}
