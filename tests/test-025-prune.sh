#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-025-prune)"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_DB="${TMP_DIR}/observability.sqlite"
TEMP_STDERR="${TMP_DIR}/stderr.log"

fail() {
  printf 'FAIL: %s\n' "$1"
  if [[ -f "${TEMP_STDERR}" ]]; then
    printf 'stderr:\n'
    cat "${TEMP_STDERR}"
  fi
  exit 1
}

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

printf 'Switchmaxxer test-025-prune\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Dist entry: %s\n' "${DIST_INDEX}"
printf 'Working config copy: %s\n' "${TEMP_CONFIG}"
printf 'Working observability DB: %s\n\n' "${TEMP_DB}"

if [[ ! -f "${DIST_INDEX}" ]]; then
  fail "built dist entry not found at ${DIST_INDEX}"
fi

require_jq

copy_example_config_pair "${TMP_DIR}" >/dev/null

TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");

const configPath = process.env.TEMP_CONFIG;
if (!configPath) {
  throw new Error("TEMP_CONFIG is required");
}

const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
document.observability = {
  retention: {
    older_than: "14d"
  }
};
fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
NODE

TEMP_DB="${TEMP_DB}" node - <<'NODE'
const { bootstrapObservabilityStore, closeObservabilityStore } = require("./dist/subsystems/observability/store.js");
const { ObservabilityService } = require("./dist/subsystems/observability/service.js");

const dbPath = process.env.TEMP_DB;
if (!dbPath) {
  throw new Error("TEMP_DB is required");
}

const store = bootstrapObservabilityStore({ dbPath });
const service = new ObservabilityService(store.db);

const makeObservation = (requestId, observedAt, event, options = {}) => ({
  id: `${requestId}-${event}-${observedAt}`,
  observed_at: observedAt,
  request_id: requestId,
  surface: "gateway",
  kind: "measurement",
  event,
  stage:
    event === "request_received"
      ? "ingress"
      : event === "route_resolved"
        ? "route_resolution"
        : event === "upstream_request_started"
          ? "upstream_request"
          : event === "upstream_response_started" || event === "upstream_response_completed"
            ? "upstream_response"
            : "client_response",
  outcome: options.outcome,
  route_id: "route-alpha",
  route_name: "route-alpha",
  model_id: "model-alpha",
  provider_id: "provider-main",
  provider_model_id: "provider-model-1",
  client_api_mode: "openai",
  upstream_api_mode: "openai-completions",
  status_code: options.statusCode ?? null
});

const recordLifecycle = (requestId, timestamps) => {
  const [receivedAt, resolvedAt, upstreamStartedAt, upstreamResponseStartedAt, upstreamCompletedAt, clientStartedAt, clientCompletedAt] =
    timestamps;
  const observations = [
    makeObservation(requestId, receivedAt, "request_received"),
    makeObservation(requestId, resolvedAt, "route_resolved"),
    makeObservation(requestId, upstreamStartedAt, "upstream_request_started"),
    makeObservation(requestId, upstreamResponseStartedAt, "upstream_response_started", { statusCode: 200 }),
    makeObservation(requestId, upstreamCompletedAt, "upstream_response_completed", { statusCode: 200 }),
    makeObservation(requestId, clientStartedAt, "client_response_started", { statusCode: 200 }),
    makeObservation(requestId, clientCompletedAt, "client_response_completed", { outcome: "succeeded", statusCode: 200 })
  ];

  for (const observation of observations) {
    service.recordObservation(observation);
  }
};

// Derive timestamps from runtime "now" so the test does not drift past the
// 14-day retention cutoff. "Old" lands ~30 days before now (definitely past
// the cutoff). "New" lands one hour before now (definitely under the cutoff).
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const oldBase = now - 30 * DAY_MS;
const newBase = now - 1 * HOUR_MS;

const buildLifecycleTimestamps = (baseEpochMs) => [
  new Date(baseEpochMs + 0).toISOString(),
  new Date(baseEpochMs + 10).toISOString(),
  new Date(baseEpochMs + 20).toISOString(),
  new Date(baseEpochMs + 40).toISOString(),
  new Date(baseEpochMs + 50).toISOString(),
  new Date(baseEpochMs + 60).toISOString(),
  new Date(baseEpochMs + 90).toISOString()
];

recordLifecycle("req-old-prune-shell", buildLifecycleTimestamps(oldBase));
recordLifecycle("req-new-prune-shell", buildLifecycleTimestamps(newBase));

closeObservabilityStore(store);
NODE

PRUNE_JSON="$(
  SWITCHMAXXER_OBSERVABILITY_DB="${TEMP_DB}" node "${DIST_INDEX}" prune --config "${TEMP_CONFIG}" --json 2>"${TEMP_STDERR}"
)" || fail "prune command failed"

assert_json_expr "${PRUNE_JSON}" \
  '.ok == true
    and .command == "prune"
    and .data.older_than == "14d"
    and .data.result.observations_deleted == 7
    and .data.result.request_executions_deleted == 1
    and .count == 8' \
  || fail "prune JSON assertion failed"

TRACE_LIST_JSON="$(
  SWITCHMAXXER_OBSERVABILITY_DB="${TEMP_DB}" node "${DIST_INDEX}" trace list --json 2>>"${TEMP_STDERR}"
)" || fail "trace list command failed after prune"

assert_json_expr "${TRACE_LIST_JSON}" \
  '.ok == true
    and .count == 1
    and .data.traces[0].trace_id == "req-new-prune-shell"' \
  || fail "trace list post-prune assertion failed"

printf 'PASS: prune CLI checks succeeded\n'
