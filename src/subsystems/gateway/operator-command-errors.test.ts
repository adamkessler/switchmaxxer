import assert from "node:assert/strict";
import test from "node:test";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { createGatewayHealthCommands } from "./health-commands";
import { createGatewayOperatorCommands } from "./operator-commands";
import { withEnv } from "./runtime.test-support";

function createJsonRecorder() {
  let payload: Record<string, unknown> | null = null;

  return {
    writeJsonSuccessEnvelope: (command: string, data: unknown) => {
      payload = {
        ok: true,
        command,
        data
      };
    },
    writeJsonErrorEnvelope: (command: string, code: string, message: string) => {
      payload = {
        ok: false,
        command,
        error: {
          code,
          message
        }
      };
    },
    getPayload: () => payload
  };
}

function createOperatorDeps(recorder: ReturnType<typeof createJsonRecorder>) {
  return {
    parseConfigCommandArgs: (_argv: string[]) => ({
      configPath: undefined,
      json: true
    }),
    parseLogsTailArgs: (_argv: string[]) => ({
      follow: false,
      lines: 20,
      format: "json" as const
    }),
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {
        systemd_unit: "switchmaxxer-test-does-not-exist.service",
        bind_host: "127.0.0.1",
        port: 4080
      } as Record<string, unknown>
    }),
    resolveSystemdUnitFromDocument: () => "switchmaxxer-test-does-not-exist.service",
    fetchGatewayRuntimeConfigPayload: async () => {
      throw new Error("runtime config probe failed");
    },
    probeGatewayServiceUnit: async () => {
      throw new Error("systemctl status probe failed");
    },
    probeGatewayHealthAtHost: async () => ({
      running: false,
      reason: "gateway unavailable",
      probe_host: "127.0.0.1"
    }),
    normalizeHealthProbeHost: (bindHost: string) => bindHost,
    matchesLogFilters: () => true,
    printUsageError: (_message: string) => {},
    writeStdout: (_message: string) => {},
    writeStderr: (_message: string) => {},
    writeJsonSuccessEnvelope: recorder.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: recorder.writeJsonErrorEnvelope,
    reloadConfirmationTimeoutMs: 10,
    reloadConfirmationPollIntervalMs: 1,
    runSystemctlAttempt: async (args: string[]) => ({
      ok: false,
      scope: args.includes("--user") ? "user" as const : "system" as const,
      message: "systemctl command failed"
    }),
    runJournalctlAttempt: async (scope: "user" | "system") => ({
      ok: false,
      scope,
      entries: [],
      message: "journalctl command failed"
    })
  };
}

function createHealthDeps(recorder: ReturnType<typeof createJsonRecorder>) {
  return {
    readLongFlagValue: (
      _argv: string[],
      _index: number,
      _flagName: string,
      _missingValueMessage?: string
    ) => null,
    loadConfig: () => {
      throw new Error("health config load failed");
    },
    loadConfigJsonDocument: () => {
      throw new Error("health config read failed");
    },
    buildLocalGatewayAuthHeaders: () => new Headers(),
    resolveSystemdUnitFromDocument: () => "switchmaxxer-test-does-not-exist.service",
    printUsageError: (_message: string) => {},
    writeStdout: (_message: string) => {},
    writeStderr: (_message: string) => {},
    writeJsonSuccessEnvelope: recorder.writeJsonSuccessEnvelope,
    writeJsonErrorEnvelope: recorder.writeJsonErrorEnvelope
  };
}

void test("gateway operator commands emit typed json error codes for status, reload, and logs failures", async () => {
  const recorder = createJsonRecorder();
  const commands = createGatewayOperatorCommands(createOperatorDeps(recorder));

  const statusExitCode = await commands.runStatus(["--json"]);
  assert.equal(statusExitCode, 1);
  assert.deepEqual(recorder.getPayload(), {
    ok: false,
    command: "status",
    error: {
      code: APP_ERROR_CODES.statusError,
      message: "systemctl status probe failed"
    }
  });

  const reloadExitCode = await commands.runReload(["--json"]);
  assert.equal(reloadExitCode, 1);
  assert.deepEqual(recorder.getPayload(), {
    ok: false,
    command: "reload",
    error: {
      code: APP_ERROR_CODES.reloadError,
      message: "runtime config probe failed"
    }
  });

  const logsExitCode = await commands.runLogsCommand(["--json"], {
    commandName: "logs show",
    allowFollow: false
  });
  assert.equal(logsExitCode, 1);
  const logsPayload = recorder.getPayload();
  assert.equal((logsPayload as { error: { code: string } }).error.code, APP_ERROR_CODES.logsError);
});

void test("gateway auth diagnoses enabled, disabled, and misconfigured inbound auth states", async () => {
  const envVarName = "SWITCHMAXXER_GATEWAY_AUTH_DIAGNOSTIC_TEST";
  const recorder = createJsonRecorder();
  const deps = createOperatorDeps(recorder);
  const commands = createGatewayOperatorCommands(deps);

  deps.loadConfigJsonDocument = () => ({
    sourcePath: "/tmp/config.json",
    sourceFile: "config.json",
    document: {
      inbound_api_key_env: envVarName
    } as Record<string, unknown>
  });

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const exitCode = await commands.runAuth(["--json"]);
    const payload = recorder.getPayload() as Record<string, unknown>;
    const data = payload["data"] as Record<string, unknown>;
    const authState = data["inbound_auth_state"] as Record<string, unknown>;
    const token = data["token"] as Record<string, unknown>;

    assert.equal(exitCode, 0);
    assert.equal(payload["command"], "auth");
    assert.equal(authState["status"], "enabled");
    assert.equal(authState["env_var"], envVarName);
    assert.equal(authState["reason"], null);
    assert.equal(token["present"], true);
    assert.equal(token["non_empty"], true);
    assert.equal(token["length_ok"], true);
    assert.match(token["fingerprint"] as string, /^sha256:[0-9a-f]{12}$/);
  });

  await withEnv({ [envVarName]: undefined }, async () => {
    const exitCode = await commands.runAuth(["--json"]);
    const payload = recorder.getPayload() as Record<string, unknown>;
    const data = payload["data"] as Record<string, unknown>;
    const authState = data["inbound_auth_state"] as Record<string, unknown>;
    const token = data["token"] as Record<string, unknown>;

    assert.equal(exitCode, 1);
    assert.equal(authState["status"], "misconfigured");
    assert.equal(authState["env_var"], envVarName);
    assert.equal(authState["reason"], "missing_token");
    assert.equal(token["present"], false);
    assert.equal(token["fingerprint"], null);
  });

  deps.loadConfigJsonDocument = () => ({
    sourcePath: "/tmp/config.json",
    sourceFile: "config.json",
    document: {
      allow_unauthenticated_gateway: true
    } as Record<string, unknown>
  });

  const disabledExitCode = await commands.runAuth(["--json"]);
  const disabledPayload = recorder.getPayload() as Record<string, unknown>;
  const disabledData = disabledPayload["data"] as Record<string, unknown>;
  const disabledAuthState = disabledData["inbound_auth_state"] as Record<string, unknown>;

  assert.equal(disabledExitCode, 0);
  assert.equal(disabledAuthState["status"], "disabled_explicit");
  assert.equal(disabledAuthState["env_var"], null);
});

void test("gateway reload accepts a selected config path for runtime probing", async () => {
  const recorder = createJsonRecorder();
  let loadedConfigPath: string | undefined;
  const commands = createGatewayOperatorCommands({
    ...createOperatorDeps(recorder),
    loadConfigJsonDocument: (configPath?: string) => {
      loadedConfigPath = configPath;
      return {
        sourcePath: "/tmp/selected-config.json",
        sourceFile: "selected-config.json",
        document: {
          systemd_unit: "switchmaxxer-test-does-not-exist.service",
          bind_host: "127.0.0.1",
          port: 4080
        }
      };
    }
  });

  const reloadExitCode = await commands.runReload(["--config", "/tmp/selected-config.json", "--json"]);

  assert.equal(reloadExitCode, 1);
  assert.equal(loadedConfigPath, "/tmp/selected-config.json");
  assert.deepEqual(recorder.getPayload(), {
    ok: false,
    command: "reload",
    error: {
      code: APP_ERROR_CODES.reloadError,
      message: "runtime config probe failed"
    }
  });
});

void test("gateway service actions emit typed json error codes for systemctl failures", async () => {
  const actions: Array<{
    action: "start" | "stop" | "restart" | "enable" | "disable";
    commandName: "gateway start" | "gateway stop" | "gateway restart" | "gateway enable" | "gateway disable";
    errorCode: string;
  }> = [
    { action: "start", commandName: "gateway start", errorCode: APP_ERROR_CODES.startError },
    { action: "stop", commandName: "gateway stop", errorCode: APP_ERROR_CODES.stopError },
    { action: "restart", commandName: "gateway restart", errorCode: APP_ERROR_CODES.restartError },
    { action: "enable", commandName: "gateway enable", errorCode: APP_ERROR_CODES.enableError },
    { action: "disable", commandName: "gateway disable", errorCode: APP_ERROR_CODES.disableError }
  ];

  for (const entry of actions) {
    const recorder = createJsonRecorder();
    const commands = createGatewayOperatorCommands(createOperatorDeps(recorder));
    const exitCode = await commands.runGatewayServiceAction(["--json"], entry.action, {
      commandName: entry.commandName
    });

    assert.equal(exitCode, 1);
    const payload = recorder.getPayload() as { command: string; error: { code: string; message: string } };
    assert.equal(payload.command, entry.commandName);
    assert.equal(payload.error.code, entry.errorCode);
  }
});

void test("gateway health command emits typed json health_error envelopes on command failures", async () => {
  const recorder = createJsonRecorder();
  const commands = createGatewayHealthCommands(createHealthDeps(recorder));

  const exitCode = await commands.runHealth(["--json"]);

  assert.equal(exitCode, 1);
  assert.deepEqual(recorder.getPayload(), {
    ok: false,
    command: "health",
    error: {
      code: APP_ERROR_CODES.healthError,
      message: "health config read failed"
    }
  });
});
