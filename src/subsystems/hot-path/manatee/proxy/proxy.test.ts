import assert from "node:assert/strict";
import test from "node:test";

import { setRuntimeLogLevelOverride, withLogWriters } from "../../../../platform/logger";
import { bufferResponseWithinLimitForTests } from "./proxy.test-support";
import {
  classifyFetchError,
  classifyUpstreamStatus,
  describeFetchErrorDiagnostics,
  describeTestFailure,
  getAbortReason,
  normalizeTextContent
} from "./proxy";
import { logDebugErrorContext, logDebugUpstreamRequest } from "./proxy-logging";
import { SecretString } from "../../../../platform/secret-string";

type TestSocketError = Error & {
  code?: string;
  errno?: string | number;
  syscall?: string;
  hostname?: string;
};

void test("proxy fetch classification keeps client-facing network failures coarse while preserving timeout semantics", () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  assert.deepEqual(classifyFetchError(new Error("request failed", { cause: abortError })), {
    statusCode: 504,
    message: "Upstream request timed out",
    code: "upstream_timeout"
  });

  assert.deepEqual(classifyFetchError(new Error("dns failed", { cause: { code: "ENOTFOUND" } })), {
    statusCode: 502,
    message: "Could not reach upstream provider",
    code: "upstream_unreachable"
  });

  assert.deepEqual(classifyFetchError(new Error("refused", { cause: { code: "ECONNREFUSED" } })), {
    statusCode: 502,
    message: "Could not reach upstream provider",
    code: "upstream_unreachable"
  });

  assert.deepEqual(classifyFetchError(new Error("reset", { cause: { code: "ECONNRESET" } })), {
    statusCode: 502,
    message: "Could not reach upstream provider",
    code: "upstream_unreachable"
  });

  assert.deepEqual(classifyFetchError(new Error("try again", { cause: { code: "EAI_AGAIN" } })), {
    statusCode: 502,
    message: "Could not reach upstream provider",
    code: "upstream_unreachable"
  });
});

void test("proxy fetch diagnostics preserve low-level socket causes for debug logs", () => {
  const dnsCause: TestSocketError = new Error("getaddrinfo ENOTFOUND api.openai.com");
  dnsCause.code = "ENOTFOUND";
  dnsCause.errno = -3008;
  dnsCause.syscall = "getaddrinfo";
  dnsCause.hostname = "api.openai.com";

  const diagnostics = describeFetchErrorDiagnostics(new TypeError("fetch failed", { cause: dnsCause }));

  assert.equal(diagnostics.error_kind, "dns_not_found");
  assert.equal(diagnostics.error_name, "TypeError");
  assert.equal(diagnostics.error_message, "fetch failed");
  assert.equal(diagnostics.root_cause_message, "getaddrinfo ENOTFOUND api.openai.com");
  assert.equal(diagnostics.socket_code, "ENOTFOUND");
  assert.equal(diagnostics.socket_errno, -3008);
  assert.equal(diagnostics.socket_syscall, "getaddrinfo");
  assert.equal(diagnostics.socket_hostname, "api.openai.com");
  assert.deepEqual(
    diagnostics.cause_chain.map((cause) => cause.code),
    [null, "ENOTFOUND"]
  );
});

void test("proxy abort helper uses the AbortController reason as the single lifecycle source of truth", () => {
  const controller = new AbortController();
  assert.equal(getAbortReason(controller.signal), null);

  controller.abort("streaming_idle_timeout");
  assert.equal(getAbortReason(controller.signal), "streaming_idle_timeout");
});

void test("proxy upstream status classification preserves observability distinctions for 4xx and 5xx responses", () => {
  assert.equal(classifyUpstreamStatus(200), "upstream_ok");
  assert.equal(classifyUpstreamStatus(401), "upstream_unauthorized");
  assert.equal(classifyUpstreamStatus(404), "upstream_not_found");
  assert.equal(classifyUpstreamStatus(429), "upstream_rate_limited");
  assert.equal(classifyUpstreamStatus(502), "upstream_error");
  assert.equal(classifyUpstreamStatus(418), "upstream_http_error");
});

void test("proxy text normalization keeps supported text content and rejects unsupported shapes", () => {
  assert.equal(normalizeTextContent("hello"), "hello");
  assert.equal(
    normalizeTextContent([
      "hello",
      {
        type: "text",
        text: " world"
      }
    ]),
    "hello world"
  );

  assert.throws(
    () => normalizeTextContent({ type: "image", url: "https://example.test/image.png" }),
    /unsupported/i
  );
});

void test("route test failure descriptions stay generic and do not echo upstream urls", () => {
  assert.equal(describeTestFailure(404), "model not found at upstream - check baseUrl and model name");
  assert.equal(describeTestFailure(429), "rate limited");
  assert.equal(describeTestFailure(418), "unexpected upstream response");
});

void test("proxy buffered upstream reader rejects oversized non-streaming bodies before buffering them fully", async () => {
  const response = new Response("x".repeat(32), {
    status: 200,
    headers: {
      "content-length": "32",
      "content-type": "application/json"
    }
  });

  await assert.rejects(
    async () => await bufferResponseWithinLimitForTests(response, 16),
    /maxBufferedUpstreamResponseBytes/
  );
});

void test("proxy buffered upstream reader ignores malformed upstream Content-Length instead of partially parsing it", async () => {
  const response = new Response("ok", {
    status: 200,
    headers: {
      "content-length": "999junk",
      "content-type": "application/json"
    }
  });

  const body = await bufferResponseWithinLimitForTests(response, 16);

  assert.equal(body.toString("utf8"), "ok");
});

void test("proxy buffered upstream reader still enforces the byte limit when malformed Content-Length hides an oversized body", async () => {
  const response = new Response("x".repeat(32), {
    status: 200,
    headers: {
      "content-length": "32junk",
      "content-type": "application/json"
    }
  });

  await assert.rejects(
    async () => await bufferResponseWithinLimitForTests(response, 16),
    /maxBufferedUpstreamResponseBytes/
  );
});

void test("proxy debug upstream-request logging does not expose provider auth state metadata", async () => {
  try {
    setRuntimeLogLevelOverride("debug");
    let output = "";

    await withLogWriters(
      {
        stdout: (message) => {
          output += message;
        }
      },
      async () => {
        logDebugUpstreamRequest(
          {
            requestId: "debug-request",
            caller: "127.0.0.1",
            bareModel: "route_test",
            stream: false,
            apiMode: "openai-completions",
            requestStartedAt: Date.now()
          },
          {
            serviceProvider: "provider-test",
            api_mode: "openai-completions",
            anthropicVersion: null,
            upstreamModelIdFormat: undefined,
            modelCreator: "openai",
            model: "provider-model-test",
            baseUrl: "https://proxy-test.example/v1",
            allowPrivateEndpoints: false,
            apiKeyEnv: null,
            inlineApiKey: new SecretString("test-key"),
            routeTimeoutMs: null,
            timeoutMs: 5_000,
            cost: null,
            modelCost: null
          },
          "https://proxy-test.example/v1/chat/completions?api_key=secret-query-token",
          5_000,
          123,
          "openai-listener",
          "provider-model-test"
        );
      }
    );

    assert.match(output, /event=debug_upstream_request/);
    assert.match(output, /url=https:\/\/proxy-test\.example\/v1\/chat\/completions  query=true/);
    assert.doesNotMatch(output, /auth_attached=/);
    assert.doesNotMatch(output, /test-key/);
    assert.doesNotMatch(output, /secret-query-token/);
    assert.doesNotMatch(output, /api_key=/);
  } finally {
    setRuntimeLogLevelOverride(null);
  }
});

void test("proxy debug error-context logging includes sanitized upstream fetch diagnostics", async () => {
  try {
    setRuntimeLogLevelOverride("debug");
    let output = "";

    const dnsCause: TestSocketError = new Error("getaddrinfo ENOTFOUND api.openai.com Bearer sk-secret-value");
    dnsCause.code = "ENOTFOUND";
    dnsCause.syscall = "getaddrinfo";
    dnsCause.hostname = "api.openai.com";

    await withLogWriters(
      {
        stdout: (message) => {
          output += message;
        }
      },
      async () => {
        logDebugErrorContext(
          "upstream_fetch",
          {
            requestId: "debug-error-request",
            caller: "127.0.0.1",
            bareModel: "route_test",
            stream: false,
            apiMode: "openai-completions",
            requestStartedAt: Date.now()
          },
          "upstream_unreachable",
          {
            serviceProvider: "provider-test",
            api_mode: "openai-completions",
            anthropicVersion: null,
            upstreamModelIdFormat: undefined,
            modelCreator: "openai",
            model: "provider-model-test",
            baseUrl: "https://proxy-test.example/v1",
            allowPrivateEndpoints: false,
            apiKeyEnv: null,
            inlineApiKey: new SecretString("test-key"),
            routeTimeoutMs: null,
            timeoutMs: 5_000,
            cost: null,
            modelCost: null
          },
          describeFetchErrorDiagnostics(new TypeError("fetch failed", { cause: dnsCause }))
        );
      }
    );

    assert.match(output, /event=debug_error_context/);
    assert.match(output, /error_kind=dns_not_found/);
    assert.match(output, /socket_code=ENOTFOUND/);
    assert.match(output, /socket_syscall=getaddrinfo/);
    assert.match(output, /socket_hostname=api\.openai\.com/);
    assert.match(output, /root_cause_message="getaddrinfo ENOTFOUND api\.openai\.com Bearer \*\*\*redacted\*\*\*"/);
    assert.doesNotMatch(output, /sk-secret-value/);
    assert.doesNotMatch(output, /test-key/);
  } finally {
    setRuntimeLogLevelOverride(null);
  }
});
