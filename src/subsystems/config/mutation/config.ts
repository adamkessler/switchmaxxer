import { existsSync, readFileSync } from "node:fs";
import {
  resolveConfigBackupPath,
  withConfigMutationLock,
  writeConfigBackupSnapshot,
  writeConfigJsonDocumentAtomically
} from "../config-file";
import { MCP_ENTITY_STATE_ERROR_CODES, MCP_USAGE_ERROR_CODES } from "../config-metadata";
import { assertSafeObjectKey } from "../../../platform/object-key-policy";
import { isNonEmptyString, isRecord } from "../../../platform/type-guards";
import {
  assertOnlyKnownConfigDocumentKeys,
  assertValidSwitchmaxxerManagedEnvVarName,
  logPrivateEndpointProviderWarnings,
  validateBenchmarkSettings,
  validateModelConfig,
  validateObservabilitySettings,
  validateRouteConfig,
  validateRuntimeSettings,
  validateServiceProviderConfig
} from "../config-validation";
import {
  MIN_INBOUND_API_KEY_LENGTH,
  resolveInboundApiKeyValue
} from "../../gateway/local-gateway-auth";
import {
  assertRuntimeConfigDoesNotOwnCatalogSections,
  composeConfigDocumentWithCatalog,
  loadCatalogForConfig,
  splitEffectiveConfigDocumentForWrite
} from "../catalog";
import { loadOptionalConfiguredSecretsFile } from "../secrets";

type ConfigMutationRuntime = {
  writeConfigJsonDocument: (sourcePath: string, document: Record<string, unknown>) => void;
  serializeConfigDocument: (document: Record<string, unknown>) => string;
  createConfigImportBackup: (targetPath: string) => string | null;
  renderConfigImportDiff: (currentText: string, nextText: string) => string;
  getMutableConfigSection: (
    document: Record<string, unknown>,
    key: "models" | "service_providers" | "routes"
  ) => Record<string, unknown>;
  normalizeAndValidateConfigDocumentForMutation: (
    document: Record<string, unknown>
  ) => Record<string, unknown>;
  classifyMutationError: (message: string, fallbackCode: string) => {
    code: string;
    exitCode: number;
  };
  CliUsageError: new (code: string, message: string) => Error & { code: string };
  CliMutationError: new (code: string, message: string, exitCode?: number) => Error & { code: string; exitCode: number };
  throwCliInvalidInputField: (message: string) => never;
  classifyCliUsageFailure: (
    error: unknown,
    options: {
      usageFallbackCode: string;
      mutationFallbackCode: string;
      isUsageMessage: (message: string) => boolean;
    }
  ) => {
    message: string;
    code: string;
    exitCode: number;
  };
  noUsageMessageMatch: (_message: string) => boolean;
  mutateConfigDocument: <T>(
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => T
  ) => T;
};

export function createConfigMutationRuntime(deps: {
  currentConfigVersion: number;
  defaultMaxPayloadSize: number;
  defaultSystemdUnit: string;
  resolveCliConfigPath: (configPath?: string) => string;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  assertSafeCliConfigIdentifier: (value: string, label: string) => void;
  getEnv: () => NodeJS.ProcessEnv;
}): ConfigMutationRuntime {
  function writeConfigJsonDocument(sourcePath: string, document: Record<string, unknown>): void {
    try {
      writeConfigJsonDocumentAtomically(sourcePath, document);
    } catch (error) {
      throw new Error(`Unable to write config.json at '${sourcePath}': ${(error as Error).message}`);
    }
  }

  function writeCatalogJsonDocument(sourcePath: string, document: Record<string, unknown>): void {
    try {
      writeConfigJsonDocumentAtomically(sourcePath, document, "catalog-tmp");
    } catch (error) {
      throw new Error(`Unable to write catalog.json at '${sourcePath}': ${(error as Error).message}`);
    }
  }

  function serializeConfigDocument(document: Record<string, unknown>): string {
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  function writeConfigJsonDocumentIfChanged(sourcePath: string, document: Record<string, unknown>): void {
    const nextText = serializeConfigDocument(document);
    const currentText = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : null;

    if (currentText !== nextText) {
      writeConfigJsonDocument(sourcePath, document);
    }
  }

  function writeCatalogJsonDocumentIfChanged(sourcePath: string, document: Record<string, unknown>): void {
    const nextText = serializeConfigDocument(document);
    const currentText = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : null;

    if (currentText !== nextText) {
      writeCatalogJsonDocument(sourcePath, document);
    }
  }

  function createConfigImportBackup(targetPath: string): string | null {
    if (!existsSync(targetPath)) {
      return null;
    }

    const backupPath = resolveConfigBackupPath(targetPath);

    try {
      writeConfigBackupSnapshot(targetPath, backupPath);
    } catch (error) {
      throw new Error(`Unable to write config backup at '${backupPath}': ${(error as Error).message}`);
    }

    return backupPath;
  }

  function renderConfigImportDiff(currentText: string, nextText: string): string {
    if (currentText === nextText) {
      return "No config changes.\n";
    }

    const currentLines = currentText.replace(/\n$/, "").split("\n");
    const nextLines = nextText.replace(/\n$/, "").split("\n");
    let prefix = 0;

    while (
      prefix < currentLines.length &&
      prefix < nextLines.length &&
      currentLines[prefix] === nextLines[prefix]
    ) {
      prefix += 1;
    }

    let currentSuffix = currentLines.length - 1;
    let nextSuffix = nextLines.length - 1;

    while (
      currentSuffix >= prefix &&
      nextSuffix >= prefix &&
      currentLines[currentSuffix] === nextLines[nextSuffix]
    ) {
      currentSuffix -= 1;
      nextSuffix -= 1;
    }

    const lines = ["--- current", "+++ imported"];

    for (const line of currentLines.slice(prefix, currentSuffix + 1)) {
      lines.push(`- ${line}`);
    }

    for (const line of nextLines.slice(prefix, nextSuffix + 1)) {
      lines.push(`+ ${line}`);
    }

    return `${lines.join("\n")}\n`;
  }

  function getMutableConfigSection(
    document: Record<string, unknown>,
    key: "models" | "service_providers" | "routes"
  ): Record<string, unknown> {
    const candidate = document[key];

    if (!isRecord(candidate)) {
      throw new Error(`config.json must contain a '${key}' object.`);
    }

    return candidate;
  }

  function normalizeAndValidateConfigDocumentForMutation(
    document: Record<string, unknown>
  ): Record<string, unknown> {
    const normalizedDocument = structuredClone(document);

    if (typeof normalizedDocument["config_version"] === "undefined") {
      normalizedDocument["config_version"] = deps.currentConfigVersion;
    }

    if (
      typeof normalizedDocument["config_version"] !== "number" ||
      !Number.isFinite(normalizedDocument["config_version"]) ||
      !Number.isInteger(normalizedDocument["config_version"]) ||
      normalizedDocument["config_version"] <= 0
    ) {
      throw new Error("config.json field 'config_version' must be a positive integer when provided.");
    }

    if (normalizedDocument["config_version"] !== deps.currentConfigVersion) {
      throw new Error(
        `config.json field 'config_version' must be ${deps.currentConfigVersion} for this Switchmaxxer release.`
      );
    }

    const runtimeSettings = validateRuntimeSettings(normalizedDocument, "config.json", {
      bindHost: "127.0.0.1",
      maxConnections: 200,
      maxPayloadSize: deps.defaultMaxPayloadSize,
      streamMaxLifetimeMs: 600_000,
      streamMinBytesPerSecond: 16,
      streamRateWindowMs: 30_000,
      streamMaxEventBytes: 1_048_576,
      streamMaxTotalBytes: 67_108_864,
      maxConcurrentStreamsPerIp: 8,
      maxConcurrentJsonParses: 4,
      maxBufferedUpstreamResponseBytes: 16 * 1024 * 1024,
      shutdownTimeoutMs: 30_000,
      systemdUnit: deps.defaultSystemdUnit
    });

    normalizedDocument["max_payload_size"] = runtimeSettings.maxPayloadSize;
    normalizedDocument["bind_host"] = runtimeSettings.bindHost;
    normalizedDocument["max_connections"] = runtimeSettings.maxConnections;
    normalizedDocument["timeout_ms"] = runtimeSettings.timeoutMs;
    normalizedDocument["stream_idle_timeout_ms"] = runtimeSettings.streamIdleTimeoutMs;
    normalizedDocument["stream_max_lifetime_ms"] = runtimeSettings.streamMaxLifetimeMs;
    normalizedDocument["stream_min_bytes_per_second"] = runtimeSettings.streamMinBytesPerSecond;
    normalizedDocument["stream_rate_window_ms"] = runtimeSettings.streamRateWindowMs;
    normalizedDocument["stream_max_event_bytes"] = runtimeSettings.streamMaxEventBytes;
    normalizedDocument["stream_max_total_bytes"] = runtimeSettings.streamMaxTotalBytes;
    normalizedDocument["max_concurrent_streams_per_ip"] = runtimeSettings.maxConcurrentStreamsPerIp;
    normalizedDocument["max_concurrent_json_parses"] = runtimeSettings.maxConcurrentJsonParses;
    normalizedDocument["max_buffered_upstream_response_bytes"] = runtimeSettings.maxBufferedUpstreamResponseBytes;
    normalizedDocument["shutdown_timeout_ms"] = runtimeSettings.shutdownTimeoutMs;
    normalizedDocument["systemd_unit"] = runtimeSettings.systemdUnit;

    if (typeof runtimeSettings.logLevel === "string") {
      normalizedDocument["log_level"] = runtimeSettings.logLevel;
    } else {
      delete normalizedDocument["log_level"];
    }

    delete normalizedDocument["bindHost"];
    delete normalizedDocument["maxConnections"];
    delete normalizedDocument["timeoutMs"];
    delete normalizedDocument["streamIdleTimeoutMs"];
    delete normalizedDocument["streamMaxLifetimeMs"];
    delete normalizedDocument["streamMinBytesPerSecond"];
    delete normalizedDocument["streamRateWindowMs"];
    delete normalizedDocument["streamMaxEventBytes"];
    delete normalizedDocument["streamMaxTotalBytes"];
    delete normalizedDocument["maxConcurrentStreamsPerIp"];
    delete normalizedDocument["maxConcurrentJsonParses"];
    delete normalizedDocument["maxBufferedUpstreamResponseBytes"];
    delete normalizedDocument["shutdownTimeoutMs"];
    delete normalizedDocument["logLevel"];

    // Load secrets-file overrides once and use them for both the inbound auth
    // check and the per-route validator below. Without this, MCP-driven
    // mutations in a child process whose only configured env entry is
    // SWITCHMAXXER_SECRETS_PATH would fail post-mutation validation even when
    // every required token is correctly in the secrets file.
    const providerApiKeyOverrides = loadOptionalConfiguredSecretsFile()?.apiKeyOverrides ?? null;

    if (isNonEmptyString(runtimeSettings.inboundApiKeyEnv)) {
      assertValidSwitchmaxxerManagedEnvVarName(runtimeSettings.inboundApiKeyEnv, "inbound_api_key_env", "config.json");
      // Prefer the secrets-file override; fall back to the DI-supplied env
      // accessor so test fixtures that inject a custom env still work.
      const overrideValue = resolveInboundApiKeyValue(runtimeSettings.inboundApiKeyEnv, providerApiKeyOverrides);
      const inboundApiKey = overrideValue ?? deps.getEnv()[runtimeSettings.inboundApiKeyEnv];

      if (!isNonEmptyString(inboundApiKey)) {
        throw new Error(
          `config.json requires environment variable '${runtimeSettings.inboundApiKeyEnv}' for inbound gateway auth, but it is not set or is empty.`
        );
      }

      if (inboundApiKey.length < MIN_INBOUND_API_KEY_LENGTH) {
        throw new Error(
          `config.json requires environment variable '${runtimeSettings.inboundApiKeyEnv}' for inbound gateway auth to be at least ${MIN_INBOUND_API_KEY_LENGTH} characters long.`
        );
      }
    }

    validateObservabilitySettings(normalizedDocument, "config.json");
    validateBenchmarkSettings(normalizedDocument, "config.json", {
      defaultMaxTokens: 32,
      defaultAnthropicVersion: "2023-06-01"
    });

    const modelsRecord = getMutableConfigSection(normalizedDocument, "models");
    const providersRecord = getMutableConfigSection(normalizedDocument, "service_providers");
    const routesRecord = getMutableConfigSection(normalizedDocument, "routes");
    const validatedModels: Record<string, ReturnType<typeof validateModelConfig>> = {};
    const validatedProviders: Record<string, ReturnType<typeof validateServiceProviderConfig>> = {};

    for (const [modelName, value] of Object.entries(modelsRecord)) {
      assertSafeObjectKey(modelName, "Model name");
      deps.assertSafeCliConfigIdentifier(modelName, "Model name");
      validatedModels[modelName] = validateModelConfig(modelName, value);
    }

    for (const [providerName, value] of Object.entries(providersRecord)) {
      assertSafeObjectKey(providerName, "Provider name");
      deps.assertSafeCliConfigIdentifier(providerName, "Provider name");
      validatedProviders[providerName] = validateServiceProviderConfig(providerName, value);
    }
    logPrivateEndpointProviderWarnings(
      Object.entries(validatedProviders)
        .filter(([, provider]) => provider.allow_private_endpoints)
        .map(([providerName]) => providerName)
    );

    // Reuse the secrets-file overrides loaded above so per-route provider auth
    // validation honors the same source of truth as the inbound auth check
    // (and as the read-model's `auth_source = "secrets override"` reporting).
    for (const [routeName, value] of Object.entries(routesRecord)) {
      assertSafeObjectKey(routeName, "Route name");
      deps.assertSafeCliConfigIdentifier(routeName, "Route name");
      validateRouteConfig(routeName, value, validatedProviders, validatedModels, runtimeSettings.timeoutMs, {
        providerApiKeyOverrides
      });
    }

    assertOnlyKnownConfigDocumentKeys(normalizedDocument, "normalized config.json");

    return normalizedDocument;
  }

  function classifyMutationError(message: string, fallbackCode: string): {
    code: string;
    exitCode: number;
  } {
    if (/ already exists$/.test(message)) {
      if (message.startsWith("Model '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.modelAlreadyExists, exitCode: 1 };
      }

      if (message.startsWith("Provider '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.providerAlreadyExists, exitCode: 1 };
      }

      if (message.startsWith("Route '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.routeAlreadyExists, exitCode: 1 };
      }
    }

    if (/ was not found$/.test(message)) {
      if (message.startsWith("Model '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.modelNotFound, exitCode: 1 };
      }

      if (message.startsWith("Provider '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.providerNotFound, exitCode: 1 };
      }

      if (message.startsWith("Route '")) {
        return { code: MCP_ENTITY_STATE_ERROR_CODES.routeNotFound, exitCode: 1 };
      }
    }

    const prefixMatch = message.match(/^(Model|Provider|Route) '([^']+)' (.+)$/);

    if (prefixMatch) {
      const entity = prefixMatch[1];
      const remainder = prefixMatch[3];

      if (typeof entity !== "undefined" && typeof remainder !== "undefined") {
        if (remainder.startsWith("cannot be deleted because")) {
          if (entity === "Model") {
            return { code: MCP_ENTITY_STATE_ERROR_CODES.modelInUse, exitCode: 1 };
          }

          if (entity === "Provider") {
            return { code: MCP_ENTITY_STATE_ERROR_CODES.providerInUse, exitCode: 1 };
          }
        }

        if (remainder.startsWith("references unknown model")) {
          return { code: MCP_ENTITY_STATE_ERROR_CODES.unknownModel, exitCode: 1 };
        }

        if (remainder.startsWith("references unknown service provider")) {
          return { code: MCP_ENTITY_STATE_ERROR_CODES.unknownServiceProvider, exitCode: 1 };
        }
      }
    }

    if (
      message.includes("missing a valid") ||
      message.includes("must define either 'api_key' or 'api_key_env'") ||
      message.includes("must be stored as an object in config.json.") ||
      message.includes("must not define") ||
      message.includes("must contain a 'models' object.") ||
      message.includes("must contain a 'service_providers' object.") ||
      message.includes("must contain a 'routes' object.") ||
      message.includes("is reserved and cannot be used.") ||
      message.includes("references unknown model") ||
      message.includes("references unknown service provider")
    ) {
      return { code: "invalid_config_mutation", exitCode: 1 };
    }

    return { code: fallbackCode, exitCode: 1 };
  }

  class CliUsageError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = "CliUsageError";
      this.code = code;
    }
  }

  class CliMutationError extends Error {
    readonly code: string;
    readonly exitCode: number;

    constructor(code: string, message: string, exitCode = 1) {
      super(message);
      this.name = "CliMutationError";
      this.code = code;
      this.exitCode = exitCode;
    }
  }

  function throwCliInvalidInputField(message: string): never {
    throw new CliUsageError(MCP_USAGE_ERROR_CODES.invalidInputField, message);
  }

  function classifyUsageError(message: string, fallbackCode: string): {
    code: string;
    exitCode: number;
  } {
    if (
      message.startsWith("Missing required argument '<") ||
      message.includes("is required when not using '--stdin' or '--json-input'")
    ) {
      return { code: MCP_USAGE_ERROR_CODES.missingRequiredField, exitCode: 2 };
    }

    if (message.startsWith("Flag '--") && message.includes("' requires a value")) {
      return { code: MCP_USAGE_ERROR_CODES.missingFlagValue, exitCode: 2 };
    }

    if (message.startsWith("Flag '--") && message.includes("' requires a non-negative numeric value")) {
      return { code: MCP_USAGE_ERROR_CODES.invalidFlagValue, exitCode: 2 };
    }

    if (message.startsWith("Use only one of '--stdin' or '--json-input'")) {
      return { code: MCP_USAGE_ERROR_CODES.conflictingStructuredInput, exitCode: 2 };
    }

    if (message.startsWith("Do not mix '--stdin' or '--json-input'")) {
      return { code: MCP_USAGE_ERROR_CODES.conflictingInputModes, exitCode: 2 };
    }

    if (message.startsWith("Flag '--clear-cost' cannot be combined with explicit '--cost-*' values")) {
      return { code: MCP_USAGE_ERROR_CODES.conflictingCostFlags, exitCode: 2 };
    }

    if (message.startsWith("Cost flags must be provided as a complete set")) {
      return { code: MCP_USAGE_ERROR_CODES.incompleteCostFlags, exitCode: 2 };
    }

    if (message.startsWith("Flag '--clear-cost' is not supported")) {
      return { code: MCP_USAGE_ERROR_CODES.unsupportedClearCost, exitCode: 2 };
    }

    if (
      message.includes("is reserved and cannot be used.") ||
      message.startsWith("stdin payload field '") ||
      message.startsWith("json input field '") ||
      message.startsWith("stdin payload must include a non-empty") ||
      message.startsWith("json input must include a non-empty") ||
      message.startsWith("stdin payload must not include 'name'") ||
      message.startsWith("json input must not include 'name'")
    ) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, exitCode: 2 };
    }

    if (
      message.startsWith("stdin payload must include at least one update field") ||
      message.startsWith("json input must include at least one update field") ||
      message.startsWith("Provide at least one update field for ")
    ) {
      return { code: MCP_USAGE_ERROR_CODES.missingUpdateFields, exitCode: 2 };
    }

    return { code: fallbackCode, exitCode: 2 };
  }

  function classifyCliUsageFailure(
    error: unknown,
    options: {
      usageFallbackCode: string;
      mutationFallbackCode: string;
      isUsageMessage: (message: string) => boolean;
    }
  ): {
    message: string;
    code: string;
    exitCode: number;
  } {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown CLI error");

    if (error instanceof CliUsageError) {
      return {
        message,
        code: error.code,
        exitCode: 2
      };
    }

    if (error instanceof CliMutationError) {
      return {
        message,
        code: error.code,
        exitCode: error.exitCode
      };
    }

    const classified = options.isUsageMessage(message)
      ? classifyUsageError(message, options.usageFallbackCode)
      : classifyMutationError(message, options.mutationFallbackCode);

    return {
      message,
      code: classified.code,
      exitCode: classified.exitCode
    };
  }

  function noUsageMessageMatch(_message: string): boolean {
    return false;
  }

  function mutateConfigDocument<T>(
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => T
  ): T {
    const sourcePath = deps.resolveCliConfigPath(configPath);
    return withConfigMutationLock(sourcePath, () => {
      const { sourceFile, document: configDocument } = deps.loadConfigJsonDocument(configPath);
      assertRuntimeConfigDoesNotOwnCatalogSections(configDocument, sourceFile);
      const catalog = loadCatalogForConfig(sourcePath);
      const effectiveDocument = composeConfigDocumentWithCatalog(configDocument, catalog, sourceFile);
      const result = mutator(effectiveDocument);
      const normalizedDocument = normalizeAndValidateConfigDocumentForMutation(effectiveDocument);
      const writeDocuments = splitEffectiveConfigDocumentForWrite(normalizedDocument, catalog);

      writeCatalogJsonDocumentIfChanged(catalog.sourcePath, writeDocuments.catalogDocument);
      writeConfigJsonDocumentIfChanged(sourcePath, writeDocuments.configDocument);
      return result;
    });
  }

  return {
    writeConfigJsonDocument,
    serializeConfigDocument,
    createConfigImportBackup,
    renderConfigImportDiff,
    getMutableConfigSection,
    normalizeAndValidateConfigDocumentForMutation,
    classifyMutationError,
    CliUsageError,
    CliMutationError,
    throwCliInvalidInputField,
    classifyCliUsageFailure,
    noUsageMessageMatch,
    mutateConfigDocument
  };
}
