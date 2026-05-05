import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "./observability.test-support";
import { ObservabilityService } from "./service";
import {
  resolveObservabilityBusyRetryAttempts,
  resolveObservabilityBusyRetryDelayMs,
  resolveObservabilityBusyTimeoutMs,
  resolveObservabilityWalAutocheckpointPages
} from "./sqlite-busy";
import { bootstrapObservabilityStore, closeObservabilityStore } from "./store";
import { makeObservation, makeObservationForRequest } from "./test-helpers";
import { MAX_OBSERVATION_MESSAGE_LENGTH, OBSERVABILITY_MAX_JSON_BYTES } from "./types";

void test("observability service returns filtered raw observations and failed-request stats", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-cli-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(makeObservation("2026-04-18T12:05:00.000Z", "request_received"));
    service.recordObservation(makeObservation("2026-04-18T12:05:00.020Z", "upstream_request_started"));
    service.recordObservation(
      makeObservation("2026-04-18T12:05:00.040Z", "client_response_completed", {
        outcome: "failed",
        statusCode: 502
      })
    );
    service.recordObservation(
      makeObservation("2026-04-18T12:06:00.000Z", "debug_error_context", {
        kind: "error",
        outcome: "failed",
        attributes: { reason: "upstream_502" }
      })
    );

    const recentErrors = service.listRecentObservations({
      kind: "error",
      limit: 10
    });
    assert.equal(recentErrors.length, 1);
    assert.equal(recentErrors[0]?.event, "debug_error_context");

    const failedStats = service.getRequestExecutionStats({ outcome: "failed" });
    assert.equal(failedStats.total_count, 1);
    assert.deepEqual(
      failedStats.top_failing_routes.map((row) => ({
        route: row.route,
        count: row.count
      })),
      [{ route: "route-alpha", count: 1 }]
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service lists request observations in ascending order without JS reversal", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observation-order-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation(
      makeObservationForRequest("req-order-test", "2026-04-18T12:07:00.000Z", "client_response_completed", {
        outcome: "succeeded",
        statusCode: 200
      })
    );
    service.recordObservation(makeObservationForRequest("req-order-test", "2026-04-18T12:05:00.000Z", "request_received"));
    service.recordObservation(makeObservationForRequest("req-order-test", "2026-04-18T12:06:00.000Z", "route_resolved"));

    const observations = service.listObservationsByRequestId("req-order-test", 10);
    assert.deepEqual(
      observations.map((observation) => observation.event),
      ["request_received", "route_resolved", "client_response_completed"]
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability service rolls back cleanly when an observation insert fails", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-rollback-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const observation = makeObservation("2026-04-18T12:08:00.000Z", "request_received");

    service.recordObservation(observation);

    assert.throws(() => service.recordObservation(observation));
    assert.equal(service.listObservationsByRequestId("req-observability-test", 10).length, 1);
    assert.equal(service.getRequestExecution("req-observability-test")?.observation_count, 1);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability repository rejects malformed observed_at timestamps", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-bad-observed-at-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    assert.throws(
      () =>
        service.recordObservation({
          ...makeObservation("not-a-timestamp", "request_received"),
          request_id: "req-bad-observed-at",
          client_api_mode: "openai"
        }),
      /Observation field 'observed_at' must be an ISO-8601 timestamp\./
    );

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability repository redacts and caps stored observation messages", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-message-redaction-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const oversizedMessage =
      `Bearer sk-secret-value https://alice:supersecret@example.com/path ${"x".repeat(MAX_OBSERVATION_MESSAGE_LENGTH + 128)}`;

    service.recordObservation({
      ...makeObservation("2026-04-18T12:20:00.000Z", "debug_error_context", {
        kind: "error",
        outcome: "failed",
        statusCode: 502
      }),
      request_id: "req-observation-message-redaction",
      id: "req-observation-message-redaction-debug_error_context-2026-04-18T12:20:00.000Z",
      message: oversizedMessage
    });

    const observation = service.listObservationsByRequestId("req-observation-message-redaction", 10)[0];
    assert.ok(observation);
    assert.ok(typeof observation.message === "string");
    assert.ok(observation.message.length <= MAX_OBSERVATION_MESSAGE_LENGTH);
    assert.match(observation.message, /\*\*\*redacted\*\*\*/);
    assert.doesNotMatch(observation.message, /sk-secret-value/);
    assert.doesNotMatch(observation.message, /supersecret/);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability repository rejects oversized attributes_json from internal callers before insert", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-oversized-attributes-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const oversizedAttributesJson = JSON.stringify({
      payload: "x".repeat(OBSERVABILITY_MAX_JSON_BYTES)
    });

    assert.throws(
      () =>
        service.recordObservation({
          ...makeObservation("2026-04-18T12:21:00.000Z", "request_received"),
          request_id: "req-oversized-attributes-json",
          id: "req-oversized-attributes-json-request_received-2026-04-18T12:21:00.000Z",
          client_api_mode: "openai",
          attributes_json: oversizedAttributesJson
        }),
      /Observation field 'attributes_json' exceeds repository JSON bounds: json_serialized_too_large/
    );

    assert.equal(service.listObservationsByRequestId("req-oversized-attributes-json", 10).length, 0);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability repository redacts nested sensitive attributes_json before insert", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-attribute-redaction-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    service.recordObservation({
      ...makeObservation("2026-04-18T12:21:30.000Z", "debug_error_context", {
        kind: "error",
        outcome: "failed",
        statusCode: 502
      }),
      request_id: "req-redacted-attributes-json",
      id: "req-redacted-attributes-json-debug_error_context-2026-04-18T12:21:30.000Z",
      attributes_json: JSON.stringify({
        reason: "Bearer sk-secret-value",
        auth_header: "Bearer sk-secret-value",
        nested: {
          retry_reason: "https://alice:supersecret@example.com/path"
        }
      })
    });

    const observation = service.listObservationsByRequestId("req-redacted-attributes-json", 10)[0];
    assert.ok(observation);
    assert.ok(typeof observation.attributes_json === "string");
    assert.match(observation.attributes_json, /\*\*\*redacted\*\*\*/);
    assert.doesNotMatch(observation.attributes_json, /sk-secret-value/);
    assert.doesNotMatch(observation.attributes_json, /supersecret/);
    assert.doesNotMatch(observation.attributes_json, /auth_header/);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store respects configured busy_timeout and wal_autocheckpoint", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-busy-timeout-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const previousBusyTimeout = process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"];
  const previousWalAutocheckpoint = process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"];

  process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"] = "15000";
  process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"] = "800";

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const busyTimeoutPragmaRow = store.db.prepare("PRAGMA busy_timeout").get() as { timeout?: number } | undefined;
    const walAutocheckpointPragmaRow = store.db.prepare("PRAGMA wal_autocheckpoint").get() as
      | { wal_autocheckpoint?: number }
      | undefined;

    assert.equal(resolveObservabilityBusyTimeoutMs(), 15000);
    assert.equal(resolveObservabilityWalAutocheckpointPages(), 800);
    assert.equal(busyTimeoutPragmaRow?.timeout ?? busyTimeoutPragmaRow, 15000);
    assert.equal(walAutocheckpointPragmaRow?.wal_autocheckpoint ?? walAutocheckpointPragmaRow, 800);

    closeObservabilityStore(store);
  } finally {
    if (typeof previousBusyTimeout === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"] = previousBusyTimeout;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"];
    }

    if (typeof previousWalAutocheckpoint === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"] = previousWalAutocheckpoint;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"];
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability sqlite env tunables ignore non-canonical integer values", () => {
  const previousBusyTimeout = process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"];
  const previousBusyRetryAttempts = process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_ATTEMPTS"];
  const previousBusyRetryDelay = process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_DELAY_MS"];
  const previousWalAutocheckpoint = process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"];

  process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"] = "15000junk";
  process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_ATTEMPTS"] = "004";
  process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_DELAY_MS"] = "+26";
  process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"] = "800junk";

  try {
    assert.equal(resolveObservabilityBusyTimeoutMs(), 5_000);
    assert.equal(resolveObservabilityBusyRetryAttempts(), 3);
    assert.equal(resolveObservabilityBusyRetryDelayMs(), 25);
    assert.equal(resolveObservabilityWalAutocheckpointPages(), 1_000);
  } finally {
    if (typeof previousBusyTimeout === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"] = previousBusyTimeout;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_TIMEOUT_MS"];
    }

    if (typeof previousBusyRetryAttempts === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_ATTEMPTS"] = previousBusyRetryAttempts;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_ATTEMPTS"];
    }

    if (typeof previousBusyRetryDelay === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_DELAY_MS"] = previousBusyRetryDelay;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_BUSY_RETRY_DELAY_MS"];
    }

    if (typeof previousWalAutocheckpoint === "string") {
      process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"] = previousWalAutocheckpoint;
    } else {
      delete process.env["SWITCHMAXXER_OBSERVABILITY_WAL_AUTOCHECKPOINT_PAGES"];
    }
  }
});
