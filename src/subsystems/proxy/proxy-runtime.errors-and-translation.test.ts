import assert from "node:assert/strict";
import baseTest, { type TestContext } from "node:test";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { setRuntimeLogLevelOverride, withLogWriters } from "../../platform/logger";
import { SecretString } from "../../platform/secret-string";
import type { RouteConfig } from "../../platform/types";
import {
  proxyChatCompletion,
  translateAnthropicEventToOpenAiChunks,
  translateAnthropicResponse
} from "./proxy";
import { TestProxyResponse, makeProxyConfig, makeProxyRequest, type ProxyResponse } from "./proxy.test-support";

type TestFn = (t: TestContext) => Promise<void> | void;
type TestOptions = {
  concurrency?: boolean;
  only?: boolean;
  plan?: number;
  signal?: AbortSignal;
  skip?: boolean | string;
  timeout?: number;
  todo?: boolean | string;
};

const queuedTests: Array<{ name: string; options?: TestOptions; fn: TestFn }> = [];

const test: typeof baseTest = ((name, optionsOrFn, maybeFn) => {
  if (typeof optionsOrFn === "function") {
    queuedTests.push({ name: name as string, options: { concurrency: false }, fn: optionsOrFn });
    return Promise.resolve(undefined) as ReturnType<typeof baseTest>;
  }

  queuedTests.push({
    name: name as string,
    options: { ...optionsOrFn, concurrency: false },
    fn: maybeFn as TestFn
  });
  return Promise.resolve(undefined) as ReturnType<typeof baseTest>;
}) as typeof baseTest;

void test("proxy forwards upstream overload responses with retry-after while reserving 502 for malformed translated upstream bodies", async () => {
  const originalFetch = globalThis.fetch;
  const openAiConfig = makeProxyConfig("openai-completions");
  openAiConfig.routes["route_test"]!.allowPrivateEndpoints = true;
  const anthropicConfig = makeProxyConfig("anthropic-messages");
  anthropicConfig.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        `${JSON.stringify({
          error: {
            message: "provider overloaded"
          }
        })}\n`,
        {
          status: 529,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": "17"
          }
        }
      );
    }) as typeof fetch;

    const forwardedResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      forwardedResponse,
      openAiConfig,
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

    assert.equal(forwardedResponse.statusCode, 529);
    assert.equal(forwardedResponse.getHeader("retry-after"), "17");
    assert.match(forwardedResponse.body.toString("utf8"), /provider overloaded/);

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response("not valid json", {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "9"
        }
      });
    }) as typeof fetch;

    const translatedFailureResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      translatedFailureResponse,
      anthropicConfig,
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

    assert.equal(translatedFailureResponse.statusCode, 502);
    assert.match(translatedFailureResponse.body.toString("utf8"), /response_delivery_failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxy returns 413 when request rewriting grows the body beyond max_payload_size", async () => {
  const config = makeProxyConfig("openai-completions");
  config.routes["route_test"]!.allowPrivateEndpoints = true;
  const parsedBody: Parameters<typeof proxyChatCompletion>[3] = {
    model: "route_test",
    messages: [{ role: "user", content: "hello" }],
    stream: false
  };
  const rawBody = JSON.stringify(parsedBody);
  config.maxPayloadSize = Buffer.byteLength(rawBody);
  let upstreamCalled = false;
  const fetchImpl = (async (): Promise<Response> => {
    upstreamCalled = true;
    return new Response("{}\n", {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  }) as typeof fetch;

  const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
  await proxyChatCompletion(
    makeProxyRequest(),
    response,
    config,
    parsedBody,
    rawBody,
    { fetchImpl }
  );

  const payload = JSON.parse(response.body.toString("utf8")) as {
    error?: {
      code?: string;
      message?: string;
    };
  };
  assert.equal(response.statusCode, 413);
  assert.equal(payload.error?.code, APP_ERROR_CODES.payloadTooLarge);
  assert.match(payload.error?.message ?? "", /max_payload_size/);
  assert.equal(upstreamCalled, false);
});

void test("proxy classifies wrapped fetch socket errors by cause code", async () => {
  const originalFetch = globalThis.fetch;
  const config = makeProxyConfig("openai-completions");
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch failed", {
        cause: { code: "ENOTFOUND" }
      });
    }) as typeof fetch;

    const dnsFailureResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      dnsFailureResponse,
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

    assert.equal(dnsFailureResponse.statusCode, 502);
    assert.match(dnsFailureResponse.body.toString("utf8"), /"code":"upstream_unreachable"/);
    assert.match(dnsFailureResponse.body.toString("utf8"), /Could not reach upstream provider/);

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch failed", {
        cause: { code: "ECONNREFUSED" }
      });
    }) as typeof fetch;

    const refusedResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      refusedResponse,
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

    assert.equal(refusedResponse.statusCode, 502);
    assert.match(refusedResponse.body.toString("utf8"), /"code":"upstream_unreachable"/);
    assert.match(refusedResponse.body.toString("utf8"), /Could not reach upstream provider/);

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch failed", {
        cause: { code: "ECONNRESET" }
      });
    }) as typeof fetch;

    const resetResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await proxyChatCompletion(
      makeProxyRequest(),
      resetResponse,
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

    assert.equal(resetResponse.statusCode, 502);
    assert.match(resetResponse.body.toString("utf8"), /"code":"upstream_unreachable"/);
    assert.match(resetResponse.body.toString("utf8"), /Could not reach upstream provider/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("Anthropic translation helpers produce OpenAI-compatible buffered and streaming shapes", () => {
  const route: RouteConfig = {
    serviceProvider: "provider-a",
    api_mode: "anthropic-messages",
    anthropicVersion: "2023-06-01",
    modelCreator: "anthropic",
    model: "claude-test-model",
    baseUrl: "https://api.example.test/v1/messages",
    allowPrivateEndpoints: false,
    apiKeyEnv: null,
    inlineApiKey: new SecretString("test-key"),
    cost: null,
    modelCost: null,
    routeTimeoutMs: null,
    timeoutMs: 15000
  };

  const translatedResponse = translateAnthropicResponse(
    {
      id: "msg_123",
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 3,
        output_tokens: 5
      }
    },
    route.model
  );

  assert.equal(translatedResponse["model"], "claude-test-model");
  assert.equal(
    ((translatedResponse["choices"] as Array<Record<string, unknown>>)[0]?.["finish_reason"]),
    "length"
  );
  assert.equal(
    (((translatedResponse["usage"] as Record<string, unknown>)["total_tokens"])),
    8
  );
  assert.equal(
    ((((translatedResponse["choices"] as Array<Record<string, unknown>>)[0]?.["message"]) as Record<
      string,
      unknown
    >)["content"]),
    "hello"
  );

  const translatedToolResponse = translateAnthropicResponse(
    {
      id: "msg_tool",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Checking weather." },
        {
          type: "tool_use",
          id: "toolu_123",
          name: "get_weather",
          input: { city: "Chicago" }
        }
      ],
      usage: {
        input_tokens: 2,
        output_tokens: 4
      }
    },
    route.model
  );

  const translatedToolChoice = (translatedToolResponse["choices"] as Array<Record<string, unknown>>)[0] ?? {};
  const translatedToolMessage = (translatedToolChoice["message"] as Record<string, unknown>) ?? {};
  const translatedToolCalls = (translatedToolMessage["tool_calls"] as Array<Record<string, unknown>>) ?? [];

  assert.equal(translatedToolChoice["finish_reason"], "tool_calls");
  assert.equal(translatedToolMessage["content"], "Checking weather.");
  assert.equal(translatedToolCalls.length, 1);
  assert.equal(translatedToolCalls[0]?.["id"], "toolu_123");
  assert.equal(translatedToolCalls[0]?.["type"], "function");
  assert.equal(
    (((translatedToolCalls[0]?.["function"]) as Record<string, unknown>)["name"]),
    "get_weather"
  );
  assert.equal(
    (((translatedToolCalls[0]?.["function"]) as Record<string, unknown>)["arguments"]),
    "{\"city\":\"Chicago\"}"
  );

  const state = {
    placeholderResponseId: "switchmaxxer-placeholder-stream",
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map<number, number>()
  };
  const startChunks = translateAnthropicEventToOpenAiChunks(
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_abc","type":"message","role":"assistant"}}',
    route.model,
    state
  );
  const textChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
    route.model,
    state
  );
  const stopChunks = translateAnthropicEventToOpenAiChunks(
    'event: message_stop\ndata: {"type":"message_stop"}',
    route.model,
    state
  );

  assert.equal(startChunks.length, 1);
  assert.match(startChunks[0] ?? "", /chat\.completion\.chunk/);
  assert.match(startChunks[0] ?? "", /"id":"msg_abc"/);
  assert.equal(textChunks.length, 1);
  assert.match(textChunks[0] ?? "", /"id":"msg_abc"/);
  assert.match(textChunks[0] ?? "", /"content":"hello"/);
  assert.deepEqual(stopChunks, ["data: [DONE]\n\n"]);

  const toolState = {
    placeholderResponseId: "switchmaxxer-placeholder-tool-stream",
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map<number, number>()
  };
  const toolStartChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_stream","name":"get_weather","input":{}}}',
    route.model,
    toolState
  );
  const toolMessageDeltaChunks = translateAnthropicEventToOpenAiChunks(
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    route.model,
    toolState
  );
  const toolJsonDeltaChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Chicago\\"}"}}',
    route.model,
    toolState
  );
  const toolStopChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    route.model,
    toolState
  );
  const toolJsonDeltaAfterStopChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ignored\\":true}"}}',
    route.model,
    toolState
  );
  const crlfState = {
    placeholderResponseId: "switchmaxxer-placeholder-crlf-stream",
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map<number, number>()
  };
  const crlfChunks = translateAnthropicEventToOpenAiChunks(
    'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"crlf"}}',
    route.model,
    crlfState
  );
  const stopSequenceState = {
    placeholderResponseId: "switchmaxxer-placeholder-stop-sequence-stream",
    announcedRole: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map<number, number>()
  };
  const stopSequenceChunks = translateAnthropicEventToOpenAiChunks(
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"stop_sequence"}}',
    route.model,
    stopSequenceState
  );
  const pingChunks = translateAnthropicEventToOpenAiChunks(
    'event: ping\ndata: {"type":"ping"}',
    route.model,
    stopSequenceState
  );

  assert.equal(toolStartChunks.length, 2);
  assert.match(toolStartChunks[0] ?? "", /"role":"assistant"/);
  assert.match(toolStartChunks[1] ?? "", /"tool_calls"/);
  assert.match(toolStartChunks[1] ?? "", /"name":"get_weather"/);
  assert.match(toolStartChunks[1] ?? "", /"arguments":""/);
  assert.equal(toolMessageDeltaChunks.length, 1);
  assert.match(toolMessageDeltaChunks[0] ?? "", /"finish_reason":"tool_calls"/);
  assert.equal(toolJsonDeltaChunks.length, 1);
  assert.match(toolJsonDeltaChunks[0] ?? "", /"tool_calls"/);
  assert.match(toolJsonDeltaChunks[0] ?? "", /"arguments":"\{\\\"city\\\":\\\"Chicago\\\"\}"/);
  assert.deepEqual(toolStopChunks, []);
  assert.deepEqual(toolJsonDeltaAfterStopChunks, []);
  assert.equal(crlfChunks.length, 2);
  assert.match(crlfChunks[1] ?? "", /"content":"crlf"/);
  assert.equal(stopSequenceChunks.length, 1);
  assert.match(stopSequenceChunks[0] ?? "", /"finish_reason":"stop"/);
  assert.deepEqual(pingChunks, []);

  assert.throws(
    () =>
      translateAnthropicResponse(
        {
          id: "msg_unsupported",
          stop_reason: "end_turn",
          content: [{ type: "image", source: { type: "base64" } }],
          usage: {
            input_tokens: 1,
            output_tokens: 1
          }
        },
        route.model
      ),
    /unsupported upstream content block type 'image'/i
  );
});

void test("proxy rejects unsupported translated request content instead of coercing it to text", async () => {
  const originalFetch = globalThis.fetch;
  const stdout: string[] = [];

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch should not be called for unsupported translated content");
    }) as typeof fetch;
    setRuntimeLogLevelOverride("debug");

    const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
    await withLogWriters(
      {
        stdout: (chunk) => {
          stdout.push(chunk);
        }
      },
      async () => {
        await proxyChatCompletion(
          makeProxyRequest(),
          response,
          makeProxyConfig("anthropic-messages"),
          {
            model: "route_test",
            messages: [
              {
                role: "user",
                content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }]
              }
            ],
            stream: false
          },
          JSON.stringify({
            model: "route_test",
            messages: [
              {
                role: "user",
                content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }]
              }
            ],
            stream: false
          })
        );
      }
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.body.toString("utf8"), new RegExp(APP_ERROR_CODES.unsupportedContentShape));
    assert.match(stdout.join(""), /image_url/);
  } finally {
    setRuntimeLogLevelOverride(null);
    globalThis.fetch = originalFetch;
  }
});

void test("proxy translates Anthropic thinking plus tool_use responses for OpenAI clients", async () => {
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.baseUrl = "https://127.0.0.1/messages";
  config.routes["route_test"]!.allowPrivateEndpoints = true;

  const fetchImpl = (async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        id: "msg_minimax_tool",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7-highspeed",
        content: [
          {
            thinking: "The model decided to call exec.",
            signature: "test-signature",
            type: "thinking"
          },
          {
            type: "tool_use",
            id: "call_function_1",
            name: "exec",
            input: {
              command: "pwd"
            }
          }
        ],
        usage: {
          input_tokens: 216,
          output_tokens: 59
        },
        stop_reason: "tool_use"
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      }
    );
  }) as typeof fetch;

  const request = {
    model: "route_test",
    messages: [{ role: "user", content: "Call exec with pwd." }],
    tools: [
      {
        type: "function",
        function: {
          name: "exec",
          description: "Run a shell command.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string"
              }
            },
            required: ["command"]
          }
        }
      }
    ],
    stream: false
  };

  const response = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
  await proxyChatCompletion(
    makeProxyRequest(),
    response,
    config,
    request,
    JSON.stringify(request),
    { fetchImpl }
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;
  const firstChoice = ((payload["choices"] as Array<Record<string, unknown>>)[0]) ?? {};
  const firstMessage = (firstChoice["message"] as Record<string, unknown>) ?? {};
  const toolCalls = (firstMessage["tool_calls"] as Array<Record<string, unknown>>) ?? [];

  assert.equal(firstChoice["finish_reason"], "tool_calls");
  assert.equal(firstMessage["content"], null);
  assert.deepEqual(toolCalls[0]?.["function"], {
    name: "exec",
    arguments: "{\"command\":\"pwd\"}"
  });
  assert.doesNotMatch(response.body.toString("utf8"), /test-signature|The model decided/);
});

void test("proxy preserves a full OpenAI client to Anthropic provider tool-use loop", async () => {
  const config = makeProxyConfig("anthropic-messages");
  config.routes["route_test"]!.baseUrl = "https://127.0.0.1/messages";
  config.routes["route_test"]!.allowPrivateEndpoints = true;
  const capturedBodies: Array<Record<string, unknown>> = [];
  let requestCount = 0;

  const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    requestCount += 1;

    assert.equal(init?.method, "POST");
    assert.ok(typeof init?.body === "string");
    capturedBodies.push(JSON.parse(init.body) as Record<string, unknown>);

    if (requestCount === 1) {
      return new Response(
        JSON.stringify({
          id: "msg_tool_request",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: "tool_use",
          content: [
            {
              type: "text",
              text: "I need to check that."
            },
            {
              type: "tool_use",
              id: "toolu_lookup_1",
              name: "lookup_project",
              input: {
                query: "switchmaxxer"
              }
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 4
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        id: "msg_final",
        type: "message",
        role: "assistant",
        model: "claude-test",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: "Switchmaxxer is a local-first LLM gateway."
          }
        ],
        usage: {
          input_tokens: 14,
          output_tokens: 8
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      }
    );
  }) as typeof fetch;

  const firstRequest = {
    model: "route_test",
    messages: [
      {
        role: "user",
        content: "What is Switchmaxxer?"
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup_project",
          description: "Look up project facts.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string"
              }
            },
            required: ["query"]
          }
        }
      }
    ],
    tool_choice: {
      type: "function",
      function: {
        name: "lookup_project"
      }
    },
    stream: false
  };

  const firstResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
  await proxyChatCompletion(
    makeProxyRequest(),
    firstResponse,
    config,
    firstRequest,
    JSON.stringify(firstRequest),
    { fetchImpl }
  );

  assert.equal(firstResponse.statusCode, 200);
  const firstPayload = JSON.parse(firstResponse.body.toString("utf8")) as Record<string, unknown>;
  const firstChoice = ((firstPayload["choices"] as Array<Record<string, unknown>>)[0]) ?? {};
  const firstMessage = (firstChoice["message"] as Record<string, unknown>) ?? {};
  const toolCalls = (firstMessage["tool_calls"] as Array<Record<string, unknown>>) ?? [];

  assert.equal(firstChoice["finish_reason"], "tool_calls");
  assert.equal(firstMessage["content"], "I need to check that.");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.["id"], "toolu_lookup_1");
  assert.equal(toolCalls[0]?.["type"], "function");
  assert.deepEqual(toolCalls[0]?.["function"], {
    name: "lookup_project",
    arguments: "{\"query\":\"switchmaxxer\"}"
  });

  assert.deepEqual(capturedBodies[0]?.["tools"], [
    {
      name: "lookup_project",
      description: "Look up project facts.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string"
          }
        },
        required: ["query"]
      }
    }
  ]);
  assert.deepEqual(capturedBodies[0]?.["tool_choice"], {
    type: "tool",
    name: "lookup_project"
  });

  const secondRequest = {
    model: "route_test",
    messages: [
      {
        role: "user",
        content: "What is Switchmaxxer?"
      },
      {
        role: "assistant",
        content: "I need to check that.",
        tool_calls: [
          {
            id: "toolu_lookup_1",
            type: "function",
            function: {
              name: "lookup_project",
              arguments: "{\"query\":\"switchmaxxer\"}"
            }
          }
        ]
      },
      {
        role: "tool",
        tool_call_id: "toolu_lookup_1",
        content: "Switchmaxxer is a local-first LLM gateway."
      }
    ],
    tools: firstRequest.tools,
    stream: false
  };

  const secondResponse = new TestProxyResponse() as TestProxyResponse & ProxyResponse;
  await proxyChatCompletion(
    makeProxyRequest(),
    secondResponse,
    config,
    secondRequest,
    JSON.stringify(secondRequest),
    { fetchImpl }
  );

  assert.equal(secondResponse.statusCode, 200);
  const secondPayload = JSON.parse(secondResponse.body.toString("utf8")) as Record<string, unknown>;
  const secondChoice = ((secondPayload["choices"] as Array<Record<string, unknown>>)[0]) ?? {};
  const secondMessage = (secondChoice["message"] as Record<string, unknown>) ?? {};

  assert.equal(secondChoice["finish_reason"], "stop");
  assert.equal(secondMessage["content"], "Switchmaxxer is a local-first LLM gateway.");

  assert.deepEqual(capturedBodies[1]?.["messages"], [
    {
      role: "user",
      content: "What is Switchmaxxer?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I need to check that."
        },
        {
          type: "tool_use",
          id: "toolu_lookup_1",
          name: "lookup_project",
          input: {
            query: "switchmaxxer"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_lookup_1",
          content: "Switchmaxxer is a local-first LLM gateway."
        }
      ]
    }
  ]);
  assert.equal(requestCount, 2);
});

void baseTest("proxy-runtime errors and translation", async (t) => {
  for (const queuedTest of queuedTests) {
    if (typeof queuedTest.options === "undefined") {
      await t.test(queuedTest.name, queuedTest.fn);
      continue;
    }

    await t.test(queuedTest.name, queuedTest.options, queuedTest.fn);
  }
});
