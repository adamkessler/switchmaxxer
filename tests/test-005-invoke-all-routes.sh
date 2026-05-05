#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
CONFIG_PATH="${1:-${REPO_ROOT}/config-examples/config.example.json}"
PROMPT_TEXT="${SWITCHMAXXER_TEST_PROMPT:-Write one short sentence about Chicago.}"

FAILURES=0
PASSES=0
TOTAL=0

pass_check() {
  PASSES=$((PASSES + 1))
}

fail_check() {
  FAILURES=$((FAILURES + 1))
}

capture_command() {
  "$@"
}

extract_route_names() {
  local routes_json="$1"

  printf '%s\n' "${routes_json}" | jq -r '.data[].name'
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

assert_gateway_running() {
  local status_json

  if ! status_json="$(capture_command "${CLI}" gateway status --config "${CONFIG_PATH}" --json)"; then
    printf 'FAIL: Unable to read gateway status.\n'
    exit 1
  fi

  if ! assert_json_expr "${status_json}" '.data.gateway_status == "running"'; then
    printf 'FAIL: Switchmaxxer gateway is not running for config %s\n' "${CONFIG_PATH}"
    exit 1
  fi
}

run_route_test() {
  local route_name="$1"
  local invoke_json
  local status_code
  local message

  TOTAL=$((TOTAL + 1))

  printf 'Route Test: %s\n' "${route_name}"

  if ! invoke_json="$(
    capture_command \
      "${CLI}" invoke \
      --route "${route_name}" \
      --prompt "${PROMPT_TEXT}" \
      --config "${CONFIG_PATH}" \
      --json
  )"; then
    printf 'Status: fail (invoke command exited non-zero)\n\n'
    fail_check
    return
  fi

  if assert_json_expr "${invoke_json}" '.ok == true and .data.status_code == 200'; then
    printf 'Status: pass\n\n'
    pass_check
    return
  fi

  status_code="$(
    printf '%s\n' "${invoke_json}" \
      | sed -n 's/.*"status_code":\([0-9][0-9]*\).*/\1/p' \
      | head -n 1
  )"
  message="$(
    printf '%s\n' "${invoke_json}" \
      | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"

  if [[ -n "${status_code}" ]]; then
    printf 'Status: fail (HTTP %s)\n\n' "${status_code}"
  elif [[ -n "${message}" ]]; then
    printf 'Status: fail (%s)\n\n' "${message}"
  else
    printf 'Status: fail\n\n'
  fi

  fail_check
}

printf 'Switchmaxxer test-005-invoke-all-routes\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Config: %s\n' "${CONFIG_PATH}"
printf 'Prompt: %s\n\n' "${PROMPT_TEXT}"

assert_cli_ready
assert_gateway_running

ROUTES_JSON="$(capture_command "${CLI}" routes list --config "${CONFIG_PATH}" --json)" || {
  printf 'FAIL: Unable to list routes from %s\n' "${CONFIG_PATH}"
  exit 1
}

ROUTE_NAMES="$(extract_route_names "${ROUTES_JSON}")"

if [[ -z "${ROUTE_NAMES}" ]]; then
  printf 'FAIL: No routes found in %s\n' "${CONFIG_PATH}"
  exit 1
fi

while IFS= read -r route_name; do
  if [[ -n "${route_name}" ]]; then
    run_route_test "${route_name}"
  fi
done <<<"${ROUTE_NAMES}"

printf 'Summary: %s total, %s pass, %s fail\n' "${TOTAL}" "${PASSES}" "${FAILURES}"

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-005-invoke-all-routes completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-005-invoke-all-routes completed with %s failure(s).\n' "${FAILURES}"
exit 1
