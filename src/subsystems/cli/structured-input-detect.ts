import path from "node:path";
import { MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES, type CliTextReadOptions } from "./input-utils";

export type StructuredInputMode = "none" | "stdin" | "json-input";

export function loadStructuredInputPayload(
  mode: StructuredInputMode,
  options: {
    jsonInputPath?: string;
    maxBytes?: number;
  },
  deps: {
    readCliStdinSync: (options?: { trimTrailingNewlines?: boolean; maxBytes?: number; logicalName?: string }) => string;
    readTextFileWithinCliLimit: (sourcePath: string, options?: CliTextReadOptions) => string;
    readJsonObjectFromString: (
      rawText: string,
      sourceName: string,
      options?: { maxSerializedBytes?: number }
    ) => Record<string, unknown>;
    throwCliInvalidInputField: (message: string) => never;
  }
): {
  payload: Record<string, unknown>;
  sourceLabel: "stdin payload" | "json input";
  sourceName: string;
} | null {
  if (mode === "none") {
    return null;
  }

  const maxBytes = options.maxBytes ?? MAX_CLI_STRUCTURED_ENTITY_INPUT_BYTES;

  if (mode === "stdin") {
    const sourceName = "stdin";
    let rawText: string;

    try {
      rawText = deps.readCliStdinSync({
        maxBytes,
        logicalName: sourceName
      });
    } catch (error) {
      deps.throwCliInvalidInputField(error instanceof Error ? error.message : "Unable to read stdin");
    }

    return {
      payload: deps.readJsonObjectFromString(rawText, sourceName, {
        maxSerializedBytes: maxBytes
      }),
      sourceLabel: "stdin payload",
      sourceName
    };
  }

  const sourceName = path.resolve(options.jsonInputPath as string);
  let rawText: string;

  try {
    rawText = deps.readTextFileWithinCliLimit(sourceName, {
      maxBytes,
      logicalName: sourceName
    });
  } catch (error) {
    deps.throwCliInvalidInputField(error instanceof Error ? error.message : `Unable to read ${sourceName}`);
  }

  return {
    payload: deps.readJsonObjectFromString(rawText, sourceName, {
      maxSerializedBytes: maxBytes
    }),
    sourceLabel: "json input",
    sourceName
  };
}

export function resolveStructuredInputMode(
  commandName: string,
  options: {
    stdin: boolean;
    jsonInputPath?: string;
  },
  deps: {
    createCliUsageError: (code: string, message: string) => Error;
    mcpUsageErrorCodes: {
      conflictingStructuredInput: string;
    };
  }
): StructuredInputMode {
  if (options.stdin && options.jsonInputPath) {
    throw deps.createCliUsageError(
      deps.mcpUsageErrorCodes.conflictingStructuredInput,
      `Use only one of '--stdin' or '--json-input' for '${commandName}'`
    );
  }

  if (options.stdin) {
    return "stdin";
  }

  if (options.jsonInputPath) {
    return "json-input";
  }

  return "none";
}

export function assertStructuredInputPresent(
  commandName: string,
  mode: StructuredInputMode,
  targetDescription: string,
  deps: {
    createCliUsageError: (code: string, message: string) => Error;
    mcpUsageErrorCodes: {
      missingRequiredField: string;
    };
  }
): void {
  if (mode !== "none") {
    return;
  }

  throw deps.createCliUsageError(
    deps.mcpUsageErrorCodes.missingRequiredField,
    `Provide ${targetDescription} for '${commandName}' using '--stdin' or '--json-input'`
  );
}

export function assertNoStructuredInputMix(
  commandName: string,
  mode: StructuredInputMode,
  hasMixedInput: boolean,
  mixedInputDescription: string,
  deps: {
    createCliUsageError: (code: string, message: string) => Error;
    mcpUsageErrorCodes: {
      conflictingInputModes: string;
    };
  }
): void {
  if (mode === "none" || !hasMixedInput) {
    return;
  }

  throw deps.createCliUsageError(
    deps.mcpUsageErrorCodes.conflictingInputModes,
    `Do not mix '--stdin' or '--json-input' ${mixedInputDescription} for '${commandName}'`
  );
}

export function withStructuredInputMode<TResult>(
  commandName: string,
  options: {
    stdin: boolean;
    jsonInputPath?: string;
  },
  deps: {
    createCliUsageError: (code: string, message: string) => Error;
    mcpUsageErrorCodes: {
      conflictingStructuredInput: string;
    };
  },
  handlers: {
    stdin: () => TResult;
    jsonInput: () => TResult;
    cli: () => TResult;
  }
): TResult {
  const mode = resolveStructuredInputMode(commandName, options, deps);

  switch (mode) {
    case "stdin":
      return handlers.stdin();
    case "json-input":
      return handlers.jsonInput();
    case "none":
      return handlers.cli();
  }
}
