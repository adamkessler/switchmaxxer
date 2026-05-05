// Manatee: hot-path observation emit helper.
//
// All hot-path observation emissions route through `emitObservation`.
// The function takes a typed `HotPathObservation` (from the contract)
// and translates it to the existing observability ledger's
// `GatewayObservationInput` shape, then delegates to the active
// observability module. Behavior is intended to be identical to
// the previous direct call sites; the value of the indirection is
// type-safety on what gets emitted and a single seam to swap when
// Manatee is extracted as a class behind the HotPath interface.
//
// Phase 3 of the Manatee implementation plan migrates each existing
// `recordGatewayObservation` call site through this helper, one PR
// per file. The discriminated union in
// `../contract/hot-path-observation.ts` is refined as needed to
// faithfully express what each migrated site emits.
//
// See docs/subsystems/hot-path/manatee-implementation-plan.md (Phase 3) for the
// rollout.

import type { GatewayObservationInput } from "../../observability/gateway";
import {
  defaultObservabilityModule,
  type ObservabilityModule
} from "../../observability/observability-module";
import type { ProxyRequestContext, RouteConfig } from "../../../platform/types";
import type {
  AuthDecisionObservation,
  HotPathObservation
} from "../contract/hot-path-observation";

export interface ManateeObservationEmitter {
  emitObservation(obs: HotPathObservation): void;
  emitLegacyGatewayObservation(input: GatewayObservationInput): void;
  emitLegacyGatewayFailureObservation(
    stage: string,
    context: ProxyRequestContext,
    reason: string,
    route?: RouteConfig | null,
    attributes?: Record<string, unknown>
  ): void;
}

export function createManateeObservationEmitter(
  observabilityModule: Pick<ObservabilityModule, "recordGatewayObservation" | "recordGatewayFailureObservation">
): ManateeObservationEmitter {
  return {
    emitObservation: (obs) => {
      observabilityModule.recordGatewayObservation(translateToLedgerInput(obs));
    },
    emitLegacyGatewayObservation: (input) => {
      observabilityModule.recordGatewayObservation(input);
    },
    emitLegacyGatewayFailureObservation: (stage, context, reason, route, attributes) => {
      observabilityModule.recordGatewayFailureObservation(stage, context, reason, route, attributes);
    }
  };
}

const defaultManateeObservationEmitter = createManateeObservationEmitter(defaultObservabilityModule);

export function emitObservation(obs: HotPathObservation): void {
  defaultManateeObservationEmitter.emitObservation(obs);
}

/**
 * Transitional helper. Forwards a `GatewayObservationInput` directly
 * to the observability ledger, bypassing the typed
 * `HotPathObservation` variants.
 *
 * Used during Phase 3c migration to route every direct
 * `recordGatewayObservation` call through this module without
 * forcing a full discriminated-union variant for every event shape
 * up front. Each call to this function is a candidate for future
 * upgrade to a typed `emitObservation({ kind: ... })` call as the
 * `HotPathObservation` union grows variants for the events emitted.
 *
 * Grep targets: `emitLegacyGatewayObservation` finds the remaining
 * untyped emissions; their migration is the contract-tightening
 * follow-up to Phase 3c.
 */
export function emitLegacyGatewayObservation(input: GatewayObservationInput): void {
  defaultManateeObservationEmitter.emitLegacyGatewayObservation(input);
}

/**
 * Transitional helper for the failure-observation convenience
 * wrapper in `observability/gateway.ts`. Same role as
 * `emitLegacyGatewayObservation`; forwards to
 * `recordGatewayFailureObservation` for the per-stage failure
 * shape used by `proxy-logging.ts`.
 */
export function emitLegacyGatewayFailureObservation(
  stage: string,
  context: ProxyRequestContext,
  reason: string,
  route?: RouteConfig | null,
  attributes?: Record<string, unknown>
): void {
  defaultManateeObservationEmitter.emitLegacyGatewayFailureObservation(stage, context, reason, route, attributes);
}

function translateToLedgerInput(obs: HotPathObservation): GatewayObservationInput {
  switch (obs.kind) {
    case "auth_decision":
      return translateAuthDecision(obs);
    default:
      // Unmigrated variants. Phase 3c progressively populates these
      // cases as each emit site is moved through this helper.
      throw new Error(
        `emitObservation: HotPathObservation kind '${(obs as { kind: string }).kind}' is not yet supported. ` +
          "Migrate the emit site or extend translateToLedgerInput."
      );
  }
}

function translateAuthDecision(obs: AuthDecisionObservation): GatewayObservationInput {
  const event = obs.outcome === "denied_rate_limited" ? "auth_rate_limited" : "auth_failed";

  // Insertion order matches the existing direct-call sites so JSON
  // serialization is byte-stable across the migration:
  //   source_ip, method, path, [reason,] retry_after_seconds
  const attributes: Record<string, unknown> = {
    source_ip: obs.sourceIp,
    method: obs.method,
    path: obs.pathname
  };
  if (obs.reason !== null) {
    attributes["reason"] = obs.reason;
  }
  attributes["retry_after_seconds"] = obs.retryAfterSeconds;

  return {
    context: buildAuthDecisionContext(obs),
    kind: "error",
    event,
    stage: "ingress",
    outcome: "rejected",
    status_code: obs.statusCode,
    attributes,
    message: obs.message
  };
}

function buildAuthDecisionContext(obs: AuthDecisionObservation): ProxyRequestContext {
  // Auth decisions fire before route resolution, so context fields
  // like `bareModel` are unknown. The existing emit sites construct
  // a similarly-stub context via `buildGatewayAuthContext`; this
  // function reproduces that shape from the typed observation.
  return {
    requestId: obs.requestId,
    caller: obs.sourceIp,
    bareModel: "",
    stream: false,
    apiMode: classifyApiModeFromPath(obs.pathname),
    requestStartedAt: Date.now()
  };
}

function classifyApiModeFromPath(pathname: string): ProxyRequestContext["apiMode"] {
  if (pathname.startsWith("/anthropic/")) {
    return "anthropic-messages";
  }
  return "openai-completions";
}
