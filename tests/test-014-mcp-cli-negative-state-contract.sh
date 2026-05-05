#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-014-mcp-cli-negative-state-contract)"
TEMP_CONFIG="${TMP_DIR}/config.json"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

FAILURES=0

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

assert_json_error_code() {
  local description="$1"
  local json_input="$2"
  local expected_command="$3"
  local expected_code="$4"

  if assert_json_expr "${json_input}" ".ok == false and .command == \"${expected_command}\" and .error.code == \"${expected_code}\""; then
    pass_check "${description}"
  else
    fail_check "${description}"
  fi
}

printf 'Switchmaxxer test-014-mcp-cli-negative-state-contract\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Working config copy: %s\n\n' "${TEMP_CONFIG}"

if [[ ! -x "${CLI}" ]]; then
  printf 'FAIL: CLI executable not found at %s\n' "${CLI}"
  exit 1
fi

if [[ ! -f "${SOURCE_CONFIG}" ]]; then
  printf 'FAIL: Source config not found at %s\n' "${SOURCE_CONFIG}"
  exit 1
fi

require_jq

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

printf '[1] Validate not-found error codes\n'
missing_model_json="$(capture_command "${CLI}" models delete definitely-missing-model --config "${TEMP_CONFIG}" --json 2>/dev/null || true)"
printf '%s\n' "${missing_model_json}"
assert_json_error_code \
  "models delete returns model_not_found" \
  "${missing_model_json}" \
  "models delete" \
  "model_not_found"

missing_provider_json="$(capture_command "${CLI}" providers show definitely-missing-provider --config "${TEMP_CONFIG}" --json 2>/dev/null || true)"
printf '%s\n' "${missing_provider_json}"
assert_json_error_code \
  "providers show returns provider_not_found" \
  "${missing_provider_json}" \
  "providers show" \
  "provider_not_found"

missing_route_json="$(capture_command "${CLI}" routes show definitely-missing-route --config "${TEMP_CONFIG}" --json 2>/dev/null || true)"
printf '%s\n' "${missing_route_json}"
assert_json_error_code \
  "routes show returns route_not_found" \
  "${missing_route_json}" \
  "routes show" \
  "route_not_found"

printf '\n[2] Validate in-use state error codes\n'
model_in_use_json="$(capture_command "${CLI}" models delete gpt-4o-mini --config "${TEMP_CONFIG}" --json 2>/dev/null || true)"
printf '%s\n' "${model_in_use_json}"
assert_json_error_code \
  "models delete returns model_in_use when routes still reference the model" \
  "${model_in_use_json}" \
  "models delete" \
  "model_in_use"

provider_in_use_json="$(capture_command "${CLI}" providers delete openai_direct --config "${TEMP_CONFIG}" --json 2>/dev/null || true)"
printf '%s\n' "${provider_in_use_json}"
assert_json_error_code \
  "providers delete returns provider_in_use when routes still reference the provider" \
  "${provider_in_use_json}" \
  "providers delete" \
  "provider_in_use"

printf '\n[3] Validate unknown reference error codes\n'
unknown_model_json="$(
  capture_command "${CLI}" routes create test-negative-route \
    --model definitely-missing-model \
    --service-provider openai_direct \
    --provider-model-id definitely-missing-model \
    --display-name "Negative Route" \
    --config "${TEMP_CONFIG}" \
    --json 2>/dev/null || true
)"
printf '%s\n' "${unknown_model_json}"
assert_json_error_code \
  "routes create returns unknown_model for a missing model reference" \
  "${unknown_model_json}" \
  "routes create" \
  "unknown_model"

unknown_provider_json="$(
  capture_command "${CLI}" routes create test-negative-route \
    --model gpt-4o-mini \
    --service-provider definitely-missing-provider \
    --provider-model-id gpt-4o-mini \
    --display-name "Negative Route" \
    --config "${TEMP_CONFIG}" \
    --json 2>/dev/null || true
)"
printf '%s\n' "${unknown_provider_json}"
assert_json_error_code \
  "routes create returns unknown_service_provider for a missing provider reference" \
  "${unknown_provider_json}" \
  "routes create" \
  "unknown_service_provider"

printf '\n'
if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-014-mcp-cli-negative-state-contract completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-014-mcp-cli-negative-state-contract completed with %s failure(s).\n' "${FAILURES}"
exit 1
