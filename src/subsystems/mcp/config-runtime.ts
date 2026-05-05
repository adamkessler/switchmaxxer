import { CURRENT_CONFIG_VERSION } from "../config/config";
import { getRuntimeEnv } from "../../platform/env";
import { createConfigMutationRuntime } from "../config/mutation";
import {
  loadConfigDocumentForDisplay,
  loadRawConfigJsonDocument,
  resolveCliConfigPath
} from "../config/read-model";
import { assertSafeObjectKey } from "../../platform/object-key-policy";
import { isRecord } from "../../platform/type-guards";
import { invalidInputFieldError, McpToolError } from "./errors";

const configMutationRuntime = createConfigMutationRuntime({
  currentConfigVersion: CURRENT_CONFIG_VERSION,
  defaultMaxPayloadSize: 4_000_000,
  defaultSystemdUnit: "switchmaxxer.service",
  resolveCliConfigPath,
  loadConfigJsonDocument: loadRawConfigJsonDocument,
  assertSafeCliConfigIdentifier: assertSafeObjectKey,
  getEnv: () => getRuntimeEnv()
});

export function loadConfigShowData(configPath?: string): {
  source_path: string;
  source_file: string;
  document: Record<string, unknown>;
} {
  const configData = loadConfigDocumentForDisplay(configPath);

  return {
    source_path: configData.sourcePath,
    source_file: configData.sourceFile,
    document: configData.document
  };
}

export function mutateConfigDocument(
  configPath: string | undefined,
  mutator: (document: Record<string, unknown>) => void
): void {
  try {
    configMutationRuntime.mutateConfigDocument(configPath, mutator);
  } catch (error) {
    if (error instanceof McpToolError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Mutated config failed runtime validation.";
    throw invalidInputFieldError(message);
  }
}

export function getMutableSection(
  document: Record<string, unknown>,
  sectionName: "models" | "service_providers" | "routes"
): Record<string, unknown> {
  const candidate = document[sectionName];

  if (!isRecord(candidate)) {
    throw new Error(`config.json must contain a '${sectionName}' object.`);
  }

  return candidate;
}
