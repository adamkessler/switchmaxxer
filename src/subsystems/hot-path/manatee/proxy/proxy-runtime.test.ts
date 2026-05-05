import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import baseTest from "node:test";

import { loadConfig } from "../../../config/config";
import { APP_ERROR_CODES } from "../../../../platform/error-codes";
import { ProviderAuthMisconfiguredError, resolveRouteApiKey } from "../../../config/provider-auth";
import { splitExistingConfigFileForTests } from "../../../config/config-file.test-support";
import { SecretString } from "../../../../platform/secret-string";
import { proxyChatCompletion } from "./proxy";
import { copyResponseHeaders } from "./proxy-headers";
import { TestProxyResponse, makeProxyConfig, makeProxyRequest, type ProxyResponse } from "./proxy.test-support";
import { createUpstreamUrl } from "./upstream-url";

const test: typeof baseTest = ((name, optionsOrFn, maybeFn) => {
  if (typeof optionsOrFn === "function") {
    return baseTest(name, { concurrency: false }, optionsOrFn);
  }

  return baseTest(name, { ...optionsOrFn, concurrency: false }, maybeFn!);
}) as typeof baseTest;

void test("proxy chat completion uses explicit upstream model id format instead of provider-name heuristics", async () => {
  const originalFetch = globalThis.fetch;
  const capturedModels: string[] = [];
  const passthroughConfig = makeProxyConfig("openai-completions", {
    serviceProvider: "openrouter_custom",
    upstreamModelIdFormat: undefined
  });
  passthroughConfig.routes["route_test"]!.allowPrivateEndpoints = true;
  const creatorModelConfig = makeProxyConfig("openai-completions", {
    serviceProvider: "provider-test",
    upstreamModelIdFormat: "creator/model"
  });
  creatorModelConfig.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      capturedModels.push(String(parsedBody["model"]));

      return new Response(
        `${JSON.stringify({
          id: "chatcmpl-explicit-model-id-format",
          object: "chat.completion",
          created: 1,
          model: String(parsedBody["model"]),
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "ok"
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
      );
    }) as typeof fetch;

    await proxyChatCompletion(
      makeProxyRequest(),
      new TestProxyResponse() as TestProxyResponse & ProxyResponse,
      passthroughConfig,
      {
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      }),
      {
        fetchImpl: globalThis.fetch
      }
    );

    await proxyChatCompletion(
      makeProxyRequest(),
      new TestProxyResponse() as TestProxyResponse & ProxyResponse,
      creatorModelConfig,
      {
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      }),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.deepEqual(capturedModels, ["provider-model-test", "openai/provider-model-test"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxy owns upstream response encoding instead of forwarding caller accept-encoding", async () => {
  const originalFetch = globalThis.fetch;
  const capturedAcceptEncodings: Array<string | null> = [];
  const config = makeProxyConfig("openai-completions");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedAcceptEncodings.push(new Headers(init?.headers).get("accept-encoding"));

      return new Response(
        `${JSON.stringify({
          id: "chatcmpl-response-encoding",
          object: "chat.completion",
          created: 1,
          model: "provider-model-test",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "ok"
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
      );
    }) as typeof fetch;

    const request = makeProxyRequest();
    request.headers["accept-encoding"] = "gzip, br";

    await proxyChatCompletion(
      request,
      new TestProxyResponse() as TestProxyResponse & ProxyResponse,
      config,
      {
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      }),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.deepEqual(capturedAcceptEncodings, ["identity"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("createUpstreamUrl preserves queries and composes shared endpoint shapes", () => {
  assert.equal(
    createUpstreamUrl("https://api.example.test/v1/", "openai-completions"),
    "https://api.example.test/v1/chat/completions"
  );
  assert.equal(
    createUpstreamUrl("https://api.example.test/anthropic/", "anthropic-messages"),
    "https://api.example.test/anthropic/v1/messages"
  );
  assert.equal(
    createUpstreamUrl("https://api.example.test/v1/messages?foo=bar", "anthropic-messages"),
    "https://api.example.test/v1/messages?foo=bar"
  );
  assert.equal(
    createUpstreamUrl("https://api.example.test/api/messages-service", "anthropic-messages"),
    "https://api.example.test/api/messages-service/messages"
  );
  assert.equal(
    createUpstreamUrl("https://api.example.test/chat/completions-v2", "openai-completions"),
    "https://api.example.test/chat/completions-v2/chat/completions"
  );
});

void test("proxy response headers keep content-length for buffered responses and strip it for streaming responses", async () => {
  const originalFetch = globalThis.fetch;
  const bufferedConfig = makeProxyConfig("openai-completions");
  bufferedConfig.routes["route_test"]!.allowPrivateEndpoints = true;
  const streamingConfig = makeProxyConfig("openai-completions");
  streamingConfig.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        `${JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: "provider-model-test",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "hello from upstream"
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 4,
            total_tokens: 7
          }
        })}\n`,
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-encoding": "gzip"
          }
        }
      );
    }) as typeof fetch;

    const bufferedResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      bufferedResponse,
      bufferedConfig,
      {
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      }),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(bufferedResponse.getHeader("content-length"), Buffer.byteLength(bufferedResponse.body));

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('data: {"id":"evt-1"}\n\n'));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "content-length": "999"
          }
        }
      );
    }) as typeof fetch;

    const streamingResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      streamingResponse,
      streamingConfig,
      {
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: true
      },
      JSON.stringify({
        model: "route_test",
        messages: [{ role: "user", content: "hello" }],
        stream: true
      }),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(streamingResponse.getHeader("content-length"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxy response header copying strips cookies, auth-like headers, and invalid upstream header metadata", () => {
  const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
  const source = {
    entries: function* (): IterableIterator<[string, string]> {
      yield ["content-type", "application/json; charset=utf-8"];
      yield ["set-cookie", "session=upstream"];
      yield ["authorization", "Bearer upstream-secret"];
      yield ["proxy-authorization", "Basic abc123"];
      yield ["x-api-key", "upstream-key"];
      yield ["x-unsafe-value", "hello\nworld"];
      yield ["bad name", "still-nope"];
      yield ["connection", "keep-alive"];
    }
  } as Headers;

  copyResponseHeaders(source, response);

  assert.equal(response.getHeader("content-type"), "application/json; charset=utf-8");
  assert.equal(response.getHeader("set-cookie"), undefined);
  assert.equal(response.getHeader("authorization"), undefined);
  assert.equal(response.getHeader("proxy-authorization"), undefined);
  assert.equal(response.getHeader("x-api-key"), undefined);
  assert.equal(response.getHeader("x-unsafe-value"), undefined);
  assert.equal(response.getHeader("bad name"), undefined);
  assert.equal(response.getHeader("connection"), undefined);
});

void test("proxy rejects inbound header values containing control or non-printable characters before forwarding upstream", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      fetchCalled = true;
      throw new Error("fetch should not be called for invalid headers");
    }) as typeof fetch;

    const invalidHeaderCases: Array<{
      name: string;
      value: string | string[];
    }> = [
      { name: "carriage-return-only scalar header", value: "hello\rx-evil: yes" },
      { name: "newline-only scalar header", value: "hello\nx-evil: yes" },
      { name: "CRLF scalar header", value: "hello\r\nx-evil: yes" },
      { name: "null-byte scalar header", value: "hello\0world" },
      { name: "unicode next-line scalar header", value: "hello\u0085world" },
      { name: "unicode line-separator scalar header", value: "hello\u2028world" },
      { name: "oversized printable scalar header", value: "x".repeat(8 * 1024 + 1) },
      { name: "multi-value header array", value: ["safe", "bad\nvalue"] }
    ];

    for (const testCase of invalidHeaderCases) {
      const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
      const request = makeProxyRequest();
      request.headers["x-test-header"] = testCase.value;

      await proxyChatCompletion(
        request,
        response,
        makeProxyConfig("openai-completions"),
        {
          model: "route_test",
          messages: [{ role: "user", content: "hello" }],
          stream: false
        },
        JSON.stringify({
          model: "route_test",
          messages: [{ role: "user", content: "hello" }],
          stream: false
        })
      );

      assert.equal(fetchCalled, false, `fetch should not run for ${testCase.name}`);
      assert.equal(response.statusCode, 400, `expected 400 for ${testCase.name}`);
      assert.match(
        response.body.toString("utf8"),
        new RegExp(APP_ERROR_CODES.invalidHeaderValue),
        `expected ${APP_ERROR_CODES.invalidHeaderValue} for ${testCase.name}`
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxy resolves provider api_key_env on demand after startup validation", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-provider-auth-env-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY";
  const originalValue = process.env[envVarName];
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    process.env[envVarName] = "provider-secret";

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4080,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {
            provider_a: {
              endpoint: "https://api.example.com/v1",
              api_key_env: envVarName,
              api_mode: "openai-completions"
            }
          },
          models: {
            model_a: {
              display_name: "Model A",
              model_creator: "example"
            }
          },
          routes: {
            route_a: {
              model: "model_a",
              service_provider: "provider_a",
              provider_model_id: "provider-model-a",
              display_name: "Route A"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    const config = loadConfig(configPath);
    assert.equal(config.routes["route_a"]?.apiKeyEnv, envVarName);
    assert.equal(config.routes["route_a"]?.inlineApiKey, null);

    delete process.env[envVarName];
    globalThis.fetch = (async (): Promise<Response> => {
      fetchCalled = true;
      throw new Error("fetch should not be called when provider auth is missing at request time");
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      {
        model: "route_a",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: "route_a",
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    );

    assert.equal(fetchCalled, false);
    assert.equal(response.statusCode, 500);
    assert.match(response.body.toString("utf8"), /invalid_provider_auth/);
    assert.match(response.body.toString("utf8"), /Upstream provider auth is misconfigured\./);
    assert.doesNotMatch(response.body.toString("utf8"), new RegExp(envVarName));
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("route_not_found response bounds echoed model names", async () => {
  const originalFetch = globalThis.fetch;
  const longModel = "x".repeat(10_000);

  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called for unknown routes");
    };

    const response = new TestProxyResponse();
    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      makeProxyConfig("openai-completions"),
      {
        model: longModel,
        messages: [{ role: "user", content: "hello" }],
        stream: false
      },
      JSON.stringify({
        model: longModel,
        messages: [{ role: "user", content: "hello" }],
        stream: false
      })
    );

    const payload = JSON.parse(response.body.toString("utf8")) as {
      error?: { message?: string; code?: string };
    };
    const message = payload.error?.message ?? "";

    assert.equal(response.statusCode, 404);
    assert.equal(payload.error?.code, "route_not_found");
    assert.ok(message.length < 180);
    assert.match(message, /^No route found for model '/);
    assert.ok(!message.includes(longModel));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("provider api_key_env treats whitespace-only env values as empty at startup and request time", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-provider-auth-whitespace-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY_WHITESPACE";
  const originalValue = process.env[envVarName];

  try {
    process.env[envVarName] = "   ";

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4080,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {
            provider_a: {
              endpoint: "https://api.example.com/v1",
              api_key_env: envVarName,
              api_mode: "openai-completions"
            }
          },
          models: {
            model_a: {
              display_name: "Model A",
              model_creator: "example"
            }
          },
          routes: {
            route_a: {
              model: "model_a",
              service_provider: "provider_a",
              provider_model_id: "provider-model-a",
              display_name: "Route A"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    assert.throws(
      () => loadConfig(configPath),
      new RegExp(`requires environment variable '${envVarName}', but it is not set or is empty`)
    );

    assert.throws(
      () =>
        resolveRouteApiKey({
          serviceProvider: "provider_a",
          api_mode: "openai-completions",
          anthropicVersion: null,
          upstreamModelIdFormat: "passthrough",
          modelCreator: "example",
          model: "model_a",
          baseUrl: "https://api.example.com/v1",
          allowPrivateEndpoints: false,
          apiKeyEnv: envVarName,
          inlineApiKey: null,
          cost: null,
          modelCost: null,
          routeTimeoutMs: null,
          timeoutMs: 15000
        }),
      (error) => {
        assert.ok(error instanceof ProviderAuthMisconfiguredError);
        assert.equal(error.envVar, envVarName);
        assert.match(error.message, /is not set or is empty/);
        return true;
      }
    );
  } finally {
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("provider auth rejects env var values containing invalid HTTP header characters at startup and request time", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-provider-auth-invalid-charset-"));
  const configPath = path.join(tempDir, "config.json");
  const envVarName = "SWITCHMAXXER_TEST_PROVIDER_KEY_INVALID_CHARSET";
  const originalValue = process.env[envVarName];

  try {
    process.env[envVarName] = "abc\r\nX-Admin: 1";

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          bind_host: "127.0.0.1",
          port: 4080,
          timeout_ms: 15000,
          stream_idle_timeout_ms: 120000,
          max_connections: 200,
          max_payload_size: 4000000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {
            provider_a: {
              endpoint: "https://api.example.com/v1",
              api_key_env: envVarName,
              api_mode: "openai-completions"
            }
          },
          models: {
            model_a: {
              display_name: "Model A",
              model_creator: "example"
            }
          },
          routes: {
            route_a: {
              model: "model_a",
              service_provider: "provider_a",
              provider_model_id: "provider-model-a",
              display_name: "Route A"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    chmodSync(configPath, 0o600);
    splitExistingConfigFileForTests(configPath);

    assert.throws(
      () => loadConfig(configPath),
      new RegExp(`requires environment variable '${envVarName}', but it contains invalid HTTP header characters`)
    );

    assert.throws(
      () =>
        resolveRouteApiKey({
          serviceProvider: "provider_a",
          api_mode: "openai-completions",
          anthropicVersion: null,
          upstreamModelIdFormat: "passthrough",
          modelCreator: "example",
          model: "model_a",
          baseUrl: "https://api.example.com/v1",
          allowPrivateEndpoints: false,
          apiKeyEnv: envVarName,
          inlineApiKey: null,
          cost: null,
          modelCost: null,
          routeTimeoutMs: null,
          timeoutMs: 15000
        }),
      (error) => {
        assert.ok(error instanceof ProviderAuthMisconfiguredError);
        assert.equal(error.envVar, envVarName);
        assert.equal(error.code, "invalid_api_key_charset");
        assert.match(error.message, /contains invalid header characters/);
        return true;
      }
    );
  } finally {
    if (typeof originalValue === "string") {
      process.env[envVarName] = originalValue;
    } else {
      delete process.env[envVarName];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("provider auth rejects inline api keys containing invalid HTTP header characters", () => {
  assert.throws(
    () =>
      resolveRouteApiKey({
        serviceProvider: "provider_a",
        api_mode: "openai-completions",
        anthropicVersion: null,
        upstreamModelIdFormat: "passthrough",
        modelCreator: "example",
        model: "model_a",
        baseUrl: "https://api.example.com/v1",
        allowPrivateEndpoints: false,
        apiKeyEnv: null,
        inlineApiKey: new SecretString("abc\r\nX-Admin: 1"),
        cost: null,
        modelCost: null,
        routeTimeoutMs: null,
        timeoutMs: 15000
      }),
    (error) => {
      assert.ok(error instanceof ProviderAuthMisconfiguredError);
      assert.equal(error.envVar, null);
      assert.equal(error.code, "invalid_api_key_charset");
      assert.match(error.message, /inline api_key contains invalid header characters/);
      return true;
    }
  );
});
