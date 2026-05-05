#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="${ROOT_DIR}/switchmaxxer"
source "${ROOT_DIR}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-029-cli-equals-flags)"
CONFIG="${TMP_DIR}/config.json"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

echo "Switchmaxxer test-029-cli-equals-flags"
echo "Repo: ${ROOT_DIR}"
echo "CLI: ${CLI}"

require_jq

copy_example_config_pair "${TMP_DIR}" "${ROOT_DIR}/config-examples/config.example.json" >/dev/null

export SWITCHMAXXER_INBOUND_API_KEY="${SWITCHMAXXER_INBOUND_API_KEY:-12345678901234567890123456789012}"
export SWITCHMAXXER_OPENAI_API_KEY="${SWITCHMAXXER_OPENAI_API_KEY:-test-openai-key}"
export SWITCHMAXXER_ANTHROPIC_API_KEY="${SWITCHMAXXER_ANTHROPIC_API_KEY:-test-anthropic-key}"
export SWITCHMAXXER_OPENROUTER_API_KEY="${SWITCHMAXXER_OPENROUTER_API_KEY:-test-openrouter-key}"
export SWITCHMAXXER_MINIMAX_API_KEY="${SWITCHMAXXER_MINIMAX_API_KEY:-test-minimax-key}"

validate_output="$("${CLI}" config validate --config="${CONFIG}" --json)"
assert_cli_envelope "${validate_output}" || {
  echo "FAIL: expected config validate --config=... to return a valid CLI envelope"
  exit 1
}
assert_json_expr "${validate_output}" '.ok == true and .command == "config validate"' || {
  echo "FAIL: expected config validate --config=... to succeed"
  exit 1
}

bench_list_output="$("${CLI}" bench list --limit=5 --json)"
assert_cli_envelope "${bench_list_output}" || {
  echo "FAIL: expected bench list --limit=5 to return a valid CLI envelope"
  exit 1
}
assert_json_expr "${bench_list_output}" '.ok == true and .command == "bench list"' || {
  echo "FAIL: expected bench list --limit=5 to parse successfully"
  exit 1
}

set +e
optimize_output="$(NODE_NO_WARNINGS=1 "${CLI}" optimize --model=gpt-4o-mini --objective=cost --input-tokens=-1 --config="${CONFIG}" --json 2>&1)"
optimize_status=$?
set -e

[[ ${optimize_status} -eq 2 ]] || {
  echo "FAIL: expected optimize --input-tokens=-1 to reach command handling and exit 2, got ${optimize_status}"
  exit 1
}

assert_cli_envelope "${optimize_output}" || {
  echo "FAIL: expected optimize --input-tokens=-1 to return a valid CLI envelope"
  exit 1
}
assert_json_expr "${optimize_output}" '.ok == false and .command == "optimize" and .error.code == "invalid_request"' || {
  echo "FAIL: expected optimize --input-tokens=-1 to avoid a flag-tokenization usage failure"
  exit 1
}

echo "PASS: test-029-cli-equals-flags completed successfully."
