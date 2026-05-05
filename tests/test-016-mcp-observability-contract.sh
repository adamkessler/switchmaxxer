#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-016-mcp-observability)"
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

printf 'Switchmaxxer test-016-mcp-observability-contract\n'
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

TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");
const configPath = process.env.TEMP_CONFIG;
if (!configPath) {
  throw new Error("TEMP_CONFIG is required");
}
const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.mcp = { capabilities: ["read", "mutation", "privileged"] };
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
NODE

TEMP_DB="${TEMP_DB}" node - <<'NODE'
const { bootstrapObservabilityStore, closeObservabilityStore } = require("./dist/subsystems/observability/store.js");
const { ObservabilityService } = require("./dist/subsystems/observability/service.js");

const dbPath = process.env.TEMP_DB;
if (!dbPath) {
  throw new Error("TEMP_DB is required");
}

const store = bootstrapObservabilityStore({ dbPath });
const service = new ObservabilityService(store.db);

const makeObservation = (requestId, observedAt, event, options = {}) => ({
  id: `${requestId}-${event}-${observedAt}`,
  observed_at: observedAt,
  request_id: requestId,
  surface: "gateway",
  kind: options.kind ?? (String(event).startsWith("debug_") ? "debug" : "measurement"),
  event,
  stage:
    event === "request_received"
      ? "ingress"
      : event === "route_resolved"
        ? "route_resolution"
        : event === "upstream_request_started"
          ? "upstream_request"
          : event === "upstream_response_started" || event === "upstream_response_completed"
            ? "upstream_response"
            : "client_response",
  outcome: options.outcome,
  route_id: "route-alpha",
  route_name: "route-alpha",
  model_id: "model-alpha",
  provider_id: "provider-main",
  provider_model_id: "provider-model-1",
  client_api_mode: "openai",
  upstream_api_mode: "openai-completions",
  status_code: options.statusCode ?? null,
  latency_ms: options.latencyMs ?? null,
  ttft_ms: options.ttftMs ?? null,
  duration_ms: options.durationMs ?? null,
  input_tokens: options.inputTokens ?? null,
  output_tokens: options.outputTokens ?? null,
  total_tokens: options.totalTokens ?? null,
  estimated_cost_micros: options.estimatedCostMicros ?? null,
  currency: options.currency ?? null,
  attributes_json: options.attributes ? JSON.stringify(options.attributes) : null,
  tags_json: options.tags ? JSON.stringify(options.tags) : null,
  message: options.message ?? null
});

const requestId = "req-mcp-shell-observability";
const observations = [
  makeObservation(requestId, "2026-04-18T14:00:00.000Z", "request_received", { outcome: "started" }),
  makeObservation(requestId, "2026-04-18T14:00:00.010Z", "route_resolved", { outcome: "in_progress" }),
  makeObservation(requestId, "2026-04-18T14:00:00.020Z", "upstream_request_started", { outcome: "in_progress" }),
  makeObservation(requestId, "2026-04-18T14:00:00.040Z", "upstream_response_started", {
    outcome: "in_progress",
    statusCode: 200,
    ttftMs: 20
  }),
  makeObservation(requestId, "2026-04-18T14:00:00.050Z", "upstream_response_completed", {
    outcome: "succeeded",
    statusCode: 200,
    latencyMs: 30,
    durationMs: 30,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedCostMicros: 4500,
    currency: "USD"
  }),
  makeObservation(requestId, "2026-04-18T14:00:00.060Z", "client_response_started", {
    outcome: "in_progress",
    statusCode: 200
  }),
  makeObservation(requestId, "2026-04-18T14:00:00.090Z", "client_response_completed", {
    outcome: "succeeded",
    statusCode: 200,
    latencyMs: 90,
    durationMs: 90,
    message: "Request completed"
  })
];

for (const observation of observations) {
  service.recordObservation(observation);
}

service.benchmarks.createRun({
  id: "bench-mcp-shell-1",
  name: "mcp-shell-bench",
  created_at: "2026-04-18T14:10:00.000Z",
  created_by: "switchmaxxer bench",
  objective: "route_benchmark",
  notes: "MCP shell observability test",
  status: "completed",
  settings_json: JSON.stringify({
    requested_path_mode: "direct",
    effective_paths: ["direct"],
    skipped_paths: [],
    warnings: []
  })
});

service.benchmarks.insertSample({
  id: "bench-mcp-shell-sample-1",
  benchmark_run_id: "bench-mcp-shell-1",
  request_execution_id: requestId,
  route_id: "route-alpha",
  provider_id: "provider-main",
  provider_model_id: "provider-model-1",
  sample_index: 0,
  started_at: "2026-04-18T14:10:01.000Z",
  completed_at: "2026-04-18T14:10:01.150Z",
  status_code: 200,
  outcome: "succeeded",
  latency_ms: 150,
  ttft_ms: 80,
  duration_ms: 150,
  input_tokens: 10,
  output_tokens: 20,
  total_tokens: 30,
  estimated_cost_micros: 4500,
  is_warmup: 0,
  score_value: 0.95,
  score_scale: "0_to_1",
  score_direction: "higher_is_better",
  score_source: "synthetic",
  score_method: "latency",
  score_json: JSON.stringify({ path: "direct" }),
  scored_at: "2026-04-18T14:10:01.160Z"
});

closeObservabilityStore(store);
NODE

run_mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"trace_list","arguments":{"route_id":"route-alpha","limit":10}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_list did not return a success payload");
  process.exit(1);
}
if (payload?.count !== 1) {
  console.error(`unexpected trace_list count: ${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.traces?.[0]?.trace_id !== "req-mcp-shell-observability") {
  console.error(`unexpected trace_list trace id: ${payload?.data?.traces?.[0]?.trace_id}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_list contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trace_show","arguments":{"trace_id":"req-mcp-shell-observability"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_show did not return a success payload");
  process.exit(1);
}
if (payload?.observation_count !== (payload?.data?.observations || []).length || "count" in payload) {
  console.error(`unexpected trace_show observation_count payload: observation_count=${payload?.observation_count} observations_length=${(payload?.data?.observations || []).length} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.trace?.trace_id !== "req-mcp-shell-observability") {
  console.error(`unexpected trace_show trace id: ${payload?.data?.trace?.trace_id}`);
  process.exit(1);
}
if ((payload?.data?.benchmark_samples || []).length !== 1) {
  console.error(`unexpected trace_show benchmark sample count: ${(payload?.data?.benchmark_samples || []).length}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_show contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"trace_stats","arguments":{"provider_id":"provider-main"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_stats did not return a success payload");
  process.exit(1);
}
if (payload?.data?.stats?.total_count !== 1) {
  console.error(`unexpected trace_stats total_count: ${payload?.data?.stats?.total_count}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_stats contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"trace_observations","arguments":{"event":"client_response_completed","limit":5}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_observations did not return a success payload");
  process.exit(1);
}
if (payload?.count !== 1) {
  console.error(`unexpected trace_observations count: ${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.observations?.[0]?.event !== "client_response_completed") {
  console.error(`unexpected observation event: ${payload?.data?.observations?.[0]?.event}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_observations contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"trace_verify","arguments":{"trace_id":"req-mcp-shell-observability"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_verify did not return a success payload");
  process.exit(1);
}
if (payload?.result_count !== 1 || "count" in payload) {
  console.error(`unexpected trace_verify result_count payload: result_count=${payload?.result_count} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.details?.drifted_count !== 0) {
  console.error(`unexpected drifted_count: ${payload?.details?.drifted_count}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_verify contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"trace_verify","arguments":{"all":true,"batch_size":1}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_verify batch_size did not return a success payload");
  process.exit(1);
}
if (payload?.data?.batch_size !== 1) {
  console.error(`unexpected trace_verify batch_size: ${payload?.data?.batch_size}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_verify batch_size contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"bench_list","arguments":{"limit":10}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("bench_list did not return a success payload");
  process.exit(1);
}
if (payload?.count !== 1) {
  console.error(`unexpected bench_list count: ${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.runs?.[0]?.run_id !== "bench-mcp-shell-1") {
  console.error(`unexpected bench_list run id: ${payload?.data?.runs?.[0]?.run_id}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_list contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"bench_show","arguments":{"run_id":"bench-mcp-shell-1"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("bench_show did not return a success payload");
  process.exit(1);
}
if (payload?.sample_count !== 1 || "count" in payload) {
  console.error(`unexpected bench_show sample_count payload: sample_count=${payload?.sample_count} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.run?.run_id !== "bench-mcp-shell-1") {
  console.error(`unexpected bench_show run id: ${payload?.data?.run?.run_id}`);
  process.exit(1);
}
if (payload?.data?.samples?.[0]?.sample_id !== "bench-mcp-shell-sample-1") {
  console.error(`unexpected bench_show sample id: ${payload?.data?.samples?.[0]?.sample_id}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_show contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"prune","arguments":{"older_than":"1h"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("prune did not return a success payload");
  process.exit(1);
}
if (payload?.deleted_count !== 10 || "count" in payload) {
  console.error(`unexpected prune deleted_count payload: deleted_count=${payload?.deleted_count} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.older_than !== "1h") {
  console.error(`unexpected prune older_than: ${payload?.data?.older_than}`);
  process.exit(1);
}
if (payload?.data?.result?.total_deleted !== 10) {
  console.error(`unexpected prune total_deleted: ${payload?.data?.result?.total_deleted}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "prune contract assertion failed"

printf 'PASS: external MCP observability contract checks succeeded\n'
