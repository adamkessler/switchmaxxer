#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
CONFIG_PATH="${1:-${REPO_ROOT}/config-examples/config.example.json}"
ROUTE_NAME="${SWITCHMAXXER_TEST_ROUTE:-gpt-4o-mini}"
PROMPT_TEXT="${SWITCHMAXXER_TEST_PROMPT:-Write one sentence about Chicago.}"
TMP_DIR="$(make_tmp_dir test-004-invoke-content-encoding-regression)"
HEADER_OUTPUT="${TMP_DIR}/headers.txt"
BODY_OUTPUT="${TMP_DIR}/body.txt"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

FAILURES=0

print_step() {
  local step_number="$1"
  local message="$2"
  printf '\n[%s] %s\n' "${step_number}" "${message}"
}

run_and_show() {
  printf '$'
  for arg in "$@"; do
    printf ' %q' "${arg}"
  done
  printf '\n'

  "$@"
}

capture_command() {
  "$@"
}

pass_check() {
  printf 'CHECK PASS: %s\n' "$1"
}

fail_check() {
  printf 'CHECK FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

require_command() {
  local command_name="$1"

  if command -v "${command_name}" >/dev/null 2>&1; then
    pass_check "required command '${command_name}' is available"
  else
    fail_check "required command '${command_name}' is missing"
  fi
}

assert_gateway_running() {
  local status_json

  if ! status_json="$(capture_command "${CLI}" gateway status --config "${CONFIG_PATH}" --json)"; then
    fail_check "unable to read gateway status"
    return 1
  fi

  if assert_json_expr "${status_json}" '.data.gateway_status == "running"'; then
    pass_check "gateway is running"
    return 0
  fi

  fail_check "gateway is not running"
  return 1
}

assert_invoke_succeeds() {
  local invoke_json

  if ! invoke_json="$(
    capture_command \
      "${CLI}" invoke \
      --route "${ROUTE_NAME}" \
      --prompt "${PROMPT_TEXT}" \
      --config "${CONFIG_PATH}" \
      --json
  )"; then
    fail_check "invoke command exited non-zero"
    return 1
  fi

  printf '%s\n' "${invoke_json}"

  if assert_json_expr "${invoke_json}" '.ok == true and .data.status_code == 200'; then
    pass_check "invoke returned success through the gateway path"
    return 0
  fi

  fail_check "invoke did not return a successful gateway response"
  return 1
}

read_runtime_endpoint() {
  local runtime_json
  local bind_host
  local port
  local health_url

  if ! runtime_json="$(capture_command "${CLI}" gateway status --config "${CONFIG_PATH}" --json)"; then
    return 1
  fi

  bind_host="$(
    printf '%s\n' "${runtime_json}" \
      | sed -n 's/.*"bind_host":"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"
  port="$(
    printf '%s\n' "${runtime_json}" \
      | sed -n 's/.*"port":\([0-9][0-9]*\).*/\1/p' \
      | head -n 1
  )"
  health_url="$(
    printf '%s\n' "${runtime_json}" \
      | sed -n 's/.*"health_url":"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"

  if [[ -z "${port}" ]]; then
    return 1
  fi

  if [[ -z "${bind_host}" ]]; then
    bind_host="127.0.0.1"
  fi

  printf 'Bind Host: %s\n' "${bind_host}" >&2
  printf 'Port: %s\n' "${port}" >&2
  printf 'Health URL: %s\n' "${health_url:-"(unknown)"}" >&2

  printf '%s:%s' "${bind_host}" "${port}"
}

assert_no_content_encoding_header() {
  local endpoint="$1"

  if ! curl -sS -D "${HEADER_OUTPUT}" \
    "http://${endpoint}/v1/chat/completions" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${ROUTE_NAME}\",\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT_TEXT}\"}]}" \
    -o "${BODY_OUTPUT}"
  then
    fail_check "curl request to gateway failed"
    return 1
  fi

  printf '%s\n' "--- Response Headers ---"
  cat "${HEADER_OUTPUT}"
  printf '%s\n' "--- Response Body ---"
  cat "${BODY_OUTPUT}"
  printf '\n'

  if grep -iq '^content-encoding:' "${HEADER_OUTPUT}"; then
    fail_check "gateway response still includes content-encoding"
  else
    pass_check "gateway response does not include content-encoding"
  fi

  if grep -Eq '^HTTP/[0-9.]+ 200' "${HEADER_OUTPUT}"; then
    pass_check "gateway curl response returned HTTP 200"
  else
    fail_check "gateway curl response did not return HTTP 200"
  fi

  if assert_json_file_expr "${BODY_OUTPUT}" '.choices | type == "array"'; then
    pass_check "gateway response body looks like an OpenAI chat completion"
  else
    fail_check "gateway response body does not look like a chat completion payload"
  fi
}

printf 'Switchmaxxer test-004-invoke-content-encoding-regression\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Config: %s\n' "${CONFIG_PATH}"
printf 'Route: %s\n' "${ROUTE_NAME}"
printf 'Prompt: %s\n' "${PROMPT_TEXT}"

if [[ ! -x "${CLI}" ]]; then
  printf '\nFAIL: CLI executable not found at %s\n' "${CLI}"
  exit 1
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  printf '\nFAIL: Config not found at %s\n' "${CONFIG_PATH}"
  exit 1
fi

require_jq

print_step "1" "Check required commands"
require_command "curl"

print_step "2" "Check gateway status via the CLI"
run_and_show "${CLI}" gateway status --config "${CONFIG_PATH}" --json
assert_gateway_running || true

print_step "3" "Verify invoke succeeds through the gateway"
assert_invoke_succeeds || true

print_step "4" "Inspect localhost response headers for stale content-encoding"
ENDPOINT="$(read_runtime_endpoint)" || ENDPOINT=""
if [[ -n "${ENDPOINT}" ]]; then
  assert_no_content_encoding_header "${ENDPOINT}"
else
  fail_check "unable to determine gateway bind host and port from status output"
fi

printf '\n'
if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-004-invoke-content-encoding-regression completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-004-invoke-content-encoding-regression completed with %s failure(s).\n' "${FAILURES}"
exit 1
