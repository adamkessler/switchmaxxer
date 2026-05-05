import type { DatabaseSync } from "node:sqlite";

export type SqlParameter = string | number | bigint | Uint8Array | null;

export function buildInClausePlaceholders(count: number): string {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Cannot build an IN clause with zero placeholders");
  }

  return `(${Array.from({ length: count }, () => "?").join(", ")})`;
}

export function databaseChanges(result: unknown): number {
  if (typeof result !== "object" || result === null) {
    return 0;
  }

  const candidate = result as { changes?: unknown };
  return typeof candidate.changes === "number" ? candidate.changes : 0;
}

export function runImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countRows(db: DatabaseSync, sql: string, ...parameters: SqlParameter[]): number {
  const row = db.prepare(sql).get(...parameters) as { count?: unknown } | undefined;
  return typeof row?.count === "number" ? row.count : 0;
}

export function listRowIds(db: DatabaseSync, sql: string, ...parameters: SqlParameter[]): string[] {
  const rows = db.prepare(sql).all(...parameters) as Array<{ id?: unknown }>;
  return rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
}

export function deleteRows(db: DatabaseSync, sql: string, ...parameters: SqlParameter[]): number {
  return databaseChanges(db.prepare(sql).run(...parameters));
}

export function deleteRowsBySelectedIds(
  db: DatabaseSync,
  selectIdsSql: string,
  deleteTable: string,
  deleteColumn: string,
  parameters: SqlParameter[],
  batchSize: number
): number {
  let deleted = 0;

  for (;;) {
    const ids = listRowIds(db, selectIdsSql, ...parameters, batchSize);

    if (ids.length === 0) {
      break;
    }

    deleted += deleteRows(
      db,
      `DELETE FROM ${deleteTable} WHERE ${deleteColumn} IN ${buildInClausePlaceholders(ids.length)}`,
      ...ids
    );

    if (ids.length < batchSize) {
      break;
    }
  }

  return deleted;
}
