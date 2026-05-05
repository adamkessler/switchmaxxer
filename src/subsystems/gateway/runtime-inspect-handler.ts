import type { IncomingMessage, ServerResponse } from "node:http";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import { CLI_SCHEMA_VERSION } from "../../platform/response-envelope";
import { recordGatewayObservation } from "../observability/gateway";
import type { LocalGatewayInboundAuthState } from "./local-gateway-auth";
import {
  INVOKE_INSPECTION_SECRET_REVEAL_ENV,
  INVOKE_INSPECTION_TOKEN_HEADER,
  toInvokeInspectionCaptureView
} from "./invoke-inspection";
import type { InvokeInspectionCaptureStore } from "./invoke-inspection-store";
import {
  buildGatewayAuthContext,
  gatewayRequestSourceIp
} from "./runtime-helpers";

const INVOKE_INSPECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVOKE_INSPECTION_READ_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Trust contract: the router has already enforced control-plane auth, local
// Host rules, unauthenticated browser defenses, and caller rate limits.
export function handleRuntimeInspectRequest(params: {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  url: URL;
  inspectId: string;
  inboundAuthState: LocalGatewayInboundAuthState;
  inspectionCaptureStore: InvokeInspectionCaptureStore;
  isInvokeInspectionSecretRevealAllowed: () => boolean;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  logWarning: (message: string) => void;
}): void {
  if (!INVOKE_INSPECTION_ID_PATTERN.test(params.inspectId)) {
    params.sendJsonError(
      params.response,
      400,
      "Invoke inspection id is invalid.",
      APP_ERROR_CODES.invalidRequest
    );
    return;
  }

  const includeSecrets = params.url.searchParams.get("include_secrets") === "true";
  if (includeSecrets && params.inboundAuthState.kind !== "token") {
    recordInvokeInspectionSecretRevealRequest(
      params.request,
      params.method,
      params.url.pathname,
      params.inspectId,
      "rejected",
      403,
      "inbound_auth_required"
    );
    params.logWarning(
      `Rejected unauthenticated invoke inspection secret reveal for ${params.method} ${params.url.pathname}.`
    );
    params.sendJsonError(
      params.response,
      403,
      "Including secret-bearing inspection headers requires inbound gateway auth.",
      APP_ERROR_CODES.unauthorized
    );
    return;
  }

  if (includeSecrets && !params.isInvokeInspectionSecretRevealAllowed()) {
    recordInvokeInspectionSecretRevealRequest(
      params.request,
      params.method,
      params.url.pathname,
      params.inspectId,
      "rejected",
      403,
      "process_opt_in_required"
    );
    params.logWarning(
      `Rejected invoke inspection secret reveal for ${params.method} ${params.url.pathname}: env var '${INVOKE_INSPECTION_SECRET_REVEAL_ENV}' is not enabled.`
    );
    params.sendJsonError(
      params.response,
      403,
      `Including secret-bearing inspection headers requires '${INVOKE_INSPECTION_SECRET_REVEAL_ENV}=1'.`,
      APP_ERROR_CODES.unauthorized
    );
    return;
  }

  if (includeSecrets) {
    recordInvokeInspectionSecretRevealRequest(
      params.request,
      params.method,
      params.url.pathname,
      params.inspectId,
      "succeeded",
      null,
      "explicit_process_opt_in"
    );
  }

  const readToken = readSingleHeaderValue(params.request.headers[INVOKE_INSPECTION_TOKEN_HEADER]);
  if (readToken === null || !INVOKE_INSPECTION_READ_TOKEN_PATTERN.test(readToken)) {
    params.sendJsonError(
      params.response,
      401,
      "Invoke inspection read token is required.",
      APP_ERROR_CODES.unauthorized
    );
    return;
  }

  const capture = params.inspectionCaptureStore.consume(params.inspectId, readToken);

  if (capture === null) {
    params.sendJsonError(
      params.response,
      404,
      "Invoke inspection capture was not found or has expired.",
      APP_ERROR_CODES.notFound
    );
    return;
  }

  const body = `${JSON.stringify({
    schema_version: CLI_SCHEMA_VERSION,
    data: {
      capture: toInvokeInspectionCaptureView(capture, includeSecrets)
    }
  })}\n`;

  params.response.statusCode = 200;
  params.response.setHeader("content-type", "application/json; charset=utf-8");
  params.response.setHeader("content-length", Buffer.byteLength(body));
  params.response.end(body);
}

function readSingleHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] ?? null : null;
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recordInvokeInspectionSecretRevealRequest(
  request: IncomingMessage,
  method: string,
  pathname: string,
  inspectId: string,
  outcome: "succeeded" | "rejected",
  statusCode: number | null,
  reason: string
): void {
  recordGatewayObservation({
    context: buildGatewayAuthContext(request, pathname),
    kind: outcome === "succeeded" ? "system" : "error",
    event: "inspection_secret_reveal_requested",
    stage: "ingress",
    outcome,
    status_code: statusCode,
    attributes: {
      source_ip: gatewayRequestSourceIp(request),
      method,
      path: pathname,
      inspect_id: inspectId,
      include_secrets: true,
      reason
    },
    message:
      outcome === "succeeded"
        ? "Invoke inspection secret reveal was explicitly permitted."
        : "Invoke inspection secret reveal was rejected."
  });
}
