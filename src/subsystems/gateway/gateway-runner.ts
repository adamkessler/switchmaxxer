import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { isGatewayRemoteBindEnabled } from "../../platform/gateway-bind-policy";
import { safeErrorMessage } from "../../platform/logger";
import { isWildcardBindHostname } from "../../platform/net-utils";
import type { LogLevel } from "../../platform/types";
import type { GatewayFatalState, GatewayReloadState } from "./runtime-snapshot";

type GatewayRuntimeSnapshotLike = {
  config: {
    sourceFile: string;
    sourcePath: string;
    bindHost: string;
    port: number;
    allowRemoteBind?: boolean;
    allowWildcardBind?: boolean;
    maxConnections: number;
    shutdownTimeoutMs?: number;
    observability: {
      retentionOlderThan: string | null;
    };
    routes: Record<string, unknown>;
    logLevel?: LogLevel;
  };
  readModel: {
    providers: Array<{
      name: string;
      auth_source: string;
    }>;
  };
  reloadState: GatewayReloadState;
  fatalState: GatewayFatalState;
};

type GatewayProcessHandlers = {
  onSigint: () => void;
  onSigterm: () => void;
  onSighup: () => void;
  onUnhandledRejection: (reason: unknown) => void;
  onUncaughtException: (error: Error) => void;
};

export function registerGatewayProcessHandlers(handlers: GatewayProcessHandlers): () => void {
  let removed = false;

  process.on("SIGINT", handlers.onSigint);
  process.on("SIGTERM", handlers.onSigterm);
  process.on("unhandledRejection", handlers.onUnhandledRejection);
  process.on("uncaughtException", handlers.onUncaughtException);
  process.on("SIGHUP", handlers.onSighup);

  return () => {
    if (removed) {
      return;
    }

    removed = true;
    process.off("SIGINT", handlers.onSigint);
    process.off("SIGTERM", handlers.onSigterm);
    process.off("unhandledRejection", handlers.onUnhandledRejection);
    process.off("uncaughtException", handlers.onUncaughtException);
    process.off("SIGHUP", handlers.onSighup);
  };
}

export function handleGatewayRequestHandlerFailure(options: {
  error: Error;
  response: ServerResponse;
  logLine: (message: string) => void;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
}): void {
  options.logLine(`x ERROR     model=unknown  reason="${safeErrorMessage(options.error, 512)}"  status=500`);

  if (!options.response.headersSent) {
    options.sendJsonError(options.response, 500, "Internal server error", APP_ERROR_CODES.internalError);
    return;
  }

  if (options.response.writableEnded || options.response.destroyed) {
    return;
  }

  options.response.destroy(new Error("Gateway request handler failed after response headers were sent."));
}

export function buildGatewayRemoteBindWarning(config: {
  bindHost: string;
  port: number;
  allowRemoteBind?: boolean;
  allowWildcardBind?: boolean;
}): string | null {
  if (!isGatewayRemoteBindEnabled(config)) {
    return null;
  }

  if (isWildcardBindHostname(config.bindHost)) {
    return (
      `Gateway wildcard bind is enabled on ${config.bindHost}:${config.port}. ` +
      "This binds the gateway to all network interfaces on the host; protect the inbound auth token, review firewall/VPN/container exposure, and monitor upstream provider quota."
    );
  }

  return (
    `Gateway remote bind is enabled on ${config.bindHost}:${config.port}. ` +
    "This can make the gateway reachable from other machines; protect the inbound auth token and monitor upstream provider quota."
  );
}

export async function runGatewayServerLifecycle<TSnapshot extends GatewayRuntimeSnapshotLike>(options: {
  initialRuntime: TSnapshot;
  requestHandler: (
    request: IncomingMessage,
    response: ServerResponse,
    activeRuntime: TSnapshot
  ) => Promise<void>;
  resolveInboundAuthKind: (runtime: TSnapshot) => "disabled_explicit" | string;
  applyEffectiveLogLevel: (configLogLevel?: LogLevel) => LogLevel;
  configureGatewayObservability: (retentionOlderThan: string | null) => void;
  pruneGatewayObservabilityRetentionNow: (reason?: "interval" | "startup") => void;
  bootstrapGatewayObservability: () => void;
  shutdownGatewayObservability: () => Promise<void>;
  getWorldReadableConfigWarning: () => string | null;
  getInlineApiKeyProviderNames: () => string[];
  defaultRetentionPruneIntervalMs: number;
  logLine: (message: string) => void;
  logWarning: (message: string) => void;
  logStartup: (bindHost: string, port: number, routeCount: number, sourcePath: string) => void;
  logDebug: (message: string) => void;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  beginGracefulShutdown: (
    reason: "SIGINT" | "SIGTERM" | "fatal_runtime_error",
    currentRuntime: TSnapshot,
    clearRetentionPruneTimer: () => void,
    closeServer: (onClosed: () => void) => void,
    closeIdleConnections: (() => void) | undefined,
    removeProcessHandlers: () => void,
    exitCode?: number
  ) => boolean;
  reloadRuntime: (currentRuntime: TSnapshot) => TSnapshot;
  markReloadFailure: (currentRuntime: TSnapshot, message: string) => TSnapshot;
  markFatalRuntimeError: (currentRuntime: TSnapshot, message: string) => TSnapshot;
}): Promise<void> {
  let activeRuntime = options.initialRuntime;

  const syncActiveRuntimeSideEffects = (): {
    inlineApiKeyProviders: string[];
    worldReadableConfigWarning: string | null;
  } => {
    options.applyEffectiveLogLevel(activeRuntime.config.logLevel);
    if (options.resolveInboundAuthKind(activeRuntime) === "disabled_explicit") {
      options.logWarning("Gateway inbound auth is explicitly disabled. The gateway will accept unauthenticated inbound requests.");
    }
    options.configureGatewayObservability(activeRuntime.config.observability.retentionOlderThan);

    return {
      inlineApiKeyProviders: options.getInlineApiKeyProviderNames(),
      worldReadableConfigWarning: options.getWorldReadableConfigWarning()
  };
  };

  const logActiveConfigWarnings = (runtime: TSnapshot, worldReadableConfigWarning: string | null, inlineApiKeyProviders: string[]): void => {
    const remoteBindWarning = buildGatewayRemoteBindWarning(runtime.config);
    if (remoteBindWarning) {
      options.logWarning(remoteBindWarning);
    }

    if (worldReadableConfigWarning) {
      options.logWarning(worldReadableConfigWarning);
    }

    if (inlineApiKeyProviders.length > 0) {
      options.logWarning(
        `Plaintext inline api_key values were detected in ${runtime.config.sourceFile}. Prefer api_key_env for provider secrets.`
      );

      for (const providerName of inlineApiKeyProviders) {
        options.logWarning(`Provider '${providerName}' has a raw api_key set in the active config file.`);
      }
    }
  };

  let retentionPruneTimer: NodeJS.Timeout | null = null;
  const syncRetentionPruneSchedule = () => {
    if (retentionPruneTimer) {
      clearInterval(retentionPruneTimer);
      retentionPruneTimer = null;
    }

    if (activeRuntime.config.observability.retentionOlderThan === null) {
      return;
    }

    retentionPruneTimer = setInterval(() => {
      options.pruneGatewayObservabilityRetentionNow("interval");
    }, options.defaultRetentionPruneIntervalMs);
    retentionPruneTimer.unref();
  };

  let { inlineApiKeyProviders, worldReadableConfigWarning } = syncActiveRuntimeSideEffects();
  syncRetentionPruneSchedule();

  const server = http.createServer((request, response) => {
    void options.requestHandler(request, response, activeRuntime).catch((error: Error) => {
      handleGatewayRequestHandlerFailure({
        error,
        response,
        logLine: options.logLine,
        sendJsonError: options.sendJsonError
      });
    });
  });

  server.maxConnections = activeRuntime.config.maxConnections;

  server.on("error", (error: Error) => {
    options.logLine(`x ERROR     model=startup  reason="${safeErrorMessage(error, 512)}"  status=1`);
    process.exit(1);
  });

  const triggerGracefulShutdown = (
    reason: "SIGINT" | "SIGTERM" | "fatal_runtime_error",
    exitCode = reason === "fatal_runtime_error" ? 1 : 0
  ) => {
    options.beginGracefulShutdown(
      reason,
      activeRuntime,
      () => {
        if (retentionPruneTimer) {
          clearInterval(retentionPruneTimer);
          retentionPruneTimer = null;
        }
      },
      (onClosed) => server.close(onClosed),
      typeof server.closeIdleConnections === "function" ? () => server.closeIdleConnections() : undefined,
      removeProcessHandlers,
      exitCode
    );
  };

  const handleFatalRuntimeError = (error: unknown, source: "unhandled_rejection" | "uncaught_exception"): void => {
    const message = error instanceof Error ? error.message : String(error);
    activeRuntime = options.markFatalRuntimeError(activeRuntime, message);
    options.logLine(`x ERROR     model=${source}  reason="${safeErrorMessage(error, 512)}"  status=1`);
    process.exitCode = 1;
    triggerGracefulShutdown("fatal_runtime_error", 1);
  };

  const reloadActiveConfig = () => {
    activeRuntime = options.reloadRuntime(activeRuntime);
    ({ inlineApiKeyProviders, worldReadableConfigWarning } = syncActiveRuntimeSideEffects());
    syncRetentionPruneSchedule();
    server.maxConnections = activeRuntime.config.maxConnections;
    options.logLine(`Config reloaded: ${activeRuntime.config.sourceFile} (${Object.keys(activeRuntime.config.routes).length} route(s))`);
    options.logDebug(
      `reload  source_file=${activeRuntime.config.sourceFile}  bind_host=${activeRuntime.config.bindHost}  port=${activeRuntime.config.port}  max_connections=${activeRuntime.config.maxConnections}`
    );
    logActiveConfigWarnings(activeRuntime, worldReadableConfigWarning, inlineApiKeyProviders);
  };

  const handleSigint = () => {
    triggerGracefulShutdown("SIGINT");
  };

  const handleSigterm = () => {
    triggerGracefulShutdown("SIGTERM");
  };

  const handleUnhandledRejection = (reason: unknown) => {
    handleFatalRuntimeError(reason, "unhandled_rejection");
  };

  const handleUncaughtException = (error: Error) => {
    handleFatalRuntimeError(error, "uncaught_exception");
  };

  const handleSighup = () => {
    try {
      reloadActiveConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reload error";
      activeRuntime = options.markReloadFailure(activeRuntime, message);
      options.logLine(`x ERROR     model=reload  reason="${safeErrorMessage(error, 512)}"  status=1`);
    }
  };

  const removeProcessHandlers = registerGatewayProcessHandlers({
    onSigint: handleSigint,
    onSigterm: handleSigterm,
    onUnhandledRejection: handleUnhandledRejection,
    onUncaughtException: handleUncaughtException,
    onSighup: handleSighup
  });

  server.listen(activeRuntime.config.port, activeRuntime.config.bindHost, () => {
    options.bootstrapGatewayObservability();
    options.logStartup(
      activeRuntime.config.bindHost,
      activeRuntime.config.port,
      Object.keys(activeRuntime.config.routes).length,
      activeRuntime.config.sourcePath
    );

    logActiveConfigWarnings(activeRuntime, worldReadableConfigWarning, inlineApiKeyProviders);
  });
}
