import { randomUUID } from "node:crypto";

import { logWarning, safeErrorMessage } from "../../../../platform/logger";
import type {
  ControlPlaneActionOperation,
  ControlPlaneActionRepository,
  ControlPlaneActionSourceSurface,
  ControlPlaneActionTargetKind
} from "./control-plane-actions";

export interface ConfigMutationAuditStartOptions {
  repository: ControlPlaneActionRepository;
  sourceSurface: ControlPlaneActionSourceSurface;
  operation: ControlPlaneActionOperation;
  targetKind: ControlPlaneActionTargetKind;
  targetId: string | null;
  createdBy: string;
  actorKind: "operator" | "agent";
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ConfigMutationAuditFinishOptions {
  repository: ControlPlaneActionRepository;
  actionId: string | null;
  status: "succeeded" | "failed";
  targetId?: string | null;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

function toJsonObjectString(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function buildErrorJson(error: ConfigMutationAuditFinishOptions["error"]): string {
  if (!error) {
    return "{}";
  }

  return JSON.stringify({
    code: error.code,
    message: safeErrorMessage(error.message),
    ...(typeof error.details === "undefined" ? {} : { details: error.details })
  });
}

export function startConfigMutationControlPlaneAudit(
  options: ConfigMutationAuditStartOptions
): string | null {
  const actionId = randomUUID();

  try {
    options.repository.createEvent({
      id: actionId,
      created_at: new Date().toISOString(),
      finished_at: null,
      created_by: options.createdBy,
      source_surface: options.sourceSurface,
      actor_kind: options.actorKind,
      actor_id: null,
      session_id: options.sessionId ?? null,
      operation: options.operation,
      status: "started",
      target_kind: options.targetKind,
      target_id: options.targetId,
      optimization_run_id: null,
      mutation_event_id: null,
      correlation_ids_json: "{}",
      result_json: "{}",
      error_json: "{}",
      metadata_json: toJsonObjectString(options.metadata)
    });
    return actionId;
  } catch (error) {
    logWarning(`Unable to record config mutation audit start event: ${safeErrorMessage(error)}`);
    return null;
  }
}

export function finishConfigMutationControlPlaneAudit(
  options: ConfigMutationAuditFinishOptions
): void {
  if (!options.actionId) {
    return;
  }

  try {
    options.repository.finishEvent(options.actionId, {
      status: options.status,
      targetId: options.targetId,
      resultJson: toJsonObjectString(options.result),
      errorJson: buildErrorJson(options.error),
      metadataJson: toJsonObjectString(options.metadata),
      mutationEventId: null
    });
  } catch (error) {
    logWarning(`Unable to record config mutation audit finish event: ${safeErrorMessage(error)}`);
  }
}
