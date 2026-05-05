import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { CLI_SCHEMA_VERSION } from "../../platform/response-envelope";
import { REDACTED_SECRET } from "../../platform/secret-string";
import {
  buildLocalGatewayAuthHeaders,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE,
  resolveLocalGatewayInboundAuthState,
  timingSafeTokenMatches
} from "./local-gateway-auth";
import { getGatewayHealthProbeMetricsSnapshot } from "./health-probe-metrics";
import { resetGatewayHealthProbeMetricsForTests } from "./health-probe-metrics.test-support";
import type { GatewayRuntimeSnapshot } from "./runtime-snapshot";
import type {
  GatewayAnthropicMessagesRequestBody,
  GatewayOpenAiChatRequestBody
} from "./request-body-types";
import { buildGatewayRequestHandlerForTests, withEnv } from "./runtime.test-support";
import {
  INVOKE_INSPECTION_REQUEST_HEADER,
  INVOKE_INSPECTION_RESPONSE_HEADER,
  INVOKE_INSPECTION_SECRET_REVEAL_ENV,
  INVOKE_INSPECTION_TOKEN_HEADER
} from "./invoke-inspection";
import { proxyChatCompletion as realProxyChatCompletion } from "../proxy/proxy";

const LOCAL_UNAUTHENTICATED_JSON_HEADERS = {
  "content-type": "application/json",
  [LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]: LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
} as const;

const LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS = {
  [LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]: LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
} as const;

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
    configureGatewayObservability: () => {},
    pruneGatewayObservabilityRetentionNow: () => {},
    bootstrapGatewayObservability: () => {},
    shutdownGatewayObservability: async () => {},
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

  const gatewayRuntime = {
    buildRequestHandlerForTests: (activeRuntime?: GatewayRuntimeSnapshot) =>
      buildGatewayRequestHandlerForTests(gatewayRuntimeDeps, activeRuntime)
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
    headers?: Record<string, string | string[]>;
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
  const headers: Record<string, string | string[]> = {
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
  const finishListeners: Array<() => void> = [];
  const responseState: {
    statusCode: number;
    headersSent: boolean;
    setHeader: (name: string, value: string | number) => void;
    getHeaders: () => Record<string, string>;
    on: (event: "finish", listener: () => void) => void;
    write: (chunk: string) => void;
    end: (chunk?: string) => void;
  } = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string | number): void {
      responseHeaders[name.toLowerCase()] = String(value);
    },
    getHeaders(): Record<string, string> {
      return { ...responseHeaders };
    },
    on(event: "finish", listener: () => void): void {
      if (event === "finish") {
        finishListeners.push(listener);
      }
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
      for (const listener of finishListeners) {
        listener();
      }
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

function startHandlerInvocation(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    remoteAddress?: string;
  }
): {
  promise: Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }>;
} {
  return {
    promise: invokeHandler(handler, options)
  };
}

function parseErrorCode(response: { body: string }): string {
  return ((JSON.parse(response.body) as { error: { code: string } }).error.code);
}

test.beforeEach(() => {
  resetGatewayHealthProbeMetricsForTests();
});

function assertHasRequestIdHeader(response: { headers: Record<string, string> }): void {
  assert.match(
    response.headers["x-switchmaxxer-request-id"] ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
}

void test("gateway request handler serves a minimal non-identifying health payload", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/health"
  });
  const payload = JSON.parse(response.body) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assertHasRequestIdHeader(response);
  assert.equal(payload["status"], "ok");
  assert.equal(payload["process_integrity_status"], "ok");
  assert.equal(payload["service"], undefined);
});

void test("gateway request handler requires bearer auth for /health when inbound auth is configured", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const envVarName = "SWITCHMAXXER_GATEWAY_HEALTH_TOKEN";
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.allowUnauthenticatedHealth = false;

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const missingAuth = await invokeHandler(handler, {
      method: "GET",
      url: "/health"
    });
    assert.equal(missingAuth.statusCode, 401);
    assert.equal(parseErrorCode(missingAuth), "unauthorized");

    const authorized = await invokeHandler(handler, {
      method: "GET",
      url: "/health",
      headers: {
        authorization: "Bearer 0123456789abcdef0123456789abcdef"
      }
    });
    const payload = JSON.parse(authorized.body) as Record<string, unknown>;
    assert.equal(authorized.statusCode, 200);
    assert.equal(payload["status"], "ok");
  });
});

void test("gateway request handler keeps inbound auth misconfiguration details out of client responses", async () => {
  const cases: Array<{
    label: string;
    envVarName: string | null;
    envValue?: string;
    expectedLogPattern: RegExp;
  }> = [
    {
      label: "missing env name",
      envVarName: null,
      expectedLogPattern: /set 'inbound_api_key_env'/
    },
    {
      label: "missing token",
      envVarName: "SWITCHMAXXER_GATEWAY_MISSING_HEALTH_TOKEN",
      expectedLogPattern: /SWITCHMAXXER_GATEWAY_MISSING_HEALTH_TOKEN.*not set or is empty/
    },
    {
      label: "empty token",
      envVarName: "SWITCHMAXXER_GATEWAY_EMPTY_HEALTH_TOKEN",
      envValue: "   ",
      expectedLogPattern: /SWITCHMAXXER_GATEWAY_EMPTY_HEALTH_TOKEN.*not set or is empty/
    },
    {
      label: "short token",
      envVarName: "SWITCHMAXXER_GATEWAY_SHORT_HEALTH_TOKEN",
      envValue: "short-token",
      expectedLogPattern: /SWITCHMAXXER_GATEWAY_SHORT_HEALTH_TOKEN.*at least 32 characters/
    }
  ];

  for (const testCase of cases) {
    const envValues = typeof testCase.envVarName === "string" ? { [testCase.envVarName]: testCase.envValue } : {};
    await withEnv(envValues, async () => {
      const { gatewayRuntime, runtimeSnapshot, warnings } = createGatewayRuntimeForTests({});
      runtimeSnapshot.config.inboundApiKeyEnv = testCase.envVarName;
      runtimeSnapshot.config.allowUnauthenticatedGateway = false;
      runtimeSnapshot.config.allowUnauthenticatedHealth = false;

      const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
        method: "GET",
        url: "/health"
      });
      const payload = JSON.parse(response.body) as { error: { code: string; message: string } };

      assert.equal(response.statusCode, 500, testCase.label);
      assert.equal(payload.error.code, "inbound_auth_misconfigured", testCase.label);
      assert.equal(payload.error.message, "Gateway inbound auth is misconfigured.", testCase.label);
      assert.doesNotMatch(response.body, /SWITCHMAXXER_GATEWAY_/, testCase.label);
      assert.doesNotMatch(response.body, /at least 32 characters|not set or is empty|inbound_api_key_env/, testCase.label);
      assert.match(warnings.join("\n"), testCase.expectedLogPattern, testCase.label);
    });
  }
});

void test("gateway request handler allows explicit unauthenticated /health only for loopback probes", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const envVarName = "SWITCHMAXXER_GATEWAY_PUBLIC_HEALTH_TOKEN";
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.allowUnauthenticatedHealth = true;

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const allowed = await invokeHandler(handler, {
      method: "GET",
      url: "/health",
      headers: {
        host: "localhost:4080"
      }
    });
    assert.equal(allowed.statusCode, 200);

    const rejected = await invokeHandler(handler, {
      method: "GET",
      url: "/health",
      headers: {
        host: "attacker.example"
      }
    });
    assert.equal(rejected.statusCode, 421);
    assert.equal(parseErrorCode(rejected), "misdirected_request");
  });
});

void test("gateway /health bad Host probes count toward failed-auth backoff", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const envVarName = "SWITCHMAXXER_GATEWAY_HEALTH_HOST_BACKOFF_TOKEN";
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.allowUnauthenticatedHealth = true;

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, async () => {
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const badHostRequest = {
      method: "GET",
      url: "/health",
      headers: {
        host: "attacker.example"
      },
      remoteAddress: "127.0.0.1"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await invokeHandler(handler, badHostRequest);
      assert.equal(response.statusCode, 421);
      assert.equal(parseErrorCode(response), "misdirected_request");
    }

    const blocked = await invokeHandler(handler, badHostRequest);
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseErrorCode(blocked), "auth_rate_limited");
    assert.equal(blocked.headers["retry-after"], "30");
  });
});

void test("gateway request handler rejects /health in unauthenticated mode when the Host header is not loopback", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/health",
    headers: {
      host: "attacker.example"
    }
  });

  assert.equal(response.statusCode, 421);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler rejects /health with a malformed Host header without an internal error", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/health",
    headers: {
      host: "[::1"
    }
  });

  assert.equal(response.statusCode, 421);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler rejects malformed request targets without an internal error", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "http://[::1",
    headers: {
      host: "localhost:4080"
    }
  });

  assert.equal(response.statusCode, 400);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "invalid_request");
});

void test("gateway request handler still allows /health in unauthenticated mode for loopback probes", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/health",
    headers: {
      host: "localhost:4080"
    }
  });
  const payload = JSON.parse(response.body) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assertHasRequestIdHeader(response);
  assert.equal(payload["status"], "ok");
  assert.equal(payload["process_integrity_status"], "ok");
});

void test("gateway request handler applies a coarse per-ip rate limit to /health", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await invokeHandler(handler, {
      method: "GET",
      url: "/health",
      headers: {
        host: "localhost:4080"
      },
      remoteAddress: "127.0.0.1"
    });
    assert.equal(response.statusCode, 200);
  }

  const blocked = await invokeHandler(handler, {
    method: "GET",
    url: "/health",
    headers: {
      host: "localhost:4080"
    },
    remoteAddress: "127.0.0.1"
  });
  const payload = JSON.parse(blocked.body) as Record<string, unknown>;

  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["retry-after"], "1");
  assert.equal(payload["status"], "rate_limited");

  const differentSource = await invokeHandler(handler, {
    method: "GET",
    url: "/health",
    headers: {
      host: "localhost:4080"
    },
    remoteAddress: "::1"
  });
  assert.equal(differentSource.statusCode, 200);

  const healthProbeMetrics = getGatewayHealthProbeMetricsSnapshot();
  assert.deepEqual(healthProbeMetrics, {
    total_requests: 102,
    allowed_requests: 101,
    rate_limited_requests: 1,
    last_seen_at: healthProbeMetrics.last_seen_at
  });
  assert.match(healthProbeMetrics.last_seen_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

void test("gateway request handler dispatches OpenAI requests to proxyChatCompletion", async () => {
  let captured: {
    parsedBody: Record<string, unknown>;
    rawBody: string;
    providerCount: number;
  } | null = null;

  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    proxyChatCompletion: async (_request, response, config, parsedBody, rawBody) => {
      captured = {
        parsedBody,
        rawBody,
        providerCount: Object.keys(config.routes).length
      };
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true }));
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

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["ratelimit-limit"], "100");
  assert.equal(response.headers["ratelimit-remaining"], "99");
  assert.equal(response.headers["ratelimit-reset"], "1");

  assert.deepEqual(captured, {
    parsedBody: {
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    },
    rawBody: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    }),
    providerCount: 1
  });
});

void test("gateway request handler rejects prototype-pollution keys in parsed request bodies", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const requestBodies = [
    [
      "{",
      "\"model\":\"demo\",",
      "\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}],",
      "\"__proto__\":{\"polluted\":true}",
      "}"
    ].join(""),
    JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }],
      metadata: {
        constructor: {
          polluted: true
        }
      }
    }),
    JSON.stringify({
      model: "demo",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
              input: {
                prototype: {
                  polluted: true
                }
              }
            }
          ]
        }
      ]
    })
  ];

  for (const body of requestBodies) {
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      body
    });

    assert.equal(response.statusCode, 400, body);
    assert.equal(parseErrorCode(response), "invalid_json", body);
  }

  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

void test("gateway request handler rejects ambiguous request-framing headers before reading JSON bodies", async () => {
  let readCount = 0;
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    readRequestBodyWithLimit: async () => {
      readCount += 1;
      return "";
    }
  });
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const body = JSON.stringify({
    model: "demo",
    messages: [{ role: "user", content: "hello" }]
  });

  const transferEncoded = await invokeHandler(handler, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": String(Buffer.byteLength(body)),
      "transfer-encoding": "chunked"
    },
    body,
    autoContentLength: false
  });
  assert.equal(transferEncoded.statusCode, 411);
  assert.equal(transferEncoded.headers["connection"], "close");
  assert.equal(parseErrorCode(transferEncoded), "invalid_request");

  const duplicateContentLength = await invokeHandler(handler, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": [String(Buffer.byteLength(body)), String(Buffer.byteLength(body))]
    },
    body,
    autoContentLength: false
  });
  assert.equal(duplicateContentLength.statusCode, 400);
  assert.equal(duplicateContentLength.headers["connection"], "close");
  assert.equal(parseErrorCode(duplicateContentLength), "invalid_request");
  assert.equal(readCount, 0);
});

void test("gateway request handler rejects unauthenticated requests with a non-loopback Host header", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      host: "attacker.example",
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 421);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler rejects unauthenticated data-plane requests with a malformed Host header", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      host: "[::1",
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 421);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler accepts unauthenticated requests that target an allowed loopback Host header", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      host: "localhost:4080",
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 200);
});

void test("gateway request handler requires the local-client header for unauthenticated data-plane requests", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      host: "localhost:4080",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 403);
  assert.equal(parseErrorCode(response), "unauthorized");
});

void test("gateway request handler accepts unauthenticated data-plane requests without the local-client header inside one trusted operator boundary", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  runtimeSnapshot.config.oneTrustedOperatorBoundary = true;

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      host: "localhost:4080",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 200);
});

void test("gateway request handler still rejects browser-originated requests inside one trusted operator boundary", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  runtimeSnapshot.config.oneTrustedOperatorBoundary = true;

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      host: "localhost:4080",
      "content-type": "application/json",
      origin: "https://attacker.example"
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 403);
  assert.equal(parseErrorCode(response), "unauthorized");
});

void test("gateway request handler rejects browser-originated unauthenticated data-plane requests", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const cases: Array<{ name: string; headers: Record<string, string> }> = [
    {
      name: "cross-site origin",
      headers: {
        origin: "https://attacker.example"
      }
    },
    {
      name: "cross-site fetch metadata",
      headers: {
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors"
      }
    },
    {
      name: "no-cors browser mode",
      headers: {
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors"
      }
    }
  ];

  for (const testCase of cases) {
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
        host: "localhost:4080",
        ...testCase.headers
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.statusCode, 403, testCase.name);
    assert.equal(parseErrorCode(response), "unauthorized", testCase.name);
  }
});

void test("gateway proxy endpoints require application/json request content", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      host: "localhost:4080",
      "content-type": "text/plain",
      [LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER]: LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 415);
  assert.equal(parseErrorCode(response), "invalid_request");
});

void test("gateway request handler rejects unauthenticated requests from a non-loopback source even with a loopback Host header", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      host: "127.0.0.1:4080",
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    }),
    remoteAddress: "192.168.1.44"
  });

  assert.equal(response.statusCode, 421);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler ignores forwarded headers and trusts the socket peer for unauthenticated requests", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      host: "localhost:4080",
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "127.0.0.1"
    },
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }]
    }),
    remoteAddress: "10.0.0.24"
  });

  assert.equal(response.statusCode, 421);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler ignores forwarded headers and trusts the socket peer for /health probes", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "GET",
    url: "/health",
    headers: {
      host: "localhost:4080",
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "127.0.0.1"
    },
    remoteAddress: "10.0.0.24"
  });

  assert.equal(response.statusCode, 421);
  assertHasRequestIdHeader(response);
  assert.equal(parseErrorCode(response), "misdirected_request");
});

void test("gateway request handler dispatches Anthropic requests to proxyAnthropicMessage", async () => {
  let invoked = false;

  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    proxyAnthropicMessage: async (_request, response, _config, parsedBody) => {
      invoked = true;
      assert.equal(parsedBody["model"], "demo");
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true }));
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/anthropic/v1/messages",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["ratelimit-limit"], "100");
  assert.equal(response.headers["ratelimit-remaining"], "99");
  assert.equal(response.headers["ratelimit-reset"], "1");

  assert.equal(invoked, true);
});

void test("gateway request handler supports streaming-style proxy responses", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({
    proxyChatCompletion: async (_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.write("data: first\n\n");
      response.write("data: second\n\n");
      response.end("data: [DONE]\n\n");
    }
  });

  const response = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(response.body, "data: first\n\ndata: second\n\ndata: [DONE]\n\n");
});

void test("gateway invoke inspection captures four non-streaming proxy exchanges as one-time local runtime data", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.routes["demo"]!.baseUrl = "https://8.8.8.8/v1/chat/completions";
  runtimeSnapshot.config.routes["demo"]!.allowPrivateEndpoints = true;
  const capturedUpstreamHeaders: Array<string | null> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    capturedUpstreamHeaders.push(headers.get(INVOKE_INSPECTION_REQUEST_HEADER));

    return new Response(
      `${JSON.stringify({
        id: "chatcmpl-inspect",
        object: "chat.completion",
        created: 1,
        model: "demo-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "hello from inspect"
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2
        }
      })}\n`,
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-provider-request-id": "provider-req-1"
        }
      }
    );
  }) as typeof fetch;

  await withEnv({ SWITCHMAXXER_DEMO_PROVIDER_KEY: "provider-secret-for-inspection" }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot,
      proxyChatCompletion: async (request, response, config, parsedBody, rawBody) => {
        await realProxyChatCompletion(request, response, config, parsedBody, rawBody, { fetchImpl });
      }
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
        authorization: "Bearer inbound-secret",
        [INVOKE_INSPECTION_REQUEST_HEADER]: "1"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedUpstreamHeaders, [null]);
    const inspectId = response.headers[INVOKE_INSPECTION_RESPONSE_HEADER] ?? "";
    const inspectToken = response.headers[INVOKE_INSPECTION_TOKEN_HEADER] ?? "";
    assert.match(inspectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(inspectToken, /^[A-Za-z0-9_-]{43}$/);

    const missingTokenRead = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}`,
      headers: LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS
    });
    assert.equal(missingTokenRead.statusCode, 401);
    assert.equal(parseErrorCode(missingTokenRead), "unauthorized");

    const wrongTokenRead = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}`,
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        [INVOKE_INSPECTION_TOKEN_HEADER]: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
    assert.equal(wrongTokenRead.statusCode, 404);

    const inspectResponse = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}`,
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        [INVOKE_INSPECTION_TOKEN_HEADER]: inspectToken
      }
    });
    assert.equal(inspectResponse.statusCode, 200);
    const payload = JSON.parse(inspectResponse.body) as {
      schema_version: string;
      data: {
        capture: {
          client_to_smx: { headers: Record<string, string>; body: string };
          smx_to_provider: { headers: Record<string, string>; body: string };
          provider_to_smx: { headers: Record<string, string>; body: string };
          smx_to_client: { headers: Record<string, string>; body: string };
        };
      };
    };

    assert.equal(payload.schema_version, CLI_SCHEMA_VERSION);
    assert.equal(payload.data.capture.client_to_smx.headers["authorization"], "***redacted***");
    assert.equal(payload.data.capture.smx_to_provider.headers["authorization"], "***redacted***");
    assert.equal(payload.data.capture.smx_to_provider.headers[INVOKE_INSPECTION_REQUEST_HEADER], undefined);
    assert.equal(payload.data.capture.smx_to_client.headers[INVOKE_INSPECTION_TOKEN_HEADER], undefined);
    assert.match(payload.data.capture.client_to_smx.body, /"model":"demo"/);
    assert.match(payload.data.capture.smx_to_provider.body, /"model":"demo-model"/);
    assert.match(payload.data.capture.provider_to_smx.body, /hello from inspect/);
    assert.match(payload.data.capture.smx_to_client.body, /hello from inspect/);

    const secondRead = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}`,
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        [INVOKE_INSPECTION_TOKEN_HEADER]: inspectToken
      }
    });
    assert.equal(secondRead.statusCode, 404);

    const includeSecretsRequest = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
        authorization: "Bearer inbound-secret",
        [INVOKE_INSPECTION_REQUEST_HEADER]: "1"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    });
    const includeSecretsInspectId = includeSecretsRequest.headers[INVOKE_INSPECTION_RESPONSE_HEADER] ?? "";
    const includeSecretsInspectToken = includeSecretsRequest.headers[INVOKE_INSPECTION_TOKEN_HEADER] ?? "";
    assert.match(includeSecretsInspectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(includeSecretsInspectToken, /^[A-Za-z0-9_-]{43}$/);
    const includeSecretsResponse = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${includeSecretsInspectId}?include_secrets=true`,
      headers: {
        ...LOCAL_UNAUTHENTICATED_RUNTIME_HEADERS,
        [INVOKE_INSPECTION_TOKEN_HEADER]: includeSecretsInspectToken
      }
    });
    assert.equal(includeSecretsResponse.statusCode, 403);
    assert.equal(parseErrorCode(includeSecretsResponse), "unauthorized");
  });
});

void test("gateway invoke inspection rejects caller-supplied inspection ids", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);

  for (const header of [INVOKE_INSPECTION_RESPONSE_HEADER, INVOKE_INSPECTION_TOKEN_HEADER]) {
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
        [header]: header === INVOKE_INSPECTION_RESPONSE_HEADER
          ? "11111111-1111-4111-8111-111111111111"
          : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    });

    assert.equal(response.statusCode, 400);
    assert.equal(parseErrorCode(response), "invalid_request");
  }
});

void test("gateway request handler rejects browser-originated unauthenticated runtime inspection reads", async () => {
  const { gatewayRuntime, runtimeSnapshot } = createGatewayRuntimeForTests({});
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const inspectId = "33333333-3333-4333-8333-333333333333";
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
      url: `/__switchmaxxer/runtime/inspect/${inspectId}?include_secrets=true`,
      headers: testCase.headers
    });

    assert.equal(response.statusCode, 403, testCase.name);
    assert.equal(parseErrorCode(response), "unauthorized", testCase.name);
  }
});

void test("gateway invoke inspection requires explicit opt-in and keeps upstream provider auth redacted", async () => {
  const envVarName = "SWITCHMAXXER_TEST_INSPECT_SECRET_REVEAL_TOKEN";
  const inboundToken = "0123456789abcdef0123456789abcdef";
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.allowUnauthenticatedGateway = false;
  runtimeSnapshot.config.inboundApiKeyEnv = envVarName;
  runtimeSnapshot.config.routes["demo"]!.baseUrl = "https://8.8.4.4/v1/chat/completions";
  runtimeSnapshot.config.routes["demo"]!.allowPrivateEndpoints = true;
  const fetchImpl = (async (): Promise<Response> => new Response(
    `${JSON.stringify({
      id: "chatcmpl-inspect-authenticated",
      object: "chat.completion",
      created: 1,
      model: "demo-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "hello from authenticated inspect"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    })}\n`,
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    }
  )) as typeof fetch;

  await withEnv({
    [envVarName]: inboundToken,
    SWITCHMAXXER_DEMO_PROVIDER_KEY: "provider-secret-for-authenticated-inspection",
    [INVOKE_INSPECTION_SECRET_REVEAL_ENV]: undefined
  }, async () => {
    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot,
      proxyChatCompletion: async (request, response, config, parsedBody, rawBody) => {
        await realProxyChatCompletion(request, response, config, parsedBody, rawBody, { fetchImpl });
      }
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const response = await invokeHandler(handler, {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${inboundToken}`,
        [INVOKE_INSPECTION_REQUEST_HEADER]: "1"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    });

    assert.equal(response.statusCode, 200);
    const inspectId = response.headers[INVOKE_INSPECTION_RESPONSE_HEADER] ?? "";
    const inspectToken = response.headers[INVOKE_INSPECTION_TOKEN_HEADER] ?? "";
    assert.match(inspectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(inspectToken, /^[A-Za-z0-9_-]{43}$/);

    const missingOptInResponse = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}?include_secrets=true`,
      headers: {
        authorization: `Bearer ${inboundToken}`,
        [INVOKE_INSPECTION_TOKEN_HEADER]: inspectToken
      }
    });
    assert.equal(missingOptInResponse.statusCode, 403);
    assert.equal(parseErrorCode(missingOptInResponse), "unauthorized");

    process.env[INVOKE_INSPECTION_SECRET_REVEAL_ENV] = "1";

    const includeSecretsResponse = await invokeHandler(handler, {
      method: "GET",
      url: `/__switchmaxxer/runtime/inspect/${inspectId}?include_secrets=true`,
      headers: {
        authorization: `Bearer ${inboundToken}`,
        [INVOKE_INSPECTION_TOKEN_HEADER]: inspectToken
      }
    });
    const includeSecretsPayload = JSON.parse(includeSecretsResponse.body) as {
      data: {
        capture: {
          client_to_smx: { headers: Record<string, string> };
          smx_to_provider: { headers: Record<string, string> };
        };
      };
    };

    assert.equal(includeSecretsResponse.statusCode, 200);
    assert.equal(includeSecretsPayload.data.capture.client_to_smx.headers["authorization"], `Bearer ${inboundToken}`);
    assert.equal(
      includeSecretsPayload.data.capture.smx_to_provider.headers["authorization"],
      REDACTED_SECRET
    );
  });
});

void test("gateway request handler caps concurrent streaming requests per source IP and releases slots on completion", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.maxConcurrentStreamsPerIp = 1;
  let releaseFirstStream: (() => void) | null = null;
  let streamStartedResolve: (() => void) | null = null;
  const streamStarted = new Promise<void>((resolve) => {
    streamStartedResolve = resolve;
  });

  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot,
    proxyChatCompletion: async (_request, response) => {
      if (releaseFirstStream === null) {
        streamStartedResolve?.();
        await new Promise<void>((resolve) => {
          releaseFirstStream = () => {
            response.statusCode = 200;
            response.end("data: [DONE]\n\n");
            resolve();
          };
        });
        return;
      }

      response.statusCode = 200;
      response.end("data: [DONE]\n\n");
    }
  });
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const requestOptions = {
    method: "POST",
    url: "/v1/chat/completions",
    headers: LOCAL_UNAUTHENTICATED_JSON_HEADERS,
    body: JSON.stringify({
      model: "demo",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    }),
    remoteAddress: "127.0.0.1"
  };

  const firstInvocation = startHandlerInvocation(handler, requestOptions);
  await streamStarted;

  const blocked = await invokeHandler(handler, requestOptions);
  assert.equal(blocked.statusCode, 429);
  assert.equal(parseErrorCode(blocked), "stream_capacity_exceeded");

  const releaseHeldStream = releaseFirstStream as (() => void) | null;
  if (releaseHeldStream === null) {
    throw new Error("Expected the first streaming request to hold a release callback.");
  }
  releaseHeldStream();
  const completedFirst = await firstInvocation.promise;
  assert.equal(completedFirst.statusCode, 200);

  const allowedAgain = await invokeHandler(handler, requestOptions);
  assert.equal(allowedAgain.statusCode, 200);
});

void test("gateway request handler rejects missing inbound auth and accepts a valid token", async () => {
  await withEnv({ SWITCHMAXXER_GATEWAY_TEST_TOKEN: "12345678901234567890123456789012" }, async () => {
    const runtimeSnapshot = createBaseRuntimeSnapshot();
    runtimeSnapshot.config.inboundApiKeyEnv = "SWITCHMAXXER_GATEWAY_TEST_TOKEN";
    runtimeSnapshot.config.allowUnauthenticatedGateway = false;

    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });

    const unauthorized = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      })
    });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await invokeHandler(gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot), {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer 12345678901234567890123456789012"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      })
    });
    assert.equal(authorized.statusCode, 200);
  });
});

void test("gateway failed-auth limiter normalizes ipv4-mapped ipv6 source addresses into the same bucket", async () => {
  await withEnv({ SWITCHMAXXER_GATEWAY_TEST_TOKEN: "12345678901234567890123456789012" }, async () => {
    const runtimeSnapshot = createBaseRuntimeSnapshot();
    runtimeSnapshot.config.inboundApiKeyEnv = "SWITCHMAXXER_GATEWAY_TEST_TOKEN";
    runtimeSnapshot.config.allowUnauthenticatedGateway = false;

    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const requestOptions = {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      })
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await invokeHandler(handler, {
        ...requestOptions,
        remoteAddress: "127.0.0.1"
      });
      assert.equal(response.statusCode, 401);
      assert.equal(parseErrorCode(response), "unauthorized");
    }

    const blocked = await invokeHandler(handler, {
      ...requestOptions,
      remoteAddress: "::ffff:127.0.0.1"
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseErrorCode(blocked), "auth_rate_limited");
    assert.equal(blocked.headers["retry-after"], "30");
  });
});

void test("gateway failed-auth limiter counts missing Authorization headers toward the same backoff budget", async () => {
  await withEnv({ SWITCHMAXXER_GATEWAY_TEST_TOKEN: "12345678901234567890123456789012" }, async () => {
    const runtimeSnapshot = createBaseRuntimeSnapshot();
    runtimeSnapshot.config.inboundApiKeyEnv = "SWITCHMAXXER_GATEWAY_TEST_TOKEN";
    runtimeSnapshot.config.allowUnauthenticatedGateway = false;

    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const requestOptions = {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      }),
      remoteAddress: "127.0.0.1"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await invokeHandler(handler, requestOptions);
      assert.equal(response.statusCode, 401);
      assert.equal(parseErrorCode(response), "unauthorized");
    }

    const blocked = await invokeHandler(handler, requestOptions);
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseErrorCode(blocked), "auth_rate_limited");
    assert.equal(blocked.headers["retry-after"], "30");
  });
});

void test("gateway anonymous health checks do not reset failed-auth backoff", async () => {
  await withEnv({ SWITCHMAXXER_GATEWAY_TEST_TOKEN: "12345678901234567890123456789012" }, async () => {
    const runtimeSnapshot = createBaseRuntimeSnapshot();
    runtimeSnapshot.config.inboundApiKeyEnv = "SWITCHMAXXER_GATEWAY_TEST_TOKEN";
    runtimeSnapshot.config.allowUnauthenticatedGateway = false;
    runtimeSnapshot.config.allowUnauthenticatedHealth = true;

    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const requestOptions = {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      }),
      remoteAddress: "127.0.0.1"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await invokeHandler(handler, requestOptions);
      assert.equal(response.statusCode, 401);
      assert.equal(parseErrorCode(response), "unauthorized");
    }

    const anonymousHealth = await invokeHandler(handler, {
      method: "GET",
      url: "/health",
      remoteAddress: "127.0.0.1"
    });
    assert.equal(anonymousHealth.statusCode, 200);

    const blocked = await invokeHandler(handler, requestOptions);
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseErrorCode(blocked), "auth_rate_limited");
    assert.equal(blocked.headers["retry-after"], "30");
  });
});

void test("gateway failed-auth limiter ignores spoofed X-Forwarded-For values and keys on the socket source address", async () => {
  await withEnv({ SWITCHMAXXER_GATEWAY_TEST_TOKEN: "12345678901234567890123456789012" }, async () => {
    const runtimeSnapshot = createBaseRuntimeSnapshot();
    runtimeSnapshot.config.inboundApiKeyEnv = "SWITCHMAXXER_GATEWAY_TEST_TOKEN";
    runtimeSnapshot.config.allowUnauthenticatedGateway = false;

    const { gatewayRuntime } = createGatewayRuntimeForTests({
      runtime: runtimeSnapshot
    });
    const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
    const requestOptions = {
      method: "POST",
      url: "/v1/chat/completions",
      body: JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      }),
      remoteAddress: "127.0.0.1"
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await invokeHandler(handler, {
        ...requestOptions,
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${attempt + 1}`
        }
      });
      assert.equal(response.statusCode, 401);
      assert.equal(parseErrorCode(response), "unauthorized");
    }

    const blocked = await invokeHandler(handler, {
      ...requestOptions,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.99"
      }
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(parseErrorCode(blocked), "auth_rate_limited");
    assert.equal(blocked.headers["retry-after"], "30");
  });
});

void test("gateway request handler caps concurrent JSON body parse work across the process", async () => {
  const runtimeSnapshot = createBaseRuntimeSnapshot();
  runtimeSnapshot.config.maxConcurrentJsonParses = 1;

  let resolveFirstParse!: () => void;
  const firstParseGate = new Promise<void>((resolve) => {
    resolveFirstParse = resolve;
  });
  let readCount = 0;
  const { gatewayRuntime } = createGatewayRuntimeForTests({
    runtime: runtimeSnapshot,
    readRequestBodyWithLimit: async () => {
      readCount += 1;

      if (readCount === 1) {
        await firstParseGate;
      }

      return JSON.stringify({
        model: "demo",
        messages: [{ role: "user", content: "hello" }]
      });
    }
  });
  const handler = gatewayRuntime.buildRequestHandlerForTests(runtimeSnapshot);
  const requestOptions = {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...LOCAL_UNAUTHENTICATED_JSON_HEADERS,
      "content-length": "0"
    },
    remoteAddress: "127.0.0.1"
  };

  const first = startHandlerInvocation(handler, requestOptions);
  const blocked = await invokeHandler(handler, requestOptions);

  assert.equal(blocked.statusCode, 503);
  assert.equal(parseErrorCode(blocked), "request_parse_capacity_exceeded");
  assert.equal(readCount, 1);

  resolveFirstParse();
  const firstResponse = await first.promise;
  assert.equal(firstResponse.statusCode, 200);
});
