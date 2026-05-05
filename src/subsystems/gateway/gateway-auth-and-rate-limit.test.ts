import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalGatewayAuthHeaders,
  buildLocalGatewayInboundAuthStateView,
  describeLocalGatewayInboundAuthState,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER,
  LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE,
  resolveLocalGatewayInboundAuthState,
  resolveLocalGatewayInboundAuthToken,
  timingSafeTokenMatches
} from "../hot-path/manatee/runtime/local-gateway-auth";
import { HARD_MAX_JSON_SERIALIZED_BYTES } from "../../platform/json-bounds";
import { requestHasExpectedInboundAuth } from "../hot-path/manatee/runtime/runtime-helpers";
import { parseRateLimitWindowMs } from "../../platform/rate-limit-window";
import { createGlobalRateLimiter, evictRateLimitEntriesOlderThan } from "../hot-path/manatee/runtime/rate-limit";
import { createFailedAuthAttemptLimiter } from "../hot-path/manatee/runtime/auth-rate-limit";
import { advanceWindow } from "../hot-path/manatee/runtime/window-rotation";
import { createGatewayHealthCommands } from "./health-commands";
import { createGatewayHttpRuntimeHelpers } from "../hot-path/manatee/runtime/http-runtime-helpers";
import { isValidSystemdUnitName } from "../config/config-validation";
import { withEnv } from "./runtime.test-support";

void test("advanceWindow preserves the current window when still inside its duration", () => {
  const state = {
    windowStartedAtMs: 1_000,
    requestCount: 2
  };

  const next = advanceWindow(state, 1_500, 1_000, (nextWindowStartedAtMs) => ({
    windowStartedAtMs: nextWindowStartedAtMs,
    requestCount: 0
  }));

  assert.equal(next, state);
  assert.equal(next.requestCount, 2);
});

void test("advanceWindow resets state when the window is empty or expired", () => {
  const emptyWindow = advanceWindow(
    {
      windowStartedAtMs: 0,
      requestCount: 4
    },
    5_000,
    1_000,
    (nextWindowStartedAtMs) => ({
      windowStartedAtMs: nextWindowStartedAtMs,
      requestCount: 0
    })
  );

  assert.deepEqual(emptyWindow, {
    windowStartedAtMs: 5_000,
    requestCount: 0
  });

  const expiredWindow = advanceWindow(
    {
      windowStartedAtMs: 1_000,
      requestCount: 4
    },
    2_500,
    1_000,
    (nextWindowStartedAtMs) => ({
      windowStartedAtMs: nextWindowStartedAtMs,
      requestCount: 0
    })
  );

  assert.deepEqual(expiredWindow, {
    windowStartedAtMs: 2_500,
    requestCount: 0
  });
});

void test("local gateway inbound auth state distinguishes explicit disable, token, and misconfigured env cases", async () => {
  const envVarName = "SWITCHMAXXER_TEST_INBOUND_AUTH";

  await withEnv({ [envVarName]: undefined }, () => {
    assert.deepEqual(resolveLocalGatewayInboundAuthState(null, true), { kind: "disabled_explicit" });
    assert.deepEqual(resolveLocalGatewayInboundAuthState(null, false), {
      kind: "misconfigured",
      reason: "missing_env_name"
    });
    assert.deepEqual(resolveLocalGatewayInboundAuthState(envVarName, false), {
      kind: "misconfigured",
      reason: "missing_token",
      envVar: envVarName
    });
    process.env[envVarName] = "   ";

    assert.deepEqual(resolveLocalGatewayInboundAuthState(envVarName, false), {
      kind: "misconfigured",
      reason: "empty_token",
      envVar: envVarName
    });
    assert.throws(() => resolveLocalGatewayInboundAuthToken(envVarName, false), /is not set or is empty/);

    process.env[envVarName] = "short-token";

    assert.deepEqual(resolveLocalGatewayInboundAuthState(envVarName, false), {
      kind: "misconfigured",
      reason: "short_token",
      envVar: envVarName
    });
    assert.throws(() => resolveLocalGatewayInboundAuthToken(envVarName, false), /at least 32 characters long/);

    process.env[envVarName] = "0123456789abcdef0123456789abcdef";

    assert.deepEqual(resolveLocalGatewayInboundAuthState(envVarName, false), {
      kind: "token",
      token: "0123456789abcdef0123456789abcdef",
      envVar: envVarName
    });
    assert.equal(resolveLocalGatewayInboundAuthToken(envVarName, false), "0123456789abcdef0123456789abcdef");
  });
});

void test("local gateway inbound auth token comparison rejects wrong, empty, and very long candidate tokens", () => {
  const expected = "0123456789abcdef0123456789abcdef";

  assert.equal(timingSafeTokenMatches(expected, expected), true);
  assert.equal(timingSafeTokenMatches("0123456789abcdef0123456789abcdeg", expected), false);
  assert.equal(timingSafeTokenMatches("", expected), false);
  assert.equal(timingSafeTokenMatches("x".repeat(8_192), expected), false);
});

void test("gateway inbound auth rejects malformed Bearer headers with trailing whitespace-separated content", () => {
  const request = {
    headers: {
      authorization: "Bearer 0123456789abcdef0123456789abcdef extra"
    }
  } as unknown as Parameters<typeof requestHasExpectedInboundAuth>[0];

  assert.equal(
    requestHasExpectedInboundAuth(
      request,
      "0123456789abcdef0123456789abcdef",
      timingSafeTokenMatches
    ),
    false
  );
});

void test("gateway inbound auth rejects Bearer headers with trailing whitespace after the token", () => {
  const request = {
    headers: {
      authorization: "Bearer 0123456789abcdef0123456789abcdef   "
    }
  } as unknown as Parameters<typeof requestHasExpectedInboundAuth>[0];

  assert.equal(
    requestHasExpectedInboundAuth(
      request,
      "0123456789abcdef0123456789abcdef",
      timingSafeTokenMatches
    ),
    false
  );
});

void test("gateway inbound auth rejects non-canonical Bearer schemes and separators", () => {
  const expectedToken = "0123456789abcdef0123456789abcdef";
  const cases = [
    "bearer 0123456789abcdef0123456789abcdef",
    "Bearer\t0123456789abcdef0123456789abcdef"
  ];

  for (const authorization of cases) {
    const request = {
      headers: {
        authorization
      }
    } as unknown as Parameters<typeof requestHasExpectedInboundAuth>[0];

    assert.equal(
      requestHasExpectedInboundAuth(
        request,
        expectedToken,
        timingSafeTokenMatches
      ),
      false,
      authorization
    );
  }
});

void test("gateway inbound auth accepts a well-formed Bearer token header", () => {
  const request = {
    headers: {
      authorization: "Bearer 0123456789abcdef0123456789abcdef"
    }
  } as unknown as Parameters<typeof requestHasExpectedInboundAuth>[0];

  assert.equal(
    requestHasExpectedInboundAuth(
      request,
      "0123456789abcdef0123456789abcdef",
      timingSafeTokenMatches
    ),
    true
  );
});

void test("local gateway inbound auth headers include bearer auth only when inbound auth is enabled", async () => {
  const envVarName = "SWITCHMAXXER_TEST_INBOUND_AUTH_HEADERS";

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, () => {
    const enabledHeaders = buildLocalGatewayAuthHeaders(envVarName, false);
    assert.equal(enabledHeaders.get("authorization"), "Bearer 0123456789abcdef0123456789abcdef");

    delete process.env[envVarName];

    const disabledHeaders = buildLocalGatewayAuthHeaders(null, true);
    assert.equal(disabledHeaders.has("authorization"), false);
    assert.equal(
      disabledHeaders.get(LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER),
      LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER_VALUE
    );

    const oneTrustedBoundaryHeaders = buildLocalGatewayAuthHeaders(null, true, true);
    assert.equal(oneTrustedBoundaryHeaders.has("authorization"), false);
    assert.equal(oneTrustedBoundaryHeaders.has(LOCAL_GATEWAY_UNAUTHENTICATED_CLIENT_HEADER), false);
  });
});

void test("local gateway inbound auth headers fail closed when configured env var is missing", async () => {
  const envVarName = "SWITCHMAXXER_TEST_INBOUND_AUTH_MISSING_HEADERS";

  await withEnv({ [envVarName]: undefined }, () => {
    assert.throws(
      () => buildLocalGatewayAuthHeaders(envVarName, false),
      new RegExp(`Gateway inbound auth env var '${envVarName}' is not set or is empty\\.`)
    );
  });
});

void test("local gateway inbound auth state description reports enabled, disabled, and misconfigured views", () => {
  assert.deepEqual(
    describeLocalGatewayInboundAuthState({ kind: "disabled_explicit" }),
    {
      status: "disabled_explicit",
      envVar: null
    }
  );

  assert.deepEqual(
    describeLocalGatewayInboundAuthState({
      kind: "misconfigured",
      reason: "missing_token",
      envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
    }),
    {
      status: "misconfigured",
      envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
    }
  );

  assert.deepEqual(
    describeLocalGatewayInboundAuthState({
      kind: "token",
      token: "0123456789abcdef0123456789abcdef",
      envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
    }),
    {
      status: "enabled",
      envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
    }
  );
});

void test("local gateway inbound auth state view is redacted and includes misconfiguration reasons", () => {
  assert.deepEqual(
    buildLocalGatewayInboundAuthStateView(
      {
        kind: "token",
        token: "0123456789abcdef0123456789abcdef",
        envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
      },
      { formatEnvVarName: (value) => value === null ? null : "(configured)" }
    ),
    {
      status: "enabled",
      env_var: "(configured)",
      reason: null
    }
  );

  assert.deepEqual(
    buildLocalGatewayInboundAuthStateView({
      kind: "misconfigured",
      reason: "short_token",
      envVar: "SWITCHMAXXER_TEST_INBOUND_AUTH"
    }),
    {
      status: "misconfigured",
      env_var: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      reason: "short_token"
    }
  );
});

void test("gateway request body reader accepts a body exactly at the byte limit and rejects a body one byte over", async () => {
  const gatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: () => process.env,
    isNonEmptyCliString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isNonEmptyConfigString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isValidSystemdUnitName,
    defaultSystemdUnit: "switchmaxxer.service",
    maxRequestJsonDepth: 64
  });

  function createAsyncRequest(body: string, contentLength?: string) {
    return {
      headers: typeof contentLength === "string" ? { "content-length": contentLength } : {},
      async *[Symbol.asyncIterator]() {
        yield body;
      }
    } as AsyncIterable<string> & { headers: Record<string, string> };
  }

  const exactBody = "x".repeat(32);
  const exactRequest = createAsyncRequest(exactBody, String(Buffer.byteLength(exactBody)));
  await assert.doesNotReject(async () => {
    const body = await gatewayHttpRuntimeHelpers.readRequestBodyWithLimit(exactRequest as never, 32, 1_000, 1_000);
    assert.equal(body, exactBody);
  });

  const overBody = "x".repeat(33);
  const overRequest = createAsyncRequest(overBody, String(Buffer.byteLength(overBody)));
  await assert.rejects(
    async () => await gatewayHttpRuntimeHelpers.readRequestBodyWithLimit(overRequest as never, 32, 1_000, 1_000),
    /request_body_too_large/
  );

  const malformedLargePrefixRequest = createAsyncRequest("ok", "999junk");
  await assert.doesNotReject(async () => {
    const body = await gatewayHttpRuntimeHelpers.readRequestBodyWithLimit(
      malformedLargePrefixRequest as never,
      32,
      1_000,
      1_000
    );
    assert.equal(body, "ok");
  });

  const malformedOverRequest = createAsyncRequest(overBody, `${Buffer.byteLength(overBody)}junk`);
  await assert.rejects(
    async () => await gatewayHttpRuntimeHelpers.readRequestBodyWithLimit(malformedOverRequest as never, 32, 1_000, 1_000),
    /request_body_too_large/
  );
});

void test("gateway request body reader enforces a total wall-clock deadline in addition to idle timeout", async () => {
  const gatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: () => process.env,
    isNonEmptyCliString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isNonEmptyConfigString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isValidSystemdUnitName,
    defaultSystemdUnit: "switchmaxxer.service",
    maxRequestJsonDepth: 64
  });

  const request = {
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield "x";
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield "y";
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield "z";
    }
  } as AsyncIterable<string> & { headers: Record<string, string> };

  await assert.rejects(
    async () => await gatewayHttpRuntimeHelpers.readRequestBodyWithLimit(request as never, 32, 50, 40),
    /request_body_total_timeout/
  );
});

void test("gateway parsed request body validator accepts valid complex JSON and rejects over-depth or over-size payloads", () => {
  const gatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: () => process.env,
    isNonEmptyCliString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isNonEmptyConfigString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isValidSystemdUnitName,
    defaultSystemdUnit: "switchmaxxer.service",
    maxRequestJsonDepth: 8
  });

  const shallowGatewayHttpRuntimeHelpers = createGatewayHttpRuntimeHelpers({
    getCliEnv: () => process.env,
    isNonEmptyCliString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isNonEmptyConfigString: (value): value is string => typeof value === "string" && value.trim().length > 0,
    isValidSystemdUnitName,
    defaultSystemdUnit: "switchmaxxer.service",
    maxRequestJsonDepth: 4
  });

  const validComplexBody = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are helpful." },
      {
        role: "user",
        content: [
          { type: "text", text: "Summarize this." },
          { type: "text", text: "Keep it short." }
        ]
      }
    ],
    metadata: {
      request_id: "req_123",
      tags: ["demo", "complex"]
    }
  };

  assert.doesNotThrow(() => gatewayHttpRuntimeHelpers.validateParsedRequestBodyShape(validComplexBody, 4_096));

  const exactDepthBody = {
    level1: {
      level2: null
    }
  };
  assert.doesNotThrow(() => shallowGatewayHttpRuntimeHelpers.validateParsedRequestBodyShape(exactDepthBody, 4_096));

  const overDepthBody = {
    level1: {
      level2: {
        level3: {
          level4: null
        }
      }
    }
  };
  assert.throws(
    () => shallowGatewayHttpRuntimeHelpers.validateParsedRequestBodyShape(overDepthBody, 4_096),
    /request_body_structure_too_large/
  );

  const exactSizeBody = { payload: "x".repeat(13) };
  assert.equal(Buffer.byteLength(JSON.stringify(exactSizeBody), "utf8"), 27);
  assert.doesNotThrow(() => gatewayHttpRuntimeHelpers.validateParsedRequestBodyShape(exactSizeBody, 27));

  const overSizeBody = { payload: "x".repeat(14) };
  assert.equal(Buffer.byteLength(JSON.stringify(overSizeBody), "utf8"), 28);
  assert.throws(
    () => gatewayHttpRuntimeHelpers.validateParsedRequestBodyShape(overSizeBody, 27),
    /request_body_structure_too_large/
  );
});

void test("global rate limiter allows up to the configured request count per window and reports retry hints", () => {
  const limiter = createGlobalRateLimiter({
    requests: 2,
    windowMs: 1_000
  });

  assert.equal(limiter.check("caller-a", 1_000).allowed, true);
  assert.equal(limiter.check("caller-a", 1_500).allowed, true);

  const denied = limiter.check("caller-a", 1_750);
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.retryAfterSeconds, 1);
  }

  assert.equal(limiter.check("caller-a", 2_000).allowed, true);
});

void test("global rate limiter keeps separate request budgets per caller", () => {
  const limiter = createGlobalRateLimiter({
    requests: 2,
    windowMs: 1_000
  });

  assert.equal(limiter.check("caller-a", 1_000).allowed, true);
  assert.equal(limiter.check("caller-a", 1_500).allowed, true);
  assert.equal(limiter.check("caller-a", 1_750).allowed, false);
  assert.equal(limiter.check("caller-b", 1_751).allowed, true);
});

void test("global rate limiter can evict stale caller entries by age before count pressure", () => {
  const entries = new Map([
    [
      "stale-caller",
      {
        windowStartedAtMs: 0,
        requestCount: 1,
        lastTouchedAtMs: 0
      }
    ],
    [
      "fresh-caller",
      {
        windowStartedAtMs: 1_500,
        requestCount: 1,
        lastTouchedAtMs: 1_500
      }
    ]
  ]);

  evictRateLimitEntriesOlderThan(entries, 1_000, 1_501);

  assert.equal(entries.has("stale-caller"), false);
  assert.equal(entries.has("fresh-caller"), true);
});

void test("gateway health probe accepts the minimal non-identifying health payload", async () => {
  const originalFetch = globalThis.fetch;
  const healthCommands = createGatewayHealthCommands({
    readLongFlagValue: () => null,
    loadConfig: () => {
      throw new Error("not used in this test");
    },
    loadConfigJsonDocument: () => {
      throw new Error("not used in this test");
    },
    buildLocalGatewayAuthHeaders: () => new Headers(),
    resolveSystemdUnitFromDocument: () => "switchmaxxer.service",
    printUsageError: () => undefined,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    writeJsonSuccessEnvelope: () => undefined,
    writeJsonErrorEnvelope: () => undefined
  });

  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          process_integrity_status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )) as typeof fetch;

    const result = await healthCommands.probeGatewayHealthAtHost("127.0.0.1", 4080, 500);

    assert.equal(result.running, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.probe_host, "127.0.0.1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("gateway health probe rejects oversized JSON response bodies", async () => {
  const originalFetch = globalThis.fetch;
  const healthCommands = createGatewayHealthCommands({
    readLongFlagValue: () => null,
    loadConfig: () => {
      throw new Error("not used in this test");
    },
    loadConfigJsonDocument: () => {
      throw new Error("not used in this test");
    },
    buildLocalGatewayAuthHeaders: () => new Headers(),
    resolveSystemdUnitFromDocument: () => "switchmaxxer.service",
    printUsageError: () => undefined,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    writeJsonSuccessEnvelope: () => undefined,
    writeJsonErrorEnvelope: () => undefined
  });

  try {
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(HARD_MAX_JSON_SERIALIZED_BYTES + 1)
        }
      })) as typeof fetch;

    const result = await healthCommands.probeGatewayHealthAtHost("127.0.0.1", 4080, 500);

    assert.equal(result.running, false);
    assert.match(result.reason ?? "", /response body exceeded/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("gateway health probe brackets IPv6 loopback URLs", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl: string | null = null;
  const healthCommands = createGatewayHealthCommands({
    readLongFlagValue: () => null,
    loadConfig: () => ({}),
    loadConfigJsonDocument: () => {
      throw new Error("not used in this test");
    },
    buildLocalGatewayAuthHeaders: () => new Headers(),
    resolveSystemdUnitFromDocument: () => "switchmaxxer.service",
    printUsageError: () => undefined,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    writeJsonSuccessEnvelope: () => undefined,
    writeJsonErrorEnvelope: () => undefined
  });

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      observedUrl = String(input);

      return new Response(
        JSON.stringify({
          status: "ok",
          process_integrity_status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const result = await healthCommands.probeGatewayHealthAtHost("::1", 4080, 500);

    assert.equal(result.running, true);
    assert.equal(result.probe_host, "::1");
    assert.equal(observedUrl, "http://[::1]:4080/health");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("gateway route-test preflight sends configured inbound auth to /health", async () => {
  const originalFetch = globalThis.fetch;
  let capturedAuthorization: string | null = null;
  const healthCommands = createGatewayHealthCommands({
    readLongFlagValue: () => null,
    loadConfig: () => ({}),
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {
        bind_host: "127.0.0.1",
        port: 4080,
        inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH"
      }
    }),
    buildLocalGatewayAuthHeaders: () => {
      const headers = new Headers();
      headers.set("authorization", "Bearer test-health-token");
      return headers;
    },
    resolveSystemdUnitFromDocument: () => "switchmaxxer.service",
    printUsageError: () => undefined,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    writeJsonSuccessEnvelope: () => undefined,
    writeJsonErrorEnvelope: () => undefined
  });

  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedAuthorization = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({
          status: "ok",
          process_integrity_status: "ok"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const result = await healthCommands.preflightGatewayRouteTests();

    assert.equal(result.ok, true);
    assert.equal(capturedAuthorization, "Bearer test-health-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("rate limit window parsing accepts sub-second and second windows", () => {
  assert.equal(parseRateLimitWindowMs("250ms"), 250);
  assert.equal(parseRateLimitWindowMs("1s"), 1_000);
  assert.equal(parseRateLimitWindowMs("5m"), 5 * 60_000);
  assert.equal(parseRateLimitWindowMs("0s"), null);
  assert.equal(parseRateLimitWindowMs("1d"), null);
});

void test("failed auth limiter escalates to 429 with exponential backoff and resets on success", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000
  });

  assert.deepEqual(limiter.registerFailure("127.0.0.1", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("127.0.0.1", 1_500), { status: "allow_401" });

  const third = limiter.registerFailure("127.0.0.1", 2_000);
  assert.equal(third.status, "blocked");
  if (third.status === "blocked") {
    assert.equal(third.retryAfterSeconds, 1);
  }

  const fourth = limiter.registerFailure("127.0.0.1", 2_500);
  assert.equal(fourth.status, "blocked");
  if (fourth.status === "blocked") {
    assert.equal(fourth.retryAfterSeconds, 2);
  }

  assert.deepEqual(limiter.registerFailure("127.0.0.2", 2_500), { status: "allow_401" });

  limiter.reset("127.0.0.1");
  assert.deepEqual(limiter.registerFailure("127.0.0.1", 3_000), { status: "allow_401" });
});

void test("failed auth limiter evicts older eligible entries under cache pressure", () => {
  const limiter = createFailedAuthAttemptLimiter({
    windowMs: 60_000,
    threshold: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000,
    maxEntries: 3
  });

  assert.deepEqual(limiter.registerFailure("10.0.0.1", 1_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("10.0.0.2", 2_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("10.0.0.3", 3_000), { status: "allow_401" });

  assert.deepEqual(limiter.registerFailure("10.0.0.1", 4_000), { status: "allow_401" });
  assert.deepEqual(limiter.registerFailure("10.0.0.4", 5_000), { status: "allow_401" });

  assert.deepEqual(limiter.registerFailure("10.0.0.2", 6_000), { status: "allow_401" });
  const thirdTouchedAttempt = limiter.registerFailure("10.0.0.1", 7_000);
  assert.equal(thirdTouchedAttempt.status, "blocked");
  if (thirdTouchedAttempt.status === "blocked") {
    assert.equal(thirdTouchedAttempt.retryAfterSeconds, 1);
  }

  const fourthTouchedAttempt = limiter.registerFailure("10.0.0.1", 8_000);
  assert.equal(fourthTouchedAttempt.status, "blocked");
});
