#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-001-model-create-delete)"
TEMP_CONFIG="${TMP_DIR}/config.json"
MODEL_NAME="test-model"
DISPLAY_NAME="Test Model"
MODEL_CREATOR="openai"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

FAILURES=0

export SWITCHMAXXER_INBOUND_API_KEY="${SWITCHMAXXER_INBOUND_API_KEY:-12345678901234567890123456789012}"
export SWITCHMAXXER_OPENAI_API_KEY="${SWITCHMAXXER_OPENAI_API_KEY:-test-openai-key}"
export SWITCHMAXXER_ANTHROPIC_API_KEY="${SWITCHMAXXER_ANTHROPIC_API_KEY:-test-anthropic-key}"
export SWITCHMAXXER_OPENROUTER_API_KEY="${SWITCHMAXXER_OPENROUTER_API_KEY:-test-openrouter-key}"
export SWITCHMAXXER_MINIMAX_API_KEY="${SWITCHMAXXER_MINIMAX_API_KEY:-test-minimax-key}"

print_step() {
  local step_number="$1"
  local message="$2"
  printf '\n[%s] %s\n' "${step_number}" "${message}"
}

run_and_show() {
  local description="$1"
  shift

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

assert_model_absent() {
  local context="$1"
  local json_output

  if ! json_output="$(capture_command "${CLI}" models list --config "${TEMP_CONFIG}" --json)"; then
    fail_check "${context}: unable to read models list for absence check"
    return
  fi

  if assert_json_expr "${json_output}" --arg model_name "${MODEL_NAME}" '.data | any(.name == $model_name)'; then
    fail_check "${context}: model '${MODEL_NAME}' should be absent"
  else
    pass_check "${context}: model '${MODEL_NAME}' is absent"
  fi
}

assert_model_present() {
  local context="$1"
  local json_output

  if ! json_output="$(capture_command "${CLI}" models list --config "${TEMP_CONFIG}" --json)"; then
    fail_check "${context}: unable to read models list for presence check"
    return
  fi

  if assert_json_expr "${json_output}" --arg model_name "${MODEL_NAME}" '.data | any(.name == $model_name)'; then
    pass_check "${context}: model '${MODEL_NAME}' is present"
  else
    fail_check "${context}: model '${MODEL_NAME}' should be present"
  fi
}

printf 'Switchmaxxer test-001-model-create-delete\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Working config copy: %s\n' "${TEMP_CONFIG}"

if [[ ! -x "${CLI}" ]]; then
  printf '\nFAIL: CLI executable not found at %s\n' "${CLI}"
  exit 1
fi

if [[ ! -f "${SOURCE_CONFIG}" ]]; then
  printf '\nFAIL: Source config not found at %s\n' "${SOURCE_CONFIG}"
  exit 1
fi

require_jq

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

print_step "1" "Check models via the CLI"
run_and_show "models list" "${CLI}" models list --config "${TEMP_CONFIG}"

print_step "2" "Verify there is no '${MODEL_NAME}'"
assert_model_absent "before create"

print_step "3" "Add '${MODEL_NAME}' via the CLI"
if run_and_show "models create" \
  "${CLI}" models create "${MODEL_NAME}" \
  --display-name "${DISPLAY_NAME}" \
  --model-creator "${MODEL_CREATOR}" \
  --config "${TEMP_CONFIG}"
then
  pass_check "create command succeeded"
else
  fail_check "create command failed"
fi

print_step "4" "Check models via the CLI"
run_and_show "models list" "${CLI}" models list --config "${TEMP_CONFIG}"

print_step "5" "Verify there is a '${MODEL_NAME}'"
assert_model_present "after create"

print_step "6" "Remove '${MODEL_NAME}' via the CLI"
if run_and_show "models delete" \
  "${CLI}" models delete "${MODEL_NAME}" \
  --config "${TEMP_CONFIG}"
then
  pass_check "delete command succeeded"
else
  fail_check "delete command failed"
fi

print_step "7" "Check models via the CLI"
run_and_show "models list" "${CLI}" models list --config "${TEMP_CONFIG}"

print_step "8" "Verify there is no '${MODEL_NAME}'"
assert_model_absent "after delete"

printf '\n'
if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-001-model-create-delete completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-001-model-create-delete completed with %s failure(s).\n' "${FAILURES}"
exit 1
