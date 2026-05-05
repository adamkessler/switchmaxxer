import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRateLimitHeaders,
  buildRuntimeConfigView,
  gatewayRateLimitKey,
  isAllowedUnauthenticatedGatewayHost,
  normalizeGatewaySourceIp,
  sanitizeRuntimeInspectionError
} from "./runtime-helpers";
import type { AppConfig } from "../../../../platform/types";
import type { GatewayFatalState, GatewayReadModel, GatewayReloadState } from "./runtime-snapshot";

function createGatewayRequest(remoteAddress: string, host = "localhost:4000"): Parameters<typeof isAllowedUnauthenticatedGatewayHost>[1] {
  return {
    headers: { host },
    socket: { remoteAddress }
  } as Parameters<typeof isAllowedUnauthenticatedGatewayHost>[1];
}

void test("normalizeGatewaySourceIp unwraps ipv4-mapped addresses", () => {
  assert.equal(normalizeGatewaySourceIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeGatewaySourceIp("  ::1 "), "::1");
  assert.equal(normalizeGatewaySourceIp(undefined), "unknown");
});

void test("gatewayRateLimitKey partitions source IPs by route trust class", () => {
  const request = createGatewayRequest("::ffff:127.0.0.1");

  assert.equal(gatewayRateLimitKey(request, "data_plane"), "127.0.0.1:data_plane");
  assert.equal(gatewayRateLimitKey(request, "control_plane_read"), "127.0.0.1:control_plane_read");
});

void test("isAllowedUnauthenticatedGatewayHost only accepts loopback callers and matching hosts", () => {
  const config = { bindHost: "127.0.0.1", port: 4000 } satisfies Pick<AppConfig, "bindHost" | "port">;

  assert.equal(isAllowedUnauthenticatedGatewayHost("localhost:4000", createGatewayRequest("127.0.0.1"), config), true);
  assert.equal(isAllowedUnauthenticatedGatewayHost("127.0.0.1:4000", createGatewayRequest("127.0.0.1"), config), true);
  assert.equal(isAllowedUnauthenticatedGatewayHost("localhost:4001", createGatewayRequest("127.0.0.1"), config), false);
  assert.equal(isAllowedUnauthenticatedGatewayHost("localhost:4000", createGatewayRequest("10.0.0.5"), config), false);
});

void test("sanitizeRuntimeInspectionError redacts paths and truncates long values", () => {
  const sanitized = sanitizeRuntimeInspectionError("boom at /tmp/secret/config.json\nand more");
  assert.equal(sanitized, "boom at <path>");

  const stackLikeUnix = sanitizeRuntimeInspectionError(
    "Error: cannot inspect runtime at (/home/adam-kessler/dev/switchmaxxer/dist/gateway/runtime.js:174:12)"
  );
  assert.equal(stackLikeUnix, "Error: cannot inspect runtime at (<path>)");

  const stackLikeFileUrl = sanitizeRuntimeInspectionError(
    "Error loading file:///home/adam-kessler/dev/switchmaxxer/dist/index.js:12:3"
  );
  assert.equal(stackLikeFileUrl, "Error loading <path>");

  const stackLikeWindows = sanitizeRuntimeInspectionError(
    "panic at C:\\Users\\adam\\switchmaxxer\\dist\\gateway\\runtime.js:44:2"
  );
  assert.equal(stackLikeWindows, "panic at <path>");

  const longMessage = `prefix ${"/very/long/path/segment".repeat(30)}`;
  const truncated = sanitizeRuntimeInspectionError(longMessage);
  assert.ok(typeof truncated === "string");
  assert.ok(truncated.includes("<path>"));
  assert.ok(truncated.length <= 256);
});

void test("applyRateLimitHeaders emits conservative reset seconds", () => {
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string): void {
      headers.set(name, value);
    }
  } as unknown as Parameters<typeof applyRateLimitHeaders>[0];

  applyRateLimitHeaders(response, 20, { remaining: 7, resetAtMs: 5_500 }, 5_000);

  assert.equal(headers.get("ratelimit-limit"), "20");
  assert.equal(headers.get("ratelimit-remaining"), "7");
  assert.equal(headers.get("ratelimit-reset"), "1");
});

void test("buildRuntimeConfigView sanitizes runtime inspection errors", () => {
  const config: AppConfig = {
    sourcePath: "/tmp/config.json",
    sourceFile: "config.json",
    bindHost: "127.0.0.1",
    port: 4000,
    maxConnections: 100,
    timeoutMs: 30_000,
    streamIdleTimeoutMs: 10_000,
    streamMaxLifetimeMs: 120_000,
    streamMinBytesPerSecond: 1,
    streamRateWindowMs: 1_000,
    streamMaxEventBytes: 64_000,
    streamMaxTotalBytes: 2_000_000,
    maxConcurrentStreamsPerIp: 8,
    maxConcurrentJsonParses: 4,
    maxBufferedUpstreamResponseBytes: 16 * 1024 * 1024,
    shutdownTimeoutMs: 30_000,
    maxPayloadSize: 1024,
    systemdUnit: "switchmaxxer.service",
    observability: { retentionOlderThan: "7d" },
    benchmark: {
      defaultMaxTokens: 256,
      defaultAnthropicVersion: "2023-06-01"
    },
    rateLimit: { requests: 10, window: "1m" },
    inboundApiKeyEnv: "SWITCHMAXXER_INBOUND_API_KEY",
    allowUnauthenticatedGateway: false,
    logLevel: "info",
    routes: {}
  };
  const readModel: GatewayReadModel = {
    sourceFile: "config.json",
    routes: [],
    models: [],
    providers: []
  };
  const reloadState: GatewayReloadState = {
    lastReloadStatus: "failed",
    lastReloadError: "failed at /tmp/runtime/config.json",
    lastReloadAttemptedAt: "2026-04-23T00:00:00.000Z",
    lastReloadSucceededAt: "2026-04-22T23:59:59.000Z"
  };
  const fatalState: GatewayFatalState = {
    processIntegrityStatus: "fatal",
    lastFatalError: "panic at /private/tmp/file.txt",
    lastFatalAt: "2026-04-23T00:00:01.000Z"
  };

  const view = buildRuntimeConfigView({
    config,
    readModel,
    loadedAt: "2026-04-23T00:00:02.000Z",
    reloadState,
    fatalState,
    processStartedAt: "2026-04-23T00:00:03.000Z",
    resolveConfiguredSystemdUnit: () => "switchmaxxer.service",
    resolveInboundGatewayAuthState: () => ({
      kind: "token",
      envVar: "SWITCHMAXXER_INBOUND_API_KEY",
      token: "x".repeat(32)
    })
  });

  assert.equal(view["last_reload_error"], "failed at <path>");
  assert.equal(view["last_fatal_error"], "panic at <path>");
  assert.equal(view["inbound_auth_status"], "enabled");
  assert.equal(view["systemd_unit"], "switchmaxxer.service");
});
