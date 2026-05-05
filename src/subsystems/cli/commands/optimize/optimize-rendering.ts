import { formatColumnAlignedTable } from "../../table-format";
import type { OptimizeHistoryDeleteResult } from "../../../observability/service";
import type { OptimizationRunView } from "../../../observability/optimizations";
import type { OptimizeReportView } from "../../../observability/optimize-report-builder";
import type {
  OptimizeApplyView,
  OptimizeRestoreView
} from "../../../observability/optimize-ledger-views";
import type { SerializedCostConfig } from "../../../config/model-input-contract";

function formatOptimizeCost(cost: SerializedCostConfig | null): string {
  if (cost === null) {
    return "(none)";
  }
  return `input=${cost.input} output=${cost.output} cache_read=${cost.cache_read} cache_write=${cost.cache_write}`;
}

function formatUsdEstimate(value: number | null): string {
  if (value === null) {
    return "(none)";
  }

  if (value === 0) {
    return "0";
  }

  const fixed = value < 0.01 ? value.toFixed(8) : value.toFixed(6);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function formatLatencyMs(value: number | null): string {
  if (value === null) {
    return "(none)";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function renderOptimizeReportText(report: OptimizeReportView): string {
  const rankingTable =
    report.run.objective === "latency"
      ? formatColumnAlignedTable(report.ranking, [
          { header: "RANK", value: (entry) => entry.rank ?? "-" },
          { header: "ROUTE", value: (entry) => entry.route_id },
          { header: "SCORE_MS", value: (entry) => formatLatencyMs(entry.score) },
          {
            header: "SAMPLES",
            value: (entry) =>
              `${entry.details.successful_measured_sample_count ?? 0}/${entry.details.measured_sample_count ?? 0}`
          },
          { header: "FAILED", value: (entry) => entry.details.failed_measured_sample_count ?? 0 },
          { header: "STATUS", value: (entry) => entry.disqualified?.reason ?? "ranked" }
        ])
      : formatColumnAlignedTable(report.ranking, [
          { header: "RANK", value: (entry) => entry.rank ?? "-" },
          { header: "ROUTE", value: (entry) => entry.route_id },
          { header: "SCORE_USD", value: (entry) => formatUsdEstimate(entry.score) },
          { header: "COST_SOURCE", value: (entry) => entry.details.cost_source ?? "-" },
          { header: "STATUS", value: (entry) => entry.disqualified?.reason ?? "ranked" }
        ]);
  const winnerScore =
    report.run.objective === "latency"
      ? `${formatLatencyMs(report.winner.score)} ms`
      : `${formatUsdEstimate(report.winner.score)} USD`;
  const objectiveLines =
    report.run.objective === "latency"
      ? [
          `Benchmark Run: ${report.bench?.run_id ?? "(none)"}`,
          `Benchmark Samples: measured=${report.bench?.summary.measured_samples ?? 0} failed=${report.bench?.summary.failed_count ?? 0}`
        ]
      : [
          `Reference Tokens: input=${report.reference_tokens.input_tokens} output=${report.reference_tokens.output_tokens} cacheRead=${report.reference_tokens.cache_read_tokens} cacheWrite=${report.reference_tokens.cache_write_tokens}`
        ];

  return [
    `Optimize: ${report.run.target_model}`,
    `Run ID: ${report.run.run_id ?? "(not persisted)"}`,
    `Objective: ${report.run.objective}`,
    `Store: ${report.store_path ?? "(not persisted)"}`,
    ...objectiveLines,
    `Winner: ${report.winner.route_id} (${winnerScore})`,
    "",
    rankingTable
  ].join("\n");
}

export function renderOptimizeListText(options: { storePath: string; runs: OptimizationRunView[] }): string {
  const lines = [`Optimization runs (${options.runs.length})`, `Store: ${options.storePath}`];

  if (options.runs.length === 0) {
    return `${lines.join("\n")}\n\nNo optimization runs yet.\n`;
  }

  const table = formatColumnAlignedTable(options.runs, [
    { header: "RUN_ID", value: (run) => run.run_id },
    { header: "CREATED_AT", value: (run) => run.created_at },
    { header: "STATUS", value: (run) => run.status },
    { header: "MODEL", value: (run) => run.target_model },
    { header: "OBJECTIVE", value: (run) => run.objective },
    { header: "WINNER", value: (run) => run.winner_route ?? "-" }
  ]);

  return `${lines.join("\n")}\n\n${table}\n`;
}

export function renderOptimizeApplyText(view: OptimizeApplyView): string {
  const status = view.dry_run
    ? "dry-run; no files changed"
    : view.changed
      ? "applied"
      : "no change needed";
  const lines = [
    `Optimize Apply: ${view.run_id}`,
    `Status: ${status}`,
    `Target Route: ${view.target_route}`,
    `Winner Route: ${view.winner_route}`,
    `Objective: ${view.objective}`,
    `Target Model: ${view.target_model}`,
    `Mutation: service_provider ${view.mutation.service_provider.from} -> ${view.mutation.service_provider.to}`,
    `Provider Model ID: ${view.mutation.provider_model_id.from} -> ${view.mutation.provider_model_id.to}`,
    `Cost: ${formatOptimizeCost(view.mutation.cost.from)} -> ${formatOptimizeCost(view.mutation.cost.to)}`,
    `API Mode: ${view.before.api_mode || "(unknown)"} -> ${view.after.api_mode || "(unknown)"}`,
    `Provider Endpoint: ${view.before.provider_endpoint ?? "(unknown)"} -> ${view.after.provider_endpoint ?? "(unknown)"}`
  ];

  if (view.action_id) {
    lines.push(`Action ID: ${view.action_id}`);
  }

  if (view.snapshot) {
    lines.push(`Snapshot: ${view.snapshot.snapshot_id}`);
  }

  if (view.reload) {
    lines.push(
      `Reload: ${view.reload.status}${typeof view.reload.exit_code === "number" ? ` (exit ${view.reload.exit_code})` : ""}`
    );
    if (view.reload.message) {
      lines.push(`Reload Message: ${view.reload.message}`);
    }
  }

  if (view.verification) {
    lines.push(
      `Verification: ${view.verification.status}${typeof view.verification.exit_code === "number" ? ` (exit ${view.verification.exit_code})` : ""}`
    );
    if (view.verification.message) {
      lines.push(`Verification Message: ${view.verification.message}`);
    }
  }

  for (const warning of view.warnings) {
    lines.push(`Warning: ${warning}`);
  }

  return lines.join("\n");
}

export function renderOptimizeRestoreText(view: OptimizeRestoreView): string {
  const status = view.dry_run
    ? "dry-run; no files changed"
    : view.changed
      ? "restored"
      : "no change needed";
  const lines = [
    `Optimize Restore: ${view.run_id}`,
    `Status: ${status}`,
    `Target Route: ${view.target_route}`,
    `Restore Point: ${view.restore_point.action_id}`,
    `Mutation: service_provider ${view.mutation.service_provider.from} -> ${view.mutation.service_provider.to}`,
    `Provider Model ID: ${view.mutation.provider_model_id.from} -> ${view.mutation.provider_model_id.to}`,
    `Cost: ${formatOptimizeCost(view.mutation.cost.from)} -> ${formatOptimizeCost(view.mutation.cost.to)}`,
    `API Mode: ${view.before.api_mode || "(unknown)"} -> ${view.after.api_mode || "(unknown)"}`,
    `Provider Endpoint: ${view.before.provider_endpoint ?? "(unknown)"} -> ${view.after.provider_endpoint ?? "(unknown)"}`
  ];

  if (view.action_id) {
    lines.push(`Action ID: ${view.action_id}`);
  }

  if (view.snapshot) {
    lines.push(`Snapshot: ${view.snapshot.snapshot_id}`);
  }

  if (view.reload) {
    lines.push(
      `Reload: ${view.reload.status}${typeof view.reload.exit_code === "number" ? ` (exit ${view.reload.exit_code})` : ""}`
    );
    if (view.reload.message) {
      lines.push(`Reload Message: ${view.reload.message}`);
    }
  }

  if (view.verification) {
    lines.push(
      `Verification: ${view.verification.status}${typeof view.verification.exit_code === "number" ? ` (exit ${view.verification.exit_code})` : ""}`
    );
    if (view.verification.message) {
      lines.push(`Verification Message: ${view.verification.message}`);
    }
  }

  for (const warning of view.warnings) {
    lines.push(`Warning: ${warning}`);
  }

  return lines.join("\n");
}

export function renderOptimizeHistoryDeleteText(options: {
  title: string;
  storePath: string;
  scope: string;
  olderThan?: string;
  cutoffAt?: string;
  result: OptimizeHistoryDeleteResult;
  warning?: string;
}): string {
  const lines = [
    options.title,
    `Store: ${options.storePath}`,
    `Scope: ${options.scope}`
  ];

  if (typeof options.olderThan === "string") {
    lines.push(`Older Than: ${options.olderThan}`);
  }

  if (typeof options.cutoffAt === "string") {
    lines.push(`Cutoff: ${options.cutoffAt}`);
  }

  if (typeof options.warning === "string" && options.warning.length > 0) {
    lines.push(`Warning: ${options.warning}`);
  }

  lines.push(
    "",
    `Optimization Runs Deleted: ${options.result.optimization_runs_deleted}`,
    `Config Mutation Events Deleted: ${options.result.config_mutation_events_deleted}`,
    `Config Snapshots Deleted: ${options.result.config_snapshots_deleted}`,
    `Total Deleted: ${options.result.total_deleted}`
  );

  return lines.join("\n");
}
