import { existsSync } from "node:fs";
import path from "node:path";

import { getNonEmptyEnvValue, getRuntimeEnv } from "../../platform/env";
import { createStringKeyRecord } from "../../platform/object-key-policy";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { SecretString } from "../../platform/secret-string";
import { isNonEmptyString, isRecord } from "../../platform/type-guards";
import {
  assertOnlyKnownKeys,
  assertValidSwitchmaxxerManagedEnvVarName
} from "./config-validation";
import { readConfigTextWithinLimit } from "./config-read";
import {
  resolveSecretsPath,
  SWITCHMAXXER_SECRETS_PATH_ENV,
  type SecretsPathResolutionOptions
} from "./secrets-path";

const MAX_SECRETS_FILE_BYTES = 1024 * 1024;

export interface LoadedSecretsFile {
  sourceFile: string;
  sourcePath: string;
  apiKeyOverrides: Record<string, SecretString>;
}

function readSecretsJsonObject(sourcePath: string): {
  sourceFile: string;
  document: Record<string, unknown>;
} {
  const sourceFile = path.basename(sourcePath);
  const rawText = readConfigTextWithinLimit(sourcePath, {
    logicalName: sourceFile,
    maxBytes: MAX_SECRETS_FILE_BYTES
  });

  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(rawText, {
      maxSerializedBytes: MAX_SECRETS_FILE_BYTES
    });
  } catch (error) {
    throw new Error(`${sourceFile} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${sourceFile} must contain a top-level object.`);
  }

  return {
    sourceFile,
    document: parsed
  };
}

function validateApiKeyOverrides(value: unknown, sourceFile: string): Record<string, SecretString> {
  const apiKeyOverrides = createStringKeyRecord<SecretString>();

  if (typeof value === "undefined") {
    return apiKeyOverrides;
  }

  if (!isRecord(value)) {
    throw new Error(`${sourceFile} field 'api_key_overrides' must be an object when provided.`);
  }

  for (const [envVarName, overrideValue] of Object.entries(value)) {
    assertValidSwitchmaxxerManagedEnvVarName(envVarName, `api_key_overrides.${envVarName}`, sourceFile);

    if (!isNonEmptyString(overrideValue)) {
      throw new Error(`${sourceFile} field 'api_key_overrides.${envVarName}' must be a non-empty string.`);
    }

    apiKeyOverrides[envVarName] = new SecretString(overrideValue);
  }

  return apiKeyOverrides;
}

export function loadSecretsFile(secretsPath: string): LoadedSecretsFile {
  const sourcePath = path.resolve(secretsPath);
  const { sourceFile, document } = readSecretsJsonObject(sourcePath);

  assertOnlyKnownKeys(document, ["api_key_overrides"], sourceFile);

  return {
    sourceFile,
    sourcePath,
    apiKeyOverrides: validateApiKeyOverrides(document["api_key_overrides"], sourceFile)
  };
}

export function loadConfiguredSecretsFile(options: SecretsPathResolutionOptions = {}): LoadedSecretsFile {
  return loadSecretsFile(resolveSecretsPath(options));
}

export function loadOptionalConfiguredSecretsFile(
  options: SecretsPathResolutionOptions = {}
): LoadedSecretsFile | null {
  const env = getRuntimeEnv(options.env);
  const sourcePath = resolveSecretsPath(options);

  if (!existsSync(sourcePath)) {
    if (getNonEmptyEnvValue(SWITCHMAXXER_SECRETS_PATH_ENV, env) !== null) {
      return loadSecretsFile(sourcePath);
    }

    return null;
  }

  return loadSecretsFile(sourcePath);
}
