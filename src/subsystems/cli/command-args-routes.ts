import {
  parseFlagArgv,
  parseCostFlag,
  parsePositiveIntegerFlagValue,
  type BooleanFlagSpec,
  type CustomFlagConsumer,
  type LongFlagSpec,
  readValueFlag,
  type ReadLongFlagValue
} from "./command-arg-primitives";

type CostFlagState = {
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
};

type RouteMutationArgs = {
  configPath?: string;
  json: boolean;
  stdin: boolean;
  jsonInputPath?: string;
  name?: string;
  model?: string;
  serviceProvider?: string;
  providerModelId?: string;
  displayName?: string;
  timeoutMs?: number;
  clearTimeoutMs?: boolean;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
  errorMessage?: string;
};

type RouteMutationState = Omit<RouteMutationArgs, "errorMessage" | keyof CostFlagState>;

const routeMutationBooleanFlagSpecs: readonly BooleanFlagSpec<RouteMutationState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  },
  {
    flagName: "--stdin",
    apply: (state) => {
      state.stdin = true;
    }
  },
  {
    flagName: "--clear-timeout-ms",
    apply: (state) => {
      state.clearTimeoutMs = true;
    }
  }
];

const routeMutationLongFlagSpecs: readonly LongFlagSpec<RouteMutationState>[] = [
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  },
  {
    flagName: "--json-input",
    reader: "path",
    apply: (state, value) => {
      state.jsonInputPath = value;
    }
  },
  {
    flagName: "--model",
    reader: "value",
    apply: (state, value) => {
      state.model = value;
    }
  },
  {
    flagName: "--service-provider",
    reader: "value",
    apply: (state, value) => {
      state.serviceProvider = value;
    }
  },
  {
    flagName: "--provider-model-id",
    reader: "value",
    apply: (state, value) => {
      state.providerModelId = value;
    }
  },
  {
    flagName: "--display-name",
    reader: "value",
    apply: (state, value) => {
      state.displayName = value;
    }
  }
];

const routeMutationTimeoutFlagConsumers: readonly CustomFlagConsumer<RouteMutationState>[] = [
  (argv, index, state, readLongFlagValue) => {
    const parsedTimeoutFlag = readValueFlag(argv, index, "--timeout-ms", readLongFlagValue);
    if (!parsedTimeoutFlag) {
      return null;
    }

    if (parsedTimeoutFlag.errorMessage) {
      return { consumed: 0, errorMessage: parsedTimeoutFlag.errorMessage };
    }

    const parsedTimeout = parsePositiveIntegerFlagValue(parsedTimeoutFlag.value, "--timeout-ms");
    if (parsedTimeout.errorMessage) {
      return { consumed: 0, errorMessage: parsedTimeout.errorMessage };
    }

    state.timeoutMs = parsedTimeout.value;
    return { consumed: parsedTimeoutFlag.consumed };
  }
];

function buildRouteMutationResult(
  state: RouteMutationState,
  costFlags: CostFlagState,
  errorMessage?: string
): RouteMutationArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    stdin: state.stdin,
    jsonInputPath: state.jsonInputPath,
    name: state.name,
    model: state.model,
    serviceProvider: state.serviceProvider,
    providerModelId: state.providerModelId,
    displayName: state.displayName,
    timeoutMs: state.timeoutMs,
    clearTimeoutMs: state.clearTimeoutMs,
    ...costFlags,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

export function parseRoutesCreateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): RouteMutationArgs {
  const state: RouteMutationState = {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: undefined,
    model: undefined,
    serviceProvider: undefined,
    providerModelId: undefined,
    displayName: undefined,
    timeoutMs: undefined,
    clearTimeoutMs: false
  };
  const costFlags: CostFlagState = { clearCost: false };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: routeMutationBooleanFlagSpecs,
    longFlags: routeMutationLongFlagSpecs,
    customConsumers: [
      ...routeMutationTimeoutFlagConsumers,
      (nextArgv, index, _state, nextReadLongFlagValue) =>
        parseCostFlag(nextArgv, index, costFlags, nextReadLongFlagValue)
    ],
    readLongFlagValue,
    consumePositionalArg: (nextState, arg) => {
      if (!nextState.name) {
        nextState.name = arg;
        return undefined;
      }

      return `Unexpected argument '${arg}'`;
    }
  });
  if (parsedArgs.errorMessage) {
    return buildRouteMutationResult(state, costFlags, parsedArgs.errorMessage);
  }

  return buildRouteMutationResult(state, costFlags);
}

export function parseRoutesUpdateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ReturnType<typeof parseRoutesCreateArgs> {
  return parseRoutesCreateArgs(argv, readLongFlagValue);
}
