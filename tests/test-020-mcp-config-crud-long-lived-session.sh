#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
source "${REPO_ROOT}/tests/lib/mcp-session.sh"
TMP_DIR="$(make_tmp_dir test-020-mcp-config-crud)"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_STDERR="${TMP_DIR}/stderr.log"
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

printf 'Switchmaxxer test-020-mcp-config-crud-long-lived-session\n'
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
const configPath = process.env.TEMP_CONFIG;
if (!configPath) {
  throw new Error("TEMP_CONFIG is required");
}
const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.mcp = { capabilities: ["read", "mutation", "privileged"] };
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
NODE

coproc MCPPROC { SWITCHMAXXER_TEST_INBOUND_KEY="test-inbound-key" node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"; }

request_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"switchmaxxer-config-crud-test","version":"1.0.0"}}}'
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
for (const required of [
  "models_create",
  "models_update",
  "models_delete",
  "providers_create",
  "providers_update",
  "providers_set_key",
  "providers_clear_key",
  "providers_delete",
  "routes_create",
  "routes_update",
  "routes_delete"
]) {
  if (!toolNames.includes(required)) {
    console.error(`missing tool '${required}' in config CRUD session`);
    process.exit(1);
  }
}
NODE
[[ $? -eq 0 ]] || fail "tools/list assertion failed"

request_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"models_create","arguments":{"model_id":"mcp_config_model","display_name":"MCP Config Model","model_creator":"switchmaxxer","cost":{"input":0.1,"output":0.2,"cache_read":0.05,"cache_write":0.15}}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_config_model") {
  console.error("models_create failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_create assertion failed"

request_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"models_update","arguments":{"model_id":"mcp_config_model","display_name":"MCP Config Model Updated"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.display_name !== "MCP Config Model Updated") {
  console.error("models_update failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_update assertion failed"

request_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"providers_create","arguments":{"provider_id":"mcp_config_provider","endpoint":"http://127.0.0.1:9/v1","allow_private_endpoints":true,"allow_insecure_http":true,"api_mode":"openai-completions","no_auth":true}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_config_provider") {
  console.error("providers_create failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_create assertion failed"

request_mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"providers_update","arguments":{"provider_id":"mcp_config_provider","endpoint":"http://127.0.0.1:10/v1"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.endpoint !== "http://127.0.0.1:10/v1") {
  console.error("providers_update failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_update assertion failed"

request_mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"providers_set_key","arguments":{"provider_id":"mcp_config_provider","api_key":"sk-test-inline"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.api_key !== "***masked***") {
  console.error("providers_set_key failed to return masked secret");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_set_key assertion failed"

if [[ "$(stat -c '%a' "${TEMP_CONFIG}")" != "600" ]]; then
  fail "config mode should remain 600 after MCP secret mutation"
fi

request_mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"providers_update","arguments":{"provider_id":"mcp_config_provider","api_key":"***masked***"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true || payload?.error?.code !== "invalid_input_field") {
  console.error("providers_update accepted an api_key change");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_update secret-rejection assertion failed"

request_mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"routes_create","arguments":{"route_id":"mcp_config_route","model":"mcp_config_model","service_provider":"mcp_config_provider","provider_model_id":"provider-model-x","display_name":"MCP Config Route","cost":{"input":0.3,"output":0.4,"cache_read":0.1,"cache_write":0.2}}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_config_route") {
  console.error("routes_create failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_create assertion failed"

request_mcp '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"routes_update","arguments":{"route_id":"mcp_config_route","display_name":"MCP Config Route Updated"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.display_name !== "MCP Config Route Updated") {
  console.error("routes_update failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_update assertion failed"

request_mcp '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"models_delete","arguments":{"model_id":"mcp_config_model"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true || payload?.error?.code !== "model_in_use") {
  console.error(`unexpected models_delete in-use response: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_delete in-use assertion failed"

request_mcp '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"providers_delete","arguments":{"provider_id":"mcp_config_provider"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (response?.result?.isError !== true || payload?.error?.code !== "provider_in_use") {
  console.error(`unexpected providers_delete in-use response: ${payload?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_delete in-use assertion failed"

request_mcp '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"providers_clear_key","arguments":{"provider_id":"mcp_config_provider"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.api_key !== null) {
  console.error("providers_clear_key failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_clear_key assertion failed"

request_mcp '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"routes_delete","arguments":{"route_id":"mcp_config_route"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.deleted !== true) {
  console.error("routes_delete failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "routes_delete assertion failed"

request_mcp '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"models_delete","arguments":{"model_id":"mcp_config_model"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.deleted !== true) {
  console.error("models_delete failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_delete final assertion failed"

request_mcp '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"providers_delete","arguments":{"provider_id":"mcp_config_provider"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const payload = JSON.parse(process.env.RESPONSE || "")?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.deleted !== true) {
  console.error("providers_delete failed");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "providers_delete final assertion failed"

printf 'PASS: long-lived config CRUD MCP session succeeded\n'
