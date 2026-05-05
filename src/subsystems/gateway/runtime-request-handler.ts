import type { IncomingMessage, ServerResponse } from "node:http";

import { isEnvFlagEnabled } from "../../platform/env";
import { APP_ERROR_CODES } from "../../platform/error-codes";
import { assignRequestId } from "../../platform/request-id";
import { recordGatewayObservation } from "../observability/gateway";
import type { AppConfig } from "../../platform/types";
import { createFailedAuthAttemptLimiter } from "./auth-rate-limit";
import {
  enforceHealthRequestTrustPolicy,
  logInboundAuthMisconfiguration,
  rejectFailedInboundAuth
} from "./runtime-auth-policy";
import { handleDataPlaneRequest } from "./data-plane-handler";
import { createGatewayHealthHandler } from "./health-handler";
import {
  INVOKE_INSPECTION_SECRET_REVEAL_ENV
} from "./invoke-inspection";
import { createInvokeInspectionCaptureStore } from "./invoke-inspection-store";
import type { LocalGatewayInboundAuthState } from "./local-gateway-auth";
import { handleRuntimeConfigRequest } from "./runtime-config-handler";
import type {
  GatewayRuntimeRequestHandler,
  GatewayRuntimeRequestHandlerDeps
} from "./runtime-handler-types";
import { handleRuntimeInspectRequest } from "./runtime-inspect-handler";
import { createGatewayRuntimeRateLimiter } from "./runtime-rate-limits";
import {
  classifyRuntimeRoute,
  requiresCallerRateLimit,
  requiresUnauthenticatedLocalClientGate
} from "./runtime-route-classifier";
import {
  applyRateLimitHeaders,
  buildGatewayRateLimitContext,
  classifyGatewayApiMode,
  gatewayRateLimitKey,
  gatewayRequestSourceIp,
  isAllowedUnauthenticatedGatewayHost,
  requestHasExpectedInboundAuth,
  validateUnauthenticatedGatewayLocalClientRequest
} from "./runtime-helpers";
import {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";
import {
  buildInitialGatewayRuntimeSnapshot,
  type GatewayRuntimeSnapshot
} from "./runtime-snapshot";

export type {
  GatewayRuntimeRequestHandler,
  GatewayRuntimeRequestHandlerDeps
} from "./runtime-handler-types";

export function createGatewayRuntimeRequestHandler(
  deps: GatewayRuntimeRequestHandlerDeps
): GatewayRuntimeRequestHandler {
  const processStartedAt = new Date().toISOString();
  const failedAuthAttemptLimiter = createFailedAuthAttemptLimiter();
  const healthHandler = createGatewayHealthHandler();
  const inspectionCaptureStore = createInvokeInspectionCaptureStore();
  const jsonParseConcurrencyManager = deps.jsonParseConcurrencyManager ?? new JsonParseConcurrencyManager();
  const streamingRequestConcurrencyManager =
    deps.streamingRequestConcurrencyManager ?? new StreamingRequestConcurrencyManager();
  const isInvokeInspectionSecretRevealAllowed =
    deps.isInvokeInspectionSecretRevealAllowed ??
    (() => isEnvFlagEnabled(INVOKE_INSPECTION_SECRET_REVEAL_ENV));

  function resolveInboundGatewayAuthState(config: AppConfig): LocalGatewayInboundAuthState {
    return deps.resolveLocalGatewayInboundAuthState(
      config.inboundApiKeyEnv,
      config.allowUnauthenticatedGateway === true,
      deps.apiKeyOverrides
    );
  }

  const requestHandler: GatewayRuntimeRequestHandler = Object.assign(
    async function requestHandler(
      request: IncomingMessage,
      response: ServerResponse,
      activeRuntime?: GatewayRuntimeSnapshot
    ): Promise<void> {
    response.setHeader("x-switchmaxxer-request-id", assignRequestId(request));
    const runtime =
      activeRuntime ??
      (() => {
        const config = deps.loadConfig();

        return buildInitialGatewayRuntimeSnapshot({
          config,
          readModel: deps.loadCliReadModel(),
          createRuntimeRateLimiter: createGatewayRuntimeRateLimiter
        });
      })();
    const config = runtime.config;
    const method = request.method ?? "GET";
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      deps.logWarning("Rejected gateway request with malformed request target.");
      deps.sendJsonError(response, 400, "Malformed request target.", APP_ERROR_CODES.invalidRequest);
      return;
    }

    const route = classifyRuntimeRoute(method, url.pathname);
    const inboundAuthState = resolveInboundGatewayAuthState(config);

    if (inboundAuthState.kind === "misconfigured") {
      logInboundAuthMisconfiguration(inboundAuthState, deps.logWarning);
      deps.sendJsonError(
        response,
        500,
        "Gateway inbound auth is misconfigured.",
        "inbound_auth_misconfigured"
      );
      return;
    }

    if (
      inboundAuthState.kind === "disabled_explicit" &&
      !isAllowedUnauthenticatedGatewayHost(request.headers.host, request, {
        bindHost: config.bindHost,
        port: config.port
      })
    ) {
      deps.logWarning(
        `Rejected unauthenticated gateway request for ${method} ${url.pathname} with unexpected Host '${request.headers.host ?? "<missing>"}'.`
      );
      deps.sendJsonError(
        response,
        421,
        "Unauthenticated gateway requests must target a loopback Host header.",
        APP_ERROR_CODES.misdirectedRequest
      );
      return;
    }

    if (inboundAuthState.kind === "disabled_explicit" && requiresUnauthenticatedLocalClientGate(route)) {
      const localClientRejection = validateUnauthenticatedGatewayLocalClientRequest(request, config);

      if (localClientRejection !== null) {
        deps.logWarning(
          `Rejected unauthenticated gateway request for ${method} ${url.pathname}: ${localClientRejection.logReason}.`
        );
        deps.sendJsonError(
          response,
          localClientRejection.statusCode,
          localClientRejection.message,
          localClientRejection.statusCode === 415 ? APP_ERROR_CODES.invalidRequest : APP_ERROR_CODES.unauthorized
        );
        return;
      }
    }

    if (
      route.trustClass === "control_plane_read" &&
      !isAllowedUnauthenticatedGatewayHost(request.headers.host, request, {
        bindHost: config.bindHost,
        port: config.port
      })
    ) {
      deps.logWarning(
        `Rejected runtime inspection request for ${method} ${url.pathname} with unexpected Host '${request.headers.host ?? "<missing>"}'.`
      );
      deps.sendJsonError(
        response,
        421,
        "Runtime inspection endpoints must target a loopback Host header.",
        APP_ERROR_CODES.misdirectedRequest
      );
      return;
    }

    if (route.kind === "health") {
      if (
        !enforceHealthRequestTrustPolicy({
          request,
          response,
          config,
          method,
          pathname: url.pathname,
          inboundAuthState,
          failedAuthAttemptLimiter,
          timingSafeTokenMatches: deps.timingSafeTokenMatches,
          sendJsonError: deps.sendJsonError,
          logWarning: deps.logWarning
        })
      ) {
        return;
      }

      healthHandler({
        request,
        response,
        fatalState: runtime.fatalState
      });
      return;
    }

    if (
      inboundAuthState.kind === "token" &&
      !requestHasExpectedInboundAuth(request, inboundAuthState.token, deps.timingSafeTokenMatches)
    ) {
      rejectFailedInboundAuth({
        request,
        response,
        method,
        pathname: url.pathname,
        failedAuthAttemptLimiter,
        sendJsonError: deps.sendJsonError,
        logWarning: deps.logWarning
      });
      return;
    }

    if (inboundAuthState.kind === "token") {
      failedAuthAttemptLimiter.reset(gatewayRequestSourceIp(request));
    }

    if (requiresCallerRateLimit(route)) {
      const sourceIp = gatewayRequestSourceIp(request);
      const rateLimitDecision = runtime.rateLimiter.check(gatewayRateLimitKey(request, route.trustClass));

      if (!rateLimitDecision.allowed) {
        const apiMode = classifyGatewayApiMode(url.pathname);

        response.setHeader("retry-after", String(rateLimitDecision.retryAfterSeconds));
        deps.logWarning(
          `Gateway caller rate limit exceeded for source ${sourceIp} on ${method} ${url.pathname}; retry_after=${rateLimitDecision.retryAfterSeconds}s.`
        );

        if (apiMode !== null) {
          recordGatewayObservation({
            context: buildGatewayRateLimitContext(request, apiMode),
            kind: "error",
            event: "rate_limited",
            stage: "ingress",
            outcome: "rejected",
            status_code: 429,
            attributes: {
              scope: "per_caller",
              source_ip: sourceIp,
              retry_after_seconds: rateLimitDecision.retryAfterSeconds,
              method,
              path: url.pathname
            },
            message: "Gateway caller rate limit exceeded."
          });
        }

        deps.sendJsonError(response, 429, "Rate limit exceeded. Retry later.", APP_ERROR_CODES.rateLimited);
        return;
      }

      applyRateLimitHeaders(response, config.rateLimit.requests, rateLimitDecision);
    }

    if (route.kind === "runtime_config") {
      handleRuntimeConfigRequest({
        response,
        config,
        readModel: runtime.readModel,
        loadedAt: runtime.loadedAt,
        reloadState: runtime.reloadState,
        fatalState: runtime.fatalState,
        processStartedAt,
        resolveConfiguredSystemdUnit: deps.resolveConfiguredSystemdUnit,
        resolveInboundGatewayAuthState
      });
      return;
    }

    if (route.kind === "runtime_inspect") {
      handleRuntimeInspectRequest({
        request,
        response,
        method,
        url,
        inspectId: route.inspectId,
        inboundAuthState,
        inspectionCaptureStore,
        isInvokeInspectionSecretRevealAllowed,
        sendJsonError: deps.sendJsonError,
        logWarning: deps.logWarning
      });
      return;
    }

    if (route.kind === "data_plane") {
      await handleDataPlaneRequest({
        request,
        response,
        config,
        pathname: url.pathname,
        method,
        isAnthropicPath: route.isAnthropicPath,
        deps,
        inspectionCaptureStore,
        jsonParseConcurrencyManager,
        streamingRequestConcurrencyManager
      });
      return;
    }

      deps.sendJsonError(response, 404, `No route for ${method} ${url.pathname}`, APP_ERROR_CODES.notFound);
    },
    {
      dispose: () => {
        inspectionCaptureStore.dispose();
      }
    }
  );

  return requestHandler;
}
