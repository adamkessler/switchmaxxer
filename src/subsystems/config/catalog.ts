import path from "node:path";

import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";
import { assertOnlyKnownKeys } from "./config-validators-primitives";
import { MAX_CONFIG_FILE_BYTES, readConfigTextWithinLimit } from "./config-read";

export const CURRENT_CATALOG_VERSION = 1;
export const SWITCHMAXXER_CATALOG_FILE_NAME = "catalog.json";

export const CATALOG_SECTION_KEYS = ["service_providers", "routes", "models"] as const;
const CATALOG_TOP_LEVEL_KEYS = ["catalog_version", ...CATALOG_SECTION_KEYS];

type CatalogSectionKey = typeof CATALOG_SECTION_KEYS[number];

export interface LoadedCatalogDocument {
  sourcePath: string;
  sourceFile: string;
  document: Record<string, unknown>;
  rawText: string;
}

function isPositiveVersionInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function migrateCatalogDocumentToCurrentVersion(
  document: Record<string, unknown>,
  sourceName: string
): Record<string, unknown> {
  const rawVersion = document["catalog_version"];

  if (typeof rawVersion === "undefined") {
    return {
      ...document,
      catalog_version: CURRENT_CATALOG_VERSION
    };
  }

  if (!isPositiveVersionInteger(rawVersion)) {
    throw new Error(`${sourceName} field 'catalog_version' must be a positive integer when provided.`);
  }

  if (rawVersion > CURRENT_CATALOG_VERSION) {
    throw new Error(
      `${sourceName} uses unsupported future catalog_version ${rawVersion}. Current supported version is ${CURRENT_CATALOG_VERSION}.`
    );
  }

  if (rawVersion < CURRENT_CATALOG_VERSION) {
    throw new Error(
      `${sourceName} uses unsupported catalog_version ${rawVersion}. Add a migration path before loading it with this release.`
    );
  }

  return document;
}

function loadCatalogJsonObject(sourcePath: string): LoadedCatalogDocument {
  const sourceFile = path.basename(sourcePath);
  const rawText = readConfigTextWithinLimit(sourcePath, {
    logicalName: sourceFile,
    maxBytes: MAX_CONFIG_FILE_BYTES
  });

  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(rawText, {
      maxSerializedBytes: MAX_CONFIG_FILE_BYTES
    });
  } catch (error) {
    throw new Error(`${sourceFile} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${sourceFile} must contain a top-level object.`);
  }

  const document = migrateCatalogDocumentToCurrentVersion(parsed, sourceFile);
  assertOnlyKnownKeys(document, CATALOG_TOP_LEVEL_KEYS, sourceFile);

  return {
    sourcePath,
    sourceFile,
    document,
    rawText: `${JSON.stringify(document, null, 2)}\n`
  };
}

export function resolveCatalogPathForConfig(configPath: string): string {
  return path.join(path.dirname(path.resolve(configPath)), SWITCHMAXXER_CATALOG_FILE_NAME);
}

export function loadCatalogForConfig(configPath: string): LoadedCatalogDocument {
  const catalogPath = resolveCatalogPathForConfig(configPath);
  return loadCatalogJsonObject(catalogPath);
}

export function assertRuntimeConfigDoesNotOwnCatalogSections(
  configDocument: Record<string, unknown>,
  configSourceName: string
): void {
  for (const key of CATALOG_SECTION_KEYS) {
    if (typeof configDocument[key] !== "undefined") {
      throw new Error(
        `${configSourceName} must not define '${key}'. ` +
        `Keep provider, route, and model catalog sections in catalog.json.`
      );
    }
  }
}

function assertCatalogSectionPresent(
  catalogDocument: Record<string, unknown>,
  catalogSourceName: string,
  key: CatalogSectionKey
): void {
  if (typeof catalogDocument[key] === "undefined") {
    throw new Error(`${catalogSourceName} must contain a '${key}' object.`);
  }
}

export function composeConfigDocumentWithCatalog(
  configDocument: Record<string, unknown>,
  catalog: LoadedCatalogDocument,
  configSourceName: string
): Record<string, unknown> {
  const document = { ...configDocument };

  assertRuntimeConfigDoesNotOwnCatalogSections(configDocument, configSourceName);

  for (const key of CATALOG_SECTION_KEYS) {
    assertCatalogSectionPresent(catalog.document, catalog.sourceFile, key);
    document[key] = catalog.document[key];
  }

  return document;
}

export function splitEffectiveConfigDocumentForWrite(
  effectiveDocument: Record<string, unknown>,
  catalog: LoadedCatalogDocument
): {
  configDocument: Record<string, unknown>;
  catalogDocument: Record<string, unknown>;
} {
  const configDocument = { ...effectiveDocument };

  for (const key of CATALOG_SECTION_KEYS) {
    delete configDocument[key];
  }

  return {
    configDocument,
    catalogDocument: {
      catalog_version: catalog.document["catalog_version"] ?? CURRENT_CATALOG_VERSION,
      service_providers: effectiveDocument["service_providers"],
      routes: effectiveDocument["routes"],
      models: effectiveDocument["models"]
    }
  };
}
