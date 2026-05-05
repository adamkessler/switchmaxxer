import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGatewayRunOverrides,
  buildInitialGatewayRuntimeSnapshot,
  buildReloadedGatewayRuntimeSnapshot,
  markGatewayRuntimeFatalError,
  markGatewayRuntimeReloadFailure,
  type GatewayRuntimeSnapshot
} from "./runtime-snapshot";

function createBaseRuntimeSnapshot(): GatewayRuntimeSnapshot {
  return {
    config: {
      port: 4080,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 15_000,
      streamIdleTimeoutMs: 120_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxConcurrentStreamsPerIp: 8,
      maxConcurrentJsonParses: 4,
      maxBufferedUpstreamResponseBytes: 16_777_216,
      shutdownTimeoutMs: 30_000,
      maxPayloadSize: 4_000_000,
      inboundApiKeyEnv: null,
      allowUnauthenticatedGateway: true,
      rateLimit: {
        requests: 100,
        window: "1s"
      },
      systemdUnit: "switchmaxxer.service",
      observability: {
        retentionOlderThan: null
      },
      benchmark: {
        defaultMaxTokens: 32,
        defaultAnthropicVersion: "2023-06-01"
      },
      logLevel: "info",
      sourceFile: "config.json",
      sourcePath: "/tmp/config.json",
      routes: {
        demo: {
          serviceProvider: "demo-provider",
          api_mode: "openai-completions",
          anthropicVersion: null,
          modelCreator: "openai",
          model: "demo-model",
          baseUrl: "https://example.test/v1/chat/completions",
          allowPrivateEndpoints: false,
          apiKeyEnv: "SWITCHMAXXER_DEMO_PROVIDER_KEY",
          inlineApiKey: null,
          cost: null,
          modelCost: null,
          routeTimeoutMs: null,
          timeoutMs: 15_000
        }
      }
    },
    readModel: {
      sourceFile: "config.json",
      routes: [
        {
          name: "demo",
          display_name: "Demo",
          model: "demo-model",
          service_provider: "demo-provider",
          provider_model_id: "demo-provider-model",
          api_mode: "openai-completions"
        }
      ],
      models: [
        {
          name: "demo-model",
          display_name: "Demo Model",
          model_creator: "openai",
          route_count: 1
        }
      ],
      providers: [
        {
          name: "demo-provider",
          endpoint: "https://example.test/v1/chat/completions?api-version=2024-02-15-preview",
          allow_private_endpoints: false,
          allow_insecure_http: false,
          api_mode: "openai-completions",
          anthropic_version: null,
          api_key_env: "SWITCHMAXXER_DEMO_PROVIDER_KEY",
          api_key_masked: null,
          auth_source: "env var"
        }
      ]
    },
    rateLimiter: {
      check: (_callerKey: string) => ({
        allowed: true,
        remaining: 99,
        resetAtMs: Date.now() + 1_000
      })
    },
    loadedAt: "2026-04-21T12:00:00.000Z",
    reloadState: {
      lastReloadStatus: "never_attempted",
      lastReloadError: null,
      lastReloadAttemptedAt: null,
      lastReloadSucceededAt: null
    },
    fatalState: {
      processIntegrityStatus: "ok",
      lastFatalError: null,
      lastFatalAt: null
    }
  };
}

void test("gateway runtime snapshot helper builds initial state", () => {
  const base = createBaseRuntimeSnapshot();
  const snapshot = buildInitialGatewayRuntimeSnapshot({
    config: base.config,
    readModel: base.readModel,
    createRuntimeRateLimiter: () => ({
      check: (_callerKey: string) => ({
        allowed: true,
        remaining: 42,
        resetAtMs: 12345
      })
    }),
    loadedAt: "2026-04-21T12:10:00.000Z"
  });

  assert.equal(snapshot.config, base.config);
  assert.equal(snapshot.readModel, base.readModel);
  assert.equal(snapshot.loadedAt, "2026-04-21T12:10:00.000Z");
  assert.deepEqual(snapshot.reloadState, {
    lastReloadStatus: "never_attempted",
    lastReloadError: null,
    lastReloadAttemptedAt: null,
    lastReloadSucceededAt: null
  });
  assert.deepEqual(snapshot.fatalState, {
    processIntegrityStatus: "ok",
    lastFatalError: null,
    lastFatalAt: null
  });
  assert.deepEqual(snapshot.rateLimiter.check("caller-a"), {
    allowed: true,
    remaining: 42,
    resetAtMs: 12345
  });
});

void test("gateway runtime override helper preserves identity when no override is present", () => {
  const config = createBaseRuntimeSnapshot().config;

  assert.equal(applyGatewayRunOverrides(config, {}), config);
  assert.deepEqual(applyGatewayRunOverrides(config, { host: "0.0.0.0", port: 4090 }), {
    ...config,
    bindHost: "0.0.0.0",
    port: 4090
  });
});

void test("gateway reload helper builds a fresh runtime snapshot without losing fatal state", () => {
  const currentRuntime = createBaseRuntimeSnapshot();
  currentRuntime.fatalState = {
    processIntegrityStatus: "fatal",
    lastFatalError: "previous fatal",
    lastFatalAt: "2026-04-21T11:59:00.000Z"
  };

  const nextConfig: GatewayRuntimeSnapshot["config"] = {
    ...currentRuntime.config,
    maxConnections: 250,
    logLevel: "debug",
    sourceFile: "config.reloaded.json"
  };
  const nextReadModel = {
    ...currentRuntime.readModel,
    sourceFile: "config.reloaded.json"
  };

  const reloaded = buildReloadedGatewayRuntimeSnapshot(
    currentRuntime,
    nextConfig,
    nextReadModel,
    () => ({
      check: (_callerKey: string) => ({
        allowed: true,
        remaining: 249,
        resetAtMs: 12345
      })
    }),
    "2026-04-21T12:05:00.000Z"
  );

  assert.equal(reloaded.config.maxConnections, 250);
  assert.equal(reloaded.config.sourceFile, "config.reloaded.json");
  assert.equal(reloaded.readModel.sourceFile, "config.reloaded.json");
  assert.equal(reloaded.loadedAt, "2026-04-21T12:05:00.000Z");
  assert.deepEqual(reloaded.reloadState, {
    lastReloadStatus: "ok",
    lastReloadError: null,
    lastReloadAttemptedAt: "2026-04-21T12:05:00.000Z",
    lastReloadSucceededAt: "2026-04-21T12:05:00.000Z"
  });
  assert.deepEqual(reloaded.fatalState, currentRuntime.fatalState);
  assert.deepEqual(reloaded.rateLimiter.check("caller-a"), {
    allowed: true,
    remaining: 249,
    resetAtMs: 12345
  });
});

void test("gateway reload helper rejects bind host or port changes that require restart", () => {
  const currentRuntime = createBaseRuntimeSnapshot();
  const nextConfig = {
    ...currentRuntime.config,
    port: currentRuntime.config.port + 1
  };

  assert.throws(
    () =>
      buildReloadedGatewayRuntimeSnapshot(
        currentRuntime,
        nextConfig,
        currentRuntime.readModel,
        () => currentRuntime.rateLimiter,
        "2026-04-21T12:05:00.000Z"
      ),
    /Reload requires restart/
  );
});

void test("gateway runtime snapshot helpers mark reload failures and fatal runtime errors", () => {
  const currentRuntime = createBaseRuntimeSnapshot();
  const reloadFailed = markGatewayRuntimeReloadFailure(
    currentRuntime,
    "reload failed",
    "2026-04-21T12:11:00.000Z"
  );
  const fatal = markGatewayRuntimeFatalError(
    currentRuntime,
    "fatal failed",
    "2026-04-21T12:12:00.000Z"
  );

  assert.deepEqual(reloadFailed.reloadState, {
    lastReloadStatus: "failed",
    lastReloadError: "reload failed",
    lastReloadAttemptedAt: "2026-04-21T12:11:00.000Z",
    lastReloadSucceededAt: null
  });
  assert.deepEqual(fatal.fatalState, {
    processIntegrityStatus: "fatal",
    lastFatalError: "fatal failed",
    lastFatalAt: "2026-04-21T12:12:00.000Z"
  });
});
