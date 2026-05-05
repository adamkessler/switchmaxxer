import assert from "node:assert/strict";
import test from "node:test";

import { buildSuccessEnvelope, CLI_SCHEMA_VERSION } from "./response-envelope";

void test("buildSuccessEnvelope preserves caller top_level fields when they do not collide", () => {
  const envelope = buildSuccessEnvelope("bench", { run_id: "bench-1" }, {
    top_level: {
      sample_count: 3
    }
  });

  assert.deepEqual(envelope, {
    ok: true,
    command: "bench",
    schema_version: CLI_SCHEMA_VERSION,
    data: {
      run_id: "bench-1"
    },
    sample_count: 3
  });
});

void test("buildSuccessEnvelope rejects caller top_level keys that collide with reserved fields", () => {
  const reservedKeys = [
    "ok",
    "command",
    "schema_version",
    "data",
    "count",
    "warnings",
    "details",
    "normalized_fields",
    "editability",
    "error"
  ];

  for (const key of reservedKeys) {
    assert.throws(
      () =>
        buildSuccessEnvelope("bench", { run_id: "bench-1" }, {
          top_level: {
            [key]: "caller override"
          }
        }),
      new RegExp(`Success envelope top_level must not override reserved field '${key}'\\.`)
    );
  }
});
