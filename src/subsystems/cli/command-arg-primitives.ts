import {
  parseCanonicalNonNegativeInteger,
  parseCanonicalPositiveInteger
} from "../../platform/number-parsing";

type CostFlagState = {
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
};

export type ReadLongFlagValue = (
  argv: string[],
  index: number,
  flagName: string,
  missingValueMessage?: string
) => { consumed: number; value?: string; errorMessage?: string } | null;

type ParsedLongFlag = Exclude<ReturnType<ReadLongFlagValue>, null>;
type LongFlagReader = "path" | "value";

export type LongFlagSpec<State> = {
  flagName: string;
  reader: LongFlagReader;
  apply: (state: State, value: string) => void;
};

export type BooleanFlagSpec<State> = {
  flagName: string;
  apply: (state: State) => void;
};

export type CustomFlagConsumer<State> = (
  argv: string[],
  index: number,
  state: State,
  readLongFlagValue: ReadLongFlagValue
) => {
  consumed: number;
  errorMessage?: string;
} | null;

export type PositionalArgConsumer<State> = (state: State, arg: string) => string | undefined;

export function consumeBooleanFlagSpecs<State>(
  arg: string,
  specs: readonly BooleanFlagSpec<State>[],
  state: State
): boolean {
  for (const spec of specs) {
    if (arg !== spec.flagName) {
      continue;
    }

    spec.apply(state);
    return true;
  }

  return false;
}

export function readPathFlag(
  argv: string[],
  index: number,
  flagName: string,
  readLongFlagValue: ReadLongFlagValue
): ParsedLongFlag | null {
  return readLongFlagValue(argv, index, flagName, `Flag '${flagName}' requires a path value`);
}

export function readValueFlag(
  argv: string[],
  index: number,
  flagName: string,
  readLongFlagValue: ReadLongFlagValue
): ParsedLongFlag | null {
  return readLongFlagValue(argv, index, flagName, `Flag '${flagName}' requires a value`);
}

export function consumeLongFlagSpecs<State>(
  argv: string[],
  index: number,
  specs: readonly LongFlagSpec<State>[],
  state: State,
  readLongFlagValue: ReadLongFlagValue
): {
  consumed: number;
  errorMessage?: string;
} | null {
  for (const spec of specs) {
    const parsedFlag =
      spec.reader === "path"
        ? readPathFlag(argv, index, spec.flagName, readLongFlagValue)
        : readValueFlag(argv, index, spec.flagName, readLongFlagValue);
    if (!parsedFlag) {
      continue;
    }

    if (parsedFlag.errorMessage) {
      return {
        consumed: 0,
        errorMessage: parsedFlag.errorMessage
      };
    }

    if (typeof parsedFlag.value !== "string") {
      return {
        consumed: 0,
        errorMessage:
          spec.reader === "path"
            ? `Flag '${spec.flagName}' requires a path value`
            : `Flag '${spec.flagName}' requires a value`
      };
    }

    spec.apply(state, parsedFlag.value);
    return { consumed: parsedFlag.consumed };
  }

  return null;
}

export function parseFlagArgv<State>({
  argv,
  state,
  booleanFlags = [],
  longFlags = [],
  customConsumers = [],
  readLongFlagValue,
  consumePositionalArg
}: {
  argv: string[];
  state: State;
  booleanFlags?: readonly BooleanFlagSpec<State>[];
  longFlags?: readonly LongFlagSpec<State>[];
  customConsumers?: readonly CustomFlagConsumer<State>[];
  readLongFlagValue: ReadLongFlagValue;
  consumePositionalArg?: PositionalArgConsumer<State>;
}): { errorMessage?: string } {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg === "undefined") {
      break;
    }

    if (consumeBooleanFlagSpecs(arg, booleanFlags, state)) {
      continue;
    }

    const parsedLongFlag = consumeLongFlagSpecs(
      argv,
      index,
      longFlags,
      state,
      readLongFlagValue
    );
    if (parsedLongFlag) {
      if (parsedLongFlag.errorMessage) {
        return { errorMessage: parsedLongFlag.errorMessage };
      }

      index += parsedLongFlag.consumed;
      continue;
    }

    let consumedByCustomFlag = false;
    for (const consumeCustomFlag of customConsumers) {
      const parsedCustomFlag = consumeCustomFlag(argv, index, state, readLongFlagValue);
      if (!parsedCustomFlag) {
        continue;
      }

      if (parsedCustomFlag.errorMessage) {
        return { errorMessage: parsedCustomFlag.errorMessage };
      }

      index += parsedCustomFlag.consumed;
      consumedByCustomFlag = true;
      break;
    }

    if (consumedByCustomFlag) {
      continue;
    }

    if (arg.startsWith("-") || !consumePositionalArg) {
      return { errorMessage: `Unknown flag '${arg}'` };
    }

    const positionalError = consumePositionalArg(state, arg);
    if (positionalError) {
      return { errorMessage: positionalError };
    }
  }

  return {};
}

export function parsePositiveIntegerFlagValue(
  value: string | undefined,
  flagName: string
): { value?: number; errorMessage?: string } {
  if (typeof value !== "string") {
    return { errorMessage: `Flag '${flagName}' requires a positive integer value` };
  }

  const parsed = parseCanonicalPositiveInteger(value);
  if (parsed === null) {
    return { errorMessage: `Flag '${flagName}' requires a positive integer value` };
  }

  return { value: parsed };
}

export function parseNonNegativeIntegerFlagValue(
  value: string | undefined,
  flagName: string
): { value?: number; errorMessage?: string } {
  if (typeof value !== "string") {
    return { errorMessage: `Flag '${flagName}' requires a non-negative integer value` };
  }

  const parsed = parseCanonicalNonNegativeInteger(value);
  if (parsed === null) {
    return { errorMessage: `Flag '${flagName}' requires a non-negative integer value` };
  }

  return { value: parsed };
}

export function parseCostFlag(
  argv: string[],
  index: number,
  state: CostFlagState,
  readLongFlagValue: ReadLongFlagValue
): {
  consumed: number;
  errorMessage?: string;
} | null {
  const arg = argv[index];
  if (typeof arg === "undefined") {
    return null;
  }

  const readNumber = (flagName: string): { consumed: number; value?: number; errorMessage?: string } => {
    const parsedValue = readValueFlag(argv, index, flagName, readLongFlagValue);
    if (!parsedValue) {
      return { consumed: 0, errorMessage: `Flag '${flagName}' requires a value` };
    }

    if (parsedValue.errorMessage) {
      return { consumed: 0, errorMessage: parsedValue.errorMessage };
    }

    const parsed = Number(parsedValue.value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { consumed: 0, errorMessage: `Flag '${flagName}' requires a non-negative numeric value` };
    }

    return {
      consumed: parsedValue.consumed,
      value: parsed
    };
  };

  const numericCostFlagSpecs: ReadonlyArray<{
    flagName: "--cost-input" | "--cost-output" | "--cost-cache-read" | "--cost-cache-write";
    apply: (nextState: CostFlagState, value: number | undefined) => void;
  }> = [
    {
      flagName: "--cost-input",
      apply: (nextState, value) => {
        nextState.costInput = value;
      }
    },
    {
      flagName: "--cost-output",
      apply: (nextState, value) => {
        nextState.costOutput = value;
      }
    },
    {
      flagName: "--cost-cache-read",
      apply: (nextState, value) => {
        nextState.costCacheRead = value;
      }
    },
    {
      flagName: "--cost-cache-write",
      apply: (nextState, value) => {
        nextState.costCacheWrite = value;
      }
    }
  ];

  if (arg === "--clear-cost") {
    state.clearCost = true;
    return { consumed: 0 };
  }

  for (const spec of numericCostFlagSpecs) {
    if (arg !== spec.flagName) {
      continue;
    }

    const result = readNumber(spec.flagName);
    if (result.errorMessage) {
      return { consumed: 0, errorMessage: result.errorMessage };
    }

    spec.apply(state, result.value);
    return { consumed: result.consumed };
  }

  return null;
}
