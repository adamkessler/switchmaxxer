#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-017-mcp-observability-negative)"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_DB="${TMP_DIR}/observability.sqlite"
TEMP_STDERR="${TMP_DIR}/stderr.log"

fail() {
  printf 'FAIL: %s\n' "$1"
  if [[ -f "${TEMP_STDERR}" ]]; then
    printf 'stderr:\n'
    cat "${TEMP_STDERR}"
  fi
  exit 1
}

run_mcp() {
  local request_json="$1"
  MCP_RESPONSE="$(
    printf '%s\n' "${request_json}" \
      | SWITCHMAXXER_OBSERVABILITY_DB="${TEMP_DB}" node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"
  )" || fail "mcp serve command failed"
}
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

printf 'Switchmaxxer test-017-mcp-observability-negative-contract\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Dist entry: %s\n' "${DIST_INDEX}"
printf 'Working config copy: %s\n' "${TEMP_CONFIG}"
printf 'Working observability DB: %s\n\n' "${TEMP_DB}"

if [[ ! -f "${DIST_INDEX}" ]]; then
  fail "built dist entry not found at ${DIST_INDEX}"
fi

if [[ ! -f "${SOURCE_CONFIG}" ]]; then
  fail "source config not found at ${SOURCE_CONFIG}"
fi

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

TEMP_CONFIG="${TEMP_CONFIG}" node --input-type=module - <<'NODE'
import fs from "node:fs";
import net from "node:net";

const configPath = process.env.TEMP_CONFIG;
if (!configPath) {
  throw new Error("TEMP_CONFIG is required");
}

// Bind to a transient free port and immediately release it. The MCP
// gateway_runtime_config tool will try to fetch this port and fail with
// connect-refused, which is the negative contract this test exercises.
// Using the example config's default port (4080) leaks the developer's
// running gateway into the test, since the MCP child has no way to know
// the gateway it reaches is not part of the test fixture.
const reservedPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen({ port: 0, host: "127.0.0.1" }, () => {
    const address = server.address();
    if (address && typeof address === "object") {
      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    } else {
      reject(new Error("could not reserve free port"));
    }
  });
});

const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.mcp = { capabilities: ["read", "mutation", "privileged"] };
document.port = reservedPort;
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
NODE

printf '{}' | SWITCHMAXXER_OBSERVABILITY_DB="${TEMP_DB}" node - <<'NODE'
const { bootstrapObservabilityStore, closeObservabilityStore } = require("./dist/subsystems/observability/store.js");
const dbPath = process.env.SWITCHMAXXER_OBSERVABILITY_DB;
if (!dbPath) {
  throw new Error("SWITCHMAXXER_OBSERVABILITY_DB is required");
}
const store = bootstrapObservabilityStore({ dbPath });
closeObservabilityStore(store);
NODE

run_mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"trace_show","arguments":{"trace_id":"missing-trace"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_show missing-trace response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "trace_not_found") {
  console.error(`unexpected trace_show missing-trace code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_show missing-trace assertion failed"

run_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bench_show","arguments":{"run_id":"missing-run"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("bench_show missing-run response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "bench_not_found") {
  console.error(`unexpected bench_show missing-run code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_show missing-run assertion failed"

run_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"trace_show","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_show missing-arg response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "missing_required_field") {
  console.error(`unexpected trace_show missing-arg code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_show missing-arg assertion failed"

run_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"trace_list","arguments":{"limit":0}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_list invalid-limit response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected trace_list invalid-limit code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_list invalid-limit assertion failed"

run_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"trace_observations","arguments":{"event":"not-a-real-event"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_observations invalid-event response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected trace_observations invalid-event code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_observations invalid-event assertion failed"

run_mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"trace_verify","arguments":{"trace_id":"abc","all":true}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_verify invalid-scope response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected trace_verify invalid-scope code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_verify invalid-scope assertion failed"

run_mcp '{"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"trace_verify","arguments":{"trace_id":"abc","batch_size":10}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_verify invalid batch_size scope should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected trace_verify invalid batch_size scope code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_verify batch_size invalid-scope assertion failed"

run_mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"bench_show","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("bench_show missing-arg response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "missing_required_field") {
  console.error(`unexpected bench_show missing-arg code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_show missing-arg assertion failed"

run_mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"bench_run","arguments":{"route_id":"missing-route","prompt":"ping","iterations":501}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("bench_run over-limit response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected bench_run over-limit code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_run over-limit assertion failed"

run_mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"bench_run","arguments":{"routes":["r01","r02","r03","r04","r05","r06","r07","r08","r09","r10","r11","r12","r13","r14","r15","r16","r17","r18","r19","r20","r21","r22","r23","r24","r25","r26","r27","r28","r29","r30","r31","r32","r33"],"prompt":"ping","iterations":1}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("bench_run route-cap response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected bench_run route-cap code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_run route-cap assertion failed"

run_mcp '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"trace_show","arguments":"not-an-object"}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_show non-object-arguments response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_tool_input") {
  console.error(`unexpected trace_show non-object-arguments code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_show non-object-arguments assertion failed"

run_mcp '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"prune","arguments":{"older_than":"not-a-duration"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("prune invalid-duration response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected prune invalid-duration code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "prune invalid-duration assertion failed"

rm -f "${TEMP_DB}"

run_mcp '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"trace_repair","arguments":{"all":true}}}'
RESPONSE="${MCP_RESPONSE}" TEMP_DB="${TEMP_DB}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("trace_repair missing-store response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "trace_repair_error") {
  console.error(`unexpected trace_repair missing-store code: ${payload?.error?.code}`);
  process.exit(1);
}
if (payload?.details?.store_path !== process.env.TEMP_DB) {
  console.error(`unexpected trace_repair missing-store path: ${payload?.details?.store_path}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("nothing can be repaired yet")) {
  console.error(`unexpected trace_repair missing-store message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_repair missing-store assertion failed"

run_mcp '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"prune","arguments":{"older_than":"14d"}}}'
RESPONSE="${MCP_RESPONSE}" TEMP_DB="${TEMP_DB}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("prune missing-store response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "prune_error") {
  console.error(`unexpected prune missing-store code: ${payload?.error?.code}`);
  process.exit(1);
}
if (payload?.details?.store_path !== process.env.TEMP_DB) {
  console.error(`unexpected prune missing-store path: ${payload?.details?.store_path}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("nothing can be pruned yet")) {
  console.error(`unexpected prune missing-store message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "prune missing-store assertion failed"

run_mcp '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"gateway_runtime_config","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("gateway_runtime_config unavailable response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "gateway_runtime_config_error") {
  console.error(`unexpected gateway_runtime_config unavailable code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "gateway_runtime_config unavailable assertion failed"

printf 'PASS: external MCP observability negative contract checks succeeded\n'
