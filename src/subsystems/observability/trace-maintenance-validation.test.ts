import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACE_MAINTENANCE_SCOPE_MESSAGES,
  validateTraceMaintenanceScope
} from "./trace-maintenance-validation";

void test("validateTraceMaintenanceScope rejects contradictory scope", () => {
  assert.equal(
    validateTraceMaintenanceScope({
      traceId: "req-123",
      all: true
    }),
    TRACE_MAINTENANCE_SCOPE_MESSAGES.conflictingScope
  );
});

void test("validateTraceMaintenanceScope requires an explicit scope", () => {
  assert.equal(
    validateTraceMaintenanceScope({
      all: false
    }),
    TRACE_MAINTENANCE_SCOPE_MESSAGES.missingScope
  );
});

void test("validateTraceMaintenanceScope rejects batch size without all-scope", () => {
  assert.equal(
    validateTraceMaintenanceScope({
      traceId: "req-123",
      all: false,
      batchSize: 10
    }),
    TRACE_MAINTENANCE_SCOPE_MESSAGES.batchSizeRequiresAll
  );
});

void test("validateTraceMaintenanceScope accepts valid single-trace and all-scope shapes", () => {
  assert.equal(
    validateTraceMaintenanceScope({
      traceId: "req-123",
      all: false
    }),
    null
  );

  assert.equal(
    validateTraceMaintenanceScope({
      all: true,
      batchSize: 10
    }),
    null
  );
});
