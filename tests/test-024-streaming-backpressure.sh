#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_PROXY="${REPO_ROOT}/dist/subsystems/hot-path/manatee/proxy/proxy.js"
DIST_SECRET_STRING="${REPO_ROOT}/dist/platform/secret-string.js"
source "${REPO_ROOT}/tests/lib/common.sh"
STREAM_TEST_TIMEOUT_SECONDS=15

fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

run_streaming_backpressure_assertion() {
  local script_path="$1"
  local timeout_seconds="$2"
  local script_pid=""
  local watchdog_pid=""
  local script_status=0

  SWITCHMAXXER_OBSERVABILITY_DISABLED=1 node "${script_path}" &
  script_pid=$!

  (
    sleep "${timeout_seconds}"
    if kill -0 "${script_pid}" 2>/dev/null; then
      kill "${script_pid}" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!

  wait "${script_pid}"
  script_status=$?

  kill "${watchdog_pid}" 2>/dev/null || true
  wait "${watchdog_pid}" 2>/dev/null || true

  if [[ "${script_status}" -ne 0 ]]; then
    fail "streaming backpressure assertion failed or timed out after ${timeout_seconds}s"
  fi
}

printf 'Switchmaxxer test-024-streaming-backpressure\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Dist proxy entry: %s\n\n' "${DIST_PROXY}"

if [[ ! -f "${DIST_PROXY}" ]]; then
  fail "built dist proxy entry not found at ${DIST_PROXY}"
fi

TMP_DIR="$(make_tmp_dir test-024-streaming-backpressure)"
TEMP_SCRIPT="${TMP_DIR}/streaming-backpressure.js"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

cat >"${TEMP_SCRIPT}" <<'NODE'
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { proxyChatCompletion } = require(process.env.DIST_PROXY);
const { SecretString } = require(process.env.DIST_SECRET_STRING);

class MockServerResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this.headers = new Map();
    this.body = Buffer.alloc(0);
    this.destroyed = false;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name) {
    this.headers.delete(name.toLowerCase());
  }

  write(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.body = Buffer.concat([this.body, buffer]);
    this.headersSent = true;
    return true;
  }

  end(chunk) {
    if (typeof chunk !== "undefined") {
      this.write(chunk);
    }
    this.headersSent = true;
    this.writableEnded = true;
    this.emit("finish");
    this.emit("close");
    return this;
  }
}

class BackpressureResponse extends MockServerResponse {
  constructor() {
    super();
    this.writeCount = 0;
    this.secondWriteStartedBeforeDrain = false;
    this.drainReleased = false;
  }

  write(chunk) {
    this.writeCount += 1;
    if (this.writeCount === 2 && !this.drainReleased) {
      this.secondWriteStartedBeforeDrain = true;
    }

    const canContinue = super.write(chunk);

    if (this.writeCount === 1) {
      setTimeout(() => {
        this.drainReleased = true;
        this.emit("drain");
      }, 10);
      return false;
    }

    return canContinue;
  }
}

(async () => {
  const originalFetch = globalThis.fetch;

  try {
    const config = {
      port: 0,
      bindHost: "127.0.0.1",
      maxConnections: 200,
      timeoutMs: 5000,
      streamIdleTimeoutMs: 5000,
      streamMaxLifetimeMs: 5000,
      streamMinBytesPerSecond: 1,
      streamRateWindowMs: 50,
      streamMaxEventBytes: 1000000,
      streamMaxTotalBytes: 1000000,
      maxPayloadSize: 1000000,
      rateLimit: {
        requests: 1000,
        window: "1m"
      },
      systemdUnit: "switchmaxxer.service",
      observability: {
        retentionOlderThan: null
      },
      sourceFile: "config.json",
      sourcePath: path.resolve("config.json"),
      benchmark: {
        defaultMaxTokens: 32,
        defaultAnthropicVersion: "2023-06-01"
      },
      routes: {
        "route-anthropic-stream": {
          serviceProvider: "provider-anthropic-stream",
          api_mode: "anthropic-messages",
          anthropicVersion: "2023-06-01",
          modelCreator: "anthropic",
          model: "claude-test-model",
          baseUrl: "https://127.0.0.1",
          allowPrivateEndpoints: true,
          apiKeyEnv: null,
          inlineApiKey: new SecretString("test-key"),
          cost: null,
          modelCost: null,
          routeTimeoutMs: null,
          timeoutMs: 5000
        }
      }
    };

    globalThis.fetch = async () => {
      const body = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-test-model"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
      ].join("");

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    };

    const request = {
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        "x-switchmaxxer-caller": "proxy-test-client"
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    };
    const response = new BackpressureResponse();
    const parsedBody = {
      model: "route-anthropic-stream",
      messages: [
        {
          role: "user",
          content: "hello"
        }
      ],
      stream: true
    };

    await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody), {
      fetchImpl: globalThis.fetch
    });

    const responseText = response.body.toString("utf8");
    if (response.secondWriteStartedBeforeDrain) {
      throw new Error("translated stream continued writing before drain");
    }
    if (response.writeCount < 2) {
      throw new Error(`expected multiple writes, saw ${response.writeCount}`);
    }
    if (!responseText.includes("chat.completion.chunk")) {
      throw new Error("translated OpenAI SSE chunks were not emitted");
    }
    if (!responseText.includes("[DONE]")) {
      throw new Error("translated stream did not terminate with [DONE]");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE

DIST_PROXY="${DIST_PROXY}" DIST_SECRET_STRING="${DIST_SECRET_STRING}" run_streaming_backpressure_assertion "${TEMP_SCRIPT}" "${STREAM_TEST_TIMEOUT_SECONDS}"

printf 'PASS: streaming backpressure regression checks succeeded\n'
