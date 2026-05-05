import assert from "node:assert/strict";
import test from "node:test";

import { parseProviderSetKeyArgs, parseProvidersCreateArgs, parseProvidersUpdateArgs } from "./command-args-providers";
import { readLongFlagValue } from "./input-utils";

void test("parseProvidersCreateArgs accepts repeated long flags through the shared table-driven helper", () => {
  const parsed = parseProvidersCreateArgs(
    [
      "provider-id",
      "--config=./config.json",
      "--json-input",
      "./provider.json",
      "--endpoint=https://example.invalid/v1/messages",
      "--api-mode",
      "anthropic-messages",
      "--api-key-env",
      "SWITCHMAXXER_API_KEY",
      "--anthropic-version=2023-06-01",
      "--model-id-format",
      "provider"
    ],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: false,
    stdin: false,
    jsonInputPath: "./provider.json",
    apiKeyStdin: false,
    noAuth: false,
    allowPrivateEndpoints: false,
    allowInsecureHttp: false,
    name: "provider-id",
    endpoint: "https://example.invalid/v1/messages",
    apiMode: "anthropic-messages",
    apiKeyEnv: "SWITCHMAXXER_API_KEY",
    anthropicVersion: "2023-06-01",
    modelIdFormat: "provider"
  });
});

void test("parseProvidersCreateArgs preserves missing-value errors from the shared long-flag consumer", () => {
  const parsed = parseProvidersCreateArgs(["provider-id", "--api-mode"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    apiKeyStdin: false,
    noAuth: false,
    allowPrivateEndpoints: false,
    allowInsecureHttp: false,
    name: "provider-id",
    endpoint: undefined,
    apiMode: undefined,
    apiKeyEnv: undefined,
    anthropicVersion: undefined,
    modelIdFormat: undefined,
    errorMessage: "Flag '--api-mode' requires a value"
  });
});

void test("parseProviderSetKeyArgs still requires --api-key-stdin", () => {
  const parsed = parseProviderSetKeyArgs(["--json"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: true,
    apiKeyStdin: false,
    errorMessage: "Flag '--api-key-stdin' is required for 'providers set-key'"
  });
});

void test("parseProvidersUpdateArgs shares providers create parsing behavior", () => {
  const parsed = parseProvidersUpdateArgs(
    ["provider-id", "--allow-private-endpoints", "--api-mode=openai-completions"],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    apiKeyStdin: false,
    noAuth: false,
    allowPrivateEndpoints: true,
    allowInsecureHttp: false,
    name: "provider-id",
    endpoint: undefined,
    apiMode: "openai-completions",
    apiKeyEnv: undefined,
    anthropicVersion: undefined,
    modelIdFormat: undefined
  });
});
