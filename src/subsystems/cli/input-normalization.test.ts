import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createCliInputNormalization } from "./input-normalization";
import {
  assertSafeCliConfigIdentifier,
  MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES,
  normalizeCliCostConfig,
  readJsonObjectFromString,
  readTextFileWithinCliLimit
} from "./input-utils";
import { assertSafeObjectKey } from "../../platform/object-key-policy";
import { isNonEmptyString } from "../../platform/type-guards";
import { normalizeApiMode, normalizeModelIdFormat } from "../../platform/types";

const CODES = {
  conflictingStructuredInput: "conflicting_structured_input",
  missingRequiredField: "missing_required_field",
  conflictingInputModes: "conflicting_input_modes",
  missingUpdateFields: "missing_update_fields",
  unsupportedClearCost: "unsupported_clear_cost",
  invalidInputField: "invalid_input_field",
  invalidFlagValue: "invalid_flag_value",
  conflictingCostFlags: "conflicting_cost_flags",
  incompleteCostFlags: "incomplete_cost_flags"
};

type CliTestError = Error & {
  code: string;
};

function createCliError(code: string, message: string): CliTestError {
  return Object.assign(new Error(message), { code });
}

function throwCliInvalidInputField(message: string): never {
  throw createCliError(CODES.invalidInputField, message);
}

function createNormalization(stdinText = "") {
  return createCliInputNormalization({
    readCliStdinSync: (options = {}) =>
      options.trimTrailingNewlines ? stdinText.replace(/[\r\n]+$/, "") : stdinText,
    readTextFileWithinCliLimit,
    readJsonObjectFromString: (rawText, sourceName, options) =>
      readJsonObjectFromString({ throwCliInvalidInputField }, rawText, sourceName, options),
    isNonEmptyCliString: isNonEmptyString,
    assertSafeCliConfigIdentifier: (value, label) =>
      assertSafeCliConfigIdentifier({ assertSafeObjectKey, throwCliInvalidInputField }, value, label),
    normalizeCliCostConfig: (value, fieldName, options) =>
      normalizeCliCostConfig({ throwCliInvalidInputField }, value, fieldName, options),
    normalizeApiMode,
    normalizeModelIdFormat,
    throwCliInvalidInputField,
    createCliUsageError: createCliError,
    mcpUsageErrorCodes: CODES
  });
}

function assertThrowsCode(fn: () => unknown, code: string, messagePattern: RegExp): void {
  assert.throws(
    fn,
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Partial<CliTestError>).code, code);
      assert.match(error.message, messagePattern);
      return true;
    }
  );
}

void test("CLI model normalizer maps positional create fields and complete cost flags", () => {
  const result = createNormalization().normalizeModelCreateInput({
    stdin: false,
    name: "gpt-4o",
    displayName: "GPT-4o",
    modelCreator: "openai",
    costInput: 1,
    costOutput: 2,
    costCacheRead: 0.25,
    costCacheWrite: 0.5
  });

  assert.deepEqual(result, {
    name: "gpt-4o",
    display_name: "GPT-4o",
    model_creator: "openai",
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0.25,
      cacheWrite: 0.5
    }
  });
});

void test("CLI model normalizer accepts structured update cost clearing", () => {
  const result = createNormalization(JSON.stringify({
    display_name: "GPT-4o current",
    cost: null
  })).normalizeModelUpdateInput({
    stdin: true,
    name: "gpt-4o"
  });

  assert.deepEqual(result, {
    name: "gpt-4o",
    display_name: "GPT-4o current",
    cost: null
  });
});

void test("CLI structured stdin JSON enforces repository JSON bounds before entity normalization", () => {
  let deepJson = "null";
  for (let index = 0; index < 257; index += 1) {
    deepJson = `{"child":${deepJson}}`;
  }

  assertThrowsCode(
    () =>
      createNormalization(deepJson).normalizeModelUpdateInput({
        stdin: true,
        name: "gpt-4o"
      }),
    CODES.invalidInputField,
    /json_structure_too_large/
  );
});

void test("CLI structured stdin JSON enforces the per-entity byte cap", () => {
  const oversizedJson = JSON.stringify({
    display_name: "x".repeat(MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES)
  });

  assertThrowsCode(
    () =>
      createNormalization(oversizedJson).normalizeModelUpdateInput({
        stdin: true,
        name: "gpt-4o"
      }),
    CODES.invalidInputField,
    /json_serialized_too_large/
  );
});

void test("CLI structured json-input files are rejected before reading oversized entity payloads", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-cli-structured-input-"));
  const inputPath = path.join(tempDir, "model-update.json");

  try {
    writeFileSync(inputPath, JSON.stringify({
      display_name: "x".repeat(MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES)
    }));

    assertThrowsCode(
      () =>
        createNormalization().normalizeModelUpdateInput({
          stdin: false,
          jsonInputPath: inputPath,
          name: "gpt-4o"
        }),
      CODES.invalidInputField,
      /exceeds the maximum supported size of 64 KiB/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("CLI model normalizer rejects incomplete cost flag sets", () => {
  assertThrowsCode(
    () =>
      createNormalization().normalizeModelCreateInput({
        stdin: false,
        name: "gpt-4o",
        displayName: "GPT-4o",
        modelCreator: "openai",
        costInput: 1
      }),
    CODES.incompleteCostFlags,
    /Cost flags must be provided as a complete set/
  );
});

void test("CLI provider normalizer reads API keys from stdin and normalizes API mode aliases", () => {
  const result = createNormalization("sk-test-value\n").normalizeProviderCreateInput({
    stdin: false,
    apiKeyStdin: true,
    noAuth: false,
    allowPrivateEndpoints: true,
    allowInsecureHttp: false,
    name: "openai",
    endpoint: "https://api.openai.com/v1",
    apiMode: "openai",
    modelIdFormat: "creator-model"
  });

  assert.deepEqual(result, {
    name: "openai",
    endpoint: "https://api.openai.com/v1",
    allow_private_endpoints: true,
    api_mode: "openai-completions",
    api_key: "sk-test-value",
    model_id_format: "creator/model"
  });
});

void test("CLI provider normalizer accepts structured create auth and boolean fields", () => {
  const result = createNormalization(JSON.stringify({
    name: "anthropic",
    endpoint: "https://api.anthropic.com",
    allow_insecure_http: true,
    api_mode: "anthropic",
    api_key_env: "ANTHROPIC_API_KEY",
    anthropic_version: null,
    model_id_format: "passthrough"
  })).normalizeProviderCreateInput({
    stdin: true,
    apiKeyStdin: false,
    noAuth: false,
    allowPrivateEndpoints: false,
    allowInsecureHttp: false
  });

  assert.deepEqual(result, {
    name: "anthropic",
    endpoint: "https://api.anthropic.com",
    allow_insecure_http: true,
    api_mode: "anthropic-messages",
    api_key_env: "ANTHROPIC_API_KEY",
    anthropic_version: null,
    model_id_format: "passthrough"
  });
});

void test("CLI provider normalizer rejects API key stdin for update", () => {
  assertThrowsCode(
    () =>
      createNormalization().normalizeProviderUpdateInput({
        stdin: false,
        apiKeyStdin: true,
        noAuth: false,
        allowPrivateEndpoints: false,
        allowInsecureHttp: false,
        name: "openai"
      }),
    CODES.invalidInputField,
    /not supported by 'providers update'/
  );
});

void test("CLI provider normalizer rejects structured input mixed with flag-sugar fields", () => {
  assertThrowsCode(
    () =>
      createNormalization("{}").normalizeProviderCreateInput({
        stdin: true,
        apiKeyStdin: false,
        noAuth: false,
        allowPrivateEndpoints: false,
        allowInsecureHttp: false,
        name: "openai"
      }),
    CODES.conflictingInputModes,
    /Do not mix '--stdin' or '--json-input'/
  );
});

void test("CLI route normalizer maps positional create fields, timeout, and cost flags", () => {
  const result = createNormalization().normalizeRouteCreateInput({
    json: false,
    stdin: false,
    name: "default",
    model: "gpt-4o",
    serviceProvider: "openai",
    providerModelId: "gpt-4o-2024-08-06",
    displayName: "Default chat",
    timeoutMs: 30000,
    costInput: 1,
    costOutput: 2,
    costCacheRead: 0.25,
    costCacheWrite: 0.5
  });

  assert.deepEqual(result, {
    name: "default",
    model: "gpt-4o",
    service_provider: "openai",
    provider_model_id: "gpt-4o-2024-08-06",
    display_name: "Default chat",
    timeout_ms: 30000,
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0.25,
      cacheWrite: 0.5
    }
  });
});

void test("CLI route normalizer maps clear flags to nullable update fields", () => {
  const result = createNormalization().normalizeRouteUpdateInput({
    json: false,
    stdin: false,
    name: "default",
    clearTimeoutMs: true,
    clearCost: true
  });

  assert.deepEqual(result, {
    name: "default",
    timeout_ms: null,
    cost: null
  });
});

void test("CLI route normalizer rejects create-only clear timeout flag", () => {
  assertThrowsCode(
    () =>
      createNormalization().normalizeRouteCreateInput({
        json: false,
        stdin: false,
        name: "default",
        model: "gpt-4o",
        serviceProvider: "openai",
        providerModelId: "gpt-4o",
        displayName: "Default chat",
        clearTimeoutMs: true
      }),
    CODES.invalidInputField,
    /clear-timeout-ms/
  );
});

void test("CLI route normalizer rejects unknown structured fields", () => {
  assertThrowsCode(
    () =>
      createNormalization(JSON.stringify({
        model: "gpt-4o",
        unsupported: true
      })).normalizeRouteUpdateInput({
        json: false,
        stdin: true,
        name: "default"
      }),
    CODES.invalidInputField,
    /does not support field 'unsupported'/
  );
});
