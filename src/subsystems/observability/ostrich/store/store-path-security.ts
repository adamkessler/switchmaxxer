import { existsSync, lstatSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";

const ALLOWED_OBSERVABILITY_DB_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);

function nearestExistingParentDirectory(resolvedPath: string): string {
  let current = path.dirname(resolvedPath);

  while (!existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }

  return current;
}

function currentUserId(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function observedMode(stats: Stats): string {
  return `0${(stats.mode & 0o777).toString(8).padStart(3, "0")}`;
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function lstatIfPresent(filePath: string): Stats | null {
  try {
    return lstatSync(filePath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

function assertOwnedByCurrentUser(stats: Stats, subject: string): void {
  const uid = currentUserId();

  if (uid === null || stats.uid === uid) {
    return;
  }

  throw new Error(`${subject} must be owned by the current user uid ${uid}, but observed uid ${stats.uid}.`);
}

export function assertAllowedObservabilityDbExtension(resolvedPath: string): void {
  const extension = path.extname(resolvedPath).toLowerCase();

  if (ALLOWED_OBSERVABILITY_DB_EXTENSIONS.has(extension)) {
    return;
  }

  throw new Error(
    `Observability DB path '${resolvedPath}' must end in one of: ${Array.from(ALLOWED_OBSERVABILITY_DB_EXTENSIONS).join(", ")}.`
  );
}

export function assertSafeObservabilityDbParent(resolvedPath: string): void {
  const parentDir = nearestExistingParentDirectory(resolvedPath);
  const parentLinkStats = lstatSync(parentDir);

  if (parentLinkStats.isSymbolicLink()) {
    throw new Error(
      `Observability DB path '${resolvedPath}' is not allowed because its nearest existing parent '${parentDir}' is a symbolic link.`
    );
  }

  const parentStats = statSync(parentDir);

  if (!parentStats.isDirectory()) {
    throw new Error(
      `Observability DB path '${resolvedPath}' must use a directory parent, but '${parentDir}' is not a directory.`
    );
  }

  if ((parentStats.mode & 0o022) !== 0) {
    throw new Error(
      `Observability DB path '${resolvedPath}' is not allowed because its nearest existing parent '${parentDir}' is group- or world-writable (mode ${observedMode(parentStats)}).`
    );
  }

  assertOwnedByCurrentUser(parentStats, `Observability DB path '${resolvedPath}' nearest existing parent '${parentDir}'`);
}

export function assertSafeExistingObservabilityDbFile(resolvedPath: string): void {
  const dbStats = lstatIfPresent(resolvedPath);

  if (dbStats === null) {
    return;
  }

  if (dbStats.isSymbolicLink()) {
    throw new Error(`Observability DB path '${resolvedPath}' must not be a symbolic link.`);
  }

  if (!dbStats.isFile()) {
    throw new Error(`Observability DB path '${resolvedPath}' must be a regular file.`);
  }

  assertOwnedByCurrentUser(dbStats, `Observability DB path '${resolvedPath}'`);

  if ((dbStats.mode & 0o077) !== 0) {
    throw new Error(
      `Observability DB path '${resolvedPath}' must not be readable or writable by group or other users (mode ${observedMode(dbStats)}); run chmod 0600 '${resolvedPath}'.`
    );
  }
}

export function assertSafeResolvedObservabilityDbPath(resolvedPath: string): void {
  assertAllowedObservabilityDbExtension(resolvedPath);
  assertSafeObservabilityDbParent(resolvedPath);
  assertSafeExistingObservabilityDbFile(resolvedPath);
}
