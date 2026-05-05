import { readFileSync, statSync } from "node:fs";

import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";
import type { CostConfig } from "../../platform/types";

export const MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES = 64 * 1024;

export type CliTextReadOptions = {
  maxBytes?: number;
  logicalName?: string;
};

export type CliStdinReader = {
  isTTY: boolean;
  readAllSync: (options?: CliTextReadOptions) => string;
  readAll: (options?: CliTextReadOptions) => Promise<string>;
};

export type CliInputUtilsDeps = {
  getCliIo: () => {
    stdin: CliStdinReader;
  };
  writeStderr: (message: string) => void;
  assertSafeObjectKey: (value: string, label: string) => void;
  throwCliInvalidInputField: (message: string) => never;
};

function formatByteLimit(maxBytes: number): string {
  if (maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024)} MB`;
  }

  if (maxBytes >= 1024 && maxBytes % 1024 === 0) {
    return `${maxBytes / 1024} KiB`;
  }

  return `${maxBytes} bytes`;
}

function buildTooLargeMessage(logicalName: string, maxBytes: number): string {
  return `${logicalName} exceeds the maximum supported size of ${formatByteLimit(maxBytes)}.`;
}

function writeInteractiveStdinHint(deps: CliInputUtilsDeps): void {
  if (deps.getCliIo().stdin.isTTY) {
    deps.writeStderr("Reading from stdin... (Ctrl-D to send, Ctrl-C to cancel)");
  }
}

function isNonNegativeCliNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readCliStdinSync(
  deps: CliInputUtilsDeps,
  options: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string } = {}
): string {
  writeInteractiveStdinHint(deps);
  const rawText = deps.getCliIo().stdin.readAllSync({
    maxBytes: options.maxBytes,
    logicalName: options.logicalName
  });
  return options.trimTrailingNewlines ? rawText.replace(/[\r\n]+$/, "") : rawText;
}

export async function readCliStdin(deps: CliInputUtilsDeps, options: CliTextReadOptions = {}): Promise<string> {
  writeInteractiveStdinHint(deps);
  return await deps.getCliIo().stdin.readAll(options);
}

export function readTextFileWithinCliLimit(sourcePath: string, options: CliTextReadOptions = {}): string {
  const maxBytes = options.maxBytes;
  const logicalName = options.logicalName ?? sourcePath;

  if (typeof maxBytes === "number") {
    let sizeBytes: number;

    try {
      sizeBytes = statSync(sourcePath).size;
    } catch (error) {
      throw new Error(`Unable to read ${logicalName} at '${sourcePath}': ${(error as Error).message}`);
    }

    if (sizeBytes > maxBytes) {
      throw new Error(buildTooLargeMessage(logicalName, maxBytes));
    }
  }

  try {
    return readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${logicalName} at '${sourcePath}': ${(error as Error).message}`);
  }
}

export function readJsonObjectFromString(
  deps: Pick<CliInputUtilsDeps, "throwCliInvalidInputField">,
  rawText: string,
  sourceName: string,
  options: { maxSerializedBytes?: number } = {}
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = parseJsonWithinBounds(rawText, {
      maxSerializedBytes: options.maxSerializedBytes
    });
  } catch (error) {
    deps.throwCliInvalidInputField(`${sourceName} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    deps.throwCliInvalidInputField(`${sourceName} must contain a JSON object.`);
  }

  return parsed;
}

export function assertSafeCliConfigIdentifier(
  deps: Pick<CliInputUtilsDeps, "assertSafeObjectKey" | "throwCliInvalidInputField">,
  value: string,
  label: string
): void {
  try {
    deps.assertSafeObjectKey(value, label);
  } catch (error) {
    deps.throwCliInvalidInputField((error as Error).message);
  }
}

export function normalizeCliCostConfig(
  deps: Pick<CliInputUtilsDeps, "throwCliInvalidInputField">,
  value: unknown,
  fieldName: string,
  options: { allowNull: boolean }
): CostConfig | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    if (options.allowNull) {
      return null;
    }

    deps.throwCliInvalidInputField(`${fieldName} must be an object with numeric pricing fields`);
  }

  if (!isRecord(value)) {
    deps.throwCliInvalidInputField(`${fieldName} must be an object with numeric pricing fields`);
  }

  const allowedCostFields = ["input", "output", "cache_read", "cache_write"];
  for (const field of Object.keys(value)) {
    if (!allowedCostFields.includes(field)) {
      deps.throwCliInvalidInputField(`${fieldName} does not support field '${field}'`);
    }
  }

  if (!isNonNegativeCliNumber(value["input"])) {
    deps.throwCliInvalidInputField(`${fieldName}.input must be a non-negative number`);
  }

  if (!isNonNegativeCliNumber(value["output"])) {
    deps.throwCliInvalidInputField(`${fieldName}.output must be a non-negative number`);
  }

  if (!isNonNegativeCliNumber(value["cache_read"])) {
    deps.throwCliInvalidInputField(`${fieldName}.cache_read must be a non-negative number`);
  }

  if (!isNonNegativeCliNumber(value["cache_write"])) {
    deps.throwCliInvalidInputField(`${fieldName}.cache_write must be a non-negative number`);
  }

  return {
    input: value["input"],
    output: value["output"],
    cacheRead: value["cache_read"],
    cacheWrite: value["cache_write"]
  };
}

export function formatCostConfig(cost: CostConfig | null | undefined): string {
  if (!cost) {
    return "(none)";
  }

  return `input=${cost.input} output=${cost.output} cacheRead=${cost.cacheRead} cacheWrite=${cost.cacheWrite}`;
}

export function readLongFlagValue(
  argv: string[],
  index: number,
  flagName: string,
  missingValueMessage = `Flag '${flagName}' requires a value`
): { consumed: number; value?: string; errorMessage?: string } | null {
  const arg = argv[index];
  if (typeof arg === "undefined") {
    return null;
  }

  if (arg === flagName) {
    const nextArg = argv[index + 1];
    if (typeof nextArg === "undefined") {
      return { consumed: 0, errorMessage: missingValueMessage };
    }

    return { consumed: 1, value: nextArg };
  }

  if (arg.startsWith(`${flagName}=`)) {
    const value = arg.slice(flagName.length + 1);
    if (value.length === 0) {
      return { consumed: 0, errorMessage: missingValueMessage };
    }

    return { consumed: 0, value };
  }

  return null;
}
