#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
source "${REPO_ROOT}/tests/lib/mcp-session.sh"
TMP_DIR="$(make_tmp_dir test-022-race)"
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

printf 'Switchmaxxer test-022-race-test\n'
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

coproc MCPPROC { node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"; }

request_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"switchmaxxer-race-test","version":"1.0.0"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
if (response?.result?.capabilities?.tools?.listChanged !== false) {
  console.error("initialize response did not expose expected tools capability");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "initialize assertion failed"

request_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"models_create","arguments":{"model_id":"mcp_race_model","display_name":"MCP Race Model","model_creator":"switchmaxxer"}}}'
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
const payload = response?.result?.structuredContent;
if (payload?.ok !== true || payload?.data?.name !== "mcp_race_model") {
  console.error("models_create failed in race test");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "models_create assertion failed"

send_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"models_update","arguments":{"model_id":"mcp_race_model","display_name":"MCP Race Model Queued"}}}'
send_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"models_update","arguments":{"model_id":"mcp_race_model","model_creator":"switchmaxxer-queued"}}}'

read_mcp
FIRST_RESPONSE="${MCP_RESPONSE}"
read_mcp
SECOND_RESPONSE="${MCP_RESPONSE}"

FIRST_RESPONSE="${FIRST_RESPONSE}" SECOND_RESPONSE="${SECOND_RESPONSE}" TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");

const first = JSON.parse(process.env.FIRST_RESPONSE || "");
const second = JSON.parse(process.env.SECOND_RESPONSE || "");
for (const response of [first, second]) {
  const payload = response?.result?.structuredContent;
  if (payload?.ok !== true) {
    console.error("queued models_update failed in race test");
    process.exit(1);
  }
}

const path = require("node:path");
const configPath = process.env.TEMP_CONFIG;
const catalogPath = path.join(path.dirname(configPath), "catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const model = catalog?.models?.mcp_race_model;
if (!model || model.display_name !== "MCP Race Model Queued") {
  console.error(`queued models_update lost display_name: ${model?.display_name}`);
  process.exit(1);
}
if (model.model_creator !== "switchmaxxer-queued") {
  console.error(`queued models_update lost model_creator: ${model?.model_creator}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "queued models_update assertion failed"

exec {MCPPROC[1]}>&-

printf 'PASS: race-test MCP queued mutation checks succeeded\n'
