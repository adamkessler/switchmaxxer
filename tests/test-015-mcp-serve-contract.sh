#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-015-mcp-serve)"
TEMP_CONFIG="${TMP_DIR}/config.json"
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
      | node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"
  )" || fail "mcp serve command failed"
}
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

printf 'Switchmaxxer test-015-mcp-serve-contract\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Dist entry: %s\n' "${DIST_INDEX}"
printf 'Working config copy: %s\n\n' "${TEMP_CONFIG}"

if [[ ! -f "${DIST_INDEX}" ]]; then
  fail "built dist entry not found at ${DIST_INDEX}"
fi

if [[ ! -f "${SOURCE_CONFIG}" ]]; then
  fail "source config not found at ${SOURCE_CONFIG}"
fi

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const configPath = process.env.TEMP_CONFIG;
const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.mcp = { capabilities: ["read", "mutation", "privileged"] };
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);

const catalogPath = path.join(path.dirname(configPath), "catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
catalog.service_providers = catalog.service_providers || {};
catalog.service_providers.test_inline_secret = {
  endpoint: "https://example.invalid/v1",
  api_mode: "openai-completions",
  api_key: "sk-inline-secret"
};
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
NODE

run_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"switchmaxxer-test","version":"1.0.0"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
if (response?.result?.capabilities?.tools?.listChanged !== false) {
  console.error("initialize response did not expose expected tools capability");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "initialize contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const names = (response?.result?.tools || []).map((tool) => tool.name).sort();
const toolMap = new Map((response?.result?.tools || []).map((tool) => [tool.name, tool]));
const expected = [
  "bench_list",
  "bench_run",
  "bench_show",
  "config_schema",
  "config_show",
  "config_validate",
  "gateway_health",
  "gateway_runtime_config",
  "gateway_status",
  "ledger_list",
  "ledger_show",
  "models_create",
  "models_delete",
  "models_list",
  "models_show",
  "models_update",
  "optimize_apply",
  "optimize_list",
  "optimize_restore",
  "optimize_run",
  "optimize_show",
  "providers_clear_key",
  "providers_create",
  "providers_delete",
  "providers_list",
  "providers_set_key",
  "providers_set_key_env",
  "providers_show",
  "providers_update",
  "prune",
  "routes_create",
  "routes_delete",
  "routes_explain",
  "routes_list",
  "routes_show",
  "routes_update",
  "trace_list",
  "trace_observations",
  "trace_repair",
  "trace_show",
  "trace_stats",
  "trace_verify"
];
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  console.error(`unexpected tool names: ${JSON.stringify(names)}`);
  process.exit(1);
}
const expectedApiModes = JSON.stringify(["anthropic-messages","openai-completions"]);
const createApiModes = JSON.stringify([...(toolMap.get("providers_create")?.inputSchema?.properties?.api_mode?.enum || [])].sort());
const updateApiModes = JSON.stringify([...(toolMap.get("providers_update")?.inputSchema?.properties?.api_mode?.enum || [])].sort());
if (createApiModes !== expectedApiModes || updateApiModes !== expectedApiModes) {
  console.error(`unexpected provider api_mode enums: create=${createApiModes} update=${updateApiModes}`);
  process.exit(1);
}
if (toolMap.get("bench_run")?.inputSchema?.properties?.timeout_ms?.type !== "integer") {
  console.error(`bench_run did not publish timeout_ms integer schema: ${JSON.stringify(toolMap.get("bench_run")?.inputSchema?.properties?.timeout_ms)}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "tools/list contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"providers_show","arguments":{"provider_id":"test_inline_secret"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("providers_show did not return a success payload");
  process.exit(1);
}
if (payload?.data?.api_key !== "***masked***") {
  console.error(`providers_show exposed unexpected api_key value: ${payload?.data?.api_key}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_show contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"config_schema","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
const routeCost = payload?.data?.entities?.route?.fields?.cost;
const providerApiKey = payload?.data?.entities?.provider?.fields?.api_key;
if (payload?.ok !== true) {
  console.error("config_schema did not return a success payload");
  process.exit(1);
}
if (!routeCost || "flags" in routeCost || "clear_flag" in routeCost || "mutation_mode" in routeCost) {
  console.error(`config_schema exposed unexpected CLI-only fields: ${JSON.stringify(routeCost)}`);
  process.exit(1);
}
if (JSON.stringify(Object.keys(payload?.data?.entities?.model || {}).sort()) !== JSON.stringify(["delete_constraints","fields","show_includes_editability","state_errors"])) {
  console.error(`config_schema exposed unexpected model metadata keys: ${JSON.stringify(Object.keys(payload?.data?.entities?.model || {}).sort())}`);
  process.exit(1);
}
if (JSON.stringify(providerApiKey?.writable_on || []) !== JSON.stringify(["create"])) {
  console.error(`config_schema exposed unexpected provider api_key writable_on metadata: ${JSON.stringify(providerApiKey)}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "config_schema contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"config_show","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("config_show did not return a success payload");
  process.exit(1);
}
const inlineSecret =
  payload?.data?.document?.service_providers?.test_inline_secret?.api_key;
if (inlineSecret !== "***masked***") {
  console.error(`config_show exposed unexpected api_key value: ${inlineSecret}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "config_show contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"models_create","arguments":{"model_id":"mcp-shell-test-model","display_name":"MCP Shell Test Model","model_creator":"switchmaxxer"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("models_create did not return a success payload");
  process.exit(1);
}
if (payload?.data?.name !== "mcp-shell-test-model") {
  console.error(`unexpected created model name: ${payload?.data?.name}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_create contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"providers_show","arguments":{"provider_id":"test_inline_secret","unexpected":"extra"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("providers_show extra-field response should be marked as isError");
  process.exit(1);
}
if (payload?.command !== "providers show") {
  console.error(`unexpected providers_show extra-field command: ${payload?.command}`);
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected providers_show extra-field code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_show extra-field contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"providers_create","arguments":{"provider_id":"test_private_endpoint_provider","endpoint":"https://10.0.0.1/v1","api_mode":"openai-completions","no_auth":true}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("providers_create runtime-invalid response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected providers_create runtime-invalid code: ${payload?.error?.code}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("allow_private_endpoints")) {
  console.error(`unexpected providers_create runtime-invalid message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_create runtime-invalid contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"providers_set_key","arguments":{"provider_id":"test_inline_secret","api_key":"***masked***"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("providers_set_key masked-sentinel response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected providers_set_key masked-sentinel code: ${payload?.error?.code}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("masked sentinel")) {
  console.error(`unexpected providers_set_key masked-sentinel message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_set_key masked-sentinel contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"providers_create","arguments":{"provider_id":"test_masked_provider","endpoint":"https://example.invalid/v1","api_mode":"openai-completions","api_key":"***masked***"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("providers_create inline-api-key response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected providers_create inline-api-key code: ${payload?.error?.code}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("api_key")) {
  console.error(`unexpected providers_create inline-api-key message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_create inline-api-key contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"providers_create","arguments":{"provider_id":"__proto__","endpoint":"https://example.invalid/v1","api_mode":"openai-completions"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("providers_create reserved-id response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "invalid_input_field") {
  console.error(`unexpected providers_create reserved-id code: ${payload?.error?.code}`);
  process.exit(1);
}
if (!String(payload?.error?.message || "").includes("reserved")) {
  console.error(`unexpected providers_create reserved-id message: ${payload?.error?.message}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_create reserved-id contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"routes_show","arguments":{"route_id":"definitely-missing-route"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true) {
  console.error("routes_show missing-route response should be marked as isError");
  process.exit(1);
}
if (payload?.error?.code !== "route_not_found") {
  console.error(`unexpected routes_show missing-route code: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_show missing-route contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"config_validate","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("config_validate did not return a success payload");
  process.exit(1);
}
if (payload?.data?.valid !== true) {
  console.error(`unexpected config_validate valid value: ${payload?.data?.valid}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "config_validate contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"routes_explain","arguments":{"route_id":"gpt-4o-mini"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("routes_explain did not return a success payload");
  process.exit(1);
}
if (payload?.data?.name !== "gpt-4o-mini") {
  console.error(`unexpected routes_explain route name: ${payload?.data?.name}`);
  process.exit(1);
}
if (!Array.isArray(payload?.data?.explanation_lines) || payload.data.explanation_lines.length === 0) {
  console.error(`unexpected routes_explain explanation_lines: ${JSON.stringify(payload?.data?.explanation_lines)}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_explain contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"gateway_status","arguments":{}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("gateway_status did not return a success payload");
  process.exit(1);
}
if (!["running","stopped"].includes(String(payload?.data?.gateway_status))) {
  console.error(`unexpected gateway_status value: ${payload?.data?.gateway_status}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "gateway_status contract assertion failed"

run_mcp '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"gateway_health","arguments":{"check":"config"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const text = process.env.RESPONSE || "";
const response = JSON.parse(text.trim());
const payload = response?.result?.structuredContent;
if (payload?.ok !== true) {
  console.error("gateway_health did not return a success payload");
  process.exit(1);
}
if (!Array.isArray(payload?.data?.checks) || payload.data.checks[0]?.name !== "config") {
  console.error(`unexpected gateway_health checks payload: ${JSON.stringify(payload?.data?.checks)}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "gateway_health contract assertion failed"

printf 'PASS: external MCP serve contract checks succeeded\n'
