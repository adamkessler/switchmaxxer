import assert from "node:assert/strict";
import test from "node:test";

import { resolveMcpBenchRunMaxDurationMsForTests } from "./bench-run-tool";

void test("MCP bench_run duration env ignores non-canonical integer values", () => {
  const previousMaxDuration = process.env["SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS"];

  try {
    process.env["SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS"] = "60000";
    assert.equal(resolveMcpBenchRunMaxDurationMsForTests(), 60_000);

    for (const invalidValue of ["60000junk", "060000", "+60000", "60000.5", "9007199254740992"]) {
      process.env["SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS"] = invalidValue;
      assert.equal(resolveMcpBenchRunMaxDurationMsForTests(), 15 * 60 * 1000);
    }
  } finally {
    if (typeof previousMaxDuration === "string") {
      process.env["SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS"] = previousMaxDuration;
    } else {
      delete process.env["SWITCHMAXXER_MCP_BENCH_RUN_MAX_DURATION_MS"];
    }
  }
});
