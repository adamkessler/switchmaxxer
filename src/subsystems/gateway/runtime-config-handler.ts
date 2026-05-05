import type { ServerResponse } from "node:http";

import type { AppConfig } from "../../platform/types";
import type { LocalGatewayInboundAuthState } from "./local-gateway-auth";
import { buildRuntimeConfigView } from "./runtime-helpers";
import type {
  GatewayFatalState,
  GatewayReadModel,
  GatewayReloadState
} from "./runtime-snapshot";

// Trust contract: the router has already enforced control-plane auth, local
// Host rules, unauthenticated browser defenses, and caller rate limits.
export function handleRuntimeConfigRequest(params: {
  response: ServerResponse;
  config: AppConfig;
  readModel: GatewayReadModel;
  loadedAt: string;
  reloadState: GatewayReloadState;
  fatalState: GatewayFatalState;
  processStartedAt: string;
  resolveConfiguredSystemdUnit: (config: Pick<AppConfig, "systemdUnit">) => string;
  resolveInboundGatewayAuthState: (config: AppConfig) => LocalGatewayInboundAuthState;
}): void {
  const body = `${JSON.stringify(buildRuntimeConfigView({
    config: params.config,
    readModel: params.readModel,
    loadedAt: params.loadedAt,
    reloadState: params.reloadState,
    fatalState: params.fatalState,
    processStartedAt: params.processStartedAt,
    resolveConfiguredSystemdUnit: params.resolveConfiguredSystemdUnit,
    resolveInboundGatewayAuthState: params.resolveInboundGatewayAuthState
  }))}\n`;

  params.response.statusCode = 200;
  params.response.setHeader("content-type", "application/json; charset=utf-8");
  params.response.setHeader("content-length", Buffer.byteLength(body));
  params.response.end(body);
}
