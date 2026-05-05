import assert from "node:assert/strict";
import test from "node:test";

import { BENCH_MAX_ROUTES, BENCH_MAX_TOTAL_TASKS } from "../observability/bench-limits";
import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { McpToolError } from "./errors";
import { parseBenchRunArgs, parseGatewayHealthArgs } from "./parsers-bench-gateway";

function assertMcpToolError(error: unknown, code: string, message: RegExp | string): void {
  assert.ok(error instanceof McpToolError);
  assert.equal(error.code, code);
  if (typeof message === "string") {
    assert.equal(error.message, message);
  } else {
    assert.match(error.message, message);
  }
}

void test("parseGatewayHealthArgs rejects invalid health checks at the parser boundary", () => {
  assert.throws(
    () => parseGatewayHealthArgs({ check: "database" }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.invalidInputField,
        "field 'check' must be one of: gateway, config, providers, routes, all"
      );
      return true;
    }
  );
});

void test("parseBenchRunArgs trims route names and preserves explicit path mode", () => {
  const parsed = parseBenchRunArgs({
    prompt: "hello world",
    routes: [" route_a ", "route_b"],
    path_mode: "both",
    warmup: 0
  });

  assert.deepEqual(parsed.routeNames, ["route_a", "route_b"]);
  assert.equal(parsed.pathModeValue, "both");
  assert.equal(parsed.warmup, 0);
});

void test("parseBenchRunArgs rejects route lists that exceed the shared route cap", () => {
  assert.throws(
    () =>
      parseBenchRunArgs({
        prompt: "hello world",
        routes: Array.from({ length: BENCH_MAX_ROUTES + 1 }, (_, index) => `route_${index + 1}`)
      }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.invalidInputField,
        new RegExp(`field 'routes' must contain at most ${BENCH_MAX_ROUTES} route names for 'bench_run'`)
      );
      return true;
    }
  );
});

void test("parseBenchRunArgs rejects unsupported path modes at the shared parser boundary", () => {
  assert.throws(
    () =>
      parseBenchRunArgs({
        prompt: "hello world",
        route_id: "route_a",
        path_mode: "sideways"
      }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.invalidInputField,
        "field 'path_mode' must be one of: gateway, direct, both"
      );
      return true;
    }
  );
});

void test("parseBenchRunArgs rejects benchmark plans that exceed the shared total-task cap", () => {
  assert.throws(
    () =>
      parseBenchRunArgs({
        prompt: "hello world",
        routes: Array.from({ length: BENCH_MAX_ROUTES }, () => "route_a"),
        path_mode: "direct",
        iterations: 500,
        warmup: 1100
      }),
    (error: unknown) => {
      assertMcpToolError(
        error,
        MCP_USAGE_ERROR_CODES.invalidInputField,
        new RegExp(`at most ${BENCH_MAX_TOTAL_TASKS} tasks`)
      );
      return true;
    }
  );
});
