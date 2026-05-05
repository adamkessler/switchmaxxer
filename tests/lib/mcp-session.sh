#!/usr/bin/env bash

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${COMMON_DIR}/common.sh"

MCP_READ_TIMEOUT_SECONDS="${MCP_READ_TIMEOUT_SECONDS:-30}"

_mcp_fail() {
  local message="$1"
  if declare -F fail >/dev/null 2>&1; then
    fail "${message}"
  else
    printf 'FAIL: %s\n' "${message}" >&2
    exit 1
  fi
}

send_mcp() {
  local request_json="$1"
  printf '%s\n' "${request_json}" >&"${MCPPROC[1]}"
}

read_mcp() {
  local body=""
  local timeout="${MCP_READ_TIMEOUT_SECONDS:-30}"

  if ! IFS= read -r -t "${timeout}" -u "${MCPPROC[0]}" body; then
    _mcp_fail "timed out waiting for MCP response"
  fi

  body="${body%$'\r'}"
  MCP_RESPONSE="${body}"
}

request_mcp() {
  send_mcp "$1"
  read_mcp
}

read_mcp_no_timeout() {
  local body=""

  if ! IFS= read -r -u "${MCPPROC[0]}" body; then
    _mcp_fail "MCP stream closed before response was received"
  fi

  body="${body%$'\r'}"
  MCP_RESPONSE="${body}"
}
