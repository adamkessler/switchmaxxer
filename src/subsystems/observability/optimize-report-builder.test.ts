import assert from "node:assert/strict";
import test from "node:test";

import { APP_ERROR_CODES } from "../../platform/error-codes";
import type { CliReadModel, CostConfig, ModelReadModel, RouteReadModel } from "../../platform/types";
import type { BenchmarkRunSummary, BenchmarkSampleRecord } from "./benchmarks";
import type { BenchmarkExecutionView } from "./contracts";
import {
  buildCostOptimizeExecution,
  buildCostOptimizeReport,
  buildLatencyOptimizeReport,
  normalizeOptimizeRoutesCsv,
  selectOptimizeCandidateRoutes
} from "./optimize-report-builder";

const TARGET_MODEL = "target-model";
const OTHER_MODEL = "other-model";

const ZERO_COST: CostConfig = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0
};

const ONE_DOLLAR_PER_MILLION: CostConfig = {
  input: 1,
  output: 1,
  cacheRead: 1,
  cacheWrite: 1
};

const TWO_DOLLARS_PER_MILLION: CostConfig = {
  input: 2,
  output: 2,
  cacheRead: 2,
  cacheWrite: 2
};

function route(overrides: Partial<RouteReadModel> & { name: string }): RouteReadModel {
  const cost = Object.prototype.hasOwnProperty.call(overrides, "cost") ? (overrides.cost ?? null) : null;
  const modelCost = Object.prototype.hasOwnProperty.call(overrides, "model_cost")
    ? (overrides.model_cost ?? null)
    : null;
  const effectiveCost = Object.prototype.hasOwnProperty.call(overrides, "effective_cost")
    ? (overrides.effective_cost ?? null)
    : cost ?? modelCost;

  return {
    name: overrides.name,
    model: overrides.model ?? TARGET_MODEL,
    service_provider: overrides.service_provider ?? "provider-test",
    provider_model_id: overrides.provider_model_id ?? overrides.name,
    display_name: overrides.display_name ?? overrides.name,
    api_mode: overrides.api_mode ?? "openai-completions",
    cost,
    model_cost: modelCost,
    effective_cost: effectiveCost,
    timeout_ms: overrides.timeout_ms ?? null,
    effective_timeout_ms: overrides.effective_timeout_ms ?? null
  };
}

function model(name: string, routes: RouteReadModel[]): ModelReadModel {
  return {
    name,
    display_name: name,
    model_creator: "switchmaxxer-test",
    route_count: routes.filter((candidate) => candidate.model === name).length,
    cost: null
  };
}

function readModel(routes: RouteReadModel[], modelNames = [TARGET_MODEL, OTHER_MODEL]): CliReadModel {
  const models = modelNames.map((name) => model(name, routes));

  return {
    sourceFile: "config.json",
    sourcePath: "/tmp/config.json",
    rawText: "{}",
    models,
    modelsByName: Object.fromEntries(models.map((entry) => [entry.name, entry])),
    providers: [],
    providersByName: {},
    routes,
    routesByName: Object.fromEntries(routes.map((entry) => [entry.name, entry]))
  };
}

const REFERENCE_TOKENS = {
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_tokens: 0,
  cache_write_tokens: 0
};

const BENCHMARK_SUMMARY: BenchmarkRunSummary = {
  total_samples: 0,
  measured_samples: 0,
  warmup_samples: 0,
  success_count: 0,
  failed_count: 0,
  average_latency_ms: null,
  min_latency_ms: null,
  max_latency_ms: null,
  average_ttft_ms: null,
  average_duration_ms: null
};

const BENCHMARK_EXECUTION: BenchmarkExecutionView = {
  requested_path_mode: "both",
  effective_paths: ["gateway", "direct"],
  skipped_paths: [],
  warnings: []
};

let sampleSequence = 0;

function benchmarkSample(overrides: Partial<BenchmarkSampleRecord> & { route_id: string }): BenchmarkSampleRecord {
  sampleSequence += 1;
  const now = "2026-04-26T00:00:00.000Z";

  return {
    id: `sample-${sampleSequence}`,
    benchmark_run_id: "bench-latency",
    request_execution_id: `request-${sampleSequence}`,
    route_id: overrides.route_id,
    provider_id: overrides.provider_id ?? "provider-test",
    provider_model_id: overrides.provider_model_id ?? overrides.route_id,
    sample_index: overrides.sample_index ?? sampleSequence,
    started_at: overrides.started_at ?? now,
    completed_at: Object.prototype.hasOwnProperty.call(overrides, "completed_at") ? (overrides.completed_at ?? null) : now,
    status_code: Object.prototype.hasOwnProperty.call(overrides, "status_code") ? (overrides.status_code ?? null) : 200,
    outcome: overrides.outcome ?? "succeeded",
    latency_ms: Object.prototype.hasOwnProperty.call(overrides, "latency_ms") ? (overrides.latency_ms ?? null) : 100,
    ttft_ms: overrides.ttft_ms ?? null,
    duration_ms: overrides.duration_ms ?? null,
    input_tokens: overrides.input_tokens ?? null,
    output_tokens: overrides.output_tokens ?? null,
    total_tokens: overrides.total_tokens ?? null,
    estimated_cost_micros: overrides.estimated_cost_micros ?? null,
    is_warmup: overrides.is_warmup ?? 0,
    score_value: overrides.score_value ?? null,
    score_scale: overrides.score_scale ?? null,
    score_direction: overrides.score_direction ?? null,
    score_source: overrides.score_source ?? null,
    score_method: overrides.score_method ?? null,
    scored_at: overrides.scored_at ?? null,
    score_json: Object.prototype.hasOwnProperty.call(overrides, "score_json")
      ? (overrides.score_json ?? null)
      : "{\"path\":\"gateway\"}"
  };
}

void test("normalizeOptimizeRoutesCsv trims and deduplicates requested routes in first-seen order", () => {
  assert.deepEqual(normalizeOptimizeRoutesCsv(" beta , alpha,beta, alpha "), {
    routes: ["beta", "alpha"]
  });
});

void test("selectOptimizeCandidateRoutes validates model scope for explicit route candidates", () => {
  const candidates = readModel([
    route({ name: "target-a" }),
    route({ name: "target-b" }),
    route({ name: "other-a", model: OTHER_MODEL })
  ]);

  assert.deepEqual(
    selectOptimizeCandidateRoutes(candidates, TARGET_MODEL, ["target-b", "target-a"]),
    {
      ok: true,
      routes: [
        candidates.routesByName["target-b"],
        candidates.routesByName["target-a"]
      ]
    }
  );

  const mismatch = selectOptimizeCandidateRoutes(candidates, TARGET_MODEL, ["target-a", "other-a"]);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.failure.code, APP_ERROR_CODES.optimizeRouteModelMismatch);
    assert.deepEqual(mismatch.failure.details, {
      route_id: "other-a",
      route_model: OTHER_MODEL,
      target_model: TARGET_MODEL
    });
  }
});

void test("buildCostOptimizeReport sorts exact cost ties by route id and records tied_with", () => {
  const result = buildCostOptimizeReport({
    modelId: TARGET_MODEL,
    requestedRoutes: null,
    candidateRoutes: [
      route({ name: "beta", cost: ONE_DOLLAR_PER_MILLION }),
      route({ name: "alpha", cost: ONE_DOLLAR_PER_MILLION }),
      route({ name: "gamma", cost: TWO_DOLLARS_PER_MILLION })
    ],
    referenceTokens: REFERENCE_TOKENS
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.report.ranking.map((entry) => ({
        rank: entry.rank,
        route_id: entry.route_id,
        score: entry.score
      })),
      [
        { rank: 1, route_id: "alpha", score: 0.002 },
        { rank: 2, route_id: "beta", score: 0.002 },
        { rank: 3, route_id: "gamma", score: 0.004 }
      ]
    );
    assert.deepEqual(result.report.winner, {
      route_id: "alpha",
      score: 0.002,
      score_unit: "usd",
      tied_with: ["beta"]
    });
  }
});

void test("buildCostOptimizeReport keeps missing-cost candidates disqualified without failing the run", () => {
  const result = buildCostOptimizeReport({
    modelId: TARGET_MODEL,
    requestedRoutes: ["route-costless", "route-free", "route-paid"],
    candidateRoutes: [
      route({ name: "route-costless" }),
      route({ name: "route-free", model_cost: ZERO_COST }),
      route({ name: "route-paid", cost: ONE_DOLLAR_PER_MILLION })
    ],
    referenceTokens: REFERENCE_TOKENS
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.report.winner.route_id, "route-free");
    assert.deepEqual(result.report.candidates.disqualified, [
      {
        route_id: "route-costless",
        reason: "missing_effective_cost",
        message: "Route 'route-costless' has no route or model cost metadata"
      }
    ]);
    assert.deepEqual(
      result.report.ranking.map((entry) => ({
        rank: entry.rank,
        route_id: entry.route_id,
        cost_source: entry.details.cost_source,
        disqualified: entry.disqualified?.reason ?? null
      })),
      [
        { rank: 1, route_id: "route-free", cost_source: "model", disqualified: null },
        { rank: 2, route_id: "route-paid", cost_source: "route", disqualified: null },
        {
          rank: null,
          route_id: "route-costless",
          cost_source: "none",
          disqualified: "missing_effective_cost"
        }
      ]
    );
  }
});

void test("buildCostOptimizeExecution fails when every selected candidate lacks cost data", () => {
  const result = buildCostOptimizeExecution({
    readModel: readModel([
      route({ name: "route-a" }),
      route({ name: "route-b" })
    ]),
    modelId: TARGET_MODEL,
    requestedRoutes: null,
    referenceTokens: REFERENCE_TOKENS
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, APP_ERROR_CODES.optimizeObjectiveNoData);
    assert.equal(
      result.failure.message,
      "No candidate routes for model 'target-model' have effective cost metadata"
    );
  }
});

void test("buildLatencyOptimizeReport ranks successful measured medians and keeps failed candidates disqualified", () => {
  const result = buildLatencyOptimizeReport({
    modelId: TARGET_MODEL,
    requestedRoutes: null,
    candidateRoutes: [
      route({ name: "route-slow" }),
      route({ name: "route-fast" }),
      route({ name: "route-failed" })
    ],
    benchmarkRunId: "bench-latency",
    benchmarkSummary: BENCHMARK_SUMMARY,
    benchmarkExecution: BENCHMARK_EXECUTION,
    samples: [
      benchmarkSample({ route_id: "route-fast", latency_ms: 1000, is_warmup: 1 }),
      benchmarkSample({ route_id: "route-fast", latency_ms: 90, score_json: "{\"path\":\"gateway\"}" }),
      benchmarkSample({ route_id: "route-fast", latency_ms: 110, score_json: "{\"path\":\"direct\"}" }),
      benchmarkSample({ route_id: "route-slow", latency_ms: 150 }),
      benchmarkSample({ route_id: "route-slow", latency_ms: 170 }),
      benchmarkSample({ route_id: "route-failed", outcome: "failed", status_code: 500, latency_ms: null })
    ]
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.report.run.objective, "latency");
    assert.deepEqual(
      result.report.ranking.map((entry) => ({
        rank: entry.rank,
        route_id: entry.route_id,
        score: entry.score,
        measured: entry.details.measured_sample_count,
        successful: entry.details.successful_measured_sample_count,
        failed: entry.details.failed_measured_sample_count,
        disqualified: entry.disqualified?.reason ?? null
      })),
      [
        {
          rank: 1,
          route_id: "route-fast",
          score: 100,
          measured: 2,
          successful: 2,
          failed: 0,
          disqualified: null
        },
        {
          rank: 2,
          route_id: "route-slow",
          score: 160,
          measured: 2,
          successful: 2,
          failed: 0,
          disqualified: null
        },
        {
          rank: null,
          route_id: "route-failed",
          score: null,
          measured: 1,
          successful: 0,
          failed: 1,
          disqualified: "no_successful_measured_samples"
        }
      ]
    );
    assert.deepEqual(result.report.winner, {
      route_id: "route-fast",
      score: 100,
      score_unit: "ms",
      tied_with: []
    });
    assert.equal(result.report.bench?.run_id, "bench-latency");
  }
});

void test("buildLatencyOptimizeReport fails when every candidate has no successful measured latency", () => {
  const result = buildLatencyOptimizeReport({
    modelId: TARGET_MODEL,
    requestedRoutes: null,
    candidateRoutes: [
      route({ name: "route-a" }),
      route({ name: "route-b" })
    ],
    benchmarkRunId: "bench-empty-latency",
    benchmarkSummary: BENCHMARK_SUMMARY,
    benchmarkExecution: BENCHMARK_EXECUTION,
    samples: [
      benchmarkSample({ route_id: "route-a", outcome: "failed", status_code: 500, latency_ms: null }),
      benchmarkSample({ route_id: "route-b", latency_ms: 200, is_warmup: 1 })
    ]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, APP_ERROR_CODES.optimizeObjectiveNoData);
    assert.equal(
      result.failure.message,
      "No candidate routes for model 'target-model' have successful measured benchmark samples"
    );
    assert.deepEqual(result.failure.details, {
      benchmark_run_id: "bench-empty-latency"
    });
  }
});
