import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_CATALOG_VERSION, CATALOG_SECTION_KEYS, SWITCHMAXXER_CATALOG_FILE_NAME } from "./catalog";
import {
  getConfigMutationLockEventsForTests,
  setConfigMutationLockEventsForTests
} from "./config-mutation-lock-events.test-support";

export function setConfigMutationLockTestHooksForTests(
  hooks: Parameters<typeof setConfigMutationLockEventsForTests>[0]
): void {
  setConfigMutationLockEventsForTests(hooks);
}

export function getConfigMutationLockTestHooksForTests(): ReturnType<typeof getConfigMutationLockEventsForTests> {
  return getConfigMutationLockEventsForTests();
}

export function writeSecureJsonForTests(filePath: string, document: Record<string, unknown>): void {
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  chmodSync(filePath, 0o600);
}

export function catalogPathForConfigForTests(configPath: string): string {
  return path.join(path.dirname(configPath), SWITCHMAXXER_CATALOG_FILE_NAME);
}

export function writeSplitConfigForTests(configPath: string, document: Record<string, unknown>): string {
  const configDocument = { ...document };
  const catalogDocument: Record<string, unknown> = {
    catalog_version: document["catalog_version"] ?? CURRENT_CATALOG_VERSION
  };

  for (const key of CATALOG_SECTION_KEYS) {
    catalogDocument[key] = document[key];
    delete configDocument[key];
  }

  const catalogPath = catalogPathForConfigForTests(configPath);
  writeSecureJsonForTests(configPath, configDocument);
  writeSecureJsonForTests(catalogPath, catalogDocument);
  return catalogPath;
}

export function splitExistingConfigFileForTests(configPath: string): string {
  return writeSplitConfigForTests(configPath, readJsonForTests(configPath));
}

export function copyExampleConfigPairForTests(configPath: string): string {
  const catalogPath = catalogPathForConfigForTests(configPath);
  copyFileSync(path.join(process.cwd(), "config-examples", "config.example.json"), configPath);
  chmodSync(configPath, 0o600);
  copyFileSync(path.join(process.cwd(), "config-examples", "catalog.example.json"), catalogPath);
  chmodSync(catalogPath, 0o600);
  return catalogPath;
}

export function readJsonForTests(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}
