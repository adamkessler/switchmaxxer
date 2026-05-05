#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-027-gateway-inbound-auth)"
GATEWAY_PID=""
BOUNDARY_SKIP_REPORTED=0

register_cleanup 'kill_gateway "${GATEWAY_PID}"'
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

export SWITCHMAXXER_OPENAI_API_KEY="${SWITCHMAXXER_OPENAI_API_KEY:-test-openai-key}"
export SWITCHMAXXER_ANTHROPIC_API_KEY="${SWITCHMAXXER_ANTHROPIC_API_KEY:-test-anthropic-key}"
export SWITCHMAXXER_OPENROUTER_API_KEY="${SWITCHMAXXER_OPENROUTER_API_KEY:-test-openrouter-key}"
export SWITCHMAXXER_MINIMAX_API_KEY="${SWITCHMAXXER_MINIMAX_API_KEY:-test-minimax-key}"

write_gateway_auth_config() {
  local target_path="$1"
  local port="$2"

  node -e '
  const fs = require("node:fs");
  const sourcePath = process.argv[1];
  const targetPath = process.argv[2];
  const port = Number(process.argv[3]);
  const document = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  document.port = port;
  document.bind_host = "127.0.0.1";
  document.inbound_api_key_env = "SWITCHMAXXER_INBOUND_TEST_KEY";
  document.allow_unauthenticated_gateway = false;
  document.allow_unauthenticated_health = true;
  fs.writeFileSync(targetPath, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
  ' "${REPO_ROOT}/config-examples/config.example.json" "${target_path}" "${port}"
}

run_auth_boundary_case() {
  local label="$1"
  local token="$2"
  local expect_runtime_status="$3"
  local expect_valid_auth_status="$4"
  local port
  local case_dir
  local config_path
  local log_path
  local runtime_status
  local runtime_auth_status
  local health_status
  local response_body=""

  port="$(pick_tcp_port)"
  case_dir="${TMP_DIR}/${label}"
  config_path="${case_dir}/config.json"
  log_path="${case_dir}/gateway.log"
  mkdir -p "${case_dir}"
  copy_example_catalog_to_dir "${case_dir}" >/dev/null
  write_gateway_auth_config "${config_path}" "${port}"

  export SWITCHMAXXER_INBOUND_TEST_KEY="${token}"

  "${CLI}" gateway run --config "${config_path}" >"${log_path}" 2>&1 &
  GATEWAY_PID=$!

  if [[ "${expect_runtime_status}" == "500" ]]; then
    for _ in $(seq 1 40); do
      if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
        if grep -Eq "inbound gateway auth(,)? (to be at least 32 characters long|but it is not set or is empty)" "${log_path}" 2>/dev/null; then
          echo "CHECK PASS: gateway failed closed during startup for invalid inbound auth token case '${label}'"
          GATEWAY_PID=""
          return
        fi

        echo "FAIL: gateway exited without the expected inbound auth validation message for case '${label}'"
        cat "${log_path}" || true
        exit 1
      fi

      sleep 0.05
    done
  fi

  if ! wait_for_port "127.0.0.1" "${port}" 200 0.05; then
    if grep -Fq "listen EPERM" "${log_path}" 2>/dev/null; then
      if [[ "${BOUNDARY_SKIP_REPORTED}" == "0" ]]; then
        echo "PASS: gateway auth contract skipped because this environment does not allow binding local test ports"
        BOUNDARY_SKIP_REPORTED=1
      fi
      exit 0
    fi

    if [[ "${expect_runtime_status}" == "500" ]] &&
      grep -Eq "inbound gateway auth(,)? (to be at least 32 characters long|but it is not set or is empty)" "${log_path}" 2>/dev/null; then
      echo "CHECK PASS: gateway failed closed during startup for invalid inbound auth token case '${label}'"
      GATEWAY_PID=""
      return
    fi

    echo "FAIL: gateway did not become ready for case '${label}'"
    cat "${log_path}" || true
    exit 1
  fi

  health_status="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/health")"
  if [[ "${expect_runtime_status}" == "500" ]]; then
    [[ "${health_status}" == "500" ]] || {
      echo "FAIL: expected /health to report auth misconfiguration for case '${label}', got ${health_status}"
      exit 1
    }
  else
    [[ "${health_status}" == "200" ]] || {
      echo "FAIL: expected /health to stay open for case '${label}', got ${health_status}"
      exit 1
    }
  fi

  runtime_status="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/__switchmaxxer/runtime/config")"
  [[ "${runtime_status}" == "${expect_runtime_status}" ]] || {
    echo "FAIL: expected unauthenticated runtime config status ${expect_runtime_status} for case '${label}', got ${runtime_status}"
    exit 1
  }

  runtime_auth_status="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${SWITCHMAXXER_INBOUND_TEST_KEY}" "http://127.0.0.1:${port}/__switchmaxxer/runtime/config")"
  [[ "${runtime_auth_status}" == "${expect_valid_auth_status}" ]] || {
    echo "FAIL: expected authenticated runtime config status ${expect_valid_auth_status} for case '${label}', got ${runtime_auth_status}"
    exit 1
  }

  if [[ "${expect_runtime_status}" == "500" ]]; then
    response_body="$(curl -s -H "Authorization: Bearer ${SWITCHMAXXER_INBOUND_TEST_KEY}" "http://127.0.0.1:${port}/__switchmaxxer/runtime/config")"
    [[ "${response_body}" == *'"code":"inbound_auth_misconfigured"'* ]] || {
      echo "FAIL: expected inbound_auth_misconfigured payload for case '${label}'"
      exit 1
    }
  fi

  kill_gateway "${GATEWAY_PID}"
  GATEWAY_PID=""
}

run_auth_boundary_case "min-32" "12345678901234567890123456789012" "401" "200"
run_auth_boundary_case "short-31" "1234567890123456789012345678901" "500" "500"
run_auth_boundary_case "long-64" "1234567890123456789012345678901212345678901234567890123456789012" "401" "200"
run_auth_boundary_case "empty" "" "500" "500"

echo "PASS: gateway inbound auth enforces 31/32/64/empty token boundary behavior"
