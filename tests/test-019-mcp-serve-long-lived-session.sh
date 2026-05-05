#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
source "${REPO_ROOT}/tests/lib/mcp-session.sh"
TMP_DIR="$(make_tmp_dir test-019-mcp-session)"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_DB="${TMP_DIR}/observability.sqlite"
TEMP_STDERR="${TMP_DIR}/stderr.log"
RUN_ID_FILE="${TMP_DIR}/runid.txt"
MCP_READ_TIMEOUT_SECONDS=30

fail() {
  printf 'FAIL: %s\n' "$1"
  if [[ -f "${TEMP_STDERR}" ]]; then
    printf 'stderr:\n'
    cat "${TEMP_STDERR}"
  fi
  exit 1
}

register_cleanup 'kill_process "${MCPPROC_PID:-}"'
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

printf 'Switchmaxxer test-019-mcp-serve-long-lived-session\n'
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

TEMP_CONFIG="${TEMP_CONFIG}" TEMP_DB="${TEMP_DB}" node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { bootstrapObservabilityStore, closeObservabilityStore } = require("./dist/subsystems/observability/store.js");
const { ObservabilityService } = require("./dist/subsystems/observability/service.js");

const configPath = process.env.TEMP_CONFIG;
const dbPath = process.env.TEMP_DB;
if (!configPath || !dbPath) {
  throw new Error("TEMP_CONFIG and TEMP_DB are required");
}

const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.mcp = { capabilities: ["read", "mutation", "privileged"] };
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);

const catalogPath = path.join(path.dirname(configPath), "catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
catalog.models = catalog.models || {};
catalog.service_providers = catalog.service_providers || {};
catalog.routes = catalog.routes || {};
catalog.models.mcp_bench_model = {
  display_name: "MCP Bench Model",
  model_creator: "switchmaxxer"
};
catalog.service_providers.mcp_bench_provider = {
  endpoint: "http://127.0.0.1:9/v1",
  allow_private_endpoints: true,
  allow_insecure_http: true,
  api_mode: "openai-completions",
  api_key: null,
  api_key_env: null
};
catalog.routes.mcp_bench_route = {
  model: "mcp_bench_model",
  service_provider: "mcp_bench_provider",
  provider_model_id: "provider-bench-model",
  display_name: "MCP Bench Route"
};
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const store = bootstrapObservabilityStore({ dbPath });
const service = new ObservabilityService(store.db);

const makeObservation = (requestId, observedAt, event, options = {}) => ({
  id: `${requestId}-${event}-${observedAt}`,
  observed_at: observedAt,
  request_id: requestId,
  surface: "gateway",
  kind: "measurement",
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
  status_code: options.statusCode ?? null
});

const requestId = "req-mcp-long-session-repair";
for (const observation of [
  makeObservation(requestId, "2026-04-18T14:00:00.000Z", "request_received", { outcome: "started" }),
  makeObservation(requestId, "2026-04-18T14:00:00.010Z", "route_resolved", { outcome: "in_progress" }),
  makeObservation(requestId, "2026-04-18T14:00:00.020Z", "upstream_request_started", { outcome: "in_progress" }),
  makeObservation(requestId, "2026-04-18T14:00:00.040Z", "upstream_response_started", { outcome: "in_progress", statusCode: 200 }),
  makeObservation(requestId, "2026-04-18T14:00:00.050Z", "upstream_response_completed", { outcome: "in_progress", statusCode: 200 }),
  makeObservation(requestId, "2026-04-18T14:00:00.060Z", "client_response_started", { outcome: "in_progress", statusCode: 200 }),
  makeObservation(requestId, "2026-04-18T14:00:00.090Z", "client_response_completed", { outcome: "succeeded", statusCode: 200 })
]) {
  service.recordObservation(observation);
}

store.db.prepare("UPDATE request_executions SET outcome = 'failed' WHERE request_id = ?").run(requestId);
closeObservabilityStore(store);
NODE

coproc MCPPROC { SWITCHMAXXER_TEST_INBOUND_KEY="test-inbound-key" SWITCHMAXXER_OBSERVABILITY_DB="${TEMP_DB}" node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"; }

request_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"switchmaxxer-long-session-test","version":"1.0.0"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
if (response?.result?.capabilities?.tools?.listChanged !== false) {
  console.error("initialize response did not expose expected tools capability");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "initialize assertion failed"

request_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const toolNames = (response?.result?.tools || []).map((tool) => tool.name);
for (const required of ["models_create", "routes_create", "trace_list", "bench_run", "bench_show", "trace_repair", "trace_show"]) {
  if (!toolNames.includes(required)) {
    console.error(`missing tool '${required}' in long-lived session`);
    process.exit(1);
  }
}
NODE
[[ $? -eq 0 ]] || fail "tools/list assertion failed"

request_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"models_create","arguments":{"model_id":"mcp_session_model","display_name":"MCP Session Model","model_creator":"switchmaxxer"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_session_model") {
  console.error("models_create failed in long-lived session");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_create assertion failed"

request_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"routes_create","arguments":{"route_id":"mcp_session_route","model":"mcp_session_model","service_provider":"openai_direct","provider_model_id":"gpt-4o-mini","display_name":"MCP Session Route"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_session_route") {
  console.error("routes_create failed in long-lived session");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_create assertion failed"

send_mcp '{"jsonrpc":"2.0","id":4.1,"method":"tools/call","params":{"name":"models_update","arguments":{"model_id":"mcp_session_model","display_name":"MCP Session Model Queued"}}}'
send_mcp '{"jsonrpc":"2.0","id":4.2,"method":"tools/call","params":{"name":"models_update","arguments":{"model_id":"mcp_session_model","model_creator":"switchmaxxer-queued"}}}'

read_mcp
FIRST_RESPONSE="${MCP_RESPONSE}"
read_mcp
SECOND_RESPONSE="${MCP_RESPONSE}"

FIRST_RESPONSE="${FIRST_RESPONSE}" SECOND_RESPONSE="${SECOND_RESPONSE}" TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const first = JSON.parse(process.env.FIRST_RESPONSE || "");
const second = JSON.parse(process.env.SECOND_RESPONSE || "");
for (const response of [first, second]) {
  const payload = response?.result?.structuredContent;
  if (payload?.ok !== true) {
    console.error("queued models_update failed in long-lived session");
    process.exit(1);
  }
}

const catalogPath = path.join(path.dirname(process.env.TEMP_CONFIG), "catalog.json");
const document = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const model = document?.models?.mcp_session_model;
if (!model || model.display_name !== "MCP Session Model Queued") {
  console.error(`queued models_update lost display_name: ${model?.display_name}`);
  process.exit(1);
}
if (model.model_creator !== "switchmaxxer-queued") {
  console.error(`queued models_update lost model_creator: ${model?.model_creator}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "queued models_update assertion failed"

request_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"trace_list","arguments":{"route_id":"route-alpha","limit":10}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.count !== 1) {
  console.error("trace_list failed in long-lived session");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_list assertion failed"

request_mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"bench_run","arguments":{"route_id":"mcp_bench_route","prompt":"ping","iterations":1,"warmup":0,"concurrency":1,"path_mode":"direct"}}}'
RESPONSE="${MCP_RESPONSE}" RUN_ID_FILE="${RUN_ID_FILE}" node - <<'NODE'
const fs = require("node:fs");
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.sample_count !== 1 || "count" in payload) {
  console.error("bench_run failed in long-lived session");
  process.exit(1);
}
const runId = payload?.data?.run?.run_id;
if (typeof runId !== "string" || runId.length === 0) {
  console.error("bench_run did not return a run_id");
  process.exit(1);
}
fs.writeFileSync(process.env.RUN_ID_FILE, runId);
NODE
[[ $? -eq 0 ]] || fail "bench_run assertion failed"

RUN_ID="$(cat "${RUN_ID_FILE}")"
request_mcp "$(printf '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"bench_show","arguments":{"run_id":"%s"}}}' "${RUN_ID}")"
RESPONSE="${MCP_RESPONSE}" RUN_ID="${RUN_ID}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.run?.run_id !== process.env.RUN_ID) {
  console.error("bench_show failed in long-lived session");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_show assertion failed"

request_mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"trace_repair","arguments":{"trace_id":"req-mcp-long-session-repair"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.results?.[0]?.verification?.status !== "ok") {
  console.error("trace_repair failed in long-lived session");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_repair assertion failed"

request_mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"trace_show","arguments":{"trace_id":"req-mcp-long-session-repair"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.trace?.trace_id !== "req-mcp-long-session-repair") {
  console.error("trace_show failed in long-lived session");
  process.exit(1);
}
if (payload?.data?.trace?.outcome !== "succeeded") {
  console.error(`trace_show returned unexpected repaired outcome: ${payload?.data?.trace?.outcome}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_show assertion failed"

exec {MCPPROC[1]}>&-

printf 'PASS: external MCP long-lived session contract checks succeeded\n'
