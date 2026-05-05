import assert from "node:assert/strict";

import { parseCliEnvelope, runWithCapturedIo, test } from "./cli.test-support";

void test("runCli can exercise help paths without shelling out", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["test", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer test/);
  assert.match(stdout, /--no-gateway/);
  assert.match(stdout, /Runs configured gateway and route tests without starting a new gateway runtime/);
  assert.equal(stderr, "");
});

void test("runCli builds top-level help from the command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /Available commands:/);
  assert.match(stdout, /gateway\s+Interact with the live Switchmaxxer gateway runtime/);
  assert.match(stdout, /switchmaxxer gateway run/);
  assert.match(stdout, /switchmaxxer tool <date\|uptime\|random> \[flags\]/);
  assert.match(stdout, /optimize\s+Recommend, apply, or restore a route provider for a model/);
  assert.match(stdout, /prune\s+Apply observability-store retention/);
  assert.match(stdout, /smx is the official short operator alias for switchmaxxer/);
  assert.equal(stderr, "");
});

void test("runCli resolves help through the synthetic global meta registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["help", "config"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer config/);
  assert.match(stdout, /config validate/);
  assert.equal(stderr, "");
});

void test("runCli resolves top-level prune help", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["help", "prune"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer prune/);
  assert.match(stdout, /whole observability-store retention/);
  assert.match(stdout, /--older-than <duration>/);
  assert.equal(stderr, "");
});

void test("runCli help surfaces advertise smx as the official short alias", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["invoke", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /smx invoke is the official short operator alias form\./);
  assert.doesNotMatch(stdout, /\bsy invoke is the official short operator alias form\./);
  assert.equal(stderr, "");
});

void test("runCli resolves version through the synthetic global meta registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["version"]);

  assert.equal(result, 0);
  assert.match(stdout, /^switchmaxxer /);
  assert.equal(stderr, "");
});

void test("runCli preserves test-family unknown-subcommand errors through the shared family runner", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["test", "routes"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown test subcommand 'routes'/);
});

void test("runCli preserves bench-family unknown-subcommand errors through the shared family runner", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "routes"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown bench subcommand 'routes'/);
});

void test("runCli routes bench help through the bench command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer bench/);
  assert.match(stdout, /switchmaxxer bench \[--route <route-id>\|--routes <csv>\]/);
  assert.match(stdout, /show\s+Show one persisted benchmark run/);
  assert.match(stdout, /prune\s+Prune old benchmark-history records/);
  assert.match(stdout, /delete\s+Delete one benchmark-history run/);
  assert.match(stdout, /clear\s+Clear benchmark history/);
  assert.equal(stderr, "");
});

void test("runCli enforces the shared bench execution contract", async () => {
  const routesCsv = Array.from({ length: 33 }, (_, index) => `route-${index}`).join(",");
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "--routes", routesCsv, "--prompt", "hello"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--routes' may include at most 32 routes for 'bench'/);
});

void test("runCli returns typed json usage errors for bench contract failures", async () => {
  const routesCsv = Array.from({ length: 33 }, (_, index) => `route-${index}`).join(",");
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "--json", "--routes", routesCsv, "--prompt", "hello"]);

  assert.equal(result, 2);
  assert.equal(stderr, "");
  assert.deepEqual(parseCliEnvelope(stdout), {
    ok: false,
    command: "bench",
    schema_version: "1",
    error: {
      code: "invalid_input_field",
      message: "Flag '--routes' may include at most 32 routes for 'bench'"
    }
  });
});

void test("runCli rejects unsupported bench path modes through the shared contract", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "--route", "route-a", "--prompt", "hello", "--path", "sideways"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--path' must be one of gateway, direct, or both/);
});

void test("runCli rejects invalid trace outcome filters through the shared observability contract", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["trace", "list", "--outcome", "bogus"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--outcome' must be one of /);
});

void test("runCli rejects invalid prune durations through the shared retention contract", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["prune", "--older-than", "tomorrow"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--older-than' must be a duration like '14d', '168h', '30m', or '2w'/);
});

void test("runCli rejects invalid bench prune durations through the shared retention contract", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["bench", "prune", "--older-than", "tomorrow"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Flag '--older-than' must be a duration like '14d', '168h', '30m', or '2w'/);
});

void test("runCli rejects removed trace prune as an unknown trace subcommand", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["trace", "prune", "--older-than", "14d"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown trace subcommand 'prune'/);
});

void test("runCli rejects removed top-level aliases as unknown commands", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["logs"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown command 'logs'/);
});

void test("runCli routes invoke help through the invoke help metadata", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["invoke", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer invoke/);
  assert.match(stdout, /--route <route-id>/);
  assert.match(stdout, /Sends a one-off request through the local Switchmaxxer gateway/);
  assert.equal(stderr, "");
});

void test("runCli routes nested gateway help through the gateway command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["gateway", "runtime", "config", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer gateway/);
  assert.match(stdout, /runtime config/);
  assert.match(stdout, /logs tail\s+Tail live gateway logs/);
  assert.equal(stderr, "");
});

void test("runCli preserves gateway nested missing-subcommand errors through the shared family runner", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["gateway", "runtime"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Missing required gateway runtime subcommand 'config'/);
});

void test("runCli preserves gateway logs missing-subcommand errors through the shared family runner", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["gateway", "logs"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Missing required gateway logs subcommand 'tail' or 'show'/);
});

void test("runCli preserves gateway unknown-subcommand errors through the shared family runner", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["gateway", "banana"]);

  assert.equal(result, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown gateway subcommand 'banana'/);
});

void test("runCli routes trace help through the trace command registry", async () => {
  const { result, stdout, stderr } = await runWithCapturedIo(["trace", "--help"]);

  assert.equal(result, 0);
  assert.match(stdout, /switchmaxxer trace/);
  assert.match(stdout, /trace verify/);
  assert.match(stdout, /repair\s+Repair persisted trace summaries/);
  assert.doesNotMatch(stdout, /trace prune/);
  assert.doesNotMatch(stdout, /prune\s+/);
  assert.equal(stderr, "");
});
