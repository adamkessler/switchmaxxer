import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { logWarning } from "../../../../platform/logger";
import {
  CREATE_SCHEMA_MIGRATIONS_SQL,
  CREATE_STORE_METADATA_SQL,
  OBSERVABILITY_SCHEMA_STATEMENTS,
  OBSERVABILITY_SCHEMA_TABLE_NAMES,
  OBSERVABILITY_SCHEMA_VERSION,
  CREATE_CONTROL_PLANE_ACTION_EVENTS_SQL,
  CREATE_CONFIG_MUTATION_EVENTS_SQL,
  CREATE_CONFIG_SNAPSHOTS_SQL,
  CREATE_OPTIMIZE_MUTATION_IDEMPOTENCY_SQL,
  CREATE_OPTIMIZATION_RUNS_SQL,
  initialObservabilityMetadata,
  type ObservabilitySchemaTableName
} from "./schema";
import { resolveObservabilityBusyTimeoutMs, resolveObservabilityWalAutocheckpointPages } from "./sqlite-busy";
import { assertSafeExistingObservabilityDbFile, assertSafeObservabilityDbParent } from "./store-path-security";

const INITIAL_MIGRATION_ID = "0001_observability_store_v1";
const OBSERVATION_ATTRIBUTES_TRUNCATED_SCHEMA_VERSION = 3;
const OBSERVATION_ATTRIBUTES_TRUNCATED_MIGRATION_ID = "0003_observations_attributes_truncated_v3";
const OPTIMIZATION_RUNS_SCHEMA_VERSION = 4;
const OPTIMIZATION_RUNS_MIGRATION_ID = "0004_optimization_runs_v4";
const CONFIG_MUTATION_EVENTS_SCHEMA_VERSION = 5;
const CONFIG_MUTATION_EVENTS_MIGRATION_ID = "0005_config_mutation_events_v5";
const CONTROL_PLANE_ACTION_EVENTS_SCHEMA_VERSION = 6;
const CONTROL_PLANE_ACTION_EVENTS_MIGRATION_ID = "0006_control_plane_action_events_v6";
const CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_SCHEMA_VERSION = 7;
const CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_MIGRATION_ID = "0007_control_plane_action_events_mutation_audit_v7";
const OPTIMIZE_MUTATION_IDEMPOTENCY_SCHEMA_VERSION = 8;
const OPTIMIZE_MUTATION_IDEMPOTENCY_MIGRATION_ID = "0008_optimize_mutation_idempotency_v8";

export interface ObservabilityStore {
  db: DatabaseSync;
  dbPath: string;
  schemaVersion: number;
}

export interface BootstrapObservabilityStoreOptions {
  dbPath: string;
  cwd?: string;
}

function ensureParentDirectory(filePath: string): void {
  const parentDir = path.dirname(filePath);

  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  try {
    chmodSync(parentDir, 0o700);
  } catch {
    // Best effort only; some filesystems may not honor POSIX chmod semantics.
  }
}

function tightenObservabilityStorePermissions(dbPath: string): void {
  for (const candidatePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      chmodSync(candidatePath, 0o600);
    } catch {
      // Best effort only; some filesystems may not honor POSIX chmod semantics.
    }
  }
}

function ensureSecureObservabilityStoreFile(dbPath: string): void {
  if (existsSync(dbPath)) {
    assertSafeExistingObservabilityDbFile(dbPath);
    return;
  }

  try {
    const fd = openSync(dbPath, "wx", 0o600);
    closeSync(fd);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "EEXIST") {
      assertSafeExistingObservabilityDbFile(dbPath);
      return;
    }
    throw error;
  }

  assertSafeExistingObservabilityDbFile(dbPath);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;

  return typeof row?.name === "string";
}

export function assertAllowedObservabilitySchemaTableName(tableName: string): asserts tableName is ObservabilitySchemaTableName {
  if ((OBSERVABILITY_SCHEMA_TABLE_NAMES as readonly string[]).includes(tableName)) {
    return;
  }

  throw new Error(`Unknown table: ${tableName}`);
}

function columnExists(db: DatabaseSync, tableName: string, columnName: string): boolean {
  // SQLite PRAGMA identifiers cannot be parameterized, so keep this helper
  // restricted to a closed set of schema-owned table names.
  assertAllowedObservabilitySchemaTableName(tableName);
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function metadataValue(db: DatabaseSync, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM store_metadata WHERE key = ?")
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : null;
}

function setMetadata(db: DatabaseSync, key: string, value: string, updatedAt: string): void {
  db.prepare(
    `
      INSERT INTO store_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  ).run(key, value, updatedAt);
}

function migrationApplied(db: DatabaseSync, id: string): boolean {
  const row = db
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get(id) as { id?: string } | undefined;

  return typeof row?.id === "string";
}

function applyInitialSchema(db: DatabaseSync, nowIso: string): void {
  db.exec(CREATE_STORE_METADATA_SQL);
  db.exec(CREATE_SCHEMA_MIGRATIONS_SQL);

  if (!migrationApplied(db, INITIAL_MIGRATION_ID)) {
    db.exec("BEGIN");

    try {
      for (const statement of OBSERVABILITY_SCHEMA_STATEMENTS) {
        db.exec(statement);
      }

      for (const row of initialObservabilityMetadata(nowIso)) {
        setMetadata(db, row.key, row.value, row.updated_at);
      }

      db.prepare(
        `
          INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
          VALUES (?, ?, ?, ?)
        `
      ).run(
        INITIAL_MIGRATION_ID,
        OBSERVABILITY_SCHEMA_VERSION,
        "observability_store_v1",
        nowIso
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function assertSchemaMetadata(db: DatabaseSync, nowIso: string): void {
  const schemaVersion = metadataValue(db, "schema_version");

  if (schemaVersion === null) {
    setMetadata(db, "schema_version", String(CONFIG_MUTATION_EVENTS_SCHEMA_VERSION), nowIso);
  }

  const semanticSpecVersion = metadataValue(db, "semantic_spec_version");

  if (semanticSpecVersion === null) {
    setMetadata(db, "semantic_spec_version", "1", nowIso);
  }

  const engineName = metadataValue(db, "engine_name");

  if (engineName === null) {
    setMetadata(db, "engine_name", "observability_store", nowIso);
  }
}

function applyObservabilitySchemaV3Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, OBSERVATION_ATTRIBUTES_TRUNCATED_MIGRATION_ID)) {
    return;
  }

  if (!tableExists(db, "observations")) {
    return;
  }

  db.exec("BEGIN");

  try {
    if (!columnExists(db, "observations", "attributes_truncated")) {
      db.exec(
        "ALTER TABLE observations ADD COLUMN attributes_truncated INTEGER NOT NULL DEFAULT 0 CHECK (attributes_truncated IN (0, 1))"
      );
    }

    setMetadata(db, "schema_version", "3", nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      OBSERVATION_ATTRIBUTES_TRUNCATED_MIGRATION_ID,
      OBSERVATION_ATTRIBUTES_TRUNCATED_SCHEMA_VERSION,
      "observations_attributes_truncated_v3",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyOptimizationRunsV4Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, OPTIMIZATION_RUNS_MIGRATION_ID)) {
    return;
  }

  db.exec("BEGIN");

  try {
    db.exec(CREATE_OPTIMIZATION_RUNS_SQL);
    db.exec("CREATE INDEX IF NOT EXISTS idx_optimization_runs_created_at ON optimization_runs(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_optimization_runs_benchmark_run_id ON optimization_runs(benchmark_run_id)");

    setMetadata(db, "schema_version", String(OPTIMIZATION_RUNS_SCHEMA_VERSION), nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      OPTIMIZATION_RUNS_MIGRATION_ID,
      OPTIMIZATION_RUNS_SCHEMA_VERSION,
      "optimization_runs_v4",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyConfigMutationEventsV5Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, CONFIG_MUTATION_EVENTS_MIGRATION_ID)) {
    return;
  }

  db.exec("BEGIN");

  try {
    db.exec(CREATE_CONFIG_SNAPSHOTS_SQL);
    db.exec(CREATE_CONFIG_MUTATION_EVENTS_SQL);
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_snapshots_created_at ON config_snapshots(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_snapshots_retention_expires_at ON config_snapshots(retention_expires_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_mutation_events_created_at ON config_mutation_events(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_mutation_events_operation_target ON config_mutation_events(operation, target_kind, target_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_mutation_events_optimization_run_id ON config_mutation_events(optimization_run_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_config_mutation_events_parent_event_id ON config_mutation_events(parent_event_id)");

    setMetadata(db, "schema_version", String(CONFIG_MUTATION_EVENTS_SCHEMA_VERSION), nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      CONFIG_MUTATION_EVENTS_MIGRATION_ID,
      CONFIG_MUTATION_EVENTS_SCHEMA_VERSION,
      "config_mutation_events_v5",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyControlPlaneActionEventsV6Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, CONTROL_PLANE_ACTION_EVENTS_MIGRATION_ID)) {
    return;
  }

  db.exec("BEGIN");

  try {
    db.exec(CREATE_CONTROL_PLANE_ACTION_EVENTS_SQL);
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_created_at ON control_plane_action_events(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_operation_target ON control_plane_action_events(operation, target_kind, target_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_optimization_run_id ON control_plane_action_events(optimization_run_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_mutation_event_id ON control_plane_action_events(mutation_event_id)");

    setMetadata(db, "schema_version", String(CONTROL_PLANE_ACTION_EVENTS_SCHEMA_VERSION), nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      CONTROL_PLANE_ACTION_EVENTS_MIGRATION_ID,
      CONTROL_PLANE_ACTION_EVENTS_SCHEMA_VERSION,
      "control_plane_action_events_v6",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyControlPlaneActionEventsMutationAuditV7Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_MIGRATION_ID)) {
    return;
  }

  if (!tableExists(db, "control_plane_action_events")) {
    applyControlPlaneActionEventsV6Migration(db, nowIso);
  }

  db.exec("BEGIN");

  try {
    db.exec("ALTER TABLE control_plane_action_events RENAME TO control_plane_action_events_v6");
    db.exec(CREATE_CONTROL_PLANE_ACTION_EVENTS_SQL);
    db.exec(`
      INSERT INTO control_plane_action_events (
        id,
        created_at,
        finished_at,
        created_by,
        source_surface,
        actor_kind,
        actor_id,
        session_id,
        operation,
        status,
        target_kind,
        target_id,
        optimization_run_id,
        mutation_event_id,
        correlation_ids_json,
        result_json,
        error_json,
        metadata_json
      )
      SELECT
        id,
        created_at,
        finished_at,
        created_by,
        source_surface,
        actor_kind,
        actor_id,
        session_id,
        operation,
        status,
        target_kind,
        target_id,
        optimization_run_id,
        mutation_event_id,
        correlation_ids_json,
        result_json,
        error_json,
        metadata_json
      FROM control_plane_action_events_v6
    `);
    db.exec("DROP TABLE control_plane_action_events_v6");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_created_at ON control_plane_action_events(created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_operation_target ON control_plane_action_events(operation, target_kind, target_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_optimization_run_id ON control_plane_action_events(optimization_run_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_control_plane_action_events_mutation_event_id ON control_plane_action_events(mutation_event_id)");

    setMetadata(db, "schema_version", String(CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_SCHEMA_VERSION), nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_MIGRATION_ID,
      CONTROL_PLANE_ACTION_EVENTS_MUTATION_AUDIT_SCHEMA_VERSION,
      "control_plane_action_events_mutation_audit_v7",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyOptimizeMutationIdempotencyV8Migration(db: DatabaseSync, nowIso: string): void {
  if (migrationApplied(db, OPTIMIZE_MUTATION_IDEMPOTENCY_MIGRATION_ID)) {
    return;
  }

  if (!tableExists(db, "control_plane_action_events")) {
    applyControlPlaneActionEventsV6Migration(db, nowIso);
  }

  db.exec("BEGIN");

  try {
    db.exec(CREATE_OPTIMIZE_MUTATION_IDEMPOTENCY_SQL);
    db.exec("CREATE INDEX IF NOT EXISTS idx_optimize_mutation_idempotency_action_id ON optimize_mutation_idempotency(control_plane_action_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_optimize_mutation_idempotency_status_updated ON optimize_mutation_idempotency(status, updated_at)");

    setMetadata(db, "schema_version", String(OPTIMIZE_MUTATION_IDEMPOTENCY_SCHEMA_VERSION), nowIso);
    db.prepare(
      `
        INSERT INTO schema_migrations (id, schema_version, migration_name, applied_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(
      OPTIMIZE_MUTATION_IDEMPOTENCY_MIGRATION_ID,
      OPTIMIZE_MUTATION_IDEMPOTENCY_SCHEMA_VERSION,
      "optimize_mutation_idempotency_v8",
      nowIso
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function shouldWarnAboutSuspiciousDbPath(rawDbPath: string, resolvedDbPath: string, cwd: string): boolean {
  if (existsSync(resolvedDbPath)) {
    return false;
  }

  const relativeToCwd = path.relative(cwd, resolvedDbPath);
  if (relativeToCwd.startsWith("..") || path.isAbsolute(relativeToCwd)) {
    return false;
  }

  if (path.dirname(relativeToCwd) !== ".") {
    return false;
  }

  const fileName = path.basename(resolvedDbPath);
  if (fileName.startsWith(".")) {
    return false;
  }

  return path.extname(fileName) === "";
}

export class ObservabilitySchemaVersionMismatchError extends Error {
  readonly dbPath: string;
  readonly actualVersion: number;
  readonly expectedVersion: number;

  constructor(dbPath: string, actualVersion: number, expectedVersion: number) {
    super(
      `Observability store schema version ${actualVersion} is incompatible with expected schema version ${expectedVersion}; refusing to open '${dbPath}' without an explicit migration or reset.`
    );
    this.name = "ObservabilitySchemaVersionMismatchError";
    this.dbPath = dbPath;
    this.actualVersion = actualVersion;
    this.expectedVersion = expectedVersion;
  }
}

export function bootstrapObservabilityStore(
  options: BootstrapObservabilityStoreOptions
): ObservabilityStore {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const dbPath = path.resolve(cwd, options.dbPath);
  const nowIso = new Date().toISOString();

  if (shouldWarnAboutSuspiciousDbPath(options.dbPath, dbPath, cwd)) {
    logWarning(
      `Observability DB path '${options.dbPath}' resolves to '${dbPath}' and will create a new file in the working directory. ` +
        `If that was not intentional, unset SWITCHMAXXER_OBSERVABILITY_DB or point it to '.switchmaxxer/observability.sqlite'.`
    );
  }

  assertSafeObservabilityDbParent(dbPath);
  ensureParentDirectory(dbPath);
  assertSafeObservabilityDbParent(dbPath);
  ensureSecureObservabilityStoreFile(dbPath);
  assertSafeExistingObservabilityDbFile(dbPath);
  let db = new DatabaseSync(dbPath);
  tightenObservabilityStorePermissions(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA wal_autocheckpoint = ${resolveObservabilityWalAutocheckpointPages()}`);
  db.exec(`PRAGMA busy_timeout = ${resolveObservabilityBusyTimeoutMs()}`);
  tightenObservabilityStorePermissions(dbPath);

  const hasSchemaTables = tableExists(db, "store_metadata") && tableExists(db, "schema_migrations");
  let existingSchemaVersion = hasSchemaTables
    ? Number(metadataValue(db, "schema_version") ?? 1)
    : OBSERVABILITY_SCHEMA_VERSION;

  if (hasSchemaTables && existingSchemaVersion === 2) {
    applyObservabilitySchemaV3Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? 3);
  }

  if (hasSchemaTables && existingSchemaVersion === 3) {
    applyOptimizationRunsV4Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);
  }

  if (hasSchemaTables && existingSchemaVersion === 4) {
    applyConfigMutationEventsV5Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);
  }

  if (hasSchemaTables && existingSchemaVersion === 5) {
    applyControlPlaneActionEventsV6Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);
  }

  if (hasSchemaTables && existingSchemaVersion === 6) {
    applyControlPlaneActionEventsMutationAuditV7Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);
  }

  if (hasSchemaTables && existingSchemaVersion === 7) {
    applyOptimizeMutationIdempotencyV8Migration(db, nowIso);
    existingSchemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);
  }

  if (hasSchemaTables && existingSchemaVersion !== OBSERVABILITY_SCHEMA_VERSION) {
    db.close();
    throw new ObservabilitySchemaVersionMismatchError(
      dbPath,
      existingSchemaVersion,
      OBSERVABILITY_SCHEMA_VERSION
    );
  }

  if (!tableExists(db, "store_metadata") || !tableExists(db, "schema_migrations")) {
    applyInitialSchema(db, nowIso);
  } else {
    applyInitialSchema(db, nowIso);
    assertSchemaMetadata(db, nowIso);
  }

  tightenObservabilityStorePermissions(dbPath);

  const schemaVersion = Number(metadataValue(db, "schema_version") ?? OBSERVABILITY_SCHEMA_VERSION);

  return {
    db,
    dbPath,
    schemaVersion
  };
}

export function closeObservabilityStore(store: ObservabilityStore): void {
  store.db.close();
}
