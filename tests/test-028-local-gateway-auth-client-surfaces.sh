#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-028-local-gateway-auth-client-surfaces)"
TMP_CONFIG="${TMP_DIR}/config.json"
TMP_CATALOG="${TMP_DIR}/catalog.json"
TMP_GATEWAY_LOG="${TMP_DIR}/gateway.log"
TMP_MOCK_LOG="${TMP_DIR}/mock.log"
GATEWAY_PORT="${SWITCHMAXXER_TEST_028_GATEWAY_PORT:-$(pick_tcp_port)}"
MOCK_PORT="${SWITCHMAXXER_TEST_028_MOCK_PORT:-$(pick_tcp_port)}"
GATEWAY_PID=""
MOCK_PID=""
export SWITCHMAXXER_INBOUND_TEST_KEY="12345678901234567890123456789012"

while [[ "${MOCK_PORT}" == "${GATEWAY_PORT}" ]]; do
  MOCK_PORT="$(pick_tcp_port)"
done

require_jq

register_cleanup 'kill_process "${MOCK_PID}"'
register_cleanup 'kill_gateway "${GATEWAY_PID}"'
register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

node -e '
  const fs = require("node:fs");
  const sourceConfigPath = process.argv[1];
  const sourceCatalogPath = process.argv[2];
  const targetConfigPath = process.argv[3];
  const targetCatalogPath = process.argv[4];
  const gatewayPort = Number(process.argv[5]);
  const mockPort = Number(process.argv[6]);
  const configDocument = JSON.parse(fs.readFileSync(sourceConfigPath, "utf8"));
  const catalogDocument = JSON.parse(fs.readFileSync(sourceCatalogPath, "utf8"));
  configDocument.port = gatewayPort;
  configDocument.bind_host = "127.0.0.1";
  configDocument.inbound_api_key_env = "SWITCHMAXXER_INBOUND_TEST_KEY";
  configDocument.allow_unauthenticated_health = true;
  catalogDocument.service_providers = {
    local_mock: {
      endpoint: `http://127.0.0.1:${mockPort}/v1/chat/completions`,
      allow_private_endpoints: true,
      allow_insecure_http: true,
      api_key_env: null,
      api_mode: "openai-completions"
    }
  };
  catalogDocument.routes = {
    local_mock: {
      model: "local_mock",
      provider_model_id: "local-mock-model",
      service_provider: "local_mock",
      display_name: "Local Mock"
    }
  };
  catalogDocument.models = {
    local_mock: {
      model_creator: "switchmaxxer",
      display_name: "Local Mock"
    }
  };
  fs.writeFileSync(targetConfigPath, JSON.stringify(configDocument, null, 2) + "\n", { mode: 0o600 });
  fs.writeFileSync(targetCatalogPath, JSON.stringify(catalogDocument, null, 2) + "\n", { mode: 0o600 });
' "${REPO_ROOT}/config-examples/config.example.json" "${REPO_ROOT}/config-examples/catalog.example.json" "${TMP_CONFIG}" "${TMP_CATALOG}" "${GATEWAY_PORT}" "${MOCK_PORT}"

node -e '
  const http = require("node:http");
  const port = Number(process.argv[1]);
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        id: "chatcmpl-local-mock",
        object: "chat.completion",
        created: 1,
        model: "local-mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "mock-ok" },
            finish_reason: "stop"
          }
        ]
      }));
    });
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`mock-listening:${port}\n`);
  });
' "${MOCK_PORT}" >"${TMP_MOCK_LOG}" 2>&1 &
MOCK_PID=$!

for _ in $(seq 1 200); do
  if wait_for_http "http://127.0.0.1:${MOCK_PORT}/health" 1 0.05; then
    break
  fi
  if grep -Fq "listen EPERM" "${TMP_MOCK_LOG}" 2>/dev/null; then
    echo "PASS: local gateway auth client surfaces skipped because this environment does not allow binding local test ports"
    exit 0
  fi
done

if ! wait_for_http "http://127.0.0.1:${MOCK_PORT}/health" 1 0.05; then
  echo "FAIL: mock upstream did not become ready"
  cat "${TMP_MOCK_LOG}" || true
  exit 1
fi

"${CLI}" gateway run --config "${TMP_CONFIG}" >"${TMP_GATEWAY_LOG}" 2>&1 &
GATEWAY_PID=$!

for _ in $(seq 1 200); do
  if wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/health" 1 0.05; then
    break
  fi
  if grep -Fq "listen EPERM" "${TMP_GATEWAY_LOG}" 2>/dev/null; then
    echo "PASS: local gateway auth client surfaces skipped because this environment does not allow binding local test ports"
    exit 0
  fi
done

if ! wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/health" 1 0.05; then
  echo "FAIL: gateway did not become ready"
  cat "${TMP_GATEWAY_LOG}" || true
  exit 1
fi

invoke_json="$("${CLI}" invoke --route local_mock --prompt "hello" --config "${TMP_CONFIG}" --json)"
printf '%s\n' "${invoke_json}"
assert_json_expr "${invoke_json}" \
  '.ok == true
    and .command == "invoke"
    and .data.status_code == 200
    and (.data.response_text | contains("mock-ok"))'

test_json="$("${CLI}" test --route local_mock --config "${TMP_CONFIG}" --json)"
printf '%s\n' "${test_json}"
assert_json_expr "${test_json}" \
  '.ok == true
    and .command == "test"
    and .data.path == "gateway"
    and (.data.results | length) == 1
    and .data.results[0].status == "pass"'

bench_json="$("${CLI}" bench --route local_mock --prompt "hello" --path gateway --iterations 1 --warmup 0 --config "${TMP_CONFIG}" --json)"
printf '%s\n' "${bench_json}"
assert_json_expr "${bench_json}" \
  '.ok == true
    and .command == "bench"
    and .sample_count == 1
    and .data.summary.failed_count == 0'

echo "PASS: local CLI client surfaces automatically honor configured inbound gateway auth"
