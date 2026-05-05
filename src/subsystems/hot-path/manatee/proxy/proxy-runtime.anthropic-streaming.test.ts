import assert from "node:assert/strict";
import baseTest from "node:test";

import { createManagedTestServer, createTrackedTimeoutRegistry } from "../../../../platform/test-resource-helpers";
import type { AppConfig } from "../../../../platform/types";
import { proxyAnthropicMessage, proxyChatCompletion } from "./proxy";
import { TestProxyResponse, makeProxyConfig, makeProxyRequest, type ProxyResponse } from "./proxy.test-support";

const test: typeof baseTest = ((name, optionsOrFn, maybeFn) => {
  if (typeof optionsOrFn === "function") {
    return baseTest(name, { concurrency: false }, optionsOrFn);
  }

  return baseTest(name, { ...optionsOrFn, concurrency: false }, maybeFn!);
}) as typeof baseTest;

class ClientClosingProxyResponse extends TestProxyResponse {
  private writeCount = 0;

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.body = Buffer.concat([this.body, buffer]);
    this.headersSent = true;
    this.writeCount += 1;

    if (this.writeCount === 1) {
      queueMicrotask(() => {
        this.emit("close");
      });
    }

    callback();
  }
}

void test("proxyAnthropicMessage forwards buffered anthropic requests with anthropic-version header", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders: Headers | null = null;
  let capturedBody = "";
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body ?? "");

      return new Response(
        `${JSON.stringify({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "provider-model-test",
          content: [
            {
              type: "text",
              text: "hello from anthropic upstream"
            }
          ],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 3,
            output_tokens: 4
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

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: false
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(capturedUrl, "https://8.8.8.8/messages");
    assert.ok(capturedHeaders);
    assert.equal((capturedHeaders as Headers).get("x-api-key"), "test-key");
    assert.equal((capturedHeaders as Headers).get("anthropic-version"), "2023-06-01");
    assert.equal((capturedHeaders as Headers).get("accept"), "application/json");
    assert.equal(JSON.parse(capturedBody).model, "provider-model-test");
    assert.equal(response.statusCode, 200);
    assert.match(response.body.toString("utf8"), /hello from anthropic upstream/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyAnthropicMessage rejects routes that are incompatible with the Anthropic listener", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("openai-completions");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch should not be called for an incompatible route");
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: false
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.body.toString("utf8"), /route_incompatible_with_listener/);
    assert.match(response.body.toString("utf8"), /Anthropic listener/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyAnthropicMessage streams anthropic event-stream responses through unchanged", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("event: message_start\n"));
            controller.enqueue(Buffer.from('data: {"type":"message_start"}\n\n'));
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

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.getHeader("content-length"), undefined);
    assert.match(response.body.toString("utf8"), /message_start/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyChatCompletion translates anthropic tool streams with one terminal done chunk", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_tool"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"private"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_exec","name":"exec","input":{}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\": \\"pwd\\"}"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ].join(""),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "Call exec with pwd." }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const responseText = response.body.toString("utf8");
    const terminalDoneCount = responseText.match(/data: \[DONE\]/g)?.length ?? 0;

    assert.equal(response.statusCode, 200);
    assert.equal(terminalDoneCount, 1);
    assert.match(responseText, /"name":"exec","arguments":""/);
    assert.match(responseText, /"arguments":"\{\\\"command\\\": \\\"pwd\\\"\}"/);
    assert.doesNotMatch(responseText, /private/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyAnthropicMessage cancels the upstream stream when the client response closes mid-stream", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;
  let upstreamCancelled = false;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("event: message_start\n"));
            controller.enqueue(Buffer.from('data: {"type":"message_start"}\n\n'));
          },
          cancel() {
            upstreamCancelled = true;
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    const response = new ClientClosingProxyResponse() as ClientClosingProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body.toString("utf8"), /message_start/);
    assert.equal(upstreamCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyChatCompletion rejects oversized anthropic SSE events before forwarding partial output", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    ...makeProxyConfig("anthropic-messages"),
    streamMaxEventBytes: 64,
    streamMaxTotalBytes: 1_024,
    streamMaxLifetimeMs: 1_000
  };
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from(`event: message_start\ndata: ${"x".repeat(256)}`));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const parsedError = JSON.parse(response.body.toString("utf8")) as { error: { code: string; message: string } };
    assert.equal(response.statusCode, 502);
    assert.equal(parsedError.error.code, "upstream_stream_event_oversized");
    assert.match(parsedError.error.message, /streamMaxEventBytes/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyChatCompletion rejects anthropic streams that exceed the configured total byte budget", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    ...makeProxyConfig("anthropic-messages"),
    streamMaxEventBytes: 1_024,
    streamMaxTotalBytes: 64,
    streamMaxLifetimeMs: 1_000
  };
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from(`event: message_start\ndata: ${"x".repeat(128)}`));
            controller.close();
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const parsedError = JSON.parse(response.body.toString("utf8")) as { error: { code: string; message: string } };
    assert.equal(response.statusCode, 502);
    assert.equal(parsedError.error.code, "upstream_stream_oversized");
    assert.match(parsedError.error.message, /streamMaxTotalBytes/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyChatCompletion tears down anthropic streams when a malformed SSE event arrives mid-stream", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      const body = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_bad","type":"message","role":"assistant","model":"claude-test-model"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta"',
      ].join("");

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const responseText = response.body.toString("utf8");
    assert.equal(response.statusCode, 200);
    assert.match(responseText, /chat\.completion\.chunk/);
    assert.doesNotMatch(responseText, /\[DONE\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test(
  "proxyChatCompletion fails closed when an anthropic stream closes mid-SSE-event after partial output",
  { concurrency: false },
  async () => {
  const server = createManagedTestServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8"
    });
    response.end(
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_partial","type":"message","role":"assistant","model":"claude-test-model"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"cut-off"}}'
      ].join("")
    );
  });

  try {
    const address = await server.listen();

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const baseConfig = makeProxyConfig("anthropic-messages");
    const baseRoute = baseConfig.routes["route_test"]!;
    const config: AppConfig = {
      ...baseConfig,
      routes: {
        route_test: {
          ...baseRoute,
          baseUrl: `http://127.0.0.1:${address.port}`,
          allowPrivateEndpoints: true
        }
      }
    };
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody)
    );

    const responseText = response.body.toString("utf8");
    assert.equal(response.statusCode, 200);
    assert.match(responseText, /chat\.completion\.chunk/);
    assert.doesNotMatch(responseText, /\[DONE\]/);
  } finally {
    await server.close();
  }
  }
);

void test(
  "proxyChatCompletion rejects anthropic streams that advertise SSE headers but send only garbage",
  { concurrency: false },
  async () => {
  const server = createManagedTestServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8"
    });
    response.end("this is not valid sse framing or event data");
  });

  try {
    const address = await server.listen();

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const baseConfig = makeProxyConfig("anthropic-messages");
    const baseRoute = baseConfig.routes["route_test"]!;
    const config: AppConfig = {
      ...baseConfig,
      routes: {
        route_test: {
          ...baseRoute,
          baseUrl: `http://127.0.0.1:${address.port}`,
          allowPrivateEndpoints: true
        }
      }
    };
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody)
    );

    const parsedError = JSON.parse(response.body.toString("utf8")) as { error: { code: string; message: string } };
    assert.equal(response.statusCode, 502);
    assert.equal(parsedError.error.code, "response_delivery_failed");
    assert.match(parsedError.error.message, /Could not deliver upstream response/);
  } finally {
    await server.close();
  }
  }
);

void test("proxyChatCompletion completes anthropic streams cleanly when the upstream closes after headers but before any data", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response("", {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const responseText = response.body.toString("utf8");
    assert.equal(response.statusCode, 200);
    assert.match(responseText, /\[DONE\]/);
    assert.equal(response.getHeader("content-type"), "text/event-stream; charset=utf-8");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyChatCompletion enforces an absolute anthropic stream lifetime even when the upstream stays active", async () => {
  const originalFetch = globalThis.fetch;
  const timeouts = createTrackedTimeoutRegistry();
  const config = {
    ...makeProxyConfig("anthropic-messages"),
    streamIdleTimeoutMs: 1_000,
    streamMaxLifetimeMs: 10,
    streamMaxEventBytes: 1_024,
    streamMaxTotalBytes: 1_024
  };
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from("event: message_start\n"));
            timeouts.schedule(() => {
              try {
                controller.close();
              } catch {
                // Ignore close-after-cancel races in the test stream.
              }
            }, 50);
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        }
      );
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    const parsedError = JSON.parse(response.body.toString("utf8")) as { error: { code: string; message: string } };
    assert.equal(response.statusCode, 502);
    assert.equal(parsedError.error.code, "upstream_stream_lifetime_exceeded");
    assert.match(parsedError.error.message, /streamMaxLifetimeMs/);
  } finally {
    timeouts.clearAll();
    globalThis.fetch = originalFetch;
  }
});

void test(
  "proxyChatCompletion rejects anthropic streams whose sustained byte rate falls below the configured minimum",
  { concurrency: false },
  async () => {
  const server = createManagedTestServer((_request, response, timers) => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8"
    });

    for (const delayMs of [20, 40, 60]) {
      timers.schedule(() => {
        try {
          response.write("x");
        } catch {
          // Ignore writes after the client tears down the connection.
        }
      }, delayMs);
    }
  });

  try {
    const address = await server.listen();

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const baseConfig = makeProxyConfig("anthropic-messages");
    const baseRoute = baseConfig.routes["route_test"]!;
    const config: AppConfig = {
      ...baseConfig,
      routes: {
        route_test: {
          ...baseRoute,
          baseUrl: `http://127.0.0.1:${address.port}`,
          allowPrivateEndpoints: true
        }
      },
      streamIdleTimeoutMs: 1_000,
      streamMaxLifetimeMs: 1_000,
      streamMinBytesPerSecond: 100,
      streamRateWindowMs: 50,
      streamMaxEventBytes: 1_024,
      streamMaxTotalBytes: 1_024
    };
    const parsedBody = {
      model: "route_test",
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyChatCompletion(
      makeProxyRequest(),
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody)
    );

    const parsedError = JSON.parse(response.body.toString("utf8")) as { error: { code: string; message: string } };
    assert.equal(response.statusCode, 502);
    assert.equal(parsedError.error.code, "upstream_stream_rate_too_low");
    assert.match(parsedError.error.message, /streamMinBytesPerSecond/);
  } finally {
    await server.close();
  }
  }
);

void test("proxyAnthropicMessage forwards upstream anthropic errors without requiring live credentials", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        `${JSON.stringify({
          type: "error",
          error: {
            type: "overloaded_error",
            message: "anthropic overloaded"
          }
        })}\n`,
        {
          status: 529,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": "11"
          }
        }
      );
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: false
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(response.statusCode, 529);
    assert.equal(response.getHeader("retry-after"), "11");
    assert.match(response.body.toString("utf8"), /anthropic overloaded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxyAnthropicMessage buffers upstream anthropic errors before streaming", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  const upstreamError = {
    type: "error",
    error: {
      type: "overloaded_error",
      message: "anthropic overloaded"
    }
  };

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(`${JSON.stringify(upstreamError)}\n`, {
        status: 529,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "11"
        }
      });
    }) as typeof fetch;

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    const request = makeProxyRequest();
    request.url = "/anthropic/v1/messages";

    const parsedBody = {
      model: "route_test",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
      stream: true
    };

    await proxyAnthropicMessage(
      request,
      response,
      config,
      parsedBody,
      JSON.stringify(parsedBody),
      {
        fetchImpl: globalThis.fetch
      }
    );

    assert.equal(response.statusCode, 529);
    assert.equal(response.getHeader("content-type"), "application/json; charset=utf-8");
    assert.equal(response.getHeader("retry-after"), "11");
    assert.deepEqual(JSON.parse(response.body.toString("utf8")), upstreamError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
