import type { IncomingMessage, ServerResponse } from "node:http";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import type { AppConfig } from "../../platform/types";
import { recordGatewayObservation } from "../observability/gateway";
import type { FailedAuthAttemptLimiter } from "./auth-rate-limit";
import type { LocalGatewayInboundAuthState } from "./local-gateway-auth";
import {
  buildGatewayAuthContext,
  gatewayRequestSourceIp,
  isAllowedUnauthenticatedGatewayHost,
  requestHasExpectedInboundAuth
} from "./runtime-helpers";

export function logInboundAuthMisconfiguration(
  inboundAuthState: Extract<LocalGatewayInboundAuthState, { kind: "misconfigured" }>,
  logWarning: (message: string) => void
): void {
  const logMessage =
    inboundAuthState.reason === "missing_env_name"
      ? "Gateway inbound auth is misconfigured: set 'inbound_api_key_env' or explicitly opt in with 'allow_unauthenticated_gateway: true'."
      : inboundAuthState.reason === "short_token"
        ? `Gateway inbound auth is misconfigured: env var '${inboundAuthState.envVar}' must be at least 32 characters long.`
        : `Gateway inbound auth is misconfigured: env var '${inboundAuthState.envVar}' is required for request auth but is not set or is empty.`;
  logWarning(logMessage);
}

export function enforceHealthRequestTrustPolicy(params: {
  request: IncomingMessage;
  response: ServerResponse;
  config: AppConfig;
  method: string;
  pathname: string;
  inboundAuthState: LocalGatewayInboundAuthState;
  failedAuthAttemptLimiter: FailedAuthAttemptLimiter;
  timingSafeTokenMatches: (providedToken: string, expectedToken: string) => boolean;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  logWarning: (message: string) => void;
}): boolean {
  const healthRequestHasExpectedInboundAuth =
    params.inboundAuthState.kind === "token" &&
    requestHasExpectedInboundAuth(
      params.request,
      params.inboundAuthState.token,
      params.timingSafeTokenMatches
    );

  if (
    params.inboundAuthState.kind === "token" &&
    params.config.allowUnauthenticatedHealth === true &&
    !isAllowedUnauthenticatedGatewayHost(params.request.headers.host, params.request, {
      bindHost: params.config.bindHost,
      port: params.config.port
    })
  ) {
    const sourceIp = gatewayRequestSourceIp(params.request);
    const authDecision = params.failedAuthAttemptLimiter.registerFailure(sourceIp);
    const authContext = buildGatewayAuthContext(params.request, params.pathname);

    recordGatewayObservation({
      context: authContext,
      kind: "error",
      event: authDecision.status === "blocked" ? "auth_rate_limited" : "auth_failed",
      stage: "ingress",
      outcome: "rejected",
      status_code: authDecision.status === "blocked" ? 429 : 421,
      attributes: {
        source_ip: sourceIp,
        method: params.method,
        path: params.pathname,
        reason: "unexpected_host",
        retry_after_seconds: authDecision.status === "blocked" ? authDecision.retryAfterSeconds : null
      },
      message:
        authDecision.status === "blocked"
          ? "Too many failed authentication attempts."
          : "Health request used an unexpected Host header."
    });

    if (authDecision.status === "blocked") {
      params.response.setHeader("retry-after", String(authDecision.retryAfterSeconds));
      params.logWarning(
        `Gateway inbound auth temporarily rate limited for source ${sourceIp}; retry_after=${authDecision.retryAfterSeconds}s.`
      );
      params.sendJsonError(
        params.response,
        429,
        "Too many failed authentication attempts. Retry later.",
        APP_ERROR_CODES.authRateLimited
      );
      return false;
    }

    params.logWarning(
      `Rejected unauthenticated health request for ${params.method} ${params.pathname} with unexpected Host '${params.request.headers.host ?? "<missing>"}'.`
    );
    params.sendJsonError(
      params.response,
      421,
      "Unauthenticated health checks must target a loopback Host header.",
      APP_ERROR_CODES.misdirectedRequest
    );
    return false;
  }

  if (
    params.inboundAuthState.kind === "token" &&
    params.config.allowUnauthenticatedHealth !== true &&
    !healthRequestHasExpectedInboundAuth
  ) {
    rejectFailedInboundAuth({
      request: params.request,
      response: params.response,
      method: params.method,
      pathname: params.pathname,
      failedAuthAttemptLimiter: params.failedAuthAttemptLimiter,
      sendJsonError: params.sendJsonError,
      logWarning: params.logWarning
    });
    return false;
  }

  if (healthRequestHasExpectedInboundAuth) {
    params.failedAuthAttemptLimiter.reset(gatewayRequestSourceIp(params.request));
  }

  return true;
}

export function rejectFailedInboundAuth(params: {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  pathname: string;
  failedAuthAttemptLimiter: FailedAuthAttemptLimiter;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  logWarning: (message: string) => void;
}): void {
  const sourceIp = gatewayRequestSourceIp(params.request);
  const authDecision = params.failedAuthAttemptLimiter.registerFailure(sourceIp);
  const authContext = buildGatewayAuthContext(params.request, params.pathname);

  recordGatewayObservation({
    context: authContext,
    kind: "error",
    event: authDecision.status === "blocked" ? "auth_rate_limited" : "auth_failed",
    stage: "ingress",
    outcome: "rejected",
    status_code: authDecision.status === "blocked" ? 429 : 401,
    attributes: {
      source_ip: sourceIp,
      method: params.method,
      path: params.pathname,
      retry_after_seconds: authDecision.status === "blocked" ? authDecision.retryAfterSeconds : null
    },
    message:
      authDecision.status === "blocked"
        ? "Too many failed authentication attempts."
        : "Gateway inbound authentication failed."
  });

  if (authDecision.status === "blocked") {
    params.response.setHeader("retry-after", String(authDecision.retryAfterSeconds));
    params.logWarning(
      `Gateway inbound auth temporarily rate limited for source ${sourceIp}; retry_after=${authDecision.retryAfterSeconds}s.`
    );
    params.sendJsonError(
      params.response,
      429,
      "Too many failed authentication attempts. Retry later.",
      APP_ERROR_CODES.authRateLimited
    );
    return;
  }

  params.logWarning(`Gateway inbound auth failed for source ${sourceIp}.`);
  params.sendJsonError(params.response, 401, "Unauthorized - check API key", APP_ERROR_CODES.unauthorized);
}
