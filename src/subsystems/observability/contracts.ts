import type { BenchmarkRunRecord, BenchmarkRunSummary, BenchmarkSampleRecord } from "./benchmarks";
import type { ControlPlaneActionEventRecord } from "./control-plane-actions";
import { isRecord } from "../../platform/type-guards";
import { parseJsonObjectWithWarning, parseJsonTextWithWarning } from "./json-parse";
import type { RequestExecutionRecord } from "./request-executions";
import type { ObservationRecord } from "./types";

export type BenchmarkPath = "gateway" | "direct";

export interface BenchmarkExecutionWarning {
  code: string;
  message: string;
  path: BenchmarkPath;
  details?: Record<string, unknown>;
}

export interface BenchmarkExecutionView {
  requested_path_mode: string | null;
  effective_paths: BenchmarkPath[] | null;
  skipped_paths: BenchmarkPath[];
  warnings: BenchmarkExecutionWarning[];
}

export interface BenchmarkPathSummaryView {
  path: BenchmarkPath;
  total_samples: number;
  measured_samples: number;
  warmup_samples: number;
  success_count: number;
  failed_count: number;
  average_latency_ms: number | null;
  average_ttft_ms: number | null;
  average_duration_ms: number | null;
  warmup_latency_ms: number[];
  warmup_median_latency_ms: number | null;
  warmup_max_latency_ms: number | null;
  last_warmup_latency_ms: number | null;
  first_measured_latency_ms: number | null;
  first_measured_suspect: boolean;
}

export interface BenchmarkReportView {
  store_path?: string;
  run: Record<string, unknown>;
  execution: BenchmarkExecutionView;
  summary: BenchmarkRunSummary;
  analysis: {
    by_path: BenchmarkPathSummaryView[];
  };
  samples: Array<Record<string, unknown>>;
}

function benchmarkPathFromSample(sample: BenchmarkSampleRecord): BenchmarkPath {
  const parsed = parseJsonTextWithWarning(sample.score_json, "benchmark_samples.score_json").value;
  if (isRecord(parsed) && parsed["path"] === "direct") {
    return "direct";
  }

  return "gateway";
}

export function tracePathFromExecution(trace: RequestExecutionRecord): "gateway" | "direct" {
  if (trace.client_api_mode === "direct-upstream") {
    return "direct";
  }

  return "gateway";
}

export function toTraceSummaryView(trace: RequestExecutionRecord): Record<string, unknown> {
  return {
    trace_id: trace.request_id,
    request_id: trace.request_id,
    path: tracePathFromExecution(trace),
    started_at: trace.started_at,
    completed_at: trace.completed_at,
    route_id: trace.route_id,
    route_name: trace.route_name,
    provider_id: trace.provider_id,
    provider_model_id: trace.provider_model_id,
    client_api_mode: trace.client_api_mode,
    upstream_api_mode: trace.upstream_api_mode,
    status_code: trace.status_code,
    outcome: trace.outcome,
    observation_count: trace.observation_count,
    latency_ms: trace.latency_ms,
    ttft_ms: trace.ttft_ms,
    duration_ms: trace.duration_ms,
    gateway_residency_ms: trace.gateway_residency_ms,
    partial_output: trace.partial_output === 1,
    failure_stage: trace.failure_stage,
    failure_reason: trace.failure_reason
  };
}

export function toTraceObservationView(observation: ObservationRecord): Record<string, unknown> {
  const tags = parseJsonTextWithWarning(observation.tags_json, "observations.tags_json");
  const attributes = parseJsonObjectWithWarning(observation.attributes_json, "observations.attributes_json");
  return {
    observation_id: observation.id,
    request_id: observation.request_id,
    observed_at: observation.observed_at,
    surface: observation.surface,
    kind: observation.kind,
    event: observation.event,
    stage: observation.stage,
    outcome: observation.outcome,
    route_id: observation.route_id,
    route_name: observation.route_name,
    provider_id: observation.provider_id,
    provider_model_id: observation.provider_model_id,
    client_api_mode: observation.client_api_mode,
    upstream_api_mode: observation.upstream_api_mode,
    status_code: observation.status_code,
    latency_ms: observation.latency_ms,
    ttft_ms: observation.ttft_ms,
    duration_ms: observation.duration_ms,
    input_tokens: observation.input_tokens,
    output_tokens: observation.output_tokens,
    total_tokens: observation.total_tokens,
    estimated_cost_micros: observation.estimated_cost_micros,
    currency: observation.currency,
    message: observation.message,
    tags: tags.value,
    attributes: attributes.value,
    attributes_truncated: observation.attributes_truncated === 1,
    parse_warnings: [...tags.warnings, ...attributes.warnings]
  };
}

export function toBenchmarkSampleView(sample: BenchmarkSampleRecord): Record<string, unknown> {
  const scoreDetails = parseJsonTextWithWarning(sample.score_json, "benchmark_samples.score_json");
  return {
    sample_id: sample.id,
    benchmark_run_id: sample.benchmark_run_id,
    request_execution_id: sample.request_execution_id,
    route_id: sample.route_id,
    provider_id: sample.provider_id,
    provider_model_id: sample.provider_model_id,
    sample_index: sample.sample_index,
    started_at: sample.started_at,
    completed_at: sample.completed_at,
    status_code: sample.status_code,
    outcome: sample.outcome,
    latency_ms: sample.latency_ms,
    ttft_ms: sample.ttft_ms,
    duration_ms: sample.duration_ms,
    input_tokens: sample.input_tokens,
    output_tokens: sample.output_tokens,
    total_tokens: sample.total_tokens,
    estimated_cost_micros: sample.estimated_cost_micros,
    is_warmup: sample.is_warmup === 1,
    score: {
      value: sample.score_value,
      scale: sample.score_scale,
      direction: sample.score_direction,
      source: sample.score_source,
      method: sample.score_method,
      scored_at: sample.scored_at,
      details: scoreDetails.value
    },
    parse_warnings: [...scoreDetails.warnings]
  };
}

export function toBenchmarkRunView(
  run: BenchmarkRunRecord,
  summary: BenchmarkRunSummary
): Record<string, unknown> & { summary: BenchmarkRunSummary } {
  const settings = parseJsonTextWithWarning(run.settings_json, "benchmark_runs.settings_json");
  return {
    run_id: run.id,
    name: run.name,
    created_at: run.created_at,
    created_by: run.created_by,
    objective: run.objective,
    notes: run.notes,
    status: run.status,
    settings: settings.value,
    parse_warnings: [...settings.warnings],
    summary
  };
}

export function toControlPlaneActionSummaryView(event: ControlPlaneActionEventRecord): Record<string, unknown> {
  return {
    ledger_event_id: event.id,
    created_at: event.created_at,
    finished_at: event.finished_at,
    created_by: event.created_by,
    source_surface: event.source_surface,
    actor_kind: event.actor_kind,
    actor_id: event.actor_id,
    session_id: event.session_id,
    operation: event.operation,
    status: event.status,
    target_kind: event.target_kind,
    target_id: event.target_id,
    optimization_run_id: event.optimization_run_id,
    mutation_event_id: event.mutation_event_id
  };
}

export function toControlPlaneActionDetailView(event: ControlPlaneActionEventRecord): Record<string, unknown> {
  const correlationIds = parseJsonObjectWithWarning(
    event.correlation_ids_json,
    "control_plane_action_events.correlation_ids_json"
  );
  const result = parseJsonObjectWithWarning(event.result_json, "control_plane_action_events.result_json");
  const error = parseJsonObjectWithWarning(event.error_json, "control_plane_action_events.error_json");
  const metadata = parseJsonObjectWithWarning(event.metadata_json, "control_plane_action_events.metadata_json");

  return {
    ...toControlPlaneActionSummaryView(event),
    correlation_ids: correlationIds.value,
    result: result.value,
    error: error.value,
    metadata: metadata.value,
    parse_warnings: [
      ...correlationIds.warnings,
      ...result.warnings,
      ...error.warnings,
      ...metadata.warnings
    ]
  };
}

export function summarizeBenchmarkSamplesByPath(samples: BenchmarkSampleRecord[]): BenchmarkPathSummaryView[] {
  const buckets = new Map<BenchmarkPath, BenchmarkSampleRecord[]>();

  for (const sample of samples) {
    const pathName = benchmarkPathFromSample(sample);
    const bucket = buckets.get(pathName) ?? [];
    bucket.push(sample);
    buckets.set(pathName, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pathName, bucket]) => {
      const ordered = [...bucket].sort((left, right) => left.sample_index - right.sample_index);
      const warmup = ordered.filter((sample) => sample.is_warmup === 1);
      const measured = ordered.filter((sample) => sample.is_warmup === 0);
      const averageOf = (values: Array<number | null>): number | null => {
        const present = values.filter((value): value is number => typeof value === "number");
        if (present.length === 0) {
          return null;
        }

        return present.reduce((sum, value) => sum + value, 0) / present.length;
      };
      const warmupLatencies = warmup
        .map((sample) => sample.latency_ms)
        .filter((value): value is number => typeof value === "number");
      const sortedWarmupLatencies = [...warmupLatencies].sort((left, right) => left - right);
      const medianOfSorted = (values: number[]): number | null => {
        if (values.length === 0) {
          return null;
        }

        const midpoint = Math.floor(values.length / 2);
        if (values.length % 2 === 1) {
          return values[midpoint] ?? null;
        }

        const lower = values[midpoint - 1] ?? 0;
        const upper = values[midpoint] ?? lower;
        return (lower + upper) / 2;
      };
      const measuredLatencies = measured
        .map((sample) => sample.latency_ms)
        .filter((value): value is number => typeof value === "number");
      const firstMeasuredLatency = measuredLatencies[0] ?? null;
      const subsequentMeasuredLatencies = measuredLatencies.slice(1).sort((left, right) => left - right);
      const subsequentMedianLatency = medianOfSorted(subsequentMeasuredLatencies);

      return {
        path: pathName,
        total_samples: ordered.length,
        measured_samples: measured.length,
        warmup_samples: warmup.length,
        success_count: measured.filter((sample) => sample.outcome === "succeeded").length,
        failed_count: measured.filter((sample) => sample.outcome !== "succeeded").length,
        average_latency_ms: averageOf(measured.map((sample) => sample.latency_ms)),
        average_ttft_ms: averageOf(measured.map((sample) => sample.ttft_ms)),
        average_duration_ms: averageOf(measured.map((sample) => sample.duration_ms)),
        warmup_latency_ms: warmupLatencies,
        warmup_median_latency_ms: medianOfSorted(sortedWarmupLatencies),
        warmup_max_latency_ms: sortedWarmupLatencies.length > 0 ? sortedWarmupLatencies[sortedWarmupLatencies.length - 1] ?? null : null,
        last_warmup_latency_ms: warmupLatencies.length > 0 ? warmupLatencies[warmupLatencies.length - 1] ?? null : null,
        first_measured_latency_ms: firstMeasuredLatency,
        first_measured_suspect:
          typeof firstMeasuredLatency === "number" &&
          typeof subsequentMedianLatency === "number" &&
          firstMeasuredLatency > subsequentMedianLatency * 2
      };
    });
}

export function benchmarkExecutionViewFromSettings(settings: unknown): BenchmarkExecutionView {
  const view = isRecord(settings) ? settings : {};

  return {
    requested_path_mode:
      typeof view["requested_path_mode"] === "string"
        ? view["requested_path_mode"]
        : typeof view["path_mode"] === "string"
          ? view["path_mode"]
          : null,
    effective_paths: Array.isArray(view["effective_paths"]) ? (view["effective_paths"] as BenchmarkPath[]) : null,
    skipped_paths: Array.isArray(view["skipped_paths"]) ? (view["skipped_paths"] as BenchmarkPath[]) : [],
    warnings: Array.isArray(view["warnings"]) ? (view["warnings"] as BenchmarkExecutionWarning[]) : []
  };
}

export function buildBenchmarkReportView(params: {
  store_path?: string;
  run: Record<string, unknown>;
  summary: BenchmarkRunSummary;
  rawSamples: BenchmarkSampleRecord[];
  samples?: Array<Record<string, unknown>>;
}): BenchmarkReportView {
  const samples = params.samples ?? params.rawSamples.map((sample) => toBenchmarkSampleView(sample));
  const report: BenchmarkReportView = {
    run: params.run,
    execution: benchmarkExecutionViewFromSettings((params.run as { settings?: unknown }).settings),
    summary: params.summary,
    analysis: {
      by_path: summarizeBenchmarkSamplesByPath(params.rawSamples)
    },
    samples
  };

  if (typeof params.store_path === "string") {
    report.store_path = params.store_path;
  }

  return report;
}
