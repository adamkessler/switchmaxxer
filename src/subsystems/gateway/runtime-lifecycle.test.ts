import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import test from "node:test";

import { beginGatewayGracefulShutdown } from "./runtime";
import {
  buildGatewayRemoteBindWarning,
  handleGatewayRequestHandlerFailure,
  registerGatewayProcessHandlers
} from "./gateway-runner";

void test("gateway graceful shutdown helper coordinates timer, server close, idle connection cleanup, and async finalization", async () => {
  const warnings: string[] = [];
  const exits: number[] = [];
  const timerTokens: unknown[] = [];
  let retentionCleared = 0;
  let runtimeDisposals = 0;
  let closeCalls = 0;
  let idleCloseCalls = 0;
  let finalizeCalls = 0;
  let clearedTimer: unknown = null;
  let closeCallback: (() => void) | null = null;

  const result = beginGatewayGracefulShutdown({
    shutdownStarted: false,
    reason: "SIGTERM",
    shutdownTimeoutMs: 30_000,
    clearRetentionPruneTimer: () => {
      retentionCleared += 1;
    },
    disposeRuntimeResources: () => {
      runtimeDisposals += 1;
    },
    logWarning: (message) => {
      warnings.push(message);
    },
    setForcedExitTimer: (onTimeout, timeoutMs) => {
      const token = { onTimeout, timeoutMs };
      timerTokens.push(token);
      return token;
    },
    clearForcedExitTimer: (timer) => {
      clearedTimer = timer;
    },
    closeServer: (onClosed) => {
      closeCalls += 1;
      closeCallback = onClosed;
    },
    closeIdleConnections: () => {
      idleCloseCalls += 1;
    },
    finalizeShutdown: async () => {
      finalizeCalls += 1;
    },
    exit: (code) => {
      exits.push(code);
    }
  });

  assert.equal(result.shutdownStarted, true);
  assert.equal(retentionCleared, 1);
  assert.equal(runtimeDisposals, 1);
  assert.equal(closeCalls, 1);
  assert.equal(idleCloseCalls, 1);
  assert.equal(warnings[0], "Received SIGTERM; shutting down gracefully.");
  assert.equal(typeof (timerTokens[0] as { onTimeout: () => void }).onTimeout, "function");
  assert.equal((timerTokens[0] as { timeoutMs: number }).timeoutMs, 30_000);

  const onClosed: (() => void) | null = closeCallback as (() => void) | null;
  if (typeof onClosed === "function") {
    onClosed();
  }

  await Promise.resolve();

  assert.equal(finalizeCalls, 1);
  assert.equal(clearedTimer, timerTokens[0]);
  assert.deepEqual(exits, [0]);
});

void test("gateway graceful shutdown helper is idempotent after shutdown has started", () => {
  let retentionCleared = 0;
  let runtimeDisposals = 0;
  let closeCalls = 0;
  let idleCloseCalls = 0;
  let timerCalls = 0;

  const result = beginGatewayGracefulShutdown({
    shutdownStarted: true,
    reason: "SIGINT",
    shutdownTimeoutMs: 30_000,
    clearRetentionPruneTimer: () => {
      retentionCleared += 1;
    },
    disposeRuntimeResources: () => {
      runtimeDisposals += 1;
    },
    logWarning: () => {},
    setForcedExitTimer: () => {
      timerCalls += 1;
      return {};
    },
    clearForcedExitTimer: () => {},
    closeServer: () => {
      closeCalls += 1;
    },
    closeIdleConnections: () => {
      idleCloseCalls += 1;
    },
    finalizeShutdown: async () => {},
    exit: () => {}
  });

  assert.deepEqual(result, {
    shutdownStarted: true,
    forcedExitTimer: null
  });
  assert.equal(retentionCleared, 0);
  assert.equal(runtimeDisposals, 0);
  assert.equal(closeCalls, 0);
  assert.equal(idleCloseCalls, 0);
  assert.equal(timerCalls, 0);
});

void test("gateway process handler registration returns an idempotent cleanup", () => {
  const eventNames = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
    "unhandledRejection",
    "uncaughtException"
  ] as const;
  const listenerCountsBefore = new Map<string, number>();

  for (const eventName of eventNames) {
    listenerCountsBefore.set(eventName, process.listenerCount(eventName));
  }

  const cleanup = registerGatewayProcessHandlers({
    onSigint: () => {},
    onSigterm: () => {},
    onSighup: () => {},
    onUnhandledRejection: () => {},
    onUncaughtException: () => {}
  });

  try {
    for (const eventName of eventNames) {
      assert.equal(process.listenerCount(eventName), (listenerCountsBefore.get(eventName) ?? 0) + 1);
    }
  } finally {
    cleanup();
    cleanup();
  }

  for (const eventName of eventNames) {
    assert.equal(process.listenerCount(eventName), listenerCountsBefore.get(eventName));
  }
});

void test("gateway startup warning is emitted only for explicit remote bind mode", () => {
  assert.equal(buildGatewayRemoteBindWarning({
    bindHost: "127.0.0.1",
    port: 4080,
    allowRemoteBind: false
  }), null);
  assert.equal(buildGatewayRemoteBindWarning({
    bindHost: "0.0.0.0",
    port: 4080,
    allowRemoteBind: false
  }), null);

  const warning = buildGatewayRemoteBindWarning({
    bindHost: "192.0.2.10",
    port: 4080,
    allowRemoteBind: true
  });

  assert.match(warning ?? "", /Gateway remote bind is enabled on 192\.0\.2\.10:4080/);
  assert.match(warning ?? "", /reachable from other machines/);
});

void test("gateway startup warning distinguishes wildcard bind mode", () => {
  const warning = buildGatewayRemoteBindWarning({
    bindHost: "0.0.0.0",
    port: 4080,
    allowRemoteBind: true,
    allowWildcardBind: true
  });

  assert.match(warning ?? "", /Gateway wildcard bind is enabled on 0\.0\.0\.0:4080/);
  assert.match(warning ?? "", /all network interfaces/);
  assert.match(warning ?? "", /firewall\/VPN\/container exposure/);
});

void test("gateway request handler failure sends a structured error before headers are sent", () => {
  const logs: string[] = [];
  const sentErrors: Array<{ statusCode: number; message: string; code: string }> = [];
  let destroyed = false;
  const response = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    destroy: () => {
      destroyed = true;
      return undefined;
    }
  } as unknown as ServerResponse;

  handleGatewayRequestHandlerFailure({
    error: new Error("handler exploded"),
    response,
    logLine: (message) => {
      logs.push(message);
    },
    sendJsonError: (_response, statusCode, message, code) => {
      sentErrors.push({ statusCode, message, code });
    }
  });

  assert.equal(destroyed, false);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /handler exploded/);
  assert.deepEqual(sentErrors, [
    {
      statusCode: 500,
      message: "Internal server error",
      code: "internal_error"
    }
  ]);
});

void test("gateway request handler failure destroys partial responses after headers are sent", () => {
  const logs: string[] = [];
  const sentErrors: Array<{ statusCode: number; message: string; code: string }> = [];
  const destroyed = { error: null as Error | null };
  const response = {
    headersSent: true,
    writableEnded: false,
    destroyed: false,
    destroy: (error?: Error) => {
      destroyed.error = error ?? null;
      return undefined;
    }
  } as unknown as ServerResponse;

  handleGatewayRequestHandlerFailure({
    error: new Error("stream failed"),
    response,
    logLine: (message) => {
      logs.push(message);
    },
    sendJsonError: (_response, statusCode, message, code) => {
      sentErrors.push({ statusCode, message, code });
    }
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /stream failed/);
  assert.deepEqual(sentErrors, []);
  assert.ok(destroyed.error instanceof Error);
  assert.equal(destroyed.error.message, "Gateway request handler failed after response headers were sent.");
});
