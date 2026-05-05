import type { IncomingMessage, ServerResponse } from "node:http";

import { safeErrorMessage, setProcessLogLevel } from "../../platform/logger";
import { assertGatewayBindPolicy } from "../../platform/gateway-bind-policy";
import { parseJsonObjectResponseWithinBounds } from "../../platform/http-json";
import { buildLocalHttpUrl } from "../../platform/net-utils";
import type {
  InboundApiKeyOverrides,
  LocalGatewayInboundAuthState
} from "./local-gateway-auth";
import { loadOptionalConfiguredSecretsFile } from "../config/secrets";
import type { AppConfig, LogLevel } from "../../platform/types";
import type {
  GatewayAnthropicMessagesRequestBody,
  GatewayOpenAiChatRequestBody
} from "./request-body-types";
import type {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";
import { runGatewayServerLifecycle } from "./gateway-runner";
import { createGatewayRuntimeRateLimiter } from "./runtime-rate-limits";
import { createGatewayRuntimeRequestHandler } from "./runtime-request-handler";
import {
  applyGatewayRunOverrides,
  buildInitialGatewayRuntimeSnapshot,
  buildReloadedGatewayRuntimeSnapshot,
  markGatewayRuntimeFatalError,
  markGatewayRuntimeReloadFailure,
  type GatewayReadModel
} from "./runtime-snapshot";

const MAX_RUNTIME_INSPECTION_ERROR_LENGTH = 256;

export function beginGatewayGracefulShutdown(options: {
  shutdownStarted: boolean;
  reason: "SIGINT" | "SIGTERM" | "fatal_runtime_error";
  shutdownTimeoutMs: number;
  exitCode?: number;
  clearRetentionPruneTimer: () => void;
  disposeRuntimeResources?: () => void;
  logWarning: (message: string) => void;
  setForcedExitTimer: (onTimeout: () => void, timeoutMs: number) => unknown;
  clearForcedExitTimer: (timer: unknown) => void;
  closeServer: (onClosed: () => void) => void;
  closeIdleConnections?: () => void;
  finalizeShutdown?: () => Promise<void>;
  exit: (code: number) => void;
}): { shutdownStarted: boolean; forcedExitTimer: unknown | null } {
  if (options.shutdownStarted) {
    return {
      shutdownStarted: true,
      forcedExitTimer: null
    };
  }

  const exitCode = typeof options.exitCode === "number"
    ? options.exitCode
    : options.reason === "fatal_runtime_error"
      ? 1
      : 0;

  if (options.reason === "fatal_runtime_error") {
    options.logWarning("Fatal runtime error detected; shutting down gracefully.");
  } else {
    options.logWarning(`Received ${options.reason}; shutting down gracefully.`);
  }

  options.clearRetentionPruneTimer();
  options.disposeRuntimeResources?.();

  const forcedExitTimer = options.setForcedExitTimer(() => {
    options.logWarning(`Graceful shutdown timed out after ${options.shutdownTimeoutMs}ms; forcing exit.`);
    options.exit(1);
  }, options.shutdownTimeoutMs);

  options.closeServer(() => {
    void (async () => {
      try {
        await options.finalizeShutdown?.();
      } catch (error) {
        options.logWarning(`Shutdown finalizer failed: ${safeErrorMessage(error, MAX_RUNTIME_INSPECTION_ERROR_LENGTH)}`);
      } finally {
        options.clearForcedExitTimer(forcedExitTimer);
        options.exit(exitCode);
      }
    })();
  });

  options.closeIdleConnections?.();

  return {
    shutdownStarted: true,
    forcedExitTimer
  };
}

export function createGatewayRuntime(deps: {
  getCliEnv: () => NodeJS.ProcessEnv;
  loadConfig: (configPath?: string) => AppConfig;
  loadCliReadModel: (configPath?: string) => GatewayReadModel;
  normalizeHealthProbeHost: (bindHost: string) => string;
  buildLocalGatewayAuthHeaders: (
    inboundApiKeyEnv: string | null,
    allowUnauthenticatedGateway: boolean,
    oneTrustedOperatorBoundary?: boolean,
    apiKeyOverrides?: InboundApiKeyOverrides
  ) => Headers;
  resolveLocalGatewayInboundAuthState: (
    inboundApiKeyEnv: string | null | undefined,
    allowUnauthenticatedGateway: boolean,
    apiKeyOverrides?: InboundApiKeyOverrides
  ) => LocalGatewayInboundAuthState;
  timingSafeTokenMatches: (providedToken: string, expectedToken: string) => boolean;
  proxyAnthropicMessage: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayAnthropicMessagesRequestBody,
    rawBody: string
  ) => Promise<void>;
  proxyChatCompletion: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayOpenAiChatRequestBody,
    rawBody: string
  ) => Promise<void>;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  readRequestBodyWithLimit: (
    request: IncomingMessage,
    maxPayloadSize: number,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ) => Promise<string>;
  validateParsedRequestBodyShape: (body: Record<string, unknown>, maxPayloadSize: number) => void;
  resolveConfiguredSystemdUnit: (config: Pick<AppConfig, "systemdUnit">) => string;
  maskSecretValue: (value: string | null) => string | null;
  configureGatewayObservability: (options: { retentionOlderThan: string | null }) => void;
  pruneGatewayObservabilityRetentionNow: (reason?: "interval" | "startup") => void;
  bootstrapGatewayObservability: () => void;
  shutdownGatewayObservability: () => Promise<void>;
  getInlineApiKeyProviderNames: (configPath?: string) => string[];
  getWorldReadableConfigWarning: (configPath?: string) => string | null;
  logLine: (message: string) => void;
  logWarning: (message: string) => void;
  logStartup: (bindHost: string, port: number, routeCount: number, sourcePath: string) => void;
  logDebug: (message: string) => void;
  defaultRequestBodyIdleTimeoutMs: number;
  defaultReloadConfirmationPollIntervalMs: number;
  defaultRetentionPruneIntervalMs: number;
  jsonParseConcurrencyManager?: JsonParseConcurrencyManager;
  streamingRequestConcurrencyManager?: StreamingRequestConcurrencyManager;
}): {
  fetchGatewayRuntimeConfigPayload: (
    document: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{ endpoint: string; payload: Record<string, unknown> }>;
  runGatewayRun: (
    configPath?: string,
    gatewayRunOverrides?: { host?: string; port?: number; logLevel?: LogLevel }
  ) => Promise<void>;
} {
  // Resolve once per gateway-runtime construction. Secrets-file overrides are
  // honored for inbound auth so a gateway that has only `SWITCHMAXXER_SECRETS_PATH`
  // in its environment (no `SWITCHMAXXER_INBOUND_API_KEY` directly exported)
  // can still resolve the bearer token at request time. The map is refreshed
  // implicitly during reload because reload re-creates the runtime via
  // `loadConfig`, and `loadConfig` re-reads the secrets file as part of
  // `requireRuntimeEnv: true` validation.
  const apiKeyOverrides: InboundApiKeyOverrides =
    loadOptionalConfiguredSecretsFile()?.apiKeyOverrides ?? null;

  const requestHandler = createGatewayRuntimeRequestHandler({ ...deps, apiKeyOverrides });

  function resolveInboundGatewayAuthState(config: AppConfig): LocalGatewayInboundAuthState {
    return deps.resolveLocalGatewayInboundAuthState(
      config.inboundApiKeyEnv,
      config.allowUnauthenticatedGateway === true,
      apiKeyOverrides
    );
  }

  async function fetchGatewayRuntimeConfigPayload(
    document: Record<string, unknown>,
    timeoutMs = deps.defaultReloadConfirmationPollIntervalMs
  ): Promise<{ endpoint: string; payload: Record<string, unknown> }> {
    const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;
    const bindHost =
      typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
        ? document["bind_host"]
        : "127.0.0.1";

    if (typeof port !== "number" || port <= 0) {
      throw new Error("The selected config file does not contain a valid numeric 'port'.");
    }

    const probeHost = deps.normalizeHealthProbeHost(bindHost);
    const endpoint = buildLocalHttpUrl(probeHost, port, "/__switchmaxxer/runtime/config");
    const inboundApiKeyEnv =
      typeof document["inbound_api_key_env"] === "string" && document["inbound_api_key_env"].trim().length > 0
        ? document["inbound_api_key_env"]
        : null;
    const allowUnauthenticatedGateway = document["allow_unauthenticated_gateway"] === true;
    const oneTrustedOperatorBoundary = document["one_trusted_operator_boundary"] === true;
    let headers: Headers;

    try {
      headers = deps.buildLocalGatewayAuthHeaders(
        inboundApiKeyEnv,
        allowUnauthenticatedGateway,
        oneTrustedOperatorBoundary,
        apiKeyOverrides
      );
    } catch {
      throw new Error(inboundApiKeyEnv !== null
        ? `The selected config file requires inbound gateway auth via env var '${inboundApiKeyEnv}', but it is not set or is empty.`
        : "The selected config file does not define a valid inbound auth mode.");
    }

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new Error(`Unable to reach runtime config endpoint at '${endpoint}': ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new Error(`runtime config endpoint returned HTTP ${response.status}`);
    }

    const payload = await parseJsonObjectResponseWithinBounds(response);
    return { endpoint, payload };
  }

  async function runGatewayRun(
    configPath?: string,
    gatewayRunOverrides: { host?: string; port?: number; logLevel?: LogLevel } = {}
  ): Promise<void> {
    const cliEnv = deps.getCliEnv();
    const envLogLevel = cliEnv["SWITCHMAXXER_LOG_LEVEL"];
    const envLogLevelOverride =
      envLogLevel === "debug" || envLogLevel === "info" || envLogLevel === "warn" || envLogLevel === "error"
        ? envLogLevel
        : undefined;
    const applyEffectiveLogLevel = (configLogLevel?: LogLevel): LogLevel => {
      const effectiveLogLevel = gatewayRunOverrides.logLevel ?? envLogLevelOverride ?? configLogLevel ?? "info";
      setProcessLogLevel(effectiveLogLevel);
      cliEnv["SWITCHMAXXER_LOG_LEVEL"] = effectiveLogLevel;
      return effectiveLogLevel;
    };

    const initialConfig = applyGatewayRunOverrides(deps.loadConfig(configPath), gatewayRunOverrides);
    assertGatewayBindPolicy({
      sourceName: "gateway runtime effective config",
      bindHost: initialConfig.bindHost,
      inboundApiKeyEnv: initialConfig.inboundApiKeyEnv,
      allowUnauthenticatedGateway: initialConfig.allowUnauthenticatedGateway,
      allowRemoteBind: initialConfig.allowRemoteBind,
      allowWildcardBind: initialConfig.allowWildcardBind
    });
    const initialRuntime = buildInitialGatewayRuntimeSnapshot({
      config: initialConfig,
      readModel: deps.loadCliReadModel(configPath),
      createRuntimeRateLimiter: createGatewayRuntimeRateLimiter
    });
    let shutdownStarted = false;

    await runGatewayServerLifecycle({
      initialRuntime,
      requestHandler,
      resolveInboundAuthKind: (runtime) => resolveInboundGatewayAuthState(runtime.config).kind,
      applyEffectiveLogLevel,
      configureGatewayObservability: (retentionOlderThan) => {
        deps.configureGatewayObservability({ retentionOlderThan });
      },
      pruneGatewayObservabilityRetentionNow: deps.pruneGatewayObservabilityRetentionNow,
      bootstrapGatewayObservability: deps.bootstrapGatewayObservability,
      shutdownGatewayObservability: deps.shutdownGatewayObservability,
      getWorldReadableConfigWarning: () => deps.getWorldReadableConfigWarning(configPath),
      getInlineApiKeyProviderNames: () => deps.getInlineApiKeyProviderNames(configPath),
      defaultRetentionPruneIntervalMs: deps.defaultRetentionPruneIntervalMs,
      logLine: deps.logLine,
      logWarning: deps.logWarning,
      logStartup: deps.logStartup,
      logDebug: deps.logDebug,
      sendJsonError: deps.sendJsonError,
      beginGracefulShutdown: (
        reason,
        currentRuntime,
        clearRetentionPruneTimer,
        closeServer,
        closeIdleConnections,
        removeProcessHandlers,
        exitCode
      ) => {
        const shutdownResult = beginGatewayGracefulShutdown({
          shutdownStarted,
          reason,
          shutdownTimeoutMs: currentRuntime.config.shutdownTimeoutMs ?? 30_000,
          exitCode,
          clearRetentionPruneTimer,
          disposeRuntimeResources: requestHandler.dispose,
          logWarning: deps.logWarning,
          setForcedExitTimer: (onTimeout, timeoutMs) => setTimeout(onTimeout, timeoutMs),
          clearForcedExitTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
          closeServer,
          closeIdleConnections,
          finalizeShutdown: async () => {
            removeProcessHandlers();
            await deps.shutdownGatewayObservability();
          },
          exit: (code) => process.exit(code)
        });
        shutdownStarted = shutdownResult.shutdownStarted;
        return shutdownStarted;
      },
      reloadRuntime: (currentRuntime) => {
        const reloadAttemptedAt = new Date().toISOString();
        const nextConfig = applyGatewayRunOverrides(deps.loadConfig(configPath), gatewayRunOverrides);
        assertGatewayBindPolicy({
          sourceName: "gateway runtime effective config",
          bindHost: nextConfig.bindHost,
          inboundApiKeyEnv: nextConfig.inboundApiKeyEnv,
          allowUnauthenticatedGateway: nextConfig.allowUnauthenticatedGateway,
          allowRemoteBind: nextConfig.allowRemoteBind,
          allowWildcardBind: nextConfig.allowWildcardBind
        });
        const nextReadModel = deps.loadCliReadModel(configPath);

        return buildReloadedGatewayRuntimeSnapshot(
          currentRuntime,
          nextConfig,
          nextReadModel,
          createGatewayRuntimeRateLimiter,
          reloadAttemptedAt
        );
      },
      markReloadFailure: markGatewayRuntimeReloadFailure,
      markFatalRuntimeError: markGatewayRuntimeFatalError
    });
  }

  return {
    fetchGatewayRuntimeConfigPayload,
    runGatewayRun
  };
}
