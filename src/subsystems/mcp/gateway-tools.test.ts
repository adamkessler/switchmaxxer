import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { copyExampleConfigPairForTests } from "../config/config-file.test-support";
import { buildGatewayHealthToolPayload, buildGatewayStatusToolPayload } from "./gateway-tools";

async function withMockFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void test("MCP gateway tools emit typed gateway health and status error codes when config loading fails", async () => {
  const context = {
    configPath: "/definitely-missing-switchmaxxer-config.json",
    params: {},
    getReadModel: () => {
      throw new Error("getReadModel should not be called when config loading fails.");
    }
  };

  const healthPayload = await buildGatewayHealthToolPayload(context);
  assert.equal(healthPayload.ok, false);
  assert.equal(healthPayload.command, "gateway health");
  assert.equal(healthPayload.error.code, APP_ERROR_CODES.gatewayHealthError);

  const statusPayload = await buildGatewayStatusToolPayload(context);
  assert.equal(statusPayload.ok, false);
  assert.equal(statusPayload.command, "gateway status");
  assert.equal(statusPayload.error.code, APP_ERROR_CODES.gatewayStatusError);
});

void test("MCP gateway status surfaces inbound auth state without requiring the raw token", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-mcp-gateway-status-auth-"));
  const configPath = path.join(tempDir, "config.json");
  const previousInboundKey = process.env["SWITCHMAXXER_INBOUND_API_KEY"];

  try {
    copyExampleConfigPairForTests(configPath);
    chmodSync(configPath, 0o600);
    delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];

    await withMockFetch(async () => {
      const payload = await buildGatewayStatusToolPayload({
        configPath,
        params: {},
        getReadModel: () => {
          throw new Error("getReadModel should not be called by gateway status.");
        }
      });

      assert.equal(payload.ok, true);
      const data = payload.data as Record<string, unknown>;
      assert.deepEqual(data["inbound_auth_state"], {
        status: "misconfigured",
        env_var: "(configured)",
        reason: "missing_token"
      });
    });
  } finally {
    if (typeof previousInboundKey === "string") {
      process.env["SWITCHMAXXER_INBOUND_API_KEY"] = previousInboundKey;
    } else {
      delete process.env["SWITCHMAXXER_INBOUND_API_KEY"];
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
