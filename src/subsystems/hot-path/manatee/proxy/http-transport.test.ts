import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import test from "node:test";

import { fetchStreamingWithSwitchmaxxerTransport, fetchWithSwitchmaxxerTransport } from "./http-transport";
import { createUpstreamUrl } from "./upstream-url";

void test("createUpstreamUrl normalizes shared upstream paths consistently", () => {
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
    createUpstreamUrl(
      "https://azure.example.test/openai/deployments/demo/chat/completions?api-version=2024-02-15-preview",
      "openai-completions"
    ),
    "https://azure.example.test/openai/deployments/demo/chat/completions?api-version=2024-02-15-preview"
  );
});

void test("switchmaxxer transport composes caller abort signals with timeouts", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal;
      assert.ok(signal, "expected transport to pass a composed signal");
      assert.equal(init?.redirect, "manual");

      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }

        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });

      return new Response("unreachable", { status: 500 });
    }) as typeof fetch;

    const callerController = new AbortController();
    const fetchPromise = fetchWithSwitchmaxxerTransport(
      "https://example.invalid/test",
      {
        method: "GET",
        signal: callerController.signal
      },
      {
        timeoutMs: 60_000
      }
    );
    callerController.abort();
    await assert.rejects(fetchPromise, /Abort|aborted/i);

    const streamingController = new AbortController();
    const streamingPromise = fetchStreamingWithSwitchmaxxerTransport(
      "https://example.invalid/stream",
      {
        method: "GET",
        signal: streamingController.signal
      },
      {
        timeoutMs: 60_000
      }
    );
    streamingController.abort();
    await assert.rejects(streamingPromise, /Abort|aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport returns upstream redirects without following them", async () => {
  let followedPrivateTarget = false;
  let leakedPrivateAuthorization: string | undefined;

  const server = http.createServer((request, response) => {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    if (request.url === "/redirect") {
      response.writeHead(307, {
        location: `http://127.0.0.1:${address.port}/private-target`
      });
      response.end("redirect");
      return;
    }

    if (request.url === "/private-target") {
      followedPrivateTarget = true;
      leakedPrivateAuthorization = request.headers.authorization;
      response.statusCode = 200;
      response.end("private");
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetchWithSwitchmaxxerTransport(
      `http://127.0.0.1:${address.port}/redirect`,
      {
        method: "POST",
        body: "hello",
        headers: {
          authorization: "Bearer provider-secret"
        }
      },
      {
        timeoutMs: 5_000
      }
    );

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `http://127.0.0.1:${address.port}/private-target`);
    assert.equal(await response.text(), "redirect");
    assert.equal(followedPrivateTarget, false);
    assert.equal(leakedPrivateAuthorization, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});

void test("switchmaxxer transport dials the pinned validated IP instead of re-resolving the hostname at connect time", async () => {
  const originalRequest = https.request;
  let lookupInvoked = false;
  let allLookupInvoked = false;

  try {
    Object.defineProperty(https, "request", {
      configurable: true,
      writable: true,
      value: ((
        url: string | URL,
        options: {
          lookup?: (
            hostname: string,
            options: { all?: boolean; family?: number },
            callback: (
              error: Error | null,
              address: string | Array<{ address: string; family: number }>,
              family?: number
            ) => void
          ) => void;
        },
        responseCallback?: (response: Readable & {
          headers: Record<string, string>;
          statusCode?: number;
          statusMessage?: string;
        }) => void
      ) => {
        assert.equal(new URL(String(url)).hostname, "provider.example");
        assert.ok(options.lookup, "expected pinned transport to override DNS lookup");

        const request = new EventEmitter() as EventEmitter & {
          end: () => void;
          destroy: (error?: Error) => void;
        };
        request.end = () => {
          options.lookup?.("provider.example", { all: true, family: 0 }, (error, addresses) => {
            assert.equal(error, null);
            assert.deepEqual(addresses, [{ address: "151.101.1.140", family: 4 }]);
            allLookupInvoked = true;
          });
          options.lookup?.("provider.example", { family: 0 }, (error, address, family) => {
            assert.equal(error, null);
            assert.equal(address, "151.101.1.140");
            assert.equal(family, 4);
            lookupInvoked = true;

            const response = Readable.from([Buffer.from("ok", "utf8")]) as Readable & {
              headers: Record<string, string>;
              statusCode?: number;
              statusMessage?: string;
            };
            response.headers = {
              "content-type": "text/plain; charset=utf-8"
            };
            response.statusCode = 200;
            response.statusMessage = "OK";
            responseCallback?.(response);
          });
        };
        request.destroy = (error?: Error) => {
          if (error) {
            request.emit("error", error);
          }
        };

        return request;
      }) as typeof https.request
    });

    const response = await fetchWithSwitchmaxxerTransport(
      "https://provider.example/v1/chat/completions",
      {
        method: "POST"
      },
      {
        timeoutMs: 5_000,
        pinnedDnsResolution: {
          hostname: "provider.example",
          address: "151.101.1.140",
          family: 4
        }
      }
    );

    assert.equal(lookupInvoked, true);
    assert.equal(allLookupInvoked, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    Object.defineProperty(https, "request", {
      configurable: true,
      writable: true,
      value: originalRequest
    });
  }
});

void test("switchmaxxer transport does not retry upstream response-status failures for POST requests", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;
      return new Response("temporary upstream failure", {
        status: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = await fetchWithSwitchmaxxerTransport(
      "https://example.invalid/test",
      {
        method: "POST"
      },
      {
        timeoutMs: 5_000
      }
    );

    assert.equal(attempts, 1);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), "temporary upstream failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport does not retry POST transport failures by default", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;
      throw Object.assign(new Error("fetch failed"), {
        cause: {
          code: "ECONNREFUSED"
        }
      });
    }) as typeof fetch;

    await assert.rejects(
      async () =>
        await fetchWithSwitchmaxxerTransport(
          "https://example.invalid/test",
          {
            method: "POST"
          },
          {
            timeoutMs: 5_000
          }
        ),
      /fetch failed/i
    );

    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport retries pre-response POST transport failures when an idempotency key is present", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let retryPolicy: string | null = null;
  let duplicateRisk: string | null = null;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error("fetch failed"), {
          cause: {
            code: "ECONNREFUSED"
          }
        });
      }

      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = await fetchWithSwitchmaxxerTransport(
      "https://example.invalid/test",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "buffered-retry-safe-1"
        }
      },
      {
        timeoutMs: 5_000,
        retry: {
          onRetry: (details) => {
            retryPolicy = details.retryPolicy;
            duplicateRisk = details.duplicateRisk;
          }
        }
      }
    );

    assert.equal(attempts, 2);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(retryPolicy, "idempotency_key");
    assert.equal(duplicateRisk, "idempotency_key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport does not retry non-retryable upstream response failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;
      return new Response("bad request", {
        status: 400,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = await fetchWithSwitchmaxxerTransport(
      "https://example.invalid/test",
      {
        method: "POST"
      },
      {
        timeoutMs: 5_000
      }
    );

    assert.equal(attempts, 1);
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "bad request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport ignores malformed Retry-After delta seconds instead of partially parsing them", async () => {
  const originalFetch = globalThis.fetch;

  try {
    for (const retryAfter of ["0010", "10junk"]) {
      let attempts = 0;
      let reportedDelayMs = -1;

      globalThis.fetch = (async (): Promise<Response> => {
        attempts += 1;

        if (attempts === 1) {
          return new Response("retry", {
            status: 503,
            headers: {
              "retry-after": retryAfter
            }
          });
        }

        return new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        });
      }) as typeof fetch;

      const response = await fetchWithSwitchmaxxerTransport(
        "https://example.invalid/test",
        {
          method: "GET"
        },
        {
          timeoutMs: 1_000,
          retry: {
            maxRetries: 1,
            baseDelayMs: 1,
            maxBackoffMs: 1_000,
            onRetry: (details) => {
              reportedDelayMs = details.nextDelayMs;
            }
          }
        }
      );

      assert.equal(attempts, 2);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "ok");
      assert.equal(reportedDelayMs, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer transport explicit retry policy clamps retry delay to maxBackoff and remaining deadline", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let reportedDelayMs = 0;
  let retryPolicy: string | null = null;
  let duplicateRisk: string | null = null;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error("fetch failed"), {
          cause: {
            code: "ECONNREFUSED"
          }
        });
      }

      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const startedAt = Date.now();
    const response = await fetchWithSwitchmaxxerTransport(
      "https://example.invalid/test",
      {
        method: "POST"
      },
      {
        timeoutMs: 250,
        retry: {
          maxRetries: 1,
          baseDelayMs: 150,
          maxBackoffMs: 25,
          onRetry: (details) => {
            reportedDelayMs = details.nextDelayMs;
            retryPolicy = details.retryPolicy;
            duplicateRisk = details.duplicateRisk;
          }
        }
      }
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(attempts, 2);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(reportedDelayMs, 25);
    assert.equal(retryPolicy, "explicit");
    assert.equal(duplicateRisk, "caller_accepted");
    assert.ok(elapsedMs < 250, `expected bounded retry delay, got elapsed=${elapsedMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer streaming transport does not retry POST transport failures without an idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;
      throw Object.assign(new Error("fetch failed"), {
        cause: {
          code: "ECONNREFUSED"
        }
      });
    }) as typeof fetch;

    await assert.rejects(
      async () =>
        await fetchStreamingWithSwitchmaxxerTransport(
          "https://example.invalid/stream",
          {
            method: "POST"
          },
          {
            timeoutMs: 5_000
          }
        ),
      /fetch failed/i
    );

    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("switchmaxxer streaming transport retries pre-response POST transport failures when an idempotency key is present", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    globalThis.fetch = (async (): Promise<Response> => {
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error("fetch failed"), {
          cause: {
            code: "ECONNREFUSED"
          }
        });
      }

      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const response = await fetchStreamingWithSwitchmaxxerTransport(
      "https://example.invalid/stream",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "stream-retry-safe-1"
        }
      },
      {
        timeoutMs: 5_000
      }
    );

    assert.equal(attempts, 2);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
