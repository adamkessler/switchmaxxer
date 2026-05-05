import { statSync } from "node:fs";
import path from "node:path";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { configDocumentContainsInlineProviderApiKey } from "../config/config-file";
import { sanitizeConfigDocumentForDisplay } from "../config/read-model";

export function createConfigReadCommands(deps: {
  parseConfigCommandArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    errorMessage?: string;
  };
  parseConfigExportArgs: (argv: string[]) => {
    configPath?: string;
    json: boolean;
    outputPath?: string;
    includeSecrets: boolean;
    errorMessage?: string;
  };
  printUsageError: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
  writeJson: (value: unknown) => void;
  writeJsonSuccessEnvelope: (
    command: string,
    data: Record<string, unknown>,
    options?: { warnings?: Array<Record<string, unknown>> }
  ) => void;
  writeJsonErrorEnvelope: (
    command: string,
    code: AppErrorCode,
    message: string,
    options?: { warnings?: Array<Record<string, unknown>>; details?: Array<Record<string, unknown>> }
  ) => void;
  loadConfig: (configPath?: string) => {
    sourceFile: string;
    bindHost: string;
    routes: Record<string, unknown>;
  };
  loadCliReadModel: (configPath?: string) => {
    providers: Array<{
      name: string;
      auth_source: string;
      api_key_env: string | null;
    }>;
    routes: Array<{
      name: string;
      service_provider: string;
    }>;
  };
  getCliEnv: () => NodeJS.ProcessEnv;
  resolveCliConfigPath: (configPath?: string) => string;
  getCliCwd: () => string;
  loadConfigDocumentForDisplay: (configPath?: string) => {
    sourceFile: string;
    sourcePath: string;
    rawText: string;
  };
  buildCliConfigSchemaMetadata: () => Record<string, unknown>;
  mcpUsageErrorCodes: Record<string, string>;
  mcpEntityStateErrorCodes: Record<string, string>;
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  normalizeAndValidateConfigDocumentForMutation: (document: Record<string, unknown>) => Record<string, unknown>;
  writeConfigJsonDocument: (sourcePath: string, document: Record<string, unknown>) => void;
}) {
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

  function getConfigWarnings(configPath?: string): Array<{
    code: string;
    message: string;
    provider: string;
  }> {
    const readModel = deps.loadCliReadModel(configPath);

    return readModel.providers
      .filter((provider) => provider.auth_source === "inline override")
      .map((provider) => ({
        code: APP_ERROR_CODES.inlineApiKeyOverride,
        message: `Provider '${provider.name}' is using an inline api_key override that takes precedence over api_key_env.`,
        provider: provider.name
      }));
  }

  function getInlineApiKeyProviderNames(configPath?: string): string[] {
    return deps.loadCliReadModel(configPath)
      .providers
      .filter((provider) => provider.auth_source === "inline override")
      .map((provider) => provider.name);
  }

  function getWorldReadableConfigWarning(configPath?: string): string | null {
    const resolvedPath = deps.resolveCliConfigPath(configPath);
    const mode = statSync(resolvedPath).mode;
    const formattedMode = `0${(mode & 0o777).toString(8).padStart(3, "0")}`;

    if ((mode & 0o004) === 0) {
      return null;
    }

    return (
      `${resolvedPath} is world-readable (mode ${formattedMode}). ` +
      `Run: chmod 0600 ${resolvedPath}`
    );
  }

  function getConfigMissingEnvDetails(configPath?: string): Array<{
    code: string;
    message: string;
    provider: string;
    env_var: string;
    affected_routes: string[];
  }> {
    const readModel = deps.loadCliReadModel(configPath);

    return readModel.providers
      .filter(
        (provider) =>
          provider.auth_source === "env var" &&
          typeof provider.api_key_env === "string" &&
          provider.api_key_env.trim().length > 0 &&
          (!deps.getCliEnv()[provider.api_key_env] || deps.getCliEnv()[provider.api_key_env]?.trim().length === 0)
      )
      .map((provider) => {
        const affectedRoutes = readModel.routes
          .filter((route) => route.service_provider === provider.name)
          .map((route) => route.name);

        return {
          code: APP_ERROR_CODES.missingEnvVar,
          message: `Provider '${provider.name}' depends on missing environment variable '${provider.api_key_env}'.`,
          provider: provider.name,
          env_var: provider.api_key_env as string,
          affected_routes: affectedRoutes
        };
      });
  }

  function runConfigValidationCommand(
    argv: string[],
    options: {
      commandName: "config validate";
      successPrefix: string;
      failurePrefix: string;
    }
  ): number {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json } = parsedArgs;

    try {
      const config = deps.loadConfig(configPath);
      const warnings = getConfigWarnings(configPath);

      if (json) {
        deps.writeJsonSuccessEnvelope(
          options.commandName,
          {
            valid: true,
            source_file: config.sourceFile,
            bind_host: config.bindHost,
            route_count: Object.keys(config.routes).length
          },
          { warnings }
        );
        return 0;
      }

      const lines = [
        `${options.successPrefix}: ${config.sourceFile} (${Object.keys(config.routes).length} route(s))`,
        `Bind Host: ${config.bindHost}`
      ];

      if (warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const warning of warnings) {
          lines.push(`- ${warning.message}`);
        }
      }

      deps.writeStdout(lines.join("\n"));
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown validation error";
      const warnings = (() => {
        try {
          return getConfigWarnings(configPath);
        } catch {
          return [];
        }
      })();
      const missingEnvDetails = (() => {
        try {
          return getConfigMissingEnvDetails(configPath);
        } catch {
          return [];
        }
      })();

      if (json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.invalidConfig, message, {
          warnings,
          details: missingEnvDetails
        });
        return 1;
      }

      const lines = [`${options.failurePrefix}: ${message}`];

      if (missingEnvDetails.length > 0) {
        lines.push("");
        lines.push("Missing environment variables:");
        for (const detail of missingEnvDetails) {
          lines.push(`- Provider: ${detail.provider}`);
          lines.push(`  Env Var: ${detail.env_var}`);
          lines.push(
            `  Affected Routes: ${detail.affected_routes.length > 0 ? detail.affected_routes.join(", ") : "(none)"}`
          );
        }
      }

      if (warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const warning of warnings) {
          lines.push(`- ${warning.message}`);
        }
      }

      deps.writeStderr(lines.join("\n"));
      return 1;
    }
  }

  function runConfigValidate(argv: string[]): number {
    return runConfigValidationCommand(argv, {
      commandName: "config validate",
      successPrefix: "Config is valid",
      failurePrefix: "Config validation failed"
    });
  }

  function runConfigShow(argv: string[]): number {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json } = parsedArgs;

    try {
      const configData = deps.loadConfigDocumentForDisplay(configPath);

      if (json) {
        deps.writeJson(
          buildSuccessEnvelope("config show", {
            source_file: configData.sourceFile,
            source_path: configData.sourcePath,
            raw_text: configData.rawText
          })
        );
        return 0;
      }

      deps.writeStdout(configData.rawText);
      return 0;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Unknown read error";
      const sourcePath = configPath ? path.resolve(configPath) : path.join(deps.getCliCwd(), "config.json");
      const sourceLabel = toUserFacingPathLabel(sourcePath);
      const message = redactUserFacingPaths(rawMessage, [
        {
          absolutePath: sourcePath,
          displayLabel: sourceLabel
        }
      ]);

      if (json) {
        deps.writeJsonErrorEnvelope("config show", APP_ERROR_CODES.configReadError, `Unable to read config at '${sourceLabel}': ${message}`);
        return 1;
      }

      deps.writeStderr(`Config show failed: Unable to read config at '${sourceLabel}': ${message}`);
      return 1;
    }
  }

  function runConfigSchema(argv: string[]): number {
    const parsedArgs = deps.parseConfigCommandArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { json } = parsedArgs;
    const schema = deps.buildCliConfigSchemaMetadata();

    if (json) {
        deps.writeJson(buildSuccessEnvelope("config schema", schema));
        return 0;
    }

    deps.writeStdout(
      [
        "Config Schema",
        "",
        "Entities:",
        "  model: writable fields are display_name, model_creator, cost",
        "  provider: writable fields are endpoint, allow_private_endpoints, allow_insecure_http, api_mode, anthropic_version, model_id_format, api_key_env",
        "  route: writable fields are display_name, model, service_provider, provider_model_id, timeout_ms, cost",
        "",
        "Error Codes:",
        `  mutation_usage: ${Object.values(deps.mcpUsageErrorCodes).join(", ")}`,
        `  entity_state: ${Object.values(deps.mcpEntityStateErrorCodes).join(", ")}`,
        "",
        "Notes:",
        "  route.cost overrides model.cost when both are present",
        "  route.timeout_ms overrides top-level timeout_ms when present",
        "  cost flags must be provided as a complete set",
        "  structured input cannot be mixed with cost flags",
        "  provider inline api_key rotation uses providers set-key / providers clear-key rather than providers update"
      ].join("\n")
    );
    return 0;
  }

  function runConfigExport(argv: string[]): number {
    const parsedArgs = deps.parseConfigExportArgs(argv);

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const { configPath, json, outputPath, includeSecrets } = parsedArgs;

    if (includeSecrets && !outputPath) {
      deps.printUsageError("Flag '--include-secrets' requires '--output <path>' so secrets are not written to stdout.");
      return 2;
    }

    try {
      const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(configPath);
      const normalizedDocument = deps.normalizeAndValidateConfigDocumentForMutation(document);
      const hasInlineSecrets = configDocumentContainsInlineProviderApiKey(normalizedDocument);
      const exportedDocument = includeSecrets
        ? normalizedDocument
        : sanitizeConfigDocumentForDisplay(normalizedDocument);
      const exportMetadata = {
        secrets_included: includeSecrets,
        secrets_redacted: !includeSecrets && hasInlineSecrets,
        secret_bearing: includeSecrets && hasInlineSecrets
      };

      if (outputPath) {
        const resolvedOutputPath = path.resolve(outputPath);
        deps.writeConfigJsonDocument(resolvedOutputPath, exportedDocument);

        if (json) {
          deps.writeJsonSuccessEnvelope("config export", {
            source_file: sourceFile,
            source_path: sourcePath,
            output_path: resolvedOutputPath,
            exported: true,
            ...exportMetadata
          });
          return 0;
        }

        const secretNote = includeSecrets && hasInlineSecrets
          ? " (secret-bearing inline api_key values included)"
          : hasInlineSecrets
            ? " (inline api_key values redacted)"
            : "";
        deps.writeStdout(`Config exported: ${sourceFile} -> ${resolvedOutputPath}${secretNote}`);
        return 0;
      }

      if (json) {
        deps.writeJsonSuccessEnvelope("config export", {
          source_file: sourceFile,
          source_path: sourcePath,
          document: exportedDocument,
          ...exportMetadata
        });
        return 0;
      }

      deps.writeStdout(`${JSON.stringify(exportedDocument, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown config export error";

      if (json) {
        deps.writeJsonErrorEnvelope("config export", APP_ERROR_CODES.configExportError, message);
        return 1;
      }

      deps.writeStderr(`Config export failed: ${message}`);
      return 1;
    }
  }

  return {
    getInlineApiKeyProviderNames,
    getWorldReadableConfigWarning,
    runConfigValidate,
    runConfigShow,
    runConfigSchema,
    runConfigExport
  };
}
