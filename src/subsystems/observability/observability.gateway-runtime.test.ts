import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPendingGatewayObservationWorkerWriteForTests,
  flushGatewayObservationQueueForTests,
  getPendingGatewayObservationWorkerWriteCountForTests,
  resetGatewayObservabilityForTests
} from "./gateway.test-support";
import {
  bootstrapGatewayObservability,
  configureGatewayObservability,
  pruneGatewayObservabilityRetentionNow,
  recordGatewayFailureObservation,
  recordGatewayObservation
} from "./gateway";
import {
  gatewayObservationBatchSize,
  gatewayObservationSlowFlushWarnMs,
  gatewayObservationWorkerWriteTimeoutMs
} from "./ostrich/ingestion/gateway-observability-config";
import { closeObservabilityServiceHandle, openObservabilityService, resolveObservabilityDbPath } from "./runtime-loader";
import { proxyChatCompletion, sanitizeHeadersForLogging, type ProxyResponse } from "../hot-path/manatee/proxy/proxy";
import { REDACTED_SECRET, SecretString } from "../../platform/secret-string";
import { ObservabilityService } from "./service";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import { captureStderr, captureStdout, makeMockIncomingRequest, makeMockServerResponse, makeObservation, MockServerResponse, sleep } from "./test-helpers";
import type { AppConfig, ProxyRequestContext, RouteConfig } from "../../platform/types";

void test("gateway observability env tunables ignore non-canonical integer values", () => {
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
  const previousSlowFlushWarnMs = process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"];
  const previousWorkerWriteTimeoutMs = process.env["SWITCHMAXXER_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS"];

  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "51junk";
  process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"] = "026";
  process.env["SWITCHMAXXER_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS"] = "10001ms";

  try {
    assert.equal(gatewayObservationBatchSize(), 50);
    assert.equal(gatewayObservationSlowFlushWarnMs(), 25);
    assert.equal(gatewayObservationWorkerWriteTimeoutMs(), 10_000);
  } finally {
    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    if (typeof previousSlowFlushWarnMs === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"] = previousSlowFlushWarnMs;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"];
    }

    if (typeof previousWorkerWriteTimeoutMs === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS"] = previousWorkerWriteTimeoutMs;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_WORKER_WRITE_TIMEOUT_MS"];
    }
  }
});

void test("gateway observability bridge persists normalized gateway observations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-bridge-test",
      apiMode: "openai-completions",
      bareModel: "route-bridge",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:00:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway",
      model: "provider-model-gateway",
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

    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:00:00.000Z",
      attributes: {
        source: "gateway-test"
      }
    });

    recordGatewayFailureObservation("upstream_fetch", context, "provider_timeout", route);

    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId("req-gateway-bridge-test", 50);
    const requestExecution = service.getRequestExecution("req-gateway-bridge-test");

    assert.equal(observations.length, 2);
    assert.deepEqual(
      observations
        .map((observation) => ({
          event: observation.event,
          kind: observation.kind,
          stage: observation.stage,
          outcome: observation.outcome
        }))
        .sort((left, right) => left.event.localeCompare(right.event)),
      [
        {
          event: "debug_error_context",
          kind: "error",
          stage: "upstream_fetch",
          outcome: "timed_out"
        },
        {
          event: "request_received",
          kind: "measurement",
          stage: "ingress",
          outcome: null
        }
      ]
    );

    assert.ok(requestExecution, "expected request execution from gateway bridge");
    assert.equal(requestExecution.outcome, "timed_out");
    assert.equal(requestExecution.failure_stage, "upstream_fetch");
    assert.equal(requestExecution.route_name, "route-bridge");
    assert.equal(requestExecution.provider_id, "provider-gateway");

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability runtime path resolution rejects shared parents and unsafe filenames", () => {
  const privateTempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-safe-"));
  const groupWritableDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-group-"));

  try {
    const safePath = resolveObservabilityDbPath(path.join(privateTempDir, "observability.sqlite"));
    assert.equal(safePath, path.join(privateTempDir, "observability.sqlite"));

    chmodSync(groupWritableDir, 0o770);

    assert.throws(
      () => resolveObservabilityDbPath(path.join(groupWritableDir, "observability.sqlite")),
      /nearest existing parent '.+' is group- or world-writable/
    );

    assert.throws(
      () => resolveObservabilityDbPath(path.join(tmpdir(), "switchmaxxer-observability-unsafe.sqlite")),
      /nearest existing parent '.+' is group- or world-writable/
    );

    assert.throws(
      () => resolveObservabilityDbPath(path.join(privateTempDir, "observability.txt")),
      /must end in one of:/
    );
  } finally {
    chmodSync(groupWritableDir, 0o700);
    rmSync(privateTempDir, { recursive: true, force: true });
    rmSync(groupWritableDir, { recursive: true, force: true });
  }
});

void test("observability runtime path resolution rejects symlinked or shared existing DB files", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-existing-file-"));
  const targetPath = path.join(tempDir, "target.sqlite");
  const symlinkPath = path.join(tempDir, "observability.sqlite");
  const sharedPath = path.join(tempDir, "shared.sqlite");

  try {
    writeFileSync(targetPath, "");
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, symlinkPath);

    assert.throws(
      () => resolveObservabilityDbPath(symlinkPath),
      /must not be a symbolic link/
    );

    writeFileSync(sharedPath, "");
    chmodSync(sharedPath, 0o640);

    assert.throws(
      () => resolveObservabilityDbPath(sharedPath),
      /must not be readable or writable by group or other users/
    );

    chmodSync(sharedPath, 0o600);
    assert.equal(resolveObservabilityDbPath(sharedPath), sharedPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway failure observations redact sensitive reason text before persistence", async () => {
  await resetGatewayObservabilityForTests();
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-gateway-observation-redaction-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    configureGatewayObservability({
      disabled: false,
      dbPath,
      retentionOlderThan: null
    });

    const context: ProxyRequestContext = {
      requestId: "req-gateway-redaction-test",
      apiMode: "openai-completions",
      bareModel: "route-redaction",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:01:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-redaction",
      model: "provider-model-gateway-redaction",
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

    recordGatewayFailureObservation(
      "upstream_fetch",
      context,
      "Bearer sk-secret-value from https://alice:supersecret@example.com/path",
      route,
      {
        error_kind: "dns_not_found",
        socket_code: "ENOTFOUND",
        socket_syscall: "getaddrinfo",
        socket_hostname: "api.openai.com",
        root_cause_message: "getaddrinfo ENOTFOUND api.openai.com Bearer sk-secret-value"
      }
    );

    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId("req-gateway-redaction-test", 10);
    const errorObservation = observations.find((observation) => observation.event === "debug_error_context");

    assert.ok(errorObservation);
    assert.ok(typeof errorObservation.attributes_json === "string");
    const attributes = JSON.parse(errorObservation.attributes_json) as Record<string, unknown>;
    assert.equal(attributes["error_kind"], "dns_not_found");
    assert.equal(attributes["socket_code"], "ENOTFOUND");
    assert.equal(attributes["socket_hostname"], "api.openai.com");
    assert.match(errorObservation.attributes_json, /\*\*\*redacted\*\*\*/);
    assert.doesNotMatch(errorObservation.attributes_json, /sk-secret-value/);
    assert.doesNotMatch(errorObservation.attributes_json, /supersecret/);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge can flush queued observations in a single drain pass", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-queue-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
  const previousFlushDelay = process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
  const previousMaxQueueSize = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "50";
  process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = "10";
  process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = "1000";
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-queue-test",
      apiMode: "openai-completions",
      bareModel: "route-queue",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:05:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:05:00.000Z"
    });
    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "route_resolved",
      stage: "route_resolution",
      observedAt: "2026-04-18T13:05:00.010Z"
    });
    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "client_response_completed",
      stage: "client_response",
      observedAt: "2026-04-18T13:05:00.090Z",
      outcome: "succeeded",
      status_code: 200
    });

    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId("req-gateway-queue-test", 20);
    const requestExecution = service.getRequestExecution("req-gateway-queue-test");

    assert.equal(observations.length, 3);
    assert.ok(requestExecution);
    assert.equal(requestExecution?.outcome, "succeeded");
    assert.equal(requestExecution?.observation_count, 3);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    if (typeof previousFlushDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = previousFlushDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
    }

    if (typeof previousMaxQueueSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = previousMaxQueueSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability shutdown drains queued observations before teardown", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-shutdown-drain-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-shutdown-drain-test",
      apiMode: "openai-completions",
      bareModel: "route-shutdown-drain",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:06:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-shutdown-drain",
      model: "provider-model-gateway-shutdown-drain",
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

    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:06:00.000Z"
    });

    const { output } = await captureStdout(async () => {
      await resetGatewayObservabilityForTests();
    });

    assert.match(output, /Observability shutdown drain completed: drained=1 lost=0/);

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId("req-gateway-shutdown-drain-test", 10);

    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.event, "request_received");

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge drains queued observations asynchronously off the request path", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-async-queue-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousFlushDelay = process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = "25";
  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "50";
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-async-queue-test",
      apiMode: "openai-completions",
      bareModel: "route-queue",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:06:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:06:00.000Z"
    });

    const beforeFlushStore = bootstrapObservabilityStore({ dbPath });
    const beforeFlushService = new ObservabilityService(beforeFlushStore.db);
    assert.equal(beforeFlushService.listObservationsByRequestId("req-gateway-async-queue-test", 10).length, 0);
    closeObservabilityStore(beforeFlushStore);

    let persistedCount = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(25);

      const afterFlushStore = bootstrapObservabilityStore({ dbPath });
      const afterFlushService = new ObservabilityService(afterFlushStore.db);
      persistedCount = afterFlushService.listObservationsByRequestId("req-gateway-async-queue-test", 10).length;
      closeObservabilityStore(afterFlushStore);

      if (persistedCount === 1) {
        break;
      }
    }

    assert.equal(persistedCount, 1);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousFlushDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = previousFlushDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
    }

    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge bounds queue growth and warns when observations are dropped", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-overflow-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
  const previousFlushDelay = process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
  const previousMaxQueueSize = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
  const previousMaxQueueBytes = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "5";
  process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = "1000";
  process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = "5";
  await resetGatewayObservabilityForTests();

  try {
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    const { output } = await captureStderr(async () => {
      for (let index = 0; index < 6; index += 1) {
        recordGatewayObservation({
          context: {
            requestId: `req-gateway-overflow-${index}`,
            apiMode: "openai-completions",
            bareModel: "route-queue",
            caller: "test-suite",
            stream: false,
            requestStartedAt: Date.parse(`2026-04-18T13:07:0${index}.000Z`)
          },
          route,
          kind: "measurement",
          event: "request_received",
          stage: "ingress",
          observedAt: `2026-04-18T13:07:0${index}.000Z`
        });
      }

      await flushGatewayObservationQueueForTests();
    });

    assert.match(output, /Observability queue dropped 1 observation/);

    await resetGatewayObservabilityForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestIds = new Set(service.listRecentObservations({ limit: 10 }).flatMap((record) => (record.request_id ? [record.request_id] : [])));

    assert.equal(requestIds.size, 5);
    assert.equal(requestIds.has("req-gateway-overflow-0"), false);
    assert.equal(requestIds.has("req-gateway-overflow-5"), true);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    if (typeof previousFlushDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = previousFlushDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
    }

    if (typeof previousMaxQueueSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = previousMaxQueueSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
    }

    if (typeof previousMaxQueueBytes === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"] = previousMaxQueueBytes;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge bounds queue growth by queued bytes as well as item count", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-byte-overflow-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
  const previousFlushDelay = process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
  const previousMaxQueueSize = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
  const previousMaxQueueBytes = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "10";
  process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = "1000";
  process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = "10";
  process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"] = "8000";
  await resetGatewayObservabilityForTests();

  try {
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    const { output } = await captureStderr(async () => {
      for (let index = 0; index < 3; index += 1) {
        recordGatewayObservation({
          context: {
            requestId: `req-gateway-byte-overflow-${index}`,
            apiMode: "openai-completions",
            bareModel: "route-queue",
            caller: "test-suite",
            stream: false,
            requestStartedAt: Date.parse(`2026-04-18T13:08:0${index}.000Z`)
          },
          route,
          kind: "measurement",
          event: "request_received",
          stage: "ingress",
          observedAt: `2026-04-18T13:08:0${index}.000Z`,
          attributes: {
            payload: "x".repeat(2_000)
          }
        });
      }

      await flushGatewayObservationQueueForTests();
    });

    assert.match(output, /Observability queue dropped [1-9]\d* observation\(s\)/);

    await resetGatewayObservabilityForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestIds = new Set(
      service.listRecentObservations({ limit: 10 }).flatMap((record) => (record.request_id ? [record.request_id] : []))
    );

    assert.ok(requestIds.size < 3);
    assert.equal(requestIds.has("req-gateway-byte-overflow-2"), true);
    assert.equal(requestIds.has("req-gateway-byte-overflow-0"), false);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    if (typeof previousFlushDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = previousFlushDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
    }

    if (typeof previousMaxQueueSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = previousMaxQueueSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
    }

    if (typeof previousMaxQueueBytes === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"] = previousMaxQueueBytes;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge drops oversized attributes metadata before persistence", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-json-bound-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-json-bound-test",
      apiMode: "openai-completions",
      bareModel: "route-json-bound",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:08:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-json-bound",
      model: "provider-model-gateway-json-bound",
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

    const { output } = await captureStderr(async () => {
      recordGatewayObservation({
        context,
        route,
        kind: "measurement",
        event: "request_received",
        stage: "ingress",
        observedAt: "2026-04-18T13:08:00.000Z",
        attributes: {
          huge: "x".repeat(70 * 1024)
        }
      });

      await flushGatewayObservationQueueForTests();
    });

    assert.match(output, /Dropped oversized gateway observability attributes metadata before persistence/);

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId("req-gateway-json-bound-test", 10);

    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.attributes_json, null);
    assert.equal(observations[0]?.attributes_truncated, 1);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability worker pending writes time out and clean up their map entries", async () => {
  await resetGatewayObservabilityForTests();

  try {
    const pendingWrite = createPendingGatewayObservationWorkerWriteForTests(42, 10);
    assert.equal(getPendingGatewayObservationWorkerWriteCountForTests(), 1);

    await assert.rejects(pendingWrite, /timed out after 10ms/);
    assert.equal(getPendingGatewayObservationWorkerWriteCountForTests(), 0);
  } finally {
    await resetGatewayObservabilityForTests();
  }
});

void test("gateway observability bridge preserves terminal and error observations under queue pressure", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-priority-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousBatchSize = process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
  const previousFlushDelay = process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
  const previousMaxQueueSize = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
  const previousMaxQueueBytes = process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = "3";
  process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = "1000";
  process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = "3";
  await resetGatewayObservabilityForTests();

  try {
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    recordGatewayObservation({
      context: {
        requestId: "req-priority-debug-ingress",
        apiMode: "openai-completions",
        bareModel: "route-queue",
        caller: "test-suite",
        stream: false,
        requestStartedAt: Date.parse("2026-04-18T13:09:00.000Z")
      },
      route,
      kind: "debug",
      event: "debug_ingress",
      stage: "ingress",
      observedAt: "2026-04-18T13:09:00.000Z"
    });
    recordGatewayObservation({
      context: {
        requestId: "req-priority-measurement",
        apiMode: "openai-completions",
        bareModel: "route-queue",
        caller: "test-suite",
        stream: false,
        requestStartedAt: Date.parse("2026-04-18T13:09:01.000Z")
      },
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:09:01.000Z"
    });
    recordGatewayFailureObservation(
      "upstream_fetch",
      {
        requestId: "req-priority-error",
        apiMode: "openai-completions",
        bareModel: "route-queue",
        caller: "test-suite",
        stream: false,
        requestStartedAt: Date.parse("2026-04-18T13:09:02.000Z")
      },
      "provider_timeout",
      route
    );
    recordGatewayObservation({
      context: {
        requestId: "req-priority-terminal",
        apiMode: "openai-completions",
        bareModel: "route-queue",
        caller: "test-suite",
        stream: false,
        requestStartedAt: Date.parse("2026-04-18T13:09:03.000Z")
      },
      route,
      kind: "measurement",
      event: "client_response_completed",
      stage: "client_response",
      observedAt: "2026-04-18T13:09:03.000Z",
      outcome: "succeeded",
      status_code: 200
    });

    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestIds = new Set(service.listRecentObservations({ limit: 10 }).flatMap((record) => (record.request_id ? [record.request_id] : [])));

    assert.equal(requestIds.has("req-priority-debug-ingress"), false);
    assert.equal(requestIds.has("req-priority-error"), true);
    assert.equal(requestIds.has("req-priority-terminal"), true);
    assert.equal(requestIds.has("req-priority-measurement"), true);

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousBatchSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"] = previousBatchSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BATCH_SIZE"];
    }

    if (typeof previousFlushDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"] = previousFlushDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_FLUSH_DELAY_MS"];
    }

    if (typeof previousMaxQueueSize === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"] = previousMaxQueueSize;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_SIZE"];
    }

    if (typeof previousMaxQueueBytes === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"] = previousMaxQueueBytes;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_MAX_QUEUE_BYTES"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability bridge warns when a batch flush exceeds the watchdog threshold", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-gateway-slow-flush-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const previousSlowFlushWarnMs = process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"];

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"] = "0";
  await resetGatewayObservabilityForTests();

  try {
    const context: ProxyRequestContext = {
      requestId: "req-gateway-slow-flush-test",
      apiMode: "openai-completions",
      bareModel: "route-queue",
      caller: "test-suite",
      stream: false,
      requestStartedAt: Date.parse("2026-04-18T13:08:00.000Z")
    };
    const route: RouteConfig = {
      serviceProvider: "provider-gateway-queue",
      model: "provider-model-gateway-queue",
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

    recordGatewayObservation({
      context,
      route,
      kind: "measurement",
      event: "request_received",
      stage: "ingress",
      observedAt: "2026-04-18T13:08:00.000Z"
    });

    const { output } = await captureStderr(async () => {
      await flushGatewayObservationQueueForTests();
    });

    assert.match(output, /Observability batch flush took \d+ms/);
  } finally {
    await resetGatewayObservabilityForTests();

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    if (typeof previousSlowFlushWarnMs === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"] = previousSlowFlushWarnMs;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_SLOW_FLUSH_WARN_MS"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("proxy chat completion request path records expected milestone observations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-proxy-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const originalFetch = globalThis.fetch;

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  try {
    const config: AppConfig = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
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
      sourceFile: "config.json",
      sourcePath: path.join(tempDir, "config.json"),
      routes: {
        "route-proxy": {
          serviceProvider: "provider-proxy",
          api_mode: "openai-completions",
          anthropicVersion: null,
          modelCreator: "openai",
          model: "provider-model-proxy",
          baseUrl: "https://127.0.0.1/v1",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          routeTimeoutMs: null,
          timeoutMs: 5_000,
          cost: null,
          modelCost: null
        }
      }
    };

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        `${JSON.stringify({
          id: "chatcmpl-observability",
          object: "chat.completion",
          created: 1,
          model: "provider-model-proxy",
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
            "content-type": "application/json; charset=utf-8",
            "content-encoding": "gzip"
          }
        }
      );
    }) as typeof fetch;

    const request = makeMockIncomingRequest({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        "x-switchmaxxer-caller": "proxy-test-client"
      },
      remoteAddress: "127.0.0.1"
    });
    const response = makeMockServerResponse();
    const parsedBody = {
      model: "route-proxy",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: false
    };

    await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody));

    const responseText = response.body.toString("utf8");
    assert.equal(response.statusCode, 200);
    assert.match(responseText, /"content":"ok"/);

    const requestIdHeader = response.getHeader("x-switchmaxxer-request-id");
    const requestId = typeof requestIdHeader === "string" ? requestIdHeader : null;
    assert.ok(requestId, "expected proxy response to carry x-switchmaxxer-request-id");
    assert.equal(response.getHeader("content-encoding"), undefined);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId(requestId!, 100);
    const requestExecution = service.getRequestExecution(requestId!);
    const measurementEvents = observations
      .filter((observation) => observation.kind === "measurement")
      .map((observation) => observation.event);

    assert.ok(requestExecution, "expected materialized request execution for proxy request");
    assert.equal(requestExecution.outcome, "succeeded");
    assert.equal(requestExecution.route_name, "route-proxy");
    assert.equal(requestExecution.provider_id, "provider-proxy");
    assert.equal(requestExecution.status_code, 200);
    assert.ok((requestExecution.gateway_residency_ms ?? 0) >= 0);

    assert.deepEqual(
      [...new Set(measurementEvents)].sort(),
      [
        "client_response_completed",
        "client_response_started",
        "request_received",
        "route_resolved",
        "upstream_request_started",
        "upstream_response_completed",
        "upstream_response_started"
      ].sort()
    );

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();
    globalThis.fetch = originalFetch;

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("proxy chat completion forwards upstream 5xx responses while still recording failure observations", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-proxy-failure-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const originalFetch = globalThis.fetch;

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  try {
    const config: AppConfig = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
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
      sourceFile: "config.json",
      sourcePath: path.join(tempDir, "config.json"),
      routes: {
        "route-proxy-failure": {
          serviceProvider: "provider-proxy-failure",
          api_mode: "openai-completions",
          anthropicVersion: null,
          modelCreator: "openai",
          model: "provider-model-proxy-failure",
          baseUrl: "https://127.0.0.1/v1",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          routeTimeoutMs: null,
          timeoutMs: 5_000,
          cost: null,
          modelCost: null
        }
      }
    };

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        `${JSON.stringify({
          error: {
            message: "upstream exploded"
          }
        })}\n`,
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-encoding": "gzip"
          }
        }
      );
    }) as typeof fetch;

    const request = makeMockIncomingRequest({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        "x-switchmaxxer-caller": "proxy-test-client"
      },
      remoteAddress: "127.0.0.1"
    });
    const response = makeMockServerResponse();
    const parsedBody = {
      model: "route-proxy-failure",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: false
    };

    await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody));

    const responseText = response.body.toString("utf8");
    assert.equal(response.statusCode, 500);
    assert.match(responseText, /upstream exploded/);

    const requestIdHeader = response.getHeader("x-switchmaxxer-request-id");
    const requestId = typeof requestIdHeader === "string" ? requestIdHeader : null;
    assert.ok(requestId, "expected proxy failure response to carry x-switchmaxxer-request-id");
    assert.equal(response.getHeader("content-encoding"), undefined);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await flushGatewayObservationQueueForTests();
    await resetGatewayObservabilityForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId(requestId!, 100);
    const requestExecution = service.getRequestExecution(requestId!);
    const measurementEvents = observations
      .filter((observation) => observation.kind === "measurement")
      .map((observation) => observation.event);
    const errorObservations = observations.filter((observation) => observation.kind === "error");
    const upstreamResponseObservations = observations.filter(
      (observation) =>
        observation.event === "upstream_response_started" || observation.event === "upstream_response_completed"
    );

    assert.ok(requestExecution, "expected materialized request execution for forwarded upstream response");
    assert.equal(requestExecution.outcome, "succeeded");
    assert.equal(requestExecution.failure_stage, null);
    assert.equal(requestExecution.provider_id, "provider-proxy-failure");
    assert.equal(requestExecution.status_code, 500);

    assert.equal(errorObservations.length, 0);

    assert.deepEqual(
      [...new Set(measurementEvents)].sort(),
      [
        "client_response_completed",
        "client_response_started",
        "request_received",
        "route_resolved",
        "upstream_request_started",
        "upstream_response_completed",
        "upstream_response_started"
      ].sort()
    );

    assert.equal(upstreamResponseObservations.length, 2);
    for (const observation of upstreamResponseObservations) {
      assert.match(observation.attributes_json ?? "", /"upstream_status_classification":"upstream_error"/);
    }

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();
    globalThis.fetch = originalFetch;

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("proxy logs sanitize caller, route, and error text before writing lines", async () => {
  const originalFetch = globalThis.fetch;
  const injectedCaller = "legit-caller\nINJECTED LOG LINE";
  const injectedRoute = "route-log-injection\nINJECTED ROUTE";
  const injectedError = "fetch failed\nINJECTED ERROR";

  try {
    const config: AppConfig = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
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
      sourceFile: "config.json",
      sourcePath: path.resolve("config.json"),
      routes: {
        [injectedRoute]: {
          serviceProvider: "provider-log-test",
          api_mode: "openai-completions",
          anthropicVersion: null,
          modelCreator: "openai",
          model: "provider-model-log-test",
          baseUrl: "https://127.0.0.1/v1",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          routeTimeoutMs: null,
          timeoutMs: 5_000,
          cost: null,
          modelCost: null
        }
      }
    };

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error(injectedError);
    }) as typeof fetch;

    const request = makeMockIncomingRequest({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json"
      },
      remoteAddress: injectedCaller
    });
    const response = makeMockServerResponse();
    const parsedBody = {
      model: injectedRoute,
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: false
    };

    const { result: ignoredResponse, output } = await captureStdout(async () => {
      await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody));
      return response;
    });

    assert.equal(ignoredResponse.statusCode, 502);
    assert.equal(output.includes(injectedCaller), false);
    assert.equal(output.includes(injectedRoute), false);
    assert.equal(output.includes(injectedError), false);
    assert.match(output, /legit-caller INJECTED LOG LINE/);
    assert.match(output, /route-log-injection INJECTED ROUTE/);
    assert.match(output, /reason="Could not reach upstream provider"/);

    const lines = output.split("\n").filter((line) => line.length > 0);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => line.startsWith("[")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("sanitizeHeadersForLogging redacts provider auth headers", () => {
  const headers = new Headers({
    authorization: "Bearer sk-secret-value",
    "x-api-key": "sk-anthropic-secret",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  });

  const sanitized = sanitizeHeadersForLogging(headers);

  assert.equal(sanitized["authorization"], REDACTED_SECRET);
  assert.equal(sanitized["x-api-key"], REDACTED_SECRET);
  assert.equal(sanitized["anthropic-version"], "2023-06-01");
  assert.equal(sanitized["content-type"], "application/json");
  assert.ok(!Object.values(sanitized).includes("Bearer sk-secret-value"));
  assert.ok(!Object.values(sanitized).includes("sk-anthropic-secret"));
});

void test("proxy anthropic-to-openai streaming translation waits for drain before continuing", async () => {
  const originalFetch = globalThis.fetch;
  let secondWriteStartedBeforeDrain = false;
  let writeCount = 0;
  let drainReleased = false;

  class BackpressureResponse extends MockServerResponse {
    override write(chunk: string | Buffer): boolean {
      writeCount += 1;

      if (writeCount === 2 && !drainReleased) {
        secondWriteStartedBeforeDrain = true;
      }

      const canContinue = super.write(chunk);

      if (writeCount === 1) {
        setTimeout(() => {
          drainReleased = true;
          this.emit("drain");
        }, 10);
        return false;
      }

      return canContinue;
    }
  }

  try {
    const config: AppConfig = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
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
      sourceFile: "config.json",
      sourcePath: path.resolve("config.json"),
      routes: {
        "route-anthropic-stream": {
          serviceProvider: "provider-anthropic-stream",
          api_mode: "anthropic-messages",
          anthropicVersion: "2023-06-01",
          modelCreator: "anthropic",
          model: "claude-test-model",
          baseUrl: "https://127.0.0.1/anthropic",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          routeTimeoutMs: null,
          timeoutMs: 5_000,
          cost: null,
          modelCost: null
        }
      }
    };

    globalThis.fetch = (async (): Promise<Response> => {
      const body = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-test-model"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
      ].join("");

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const request = makeMockIncomingRequest({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        "x-switchmaxxer-caller": "proxy-test-client"
      },
      remoteAddress: "127.0.0.1"
    });
    const response = new BackpressureResponse();
    const parsedBody = {
      model: "route-anthropic-stream",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: true
    };

    await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody));

    const responseText = response.body.toString("utf8");
    assert.equal(secondWriteStartedBeforeDrain, false);
    assert.ok(writeCount >= 2);
    assert.match(responseText, /chat\.completion\.chunk/);
    assert.match(responseText, /\[DONE\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("proxy streaming path records client_closed when the downstream client disconnects mid-stream", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-stream-client-closed-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const originalFetch = globalThis.fetch;
  let cancelReason: string | null = null;

  process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
  await resetGatewayObservabilityForTests();

  class ClientClosingResponse extends MockServerResponse {
    private closeEmitted = false;

    override write(chunk: string | Buffer): boolean {
      const result = super.write(chunk);

      if (!this.closeEmitted) {
        this.closeEmitted = true;
        this.emit("close");
      }

      return result;
    }
  }

  try {
    const config: AppConfig = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5_000,
      streamIdleTimeoutMs: 5_000,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxPayloadSize: 1_000_000,
      rateLimit: {
        requests: 50,
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
      sourceFile: "config.json",
      sourcePath: path.resolve("config.json"),
      routes: {
        "route-anthropic-stream-close": {
          serviceProvider: "provider-anthropic-stream-close",
          api_mode: "anthropic-messages",
          anthropicVersion: "2023-06-01",
          modelCreator: "anthropic",
          model: "claude-test-model",
          baseUrl: "https://127.0.0.1/anthropic",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          routeTimeoutMs: null,
          timeoutMs: 5_000,
          cost: null,
          modelCost: null
        }
      }
    };

    globalThis.fetch = (async (): Promise<Response> => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              Buffer.from(
                'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_client_closed","type":"message","role":"assistant","model":"claude-test-model"}}\n\n'
              )
            );
            controller.enqueue(
              Buffer.from(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n'
              )
            );
          },
          cancel(reason) {
            cancelReason = typeof reason === "string" ? reason : String(reason);
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

    const request = makeMockIncomingRequest({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        "x-switchmaxxer-caller": "proxy-test-client"
      },
      remoteAddress: "127.0.0.1"
    });
    const response = new ClientClosingResponse() as ClientClosingResponse & ProxyResponse;
    const parsedBody = {
      model: "route-anthropic-stream-close",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: true
    };

    await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody));

    const requestIdHeader = response.getHeader("x-switchmaxxer-request-id");
    const requestId = typeof requestIdHeader === "string" ? requestIdHeader : null;
    assert.ok(requestId, "expected proxy streaming response to carry x-switchmaxxer-request-id");
    assert.equal(cancelReason, "client_closed");

    await new Promise<void>((resolve) => setImmediate(resolve));
    await flushGatewayObservationQueueForTests();

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observations = service.listObservationsByRequestId(requestId!, 100);
    const requestExecution = service.getRequestExecution(requestId!);
    const clientClosedObservation = observations.find(
      (observation) =>
        observation.kind === "error" &&
        observation.event === "debug_error_context" &&
        observation.attributes_json?.includes('"reason":"client_closed"')
    );

    assert.ok(clientClosedObservation, "expected client_closed observability record");
    assert.equal(clientClosedObservation?.outcome, "cancelled");
    assert.equal(clientClosedObservation?.stage, "response_stream");
    assert.ok(requestExecution, "expected materialized request execution for client_closed stream");
    assert.equal(requestExecution?.outcome, "cancelled");
    assert.equal(requestExecution?.failure_stage, "response_stream");

    closeObservabilityStore(store);
  } finally {
    await resetGatewayObservabilityForTests();
    globalThis.fetch = originalFetch;

    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability runtime loader prunes retained rows on open when retention is configured", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-retention-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const retainedObservedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let seededHandle = null;
  let retainedHandle = null;

  try {
    seededHandle = openObservabilityService(dbPath);
    seededHandle.service.recordObservation(makeObservation("2026-04-01T00:00:00.000Z", "request_received"));
    seededHandle.service.recordObservation(makeObservation(retainedObservedAt, "request_received"));
    closeObservabilityServiceHandle(seededHandle);
    seededHandle = null;

    retainedHandle = openObservabilityService(dbPath, {
      retentionOlderThan: "7d"
    });

    const remaining = retainedHandle.service.listRecentObservations({ limit: 10 });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.observed_at, retainedObservedAt);
  } finally {
    closeObservabilityServiceHandle(retainedHandle);
    closeObservabilityServiceHandle(seededHandle);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability bootstrap warns before creating a bare working-directory sqlite file", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-path-warning-"));
  let store = null;

  try {
    const { output } = await captureStderr(() => {
      store = bootstrapObservabilityStore({
        dbPath: "1",
        cwd: tempDir
      });
    });

    assert.equal(statSync(path.join(tempDir, "1")).isFile(), true);
    assert.match(output, /Observability DB path '1' resolves to '.+[/\\]1'/);
    assert.match(output, /create a new file in the working directory/);
  } finally {
    if (store) {
      closeObservabilityStore(store);
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability bootstrap tightens DB and SQLite sidecar permissions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-perms-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const originalUmask = process.umask();
  let store = null;

  try {
    process.umask(0);
    store = bootstrapObservabilityStore({ dbPath });

    const filePaths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((candidatePath) => existsSync(candidatePath));
    assert.ok(filePaths.length >= 1);

    for (const filePath of filePaths) {
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    }
  } finally {
    process.umask(originalUmask);
    if (store) {
      closeObservabilityStore(store);
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("gateway observability retention can prune long-lived stores after startup", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-retention-periodic-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousDbPath = process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
  const retainedObservedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let seededHandle = null;

  try {
    await resetGatewayObservabilityForTests();
    seededHandle = openObservabilityService(dbPath);
    seededHandle.service.recordObservation(makeObservation("2026-04-01T00:00:00.000Z", "request_received"));
    seededHandle.service.recordObservation(makeObservation(retainedObservedAt, "request_received"));
    closeObservabilityServiceHandle(seededHandle);
    seededHandle = null;

    process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = dbPath;
    configureGatewayObservability({
      retentionOlderThan: "7d"
    });
    bootstrapGatewayObservability();
    pruneGatewayObservabilityRetentionNow();
    await resetGatewayObservabilityForTests();

    const retainedHandle = openObservabilityService(dbPath);
    try {
      const remaining = retainedHandle.service.listRecentObservations({ limit: 10 });
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]?.observed_at, retainedObservedAt);
    } finally {
      closeObservabilityServiceHandle(retainedHandle);
    }
  } finally {
    await resetGatewayObservabilityForTests();
    closeObservabilityServiceHandle(seededHandle);
    if (typeof previousDbPath === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_DB"] = previousDbPath;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_DB"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
