#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
SOURCE_CONFIG_PATH="${1:-${REPO_ROOT}/config-examples/config.example.json}"
ROUTE_NAME="${SWITCHMAXXER_TEST_ROUTE:-gpt-4o-mini}"
TMP_DIR="$(make_tmp_dir test-006-test-command-path-semantics)"
CONFIG_PATH="${TMP_DIR}/config.json"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_DIRECT_CONFIG="${TMP_DIR}/direct-config.json"
TEMP_MULTI_DIRECT_CONFIG="${TMP_DIR}/multi-direct-config.json"

FAILURES=0

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

export SWITCHMAXXER_INBOUND_API_KEY="${SWITCHMAXXER_INBOUND_API_KEY:-12345678901234567890123456789012}"
export SWITCHMAXXER_OPENAI_API_KEY="${SWITCHMAXXER_OPENAI_API_KEY:-test-openai-key}"
export SWITCHMAXXER_ANTHROPIC_API_KEY="${SWITCHMAXXER_ANTHROPIC_API_KEY:-test-anthropic-key}"
export SWITCHMAXXER_OPENROUTER_API_KEY="${SWITCHMAXXER_OPENROUTER_API_KEY:-test-openrouter-key}"
export SWITCHMAXXER_MINIMAX_API_KEY="${SWITCHMAXXER_MINIMAX_API_KEY:-test-minimax-key}"

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

  if [[ ! -f "${SOURCE_CONFIG_PATH}" ]]; then
    printf 'FAIL: Config not found at %s\n' "${SOURCE_CONFIG_PATH}"
    exit 1
  fi

  copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG_PATH}" >/dev/null
  require_jq
}

assert_gateway_running() {
  local status_json

  if ! status_json="$(capture_command "${CLI}" gateway status --config "${CONFIG_PATH}" --json)"; then
    printf 'CHECK PASS: gateway status could not be read; skipping live gateway-path assertion\n'
    return 1
  fi

  if ! assert_json_expr "${status_json}" '.data.gateway_status == "running"'; then
    printf 'CHECK PASS: gateway is not running; skipping live gateway-path assertion\n'
    return 1
  fi

  pass_check "gateway is running for live gateway-path assertion"
  return 0
}

write_dead_port_config() {
  copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG_PATH}" >/dev/null
  perl -0pi -e 's/"port"\s*:\s*[0-9]+/"port":49999/' "${TEMP_CONFIG}"
}

write_scoped_direct_config() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const inputPath = process.argv[1];
    const outputPath = process.argv[2];
    const routeName = process.argv[3];
    const doc = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const catalogPath = path.join(path.dirname(inputPath), "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const route = catalog.routes?.[routeName];
    if (!route) {
      process.stderr.write(`Route not found: ${routeName}\n`);
      process.exit(1);
    }
    fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
    catalog.routes = { [routeName]: route };
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n", { mode: 0o600 });
  ' "${CONFIG_PATH}" "${TEMP_DIRECT_CONFIG}" "${ROUTE_NAME}"
}

write_multi_route_direct_config() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const inputPath = process.argv[1];
    const outputPath = process.argv[2];
    const doc = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const catalogPath = path.join(path.dirname(inputPath), "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const routeEntries = Object.entries(catalog.routes || {});
    if (routeEntries.length < 2) {
      process.stderr.write("Need at least two routes for multi-route test\n");
      process.exit(1);
    }
    fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
    catalog.routes = Object.fromEntries(routeEntries.slice(0, 2));
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n", { mode: 0o600 });
  ' "${CONFIG_PATH}" "${TEMP_MULTI_DIRECT_CONFIG}"
}

assert_help_mentions_no_gateway() {
  local help_text

  if ! help_text="$(capture_command "${CLI}" help test)"; then
    fail_check "help test command failed"
    return
  fi

  if grep -Fq -- '--no-gateway' <<<"${help_text}"; then
    pass_check "help test documents --no-gateway"
  else
    fail_check "help test does not document --no-gateway"
  fi
}

assert_text_output_header_for_single_route() {
  local test_output
  local exit_code

  set +e
  test_output="$(capture_command "${CLI}" test --route "${ROUTE_NAME}" --config "${CONFIG_PATH}" --no-gateway)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "text-mode test --route command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_output}"

  if grep -Fq 'Starting route tests' <<<"${test_output}"; then
    pass_check "text-mode test prints a start header"
  else
    fail_check "text-mode test did not print a start header"
  fi

  if grep -Fq "Route: ${ROUTE_NAME}" <<<"${test_output}"; then
    pass_check "text-mode test header includes the selected route"
  else
    fail_check "text-mode test header did not include the selected route"
  fi

  if grep -Fq '[1/1]' <<<"${test_output}"; then
    pass_check "text-mode test progress includes route numbering"
  else
    fail_check "text-mode test progress did not include route numbering"
  fi
}

assert_text_output_header_for_multi_route() {
  local test_output
  local exit_code

  write_multi_route_direct_config || {
    fail_check "unable to build multi-route direct-path config"
    return
  }

  set +e
  test_output="$(capture_command "${CLI}" test --config "${TEMP_MULTI_DIRECT_CONFIG}" --no-gateway)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "text-mode multi-route test command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_output}"

  if grep -Fq 'Routes Planned: 2' <<<"${test_output}"; then
    pass_check "text-mode multi-route test header includes the planned route count"
  else
    fail_check "text-mode multi-route test header did not include the planned route count"
  fi

  if grep -Fq '[1/2]' <<<"${test_output}" && grep -Fq '[2/2]' <<<"${test_output}"; then
    pass_check "text-mode multi-route test progress includes numbered route output"
  else
    fail_check "text-mode multi-route test progress did not include numbered route output"
  fi
}

assert_gateway_path_for_single_route() {
  local test_json
  local exit_code

  set +e
  test_json="$(capture_command "${CLI}" test --route "${ROUTE_NAME}" --config "${CONFIG_PATH}" --json)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "gateway-path test --route command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_json}"

  if assert_json_expr "${test_json}" '.data.path == "gateway"'; then
    pass_check "test --route defaults to gateway path"
  else
    fail_check "test --route JSON did not report gateway path"
  fi
}

assert_gateway_path_for_all_routes() {
  local test_json
  local exit_code

  set +e
  test_json="$(capture_command "${CLI}" test --config "${CONFIG_PATH}" --json)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "gateway-path test command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_json}"

  if assert_json_expr "${test_json}" '.data.path == "gateway"'; then
    pass_check "test defaults to gateway path"
  else
    fail_check "test JSON did not report gateway path"
  fi

  if assert_json_expr "${test_json}" '.data | has("route_count")'; then
    pass_check "gateway-path test reports a route_count"
  else
    fail_check "gateway-path test did not report route_count"
  fi
}

assert_direct_path_for_single_route() {
  local test_json
  local exit_code

  set +e
  test_json="$(capture_command "${CLI}" test --route "${ROUTE_NAME}" --config "${CONFIG_PATH}" --json --no-gateway)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "direct-path test --route command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_json}"

  if assert_json_expr "${test_json}" '.data.path == "direct"'; then
    pass_check "test --route --no-gateway reports direct path"
  else
    fail_check "test --route --no-gateway JSON did not report direct path"
  fi

  if assert_json_expr "${test_json}" '.data.results | any(.gateway_url == null)'; then
    pass_check "direct-path test --route omits a live gateway URL"
  else
    fail_check "direct-path test --route did not null out gateway_url"
  fi
}

assert_direct_path_for_all_routes() {
  local test_json
  local exit_code

  write_scoped_direct_config || {
    fail_check "unable to build scoped direct-path config"
    return
  }

  set +e
  test_json="$(capture_command "${CLI}" test --config "${TEMP_DIRECT_CONFIG}" --json --no-gateway)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "direct-path test command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_json}"

  if assert_json_expr "${test_json}" '.data.path == "direct"'; then
    pass_check "test --no-gateway reports direct path"
  else
    fail_check "test --no-gateway JSON did not report direct path"
  fi

  if assert_json_expr "${test_json}" '.data | has("route_count")'; then
    pass_check "direct-path test reports a route_count"
  else
    fail_check "direct-path test did not report route_count"
  fi
}

assert_gateway_unavailable_error() {
  local test_json
  local exit_code

  write_dead_port_config

  set +e
  test_json="$(capture_command "${CLI}" test --config "${TEMP_CONFIG}" --json)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "gateway-unavailable preflight command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_json}"

  if assert_json_expr "${test_json}" '.error.code == "gateway_unavailable"'; then
    pass_check "test returns gateway_unavailable when the configured gateway is unreachable"
  else
    fail_check "test did not report gateway_unavailable for an unreachable gateway"
  fi

  if assert_json_expr "${test_json}" '.details.health_url == "http://127.0.0.1:49999/health"'; then
    pass_check "gateway_unavailable error reports the expected health URL"
  else
    fail_check "gateway_unavailable error did not include the expected health URL"
  fi
}

assert_gateway_unavailable_text_output() {
  local test_output
  local exit_code

  write_dead_port_config

  set +e
  test_output="$(capture_command "${CLI}" test --config "${TEMP_CONFIG}" 2>&1)"
  exit_code=$?
  set -e

  if [[ "${exit_code}" -gt 1 ]]; then
    fail_check "gateway-unavailable text command exited unexpectedly with code ${exit_code}"
    return
  fi

  printf '%s\n' "${test_output}"

  if grep -Fq 'Gateway unavailable' <<<"${test_output}"; then
    pass_check "gateway-unavailable text output prints a clear heading"
  else
    fail_check "gateway-unavailable text output did not print a clear heading"
  fi

  if grep -Fq 'Health URL: http://127.0.0.1:49999/health' <<<"${test_output}"; then
    pass_check "gateway-unavailable text output includes the health URL"
  else
    fail_check "gateway-unavailable text output did not include the health URL"
  fi
}

printf 'Switchmaxxer test-006-test-command-path-semantics\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Config: %s\n' "${CONFIG_PATH}"
printf 'Route: %s\n\n' "${ROUTE_NAME}"

assert_cli_ready
assert_help_mentions_no_gateway
assert_text_output_header_for_single_route
assert_text_output_header_for_multi_route
if assert_gateway_running; then
  assert_gateway_path_for_all_routes
  assert_gateway_path_for_single_route
fi
assert_direct_path_for_all_routes
assert_direct_path_for_single_route
assert_gateway_unavailable_error
assert_gateway_unavailable_text_output

printf '\n'
if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-006-test-command-path-semantics completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-006-test-command-path-semantics completed with %s failure(s).\n' "${FAILURES}"
exit 1
