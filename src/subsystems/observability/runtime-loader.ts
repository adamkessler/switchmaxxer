import { existsSync } from "node:fs";
import path from "node:path";

import { getEnvValue } from "../../platform/env";
import { retentionDurationToCutoffIso } from "../../platform/retention-duration";
import type { ObservabilityService } from "./service";
import type { ObservabilityStore } from "./store";
import type { ObservabilityPruneResult } from "./service";
import { defaultObservabilityDbPath } from "./store-path";
import { assertSafeResolvedObservabilityDbPath } from "./store-path-security";
export { defaultObservabilityDbPath } from "./store-path";

export interface ObservabilityRuntimeHandle {
  store: ObservabilityStore;
  service: ObservabilityService;
}

export interface ObservabilityOpenOptions {
  retentionOlderThan?: string | null;
  onRetentionPruned?: (result: ObservabilityPruneResult) => void;
  onRetentionError?: (error: Error) => void;
  sqliteExperimentalWarning?: "allow" | "suppress";
}

function normalizeObservabilityRuntimeError(error: unknown): Error {
  const normalizedError = error instanceof Error ? error : new Error("Unknown observability runtime error");
  const message = normalizedError.message ?? "";

  if (
    message.includes("node:sqlite")
    || message.includes("No such built-in module: node:sqlite")
    || message.includes("Cannot find module 'node:sqlite'")
    || message.includes("No such module: node:sqlite")
  ) {
    return new Error(
      "Observability requires Node 22+ with built-in 'node:sqlite' support. Upgrade Node before using trace, bench, or other observability-backed commands."
    );
  }

  return normalizedError;
}

function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const message = warning instanceof Error ? warning.message : typeof warning === "string" ? warning : "";
  const warningName = warning instanceof Error ? warning.name : "";
  const warningType =
    typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeof typeOrOptions === "object" && typeOrOptions !== null && "type" in typeOrOptions
        ? String((typeOrOptions as { type?: unknown }).type ?? "")
        : "";

  return (
    (warningName === "ExperimentalWarning" || warningType === "ExperimentalWarning")
    && /SQLite is an experimental feature|node:sqlite/i.test(message)
  );
}

function suppressSqliteExperimentalWarning<T>(load: () => T): T {
  const originalEmitWarning = process.emitWarning;
  const emitWarning = originalEmitWarning.bind(process) as (...args: unknown[]) => void;

  // Node emits the sqlite warning while the built-in module is loading. Keep the
  // interception scoped to that synchronous require and preserve every other warning.
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args[0])) {
      return;
    }

    emitWarning(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    return load();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function loadObservabilityRuntimeModules(options: ObservabilityOpenOptions): {
  bootstrapObservabilityStore: typeof import("./store")["bootstrapObservabilityStore"];
  ObservabilityService: typeof import("./service")["ObservabilityService"];
} {
  const loadModules = () => {
    const { bootstrapObservabilityStore } = require("./store") as typeof import("./store");
    const { ObservabilityService } = require("./service") as typeof import("./service");
    return { bootstrapObservabilityStore, ObservabilityService };
  };

  if (options.sqliteExperimentalWarning === "allow") {
    return loadModules();
  }

  return suppressSqliteExperimentalWarning(loadModules);
}

export function resolveObservabilityDbPath(dbPath: string, cwd = process.cwd()): string {
  const resolvedPath = path.resolve(cwd, dbPath);
  assertSafeResolvedObservabilityDbPath(resolvedPath);
  return resolvedPath;
}

export function resolveObservabilityStorePath(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  defaultDbPath?: string;
} = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const configuredPath = getEnvValue("SWITCHMAXXER_OBSERVABILITY_DB", options.env);
  const dbPath = configuredPath ?? options.defaultDbPath ?? defaultObservabilityDbPath(cwd);
  return resolveObservabilityDbPath(dbPath, cwd);
}

export function openObservabilityService(dbPath: string, options: ObservabilityOpenOptions = {}): ObservabilityRuntimeHandle {
  let bootstrapObservabilityStore: typeof import("./store")["bootstrapObservabilityStore"];
  let ObservabilityService: typeof import("./service")["ObservabilityService"];

  try {
    ({ bootstrapObservabilityStore, ObservabilityService } = loadObservabilityRuntimeModules(options));
  } catch (error) {
    throw normalizeObservabilityRuntimeError(error);
  }

  const resolvedDbPath = resolveObservabilityDbPath(dbPath);
  const store = bootstrapObservabilityStore({ dbPath: resolvedDbPath });
  const service = new ObservabilityService(store.db);

  if (typeof options.retentionOlderThan === "string" && options.retentionOlderThan.trim().length > 0) {
    try {
      const result = service.pruneOlderThan(retentionDurationToCutoffIso(options.retentionOlderThan));
      options.onRetentionPruned?.(result);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error("Unknown observability retention prune error");
      options.onRetentionError?.(normalizedError);
    }
  }

  return {
    store,
    service
  };
}

export function openExistingObservabilityService(
  dbPath: string,
  options: ObservabilityOpenOptions = {}
): ObservabilityRuntimeHandle | null {
  const resolvedDbPath = resolveObservabilityDbPath(dbPath);

  if (!existsSync(resolvedDbPath)) {
    return null;
  }

  return openObservabilityService(resolvedDbPath, options);
}

export function closeObservabilityServiceHandle(handle: Pick<ObservabilityRuntimeHandle, "store"> | null): void {
  if (!handle) {
    return;
  }

  const { closeObservabilityStore } = require("./store") as typeof import("./store");
  closeObservabilityStore(handle.store);
}
