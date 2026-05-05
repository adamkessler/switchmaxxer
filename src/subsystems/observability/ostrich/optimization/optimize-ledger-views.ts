import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getNonEmptyEnvValue } from "../../../../platform/env";
import { resolveCatalogPathForConfig } from "../../../config/catalog";
import { MASKED_SECRET_SENTINEL } from "../../../../platform/masked-secret";
import { setSafeObjectKey } from "../../../../platform/object-key-policy";
import { isNonEmptyString, isRecord } from "../../../../platform/type-guards";
import type { CliReadModel, CostConfig } from "../../../../platform/types";
import { pickCostFields, type SerializedCostConfig } from "../../../config/model-input-contract";
import type {
  ConfigMutationEventWithSnapshot,
  ConfigMutationRepository,
  ConfigSnapshotRecord
} from "../ledger/config-mutations";
import type {
  ControlPlaneActionRepository,
  ControlPlaneActionStatus
} from "../ledger/control-plane-actions";
import type { OptimizeReportView } from "./optimize-report-builder";

export type OptimizeApplySnapshotView = {
  snapshot_id: string;
  source_kind: "catalog";
  source_path: string;
  content_sha256: string;
  content_bytes: number;
  created_at: string;
  retention_expires_at: string | null;
};

export type OptimizeApplyRestorePointView = {
  action_id: string;
  operation: "optimize_apply";
  created_at: string;
  run_id: string;
  target_route: string;
  source_kind: "catalog";
  source_path: string;
  snapshot: OptimizeApplySnapshotView | null;
  mutation: {
    field: "service_provider";
    from: string;
    to: string;
  };
  original_provider_model_id: string;
  original_cost: SerializedCostConfig | null;
};

export type OptimizeApplyReloadView = {
  requested: boolean;
  status: "succeeded" | "failed" | "skipped";
  exit_code: number | null;
  command: string | null;
  message: string | null;
  data?: unknown;
  error?: unknown;
};

export function buildSkippedOptimizeReloadView(): OptimizeApplyReloadView {
  return {
    requested: true,
    status: "skipped",
    exit_code: null,
    command: null,
    message: "No config changes were made; gateway reload was skipped."
  };
}

export type OptimizeApplyVerificationView = {
  requested: boolean;
  status: "passed" | "failed" | "skipped";
  exit_code: number | null;
  command: string | null;
  route_id: string;
  message: string | null;
  data?: unknown;
  error?: unknown;
};

export type OptimizeRouteFieldChange<T> = {
  changed: boolean;
  from: T;
  to: T;
};

export type OptimizeApplyMutation = {
  field: "service_provider";
  from: string;
  to: string;
  service_provider: OptimizeRouteFieldChange<string>;
  provider_model_id: OptimizeRouteFieldChange<string>;
  cost: OptimizeRouteFieldChange<SerializedCostConfig | null>;
};

export type OptimizeRouteProviderStateView = {
  route_id: string;
  service_provider: string;
  provider_model_id: string;
  cost: SerializedCostConfig | null;
  api_mode: string;
  provider_endpoint: string | null;
};

export type OptimizeApplyView = {
  run_id: string;
  objective: "cost" | "latency";
  target_model: string;
  target_route: string;
  winner_route: string;
  dry_run: boolean;
  changed: boolean;
  action_id: string | null;
  snapshot: OptimizeApplySnapshotView | null;
  reload: OptimizeApplyReloadView | null;
  verification: OptimizeApplyVerificationView | null;
  warnings: string[];
  mutation: OptimizeApplyMutation;
  before: OptimizeRouteProviderStateView;
  after: OptimizeRouteProviderStateView;
};

export type OptimizeRestoreView = {
  run_id: string;
  target_route: string;
  dry_run: boolean;
  changed: boolean;
  action_id: string | null;
  restore_point: OptimizeApplyRestorePointView;
  snapshot: OptimizeApplySnapshotView | null;
  reload: OptimizeApplyReloadView | null;
  verification: OptimizeApplyVerificationView | null;
  warnings: string[];
  mutation: OptimizeApplyMutation;
  before: OptimizeRouteProviderStateView;
  after: OptimizeRouteProviderStateView;
};

type OptimizeMutationSourceSurface = "cli" | "mcp";

type OptimizeRouteProviderState = OptimizeRouteProviderStateView;

type OptimizeControlPlaneOperation = "optimize_apply" | "optimize_restore";

const LEDGER_EVENT_SCHEMA_VERSION = "1";

export function findOptimizeWinnerEntry(report: OptimizeReportView) {
  return report.ranking.find((entry) => entry.route_id === report.winner.route_id && entry.disqualified === null) ?? null;
}

export function providerMissingDetectableAuth(provider: CliReadModel["providersByName"][string] | undefined): string | null {
  if (!provider || provider.auth_source !== "env var" || typeof provider.api_key_env !== "string") {
    return null;
  }

  return getNonEmptyEnvValue(provider.api_key_env) === null ? provider.api_key_env : null;
}

export function updateRouteProviderTarget(options: {
  configPath: string | undefined;
  routeId: string;
  serviceProvider: string;
  providerModelId: string;
  cost: SerializedCostConfig | null;
  mutateConfigDocument: (
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => void
  ) => void;
  getMutableConfigSection: (
    document: Record<string, unknown>,
    sectionName: "models" | "service_providers" | "routes"
  ) => Record<string, unknown>;
}): void {
  options.mutateConfigDocument(options.configPath, (document) => {
    const routes = options.getMutableConfigSection(document, "routes");
    const existing = routes[options.routeId];
    if (!isRecord(existing)) {
      throw new Error(`Route '${options.routeId}' must be stored as an object in config.json.`);
    }

    const nextRoute = {
      ...existing
    };
    setSafeObjectKey(nextRoute, "service_provider", options.serviceProvider, "Route field");
    setSafeObjectKey(nextRoute, "provider_model_id", options.providerModelId, "Route field");
    if (options.cost === null) {
      delete nextRoute["cost"];
    } else {
      setSafeObjectKey(
        nextRoute,
        "cost",
        {
          input: options.cost.input,
          output: options.cost.output,
          cache_read: options.cost.cache_read,
          cache_write: options.cost.cache_write
        },
        "Route field"
      );
    }
    setSafeObjectKey(routes, options.routeId, nextRoute, "Route name");
  });
}

export function serializeOptionalCostConfig(cost: CostConfig | null): SerializedCostConfig | null {
  return cost === null ? null : pickCostFields(cost);
}

export function buildOptimizeRouteMutation(options: {
  before: OptimizeRouteProviderStateView;
  after: OptimizeRouteProviderStateView;
}): OptimizeApplyMutation {
  return {
    field: "service_provider",
    from: options.before.service_provider,
    to: options.after.service_provider,
    service_provider: {
      changed: options.before.service_provider !== options.after.service_provider,
      from: options.before.service_provider,
      to: options.after.service_provider
    },
    provider_model_id: {
      changed: options.before.provider_model_id !== options.after.provider_model_id,
      from: options.before.provider_model_id,
      to: options.after.provider_model_id
    },
    cost: {
      changed: !costsEqual(options.before.cost, options.after.cost),
      from: options.before.cost,
      to: options.after.cost
    }
  };
}

function costsEqual(left: SerializedCostConfig | null, right: SerializedCostConfig | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cache_read === right.cache_read &&
    left.cache_write === right.cache_write
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function toSnapshotView(record: ConfigSnapshotRecord | null): OptimizeApplySnapshotView | null {
  if (record === null) {
    return null;
  }

  if (record.source_kind !== "catalog") {
    return null;
  }

  return {
    snapshot_id: record.id,
    source_kind: "catalog",
    source_path: record.source_path,
    content_sha256: record.content_sha256,
    content_bytes: record.content_bytes,
    created_at: record.created_at,
    retention_expires_at: record.retention_expires_at
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redactCatalogSnapshotContent(content: string): string {
  const parsed = JSON.parse(content) as unknown;
  const document = asRecord(parsed);
  if (!document) {
    throw new Error("Catalog snapshot content must be a JSON object.");
  }

  const serviceProviders = asRecord(document["service_providers"]);
  if (serviceProviders) {
    for (const provider of Object.values(serviceProviders)) {
      const providerRecord = asRecord(provider);
      if (providerRecord && isNonEmptyString(providerRecord["api_key"])) {
        providerRecord["api_key"] = MASKED_SECRET_SENTINEL;
      }
    }
  }

  return `${JSON.stringify(document, null, 2)}\n`;
}

export function createOptimizeConfigSnapshot(options: {
  repository: ConfigMutationRepository;
  configSourcePath: string;
  createdBy: string;
  retentionExpiresAt?: string | null;
}): OptimizeApplySnapshotView {
  const catalogPath = resolveCatalogPathForConfig(options.configSourcePath);
  const content = redactCatalogSnapshotContent(readFileSync(catalogPath, "utf8"));
  const record: ConfigSnapshotRecord = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    created_by: options.createdBy,
    source_kind: "catalog",
    source_path: catalogPath,
    content_sha256: sha256Hex(content),
    content_json: content,
    content_bytes: Buffer.byteLength(content, "utf8"),
    retention_expires_at: options.retentionExpiresAt ?? null
  };

  options.repository.createSnapshot(record);
  return {
    snapshot_id: record.id,
    source_kind: "catalog",
    source_path: record.source_path,
    content_sha256: record.content_sha256,
    content_bytes: record.content_bytes,
    created_at: record.created_at,
    retention_expires_at: record.retention_expires_at
  };
}

export function recordOptimizeApplyMutationEvent(options: {
  repository: ConfigMutationRepository;
  sourceSurface: OptimizeMutationSourceSurface;
  createdBy: string;
  runId: string;
  objective: "cost" | "latency";
  targetModel: string;
  targetRouteId: string;
  winnerRouteId: string;
  snapshot: OptimizeApplySnapshotView;
  mutation: OptimizeApplyView["mutation"];
  before: OptimizeRouteProviderState;
  after: OptimizeRouteProviderState;
}): string {
  const actionId = randomUUID();
  options.repository.createEvent({
    id: actionId,
    created_at: new Date().toISOString(),
    created_by: options.createdBy,
    source_surface: options.sourceSurface,
    operation: "optimize_apply",
    status: "succeeded",
    target_kind: "route",
    target_id: options.targetRouteId,
    optimization_run_id: options.runId,
    snapshot_id: options.snapshot.snapshot_id,
    parent_event_id: null,
    before_json: JSON.stringify(options.before),
    after_json: JSON.stringify(options.after),
    metadata_json: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      operation: "optimize_apply",
      run_id: options.runId,
      objective: options.objective,
      target_model: options.targetModel,
      target_route: options.targetRouteId,
      winner_route: options.winnerRouteId,
      mutation: options.mutation,
      source_kind: options.snapshot.source_kind,
      source_path: options.snapshot.source_path,
      snapshot_id: options.snapshot.snapshot_id
    })
  });
  return actionId;
}

export function recordOptimizeControlPlaneActionStarted(options: {
  repository: ControlPlaneActionRepository;
  sourceSurface: OptimizeMutationSourceSurface;
  createdBy: string;
  actorKind: "operator" | "agent";
  actorId?: string | null;
  sessionId?: string | null;
  operation: OptimizeControlPlaneOperation;
  runId?: string | null;
  targetRouteId?: string | null;
  metadata?: Record<string, unknown>;
}): string {
  const actionId = randomUUID();
  options.repository.createEvent({
    id: actionId,
    created_at: new Date().toISOString(),
    finished_at: null,
    created_by: options.createdBy,
    source_surface: options.sourceSurface,
    actor_kind: options.actorKind,
    actor_id: options.actorId ?? null,
    session_id: options.sessionId ?? null,
    operation: options.operation,
    status: "started",
    target_kind: "route",
    target_id: options.targetRouteId ?? null,
    optimization_run_id: options.runId ?? null,
    mutation_event_id: null,
    correlation_ids_json: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      operation: options.operation,
      run_id: options.runId ?? null,
      target_route: options.targetRouteId ?? null
    }),
    result_json: "{}",
    error_json: "{}",
    metadata_json: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      ...(options.metadata ?? {})
    })
  });
  return actionId;
}

export function finishOptimizeControlPlaneAction(options: {
  repository: ControlPlaneActionRepository;
  actionId: string | null;
  status: Exclude<ControlPlaneActionStatus, "started">;
  targetRouteId?: string | null;
  runId?: string | null;
  mutationEventId?: string | null;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): void {
  if (options.actionId === null) {
    return;
  }

  options.repository.finishEvent(options.actionId, {
    status: options.status,
    targetId: options.targetRouteId ?? null,
    optimizationRunId: options.runId ?? null,
    mutationEventId: options.mutationEventId ?? null,
    resultJson: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      ...(options.result ?? {})
    }),
    errorJson: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      ...(options.error ?? {})
    }),
    metadataJson: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      ...(options.metadata ?? {})
    })
  });
}

export function recordOptimizeRestoreMutationEvent(options: {
  repository: ConfigMutationRepository;
  sourceSurface: OptimizeMutationSourceSurface;
  createdBy: string;
  restorePoint: OptimizeApplyRestorePointView;
  snapshot: OptimizeApplySnapshotView;
  mutation: OptimizeRestoreView["mutation"];
  before: OptimizeRouteProviderState;
  after: OptimizeRouteProviderState;
}): string {
  const actionId = randomUUID();
  options.repository.createEvent({
    id: actionId,
    created_at: new Date().toISOString(),
    created_by: options.createdBy,
    source_surface: options.sourceSurface,
    operation: "optimize_restore",
    status: "succeeded",
    target_kind: "route",
    target_id: options.restorePoint.target_route,
    optimization_run_id: options.restorePoint.run_id,
    snapshot_id: options.snapshot.snapshot_id,
    parent_event_id: options.restorePoint.action_id,
    before_json: JSON.stringify(options.before),
    after_json: JSON.stringify(options.after),
    metadata_json: JSON.stringify({
      schema_version: LEDGER_EVENT_SCHEMA_VERSION,
      operation: "optimize_restore",
      run_id: options.restorePoint.run_id,
      target_route: options.restorePoint.target_route,
      mutation: options.mutation,
      restore_point: {
        action_id: options.restorePoint.action_id,
        operation: options.restorePoint.operation,
        created_at: options.restorePoint.created_at,
        snapshot_id: options.restorePoint.snapshot?.snapshot_id ?? null
      },
      source_kind: options.snapshot.source_kind,
      source_path: options.snapshot.source_path,
      snapshot_id: options.snapshot.snapshot_id
    })
  });
  return actionId;
}

function parseSerializedCostConfig(value: unknown): SerializedCostConfig | null | undefined {
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  if (
    typeof record["input"] !== "number" ||
    typeof record["output"] !== "number" ||
    typeof record["cache_read"] !== "number" ||
    typeof record["cache_write"] !== "number"
  ) {
    return undefined;
  }
  return {
    input: record["input"],
    output: record["output"],
    cache_read: record["cache_read"],
    cache_write: record["cache_write"]
  };
}

function restorePointFromConfigMutationEvent(entry: ConfigMutationEventWithSnapshot): OptimizeApplyRestorePointView | null {
  const { event, snapshot } = entry;
  if (
    event.operation !== "optimize_apply" ||
    event.status !== "succeeded" ||
    event.target_kind !== "route" ||
    event.optimization_run_id === null
  ) {
    return null;
  }

  const metadata = parseJsonRecord(event.metadata_json);
  const mutation = metadata ? asRecord(metadata["mutation"]) : null;
  if (
    !metadata ||
    metadata["operation"] !== "optimize_apply" ||
    !mutation ||
    mutation["field"] !== "service_provider" ||
    !isNonEmptyString(mutation["from"]) ||
    !isNonEmptyString(mutation["to"]) ||
    !isNonEmptyString(metadata["run_id"]) ||
    !isNonEmptyString(metadata["target_route"]) ||
    metadata["source_kind"] !== "catalog" ||
    !isNonEmptyString(metadata["source_path"])
  ) {
    return null;
  }

  const beforeState = parseJsonRecord(event.before_json);
  if (
    !beforeState ||
    !isNonEmptyString(beforeState["provider_model_id"])
  ) {
    return null;
  }

  const parsedCost = parseSerializedCostConfig(beforeState["cost"]);
  if (typeof parsedCost === "undefined") {
    return null;
  }

  return {
    action_id: event.id,
    operation: "optimize_apply",
    source_kind: "catalog",
    source_path: metadata["source_path"],
    snapshot: toSnapshotView(snapshot),
    created_at: event.created_at,
    run_id: metadata["run_id"],
    target_route: metadata["target_route"],
    mutation: {
      field: "service_provider",
      from: mutation["from"],
      to: mutation["to"]
    },
    original_provider_model_id: beforeState["provider_model_id"],
    original_cost: parsedCost
  };
}

export function findOptimizeApplyRestorePoints(options: {
  repository: ConfigMutationRepository;
  configSourcePath: string;
  runId: string;
  targetRouteId: string;
}): OptimizeApplyRestorePointView[] {
  const catalogPath = path.resolve(resolveCatalogPathForConfig(options.configSourcePath));
  return options.repository
    .listEventsForOptimization({
      operation: "optimize_apply",
      optimizationRunId: options.runId,
      targetKind: "route",
      targetId: options.targetRouteId
    })
    .map((entry) => restorePointFromConfigMutationEvent(entry))
    .filter((entry): entry is OptimizeApplyRestorePointView =>
      entry !== null && path.resolve(entry.source_path) === catalogPath
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function getOptimizeApplyRestorePointByActionId(options: {
  repository: ConfigMutationRepository;
  configSourcePath: string;
  actionId: string;
}): OptimizeApplyRestorePointView | null {
  const catalogPath = path.resolve(resolveCatalogPathForConfig(options.configSourcePath));
  const restorePoint = options.repository.getEvent(options.actionId);
  if (!restorePoint) {
    return null;
  }

  const parsed = restorePointFromConfigMutationEvent(restorePoint);
  return parsed !== null && path.resolve(parsed.source_path) === catalogPath ? parsed : null;
}

export function buildOptimizeApplyWarnings(options: {
  reload: OptimizeApplyReloadView | null;
  verification: OptimizeApplyVerificationView | null;
}): string[] {
  const warnings: string[] = [];

  if (options.reload?.status === "failed") {
    warnings.push(options.reload.message ?? "Gateway reload failed after optimize apply.");
  }

  if (options.verification?.status === "failed") {
    warnings.push(options.verification.message ?? "Route verification failed after optimize apply.");
  }

  return warnings;
}

export function optimizeApplyExitCode(options: {
  reload: OptimizeApplyReloadView | null;
  verification: OptimizeApplyVerificationView | null;
}): number {
  return options.reload?.status === "failed" || options.verification?.status === "failed" ? 1 : 0;
}

export function buildOptimizeApplyView(options: {
  report: OptimizeReportView;
  targetRouteId: string;
  winnerRouteId?: string;
  dryRun: boolean;
  readModel: CliReadModel;
  afterReadModel?: CliReadModel;
  actionId?: string | null;
  snapshot?: OptimizeApplySnapshotView | null;
  reload?: OptimizeApplyReloadView | null;
  verification?: OptimizeApplyVerificationView | null;
  warnings?: string[];
}): OptimizeApplyView {
  const beforeRoute = options.readModel.routesByName[options.targetRouteId];
  if (!beforeRoute) {
    throw new Error(`Route '${options.targetRouteId}' was not found`);
  }
  const winnerRouteId = options.winnerRouteId ?? options.report.winner.route_id;
  const winnerRoute = options.readModel.routesByName[winnerRouteId];
  if (!winnerRoute) {
    throw new Error(`Winner route '${winnerRouteId}' was not found`);
  }
  const beforeProvider = options.readModel.providersByName[beforeRoute.service_provider];
  const afterRoute = options.afterReadModel?.routesByName[options.targetRouteId] ?? {
    ...beforeRoute,
    service_provider: winnerRoute.service_provider,
    provider_model_id: winnerRoute.provider_model_id,
    cost: winnerRoute.cost,
    api_mode: options.readModel.providersByName[winnerRoute.service_provider]?.api_mode ?? beforeRoute.api_mode
  };
  const afterProvider = options.afterReadModel?.providersByName[afterRoute.service_provider] ?? options.readModel.providersByName[winnerRoute.service_provider];

  const before: OptimizeRouteProviderStateView = {
    route_id: beforeRoute.name,
    service_provider: beforeRoute.service_provider,
    provider_model_id: beforeRoute.provider_model_id,
    cost: serializeOptionalCostConfig(beforeRoute.cost),
    api_mode: beforeRoute.api_mode,
    provider_endpoint: beforeProvider?.endpoint ?? null
  };
  const after: OptimizeRouteProviderStateView = {
    route_id: afterRoute.name,
    service_provider: afterRoute.service_provider,
    provider_model_id: afterRoute.provider_model_id,
    cost: serializeOptionalCostConfig(afterRoute.cost),
    api_mode: afterRoute.api_mode,
    provider_endpoint: afterProvider?.endpoint ?? null
  };
  const mutation = buildOptimizeRouteMutation({ before, after });

  return {
    run_id: options.report.run.run_id ?? "",
    objective: options.report.run.objective,
    target_model: options.report.run.target_model,
    target_route: options.targetRouteId,
    winner_route: options.report.winner.route_id,
    dry_run: options.dryRun,
    changed:
      mutation.service_provider.changed ||
      mutation.provider_model_id.changed ||
      mutation.cost.changed,
    action_id: options.actionId ?? null,
    snapshot: options.snapshot ?? null,
    reload: options.reload ?? null,
    verification: options.verification ?? null,
    warnings: options.warnings ?? [],
    mutation,
    before,
    after
  };
}

export function buildOptimizeRestoreView(options: {
  runId: string;
  targetRouteId: string;
  restorePoint: OptimizeApplyRestorePointView;
  restoredProviderId: string;
  dryRun: boolean;
  readModel: CliReadModel;
  afterReadModel?: CliReadModel;
  actionId?: string | null;
  snapshot?: OptimizeApplySnapshotView | null;
  reload?: OptimizeApplyReloadView | null;
  verification?: OptimizeApplyVerificationView | null;
  warnings?: string[];
}): OptimizeRestoreView {
  const beforeRoute = options.readModel.routesByName[options.targetRouteId];
  if (!beforeRoute) {
    throw new Error(`Route '${options.targetRouteId}' was not found`);
  }
  const beforeProvider = options.readModel.providersByName[beforeRoute.service_provider];
  const afterRoute = options.afterReadModel?.routesByName[options.targetRouteId] ?? {
    ...beforeRoute,
    service_provider: options.restoredProviderId,
    provider_model_id: options.restorePoint.original_provider_model_id,
    api_mode: options.readModel.providersByName[options.restoredProviderId]?.api_mode ?? beforeRoute.api_mode
  };
  const afterProvider = options.afterReadModel?.providersByName[afterRoute.service_provider] ?? options.readModel.providersByName[options.restoredProviderId];
  const restoredCost = options.restorePoint.original_cost;

  const before: OptimizeRouteProviderStateView = {
    route_id: beforeRoute.name,
    service_provider: beforeRoute.service_provider,
    provider_model_id: beforeRoute.provider_model_id,
    cost: serializeOptionalCostConfig(beforeRoute.cost),
    api_mode: beforeRoute.api_mode,
    provider_endpoint: beforeProvider?.endpoint ?? null
  };
  const afterReadModelRoute = options.afterReadModel?.routesByName[options.targetRouteId];
  const afterCost = afterReadModelRoute
    ? serializeOptionalCostConfig(afterReadModelRoute.cost)
    : restoredCost;
  const after: OptimizeRouteProviderStateView = {
    route_id: afterRoute.name,
    service_provider: afterRoute.service_provider,
    provider_model_id: afterRoute.provider_model_id,
    cost: afterCost,
    api_mode: afterRoute.api_mode,
    provider_endpoint: afterProvider?.endpoint ?? null
  };
  const mutation = buildOptimizeRouteMutation({ before, after });

  return {
    run_id: options.runId,
    target_route: options.targetRouteId,
    dry_run: options.dryRun,
    changed:
      mutation.service_provider.changed ||
      mutation.provider_model_id.changed ||
      mutation.cost.changed,
    action_id: options.actionId ?? null,
    restore_point: options.restorePoint,
    snapshot: options.snapshot ?? null,
    reload: options.reload ?? null,
    verification: options.verification ?? null,
    warnings: options.warnings ?? [],
    mutation,
    before,
    after
  };
}
