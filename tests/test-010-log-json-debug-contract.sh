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

assert_node_contract() {
  local output

  if ! output="$(
    cd "${REPO_ROOT}" && node <<'EOF'
const { normalizeJournalJsonEntry } = require("./dist/platform/log-normalization.js");

const ingress = JSON.stringify({
  MESSAGE:
    '[2026-04-18T00:00:00.000Z] .. DEBUG    event=debug_ingress  request_id=req-123  method=POST  path=/v1/chat/completions  caller=127.0.0.1  listener_api_mode=openai-completions  stream=false  route_hint=demo-route  message_count=2  has_system_message=true  prompt_chars=12  tool_count=0  has_metadata=false  max_tokens=16  temperature=0.2',
  SYSLOG_IDENTIFIER: 'switchmaxxer',
  _PID: '4242',
  _HOSTNAME: 'test-host',
  _TRANSPORT: 'stdout',
  __REALTIME_TIMESTAMP: '1713312000000000'
});

const errorContext = JSON.stringify({
  MESSAGE:
    '[2026-04-18T00:00:01.000Z] .. DEBUG    event=debug_error_context  request_id=req-123  stage=response_upstream_status  route=demo-route  provider=mock_provider  provider_model_id=demo-model  client_api_mode=openai-completions  upstream_api_mode=openai-completions  reason="upstream_500"',
  SYSLOG_IDENTIFIER: 'switchmaxxer',
  _PID: '4242',
  _HOSTNAME: 'test-host',
  _TRANSPORT: 'stdout',
  __REALTIME_TIMESTAMP: '1713312001000000'
});

console.log(JSON.stringify({
  ingress: normalizeJournalJsonEntry(ingress),
  errorContext: normalizeJournalJsonEntry(errorContext)
}));
EOF
  )"; then
    fail_check "node normalization contract probe failed"
    return
  fi

  printf '%s\n' "${output}"

  if assert_json_expr "${output}" '.ingress.event == "debug_ingress"'; then
    pass_check "normalized JSON preserves debug_ingress as the event name"
  else
    fail_check "normalized JSON did not preserve debug_ingress as the event name"
  fi

  if assert_json_expr "${output}" '.ingress.request_id == "req-123" and .errorContext.request_id == "req-123"'; then
    pass_check "normalized JSON preserves request_id"
  else
    fail_check "normalized JSON did not preserve request_id"
  fi

  if assert_json_expr "${output}" '.ingress.method == "POST" and .ingress.path == "/v1/chat/completions"'; then
    pass_check "normalized JSON preserves ingress request-shape fields"
  else
    fail_check "normalized JSON did not preserve ingress request-shape fields"
  fi

  if assert_json_expr "${output}" '.errorContext.event == "debug_error_context"'; then
    pass_check "normalized JSON preserves debug_error_context as the event name"
  else
    fail_check "normalized JSON did not preserve debug_error_context as the event name"
  fi

  if assert_json_expr "${output}" '.errorContext.stage == "response_upstream_status"'; then
    pass_check "normalized JSON preserves debug_error_context stage"
  else
    fail_check "normalized JSON did not preserve debug_error_context stage"
  fi

  if assert_json_expr "${output}" '.errorContext.provider == "mock_provider"
    and .errorContext.provider_model_id == "demo-model"
    and .errorContext.client_api_mode == "openai-completions"
    and .errorContext.upstream_api_mode == "openai-completions"
    and .errorContext.reason == "upstream_500"'; then
    pass_check "normalized JSON preserves the documented debug_error_context contract"
  else
    fail_check "normalized JSON did not preserve the documented debug_error_context contract"
  fi
}

printf 'Switchmaxxer test-010-log-json-debug-contract\n'
printf 'Repo: %s\n\n' "${REPO_ROOT}"

require_jq

assert_node_contract

if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-010-log-json-debug-contract completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-010-log-json-debug-contract completed with %s failure(s).\n' "${FAILURES}"
exit 1
