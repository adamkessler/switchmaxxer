import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { ObservabilityService } from "./service";
import { createOptimizeConfigSnapshot } from "./optimize-ledger-views";
import { test } from "./observability.test-support";

void test("optimize config snapshots redact inline provider secrets before storing catalog content", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-optimize-snapshot-redaction-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    chmodSync(configPath, 0o600);
    writeFileSync(
      catalogPath,
      `${JSON.stringify({
        catalog_version: 1,
        service_providers: {
          inline_secret_provider: {
            endpoint: "https://example.invalid/v1",
            api_mode: "openai-completions",
            api_key: "sk-inline-secret"
          },
          env_provider: {
            endpoint: "https://example.invalid/v1",
            api_mode: "openai-completions",
            api_key_env: "SWITCHMAXXER_TEST_KEY"
          }
        },
        routes: {},
        models: {}
      }, null, 2)}\n`,
      "utf8"
    );
    chmodSync(catalogPath, 0o600);

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const snapshot = createOptimizeConfigSnapshot({
      repository: service.configMutations,
      configSourcePath: configPath,
      createdBy: "test-suite"
    });
    const record = service.configMutations.getSnapshot(snapshot.snapshot_id);

    assert.ok(record);
    assert.doesNotMatch(record.content_json, /sk-inline-secret/);
    assert.match(record.content_json, /"api_key": "\*\*\*masked\*\*\*"/);
    assert.match(record.content_json, /"api_key_env": "SWITCHMAXXER_TEST_KEY"/);
    assert.equal(record.content_sha256, snapshot.content_sha256);
    assert.equal(record.content_bytes, Buffer.byteLength(record.content_json, "utf8"));

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
