import { spawn } from "node:child_process";

import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";

type SystemctlAttemptResult = {
  ok: boolean;
  scope: "user" | "system";
  message?: string;
};

export type GatewayReloadOperationResult =
  | {
      ok: true;
      data: {
        unit: string;
        scope: "user" | "system";
        signal: "SIGHUP";
        reload_requested: true;
        reload_confirmed: true;
        loaded_at_before: string;
        loaded_at_after: string;
        verification_ms: number;
      };
    }
  | {
      ok: false;
      code: typeof APP_ERROR_CODES.reloadError;
      message: string;
      details?: Record<string, unknown>;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runSystemctlAttempt(args: string[], unknownErrorMessage: string): Promise<SystemctlAttemptResult> {
  const scope = args.includes("--user") ? "user" : "system";

  return await new Promise((resolve) => {
    const child = spawn("systemctl", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderrBuffer = "";

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        scope,
        message: error instanceof Error ? error.message : unknownErrorMessage
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, scope });
        return;
      }

      resolve({
        ok: false,
        scope,
        message: stderrBuffer.trim() || `systemctl exited with code ${code ?? 1}`
      });
    });
  });
}

function selectSystemctlFailureMessage(
  attempts: readonly SystemctlAttemptResult[],
  systemdUnit: string,
  fallbackMessage: string
): string {
  return attempts[0]?.message && !attempts[0].message.includes(`Unit ${systemdUnit} not loaded`)
    ? attempts[0].message
    : attempts[1]?.message || attempts[0]?.message || fallbackMessage;
}

function formatServiceActionLabel(action: "start" | "stop" | "restart" | "enable" | "disable"): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function parseJsonOnlyArgs(argv: string[]): { json: boolean; errorMessage?: string } {
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    return {
      json,
      errorMessage: `Unknown flag '${arg}'`
    };
  }

  return { json };
}

function parseReloadArgs(argv: string[]): { configPath?: string; json: boolean; errorMessage?: string } {
  let configPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== "string") {
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--config") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        return {
          configPath,
          json,
          errorMessage: "Flag '--config' requires a path value"
        };
      }

      configPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (value.length === 0) {
        return {
          configPath,
          json,
          errorMessage: "Flag '--config' requires a path value"
        };
      }

      configPath = value;
      continue;
    }

    return {
      configPath,
      json,
      errorMessage: `Unknown flag '${arg}'`
    };
  }

  return { configPath, json };
}

export function createGatewaySystemctlCommands(deps: {
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
  runSystemctlAttempt?: (args: string[], unknownErrorMessage: string) => Promise<SystemctlAttemptResult>;
}): {
  runReloadOperation: (configPath?: string) => Promise<GatewayReloadOperationResult>;
  runReload: (argv: string[], options?: { commandName: "reload" | "gateway reload" }) => Promise<number>;
  runGatewayServiceAction: (
    argv: string[],
    action: "start" | "stop" | "restart" | "enable" | "disable",
    options: { commandName: "gateway start" | "gateway stop" | "gateway restart" | "gateway enable" | "gateway disable" }
  ) => Promise<number>;
} {
  const attemptSystemctl = deps.runSystemctlAttempt ?? runSystemctlAttempt;

  async function runReloadOperation(configPath?: string): Promise<GatewayReloadOperationResult> {
    try {
      const { document } = deps.loadConfigJsonDocument(configPath);
      const systemdUnit = deps.resolveSystemdUnitFromDocument(document);
      const runtimeConfigBefore = await deps.fetchGatewayRuntimeConfigPayload(document, 1_000);
      const loadedAtBefore =
        typeof runtimeConfigBefore.payload["loaded_at"] === "string" && runtimeConfigBefore.payload["loaded_at"].trim().length > 0
          ? runtimeConfigBefore.payload["loaded_at"]
          : null;

      if (loadedAtBefore === null) {
        return {
          ok: false,
          code: APP_ERROR_CODES.reloadError,
          message: "runtime config endpoint did not return a valid 'loaded_at' timestamp before reload",
          details: {
            unit: systemdUnit,
            endpoint: runtimeConfigBefore.endpoint
          }
        };
      }

      const attempts = [
        await attemptSystemctl(["--user", "kill", "--signal=HUP", "--", systemdUnit], "Unknown systemd reload error"),
        await attemptSystemctl(["kill", "--signal=HUP", "--", systemdUnit], "Unknown systemd reload error")
      ];

      const success = attempts.find((attempt) => attempt.ok);

      if (!success) {
        return {
          ok: false,
          code: APP_ERROR_CODES.reloadError,
          message: selectSystemctlFailureMessage(attempts, systemdUnit, "Unknown systemd reload error")
        };
      }

      const verificationStartedAt = Date.now();
      let confirmedLoadedAt: string | null = null;
      let lastVerificationMessage: string | null = null;

      while (Date.now() - verificationStartedAt < deps.reloadConfirmationTimeoutMs) {
        try {
          const runtimeConfigAfter = await deps.fetchGatewayRuntimeConfigPayload(document);
          const loadedAtAfter =
            typeof runtimeConfigAfter.payload["loaded_at"] === "string" &&
            runtimeConfigAfter.payload["loaded_at"].trim().length > 0
              ? runtimeConfigAfter.payload["loaded_at"]
              : null;

          if (loadedAtAfter !== null && loadedAtAfter !== loadedAtBefore) {
            confirmedLoadedAt = loadedAtAfter;
            break;
          }

          lastVerificationMessage =
            loadedAtAfter === null
              ? "runtime config endpoint returned no loaded_at timestamp after reload"
              : `loaded_at did not change yet (still ${loadedAtAfter})`;
        } catch (error) {
          lastVerificationMessage = error instanceof Error ? error.message : "Unknown runtime config verification error";
        }

        await sleep(deps.reloadConfirmationPollIntervalMs);
      }

      if (confirmedLoadedAt === null) {
        return {
          ok: false,
          code: APP_ERROR_CODES.reloadError,
          message:
            lastVerificationMessage ??
            `timed out waiting for gateway runtime config to report a new loaded_at within ${deps.reloadConfirmationTimeoutMs}ms`,
          details: {
            unit: systemdUnit,
            scope: success.scope,
            signal: "SIGHUP",
            reload_requested: true,
            reload_confirmed: false,
            loaded_at_before: loadedAtBefore,
            endpoint: runtimeConfigBefore.endpoint,
            timeout_ms: deps.reloadConfirmationTimeoutMs
          }
        };
      }

      return {
        ok: true,
        data: {
          unit: systemdUnit,
          scope: success.scope,
          signal: "SIGHUP",
          reload_requested: true,
          reload_confirmed: true,
          loaded_at_before: loadedAtBefore,
          loaded_at_after: confirmedLoadedAt,
          verification_ms: Date.now() - verificationStartedAt
        }
      };
    } catch (error) {
      return {
        ok: false,
        code: APP_ERROR_CODES.reloadError,
        message: error instanceof Error ? error.message : "Unknown reload error"
      };
    }
  }

  async function runReload(
    argv: string[],
    options: { commandName: "reload" | "gateway reload" } = { commandName: "reload" }
  ): Promise<number> {
    const parsedArgs = parseReloadArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;

    const result = await runReloadOperation(configPath);
    if (!result.ok) {
      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, result.code, result.message, {
          details: result.details
        });
      } else {
        deps.writeStderr(`Reload failed: ${result.message}`);
      }
      return 1;
    }

    if (json) {
      deps.writeJsonSuccessEnvelope(options.commandName, result.data);
    } else {
      deps.writeStdout(
        `Reload confirmed for ${result.data.scope} systemd unit ${result.data.unit}. loaded_at ${result.data.loaded_at_before} -> ${result.data.loaded_at_after}.`
      );
    }

    return 0;
  }

  async function runGatewayServiceAction(
    argv: string[],
    action: "start" | "stop" | "restart" | "enable" | "disable",
    options: { commandName: "gateway start" | "gateway stop" | "gateway restart" | "gateway enable" | "gateway disable" }
  ): Promise<number> {
    const parsedArgs = parseJsonOnlyArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { json } = parsedArgs;

    const { document } = deps.loadConfigJsonDocument();
    const systemdUnit = deps.resolveSystemdUnitFromDocument(document);

    const attempts = [
      await attemptSystemctl(["--user", action, "--", systemdUnit], `Unknown systemd ${action} error`),
      await attemptSystemctl([action, "--", systemdUnit], `Unknown systemd ${action} error`)
    ];
    const success = attempts.find((attempt) => attempt.ok);

    if (success) {
      const actionLabel = formatServiceActionLabel(action);
      if (json) {
        deps.writeJsonSuccessEnvelope(options.commandName, {
          unit: systemdUnit,
          scope: success.scope,
          action,
          service_action_requested: true
        });
      } else {
        deps.writeStdout(`${actionLabel} requested for ${success.scope} systemd unit ${systemdUnit}.`);
      }

      return 0;
    }

    const message = selectSystemctlFailureMessage(attempts, systemdUnit, `Unknown systemd ${action} error`);

    const actionErrorCode: Record<typeof action, AppErrorCode> = {
      start: APP_ERROR_CODES.startError,
      stop: APP_ERROR_CODES.stopError,
      restart: APP_ERROR_CODES.restartError,
      enable: APP_ERROR_CODES.enableError,
      disable: APP_ERROR_CODES.disableError
    };

    if (json) {
      deps.writeJsonErrorEnvelope(options.commandName, actionErrorCode[action], message);
    } else {
      const actionLabel = formatServiceActionLabel(action);
      deps.writeStderr(`${actionLabel} failed: ${message}`);
    }

    return 1;
  }

  return {
    runReloadOperation,
    runReload,
    runGatewayServiceAction
  };
}
