import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { getEnvValue } from "../../platform/env";
import { renderGatewayRuntimeConfigText } from "./gateway-runtime-config-view";
import { createGatewayLogsCommand, type GatewayLogsFormat } from "./gateway-logs-command";
import { createGatewaySystemctlCommands, type GatewayReloadOperationResult } from "./gateway-systemctl-commands";
import {
  buildGatewayStatusView,
  renderGatewayStatusText,
  type GatewayServiceStatus
} from "./gateway-status-view";
import { getGatewayHealthProbeMetricsSnapshot } from "./health-probe-metrics";
import {
  buildLocalGatewayInboundAuthStateView,
  buildLocalGatewayInboundAuthTokenFingerprint,
  MIN_INBOUND_API_KEY_LENGTH,
  resolveLocalGatewayInboundAuthState
} from "./local-gateway-auth";

type GatewayAuthDiagnosticView = {
  source_file: string;
  source_path: string;
  allow_unauthenticated_gateway: boolean;
  one_trusted_operator_boundary: boolean;
  inbound_auth_state: ReturnType<typeof buildLocalGatewayInboundAuthStateView>;
  token: {
    present: boolean;
    non_empty: boolean | null;
    length_ok: boolean | null;
    min_length: number;
    fingerprint: string | null;
  };
};

export function createGatewayOperatorCommands(deps: {
  parseConfigCommandArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    errorMessage?: string;
  };
  parseLogsTailArgs: (argv: string[]) => {
    follow: boolean;
    lines: number;
    since?: string;
    format: GatewayLogsFormat;
    route?: string;
    provider?: string;
    errorMessage?: string;
  };
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  resolveSystemdUnitFromDocument: (document: Record<string, unknown>) => string;
  fetchGatewayRuntimeConfigPayload: (
    document: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<{
    endpoint: string;
    payload: Record<string, unknown>;
  }>;
  probeGatewayServiceUnit: (unit: string) => Promise<GatewayServiceStatus>;
  probeGatewayHealthAtHost: (
    bindHost: string,
    port: number,
    timeoutMs?: number
  ) => Promise<{ running: boolean; reason?: string; pid?: number; latency_ms?: number; probe_host: string }>;
  normalizeHealthProbeHost: (bindHost: string) => string;
  matchesLogFilters: (
    rawLine: string,
    format: GatewayLogsFormat,
    route?: string,
    provider?: string
  ) => boolean;
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
  reloadConfirmationTimeoutMs: number;
  reloadConfirmationPollIntervalMs: number;
  runSystemctlAttempt?: (
    args: string[],
    unknownErrorMessage: string
  ) => Promise<{ ok: boolean; scope: "user" | "system"; message?: string }>;
  runJournalctlAttempt?: (
    scope: "user" | "system",
    follow: boolean,
    args: string[],
    onLine: (rawLine: string) => void
  ) => Promise<{ ok: boolean; scope: "user" | "system"; entries: string[]; message?: string }>;
}): {
  runStatus: (argv: string[], options?: { commandName: "status" | "gateway status" }) => Promise<number>;
  runReloadOperation: (configPath?: string) => Promise<GatewayReloadOperationResult>;
  runReload: (argv: string[], options?: { commandName: "reload" | "gateway reload" }) => Promise<number>;
  runGatewayServiceAction: (
    argv: string[],
    action: "start" | "stop" | "restart" | "enable" | "disable",
    options: { commandName: "gateway start" | "gateway stop" | "gateway restart" | "gateway enable" | "gateway disable" }
  ) => Promise<number>;
  runRuntimeConfig: (
    argv: string[],
    options?: { commandName: "runtime config" | "gateway runtime config" }
  ) => Promise<number>;
  runAuth: (argv: string[], options?: { commandName: "auth" | "gateway auth" }) => Promise<number>;
  runLogsCommand: (
    argv: string[],
    options: {
      commandName: "logs tail" | "logs show" | "gateway logs tail" | "gateway logs show";
      allowFollow: boolean;
    }
  ) => Promise<number>;
} {
  const { runLogsCommand } = createGatewayLogsCommand({
    parseLogsTailArgs: deps.parseLogsTailArgs,
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    resolveSystemdUnitFromDocument: deps.resolveSystemdUnitFromDocument,
    matchesLogFilters: deps.matchesLogFilters,
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    runJournalctlAttempt: deps.runJournalctlAttempt
  });
  const { runReloadOperation, runReload, runGatewayServiceAction } = createGatewaySystemctlCommands({
    loadConfigJsonDocument: deps.loadConfigJsonDocument,
    resolveSystemdUnitFromDocument: deps.resolveSystemdUnitFromDocument,
    fetchGatewayRuntimeConfigPayload: deps.fetchGatewayRuntimeConfigPayload,
    printUsageError: deps.printUsageError,
    writeStdout: deps.writeStdout,
    writeStderr: deps.writeStderr,
    writeJsonSuccessEnvelope: deps.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: deps.writeJsonErrorEnvelope,
    reloadConfirmationTimeoutMs: deps.reloadConfirmationTimeoutMs,
    reloadConfirmationPollIntervalMs: deps.reloadConfirmationPollIntervalMs,
    runSystemctlAttempt: deps.runSystemctlAttempt
  });

  function buildGatewayAuthDiagnosticView(options: {
    sourceFile: string;
    sourcePath: string;
    document: Record<string, unknown>;
  }): GatewayAuthDiagnosticView {
    const inboundApiKeyEnv =
      typeof options.document["inbound_api_key_env"] === "string"
        ? options.document["inbound_api_key_env"]
        : null;
    const allowUnauthenticatedGateway = options.document["allow_unauthenticated_gateway"] === true;
    const token = typeof inboundApiKeyEnv === "string" ? getEnvValue(inboundApiKeyEnv) : undefined;
    const authState = resolveLocalGatewayInboundAuthState(inboundApiKeyEnv, allowUnauthenticatedGateway);
    const oneTrustedOperatorBoundary = options.document["one_trusted_operator_boundary"] === true;
    const tokenPresent = typeof token === "string";
    const tokenNonEmpty = tokenPresent ? token.trim().length > 0 : null;
    const tokenLengthOk = tokenPresent ? token.length >= MIN_INBOUND_API_KEY_LENGTH : null;

    return {
      source_file: options.sourceFile,
      source_path: options.sourcePath,
      allow_unauthenticated_gateway: allowUnauthenticatedGateway,
      one_trusted_operator_boundary: oneTrustedOperatorBoundary,
      inbound_auth_state: buildLocalGatewayInboundAuthStateView(authState),
      token: {
        present: tokenPresent,
        non_empty: tokenNonEmpty,
        length_ok: tokenLengthOk,
        min_length: MIN_INBOUND_API_KEY_LENGTH,
        fingerprint: authState.kind === "token"
          ? buildLocalGatewayInboundAuthTokenFingerprint(authState.token)
          : null
      }
    };
  }

  function renderGatewayAuthDiagnosticText(view: GatewayAuthDiagnosticView): string {
    return [
      "Gateway inbound auth",
      `Config: ${view.source_file}`,
      `Config Path: ${view.source_path}`,
      `Status: ${view.inbound_auth_state.status}`,
      `Env Var: ${view.inbound_auth_state.env_var ?? "(none)"}`,
      `Reason: ${view.inbound_auth_state.reason ?? "(none)"}`,
      `Allow Unauthenticated Gateway: ${String(view.allow_unauthenticated_gateway)}`,
      `One Trusted Operator Boundary: ${String(view.one_trusted_operator_boundary)}`,
      `Token Present: ${String(view.token.present)}`,
      `Token Non Empty: ${view.token.non_empty === null ? "(not applicable)" : String(view.token.non_empty)}`,
      `Token Length OK: ${view.token.length_ok === null ? "(not applicable)" : String(view.token.length_ok)}`,
      `Token Min Length: ${String(view.token.min_length)}`,
      `Token Fingerprint: ${view.token.fingerprint ?? "(unavailable)"}`
    ].join("\n");
  }

  async function runAuth(
    argv: string[],
    options: { commandName: "auth" | "gateway auth" } = { commandName: "auth" }
  ): Promise<number> {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json } = parsedArgs;

    try {
      const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
      const view = buildGatewayAuthDiagnosticView({ sourcePath, sourceFile, document });

      if (json) {
        deps.writeJsonSuccessEnvelope(options.commandName, view);
      } else {
        deps.writeStdout(renderGatewayAuthDiagnosticText(view));
      }

      return view.inbound_auth_state.status === "misconfigured" ? 1 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown gateway auth diagnostic error";

      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.gatewayStatusError, message);
        return 1;
      }

      deps.writeStderr(`Gateway auth failed: ${message}`);
      return 1;
    }
  }

  async function runStatus(
    argv: string[],
    options: { commandName: "status" | "gateway status" } = { commandName: "status" }
  ): Promise<number> {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json } = parsedArgs;

    try {
      const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
      const systemdUnit = deps.resolveSystemdUnitFromDocument(document);
      const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;
      const bindHost =
        typeof document["bind_host"] === "string" && document["bind_host"].trim().length > 0
          ? document["bind_host"]
          : "127.0.0.1";

      let gatewayStatus: "running" | "stopped" | "unknown" = "unknown";
      let reason: string | undefined;
      let pid: number | null = null;
      let healthLatencyMs: number | null = null;
      let probeHost = deps.normalizeHealthProbeHost(bindHost);

      if (typeof port === "number" && port > 0) {
        const health = await deps.probeGatewayHealthAtHost(bindHost, port);
        gatewayStatus = health.running ? "running" : "stopped";
        reason = health.reason;
        pid = health.pid ?? null;
        healthLatencyMs = health.latency_ms ?? null;
        probeHost = health.probe_host;
      } else {
        reason = "config.json does not contain a valid numeric 'port'";
      }

      const serviceStatus = await deps.probeGatewayServiceUnit(systemdUnit);
      const gatewayStatusView = buildGatewayStatusView({
        sourcePath,
        sourceFile,
        document,
        systemdUnit,
        bindHost,
        port,
        probeHost: typeof port === "number" && port > 0 ? probeHost : null,
        gatewayStatus,
        reason,
        pid,
        healthLatencyMs,
        serviceStatus,
        healthProbeMetrics: getGatewayHealthProbeMetricsSnapshot()
      });

      if (json) {
        deps.writeJsonSuccessEnvelope(options.commandName, gatewayStatusView);
        return 0;
      }

      deps.writeStdout(renderGatewayStatusText(gatewayStatusView));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown status error";

      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.statusError, message);
        return 1;
      }

      deps.writeStderr(`Status failed: ${message}`);
      return 1;
    }
  }

  async function runRuntimeConfig(
    argv: string[],
    options: { commandName: "runtime config" | "gateway runtime config" } = {
      commandName: "runtime config"
    }
  ): Promise<number> {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json } = parsedArgs;

    try {
      const { document } = deps.loadConfigJsonDocument(configPath);
      const { payload } = await deps.fetchGatewayRuntimeConfigPayload(document, 1_000);

      if (json) {
        deps.writeJsonSuccessEnvelope(options.commandName, payload);
        return 0;
      }
      deps.writeStdout(renderGatewayRuntimeConfigText(payload));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime config error";

      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.gatewayRuntimeConfigError, message);
        return 1;
      }

      deps.writeStderr(`Runtime config failed: ${message}`);
      return 1;
    }
  }

  return {
    runStatus,
    runReloadOperation,
    runReload,
    runGatewayServiceAction,
    runRuntimeConfig,
    runAuth,
    runLogsCommand
  };
}
