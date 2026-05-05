import assert from "node:assert/strict";
import test from "node:test";

import { SecretString } from "../../platform/secret-string";
import type { RouteConfig } from "../../platform/types";
import {
  applyProviderHeaders,
  copyBufferedResponseHeaders,
  copyResponseHeaders,
  sanitizeHeadersForLogging,
  sanitizeIncomingHeaders
} from "./proxy-headers";
import type { ProxyResponseLike } from "./proxy-forwarding";

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    serviceProvider: "provider-test",
    api_mode: "openai-completions",
    anthropicVersion: null,
    upstreamModelIdFormat: undefined,
    modelCreator: "openai",
    model: "provider-model-test",
    baseUrl: "https://provider.example/v1",
    allowPrivateEndpoints: false,
    apiKeyEnv: null,
    inlineApiKey: new SecretString("provider-secret"),
    cost: null,
    modelCost: null,
    routeTimeoutMs: null,
    timeoutMs: 5_000,
    ...overrides
  };
}

class HeaderCapture {
  public readonly headers = new Map<string, string | number | readonly string[]>();

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

void test("sanitizeIncomingHeaders strips managed, browser-context, and hop-by-hop headers while preserving safe caller metadata", () => {
  const headers = sanitizeIncomingHeaders({
    "accept-encoding": "gzip, br",
    authorization: "Bearer caller-secret",
    connection: "close",
    cookie: "local=session",
    cookie2: "legacy=session",
    host: "localhost:8080",
    "content-length": "99",
    origin: "http://localhost:3000",
    referer: "http://localhost:3000/app",
    referrer: "http://localhost:3000/app",
    "user-agent": "Mozilla/5.0 local-browser",
    "x-switchmaxxer-inspect": "1",
    "x-switchmaxxer-inspect-id": "inspect-1",
    "x-switchmaxxer-inspect-token": "inspect-token",
    "x-request-id": "req-1",
    "x-trace": ["trace-a", "trace-b"]
  });

  assert.equal(headers.get("accept-encoding"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("connection"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("cookie2"), null);
  assert.equal(headers.get("host"), null);
  assert.equal(headers.get("content-length"), null);
  assert.equal(headers.get("origin"), null);
  assert.equal(headers.get("referer"), null);
  assert.equal(headers.get("referrer"), null);
  assert.equal(headers.get("user-agent"), "switchmaxxer-gateway");
  assert.equal(headers.get("x-switchmaxxer-inspect"), null);
  assert.equal(headers.get("x-switchmaxxer-inspect-id"), null);
  assert.equal(headers.get("x-switchmaxxer-inspect-token"), null);
  assert.equal(headers.get("x-request-id"), "req-1");
  assert.equal(headers.get("x-trace"), "trace-a, trace-b");
});

void test("sanitizeIncomingHeaders rejects unsafe forwarded values before they reach upstream", () => {
  assert.throws(
    () =>
      sanitizeIncomingHeaders({
        "x-safe-name": "ok\r\nx-injected: yes"
      }),
    /invalid_header_value/
  );

  assert.throws(
    () =>
      sanitizeIncomingHeaders({
        "x-too-large": "x".repeat(8 * 1024 + 1)
      }),
    /invalid_header_value/
  );
});

void test("applyProviderHeaders attaches provider auth according to upstream API mode", () => {
  const openAiHeaders = new Headers();
  applyProviderHeaders(openAiHeaders, makeRoute());
  assert.equal(openAiHeaders.get("authorization"), "Bearer provider-secret");
  assert.equal(openAiHeaders.get("x-api-key"), null);

  const anthropicHeaders = new Headers();
  applyProviderHeaders(
    anthropicHeaders,
    makeRoute({
      api_mode: "anthropic-messages",
      anthropicVersion: "2024-01-01"
    })
  );
  assert.equal(anthropicHeaders.get("authorization"), null);
  assert.equal(anthropicHeaders.get("x-api-key"), "provider-secret");
  assert.equal(anthropicHeaders.get("anthropic-version"), "2024-01-01");
});

void test("sanitizeHeadersForLogging redacts sensitive provider headers", () => {
  const headers = new Headers({
    authorization: "Bearer provider-secret",
    "x-api-key": "provider-secret",
    "x-request-id": "req-1"
  });

  assert.deepEqual(sanitizeHeadersForLogging(headers), {
    authorization: "***redacted***",
    "x-api-key": "***redacted***",
    "x-request-id": "req-1"
  });
});

void test("copyResponseHeaders drops unsafe, hop-by-hop, and credential-bearing upstream headers", () => {
  const source = new Headers({
    authorization: "Bearer upstream-secret",
    connection: "close",
    "content-type": "application/json",
    forwarded: "for=192.0.2.60;proto=https",
    "set-cookie": "session=secret",
    via: "1.1 upstream-proxy",
    "x-api-key": "secret",
    "x-forwarded-for": "192.0.2.60",
    "x-forwarded-host": "internal.example",
    "x-forwarded-proto": "https",
    "x-safe": "ok"
  });
  const target = new HeaderCapture();

  copyResponseHeaders(source, target as unknown as ProxyResponseLike);

  assert.equal(target.headers.get("content-type"), "application/json");
  assert.equal(target.headers.get("x-safe"), "ok");
  assert.equal(target.headers.has("authorization"), false);
  assert.equal(target.headers.has("connection"), false);
  assert.equal(target.headers.has("forwarded"), false);
  assert.equal(target.headers.has("set-cookie"), false);
  assert.equal(target.headers.has("via"), false);
  assert.equal(target.headers.has("x-api-key"), false);
  assert.equal(target.headers.has("x-forwarded-for"), false);
  assert.equal(target.headers.has("x-forwarded-host"), false);
  assert.equal(target.headers.has("x-forwarded-proto"), false);
});

void test("copyBufferedResponseHeaders omits content-encoding for rewritten buffered bodies", () => {
  const source = new Headers({
    "content-encoding": "gzip",
    "content-type": "application/json"
  });
  const target = new HeaderCapture();

  copyBufferedResponseHeaders(source, target as unknown as ProxyResponseLike);

  assert.equal(target.headers.get("content-type"), "application/json");
  assert.equal(target.headers.has("content-encoding"), false);
});
