import type { AppConfig } from "../../../../platform/types";
import type { GlobalRateLimiter } from "./rate-limit";

export type GatewayFatalState = {
  processIntegrityStatus: "ok" | "fatal";
  lastFatalError: string | null;
  lastFatalAt: string | null;
};

export type GatewayReloadState = {
  lastReloadStatus: "never_attempted" | "ok" | "failed";
  lastReloadError: string | null;
  lastReloadAttemptedAt: string | null;
  lastReloadSucceededAt: string | null;
};

export type GatewayReadModel = {
  sourceFile: string;
  routes: Array<{
    name: string;
    display_name: string;
    model: string;
    service_provider: string;
    provider_model_id: string;
    api_mode: string;
  }>;
  models: Array<{
    name: string;
    display_name: string;
    model_creator: string;
    route_count: number;
  }>;
  providers: Array<{
    name: string;
    endpoint: string;
    allow_private_endpoints: boolean;
    allow_insecure_http: boolean;
    api_mode: string;
    anthropic_version: string | null;
    api_key_env: string | null;
    api_key_masked: string | null;
    auth_source: string;
  }>;
};

export type GatewayRuntimeSnapshot = {
  config: AppConfig;
  readModel: GatewayReadModel;
  rateLimiter: GlobalRateLimiter;
  loadedAt: string;
  reloadState: GatewayReloadState;
  fatalState: GatewayFatalState;
};

export type GatewayRuntimeAddressOverrides = {
  host?: string;
  port?: number;
};

function createInitialGatewayReloadState(): GatewayReloadState {
  return {
    lastReloadStatus: "never_attempted",
    lastReloadError: null,
    lastReloadAttemptedAt: null,
    lastReloadSucceededAt: null
  };
}

function createHealthyGatewayFatalState(): GatewayFatalState {
  return {
    processIntegrityStatus: "ok",
    lastFatalError: null,
    lastFatalAt: null
  };
}

export function applyGatewayRunOverrides<T extends { bindHost: string; port: number }>(
  config: T,
  overrides: GatewayRuntimeAddressOverrides
): T {
  if (typeof overrides.host === "undefined" && typeof overrides.port === "undefined") {
    return config;
  }

  return {
    ...config,
    bindHost: overrides.host ?? config.bindHost,
    port: overrides.port ?? config.port
  };
}

export function buildInitialGatewayRuntimeSnapshot(options: {
  config: AppConfig;
  readModel: GatewayReadModel;
  createRuntimeRateLimiter: (config: AppConfig) => GlobalRateLimiter;
  loadedAt?: string;
}): GatewayRuntimeSnapshot {
  return {
    config: options.config,
    readModel: options.readModel,
    rateLimiter: options.createRuntimeRateLimiter(options.config),
    loadedAt: options.loadedAt ?? new Date().toISOString(),
    reloadState: createInitialGatewayReloadState(),
    fatalState: createHealthyGatewayFatalState()
  };
}

export function buildReloadedGatewayRuntimeSnapshot(
  currentRuntime: GatewayRuntimeSnapshot,
  nextConfig: AppConfig,
  nextReadModel: GatewayReadModel,
  createRuntimeRateLimiter: (config: AppConfig) => GlobalRateLimiter,
  reloadedAt = new Date().toISOString()
): GatewayRuntimeSnapshot {
  if (nextConfig.port !== currentRuntime.config.port || nextConfig.bindHost !== currentRuntime.config.bindHost) {
    throw new Error(
      `Reload requires restart when 'port' or 'bindHost' changes (current ${currentRuntime.config.bindHost}:${currentRuntime.config.port}, next ${nextConfig.bindHost}:${nextConfig.port}).`
    );
  }

  return {
    config: nextConfig,
    readModel: nextReadModel,
    rateLimiter: createRuntimeRateLimiter(nextConfig),
    loadedAt: reloadedAt,
    reloadState: {
      lastReloadStatus: "ok",
      lastReloadError: null,
      lastReloadAttemptedAt: reloadedAt,
      lastReloadSucceededAt: reloadedAt
    },
    fatalState: currentRuntime.fatalState
  };
}

export function markGatewayRuntimeReloadFailure(
  currentRuntime: GatewayRuntimeSnapshot,
  message: string,
  attemptedAt = new Date().toISOString()
): GatewayRuntimeSnapshot {
  return {
    ...currentRuntime,
    reloadState: {
      ...currentRuntime.reloadState,
      lastReloadStatus: "failed",
      lastReloadError: message,
      lastReloadAttemptedAt: attemptedAt
    }
  };
}

export function markGatewayRuntimeFatalError(
  currentRuntime: GatewayRuntimeSnapshot,
  message: string,
  fatalAt = new Date().toISOString()
): GatewayRuntimeSnapshot {
  return {
    ...currentRuntime,
    fatalState: {
      processIntegrityStatus: "fatal",
      lastFatalError: message,
      lastFatalAt: fatalAt
    }
  };
}
