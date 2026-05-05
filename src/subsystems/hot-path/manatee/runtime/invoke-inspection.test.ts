import assert from "node:assert/strict";
import test from "node:test";

import { REDACTED_SECRET } from "../../../../platform/secret-string";
import {
  attachInvokeInspectionCapture,
  bindInvokeInspectionCaptureToRequestId,
  createInvokeInspectionCapture,
  INVOKE_INSPECTION_DEFAULT_TTL_MS,
  recordClientToSmxInspectionExchange,
  recordSmxToProviderInspectionExchange,
  removeInvokeInspectionCaptureBindings,
  removeRequestIdInspectionBinding,
  toInvokeInspectionCaptureView
} from "./invoke-inspection";
import { createInvokeInspectionCaptureStore } from "./invoke-inspection-store";

function recordProviderRequest(requestId: string, body: string): void {
  recordSmxToProviderInspectionExchange(requestId, {
    method: "POST",
    url: "https://provider.example.test/v1/chat/completions",
    headers: {},
    body
  });
}

void test("invoke inspection capture cleanup removes only request ids bound to that capture", () => {
  const firstRequest = {};
  const secondRequest = {};
  const firstCapture = createInvokeInspectionCapture("11111111-1111-4111-8111-111111111111", 0);
  const secondCapture = createInvokeInspectionCapture("22222222-2222-4222-8222-222222222222", 0);

  attachInvokeInspectionCapture(firstRequest, firstCapture);
  attachInvokeInspectionCapture(secondRequest, secondCapture);
  bindInvokeInspectionCaptureToRequestId("request-first", firstRequest);
  bindInvokeInspectionCaptureToRequestId("request-second", secondRequest);

  removeInvokeInspectionCaptureBindings(firstCapture);
  recordProviderRequest("request-first", "removed");
  recordProviderRequest("request-second", "kept");

  assert.equal(firstCapture.smxToProvider, null);
  assert.equal(secondCapture.smxToProvider?.body, "kept");

  removeInvokeInspectionCaptureBindings(secondCapture);
});

void test("invoke inspection request-id unbind prevents stale reverse-index cleanup", () => {
  const firstRequest = {};
  const secondRequest = {};
  const firstCapture = createInvokeInspectionCapture("33333333-3333-4333-8333-333333333333", 0);
  const secondCapture = createInvokeInspectionCapture("44444444-4444-4444-8444-444444444444", 0);

  attachInvokeInspectionCapture(firstRequest, firstCapture);
  attachInvokeInspectionCapture(secondRequest, secondCapture);
  bindInvokeInspectionCaptureToRequestId("request-reused", firstRequest);
  removeRequestIdInspectionBinding("request-reused");
  bindInvokeInspectionCaptureToRequestId("request-reused", secondRequest);

  removeInvokeInspectionCaptureBindings(firstCapture);
  recordProviderRequest("request-reused", "still-bound-to-second-capture");

  assert.equal(firstCapture.smxToProvider, null);
  assert.equal(secondCapture.smxToProvider?.body, "still-bound-to-second-capture");

  removeInvokeInspectionCaptureBindings(secondCapture);
});

void test("invoke inspection keeps upstream provider auth redacted even when include_secrets is enabled", () => {
  const request = {};
  const capture = createInvokeInspectionCapture("55555555-5555-4555-8555-555555555555", 0);
  attachInvokeInspectionCapture(request, capture);
  bindInvokeInspectionCaptureToRequestId("request-secret-view", request);
  recordClientToSmxInspectionExchange(request, {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer inbound-secret"
    },
    body: "{}"
  });
  recordSmxToProviderInspectionExchange("request-secret-view", {
    method: "POST",
    url: "https://provider.example.test/v1/chat/completions",
    headers: {
      authorization: "Bearer provider-secret",
      "x-api-key": "provider-api-key"
    },
    body: "{}"
  });

  const view = toInvokeInspectionCaptureView(capture, true);

  assert.equal(view.client_to_smx?.headers["authorization"], "Bearer inbound-secret");
  assert.equal(view.smx_to_provider?.headers["authorization"], REDACTED_SECRET);
  assert.equal(view.smx_to_provider?.headers["x-api-key"], REDACTED_SECRET);

  removeInvokeInspectionCaptureBindings(capture);
});

void test("invoke inspection store actively prunes expired captures and disposes its timer", () => {
  let nowMs = 0;
  let intervalCallback: (() => void) | null = null;
  let observedIntervalMs = 0;
  let unrefCalls = 0;
  let clearCalls = 0;
  let clearedTimer: unknown = null;
  const timer = {
    unref: () => {
      unrefCalls += 1;
    }
  };
  const store = createInvokeInspectionCaptureStore({
    nowMs: () => nowMs,
    setInterval: (callback, intervalMs) => {
      intervalCallback = callback;
      observedIntervalMs = intervalMs;
      return timer;
    },
    clearInterval: (timerToClear) => {
      clearCalls += 1;
      clearedTimer = timerToClear;
    }
  });
  const request = {};
  const { id, capture } = store.allocate();

  attachInvokeInspectionCapture(request, capture);
  bindInvokeInspectionCaptureToRequestId("request-expired-capture", request);
  nowMs = INVOKE_INSPECTION_DEFAULT_TTL_MS + 1;

  assert.equal(observedIntervalMs, Math.floor(INVOKE_INSPECTION_DEFAULT_TTL_MS / 2));
  assert.equal(unrefCalls, 1);
  const runInterval = intervalCallback as (() => void) | null;
  assert.equal(typeof runInterval, "function");

  runInterval?.();
  recordProviderRequest("request-expired-capture", "should-not-record-after-prune");

  assert.equal(store.consume(id, "wrong-token"), null);
  assert.equal(capture.smxToProvider, null);

  store.dispose();
  store.dispose();

  assert.equal(clearCalls, 1);
  assert.equal(clearedTimer, timer);
});

void test("invoke inspection store prunes oldest captures over its total byte budget", () => {
  const store = createInvokeInspectionCaptureStore({
    autoPruneIntervalMs: null,
    maxTotalBytes: 1_200
  });
  const firstRequest = {};
  const secondRequest = {};
  const first = store.allocate();
  const second = store.allocate();

  attachInvokeInspectionCapture(firstRequest, first.capture);
  attachInvokeInspectionCapture(secondRequest, second.capture);
  bindInvokeInspectionCaptureToRequestId("request-byte-budget-first", firstRequest);
  bindInvokeInspectionCaptureToRequestId("request-byte-budget-second", secondRequest);
  recordProviderRequest("request-byte-budget-first", "a".repeat(700));
  recordProviderRequest("request-byte-budget-second", "b".repeat(700));

  store.prune();
  recordProviderRequest("request-byte-budget-first", "should-not-record-after-byte-prune");

  assert.equal(store.consume(first.id, first.readToken), null);
  assert.equal(first.capture.smxToProvider?.body, "a".repeat(700));
  assert.equal(store.consume(second.id, second.readToken), second.capture);

  removeInvokeInspectionCaptureBindings(second.capture);
});

void test("invoke inspection store requires the read token before consuming a capture", () => {
  const store = createInvokeInspectionCaptureStore({
    autoPruneIntervalMs: null
  });
  const { id, readToken, capture } = store.allocate();

  assert.match(readToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.consume(id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), null);
  assert.equal(store.consume(id, readToken), capture);
  assert.equal(store.consume(id, readToken), null);
});
