import assert from "node:assert/strict";
import test from "node:test";

import { SecretString } from "../../../platform/secret-string";
import type { ProxyRequestContext, RouteConfig } from "../../../platform/types";
import type { GatewayObservationInput } from "../../observability/gateway";
import { createManateeObservationEmitter } from "./observation-emit";

function makeContext(): ProxyRequestContext {
  return {
    requestId: "req-manatee-observation",
    apiMode: "openai-completions",
    bareModel: "demo",
    caller: "127.0.0.1",
    stream: false,
    requestStartedAt: Date.parse("2026-05-12T00:00:00.000Z")
  };
}

function makeRoute(): RouteConfig {
  return {
    serviceProvider: "provider",
    model: "provider-model",
    api_mode: "openai-completions",
    anthropicVersion: null,
    modelCreator: "openai",
    baseUrl: "https://example.test/v1/chat/completions",
    allowPrivateEndpoints: false,
    apiKeyEnv: null,
    inlineApiKey: new SecretString("test-key"),
    routeTimeoutMs: null,
    timeoutMs: 5_000,
    cost: null,
    modelCost: null
  };
}

void test("Manatee observation emitter records typed observations through the observability module", () => {
  const recorded: GatewayObservationInput[] = [];
  const emitter = createManateeObservationEmitter({
    recordGatewayObservation: (input) => {
      recorded.push(input);
    },
    recordGatewayFailureObservation: () => {
      throw new Error("unexpected failure observation");
    }
  });

  emitter.emitObservation({
    kind: "auth_decision",
    requestId: "req-auth-denied",
    sourceIp: "127.0.0.1",
    method: "POST",
    pathname: "/v1/chat/completions",
    outcome: "denied_bad_token",
    backoffApplied: true,
    retryAfterSeconds: 3,
    statusCode: 401,
    reason: "bad_token",
    message: "Inbound auth token was rejected."
  });

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    context: {
      requestId: "req-auth-denied",
      caller: "127.0.0.1",
      bareModel: "",
      stream: false,
      apiMode: "openai-completions",
      requestStartedAt: recorded[0]?.context.requestStartedAt
    },
    kind: "error",
    event: "auth_failed",
    stage: "ingress",
    outcome: "rejected",
    status_code: 401,
    attributes: {
      source_ip: "127.0.0.1",
      method: "POST",
      path: "/v1/chat/completions",
      reason: "bad_token",
      retry_after_seconds: 3
    },
    message: "Inbound auth token was rejected."
  });
  assert.equal(typeof recorded[0]?.context.requestStartedAt, "number");
});

void test("Manatee observation emitter records legacy gateway observations through the observability module", () => {
  const context = makeContext();
  const route = makeRoute();
  const recorded: GatewayObservationInput[] = [];
  const emitter = createManateeObservationEmitter({
    recordGatewayObservation: (input) => {
      recorded.push(input);
    },
    recordGatewayFailureObservation: () => {
      throw new Error("unexpected failure observation");
    }
  });

  emitter.emitLegacyGatewayObservation({
    context,
    route,
    kind: "measurement",
    event: "request_received",
    stage: "ingress"
  });

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.context, context);
  assert.equal(recorded[0]?.route, route);
  assert.equal(recorded[0]?.event, "request_received");
});

void test("Manatee observation emitter records legacy failure observations through the observability module", () => {
  const context = makeContext();
  const route = makeRoute();
  const failures: Array<{
    stage: string;
    context: ProxyRequestContext;
    reason: string;
    route?: RouteConfig | null;
    attributes?: Record<string, unknown>;
  }> = [];
  const emitter = createManateeObservationEmitter({
    recordGatewayObservation: () => {
      throw new Error("unexpected gateway observation");
    },
    recordGatewayFailureObservation: (stage, failureContext, reason, failureRoute, attributes) => {
      failures.push({
        stage,
        context: failureContext,
        reason,
        route: failureRoute,
        attributes
      });
    }
  });

  emitter.emitLegacyGatewayFailureObservation("upstream_fetch", context, "provider_timeout", route, {
    retry: false
  });

  assert.deepEqual(failures, [
    {
      stage: "upstream_fetch",
      context,
      reason: "provider_timeout",
      route,
      attributes: {
        retry: false
      }
    }
  ]);
});
