import { randomUUID } from "node:crypto";

import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { isRecord } from "../../platform/type-guards";
import type { CliReadModel, CostConfig, RouteReadModel } from "../../platform/types";
import { BENCH_MAX_ROUTES } from "./bench-limits";
import type { BenchmarkRunSummary, BenchmarkSampleRecord } from "./benchmarks";
import type { BenchmarkExecutionView, BenchmarkPath } from "./contracts";
import type { OptimizationRunRecord, OptimizationRunStatus, OptimizationRunView } from "./optimizations";
import type { ObservabilityService } from "./service";

export type OptimizeWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type OptimizeFailure = {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type OptimizeReferenceTokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export type OptimizeRankingEntry = {
  rank: number | null;
  objective: "cost" | "latency";
  route_id: string;
  display_name: string | null;
  model: string;
  service_provider: string;
  provider_model_id: string;
  score: number | null;
  score_unit: "usd" | "ms";
  details: {
    reference_tokens?: OptimizeReferenceTokens;
    effective_cost?: CostConfig | null;
    cost_source?: "route" | "model" | "none";
    estimated_cost?: number | null;
    measured_sample_count?: number;
    successful_measured_sample_count?: number;
    failed_measured_sample_count?: number;
    median_latency_ms?: number | null;
    average_latency_ms?: number | null;
    min_latency_ms?: number | null;
    max_latency_ms?: number | null;
    by_path?: OptimizeLatencyPathSummary[];
  };
  disqualified: {
    reason: string;
    message: string;
  } | null;
};

export type OptimizeLatencyPathSummary = {
  path: BenchmarkPath;
  measured_sample_count: number;
  successful_sample_count: number;
  failed_sample_count: number;
  median_latency_ms: number | null;
  average_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
};

export type OptimizeReportView = {
  store_path?: string;
  run: {
    run_id: string | null;
    persisted: boolean;
    created_at: string | null;
    finished_at: string | null;
    created_by: string | null;
    status: OptimizationRunStatus;
    target_model: string;
    objective: "cost" | "latency";
  };
  candidates: {
    requested_routes: string[] | null;
    resolved_routes: string[];
    disqualified: Array<{
      route_id: string;
      reason: string;
      message: string;
    }>;
  };
  reference_tokens: OptimizeReferenceTokens;
  bench: {
    run_id: string;
    summary: BenchmarkRunSummary;
    execution: BenchmarkExecutionView;
  } | null;
  ranking: OptimizeRankingEntry[];
  winner: {
    route_id: string;
    score: number;
    score_unit: "usd" | "ms";
    tied_with: string[];
  };
  warnings: OptimizeWarning[];
};

export type OptimizeCandidateSnapshot = {
  route_id: string;
  display_name: string | null;
  model: string;
  service_provider: string;
  provider_model_id: string;
  api_mode: string;
  effective_timeout_ms: number | null;
  effective_cost: CostConfig | null;
};

export type CostOptimizeExecutionResult =
  | { ok: true; report: OptimizeReportView }
  | { ok: false; failure: OptimizeFailure };

export type LatencyOptimizeExecutionResult = CostOptimizeExecutionResult;

export type CostOptimizePreparedResult =
  | { ok: true; report: OptimizeReportView; candidateRoutes: RouteReadModel[] }
  | { ok: false; failure: OptimizeFailure };

export const DEFAULT_OPTIMIZE_REFERENCE_TOKENS: OptimizeReferenceTokens = {
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_tokens: 0,
  cache_write_tokens: 0
};

export function normalizeOptimizeRoutesCsv(routesCsv: string | undefined): { routes?: string[]; errorMessage?: string } {
  if (typeof routesCsv === "undefined") {
    return {};
  }

  const routes = routesCsv
    .split(",")
    .map((route) => route.trim())
    .filter((route) => route.length > 0);
  const uniqueRoutes = [...new Set(routes)];

  if (uniqueRoutes.length === 0) {
    return { errorMessage: "Flag '--routes' must contain at least one route id" };
  }

  if (uniqueRoutes.length > BENCH_MAX_ROUTES) {
    return { errorMessage: `Flag '--routes' must contain at most ${BENCH_MAX_ROUTES} route ids` };
  }

  return { routes: uniqueRoutes };
}

export function buildOptimizeFailure(
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>
): OptimizeFailure {
  return {
    code,
    message,
    ...(typeof details === "undefined" ? {} : { details })
  };
}

export function selectOptimizeCandidateRoutes(
  readModel: CliReadModel,
  modelId: string,
  requestedRoutes: string[] | null
): { ok: true; routes: RouteReadModel[] } | { ok: false; failure: OptimizeFailure } {
  if (!readModel.modelsByName[modelId]) {
    return {
      ok: false,
      failure: buildOptimizeFailure(APP_ERROR_CODES.modelNotFound, `Model '${modelId}' was not found`)
    };
  }

  const candidates: RouteReadModel[] = [];

  if (Array.isArray(requestedRoutes)) {
    for (const routeName of requestedRoutes) {
      const route = readModel.routesByName[routeName];
      if (!route) {
        return {
          ok: false,
          failure: buildOptimizeFailure(APP_ERROR_CODES.routeNotFound, `Route '${routeName}' was not found`)
        };
      }

      if (route.model !== modelId) {
        return {
          ok: false,
          failure: buildOptimizeFailure(
            APP_ERROR_CODES.optimizeRouteModelMismatch,
            `Route '${routeName}' targets model '${route.model}', not '${modelId}'`,
            {
              route_id: routeName,
              route_model: route.model,
              target_model: modelId
            }
          )
        };
      }

      candidates.push(route);
    }
  } else {
    candidates.push(...readModel.routes.filter((route) => route.model === modelId));
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      failure: buildOptimizeFailure(APP_ERROR_CODES.optimizeNoCandidates, `Model '${modelId}' has no candidate routes`)
    };
  }

  if (candidates.length < 2) {
    return {
      ok: false,
      failure: buildOptimizeFailure(
        APP_ERROR_CODES.optimizeInsufficientCandidates,
        `Model '${modelId}' has only ${candidates.length} candidate route; optimize requires at least 2`
      )
    };
  }

  return { ok: true, routes: candidates };
}

function getCostSource(route: RouteReadModel): "route" | "model" | "none" {
  if (route.cost !== null) {
    return "route";
  }

  if (route.model_cost !== null) {
    return "model";
  }

  return "none";
}

function estimateCost(cost: CostConfig, referenceTokens: OptimizeReferenceTokens): number {
  return (
    (referenceTokens.input_tokens / 1_000_000) * cost.input +
    (referenceTokens.output_tokens / 1_000_000) * cost.output +
    (referenceTokens.cache_read_tokens / 1_000_000) * cost.cacheRead +
    (referenceTokens.cache_write_tokens / 1_000_000) * cost.cacheWrite
  );
}

export function buildCostOptimizeReport(options: {
  modelId: string;
  requestedRoutes: string[] | null;
  candidateRoutes: RouteReadModel[];
  referenceTokens: OptimizeReferenceTokens;
}): CostOptimizeExecutionResult {
  const entries = options.candidateRoutes.map((route): OptimizeRankingEntry => {
    const effectiveCost = route.effective_cost;
    const costSource = getCostSource(route);

    if (effectiveCost === null) {
      return {
        rank: null,
        objective: "cost",
        route_id: route.name,
        display_name: route.display_name || null,
        model: route.model,
        service_provider: route.service_provider,
        provider_model_id: route.provider_model_id,
        score: null,
        score_unit: "usd",
        details: {
          reference_tokens: options.referenceTokens,
          effective_cost: null,
          cost_source: "none",
          estimated_cost: null
        },
        disqualified: {
          reason: "missing_effective_cost",
          message: `Route '${route.name}' has no route or model cost metadata`
        }
      };
    }

    const estimatedCost = estimateCost(effectiveCost, options.referenceTokens);
    return {
      rank: null,
      objective: "cost",
      route_id: route.name,
      display_name: route.display_name || null,
      model: route.model,
      service_provider: route.service_provider,
      provider_model_id: route.provider_model_id,
      score: estimatedCost,
      score_unit: "usd",
      details: {
        reference_tokens: options.referenceTokens,
        effective_cost: effectiveCost,
        cost_source: costSource,
        estimated_cost: estimatedCost
      },
      disqualified: null
    };
  });

  const qualifiedEntries = entries
    .filter((entry): entry is OptimizeRankingEntry & { score: number; disqualified: null } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.route_id.localeCompare(right.route_id));

  if (qualifiedEntries.length === 0) {
    return {
      ok: false,
      failure: buildOptimizeFailure(
        APP_ERROR_CODES.optimizeObjectiveNoData,
        `No candidate routes for model '${options.modelId}' have effective cost metadata`
      )
    };
  }

  const ranksByRoute = new Map<string, number>();
  qualifiedEntries.forEach((entry, index) => {
    ranksByRoute.set(entry.route_id, index + 1);
  });

  const ranking = [
    ...entries
      .filter((entry) => entry.score !== null)
      .map((entry) => ({
        ...entry,
        rank: ranksByRoute.get(entry.route_id) ?? null
      }))
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)),
    ...entries.filter((entry) => entry.score === null)
  ];
  const winner = qualifiedEntries[0];
  if (!winner) {
    return {
      ok: false,
      failure: buildOptimizeFailure(
        APP_ERROR_CODES.optimizeObjectiveNoData,
        `No candidate routes for model '${options.modelId}' have effective cost metadata`
      )
    };
  }

  const tiedWith = qualifiedEntries
    .slice(1)
    .filter((entry) => entry.score === winner.score)
    .map((entry) => entry.route_id);
  const disqualified = ranking
    .filter((entry) => entry.disqualified !== null)
    .map((entry) => ({
      route_id: entry.route_id,
      reason: entry.disqualified?.reason ?? "unknown",
      message: entry.disqualified?.message ?? "Candidate was disqualified"
    }));

  return {
    ok: true,
    report: {
      run: {
        run_id: null,
        persisted: false,
        created_at: null,
        finished_at: null,
        created_by: null,
        status: "completed",
        target_model: options.modelId,
        objective: "cost"
      },
      candidates: {
        requested_routes: options.requestedRoutes,
        resolved_routes: options.candidateRoutes.map((route) => route.name),
        disqualified
      },
      reference_tokens: options.referenceTokens,
      bench: null,
      ranking,
      winner: {
        route_id: winner.route_id,
        score: winner.score,
        score_unit: "usd",
        tied_with: tiedWith
      },
      warnings: []
    }
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint] ?? null;
  }

  const lower = sorted[midpoint - 1] ?? 0;
  const upper = sorted[midpoint] ?? lower;
  return (lower + upper) / 2;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function benchmarkPathFromScoreJson(scoreJson: string | null): BenchmarkPath {
  if (typeof scoreJson !== "string") {
    return "gateway";
  }

  try {
    const parsed = JSON.parse(scoreJson) as unknown;
    if (isRecord(parsed) && parsed["path"] === "direct") {
      return "direct";
    }
  } catch {
    return "gateway";
  }

  return "gateway";
}

function latencyStats(samples: BenchmarkSampleRecord[]): {
  measuredSampleCount: number;
  successfulMeasuredSampleCount: number;
  failedMeasuredSampleCount: number;
  medianLatencyMs: number | null;
  averageLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
} {
  const measuredSamples = samples.filter((sample) => sample.is_warmup === 0);
  const latencyValues = measuredSamples
    .filter((sample) => sample.outcome === "succeeded" && typeof sample.latency_ms === "number")
    .map((sample) => sample.latency_ms as number);

  return {
    measuredSampleCount: measuredSamples.length,
    successfulMeasuredSampleCount: latencyValues.length,
    failedMeasuredSampleCount: measuredSamples.length - latencyValues.length,
    medianLatencyMs: median(latencyValues),
    averageLatencyMs: average(latencyValues),
    minLatencyMs: latencyValues.length > 0 ? Math.min(...latencyValues) : null,
    maxLatencyMs: latencyValues.length > 0 ? Math.max(...latencyValues) : null
  };
}

function summarizeLatencyByPath(samples: BenchmarkSampleRecord[]): OptimizeLatencyPathSummary[] {
  const measuredSamples = samples.filter((sample) => sample.is_warmup === 0);
  const buckets = new Map<BenchmarkPath, BenchmarkSampleRecord[]>();

  for (const sample of measuredSamples) {
    const pathName = benchmarkPathFromScoreJson(sample.score_json);
    const bucket = buckets.get(pathName) ?? [];
    bucket.push(sample);
    buckets.set(pathName, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pathName, bucket]) => {
      const stats = latencyStats(bucket);
      return {
        path: pathName,
        measured_sample_count: stats.measuredSampleCount,
        successful_sample_count: stats.successfulMeasuredSampleCount,
        failed_sample_count: stats.failedMeasuredSampleCount,
        median_latency_ms: stats.medianLatencyMs,
        average_latency_ms: stats.averageLatencyMs,
        min_latency_ms: stats.minLatencyMs,
        max_latency_ms: stats.maxLatencyMs
      };
    });
}

export function buildLatencyOptimizeReport(options: {
  modelId: string;
  requestedRoutes: string[] | null;
  candidateRoutes: RouteReadModel[];
  benchmarkRunId: string;
  benchmarkSummary: BenchmarkRunSummary;
  benchmarkExecution: BenchmarkExecutionView;
  samples: BenchmarkSampleRecord[];
}): LatencyOptimizeExecutionResult {
  const samplesByRoute = new Map<string, BenchmarkSampleRecord[]>();
  for (const sample of options.samples) {
    if (typeof sample.route_id !== "string") {
      continue;
    }

    const bucket = samplesByRoute.get(sample.route_id) ?? [];
    bucket.push(sample);
    samplesByRoute.set(sample.route_id, bucket);
  }

  const entries = options.candidateRoutes.map((route): OptimizeRankingEntry => {
    const routeSamples = samplesByRoute.get(route.name) ?? [];
    const stats = latencyStats(routeSamples);
    const byPath = summarizeLatencyByPath(routeSamples);

    if (stats.medianLatencyMs === null) {
      return {
        rank: null,
        objective: "latency",
        route_id: route.name,
        display_name: route.display_name || null,
        model: route.model,
        service_provider: route.service_provider,
        provider_model_id: route.provider_model_id,
        score: null,
        score_unit: "ms",
        details: {
          measured_sample_count: stats.measuredSampleCount,
          successful_measured_sample_count: stats.successfulMeasuredSampleCount,
          failed_measured_sample_count: stats.failedMeasuredSampleCount,
          median_latency_ms: null,
          average_latency_ms: stats.averageLatencyMs,
          min_latency_ms: stats.minLatencyMs,
          max_latency_ms: stats.maxLatencyMs,
          by_path: byPath
        },
        disqualified: {
          reason: "no_successful_measured_samples",
          message: `Route '${route.name}' has no successful measured benchmark samples`
        }
      };
    }

    return {
      rank: null,
      objective: "latency",
      route_id: route.name,
      display_name: route.display_name || null,
      model: route.model,
      service_provider: route.service_provider,
      provider_model_id: route.provider_model_id,
      score: stats.medianLatencyMs,
      score_unit: "ms",
      details: {
        measured_sample_count: stats.measuredSampleCount,
        successful_measured_sample_count: stats.successfulMeasuredSampleCount,
        failed_measured_sample_count: stats.failedMeasuredSampleCount,
        median_latency_ms: stats.medianLatencyMs,
        average_latency_ms: stats.averageLatencyMs,
        min_latency_ms: stats.minLatencyMs,
        max_latency_ms: stats.maxLatencyMs,
        by_path: byPath
      },
      disqualified: null
    };
  });

  const qualifiedEntries = entries
    .filter((entry): entry is OptimizeRankingEntry & { score: number; disqualified: null } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.route_id.localeCompare(right.route_id));

  if (qualifiedEntries.length === 0) {
    return {
      ok: false,
      failure: buildOptimizeFailure(
        APP_ERROR_CODES.optimizeObjectiveNoData,
        `No candidate routes for model '${options.modelId}' have successful measured benchmark samples`,
        {
          benchmark_run_id: options.benchmarkRunId
        }
      )
    };
  }

  const ranksByRoute = new Map<string, number>();
  qualifiedEntries.forEach((entry, index) => {
    ranksByRoute.set(entry.route_id, index + 1);
  });

  const ranking = [
    ...entries
      .filter((entry) => entry.score !== null)
      .map((entry) => ({
        ...entry,
        rank: ranksByRoute.get(entry.route_id) ?? null
      }))
      .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)),
    ...entries.filter((entry) => entry.score === null)
  ];
  const winner = qualifiedEntries[0];
  if (!winner) {
    return {
      ok: false,
      failure: buildOptimizeFailure(
        APP_ERROR_CODES.optimizeObjectiveNoData,
        `No candidate routes for model '${options.modelId}' have successful measured benchmark samples`,
        {
          benchmark_run_id: options.benchmarkRunId
        }
      )
    };
  }

  const tiedWith = qualifiedEntries
    .slice(1)
    .filter((entry) => entry.score === winner.score)
    .map((entry) => entry.route_id);
  const disqualified = ranking
    .filter((entry) => entry.disqualified !== null)
    .map((entry) => ({
      route_id: entry.route_id,
      reason: entry.disqualified?.reason ?? "unknown",
      message: entry.disqualified?.message ?? "Candidate was disqualified"
    }));

  return {
    ok: true,
    report: {
      run: {
        run_id: null,
        persisted: false,
        created_at: null,
        finished_at: null,
        created_by: null,
        status: "completed",
        target_model: options.modelId,
        objective: "latency"
      },
      candidates: {
        requested_routes: options.requestedRoutes,
        resolved_routes: options.candidateRoutes.map((route) => route.name),
        disqualified
      },
      reference_tokens: DEFAULT_OPTIMIZE_REFERENCE_TOKENS,
      bench: {
        run_id: options.benchmarkRunId,
        summary: options.benchmarkSummary,
        execution: options.benchmarkExecution
      },
      ranking,
      winner: {
        route_id: winner.route_id,
        score: winner.score,
        score_unit: "ms",
        tied_with: tiedWith
      },
      warnings: options.benchmarkExecution.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        details: {
          path: warning.path,
          ...(warning.details ?? {})
        }
      }))
    }
  };
}

export function buildOptimizeCandidateSnapshot(routes: RouteReadModel[]): OptimizeCandidateSnapshot[] {
  return routes.map((route) => ({
    route_id: route.name,
    display_name: route.display_name || null,
    model: route.model,
    service_provider: route.service_provider,
    provider_model_id: route.provider_model_id,
    api_mode: route.api_mode,
    effective_timeout_ms: route.effective_timeout_ms,
    effective_cost: route.effective_cost
  }));
}

export function attachPersistedOptimizeRunMetadata(options: {
  report: OptimizeReportView;
  runId: string;
  createdAt: string;
  finishedAt: string;
  createdBy: string;
  storePath: string;
}): OptimizeReportView {
  return {
    ...options.report,
    store_path: options.storePath,
    run: {
      ...options.report.run,
      run_id: options.runId,
      persisted: true,
      created_at: options.createdAt,
      finished_at: options.finishedAt,
      created_by: options.createdBy
    }
  };
}

export function buildOptimizationRunRecord(options: {
  report: OptimizeReportView;
  candidateSnapshot: OptimizeCandidateSnapshot[];
  benchmarkRunId: string | null;
  settings: Record<string, unknown>;
  runId: string;
  createdAt: string;
  finishedAt: string;
  createdBy: string;
}): OptimizationRunRecord {
  return {
    id: options.runId,
    created_at: options.createdAt,
    finished_at: options.finishedAt,
    created_by: options.createdBy,
    target_model: options.report.run.target_model,
    objective: options.report.run.objective,
    status: options.report.run.status,
    winner_route: options.report.winner.route_id,
    benchmark_run_id: options.benchmarkRunId,
    settings_json: JSON.stringify(options.settings),
    candidate_snapshot_json: JSON.stringify(options.candidateSnapshot),
    result_json: JSON.stringify(options.report),
    warnings_json: JSON.stringify(options.report.warnings)
  };
}

export function reportFromOptimizationRunView(view: OptimizationRunView, storePath: string): OptimizeReportView {
  if (typeof view.result !== "object" || view.result === null || Array.isArray(view.result)) {
    throw new Error(`Optimization run '${view.run_id}' has malformed result_json.`);
  }

  const report = view.result as OptimizeReportView;
  return {
    ...report,
    store_path: storePath,
    run: {
      ...report.run,
      run_id: view.run_id,
      persisted: true,
      created_at: view.created_at,
      finished_at: view.finished_at,
      created_by: view.created_by,
      status: view.status,
      target_model: view.target_model,
      objective: view.objective as "cost" | "latency"
    },
    warnings: Array.isArray(view.warnings) ? (view.warnings as OptimizeWarning[]) : report.warnings
  };
}

export function buildCostOptimizeExecution(options: {
  readModel: CliReadModel;
  modelId: string;
  requestedRoutes: string[] | null;
  referenceTokens: OptimizeReferenceTokens;
}): CostOptimizePreparedResult {
  const selectedCandidates = selectOptimizeCandidateRoutes(
    options.readModel,
    options.modelId,
    options.requestedRoutes
  );
  if (!selectedCandidates.ok) {
    return selectedCandidates;
  }

  const reportResult = buildCostOptimizeReport({
    modelId: options.modelId,
    requestedRoutes: options.requestedRoutes,
    candidateRoutes: selectedCandidates.routes,
    referenceTokens: options.referenceTokens
  });
  if (!reportResult.ok) {
    return reportResult;
  }

  return {
    ok: true,
    report: reportResult.report,
    candidateRoutes: selectedCandidates.routes
  };
}

export function persistCostOptimizeReport(options: {
  report: OptimizeReportView;
  candidateRoutes: RouteReadModel[];
  requestedRoutes: string[] | null;
  referenceTokens: OptimizeReferenceTokens;
  service: ObservabilityService;
  storePath: string;
  createdBy: string;
  runId?: string;
  now?: Date;
}): OptimizeReportView {
  const runId = options.runId ?? randomUUID();
  const createdAt = (options.now ?? new Date()).toISOString();
  const finishedAt = createdAt;
  const persistedReport = attachPersistedOptimizeRunMetadata({
    report: options.report,
    runId,
    createdAt,
    finishedAt,
    createdBy: options.createdBy,
    storePath: options.storePath
  });
  const candidateSnapshot = buildOptimizeCandidateSnapshot(options.candidateRoutes);

  options.service.optimizations.createRun(
    buildOptimizationRunRecord({
      report: persistedReport,
      candidateSnapshot,
      benchmarkRunId: null,
      settings: {
        requested_routes: options.requestedRoutes,
        reference_tokens: options.referenceTokens
      },
      runId,
      createdAt,
      finishedAt,
      createdBy: options.createdBy
    })
  );

  return persistedReport;
}

export function persistLatencyOptimizeReport(options: {
  report: OptimizeReportView;
  candidateRoutes: RouteReadModel[];
  requestedRoutes: string[] | null;
  service: ObservabilityService;
  storePath: string;
  createdBy: string;
  benchmarkRunId: string;
  settings: Record<string, unknown>;
  runId?: string;
  now?: Date;
}): OptimizeReportView {
  const runId = options.runId ?? randomUUID();
  const createdAt = (options.now ?? new Date()).toISOString();
  const finishedAt = createdAt;
  const persistedReport = attachPersistedOptimizeRunMetadata({
    report: options.report,
    runId,
    createdAt,
    finishedAt,
    createdBy: options.createdBy,
    storePath: options.storePath
  });
  const candidateSnapshot = buildOptimizeCandidateSnapshot(options.candidateRoutes);

  options.service.optimizations.createRun(
    buildOptimizationRunRecord({
      report: persistedReport,
      candidateSnapshot,
      benchmarkRunId: options.benchmarkRunId,
      settings: {
        requested_routes: options.requestedRoutes,
        ...options.settings
      },
      runId,
      createdAt,
      finishedAt,
      createdBy: options.createdBy
    })
  );

  return persistedReport;
}

export function runCostOptimizeAndPersist(options: {
  readModel: CliReadModel;
  modelId: string;
  requestedRoutes: string[] | null;
  referenceTokens: OptimizeReferenceTokens;
  service: ObservabilityService;
  storePath: string;
  createdBy: string;
  runId?: string;
  now?: Date;
}): CostOptimizeExecutionResult {
  const prepared = buildCostOptimizeExecution({
    readModel: options.readModel,
    modelId: options.modelId,
    requestedRoutes: options.requestedRoutes,
    referenceTokens: options.referenceTokens
  });
  if (!prepared.ok) {
    return prepared;
  }

  return {
    ok: true,
    report: persistCostOptimizeReport({
      report: prepared.report,
      candidateRoutes: prepared.candidateRoutes,
      requestedRoutes: options.requestedRoutes,
      referenceTokens: options.referenceTokens,
      service: options.service,
      storePath: options.storePath,
      createdBy: options.createdBy,
      runId: options.runId,
      now: options.now
    })
  };
}
