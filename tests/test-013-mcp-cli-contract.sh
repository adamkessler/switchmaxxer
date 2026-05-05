#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/switchmaxxer"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-013-mcp-cli-contract)"
TEMP_CONFIG="${TMP_DIR}/config.json"

register_cleanup 'rm -rf "${TMP_DIR}"'
trap_cleanup

FAILURES=0

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

assert_json_expr_check() {
  local description="$1"
  local json_input="$2"
  local jq_expr="$3"

  if assert_json_expr "${json_input}" "${jq_expr}"; then
    pass_check "${description}"
  else
    fail_check "${description}"
  fi
}

assert_cli_envelope_check() {
  local description="$1"
  local json_input="$2"

  if assert_cli_envelope "${json_input}"; then
    pass_check "${description}"
  else
    fail_check "${description}"
  fi
}

printf 'Switchmaxxer test-013-mcp-cli-contract\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'CLI: %s\n' "${CLI}"
printf 'Working config copy: %s\n\n' "${TEMP_CONFIG}"

if [[ ! -x "${CLI}" ]]; then
  printf 'FAIL: CLI executable not found at %s\n' "${CLI}"
  exit 1
fi

if [[ ! -f "${SOURCE_CONFIG}" ]]; then
  printf 'FAIL: Source config not found at %s\n' "${SOURCE_CONFIG}"
  exit 1
fi

require_jq

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const configPath = process.env.TEMP_CONFIG;
const catalogPath = path.join(path.dirname(configPath), "catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
catalog.service_providers = catalog.service_providers || {};
catalog.service_providers.test_inline_secret = {
  endpoint: "https://example.invalid/v1",
  api_mode: "openai-completions",
  api_key: "sk-inline-secret"
};
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
NODE

printf '[1] Validate config schema JSON contract\n'
if config_schema_json="$(capture_command "${CLI}" config schema --json)"; then
  printf '%s\n' "${config_schema_json}"
  assert_cli_envelope_check \
    "config schema returns a valid CLI envelope" \
    "${config_schema_json}"
  assert_json_expr_check \
    "config schema exposes the supported MCP entity keys and route cost metadata" \
    "${config_schema_json}" \
    '.ok == true
      and .command == "config schema"
      and ((.data | keys | sort) == ["entities","error_codes"])
      and ((.data.entities | keys | sort) == ["model","provider","route"])
      and ((.data.error_codes | keys | sort) == ["entity_state","mutation_usage"])
      and ((.data.entities.route.fields.cost.flags | sort) == ["--cost-cache-read","--cost-cache-write","--cost-input","--cost-output"])
      and .data.entities.route.fields.cost.clear_flag == "--clear-cost"
      and .data.entities.provider.fields.api_key.writable_on == ["create"]
      and ((.data.entities.provider.fields.api_key.notes | length) > 0)'
else
  fail_check "config schema command succeeded"
fi

printf '\n[2] Validate models show JSON editability contract\n'
if models_show_json="$(capture_command "${CLI}" models show gpt-4o-mini --config "${TEMP_CONFIG}" --json)"; then
  printf '%s\n' "${models_show_json}"
  assert_cli_envelope_check \
    "models show returns a valid CLI envelope" \
    "${models_show_json}"
  assert_json_expr_check \
    "models show exposes stable data keys and editability metadata" \
    "${models_show_json}" \
    '((.data | keys | sort) == ["cost","display_name","model_creator","name","route_count"])
      and ((.editability.writable | sort) == ["cost","display_name","model_creator"])
      and ((.editability.derived | sort) == ["name","route_count"])
      and (.editability.effective == [])'
else
  fail_check "models show command succeeded"
fi

printf '\n[3] Validate providers show JSON editability contract\n'
if providers_show_json="$(capture_command "${CLI}" providers show openai_direct --config "${TEMP_CONFIG}" --json)"; then
  printf '%s\n' "${providers_show_json}"
  assert_cli_envelope_check \
    "providers show returns a valid CLI envelope" \
    "${providers_show_json}"
  assert_json_expr_check \
    "providers show exposes stable data keys and editability metadata" \
    "${providers_show_json}" \
    '((.data | keys | sort) == ["allow_insecure_http","allow_private_endpoints","anthropic_version","api_key","api_key_env","api_mode","auth_source","endpoint","model_id_format","name"])
      and ((.editability.writable | sort) == ["allow_insecure_http","allow_private_endpoints","anthropic_version","api_key_env","api_mode","endpoint","model_id_format"])
      and ((.editability.derived | sort) == ["auth_source","name"])
      and (.editability.effective == [])'
else
  fail_check "providers show command succeeded"
fi

printf '\n[4] Validate routes show JSON editability contract\n'
if routes_show_json="$(capture_command "${CLI}" routes show gpt-4o-mini --config "${TEMP_CONFIG}" --json)"; then
  printf '%s\n' "${routes_show_json}"
  assert_cli_envelope_check \
    "routes show returns a valid CLI envelope" \
    "${routes_show_json}"
  assert_json_expr_check \
    "routes show exposes stable data keys and editability metadata" \
    "${routes_show_json}" \
    '((.data | keys | sort) == ["api_mode","cost","display_name","effective_cost","effective_timeout_ms","model","model_cost","name","provider_model_id","service_provider","timeout_ms"])
      and ((.editability.writable | sort) == ["cost","display_name","model","provider_model_id","service_provider","timeout_ms"])
      and ((.editability.derived | sort) == ["api_mode","model_cost","name"])
      and ((.editability.effective | sort) == ["effective_cost","effective_timeout_ms"])'
else
  fail_check "routes show command succeeded"
fi

printf '\n[5] Validate mutation usage error code contract\n'
model_update_error_json="$(capture_command "${CLI}" models update gpt-4o-mini --config "${TEMP_CONFIG}" --cost-input 0.12 --json 2>/dev/null || true)"
if [[ -n "${model_update_error_json}" ]]; then
  printf '%s\n' "${model_update_error_json}"
  assert_cli_envelope_check \
    "models update partial-cost probe returns a valid CLI envelope" \
    "${model_update_error_json}"
  assert_json_expr_check \
    "models update returns incomplete_cost_flags for partial cost flag input" \
    "${model_update_error_json}" \
    '.ok == false and .command == "models update" and .error.code == "incomplete_cost_flags"'
else
  fail_check "models update partial-cost JSON error probe returned output"
fi

printf '\n[6] Validate conflicting input mode error code contract\n'
routes_create_error_json="$(capture_command "${CLI}" routes create test-mcp-contract --config "${TEMP_CONFIG}" --stdin --cost-input 0.1 --cost-output 0.2 --cost-cache-read 0.1 --cost-cache-write 0.1 --json 2>/dev/null || true)"
if [[ -n "${routes_create_error_json}" ]]; then
  printf '%s\n' "${routes_create_error_json}"
  assert_cli_envelope_check \
    "routes create conflicting-input probe returns a valid CLI envelope" \
    "${routes_create_error_json}"
  assert_json_expr_check \
    "routes create returns conflicting_input_modes when structured input is mixed with cost flags" \
    "${routes_create_error_json}" \
    '.ok == false and .command == "routes create" and .error.code == "conflicting_input_modes"'
else
  fail_check "routes create conflicting-input JSON error probe returned output"
fi

printf '\n[7] Validate config show redacts inline provider secrets\n'
if config_show_json="$(capture_command "${CLI}" config show --config "${TEMP_CONFIG}" --json)"; then
  printf '%s\n' "${config_show_json}"
  assert_cli_envelope_check \
    "config show returns a valid CLI envelope" \
    "${config_show_json}"
  assert_json_expr_check \
    "config show masks inline provider api_key values in raw_text output" \
    "${config_show_json}" \
    '.ok == true
      and .command == "config show"
      and (.data.raw_text | type) == "string"
      and (.data.raw_text | contains("\"api_key\": \"***masked***\""))
      and (.data.raw_text | contains("sk-inline-secret") | not)'
else
  fail_check "config show command succeeded"
fi

printf '\n[8] Validate providers update rejects inline api_key mutation\n'
providers_update_error_json="$(printf '{"api_key":"sk-inline"}' | capture_command "${CLI}" providers update openai_direct --config "${TEMP_CONFIG}" --stdin --json 2>/dev/null || true)"
if [[ -n "${providers_update_error_json}" ]]; then
  printf '%s\n' "${providers_update_error_json}"
  assert_cli_envelope_check \
    "providers update api-key rejection probe returns a valid CLI envelope" \
    "${providers_update_error_json}"
  assert_json_expr_check \
    "providers update returns invalid_input_field when inline api_key mutation is attempted" \
    "${providers_update_error_json}" \
    '.ok == false
      and .command == "providers update"
      and .error.code == "invalid_input_field"
      and (.error.message | contains("providers set-key"))'
else
  fail_check "providers update api-key rejection JSON probe returned output"
fi

printf '\n'
if [[ "${FAILURES}" -eq 0 ]]; then
  printf 'PASS: test-013-mcp-cli-contract completed successfully.\n'
  exit 0
fi

printf 'FAIL: test-013-mcp-cli-contract completed with %s failure(s).\n' "${FAILURES}"
exit 1
