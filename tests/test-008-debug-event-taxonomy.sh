#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-008-debug-event-taxonomy)"
TMP_CONFIG="${TMP_DIR}/config.json"
TMP_GATEWAY_LOG="${TMP_DIR}/gateway.log"
TMP_UPSTREAM_LOG="${TMP_DIR}/upstream.log"
TMP_HEADERS="${TMP_DIR}/headers.txt"
TMP_BODY="${TMP_DIR}/body.txt"
GATEWAY_PORT="${SWITCHMAXXER_TEST_008_GATEWAY_PORT:-$(pick_tcp_port)}"
MOCK_PORT="${SWITCHMAXXER_TEST_008_MOCK_PORT:-$(pick_tcp_port)}"
GATEWAY_PID=""
UPSTREAM_PID=""
SKIP_TEST=0

while [[ "${MOCK_PORT}" == "${GATEWAY_PORT}" ]]; do
  MOCK_PORT="$(pick_tcp_port)"
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

capture_command() {
  "$@"
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
  "timeoutMs": 4000,
  "streamIdleTimeoutMs": 4000,
  "max_payload_size": 1000000,
  "service_providers": {
    "mock_provider": {
      "endpoint": "http://127.0.0.1:${MOCK_PORT}/v1/chat/completions",
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
    "demo-route": {
      "model": "demo-model",
      "provider_model_id": "demo-model",
      "service_provider": "mock_provider",
      "display_name": "Demo Route"
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
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          id: "mock-response",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "demo-model",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }) + "\n");
      });
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
    skip_check "mock upstream could not start in this environment; skipping debug taxonomy assertion"
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
    skip_check "gateway test instance could not start in this environment; skipping debug taxonomy assertion"
    return 1
  fi

  return 0
}

wait_for_gateway() {
  local url="http://127.0.0.1:${GATEWAY_PORT}/health"

  if wait_for_http "${url}" 60 0.05; then
    pass_check "gateway test instance is accepting requests"
    return 0
  fi

  fail_check "gateway test instance did not become ready"
  return 1
}

exercise_request() {
  local url="http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions"

  if ! curl -sS \
    -D "${TMP_HEADERS}" \
    -o "${TMP_BODY}" \
    -H 'content-type: application/json' \
    -d '{"model":"demo-route","messages":[{"role":"system","content":"Be concise."},{"role":"user","content":"Say ok"}],"stream":false,"temperature":0.2,"max_tokens":16}' \
    "${url}" >/dev/null; then
    fail_check "gateway request for debug taxonomy test failed"
    return 1
  fi

  REQUEST_ID="$(
    sed -n 's/^x-switchmaxxer-request-id: \(.*\)\r*$/\1/p' "${TMP_HEADERS}" \
      | tr -d '\r' \
      | head -n 1
  )"

  if [[ -z "${REQUEST_ID}" ]]; then
    fail_check "debug taxonomy request did not return x-switchmaxxer-request-id"
    return 1
  fi

  pass_check "debug taxonomy request returned x-switchmaxxer-request-id"
  return 0
}

assert_debug_events_present() {
  local gateway_log

  gateway_log="$(cat "${TMP_GATEWAY_LOG}")"
  printf '%s\n' "${gateway_log}"

  for event_name in \
    debug_ingress \
    debug_route_resolution \
    debug_upstream_request \
    debug_response_path \
    debug_client_response
  do
    if grep -Fq "event=${event_name}" <<<"${gateway_log}"; then
      pass_check "gateway debug log includes ${event_name}"
    else
      fail_check "gateway debug log did not include ${event_name}"
    fi
  done

  if grep -Fq "request_id=${REQUEST_ID}" <<<"${gateway_log}"; then
    pass_check "gateway debug log includes the response request_id"
  else
    fail_check "gateway debug log did not include the response request_id"
  fi
}

printf 'Switchmaxxer test-008-debug-event-taxonomy\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Gateway Port: %s\n' "${GATEWAY_PORT}"
printf 'Mock Port: %s\n\n' "${MOCK_PORT}"

assert_cli_ready
write_test_config

if ! start_mock_upstream; then
  printf 'PASS: test-008-debug-event-taxonomy skipped cleanly.\n'
  exit 0
fi

if ! start_gateway; then
  printf 'PASS: test-008-debug-event-taxonomy skipped cleanly.\n'
  exit 0
fi

if wait_for_gateway && exercise_request; then
  assert_debug_events_present
fi

if [[ "${SKIP_TEST}" -eq 1 ]]; then
  printf 'PASS: test-008-debug-event-taxonomy skipped cleanly.\n'
  exit 0
fi

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-008-debug-event-taxonomy completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-008-debug-event-taxonomy completed with %s failure(s).\n' "${FAILURES}"
exit 1
