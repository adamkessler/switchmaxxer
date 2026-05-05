import assert from "node:assert/strict";
import test from "node:test";

import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { createConfigWriteCommands } from "./config-write-commands";

void test("config import rejects unknown keys returned after normalization before assignment", async () => {
  let mutateCalled = false;
  let jsonError: { command: string; code: AppErrorCode; message: string } | null = null;
  const commands = createConfigWriteCommands({
    parseConfigImportArgs: () => ({
      configPath: "/tmp/switchmaxxer-config-import-guard-test.json",
      json: true,
      stdin: true,
      dryRun: false,
      backup: false
    }),
    parseConfigSetArgs: () => ({
      json: false,
      errorMessage: "unused"
    }),
    resolveStructuredInputMode: () => "stdin",
    assertStructuredInputPresent: () => undefined,
    classifyCliUsageFailure: (error, options) => ({
      message: error instanceof Error ? error.message : "Unknown error",
      code: options.mutationFallbackCode,
      exitCode: 1
    }),
    noUsageMessageMatch: () => false,
    createCliUsageError: (code, message) => Object.assign(new Error(message), { code }),
    throwCliInvalidInputField: (message): never => {
      throw new Error(message);
    },
    readCliStdin: async () => "{}",
    readTextFileWithinCliLimit: () => "{}",
    readJsonObjectFromString: () => ({}),
    loadConfigJsonDocument: () => ({
      document: {}
    }),
    normalizeAndValidateConfigDocumentForMutation: () => ({
      config_version: 1,
      unexpected_post_normalization_key: true
    }),
    serializeConfigDocument: (document) => `${JSON.stringify(document)}\n`,
    renderConfigImportDiff: () => "",
    createConfigImportBackup: () => null,
    writeConfigJsonDocument: () => undefined,
    mutateConfigDocument: () => {
      mutateCalled = true;
      throw new Error("mutateConfigDocument should not be called");
    },
    resolveCliConfigPath: () => "/tmp/switchmaxxer-config-import-guard-test.json",
    getCliCwd: () => "/tmp",
    printUsageError: () => undefined,
    writeJson: () => undefined,
    writeJsonSuccessEnvelope: () => undefined,
    writeJsonErrorEnvelope: (command, code, message) => {
      jsonError = { command, code, message };
    },
    writeStdout: () => undefined,
    writeStderr: () => undefined,
    mcpUsageErrorCodes: {
      missingRequiredField: "missing_required_field",
      invalidInputField: "invalid_input_field"
    }
  });

  const exitCode = await commands.runConfigImport([]);

  assert.equal(exitCode, 1);
  assert.equal(mutateCalled, false);
  assert.deepEqual(jsonError, {
    command: "config import",
    code: APP_ERROR_CODES.configImportError,
    message: "normalized config import document contains unsupported field 'unexpected_post_normalization_key'."
  });
});
