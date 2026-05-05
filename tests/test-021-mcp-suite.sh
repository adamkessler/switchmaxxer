#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${REPO_ROOT}/tests/lib/common.sh"

FAILURES=0

MCP_TESTS=(
  "tests/test-013-mcp-cli-contract.sh"
  "tests/test-014-mcp-cli-negative-state-contract.sh"
  "tests/test-015-mcp-serve-contract.sh"
  "tests/test-016-mcp-observability-contract.sh"
  "tests/test-017-mcp-observability-negative-contract.sh"
  "tests/test-018-mcp-observability-ops-contract.sh"
  "tests/test-019-mcp-serve-long-lived-session.sh"
  "tests/test-020-mcp-config-crud-long-lived-session.sh"
  "tests/test-022-race-test.sh"
  "tests/test-023-mcp-framing-recovery.sh"
)

pass_check() {
  printf 'CHECK PASS: %s\n' "$1"
}

fail_check() {
  printf 'CHECK FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

assert_repo_ready() {
  if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
    printf 'FAIL: package.json not found at %s\n' "${REPO_ROOT}"
    exit 1
  fi
}

run_build() {
  local output

  if ! output="$(
    cd "${REPO_ROOT}" && npm run build 2>&1
  )"; then
    printf '%s\n' "${output}"
    fail_check "npm run build failed"
    return
  fi

  printf '%s\n' "${output}"
  pass_check "npm run build completed"
}

run_test_script() {
  local script_path="$1"
  local output

  printf '\n=== Running %s ===\n' "${script_path}"

  if ! output="$(
    cd "${REPO_ROOT}" && bash "${script_path}" 2>&1
  )"; then
    printf '%s\n' "${output}"
    fail_check "${script_path} failed"
    return
  fi

  printf '%s\n' "${output}"
  pass_check "${script_path} passed"
}

printf 'Switchmaxxer test-021-mcp-suite\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Suite:\n'
for script_path in "${MCP_TESTS[@]}"; do
  printf '  - %s\n' "${script_path}"
done
printf '\n'

assert_repo_ready
run_build

for script_path in "${MCP_TESTS[@]}"; do
  run_test_script "${script_path}"
done

if [[ "${FAILURES}" -eq 0 ]]; then
  printf '\nPASS: test-021-mcp-suite completed successfully.\n'
  exit 0
fi

printf '\nFAIL: test-021-mcp-suite completed with %s failure(s).\n' "${FAILURES}"
exit 1
