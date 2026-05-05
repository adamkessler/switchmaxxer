import { existsSync } from "node:fs";
import path from "node:path";
import { buildSanitizedErrorEnvelope, buildSuccessEnvelope } from "../../platform/response-envelope";
import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { MASKED_SECRET_SENTINEL } from "../../platform/masked-secret";
import { parseCanonicalPositiveInteger } from "../../platform/number-parsing";
import { isRecord } from "../../platform/type-guards";
import { resolveCatalogPathForConfig } from "../config/catalog";
import { resolveConfigBackupPath } from "../config/config-file";
import { assertOnlyKnownConfigDocumentKeys } from "../config/config-validation";
import { MAX_CONFIG_FILE_BYTES } from "../config/config-read";
import { sanitizeConfigDocumentForDisplay } from "../config/read-model";
import type { CliTextReadOptions } from "./input-utils";

type StructuredInputMode = "none" | "stdin" | "json-input";
type ParsedConfigDiffInput = {
  document: Record<string, unknown> | null;
  displayText: string;
};

const RAW_API_KEY_JSON_FIELD_PATTERN = /("api_key"\s*:\s*)"((?:\\.|[^"\\])*)"/g;

function redactInlineApiKeyFieldsInRawJsonText(rawText: string): string {
  return rawText.replace(RAW_API_KEY_JSON_FIELD_PATTERN, `$1"${MASKED_SECRET_SENTINEL}"`);
}

function sanitizeProviderNameForDiff(providerName: string): string {
  return providerName.replace(/[^\x20-\x7e]/g, "?").slice(0, 128);
}

function getInlineProviderApiKey(document: Record<string, unknown>, providerName: string): string | null {
  const providers = document["service_providers"];

  if (!isRecord(providers)) {
    return null;
  }

  const provider = providers[providerName];

  if (!isRecord(provider)) {
    return null;
  }

  const apiKey = provider["api_key"];
  return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey : null;
}

function getConfigProviderNames(document: Record<string, unknown>): string[] {
  const providers = document["service_providers"];
  return isRecord(providers) ? Object.keys(providers) : [];
}

function assertSafeConfigImportAssignmentDocument(document: Record<string, unknown>): void {
  assertOnlyKnownConfigDocumentKeys(document, "normalized config import document");
}

function describeInlineApiKeyChanges(
  currentDocument: Record<string, unknown>,
  nextDocument: Record<string, unknown>
): string[] {
  const providerNames = Array.from(new Set([
    ...getConfigProviderNames(currentDocument),
    ...getConfigProviderNames(nextDocument)
  ])).sort();
  const descriptions: string[] = [];

  for (const providerName of providerNames) {
    const currentApiKey = getInlineProviderApiKey(currentDocument, providerName);
    const nextApiKey = getInlineProviderApiKey(nextDocument, providerName);

    if (currentApiKey === null && nextApiKey === null) {
      continue;
    }

    const displayName = sanitizeProviderNameForDiff(providerName);

    if (currentApiKey === null) {
      descriptions.push(`provider '${displayName}' inline api_key added`);
    } else if (nextApiKey === null) {
      descriptions.push(`provider '${displayName}' inline api_key removed`);
    } else if (currentApiKey !== nextApiKey) {
      descriptions.push(`provider '${displayName}' inline api_key changed`);
    }
  }

  return descriptions;
}

export function createConfigWriteCommands(deps: {
  parseConfigImportArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    stdin: boolean;
    jsonInputPath?: string;
    dryRun: boolean;
    backup: boolean;
    errorMessage?: string;
  };
  parseConfigSetArgs: (argv: string[]) => {
    key?: string;
    value?: string;
    configPath?: string;
    json: boolean;
    errorMessage?: string;
  };
  resolveStructuredInputMode: (
    commandName: string,
    options: { stdin: boolean; jsonInputPath?: string }
  ) => StructuredInputMode;
  assertStructuredInputPresent: (
    commandName: string,
    mode: StructuredInputMode,
    targetDescription: string
  ) => void;
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
  noUsageMessageMatch: (message: string) => boolean;
  createCliUsageError: (code: string, message: string) => Error;
  throwCliInvalidInputField: (message: string) => never;
  readCliStdin: (options?: CliTextReadOptions) => Promise<string>;
  readTextFileWithinCliLimit: (sourcePath: string, options?: CliTextReadOptions) => string;
  readJsonObjectFromString: (
    rawText: string,
    sourceName: string,
    options?: { maxSerializedBytes?: number }
  ) => Record<string, unknown>;
  loadConfigJsonDocument: (configPath?: string) => {
    document: Record<string, unknown>;
  };
  normalizeAndValidateConfigDocumentForMutation: (document: Record<string, unknown>) => Record<string, unknown>;
  serializeConfigDocument: (document: Record<string, unknown>) => string;
  renderConfigImportDiff: (currentText: string, nextText: string) => string;
  createConfigImportBackup: (targetPath: string) => string | null;
  writeConfigJsonDocument: (sourcePath: string, document: Record<string, unknown>) => void;
  mutateConfigDocument: <T>(
    configPath: string | undefined,
    mutator: (document: Record<string, unknown>) => T
  ) => T;
  resolveCliConfigPath: (configPath?: string) => string;
  getCliCwd: () => string;
  printUsageError: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonSuccessEnvelope: (command: string, data: Record<string, unknown>) => void;
  writeJsonErrorEnvelope: (command: string, code: AppErrorCode, message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  mcpUsageErrorCodes: {
    missingRequiredField: string;
    invalidInputField: string;
  };
}): {
  runConfigImport: (argv: string[]) => Promise<number>;
  runConfigSet: (argv: string[]) => Promise<number>;
} {
  function toUserFacingPathLabel(candidatePath: string): string {
    const baseName = path.basename(candidatePath);
    return baseName.length > 0 ? baseName : candidatePath;
  }

  function redactUserFacingPaths(message: string, pathMappings: Array<{ absolutePath: string; displayLabel: string }>): string {
    let next = message;

    for (const mapping of pathMappings) {
      next = next.split(mapping.absolutePath).join(mapping.displayLabel);
    }

    return next;
  }

  function serializeConfigDocumentForDiffDisplay(document: Record<string, unknown>): string {
    return deps.serializeConfigDocument(sanitizeConfigDocumentForDisplay(document));
  }

  function parseConfigTextForDiffDisplay(rawText: string): ParsedConfigDiffInput {
    if (rawText.length === 0) {
      return {
        document: null,
        displayText: ""
      };
    }

    try {
      const parsed = parseJsonWithinBounds(rawText, {
        maxSerializedBytes: MAX_CONFIG_FILE_BYTES
      });

      if (!isRecord(parsed)) {
        return {
          document: null,
          displayText: redactInlineApiKeyFieldsInRawJsonText(rawText)
        };
      }

      return {
        document: parsed,
        displayText: serializeConfigDocumentForDiffDisplay(parsed)
      };
    } catch {
      return {
        document: null,
        displayText: redactInlineApiKeyFieldsInRawJsonText(rawText)
      };
    }
  }

  function renderRedactedConfigImportDiff(options: {
    currentText: string;
    nextDocument: Record<string, unknown>;
    changed: boolean;
  }): string {
    const current = parseConfigTextForDiffDisplay(options.currentText);
    const nextDisplayText = serializeConfigDocumentForDiffDisplay(options.nextDocument);
    const secretChangeDescriptions = current.document === null
      ? []
      : describeInlineApiKeyChanges(current.document, options.nextDocument);
    let diffText = deps.renderConfigImportDiff(current.displayText, nextDisplayText);

    if (diffText === "No config changes.\n") {
      diffText = secretChangeDescriptions.length > 0
        ? "No non-secret config changes after redacting inline api_key values.\n"
        : options.changed
          ? "No displayable config changes after redacting inline api_key values; import would still rewrite config text.\n"
          : diffText;
    }

    if (secretChangeDescriptions.length === 0) {
      return diffText;
    }

    return [
      diffText.trimEnd(),
      "",
      "# Redacted inline api_key changes:",
      ...secretChangeDescriptions.map((description) => `# - ${description}`)
    ].join("\n") + "\n";
  }

  async function runConfigImport(argv: string[]): Promise<number> {
    const parsedArgs = deps.parseConfigImportArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    let structuredInputMode: StructuredInputMode;
    try {
      structuredInputMode = deps.resolveStructuredInputMode("config import", parsedArgs);
      deps.assertStructuredInputPresent("config import", structuredInputMode, "config input");
    } catch (error) {
      const classified = deps.classifyCliUsageFailure(error, {
        usageFallbackCode: APP_ERROR_CODES.configImportError,
        mutationFallbackCode: APP_ERROR_CODES.configImportError,
        isUsageMessage: deps.noUsageMessageMatch
      });

      if (parsedArgs.json) {
        deps.writeJson(buildSanitizedErrorEnvelope("config import", classified.code as AppErrorCode, classified.message));
        return classified.exitCode;
      }

      deps.printUsageError(classified.message);
      return classified.exitCode;
    }

    const targetPath = parsedArgs.configPath
      ? path.resolve(parsedArgs.configPath)
      : path.join(deps.getCliCwd(), "config.json");
    const catalogPath = resolveCatalogPathForConfig(targetPath);

    try {
      const sourceName = structuredInputMode === "stdin" ? "stdin" : path.resolve(parsedArgs.jsonInputPath as string);
      let rawText: string;

      try {
        rawText =
          structuredInputMode === "stdin"
            ? await deps.readCliStdin({
                maxBytes: MAX_CONFIG_FILE_BYTES,
                logicalName: sourceName
              })
            : deps.readTextFileWithinCliLimit(path.resolve(parsedArgs.jsonInputPath as string), {
                maxBytes: MAX_CONFIG_FILE_BYTES,
                logicalName: sourceName
              });
      } catch (error) {
        deps.throwCliInvalidInputField(error instanceof Error ? error.message : `Unable to read ${sourceName}`);
      }

      const document = deps.readJsonObjectFromString(rawText, sourceName, {
        maxSerializedBytes: MAX_CONFIG_FILE_BYTES
      });
      const normalizedDocument = deps.normalizeAndValidateConfigDocumentForMutation(document);
      assertSafeConfigImportAssignmentDocument(normalizedDocument);
      const importedText = deps.serializeConfigDocument(normalizedDocument);
      const targetExists = existsSync(targetPath);
      const currentText = targetExists
        ? deps.serializeConfigDocument(deps.loadConfigJsonDocument(targetPath).document)
        : "";
      const changed = !targetExists || currentText !== importedText;
      const diffText = renderRedactedConfigImportDiff({
        currentText,
        nextDocument: normalizedDocument,
        changed
      });
      let backupPath: string | null = parsedArgs.backup && existsSync(targetPath) ? resolveConfigBackupPath(targetPath) : null;
      let catalogBackupPath: string | null = parsedArgs.backup && existsSync(catalogPath) ? resolveConfigBackupPath(catalogPath) : null;

      const routes = normalizedDocument["routes"];
      const routeCount = isRecord(routes) ? Object.keys(routes).length : 0;

      if (!parsedArgs.dryRun) {
        if (parsedArgs.backup) {
          backupPath = deps.createConfigImportBackup(targetPath);
          catalogBackupPath = deps.createConfigImportBackup(catalogPath);
        }

        deps.mutateConfigDocument(parsedArgs.configPath, (document) => {
          assertSafeConfigImportAssignmentDocument(normalizedDocument);

          for (const key of Object.keys(document)) {
            delete document[key];
          }

          Object.assign(document, structuredClone(normalizedDocument));
        });
      }

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope("config import", {
          source: sourceName,
          target_path: targetPath,
          route_count: routeCount,
          imported: !parsedArgs.dryRun,
          dry_run: parsedArgs.dryRun,
          changed,
          backup_requested: parsedArgs.backup,
          backup_path: backupPath,
          catalog_backup_path: catalogBackupPath,
          diff: diffText
        });
        return 0;
      }

      if (parsedArgs.dryRun) {
        deps.writeStdout(
          [
            `Config import dry-run: ${sourceName} -> ${targetPath} (${routeCount} route(s))`,
            parsedArgs.backup && backupPath ? `Backup would be written to: ${backupPath}` : null,
            parsedArgs.backup && catalogBackupPath ? `Catalog backup would be written to: ${catalogBackupPath}` : null,
            "",
            diffText.trimEnd()
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n") + "\n"
        );
        return 0;
      }

      deps.writeStdout(
        [
          `Config imported: ${sourceName} -> ${targetPath} (${routeCount} route(s))`,
          parsedArgs.backup && backupPath ? `Backup written: ${backupPath}` : null,
          parsedArgs.backup && catalogBackupPath ? `Catalog backup written: ${catalogBackupPath}` : null
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      );
      return 0;
    } catch (error) {
      const sourcePath = structuredInputMode === "json-input" && parsedArgs.jsonInputPath
        ? path.resolve(parsedArgs.jsonInputPath)
        : null;
      const pathMappings = [
        ...(sourcePath
          ? [{
              absolutePath: sourcePath,
              displayLabel: toUserFacingPathLabel(sourcePath)
            }]
          : []),
        {
          absolutePath: targetPath,
          displayLabel: toUserFacingPathLabel(targetPath)
        }
      ];
      const classified = deps.classifyCliUsageFailure(error, {
        usageFallbackCode: APP_ERROR_CODES.configImportError,
        mutationFallbackCode: APP_ERROR_CODES.configImportError,
        isUsageMessage: deps.noUsageMessageMatch
      });
      const message = redactUserFacingPaths(classified.message, pathMappings);

      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope("config import", classified.code as AppErrorCode, message);
        return classified.exitCode;
      }

      if (classified.exitCode === 2) {
        deps.printUsageError(message);
        return 2;
      }

      deps.writeStderr(`Config import failed: ${message}`);
      return classified.exitCode;
    }
  }

  async function runConfigSet(argv: string[]): Promise<number> {
    const parsedArgs = deps.parseConfigSetArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { key, value, configPath, json } = parsedArgs;

    try {
      if (!key) {
        throw deps.createCliUsageError(
          deps.mcpUsageErrorCodes.missingRequiredField,
          "Missing required argument '<key>' for 'config set'"
        );
      }

      if (!value) {
        throw deps.createCliUsageError(
          deps.mcpUsageErrorCodes.missingRequiredField,
          "Missing required argument '<value>' for 'config set'"
        );
      }

      if (key !== "max_payload_size") {
        throw deps.createCliUsageError(
          deps.mcpUsageErrorCodes.invalidInputField,
          `Unknown config key '${key}' for 'config set'`
        );
      }

      const parsedValue = parseCanonicalPositiveInteger(value);

      if (parsedValue === null) {
        throw deps.createCliUsageError(
          deps.mcpUsageErrorCodes.invalidInputField,
          "Value for 'max_payload_size' must be a positive integer number of bytes"
        );
      }

      deps.mutateConfigDocument(configPath, (document) => {
        document["max_payload_size"] = parsedValue;
      });

      const sourcePath = deps.resolveCliConfigPath(configPath);
      const sourceFile = path.basename(sourcePath);

      if (json) {
        deps.writeJson(
          buildSuccessEnvelope("config set", {
            key: "max_payload_size",
            value: parsedValue,
            source_file: sourceFile,
            source_path: sourcePath
          })
        );
        return 0;
      }

      deps.writeStdout(`Config updated: max_payload_size=${parsedValue} (${sourceFile})`);
      return 0;
    } catch (error) {
      const classified = deps.classifyCliUsageFailure(error, {
        usageFallbackCode: APP_ERROR_CODES.configSetError,
        mutationFallbackCode: APP_ERROR_CODES.configSetError,
        isUsageMessage: deps.noUsageMessageMatch
      });

      if (json) {
        deps.writeJson(buildSanitizedErrorEnvelope("config set", classified.code as AppErrorCode, classified.message));
        return classified.exitCode;
      }

      if (classified.exitCode === 2) {
        deps.printUsageError(classified.message);
        return 2;
      }

      deps.writeStderr(`Config set failed: ${classified.message}`);
      return classified.exitCode;
    }
  }

  return {
    runConfigImport,
    runConfigSet
  };
}
