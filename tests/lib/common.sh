#!/usr/bin/env bash

if [[ -z "${SWITCHMAXXER_TEST_COMMON_SH_LOADED:-}" ]]; then
  SWITCHMAXXER_TEST_COMMON_SH_LOADED=1
  SWITCHMAXXER_TEST_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

  declare -ag __switchmaxxer_cleanup_commands=()

  make_tmp_dir() {
    local name="${1:-test}"
    local tmp_root="${SWITCHMAXXER_TEST_REPO_ROOT}/.switchmaxxer/test-tmp"

    mkdir -p "${tmp_root}"
    mktemp -d "${tmp_root}/switchmaxxer-${name}-${USER:-user}-XXXXXX"
  }

  copy_example_catalog_to_dir() {
    local target_dir="$1"
    local source_catalog="${2:-${SWITCHMAXXER_TEST_REPO_ROOT}/config-examples/catalog.example.json}"
    local target_catalog="${target_dir}/catalog.json"

    mkdir -p "${target_dir}"
    cp "${source_catalog}" "${target_catalog}"
    chmod 600 "${target_catalog}"
    printf '%s\n' "${target_catalog}"
  }

  copy_example_config_pair() {
    local target_dir="$1"
    local source_config="${2:-${SWITCHMAXXER_TEST_REPO_ROOT}/config-examples/config.example.json}"
    local source_catalog="${3:-${SWITCHMAXXER_TEST_REPO_ROOT}/config-examples/catalog.example.json}"
    local target_config="${target_dir}/config.json"

    mkdir -p "${target_dir}"
    cp "${source_config}" "${target_config}"
    chmod 600 "${target_config}"
    copy_example_catalog_to_dir "${target_dir}" "${source_catalog}" >/dev/null
    printf '%s\n' "${target_config}"
  }

  register_cleanup() {
    local command="$1"
    __switchmaxxer_cleanup_commands+=("${command}")
  }

  run_cleanup_traps() {
    local index
    for (( index=${#__switchmaxxer_cleanup_commands[@]} - 1; index>=0; index-=1 )); do
      eval "${__switchmaxxer_cleanup_commands[index]}" || true
    done
  }

  trap_cleanup() {
    trap run_cleanup_traps EXIT
  }

  kill_process() {
    local pid="${1:-}"
    if [[ -z "${pid}" ]]; then
      return 0
    fi

    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
  }

  kill_gateway() {
    kill_process "${1:-}"
  }

  wait_for_http() {
    local url="$1"
    local max_attempts="${2:-200}"
    local sleep_seconds="${3:-0.05}"
    local attempt=1

    while (( attempt <= max_attempts )); do
      if curl -fsS "${url}" >/dev/null 2>&1; then
        return 0
      fi

      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done

    printf 'wait_for_http timed out for %s after %s attempts\n' "${url}" "${max_attempts}" >&2
    return 1
  }

  wait_for_port() {
    local host="$1"
    local port="$2"
    local max_attempts="${3:-200}"
    local sleep_seconds="${4:-0.05}"
    local attempt=1

    while (( attempt <= max_attempts )); do
      if python3 - "${host}" "${port}" <<'PY' >/dev/null 2>&1
import socket
import sys

sock = socket.socket()
sock.settimeout(0.2)
try:
    sock.connect((sys.argv[1], int(sys.argv[2])))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
      then
        return 0
      fi

      sleep "${sleep_seconds}"
      attempt=$((attempt + 1))
    done

    printf 'wait_for_port timed out for %s:%s after %s attempts\n' "${host}" "${port}" "${max_attempts}" >&2
    return 1
  }

  pick_tcp_port() {
    # This helper has the normal pick-then-bind race: a port that is free when
    # chosen can still be claimed before the real server binds it. The tests
    # intentionally avoid hard-coded ports anyway and rely on bounded retries
    # plus readiness checks rather than pretending the race can be eliminated.
    if python3 - <<'PY' 2>/dev/null
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
    then
      return 0
    fi

    printf '%s\n' "$(( (RANDOM % 10000) + 40000 ))"
  }

  require_jq() {
    if ! command -v jq >/dev/null 2>&1; then
      printf 'FAIL: jq is required for JSON shell assertions\n' >&2
      exit 1
    fi
  }

  assert_json_expr() {
    local json_input="$1"
    shift
    local jq_expr="${@: -1}"
    local jq_args=("${@:1:$#-1}")

    printf '%s' "${json_input}" | jq -e "${jq_args[@]}" "${jq_expr}" >/dev/null
  }

  assert_json_file_expr() {
    local json_file="$1"
    shift
    local jq_expr="${@: -1}"
    local jq_args=("${@:1:$#-1}")

    jq -e "${jq_args[@]}" "${jq_expr}" "${json_file}" >/dev/null
  }

  assert_cli_envelope() {
    local json_input="$1"

    printf '%s' "${json_input}" | node "${SWITCHMAXXER_TEST_REPO_ROOT}/scripts/validate-cli-envelope.js" >/dev/null
  }
fi
