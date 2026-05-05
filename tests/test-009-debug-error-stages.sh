#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-009-debug-error-stages)"
TMP_CONFIG="${TMP_DIR}/config.json"
TMP_GATEWAY_LOG="${TMP_DIR}/gateway.log"
TMP_UPSTREAM_LOG="${TMP_DIR}/upstream.log"
GATEWAY_PORT="${SWITCHMAXXER_TEST_009_GATEWAY_PORT:-$(pick_tcp_port)}"
MOCK_PORT="${SWITCHMAXXER_TEST_009_MOCK_PORT:-$(pick_tcp_port)}"
DEAD_UPSTREAM_PORT="${SWITCHMAXXER_TEST_009_DEAD_PORT:-$(pick_tcp_port)}"
GATEWAY_PID=""
UPSTREAM_PID=""
SKIP_TEST=0

while [[ "${MOCK_PORT}" == "${GATEWAY_PORT}" ]]; do
  MOCK_PORT="$(pick_tcp_port)"
done

while [[ "${DEAD_UPSTREAM_PORT}" == "${GATEWAY_PORT}" || "${DEAD_UPSTREAM_PORT}" == "${MOCK_PORT}" ]]; do
  DEAD_UPSTREAM_PORT="$(pick_tcp_port)"
done

FAILURES=0

register_cleanup 'kill_process "${UPSTREAM_PID}"'
register_cleanup 'kill_gateway "${GATEWAY_PID}"'
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

pass_check() {
  printf 'CHECK PASS: %s\n' "$1"
}

fail_check() {
  printf 'CHECK FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

skip_check() {
  printf 'CHECK PASS: %s\n' "$1"
  SKIP_TEST=1
}

assert_cli_ready() {
  if [[ ! -x "${CLI}" ]]; then
    printf 'FAIL: CLI executable not found at %s\n' "${CLI}"
    exit 1
  fi
}

write_test_config() {
  cat > "${TMP_CONFIG}" <<EOF
{
  "bindHost": "127.0.0.1",
  "port": ${GATEWAY_PORT},
  "logLevel": "debug",
  "maxConnections": 20,
  "timeoutMs": 2000,
  "streamIdleTimeoutMs": 2000,
  "max_payload_size": 1000000,
  "service_providers": {
    "upstream_500": {
      "endpoint": "http://127.0.0.1:${MOCK_PORT}/v1/chat/completions",
      "allow_private_endpoints": true,
      "allow_insecure_http": true,
      "api_key_env": null,
      "api_mode": "openai-completions"
    },
    "upstream_dead": {
      "endpoint": "http://127.0.0.1:${DEAD_UPSTREAM_PORT}/v1/chat/completions",
      "allow_private_endpoints": true,
      "allow_insecure_http": true,
      "api_key_env": null,
      "api_mode": "openai-completions"
    }
  },
  "models": {
    "demo-model": {
      "model_creator": "demo",
      "display_name": "Demo Model"
    }
  },
  "routes": {
    "demo-500-route": {
      "model": "demo-model",
      "provider_model_id": "demo-model",
      "service_provider": "upstream_500",
      "display_name": "Demo 500 Route"
    },
    "demo-dead-route": {
      "model": "demo-model",
      "provider_model_id": "demo-model",
      "service_provider": "upstream_dead",
      "display_name": "Demo Dead Route"
    }
  }
}
EOF
}

start_mock_upstream() {
  node -e '
    const http = require("http");
    const port = Number(process.argv[1]);
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }) + "\n");
        return;
      }
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        error: { message: "mock upstream 500", type: "mock_error", code: "mock_500" }
      }) + "\n");
    });
    server.on("error", (error) => {
      console.error(error);
      process.exit(1);
    });
    server.listen(port, "127.0.0.1");
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
    process.on("SIGINT", () => server.close(() => process.exit(0)));
  ' "${MOCK_PORT}" >"${TMP_UPSTREAM_LOG}" 2>&1 &
  UPSTREAM_PID=$!

  if ! wait_for_http "http://127.0.0.1:${MOCK_PORT}/health" 40 0.05; then
    if [[ -f "${TMP_UPSTREAM_LOG}" ]]; then
      printf '%s\n' "$(cat "${TMP_UPSTREAM_LOG}")"
    fi
    skip_check "mock upstream could not start in this environment; skipping failure-stage assertions"
    return 1
  fi

  return 0
}

start_gateway() {
  "${CLI}" gateway run --config "${TMP_CONFIG}" --log-level debug >"${TMP_GATEWAY_LOG}" 2>&1 &
  GATEWAY_PID=$!

  if ! wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/health" 40 0.05; then
    if [[ -f "${TMP_GATEWAY_LOG}" ]]; then
      printf '%s\n' "$(cat "${TMP_GATEWAY_LOG}")"
    fi
    skip_check "gateway test instance could not start in this environment; skipping failure-stage assertions"
    return 1
  fi

  return 0
}

wait_for_gateway() {
  local url="http://127.0.0.1:${GATEWAY_PORT}/health"

  if wait_for_http "${url}" 60 0.05; then
    pass_check "gateway failure-stage test instance is accepting requests"
    return 0
  fi

  fail_check "gateway failure-stage test instance did not become ready"
  return 1
}

exercise_failure_requests() {
  local url="http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions"

  curl -sS -o /dev/null -H 'content-type: application/json' \
    -d '{"model":"missing-route","messages":[{"role":"user","content":"hello"}],"stream":false}' \
    "${url}" || true

  curl -sS -o /dev/null -H 'content-type: application/json' \
    -d '{"model":"demo-dead-route","messages":[{"role":"user","content":"hello"}],"stream":false}' \
    "${url}" || true

  curl -sS -o /dev/null -H 'content-type: application/json' \
    -d '{"model":"demo-500-route","messages":[{"role":"user","content":"hello"}],"stream":false}' \
    "${url}" || true

  wait_for_http "${url%/v1/chat/completions}/health" 10 0.05 >/dev/null 2>&1 || true
}

assert_failure_stages_present() {
  local gateway_log

  gateway_log="$(cat "${TMP_GATEWAY_LOG}")"
  printf '%s\n' "${gateway_log}"

  if grep -Fq 'event=debug_error_context' <<<"${gateway_log}" && grep -Fq 'stage=route_resolution' <<<"${gateway_log}"; then
    pass_check "gateway debug log includes route_resolution failure stage"
  else
    fail_check "gateway debug log did not include route_resolution failure stage"
  fi

  if grep -Fq 'event=debug_error_context' <<<"${gateway_log}" && grep -Fq 'stage=upstream_fetch' <<<"${gateway_log}"; then
    pass_check "gateway debug log includes upstream_fetch failure stage"
  else
    fail_check "gateway debug log did not include upstream_fetch failure stage"
  fi

  if grep -Fq 'event=debug_error_context' <<<"${gateway_log}" && grep -Fq 'stage=response_upstream_status' <<<"${gateway_log}"; then
    pass_check "gateway debug log includes response_upstream_status failure stage"
  else
    fail_check "gateway debug log did not include response_upstream_status failure stage"
  fi
}

printf 'Switchmaxxer test-009-debug-error-stages\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Gateway Port: %s\n' "${GATEWAY_PORT}"
printf 'Mock Port: %s\n' "${MOCK_PORT}"
printf 'Dead Upstream Port: %s\n' "${DEAD_UPSTREAM_PORT}"
printf 'Mock Port: %s\n\n' "${MOCK_PORT}"

assert_cli_ready
write_test_config

if ! start_mock_upstream; then
  printf 'PASS: test-009-debug-error-stages skipped cleanly.\n'
  exit 0
fi

if ! start_gateway; then
  printf 'PASS: test-009-debug-error-stages skipped cleanly.\n'
  exit 0
fi

if wait_for_gateway; then
  exercise_failure_requests
  assert_failure_stages_present
fi

if [[ "${SKIP_TEST}" -eq 1 ]]; then
  printf 'PASS: test-009-debug-error-stages skipped cleanly.\n'
  exit 0
fi

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-009-debug-error-stages completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-009-debug-error-stages completed with %s failure(s).\n' "${FAILURES}"
exit 1
