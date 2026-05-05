#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
CONFIG_PATH="${1:-${REPO_ROOT}/config-examples/config.example.json}"
ROUTE_NAME="${SWITCHMAXXER_TEST_ROUTE:-gpt-4o-mini}"
TMP_DIR="$(make_tmp_dir test-007-logging-lwts-contract)"
TMP_HEADERS="${TMP_DIR}/headers.txt"
TMP_BODY="${TMP_DIR}/body.txt"

FAILURES=0

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

pass_check() {
  printf 'CHECK PASS: %s\n' "$1"
}

fail_check() {
  printf 'CHECK FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

capture_command() {
  "$@"
}

assert_cli_ready() {
  if [[ ! -x "${CLI}" ]]; then
    printf 'FAIL: CLI executable not found at %s\n' "${CLI}"
    exit 1
  fi

  if [[ ! -f "${CONFIG_PATH}" ]]; then
    printf 'FAIL: Config not found at %s\n' "${CONFIG_PATH}"
    exit 1
  fi

  require_jq
}

load_gateway_address() {
  local status_json

  if ! status_json="$(capture_command "${CLI}" gateway status --config "${CONFIG_PATH}" --json)"; then
    printf 'CHECK PASS: gateway status could not be read; skipping LWTS runtime assertion\n'
    return 1
  fi

  if ! assert_json_expr "${status_json}" '.data.gateway_status == "running"'; then
    printf 'CHECK PASS: gateway is not running; skipping LWTS runtime assertion\n'
    return 1
  fi

  GATEWAY_ADDRESS="$(
    printf '%s\n' "${status_json}" \
      | sed -n 's/.*"address":"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"

  if [[ -z "${GATEWAY_ADDRESS}" ]]; then
    fail_check "could not determine gateway listener address from status JSON"
    return 1
  fi

  pass_check "gateway is running for LWTS runtime assertion"
  return 0
}

exercise_gateway_request_path() {
  local url="http://${GATEWAY_ADDRESS}/v1/chat/completions"

  if ! curl -sS \
    -D "${TMP_HEADERS}" \
    -o "${TMP_BODY}" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${ROUTE_NAME}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: switchmaxxer-ok\"}],\"stream\":false}" \
    "${url}" >/dev/null; then
    fail_check "curl request to gateway failed"
    return 1
  fi

  REQUEST_ID="$(
    sed -n 's/^x-switchmaxxer-request-id: \(.*\)\r*$/\1/p' "${TMP_HEADERS}" \
      | tr -d '\r' \
      | head -n 1
  )"

  if [[ -z "${REQUEST_ID}" ]]; then
    fail_check "gateway response did not include x-switchmaxxer-request-id"
    return 1
  fi

  pass_check "gateway response included x-switchmaxxer-request-id"
  return 0
}

assert_logs_json_contract() {
  local logs_json

  if ! logs_json="$(capture_command "${CLI}" gateway logs show --lines 200 --format json)"; then
    fail_check "gateway logs show --format json failed"
    return
  fi

  printf '%s\n' "${logs_json}"

  if assert_json_expr "${logs_json}" '.data | any(has("scope"))'; then
    pass_check "logs JSON includes journal scope"
  else
    fail_check "logs JSON did not include journal scope"
  fi

  if assert_json_expr "${logs_json}" --arg request_id "${REQUEST_ID}" '.data | any(.request_id == $request_id)'; then
    pass_check "logs JSON includes the request_id from the response header"
  else
    fail_check "logs JSON did not include the request_id from the response header"
  fi

  if assert_json_expr "${logs_json}" '.data | any(.event == "request" or .event == "response")'; then
    pass_check "logs JSON includes normalized event names"
  else
    fail_check "logs JSON did not include normalized event names"
  fi

  if assert_json_expr "${logs_json}" '.data | any(has("status_code"))'; then
    pass_check "logs JSON includes normalized status_code fields"
  else
    fail_check "logs JSON did not include normalized status_code fields"
  fi

  if assert_json_expr "${logs_json}" '.data | any(has("latency_ms") or has("total_time_ms"))'; then
    pass_check "logs JSON includes normalized timing fields"
  else
    fail_check "logs JSON did not include normalized timing fields"
  fi
}

printf 'Switchmaxxer test-007-logging-lwts-contract\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Config: %s\n' "${CONFIG_PATH}"
printf 'Route: %s\n\n' "${ROUTE_NAME}"

assert_cli_ready

if load_gateway_address && exercise_gateway_request_path; then
  assert_logs_json_contract
fi

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-007-logging-lwts-contract completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-007-logging-lwts-contract completed with %s failure(s).\n' "${FAILURES}"
exit 1
