import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname as getHostname } from "node:os";
import path from "node:path";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";
import { MAX_CONFIG_FILE_BYTES, readConfigTextWithinLimit } from "./config-read";
import { notifyStaleConfigMutationLockRemoved } from "./config-mutation-lock-events";

const CONFIG_MUTATION_LOCK_STALE_AFTER_MS = 30_000;
const CONFIG_MUTATION_LOCK_METADATA_MAX_BYTES = 4 * 1024;
const CONFIG_MUTATION_LOCK_METADATA_MAX_DEPTH = 8;
const CONFIG_MUTATION_LOCK_METADATA_MAX_NODE_COUNT = 64;

type ConfigMutationLockMetadata = {
  pid: number | null;
  createdAtMs: number | null;
  hostname: string | null;
};

function buildActiveConfigMutationLockMessage(sourcePath: string): string {
  return `Config file '${sourcePath}' is already being modified by another process.`;
}

function buildStaleConfigMutationLockRecoveryRacedMessage(sourcePath: string): string {
  return `Config file '${sourcePath}' had a stale mutation lock, but another process acquired the lock during recovery. Retry the command.`;
}

export function configDocumentContainsInlineProviderApiKey(document: Record<string, unknown>): boolean {
  const serviceProviders = document["service_providers"];
  const providers = isRecord(serviceProviders) ? serviceProviders : null;

  if (!providers) {
    return false;
  }

  for (const providerValue of Object.values(providers)) {
    if (!isRecord(providerValue)) {
      continue;
    }

    const apiKey = providerValue["api_key"];
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return true;
    }
  }

  return false;
}

function resolveConfigTargetMode(sourcePath: string, document: Record<string, unknown>): number | null {
  if (configDocumentContainsInlineProviderApiKey(document)) {
    return 0o600;
  }

  if (existsSync(sourcePath)) {
    return statSync(sourcePath).mode & 0o777;
  }

  return null;
}

function resolveConfigBackupMode(sourcePath: string): number {
  const sourceMode = statSync(sourcePath).mode & 0o777;

  try {
    const parsed = parseJsonWithinBounds(readFileSync(sourcePath, "utf8"), {
      maxSerializedBytes: MAX_CONFIG_FILE_BYTES
    });
    if (isRecord(parsed) && configDocumentContainsInlineProviderApiKey(parsed)) {
      return 0o600;
    }
  } catch {
    // Fall back to the source mode if the existing file cannot be parsed.
  }

  return sourceMode;
}

function assertConfigBackupSourceWithinLimit(sourcePath: string): void {
  const sizeBytes = statSync(sourcePath).size;

  if (sizeBytes > MAX_CONFIG_FILE_BYTES) {
    throw new Error(
      `Config file '${sourcePath}' exceeds the maximum supported size of ${Math.floor(MAX_CONFIG_FILE_BYTES / (1024 * 1024))} MB; refusing to create backup.`
    );
  }
}

const CONFIG_BACKUP_DIR_NAME = "catalog-backups";
const SWITCHMAXXER_STATE_DIR_NAME = ".switchmaxxer";

// Backups land under <dirname(sourcePath)>/.switchmaxxer/catalog-backups/ rather
// than as siblings of the source config so that the project root stays
// uncluttered. The directory is created on demand. Filename is the source
// basename plus a `.bak` suffix and is overwritten on each successive backup of
// the same source (matching the previous single-file semantics).
export function resolveConfigBackupPath(sourcePath: string): string {
  const sourceDir = path.dirname(sourcePath);
  const basename = path.basename(sourcePath);
  return path.join(sourceDir, SWITCHMAXXER_STATE_DIR_NAME, CONFIG_BACKUP_DIR_NAME, `${basename}.bak`);
}

function ensureConfigBackupDirExists(backupPath: string): void {
  mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
}

export function writeConfigJsonDocumentAtomically(
  sourcePath: string,
  document: Record<string, unknown>,
  tempLabel = "tmp",
  validateTempPath?: (tempPath: string) => void
): void {
  // This helper only makes the final file replacement atomic. Callers that do a
  // read-modify-write cycle must still serialize access with
  // `withConfigMutationLock(...)` so backup/mode decisions are taken against a
  // stable source file.
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const tempPath = `${sourcePath}.${tempLabel}-${randomBytes(8).toString("hex")}`;
  let tempFd: number | null = null;

  try {
    tempFd = openSync(tempPath, "wx", 0o600);
    writeSync(tempFd, serialized, undefined, "utf8");
    closeSync(tempFd);
    tempFd = null;

    const targetMode = resolveConfigTargetMode(sourcePath, document);
    if (targetMode !== null && targetMode !== 0o600) {
      chmodSync(tempPath, targetMode);
    }

    validateTempPath?.(tempPath);
    if (existsSync(sourcePath)) {
      writeConfigBackupSnapshot(sourcePath, resolveConfigBackupPath(sourcePath));
    }
    renameSync(tempPath, sourcePath);
  } catch (error) {
    if (tempFd !== null) {
      try {
        closeSync(tempFd);
      } catch {
        // Best-effort cleanup only; preserve the original write error.
      }
    }

    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only; preserve the original write error.
    }

    throw error;
  }
}

export function writeConfigBackupSnapshot(sourcePath: string, backupPath: string): void {
  assertConfigBackupSourceWithinLimit(sourcePath);
  ensureConfigBackupDirExists(backupPath);
  const backupMode = resolveConfigBackupMode(sourcePath);
  const tempBackupPath = `${backupPath}.tmp-${randomBytes(8).toString("hex")}`;
  const sourceBytes = readFileSync(sourcePath);
  let backupFd: number | null = null;

  try {
    backupFd = openSync(tempBackupPath, "wx", 0o600);
    writeSync(backupFd, sourceBytes);
    closeSync(backupFd);
    backupFd = null;

    if (backupMode !== 0o600) {
      chmodSync(tempBackupPath, backupMode);
    }

    renameSync(tempBackupPath, backupPath);
  } catch (error) {
    if (backupFd !== null) {
      try {
        closeSync(backupFd);
      } catch {
        // Best-effort cleanup only; preserve the original backup error.
      }
    }

    try {
      unlinkSync(tempBackupPath);
    } catch {
      // Best-effort cleanup only; preserve the original backup error.
    }

    throw error;
  }
}

function parseConfigMutationLockMetadata(lockPath: string): ConfigMutationLockMetadata {
  try {
    const rawText = readConfigTextWithinLimit(lockPath, {
      logicalName: "config mutation lock metadata",
      maxBytes: CONFIG_MUTATION_LOCK_METADATA_MAX_BYTES
    });
    const parsed = parseJsonWithinBounds(rawText, {
      maxDepth: CONFIG_MUTATION_LOCK_METADATA_MAX_DEPTH,
      maxNodeCount: CONFIG_MUTATION_LOCK_METADATA_MAX_NODE_COUNT,
      maxSerializedBytes: CONFIG_MUTATION_LOCK_METADATA_MAX_BYTES
    });

    if (!isRecord(parsed)) {
      return { pid: null, createdAtMs: null, hostname: null };
    }

    const pid = typeof parsed["pid"] === "number" && Number.isInteger(parsed["pid"]) && parsed["pid"] > 0
      ? parsed["pid"]
      : null;
    const createdAtRaw = typeof parsed["created_at"] === "string" ? Date.parse(parsed["created_at"]) : Number.NaN;
    const createdAtMs = Number.isFinite(createdAtRaw) ? createdAtRaw : null;
    const hostname = typeof parsed["hostname"] === "string" && parsed["hostname"].trim().length > 0
      ? parsed["hostname"]
      : null;

    return { pid, createdAtMs, hostname };
  } catch {
    return { pid: null, createdAtMs: null, hostname: null };
  }
}

function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException;

    if (normalized?.code === "ESRCH") {
      return false;
    }

    if (normalized?.code === "EPERM") {
      return true;
    }

    return true;
  }
}

function getConfigMutationLockAgeMs(lockPath: string, metadata: ConfigMutationLockMetadata): number | null {
  if (metadata.createdAtMs !== null) {
    return Math.max(0, Date.now() - metadata.createdAtMs);
  }

  try {
    return Math.max(0, Date.now() - statSync(lockPath).mtimeMs);
  } catch {
    return null;
  }
}

function isStaleConfigMutationLock(lockPath: string): boolean {
  const metadata = parseConfigMutationLockMetadata(lockPath);
  const currentHostname = getHostname();

  if (metadata.pid !== null && metadata.hostname === currentHostname && isPidLive(metadata.pid)) {
    return false;
  }

  const ageMs = getConfigMutationLockAgeMs(lockPath, metadata);
  return ageMs !== null && ageMs > CONFIG_MUTATION_LOCK_STALE_AFTER_MS;
}

function tryAcquireConfigMutationLock(lockPath: string): number {
  return openSync(lockPath, "wx", 0o600);
}

function resolveCanonicalConfigMutationLockPath(sourcePath: string): string {
  try {
    return `${realpathSync(sourcePath)}.lock`;
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException;

    if (normalized?.code === "ENOENT") {
      return `${sourcePath}.lock`;
    }

    throw error;
  }
}

export function withConfigMutationLock<T>(sourcePath: string, fn: () => T): T {
  const lockPath = resolveCanonicalConfigMutationLockPath(sourcePath);
  let lockFd: number | null = null;

  try {
    try {
      lockFd = tryAcquireConfigMutationLock(lockPath);
    } catch (error) {
      const normalized = error as NodeJS.ErrnoException;
      if (normalized?.code === "EEXIST") {
        if (!isStaleConfigMutationLock(lockPath)) {
          throw new Error(buildActiveConfigMutationLockMessage(sourcePath));
        }

        try {
          unlinkSync(lockPath);
        } catch (unlinkError) {
          const unlinkNormalized = unlinkError as NodeJS.ErrnoException;
          if (unlinkNormalized?.code !== "ENOENT") {
            throw unlinkError;
          }
        }

        notifyStaleConfigMutationLockRemoved(lockPath);

        try {
          lockFd = tryAcquireConfigMutationLock(lockPath);
        } catch (retryError) {
          const retryNormalized = retryError as NodeJS.ErrnoException;
          if (retryNormalized?.code === "EEXIST") {
            throw new Error(buildStaleConfigMutationLockRecoveryRacedMessage(sourcePath));
          }
          throw retryError;
        }

      } else {
        throw error;
      }
    }

    writeSync(
      lockFd,
      JSON.stringify({
        pid: process.pid,
        hostname: getHostname(),
        created_at: new Date().toISOString()
      }),
      undefined,
      "utf8"
    );
    return fn();
  } finally {
    if (lockFd !== null) {
      try {
        closeSync(lockFd);
      } catch {
        // Best-effort cleanup only; preserve the original error.
      }
    }

    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup only; preserve the original error.
    }
  }
}
