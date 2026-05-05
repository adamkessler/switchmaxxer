import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { HARD_MAX_JSON_SERIALIZED_BYTES } from "../../platform/json-bounds";
import { MASKED_ENV_NAME_SENTINEL } from "../../platform/masked-secret";
import {
  buildLocalGatewayAuthHeaders,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE,
  resolveLocalGatewayInboundAuthState,
  timingSafeTokenMatches
} from "../hot-path/manatee/runtime/local-gateway-auth";
import { createGlobalRateLimiter } from "../hot-path/manatee/runtime/rate-limit";
import { createGatewayRuntime } from "./runtime";
import { createGatewayRequestHandlerFactoryForTests, withEnv } from "./runtime.test-support";
import type { GatewayRuntimeSnapshot } from "../hot-path/manatee/runtime/runtime-snapshot";
import type {
  GatewayAnthropicMessagesRequestBody,
  GatewayOpenAiChatRequestBody
} from "../hot-path/manatee/runtime/request-body-types";
import type { ObservabilityModule } from "../observability/observability-module";

type GatewayRuntimeForTests = ReturnType<typeof createGatewayRuntime> & {
  buildRequestHandlerForTests: ReturnType<typeof createGatewayRequestHandlerFactoryForTests>;
};

const LOCAL_UNAUTHENTICATED_JSON_HEADERS = {
  "content-type": "application/json",
  [LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]: LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
} as const;

const LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS = {
  [LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]: LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
} as const;

function createNoopObservabilityModule(): ObservabilityModule {
  return {
    descriptor: {
      id: "ostrich",
      runtime: "in_process_typescript",
      displayName: "Ostrich",
      capabilities: {
        gatewayObservationWrites: true,
        localReadModel: true,
        retentionPruning: true,
        gracefulShutdownDrain: true
      }
    },
    trace: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        traces: []
      }),
      listObservations: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        observations: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        requestExecution: null,
        observations: [],
        benchmarkSamples: []
      }),
      getStats: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        stats: {
          total_count: 0,
          partial_output_count: 0,
          average_gateway_residency_ms: null,
          average_upstream_ttft_ms: null,
          average_upstream_duration_ms: null,
          outcome_counts: [],
          top_failing_routes: []
        }
      })
    },
    traceMaintenance: {
      verify: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        results: []
      }),
      repair: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        results: []
      })
    },
    retention: {
      pruneOlderThan: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    ledger: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        events: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        event: null
      })
    },
    controlPlaneAudit: {
      startConfigMutation: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        actionId: null
      }),
      finishConfigMutation: ({ dbPath }) => ({
        dbPath,
        storeFound: false
      })
    },
    benchmarkRuns: {
      run: async ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    benchmarkHistory: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        runs: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        run: null,
        summary: null,
        samples: []
      }),
      pruneOlderThan: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      deleteRun: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      clear: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    optimizationReports: {
      persistCost: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        report: null
      }),
      persistLatency: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        report: null
      })
    },
    optimizeMutations: {
      apply: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      restore: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    optimizationHistory: {
      list: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        runs: []
      }),
      show: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        run: null
      }),
      pruneOlderThan: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      deleteRun: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      }),
      clear: ({ dbPath }) => ({
        dbPath,
        storeFound: false,
        result: null
      })
    },
    configure: () => {},
    bootstrap: () => {},
    pruneRetentionNow: () => {},
    getService: () => null,
    getDbPath: () => null,
    recordGatewayObservation: () => {},
    recordGatewayFailureObservation: () => {},
    shutdown: async () => {}
  };
}

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

function createGatewayRuntimeForTests(options: {
  runtime?: GatewayRuntimeSnapshot;
  proxyChatCompletion?: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    config: GatewayRuntimeSnapshot["config"],
    parsedBody: GatewayOpenAiChatRequestBody,
    rawBody: string
  ) => Promise<void>;
  proxyAnthropicMessage?: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    config: GatewayRuntimeSnapshot["config"],
    parsedBody: GatewayAnthropicMessagesRequestBody,
    rawBody: string
  ) => Promise<void>;
  readRequestBodyWithLimit?: (
    request: http.IncomingMessage,
    maxPayloadSize: number,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ) => Promise<string>;
  validateParsedRequestBodyShape?: (body: Record<string, unknown>, maxPayloadSize: number) => void;
}) {
  const warnings: string[] = [];
  const errors: Array<{ statusCode: number; message: string; code: string }> = [];
  const runtimeSnapshot = options.runtime ?? createBaseRuntimeSnapshot();
  const sendJsonError = (response: http.ServerResponse, statusCode: number, message: string, code: string) => {
    errors.push({ statusCode, message, code });
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(`${JSON.stringify({ error: { message, type: "switchmaxxer_error", code } })}\n`);
  };

  const gatewayRuntimeDeps = {
    getCliEnv: () => process.env,
    loadConfig: () => runtimeSnapshot.config,
    loadCliReadModel: () => runtimeSnapshot.readModel,
    normalizeHealthProbeHost: (bindHost: string) => bindHost,
    buildLocalGatewayAuthHeaders,
    resolveLocalGatewayInboundAuthState,
    timingSafeTokenMatches,
    proxyAnthropicMessage:
      options.proxyAnthropicMessage ??
      (async (_request, response) => {
        response.statusCode = 200;
        response.end(JSON.stringify({ ok: true, mode: "anthropic" }));
      }),
    proxyChatCompletion:
      options.proxyChatCompletion ??
      (async (_request, response) => {
        response.statusCode = 200;
        response.end(JSON.stringify({ ok: true, mode: "openai" }));
      }),
    sendJsonError,
    readRequestBodyWithLimit:
      options.readRequestBodyWithLimit ??
      (async (request: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        return Buffer.concat(chunks).toString("utf8");
      }),
    validateParsedRequestBodyShape: options.validateParsedRequestBodyShape ?? (() => {}),
    resolveConfiguredSystemdUnit: (config: Pick<GatewayRuntimeSnapshot["config"], "systemdUnit">) => config.systemdUnit,
    maskSecretValue: (value: string | null) => value,
    observabilityModule: createNoopObservabilityModule(),
    getInlineApiKeyProviderNames: () => [],
    getWorldReadableConfigWarning: () => null,
    logLine: () => {},
    logWarning: (message: string) => {
      warnings.push(message);
    },
    logStartup: () => {},
    logDebug: () => {},
    defaultRequestBodyIdleTimeoutMs: 1_000,
    defaultReloadConfirmationPollIntervalMs: 250,
    defaultRetentionPruneIntervalMs: 60_000
  };

  const gatewayRuntime: GatewayRuntimeForTests = {
    ...createGatewayRuntime(gatewayRuntimeDeps),
    buildRequestHandlerForTests: createGatewayRequestHandlerFactoryForTests(gatewayRuntimeDeps)
  };

  return {
    gatewayRuntime,
    runtimeSnapshot,
    warnings,
    errors
    ,
    sendJsonError
  };
}

async function invokeHandler(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    remoteAddress?: string;
    autoContentLength?: boolean;
  }
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const body = options.body ?? "";
  const requestStream = Readable.from(body.length > 0 ? [body] : []);
  const headers: Record<string, string> = {
    host: "127.0.0.1",
    ...(options.headers ?? {})
  };
  if (
    options.autoContentLength !== false &&
    body.length > 0 &&
    typeof headers["content-length"] !== "string" &&
    typeof headers["transfer-encoding"] !== "string"
  ) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  const request = Object.assign(requestStream, {
    method: options.method,
    url: options.url,
    headers,
    socket: {
      remoteAddress: options.remoteAddress ?? "127.0.0.1"
    }
  }) as http.IncomingMessage;

  const responseHeaders: Record<string, string> = {};
  let responseBody = "";
  const responseState: {
    statusCode: number;
    headersSent: boolean;
    setHeader: (name: string, value: string | number) => void;
    write: (chunk: string) => void;
    end: (chunk?: string) => void;
  } = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string | number): void {
      responseHeaders[name.toLowerCase()] = String(value);
    },
    write(chunk: string): void {
      responseBody += chunk;
      responseState.headersSent = true;
    },
    end(chunk?: string): void {
      if (typeof chunk === "string") {
        responseBody += chunk;
      }

      responseState.headersSent = true;
    }
  };
  const response = responseState as unknown as http.ServerResponse;

  await handler(request, response);

  return {
    statusCode: responseState.statusCode,
    headers: responseHeaders,
    body: responseBody
  };
}

function parseErrorCode(response: { body: string }): string {
  return ((JSON.parse(response.body) as { error: { code: string } }).error.code);
}

function assertHasRequestIdHeader(response: { headers: Record<string, string> }): void {
  assert.match(
    response.headers["x-switchmaxxer-request-id"] ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
}

void test("gateway request handler serves runtime config from the active snapshot", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS
  });
  const payload = JSON.parse(response.body) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assertHasRequestIdHeader(response);
  assert.equal(response.headers["ratelimit-limit"], "100");
  assert.equal(response.headers["ratelimit-remaining"], "99");
  assert.equal(response.headers["ratelimit-reset"], "1");
  assert.equal(typeof payload["started_at"], "string");
  assert.equal(payload["loaded_at"], runtimeSnapshot.loadedAt);
  assert.equal(payload["bind_host"], runtimeSnapshot.config.bindHost);
  assert.equal(payload["port"], runtimeSnapshot.config.port);
  assert.equal(payload["route_count"], runtimeSnapshot.readModel.routes.length);
  assert.equal(payload["provider_count"], runtimeSnapshot.readModel.providers.length);
  assert.equal(payload["stream_max_lifetime_ms"], runtimeSnapshot.config.streamMaxLifetimeMs);
  assert.equal(payload["stream_min_bytes_per_second"], runtimeSnapshot.config.streamMinBytesPerSecond);
  assert.equal(payload["stream_rate_window_ms"], runtimeSnapshot.config.streamRateWindowMs);
  assert.equal(payload["stream_max_event_bytes"], runtimeSnapshot.config.streamMaxEventBytes);
  assert.equal(payload["stream_max_total_bytes"], runtimeSnapshot.config.streamMaxTotalBytes);
  assert.equal(payload["max_concurrent_streams_per_ip"], runtimeSnapshot.config.maxConcurrentStreamsPerIp);
  assert.equal(payload["max_concurrent_json_parses"], runtimeSnapshot.config.maxConcurrentJsonParses);
  assert.equal(payload["max_buffered_upstream_response_bytes"], runtimeSnapshot.config.maxBufferedUpstreamResponseBytes);
  assert.equal(payload["inbound_auth_env_var"], null);
  assert.equal(payload["allow_remote_bind"], false);
  assert.equal(payload["allow_wildcard_bind"], false);
  const providers = payload["providers"] as Array<Record<string, unknown>>;
  assert.equal(providers[0]?.["endpoint_origin"], "https://example.test");
  assert.equal(providers[0]?.["endpoint_pathname"], "/v1/chat/completions");
  assert.equal(providers[0]?.["endpoint_has_query"], true);
  assert.equal(providers[0]?.["endpoint"], undefined);
  assert.equal(providers[0]?.["api_key_env"], MASKED_ENV_NAME_SENTINEL);
});

void test("gateway request handler rejects browser-originated unauthenticated runtime config requests", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const cases: Array<{ name: string; headers: Record<string, string> }> = [
    {
      name: "missing local-client header",
      headers: {}
    },
    {
      name: "cross-site origin",
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        origin: "https://attacker.example"
      }
    },
    {
      name: "cross-site fetch metadata",
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors"
      }
    },
    {
      name: "no-cors browser mode",
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors"
      }
    }
  ];

  for (const testCase of cases) {
    const response = await invokeHandler(handler, {
      method: "GET",
      url: "/__switchmaxxer/runtime/config",
      headers: testCase.headers
    });

    assert.equal(response.statusCode, 403, testCase.name);
    assert.equal(parseErrorCode(response), "unauthorized", testCase.name);
  }
});

void test("gateway request handler accepts unauthenticated runtime config reads without the local-client header inside one trusted operator boundary", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  runtimeSnapshot.config.oneTrustedOperatorBoundary = true;

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: {
      host: "localhost:4080"
    }
  });

  assert.equal(response.statusCode, 200);
});

void test("gateway request handler gates every unauthenticated runtime control-plane GET before dispatch", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const paths = [
    "/__switchmaxxer/runtime/config",
    "/__switchmaxxer/runtime/inspect/33333333-3333-4333-8333-333333333333",
    "/__switchmaxxer/runtime/future-control-plane-path"
  ];

  for (const path of paths) {
    const response = await invokeHandler(handler, {
      method: "GET",
      url: path,
      headers: {}
    });

    assert.equal(response.statusCode, 403, path);
    assert.equal(parseErrorCode(response), "unauthorized", path);
  }

  const unknownWithLocalClient = await invokeHandler(handler, {
    method: "GET",
    url: "/__switchmaxxer/runtime/future-control-plane-path",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS
  });

  assert.equal(unknownWithLocalClient.statusCode, 404);
  assert.equal(parseErrorCode(unknownWithLocalClient), "not_found");
});

void test("gateway runtime config client brackets IPv6 loopback endpoint URLs", async () => {
  const originalFetch = globalThis.fetch;
  const { gatewayRuntime } = createGatewayRuntimeForTests({});
  let observedUrl: string | null = null;

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      observedUrl = String(input);

      return new Response(
        JSON.stringify({
          loaded_at: "2026-04-25T00:00:00.000Z"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const result = await gatewayRuntime.fetchGatewayRuntimeConfigPayload({
      bind_host: "::1",
      port: 4080,
      allow_unauthenticated_gateway: true
    });

    assert.equal(observedUrl, "http://[::1]:4080/__switchmaxxer/runtime/config");
    assert.equal(result.endpoint, "http://[::1]:4080/__switchmaxxer/runtime/config");
    assert.equal(result.payload["loaded_at"], "2026-04-25T00:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("gateway runtime config client rejects oversized response bodies", async () => {
  const originalFetch = globalThis.fetch;
  const { gatewayRuntime } = createGatewayRuntimeForTests({});

  try {
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(HARD_MAX_JSON_SERIALIZED_BYTES + 1)
        }
      })) as typeof fetch;

    await assert.rejects(
      () => gatewayRuntime.fetchGatewayRuntimeConfigPayload({
        bind_host: "127.0.0.1",
        port: 4080,
        allow_unauthenticated_gateway: true
      }),
      /response body exceeded/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("gateway request handler sanitizes runtime inspection errors", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.reloadState = {
    lastReloadStatus: "failed",
    lastReloadError: "Reload failed for file:///tmp/runtime-config.json\n    at reloadConfig (src/runtime.ts:1:1)",
    lastReloadAttemptedAt: "2026-04-21T12:10:00.000Z",
    lastReloadSucceededAt: null
  };
  runtimeSnapshot.fatalState = {
    processIntegrityStatus: "fatal",
    lastFatalError: `Fatal error opening /tmp/secrets/provider-key.txt ${"x".repeat(300)}`,
    lastFatalAt: "2026-04-21T12:11:00.000Z"
  };
  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS
  });
  const payload = JSON.parse(response.body) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assert.equal(payload["last_reload_error"], "Reload failed for <path>");
  assert.equal(typeof payload["last_fatal_error"], "string");
  assert.match(String(payload["last_fatal_error"]), /^Fatal error opening <path>/);
  assert.ok(String(payload["last_fatal_error"]).length <= 256);
  assert.doesNotMatch(String(payload["last_fatal_error"]), /\/tmp\/secrets/);
});

void test("gateway request handler rate limits the authenticated runtime config endpoint", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.rateLimiter = {
    check: (_callerKey: string) => ({
      allowed: false,
      retryAfterSeconds: 7,
      resetAtMs: Date.now() + 7_000
    })
  };
  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "7");
  assert.equal(parseErrorCode(response), "rate_limited");
});

void test("gateway request handler rejects authenticated runtime config requests from non-loopback callers", async () => {
  const envVarName = "SWITCHMAXXER_TEST_RUNTIME_CONFIG_TOKEN";
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });

    const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "GET",
      url: "/__switchmaxxer/runtime/config",
      headers: {
        host: "127.0.0.1:4080",
        authorization: "Bearer 0123456789abcdef0123456789abcdef"
      },
      remoteAddress: "203.0.113.10"
    });

    assert.equal(response.statusCode, 421);
    assert.equal(parseErrorCode(response), "misdirected_request");
  });
});

void test("gateway request handler rejects runtime config requests with a malformed Host header", async () => {
  const envVarName = "SWITCHMAXXER_TEST_RUNTIME_CONFIG_BAD_HOST_TOKEN";
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });

    const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "GET",
      url: "/__switchmaxxer/runtime/config",
      headers: {
        host: "[::1",
        authorization: "Bearer 0123456789abcdef0123456789abcdef"
      }
    });

    assert.equal(response.statusCode, 421);
    assertHasRequestIdHeader(response);
    assert.equal(parseErrorCode(response), "misdirected_request");
  });
});

void test("gateway request handler keeps the main request rate limit keyed by source IP", async () => {
  const envVarName = "SWITCHMAXXER_TEST_GATEWAY_RATE_LIMIT_TOKEN";
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;
  runtimeSnapshot.rateLimiter = createGlobalRateLimiter({
    requests: 1,
    windowMs: 1_000
  });

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });

    const authorizedHeaders = {
      "content-type": "application/json",
      authorization: "Bearer 0123456789abcdef0123456789abcdef"
    };

    const firstCaller = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...authorizedHeaders,
        "x-switchmaxxer-caller": "caller-display-a"
      },
      remoteAddress: "203.0.113.10",
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    });
    const blockedSameCaller = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...authorizedHeaders,
        "x-switchmaxxer-caller": "caller-display-b"
      },
      remoteAddress: "203.0.113.10",
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello again" }],
        stream: false
      })
    });
    const differentCaller = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...authorizedHeaders,
        "x-switchmaxxer-caller": "caller-display-b"
      },
      remoteAddress: "203.0.113.11",
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello from elsewhere" }],
        stream: false
      })
    });

    assert.equal(firstCaller.statusCode, 200);
    assert.equal(blockedSameCaller.statusCode, 429);
    assert.equal(parseErrorCode(blockedSameCaller), "rate_limited");
    assert.equal(differentCaller.statusCode, 200);
  });
});

void test("gateway request handler partitions caller rate limits by route trust class", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.rateLimiter = createGlobalRateLimiter({
    requests: 1,
    windowMs: 1_000
  });
  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot
  });
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const dataPlaneBody = JSON.stringify({
    model: "demo",
    messages: [{ role: "user", content: "hello" }],
    stream: false
  });

  const acceptedDataPlane = await invokeHandler(handler, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    remoteAddress: "127.0.0.1",
    body: dataPlaneBody
  });
  const acceptedControlPlane = await invokeHandler(handler, {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
    remoteAddress: "127.0.0.1"
  });
  const blockedDataPlane = await invokeHandler(handler, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    remoteAddress: "127.0.0.1",
    body: dataPlaneBody
  });
  const blockedControlPlane = await invokeHandler(handler, {
    method: "GET",
    url: "/__switchmaxxer/runtime/config",
    headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
    remoteAddress: "127.0.0.1"
  });

  assert.equal(acceptedDataPlane.statusCode, 200);
  assert.equal(acceptedControlPlane.statusCode, 200);
  assert.equal(blockedDataPlane.statusCode, 429);
  assert.equal(parseErrorCode(blockedDataPlane), "rate_limited");
  assert.equal(blockedControlPlane.statusCode, 429);
  assert.equal(parseErrorCode(blockedControlPlane), "rate_limited");
});

void test("gateway request handler returns not_found for unknown paths", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/definitely-missing"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(parseErrorCode(response), "not_found");
});

void test("gateway request handler rejects malformed JSON bodies", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: "{"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(parseErrorCode(response), "invalid_json");
});

void test("gateway request handler rejects wrong-shaped parsed request body fields at ingress", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }],
      stream: "yes"
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(parseErrorCode(response), "invalid_json");
});

void test("gateway request handler rejects deeply nested JSON bodies before raw parse recursion", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  let nestedMessages = "[]";

  for (let index = 0; index < 300; index += 1) {
    nestedMessages = `[${nestedMessages}]`;
  }

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: `{"model":"demo","messages":${nestedMessages},"stream":false}`
  });

  assert.equal(response.statusCode, 413);
  assert.equal(parseErrorCode(response), "payload_too_large");
});

void test("gateway request handler rejects oversized request bodies", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      throw new Error("request_body_too_large");
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": "0"
    }
  });

  assert.equal(response.statusCode, 413);
  assert.equal(parseErrorCode(response), "payload_too_large");
});

void test("gateway request handler rejects JSON request bodies without a Content-Length header before reading them", async () => {
  let readCalled = false;
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      readCalled = true;
      return "";
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    }),
    autoContentLength: false
  });

  assert.equal(response.statusCode, 411);
  assert.equal(response.headers["connection"], "close");
  assert.equal(parseErrorCode(response), "invalid_request");
  assert.equal(readCalled, false);
});

void test("gateway request handler rejects non-canonical Content-Length values before reading them", async () => {
  const invalidContentLengths = ["10junk", "0010", "+10", "1.5", "9007199254740992"];
  let readCalled = false;
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      readCalled = true;
      return "";
    }
  });
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);

  for (const contentLength of invalidContentLengths) {
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
        "content-length": contentLength
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      }),
      autoContentLength: false
    });

    assert.equal(response.statusCode, 400);
    assert.equal(parseErrorCode(response), "invalid_request");
    assert.equal(readCalled, false);
  }
});

void test("gateway request handler rejects chunked JSON request bodies before reading them", async () => {
  let readCalled = false;
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      readCalled = true;
      return "";
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "transfer-encoding": "chunked"
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    }),
    autoContentLength: false
  });

  assert.equal(response.statusCode, 411);
  assert.equal(response.headers["connection"], "close");
  assert.equal(parseErrorCode(response), "invalid_request");
  assert.equal(readCalled, false);
});

void test("gateway request handler rejects timed out request body uploads", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      throw new Error("request_body_idle_timeout");
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": "0"
    }
  });

  assert.equal(response.statusCode, 408);
  assert.equal(response.headers["connection"], "close");
  assert.equal(parseErrorCode(response), "request_timeout");
});

void test("gateway request handler rejects request body uploads that exceed the total wall-clock deadline", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      throw new Error("request_body_total_timeout");
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": "0"
    }
  });

  assert.equal(response.statusCode, 408);
  assert.equal(response.headers["connection"], "close");
  assert.equal(parseErrorCode(response), "request_timeout");
});

void test("gateway request handler rejects parsed JSON structures that exceed shape bounds", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    validateParsedRequestBodyShape: () => {
      throw new Error("request_body_structure_too_large");
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 413);
  assert.equal(parseErrorCode(response), "payload_too_large");
});

void test("gateway request handler reports misconfigured inbound auth as a 500", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.inboundApiKeyEnv = "MISSING_GATEWAY_TEST_TOKEN";
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;

  await withEnv({ MISSING_GATEWAY_TEST_TOKEN: undefined }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });

    const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      }
    });

    assert.equal(response.statusCode, 500);
    assert.equal(parseErrorCode(response), "inbound_auth_misconfigured");
  });
});

void test("gateway server-style wrapper converts thrown proxy errors into internal_error before headers", async () => {
  const { gatewayRuntime, runtimeSnapshot, sendJsonError } = createGatewayRuntimeForTests({
    proxyChatCompletion: async () => {
      throw new Error("boom");
    }
  });

  const wrappedHandler = async (request: http.IncomingMessage, response: http.ServerResponse): Promise<void> => {
    await gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot)(request, response).catch((_error: Error) => {
      if (!response.headersSent) {
        sendJsonError(response, 500, "Internal server error", "internal_error");
        return;
      }

      response.end();
    });
  };

  const response = await invokeHandler(wrappedHandler, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(parseErrorCode(response), "internal_error");
});
