import assert from "node:assert/strict";
import test from "node:test";

import { normalizeJournalJsonEntry } from "./log-normalization";

void test("normalizeJournalJsonEntry extracts structured fields from journal json logs", () => {
  const normalized = normalizeJournalJsonEntry(
    JSON.stringify({
      MESSAGE: '[2026-04-23T12:00:00.000Z] <-- RESPONSE route=demo status=200 latency=45ms reason="all good"',
      SYSLOG_IDENTIFIER: "switchmaxxer",
      _PID: "1234",
      _HOSTNAME: "test-host",
      _TRANSPORT: "stdout",
      __REALTIME_TIMESTAMP: "1713873600000000"
    })
  );

  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.deepEqual({ ...normalized }, {
    timestamp: "2026-04-23T12:00:00.000Z",
    event: "response",
    message: '<-- RESPONSE route=demo status=200 latency=45ms reason="all good"',
    syslog_identifier: "switchmaxxer",
    pid: 1234,
    hostname: "test-host",
    transport: "stdout",
    journal_realtime_timestamp: "1713873600000000",
    route: "demo",
    status_code: 200,
    latency_ms: 45,
    reason: "all good"
  });
});

void test("normalizeJournalJsonEntry handles adversarial quoted segments without pathological matching", () => {
  const adversarialValue = `"${'"'.repeat(5000)} tail`;
  const normalized = normalizeJournalJsonEntry(
    JSON.stringify({
      MESSAGE: `[2026-04-23T12:00:01.000Z] x ERROR note=${adversarialValue} status=500 trailing=kept`
    })
  );

  assert.equal(normalized["event"], "error");
  assert.equal(normalized["status_code"], 500);
  assert.equal(normalized["trailing"], "kept");
  assert.equal(normalized["note"], "");
});

void test("normalizeJournalJsonEntry ignores reserved or synthetic object-like keys from journal fields", () => {
  const normalized = normalizeJournalJsonEntry(
    JSON.stringify({
      MESSAGE:
        '[2026-04-23T12:00:02.000Z] <-- RESPONSE route=demo __proto__=polluted constructor=ignored hasOwnProperty=ignored status=200'
    })
  );

  assert.equal(Object.getPrototypeOf(normalized), null);
  assert.equal(normalized["route"], "demo");
  assert.equal(normalized["status_code"], 200);
  assert.equal("__proto__" in normalized, false);
  assert.equal("constructor" in normalized, false);
  assert.equal("hasOwnProperty" in normalized, false);
});
