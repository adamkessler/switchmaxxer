#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${REPO_ROOT}/tests/lib/common.sh"

FAILURES=0

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

run_proxy_failure_test() {
  local output
  local pass_count
  local fail_count
  local pattern='proxy chat completion upstream failure records error observations and failed request execution'

  if ! output="$(
    cd "${REPO_ROOT}" \
      && npm run build \
      && node --enable-source-maps --test --test-reporter=spec --test-name-pattern "${pattern}" dist/subsystems/observability/observability.test.js 2>&1
  )"; then
    printf '%s\n' "${output}"
    fail_check "proxy failure observability test command failed"
    return
  fi

  printf '%s\n' "${output}"

  pass_check "targeted proxy failure observability test command completed"

  pass_count="$(
    printf '%s\n' "${output}" \
      | sed -n 's/^ℹ pass \([0-9][0-9]*\)$/\1/p' \
      | tail -n 1
  )"
  fail_count="$(
    printf '%s\n' "${output}" \
      | sed -n 's/^ℹ fail \([0-9][0-9]*\)$/\1/p' \
      | tail -n 1
  )"

  if [[ "${pass_count:-0}" -ge 1 && "${fail_count:-}" == "0" ]]; then
    pass_check "proxy failure observability test reported pass=${pass_count} and fail=0"
  else
    fail_check "proxy failure observability test did not report a clean passing summary"
  fi
}

printf 'Switchmaxxer test-012-observability-proxy-failure\n'
printf 'Repo: %s\n\n' "${REPO_ROOT}"

assert_repo_ready
run_proxy_failure_test

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-012-observability-proxy-failure completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-012-observability-proxy-failure completed with %s failure(s).\n' "${FAILURES}"
exit 1
