export const OBSERVABILITY_SCHEMA_VERSION = 7;
const OBSERVABILITY_SEMANTIC_SPEC_VERSION = 1;

export const CREATE_STORE_METADATA_SQL = `
CREATE TABLE IF NOT EXISTS store_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const CREATE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  migration_name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

const CREATE_OBSERVATIONS_SQL = `
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  ingested_at TEXT,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  surface TEXT NOT NULL,
  kind TEXT NOT NULL,
  event TEXT NOT NULL,
  stage TEXT,
  severity TEXT,
  outcome TEXT,
  route_id TEXT,
  route_name TEXT,
  model_id TEXT,
  provider_id TEXT,
  provider_model_id TEXT,
  client_api_mode TEXT,
  upstream_api_mode TEXT,
  listener TEXT,
  actor TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  ttft_ms INTEGER,
  duration_ms INTEGER,
  request_bytes INTEGER,
  response_bytes INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_micros INTEGER,
  currency TEXT,
  billing_source TEXT,
  benchmark_run_id TEXT,
  benchmark_case_id TEXT,
  optimization_profile_id TEXT,
  tags_json TEXT,
  attributes_json TEXT,
  attributes_truncated INTEGER NOT NULL DEFAULT 0 CHECK (attributes_truncated IN (0, 1)),
  message TEXT,
  CHECK (status_code IS NULL OR status_code >= 0),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (ttft_ms IS NULL OR ttft_ms >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (request_bytes IS NULL OR request_bytes >= 0),
  CHECK (response_bytes IS NULL OR response_bytes >= 0),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0)
);
`;

const CREATE_REQUEST_EXECUTIONS_SQL = `
CREATE TABLE IF NOT EXISTS request_executions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  request_received_at TEXT NOT NULL,
  route_resolved_at TEXT,
  upstream_request_started_at TEXT,
  upstream_response_started_at TEXT,
  upstream_response_completed_at TEXT,
  client_response_started_at TEXT,
  client_response_completed_at TEXT,
  route_id TEXT,
  route_name TEXT,
  model_id TEXT,
  provider_id TEXT,
  provider_model_id TEXT,
  client_api_mode TEXT NOT NULL,
  upstream_api_mode TEXT,
  status_code INTEGER,
  outcome TEXT NOT NULL,
  failure_stage TEXT,
  failure_reason TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  ttft_ms INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_micros INTEGER,
  currency TEXT,
  switchmaxxer_pre_upstream_ms INTEGER,
  upstream_ttft_ms INTEGER,
  upstream_duration_ms INTEGER,
  switchmaxxer_post_upstream_ms INTEGER,
  client_write_ms INTEGER,
  gateway_residency_ms INTEGER,
  partial_output INTEGER NOT NULL DEFAULT 0 CHECK (partial_output IN (0, 1)),
  CHECK (status_code IS NULL OR status_code >= 0),
  CHECK (observation_count >= 0),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (ttft_ms IS NULL OR ttft_ms >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
  CHECK (switchmaxxer_pre_upstream_ms IS NULL OR switchmaxxer_pre_upstream_ms >= 0),
  CHECK (upstream_ttft_ms IS NULL OR upstream_ttft_ms >= 0),
  CHECK (upstream_duration_ms IS NULL OR upstream_duration_ms >= 0),
  CHECK (switchmaxxer_post_upstream_ms IS NULL OR switchmaxxer_post_upstream_ms >= 0),
  CHECK (client_write_ms IS NULL OR client_write_ms >= 0),
  CHECK (gateway_residency_ms IS NULL OR gateway_residency_ms >= 0)
);
`;

const CREATE_BENCHMARK_RUNS_SQL = `
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  objective TEXT NOT NULL,
  notes TEXT,
  settings_json TEXT NOT NULL,
  status TEXT NOT NULL
);
`;

const CREATE_BENCHMARK_SAMPLES_SQL = `
CREATE TABLE IF NOT EXISTS benchmark_samples (
  id TEXT PRIMARY KEY,
  benchmark_run_id TEXT NOT NULL,
  request_execution_id TEXT NOT NULL,
  route_id TEXT,
  provider_id TEXT,
  provider_model_id TEXT,
  sample_index INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status_code INTEGER,
  outcome TEXT NOT NULL,
  latency_ms INTEGER,
  ttft_ms INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_micros INTEGER,
  is_warmup INTEGER NOT NULL DEFAULT 0 CHECK (is_warmup IN (0, 1)),
  score_value REAL,
  score_scale TEXT,
  score_direction TEXT,
  score_source TEXT,
  score_method TEXT,
  scored_at TEXT,
  score_json TEXT,
  FOREIGN KEY (benchmark_run_id) REFERENCES benchmark_runs(id),
  FOREIGN KEY (request_execution_id) REFERENCES request_executions(id) ON DELETE CASCADE,
  CHECK (sample_index >= 0),
  CHECK (status_code IS NULL OR status_code >= 0),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (ttft_ms IS NULL OR ttft_ms >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0)
);
`;

export const CREATE_OPTIMIZATION_RUNS_SQL = `
CREATE TABLE IF NOT EXISTS optimization_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  created_by TEXT NOT NULL,
  target_model TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  winner_route TEXT,
  benchmark_run_id TEXT,
  settings_json TEXT NOT NULL,
  candidate_snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL
);
`;

export const CREATE_CONFIG_SNAPSHOTS_SQL = `
CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_bytes INTEGER NOT NULL,
  retention_expires_at TEXT,
  CHECK (content_bytes >= 0)
);
`;

export const CREATE_CONFIG_MUTATION_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS config_mutation_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  optimization_run_id TEXT,
  snapshot_id TEXT,
  parent_event_id TEXT,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  CHECK (source_surface IN ('cli', 'mcp')),
  CHECK (operation IN ('optimize_apply', 'optimize_restore', 'manual_config_edit')),
  CHECK (status IN ('succeeded')),
  CHECK (target_kind IN ('route')),
  FOREIGN KEY (optimization_run_id) REFERENCES optimization_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (snapshot_id) REFERENCES config_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_event_id) REFERENCES config_mutation_events(id) ON DELETE SET NULL
);
`;

export const CREATE_CONTROL_PLANE_ACTION_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS control_plane_action_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  created_by TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  session_id TEXT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  optimization_run_id TEXT,
  mutation_event_id TEXT,
  correlation_ids_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  error_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  CHECK (source_surface IN ('cli', 'mcp')),
  CHECK (actor_kind IN ('operator', 'agent', 'system', 'unknown')),
  CHECK (operation IN (
    'optimize_apply',
    'optimize_restore',
    'models_create',
    'models_update',
    'models_delete',
    'providers_create',
    'providers_update',
    'providers_delete',
    'providers_set_key',
    'providers_clear_key',
    'providers_set_key_env',
    'routes_create',
    'routes_update',
    'routes_delete'
  )),
  CHECK (status IN ('started', 'succeeded', 'failed', 'noop', 'dry_run_succeeded', 'dry_run_failed')),
  CHECK (target_kind IN ('model', 'provider', 'route')),
  FOREIGN KEY (mutation_event_id) REFERENCES config_mutation_events(id) ON DELETE SET NULL
);
`;

const CREATE_COST_FACTS_SQL = `
CREATE TABLE IF NOT EXISTS cost_facts (
  id TEXT PRIMARY KEY,
  request_execution_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  provider_id TEXT,
  provider_model_id TEXT,
  route_id TEXT,
  currency TEXT NOT NULL,
  estimated_cost_micros INTEGER NOT NULL,
  billable_input_tokens INTEGER,
  billable_output_tokens INTEGER,
  billable_total_tokens INTEGER,
  billing_dimensions_json TEXT,
  supersedes_cost_fact_id TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  cost_fact_version INTEGER,
  cost_fact_kind TEXT NOT NULL,
  FOREIGN KEY (request_execution_id) REFERENCES request_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_cost_fact_id) REFERENCES cost_facts(id),
  CHECK (estimated_cost_micros >= 0),
  CHECK (billable_input_tokens IS NULL OR billable_input_tokens >= 0),
  CHECK (billable_output_tokens IS NULL OR billable_output_tokens >= 0),
  CHECK (billable_total_tokens IS NULL OR billable_total_tokens >= 0),
  CHECK (cost_fact_version IS NULL OR cost_fact_version >= 1)
);
`;

const CREATE_OPTIMIZATION_FACTS_SQL = `
CREATE TABLE IF NOT EXISTS optimization_facts (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  route_id TEXT,
  provider_id TEXT,
  provider_model_id TEXT,
  optimization_profile_id TEXT,
  request_execution_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  latency_ms INTEGER,
  duration_ms INTEGER,
  total_tokens INTEGER,
  estimated_cost_micros INTEGER,
  quality_signal_json TEXT,
  fitness_inputs_json TEXT,
  FOREIGN KEY (request_execution_id) REFERENCES request_executions(id) ON DELETE CASCADE,
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0)
);
`;

const OBSERVABILITY_INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_observations_observed_at ON observations(observed_at);`,
  `CREATE INDEX IF NOT EXISTS idx_observations_request_id_observed_at ON observations(request_id, observed_at);`,
  `CREATE INDEX IF NOT EXISTS idx_observations_kind_event_observed_at ON observations(kind, event, observed_at);`,
  `CREATE INDEX IF NOT EXISTS idx_request_executions_route_id_started_at ON request_executions(route_id, started_at);`,
  `CREATE INDEX IF NOT EXISTS idx_request_executions_provider_id_started_at ON request_executions(provider_id, started_at);`,
  `CREATE INDEX IF NOT EXISTS idx_request_executions_outcome_started_at ON request_executions(outcome, started_at);`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_samples_run_id ON benchmark_samples(benchmark_run_id);`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_samples_run_sample_index ON benchmark_samples(benchmark_run_id, sample_index);`,
  `CREATE INDEX IF NOT EXISTS idx_optimization_runs_created_at ON optimization_runs(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_optimization_runs_benchmark_run_id ON optimization_runs(benchmark_run_id);`,
  `CREATE INDEX IF NOT EXISTS idx_config_snapshots_created_at ON config_snapshots(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_config_snapshots_retention_expires_at ON config_snapshots(retention_expires_at);`,
  `CREATE INDEX IF NOT EXISTS idx_config_mutation_events_created_at ON config_mutation_events(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_config_mutation_events_operation_target ON config_mutation_events(operation, target_kind, target_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_config_mutation_events_optimization_run_id ON config_mutation_events(optimization_run_id);`,
  `CREATE INDEX IF NOT EXISTS idx_config_mutation_events_parent_event_id ON config_mutation_events(parent_event_id);`,
  `CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_created_at ON control_plane_action_events(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_operation_target ON control_plane_action_events(operation, target_kind, target_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_optimization_run_id ON control_plane_action_events(optimization_run_id);`,
  `CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_mutation_event_id ON control_plane_action_events(mutation_event_id);`,
  `CREATE INDEX IF NOT EXISTS idx_cost_facts_provider_id_observed_at ON cost_facts(provider_id, observed_at);`,
  `CREATE INDEX IF NOT EXISTS idx_optimization_facts_route_id_observed_at ON optimization_facts(route_id, observed_at);`
] as const;

export const OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS = [
  { name: "store_metadata", createSql: CREATE_STORE_METADATA_SQL },
  { name: "schema_migrations", createSql: CREATE_SCHEMA_MIGRATIONS_SQL },
  { name: "observations", createSql: CREATE_OBSERVATIONS_SQL },
  { name: "request_executions", createSql: CREATE_REQUEST_EXECUTIONS_SQL },
  { name: "benchmark_runs", createSql: CREATE_BENCHMARK_RUNS_SQL },
  { name: "benchmark_samples", createSql: CREATE_BENCHMARK_SAMPLES_SQL },
  { name: "optimization_runs", createSql: CREATE_OPTIMIZATION_RUNS_SQL },
  { name: "config_snapshots", createSql: CREATE_CONFIG_SNAPSHOTS_SQL },
  { name: "config_mutation_events", createSql: CREATE_CONFIG_MUTATION_EVENTS_SQL },
  { name: "control_plane_action_events", createSql: CREATE_CONTROL_PLANE_ACTION_EVENTS_SQL },
  { name: "cost_facts", createSql: CREATE_COST_FACTS_SQL },
  { name: "optimization_facts", createSql: CREATE_OPTIMIZATION_FACTS_SQL }
] as const;

export type ObservabilitySchemaTableName = (typeof OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS)[number]["name"];

export const OBSERVABILITY_SCHEMA_TABLE_NAMES = Object.freeze(
  OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS.map((definition) => definition.name)
) as readonly ObservabilitySchemaTableName[];

export const OBSERVABILITY_SCHEMA_STATEMENTS = [
  ...OBSERVABILITY_SCHEMA_TABLE_DEFINITIONS.map((definition) => definition.createSql),
  ...OBSERVABILITY_INDEX_SQL
] as const;

export interface SchemaMetadataRow {
  key: string;
  value: string;
  updated_at: string;
}

export function initialObservabilityMetadata(nowIso: string): SchemaMetadataRow[] {
  return [
    {
      key: "schema_version",
      value: String(OBSERVABILITY_SCHEMA_VERSION),
      updated_at: nowIso
    },
    {
      key: "semantic_spec_version",
      value: String(OBSERVABILITY_SEMANTIC_SPEC_VERSION),
      updated_at: nowIso
    },
    {
      key: "engine_name",
      value: "observability_store",
      updated_at: nowIso
    }
  ];
}
