#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_INDEX="${REPO_ROOT}/dist/index.js"
SOURCE_CONFIG="${REPO_ROOT}/config-examples/config.example.json"
SOURCE_CATALOG="${REPO_ROOT}/config-examples/catalog.example.json"
source "${REPO_ROOT}/tests/lib/common.sh"
TMP_DIR="$(make_tmp_dir test-026-config-import-safety)"
TEMP_CONFIG="${TMP_DIR}/config.json"
TEMP_IMPORT="${TMP_DIR}/import.json"
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

printf 'Switchmaxxer test-026-config-import-safety\n'
printf 'Repo: %s\n' "${REPO_ROOT}"
printf 'Dist entry: %s\n' "${DIST_INDEX}"
printf 'Working config copy: %s\n'
printf '%s\n\n' "${TEMP_CONFIG}"

if [[ ! -f "${DIST_INDEX}" ]]; then
  fail "built dist entry not found at ${DIST_INDEX}"
fi

require_jq

copy_example_config_pair "${TMP_DIR}" "${SOURCE_CONFIG}" >/dev/null

TEMP_IMPORT="${TEMP_IMPORT}" SOURCE_CONFIG="${SOURCE_CONFIG}" SOURCE_CATALOG="${SOURCE_CATALOG}" node - <<'NODE'
const fs = require("node:fs");

const outputPath = process.env.TEMP_IMPORT;
const sourceConfigPath = process.env.SOURCE_CONFIG;
const sourceCatalogPath = process.env.SOURCE_CATALOG;
if (!outputPath || !sourceConfigPath || !sourceCatalogPath) {
  throw new Error("TEMP_IMPORT, SOURCE_CONFIG, and SOURCE_CATALOG are required");
}

const document = {
  ...JSON.parse(fs.readFileSync(sourceConfigPath, "utf8")),
  ...JSON.parse(fs.readFileSync(sourceCatalogPath, "utf8")),
  port: 4999,
  max_connections: 123,
  systemd_unit: "switchmaxxer-main.service",
  routes: {
    ...JSON.parse(fs.readFileSync(sourceCatalogPath, "utf8")).routes,
    "gpt-4o-mini": {
      ...JSON.parse(fs.readFileSync(sourceCatalogPath, "utf8")).routes["gpt-4o-mini"],
      display_name: "GPT-4o Mini"
    }
  }
};
delete document.catalog_version;

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
NODE

DRY_RUN_JSON="$(
  node "${DIST_INDEX}" config import --json-input "${TEMP_IMPORT}" --config "${TEMP_CONFIG}" --dry-run --json 2>"${TEMP_STDERR}"
)" || fail "config import dry-run command failed"

assert_json_expr "${DRY_RUN_JSON}" \
  '.ok == true
    and .data.dry_run == true
    and .data.imported == false
    and .data.changed == true
    and (.data.diff | type) == "string"
    and (.data.diff | contains("+++ imported"))' \
  || fail "config import dry-run JSON assertion failed"

CURRENT_PORT="$(TEMP_CONFIG="${TEMP_CONFIG}" node - <<'NODE'
const fs = require("node:fs");
const configPath = process.env.TEMP_CONFIG;
const document = JSON.parse(fs.readFileSync(configPath, "utf8"));
console.log(String(document.port));
NODE
)"
[[ "${CURRENT_PORT}" == "4080" ]] || fail "dry-run should not have modified target config"

IMPORT_OUTPUT="$(
  node "${DIST_INDEX}" config import --json-input "${TEMP_IMPORT}" --config "${TEMP_CONFIG}" --backup 2>>"${TEMP_STDERR}"
)" || fail "config import apply command failed"

EXPECTED_BACKUP_PATH="$(dirname "${TEMP_CONFIG}")/.switchmaxxer/catalog-backups/$(basename "${TEMP_CONFIG}").bak"
[[ -f "${EXPECTED_BACKUP_PATH}" ]] || fail "expected backup file to be created at ${EXPECTED_BACKUP_PATH}"

TEMP_CONFIG="${TEMP_CONFIG}" BACKUP_PATH="${EXPECTED_BACKUP_PATH}" node - <<'NODE'
const fs = require("node:fs");

const configPath = process.env.TEMP_CONFIG;
const backupPath = process.env.BACKUP_PATH;
if (!configPath || !backupPath) {
  throw new Error("TEMP_CONFIG and BACKUP_PATH are required");
}

const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

if (current.port !== 4999) {
  throw new Error(`expected imported config port 4999, got ${current.port}`);
}

if (current.systemd_unit !== "switchmaxxer-main.service") {
  throw new Error(`expected imported systemd_unit switchmaxxer-main.service, got ${current.systemd_unit}`);
}

if (backup.port !== 4080) {
  throw new Error(`expected backup config port 4080, got ${backup.port}`);
}

if (backup.systemd_unit !== "switchmaxxer.service") {
  throw new Error(`expected backup systemd_unit switchmaxxer.service, got ${backup.systemd_unit}`);
}
NODE
[[ $? -eq 0 ]] || fail "config import backup assertion failed"

if [[ "${IMPORT_OUTPUT}" != *"Backup written:"* ]]; then
  fail "expected text output to mention backup path"
fi

printf 'PASS: config import dry-run and backup checks succeeded\n'
