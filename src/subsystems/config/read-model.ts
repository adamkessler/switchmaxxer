import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  type CliReadModel,
  type ModelReadModel,
  type ProviderReadModel,
  type RouteReadModel
} from "../../platform/types";
import { MASKED_SECRET_SENTINEL } from "../../platform/masked-secret";
import { assertSafeObjectKey, createStringKeyRecord } from "../../platform/object-key-policy";
import { MAX_CONFIG_FILE_BYTES, readConfigTextWithinLimit } from "./config-read";
import { loadCliValidatedConfigSnapshot, migrateConfigDocumentToCurrentVersion } from "./config";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRetentionDurationString } from "../../platform/retention-duration";
import { isRecord } from "../../platform/type-guards";
import { loadOptionalConfiguredSecretsFile } from "./secrets";
import {
  assertRuntimeConfigDoesNotOwnCatalogSections,
  composeConfigDocumentWithCatalog,
  loadCatalogForConfig
} from "./catalog";

function cloneJsonRecord<T extends Record<string, unknown>>(value: T): T {
  // This helper is intentionally limited to already-validated JSON-like config
  // documents and read-model data, not arbitrary rich JS objects.
  return structuredClone(value);
}

function getAuthSource(
  provider: {
    api_key: unknown | null;
    api_key_env: string | null;
  },
  apiKeyOverrides: Record<string, unknown>
): ProviderReadModel["auth_source"] {
  if (provider.api_key !== null) {
    return "inline override";
  }

  if (provider.api_key_env !== null) {
    if (Object.prototype.hasOwnProperty.call(apiKeyOverrides, provider.api_key_env)) {
      return "secrets override";
    }

    return "env var";
  }

  return "not required";
}

function readRawConfigJsonObject(sourcePath: string): {
  parsed: Record<string, unknown>;
  rawText: string;
} {
  const rawText = readConfigTextWithinLimit(sourcePath, {
    logicalName: "config.json"
  });

  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(rawText);
  } catch (error) {
    throw new Error(`config.json is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("config.json must contain a top-level object.");
  }

  const document = migrateConfigDocumentToCurrentVersion(parsed, "config.json");

  return {
    parsed: document,
    rawText: `${JSON.stringify(document, null, 2)}\n`
  };
}

function readEffectiveConfigJsonObject(sourcePath: string): {
  parsed: Record<string, unknown>;
  rawText: string;
} {
  const sourceFile = path.basename(sourcePath);
  const { parsed } = readRawConfigJsonObject(sourcePath);
  assertRuntimeConfigDoesNotOwnCatalogSections(parsed, sourceFile);
  const catalog = loadCatalogForConfig(sourcePath);
  const document = composeConfigDocumentWithCatalog(parsed, catalog, sourceFile);

  return {
    parsed: document,
    rawText: `${JSON.stringify(document, null, 2)}\n`
  };
}

export function resolveCliConfigPath(configPath?: string): string {
  return configPath ? path.resolve(configPath) : path.join(process.cwd(), "config.json");
}

export function resolveBoundedConfigPath(configPath: string | undefined, allowedRoot: string): string {
  const normalizedRoot = path.resolve(allowedRoot);
  const resolvedPath =
    typeof configPath === "string" && configPath.trim().length > 0
      ? path.resolve(normalizedRoot, configPath)
      : path.join(normalizedRoot, "config.json");
  const relativeToRoot = path.relative(normalizedRoot, resolvedPath);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Config path '${configPath ?? "config.json"}' escapes the allowed config root '${normalizedRoot}'.`);
  }

  if (existsSync(resolvedPath)) {
    const realResolvedPath = realpathSync(resolvedPath);
    const relativeRealPath = path.relative(normalizedRoot, realResolvedPath);

    if (
      relativeRealPath === ".." ||
      relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)
    ) {
      throw new Error(
        `Config path '${configPath ?? "config.json"}' resolves outside the allowed config root '${normalizedRoot}'.`
      );
    }
  }

  return resolvedPath;
}

export function sanitizeConfigDocumentForDisplay(document: Record<string, unknown>): Record<string, unknown> {
  const redacted = cloneJsonRecord(document);
  const serviceProviders = redacted["service_providers"];
  const providersRecord = isRecord(serviceProviders) ? serviceProviders : null;

  if (!providersRecord) {
    return redacted;
  }

  for (const providerValue of Object.values(providersRecord)) {
    if (!isRecord(providerValue)) {
      continue;
    }

    const apiKey = providerValue["api_key"];
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      providerValue["api_key"] = MASKED_SECRET_SENTINEL;
    }
  }

  return redacted;
}

export function loadConfigDocumentForDisplay(configPath?: string): {
  sourceFile: string;
  sourcePath: string;
  document: Record<string, unknown>;
  rawText: string;
} {
  const sourcePath = resolveCliConfigPath(configPath);
  const { parsed } = readEffectiveConfigJsonObject(sourcePath);

  const document = sanitizeConfigDocumentForDisplay(parsed);

  return {
    sourceFile: path.basename(sourcePath),
    sourcePath,
    document,
    rawText: `${JSON.stringify(document, null, 2)}\n`
  };
}

export function loadRawConfigJsonDocument(configPath?: string): {
  sourcePath: string;
  sourceFile: string;
  document: Record<string, unknown>;
} {
  const sourcePath = resolveCliConfigPath(configPath);
  const sourceFile = path.basename(sourcePath);
  const rawText = readConfigTextWithinLimit(sourcePath, {
    logicalName: sourceFile
  });
  const parsed = parseJsonWithinBounds(rawText, {
    maxSerializedBytes: MAX_CONFIG_FILE_BYTES
  }) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`${sourceFile} must contain a top-level object.`);
  }

  const document = migrateConfigDocumentToCurrentVersion(parsed, sourceFile);

  return {
    sourcePath,
    sourceFile,
    document
  };
}

export function loadConfigJsonDocument(configPath?: string): {
  sourcePath: string;
  sourceFile: string;
  document: Record<string, unknown>;
} {
  const sourcePath = resolveCliConfigPath(configPath);
  const sourceFile = path.basename(sourcePath);
  const { parsed } = readEffectiveConfigJsonObject(sourcePath);

  return {
    sourcePath,
    sourceFile,
    document: parsed
  };
}

export function resolveConfiguredObservabilityRetentionOlderThan(configPath?: string): string | null {
  const { sourceFile, document } = loadConfigJsonDocument(configPath);
  const observability = document["observability"];

  if (typeof observability === "undefined") {
    return null;
  }

  if (!isRecord(observability)) {
    throw new Error(`${sourceFile} field 'observability' must be an object when provided.`);
  }

  const retention = observability["retention"];

  if (typeof retention === "undefined") {
    return null;
  }

  if (!isRecord(retention)) {
    throw new Error(`${sourceFile} field 'observability.retention' must be an object when provided.`);
  }

  const olderThan = retention["older_than"];

  if (typeof olderThan === "undefined" || olderThan === null) {
    return null;
  }

  if (!isRetentionDurationString(olderThan)) {
    throw new Error(
      `${sourceFile} field 'observability.retention.older_than' must be a duration like '14d', '168h', '30m', or '2w'.`
    );
  }

  return olderThan;
}

export function loadCliReadModel(configPath?: string): CliReadModel {
  const snapshot = loadCliValidatedConfigSnapshot(configPath);
  const apiKeyOverrides = loadOptionalConfiguredSecretsFile()?.apiKeyOverrides ?? {};
  const documentModels = snapshot.document["models"];
  const documentRoutes = snapshot.document["routes"];
  const modelsRecord = isRecord(documentModels) ? documentModels : {};
  const routesRecord = isRecord(documentRoutes) ? documentRoutes : {};

  const routes = Object.entries(routesRecord).map(([name, value]): RouteReadModel => {
    assertSafeObjectKey(name, "Route name");
    if (!isRecord(value)) {
      throw new Error(`Route '${name}' must be stored as an object in config.json.`);
    }

    const route = value;
    const routeConfig = snapshot.routes[name];
    const modelName = route["model"] as string;
    const serviceProvider = route["service_provider"] as string;
    if (typeof routeConfig === "undefined") {
      throw new Error(`Route '${name}' is missing normalized route config`);
    }
    const model = snapshot.models[modelName];
    if (typeof model === "undefined") {
      throw new Error(`Route '${name}' references missing model '${modelName}' in read model snapshot`);
    }

    return {
      name,
      model: modelName,
      service_provider: serviceProvider,
      provider_model_id: route["provider_model_id"] as string,
      display_name: route["display_name"] as string,
      api_mode: routeConfig.api_mode,
      cost: routeConfig.cost,
      model_cost: model.cost,
      effective_cost: routeConfig.cost ?? model.cost,
      timeout_ms: routeConfig.routeTimeoutMs,
      effective_timeout_ms: routeConfig.timeoutMs
    };
  });

  const routeCountsByModel = routes.reduce<Record<string, number>>((counts, route) => {
    if (route.model.length > 0) {
      counts[route.model] = (counts[route.model] ?? 0) + 1;
    }

    return counts;
  }, createStringKeyRecord());

  const models = Object.entries(modelsRecord).map(([name]): ModelReadModel => {
    assertSafeObjectKey(name, "Model name");
    const model = snapshot.models[name];
    if (typeof model === "undefined") {
      throw new Error(`Model '${name}' is missing from read model snapshot`);
    }

    return {
      name,
      display_name: model.display_name,
      model_creator: model.model_creator,
      route_count: routeCountsByModel[name] ?? 0,
      cost: model.cost
    };
  });

  const providers = Object.entries(snapshot.providers).map(([name, provider]): ProviderReadModel => {
    assertSafeObjectKey(name, "Provider name");

    return {
      name,
      endpoint: provider.endpoint,
      api_mode: provider.api_mode,
      anthropic_version: provider.anthropic_version,
      model_id_format: provider.model_id_format,
      api_key_env: provider.api_key_env,
      api_key_masked: provider.api_key === null ? null : MASKED_SECRET_SENTINEL,
      allow_private_endpoints: provider.allow_private_endpoints,
      allow_insecure_http: provider.allow_insecure_http,
      auth_source: getAuthSource(provider, apiKeyOverrides)
    };
  });

  return {
    sourceFile: snapshot.sourceFile,
    sourcePath: snapshot.sourcePath,
    rawText: snapshot.rawText,
    models,
    modelsByName: models.reduce<Record<string, ModelReadModel>>((record, model) => {
      record[model.name] = model;
      return record;
    }, createStringKeyRecord()),
    providers,
    providersByName: providers.reduce<Record<string, ProviderReadModel>>((record, provider) => {
      record[provider.name] = provider;
      return record;
    }, createStringKeyRecord()),
    routes,
    routesByName: routes.reduce<Record<string, RouteReadModel>>((record, route) => {
      record[route.name] = route;
      return record;
    }, createStringKeyRecord())
  };
}
