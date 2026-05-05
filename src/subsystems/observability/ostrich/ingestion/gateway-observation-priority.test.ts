import assert from "node:assert/strict";
import test from "node:test";

import { gatewayObservationPriority } from "./gateway-observation-priority";
import type { RecordObservationBatchItem } from "../../service";
import type {
  ObservationEvent,
  ObservationKind,
  ObservationOutcome,
  ObservationRecord
} from "../../types";

function makeItem(
  overrides: {
    kind: ObservationKind;
    event?: ObservationEvent;
    outcome?: ObservationOutcome | null;
  }
): RecordObservationBatchItem {
  const record: ObservationRecord = {
    id: "obs-test",
    observed_at: "2026-05-12T00:00:00.000Z",
    surface: "gateway",
    kind: overrides.kind,
    event: overrides.event ?? "request_received",
    outcome: overrides.outcome ?? null
  };

  return { record };
}

void test("gatewayObservationPriority keeps errors and terminal gateway observations at highest priority", () => {
  const cases: Array<{
    item: RecordObservationBatchItem;
    label: string;
  }> = [
    { label: "error kind", item: makeItem({ kind: "error", event: "auth_failed" }) },
    { label: "client response completed", item: makeItem({ kind: "measurement", event: "client_response_completed" }) },
    { label: "debug error context", item: makeItem({ kind: "debug", event: "debug_error_context" }) },
    { label: "succeeded outcome", item: makeItem({ kind: "measurement", outcome: "succeeded" }) },
    { label: "failed outcome", item: makeItem({ kind: "measurement", outcome: "failed" }) },
    { label: "cancelled outcome", item: makeItem({ kind: "measurement", outcome: "cancelled" }) },
    { label: "timed out outcome", item: makeItem({ kind: "measurement", outcome: "timed_out" }) },
    { label: "rejected outcome", item: makeItem({ kind: "measurement", outcome: "rejected" }) },
    { label: "partial outcome", item: makeItem({ kind: "measurement", outcome: "partial" }) }
  ];

  for (const { item, label } of cases) {
    assert.equal(gatewayObservationPriority(item), 3, label);
  }
});

void test("gatewayObservationPriority deprioritizes debug, preserves analytical events, and defaults normal measurements", () => {
  const cases: Array<{
    kind: ObservationKind;
    expected: number;
  }> = [
    { kind: "debug", expected: 0 },
    { kind: "measurement", expected: 1 },
    { kind: "usage", expected: 2 },
    { kind: "cost", expected: 2 },
    { kind: "benchmark", expected: 2 },
    { kind: "optimization", expected: 2 },
    { kind: "system", expected: 2 }
  ];

  for (const { kind, expected } of cases) {
    assert.equal(
      gatewayObservationPriority(makeItem({ kind, outcome: "in_progress" })),
      expected,
      kind
    );
  }
});
