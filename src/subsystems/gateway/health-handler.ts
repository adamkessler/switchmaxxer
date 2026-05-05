import type { IncomingMessage, ServerResponse } from "node:http";

import { recordGatewayHealthProbe } from "./health-probe-metrics";
import {
  checkGatewayHealthRateLimit,
  createGatewayHealthRateLimiter
} from "./runtime-rate-limits";
import {
  gatewayRequestSourceIp,
  handleHealth,
  handleHealthRateLimited
} from "./runtime-helpers";
import type { GatewayFatalState } from "./runtime-snapshot";

export type GatewayHealthHandler = (params: {
  request: IncomingMessage;
  response: ServerResponse;
  fatalState: GatewayFatalState;
}) => void;

export function createGatewayHealthHandler(): GatewayHealthHandler {
  const healthRateLimiter = createGatewayHealthRateLimiter();

  // Trust contract: the router has already enforced health-specific auth and
  // local Host rules. This handler only emits the minimal health payload.
  return function handleHealthRequest(params: {
    request: IncomingMessage;
    response: ServerResponse;
    fatalState: GatewayFatalState;
  }): void {
    const healthRateLimitDecision = checkGatewayHealthRateLimit(
      healthRateLimiter,
      gatewayRequestSourceIp(params.request)
    );
    if (!healthRateLimitDecision.allowed) {
      recordGatewayHealthProbe({ rateLimited: true });
      handleHealthRateLimited(params.response, healthRateLimitDecision.retryAfterSeconds);
      return;
    }

    recordGatewayHealthProbe({ rateLimited: false });
    handleHealth(params.response, params.fatalState);
  };
}
