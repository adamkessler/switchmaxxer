#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${REPO_ROOT}/tests/lib/common.sh"

FAILURES=0

OBSERVABILITY_SHELL_TESTS=(
  "tests/test-012-observability-proxy-failure.sh"
  "tests/test-025-prune.sh"
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

run_observability_suite() {
  local output
  local pass_count
  local fail_count

  if ! output="$(
    cd "${REPO_ROOT}" && npm run test:observability 2>&1
  )"; then
    printf '%s\n' "${output}"
    fail_check "npm run test:observability failed"
    return
  fi

  printf '%s\n' "${output}"

  if grep -Eq '^✔ .*' <<<"${output}"; then
    pass_check "observability node:test suite reported passing tests"
  else
    fail_check "observability node:test suite did not report passing tests"
  fi

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

  if [[ -n "${pass_count}" && "${pass_count}" -ge 1 && "${fail_count:-}" == "0" ]]; then
    pass_check "observability test runner reported pass=${pass_count} and fail=0"
  else
    fail_check "observability test runner did not report a clean passing summary"
  fi
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

printf 'Switchmaxxer test-011-observability-suite\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Shell suite additions:\n'
for script_path in "${OBSERVABILITY_SHELL_TESTS[@]}"; do
  printf '  - %s\n' "${script_path}"
done
printf '\n'

assert_repo_ready
run_observability_suite

for script_path in "${OBSERVABILITY_SHELL_TESTS[@]}"; do
  run_test_script "${script_path}"
done

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-011-observability-suite completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-011-observability-suite completed with %s failure(s).\n' "${FAILURES}"
exit 1
