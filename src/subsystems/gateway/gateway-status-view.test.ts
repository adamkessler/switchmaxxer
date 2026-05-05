import assert from "node:assert/strict";
import test from "node:test";

import { buildGatewayStatusView, renderGatewayStatusText, type GatewayServiceStatus } from "./gateway-status-view";
import { withEnv } from "./runtime.test-support";

const SERVICE_STATUS: GatewayServiceStatus = {
  available: false,
  manager: "systemd",
  unit: "switchmaxxer.service",
  scope: null,
  active_state: null,
  sub_state: null,
  load_state: null,
  unit_file_state: null,
  main_pid: null,
  reason: "systemctl unavailable"
};

function buildStatusView(document: Record<string, unknown>) {
  return buildGatewayStatusView({
    sourcePath: "/tmp/config.json",
    sourceFile: "config.json",
    document,
    systemdUnit: "switchmaxxer.service",
    bindHost: "127.0.0.1",
    port: 4080,
    probeHost: "127.0.0.1",
    gatewayStatus: "stopped",
    reason: "gateway unavailable",
    pid: null,
    healthLatencyMs: 1,
    serviceStatus: SERVICE_STATUS,
    healthProbeMetrics: {
      total_requests: 0,
      allowed_requests: 0,
      rate_limited_requests: 0,
      last_seen_at: null
    }
  });
}

void test("gateway status view surfaces redacted inbound auth state", async () => {
  const envVarName = "SWITCHMAXXER_STATUS_VIEW_INBOUND_KEY";

  await withEnv({ [envVarName]: "0123456789abcdef0123456789abcdef" }, () => {
    const enabledView = buildStatusView({
      inbound_api_key_env: envVarName,
      service_providers: {},
      models: {},
      routes: {}
    });

    assert.deepEqual(enabledView.inbound_auth_state, {
      status: "enabled",
      env_var: "(configured)",
      reason: null
    });
    assert.match(renderGatewayStatusText(enabledView), /Inbound Auth:\nStatus: enabled/);
  });

  await withEnv({ [envVarName]: undefined }, () => {
    const misconfiguredView = buildStatusView({
      inbound_api_key_env: envVarName,
      service_providers: {},
      models: {},
      routes: {}
    });

    assert.deepEqual(misconfiguredView.inbound_auth_state, {
      status: "misconfigured",
      env_var: "(configured)",
      reason: "missing_token"
    });
  });

  const disabledView = buildStatusView({
    allow_unauthenticated_gateway: true,
    service_providers: {},
    models: {},
    routes: {}
  });

  assert.deepEqual(disabledView.inbound_auth_state, {
    status: "disabled_explicit",
    env_var: null,
    reason: null
  });
});
