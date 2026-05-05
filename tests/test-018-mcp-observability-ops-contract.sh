#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-018-mcp-observability-ops)"
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

printf 'Switchmaxxer test-018-mcp-observability-ops-contract\n'
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

const requestId = "req-mcp-shell-repair";
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

run_mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"trace_repair","arguments":{"trace_id":"req-mcp-shell-repair"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("trace_repair did not return a success payload");
  process.exit(1);
}
if (payload?.result_count !== 1 || "count" in payload) {
  console.error(`unexpected trace_repair result_count payload: result_count=${payload?.result_count} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.results?.[0]?.verification?.status !== "ok") {
  console.error(`unexpected trace_repair verification status: ${payload?.data?.results?.[0]?.verification?.status}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "trace_repair contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bench_run","arguments":{"route_id":"mcp_bench_route","prompt":"ping","iterations":1,"warmup":0,"concurrency":1,"path_mode":"direct"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("bench_run did not return a success payload");
  process.exit(1);
}
if (payload?.sample_count !== 1 || "count" in payload) {
  console.error(`unexpected bench_run sample_count payload: sample_count=${payload?.sample_count} count=${payload?.count}`);
  process.exit(1);
}
if (payload?.data?.run?.status !== "completed") {
  console.error(`unexpected bench_run status: ${payload?.data?.run?.status}`);
  process.exit(1);
}
if ((payload?.data?.samples || []).length !== 1) {
  console.error(`unexpected bench_run sample count: ${(payload?.data?.samples || []).length}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "bench_run contract assertion failed"

printf 'PASS: external MCP observability ops contract checks succeeded\n'
