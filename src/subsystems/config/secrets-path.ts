import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { getNonEmptyEnvValue, getRuntimeEnv } from "../../platform/env";

export const SWITCHMAXXER_SECRETS_PATH_ENV = "SWITCHMAXXER_SECRETS_PATH";
const SWITCHMAXXER_SECRETS_FILE_NAME = "secrets.json";

const SWITCHMAXXER_CONFIG_DIR_NAME = "switchmaxxer";

export interface SecretsPathResolutionOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string | null;
}

function nonEmptyString(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveFromBase(basePath: string, ...segments: string[]): string {
  return path.resolve(basePath, ...segments);
}

function resolveCanonicalPathWithMissingFallback(candidatePath: string): string {
  try {
    if (lstatSync(candidatePath).isSymbolicLink()) {
      throw new Error(`${SWITCHMAXXER_SECRETS_PATH_ENV} must not point to a symbolic link: '${candidatePath}'.`);
    }
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException;

    if (normalized?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    return realpathSync(candidatePath);
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException;

    if (normalized?.code === "ENOENT") {
      return candidatePath;
    }

    throw error;
  }
}

export function resolveDefaultSecretsPath(options: SecretsPathResolutionOptions = {}): string {
  const env = getRuntimeEnv(options.env);
  const cwd = options.cwd ?? process.cwd();
  const xdgConfigHome = getNonEmptyEnvValue("XDG_CONFIG_HOME", env);

  if (xdgConfigHome !== null) {
    return resolveFromBase(xdgConfigHome, SWITCHMAXXER_CONFIG_DIR_NAME, SWITCHMAXXER_SECRETS_FILE_NAME);
  }

  const configuredHomeDir = typeof options.homeDir === "undefined" ? getNonEmptyEnvValue("HOME", env) ?? homedir() : options.homeDir;
  const home = nonEmptyString(configuredHomeDir);

  if (home !== null) {
    return resolveFromBase(home, ".config", SWITCHMAXXER_CONFIG_DIR_NAME, SWITCHMAXXER_SECRETS_FILE_NAME);
  }

  return resolveFromBase(cwd, SWITCHMAXXER_SECRETS_FILE_NAME);
}

export function resolveSecretsPath(options: SecretsPathResolutionOptions = {}): string {
  const env = getRuntimeEnv(options.env);
  const cwd = options.cwd ?? process.cwd();
  const explicitPath = getNonEmptyEnvValue(SWITCHMAXXER_SECRETS_PATH_ENV, env);

  if (explicitPath !== null) {
    return resolveCanonicalPathWithMissingFallback(path.resolve(cwd, explicitPath));
  }

  return resolveDefaultSecretsPath(options);
}
