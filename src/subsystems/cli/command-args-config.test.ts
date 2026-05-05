import assert from "node:assert/strict";
import test from "node:test";

import {
  parseConfigCommandArgs,
  parseConfigExportArgs,
  parseConfigImportArgs,
  parseConfigSetArgs
} from "./command-args-config";
import { readLongFlagValue } from "./input-utils";

void test("parseConfigCommandArgs accepts shared config path parsing", () => {
  const parsed = parseConfigCommandArgs(["--json", "--config=./config.json"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: true
  });
});

void test("parseConfigExportArgs accepts output path parsing through the shared helper", () => {
  const parsed = parseConfigExportArgs(
    ["--json", "--include-secrets", "--config", "./config.json", "--output=./export.json"],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: true,
    outputPath: "./export.json",
    includeSecrets: true
  });
});

void test("parseConfigImportArgs accepts mixed boolean and long path flags", () => {
  const parsed = parseConfigImportArgs(
    ["--json", "--dry-run", "--backup", "--stdin", "--json-input=./import.json", "--config", "./config.json"],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    configPath: "./config.json",
    json: true,
    stdin: true,
    jsonInputPath: "./import.json",
    dryRun: true,
    backup: true
  });
});

void test("parseConfigImportArgs preserves missing-value errors from shared path parsing", () => {
  const parsed = parseConfigImportArgs(["--json-input"], readLongFlagValue);

  assert.deepEqual(parsed, {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    dryRun: false,
    backup: false,
    errorMessage: "Flag '--json-input' requires a path value"
  });
});

void test("parseConfigSetArgs preserves positional argument handling with config flag parsing", () => {
  const parsed = parseConfigSetArgs(
    ["--json", "--config=./config.json", "max_payload_size", "123"],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    key: "max_payload_size",
    value: "123",
    configPath: "./config.json",
    json: true
  });
});

void test("parseConfigSetArgs reports unexpected extra positional arguments", () => {
  const parsed = parseConfigSetArgs(
    ["max_payload_size", "123", "extra"],
    readLongFlagValue
  );

  assert.deepEqual(parsed, {
    key: "max_payload_size",
    value: "123",
    configPath: undefined,
    json: false,
    errorMessage: "Unexpected argument 'extra'"
  });
});
