#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
source "${REPO_ROOT}/tests/lib/mcp-session.sh"
TMP_DIR="$(make_tmp_dir test-023-mcp-framing)"
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

send_raw() {
  local payload="$1"
  printf '%s' "${payload}" >&"${MCPPROC[1]}"
}

register_cleanup 'kill_process "${MCPPROC_PID:-}"'
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

printf 'Switchmaxxer test-023-mcp-framing-recovery\n'
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

coproc MCPPROC { node "${DIST_INDEX}" mcp serve --config "${TEMP_CONFIG}" 2>"${TEMP_STDERR}"; }

# Send a malformed JSON line; the server must respond with a -32700 parse error
# and remain ready to handle subsequent valid messages.
send_raw $'this is not json\n'
read_mcp_no_timeout
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
if (response?.error?.code !== -32700) {
  console.error(`unexpected framing error code: ${response?.error?.code}`);
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "framing error assertion failed"

send_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"switchmaxxer-framing-recovery-test","version":"1.0.0"}}}'
read_mcp_no_timeout
RESPONSE="${MCP_RESPONSE}" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE || "");
if (response?.result?.capabilities?.tools?.listChanged !== false) {
  console.error("initialize response did not recover after framing failure");
  process.exit(1);
}
NODE
[[ $? -eq 0 ]] || fail "recovery initialize assertion failed"

send_mcp '{"jsonrpc":"2.0","method":"notifications/unknown","params":{"value":"ignored"}}'
if IFS= read -r -t 0.5 -u "${MCPPROC[0]}" maybe_notification_line; then
  printf 'Unexpected notification response prelude: %s\n' "${maybe_notification_line}"
  fail "server must not reply to notifications"
fi

exec {MCPPROC[1]}>&-

printf 'PASS: MCP framing recovery checks succeeded\n'
