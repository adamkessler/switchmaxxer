import {
  parseFlagArgv,
  parseCostFlag,
  type BooleanFlagSpec,
  type LongFlagSpec,
  type ReadLongFlagValue
} from "./command-arg-primitives";

type CostFlagState = {
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
};

type ModelMutationArgs = {
  configPath?: string;
  json: boolean;
  stdin: boolean;
  jsonInputPath?: string;
  name?: string;
  displayName?: string;
  modelCreator?: string;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
  errorMessage?: string;
};

type ModelMutationState = Omit<ModelMutationArgs, "errorMessage" | keyof CostFlagState>;

const modelMutationBooleanFlagSpecs: readonly BooleanFlagSpec<ModelMutationState>[] = [
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
  }
];

const modelMutationLongFlagSpecs: readonly LongFlagSpec<ModelMutationState>[] = [
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
    flagName: "--display-name",
    reader: "value",
    apply: (state, value) => {
      state.displayName = value;
    }
  },
  {
    flagName: "--model-creator",
    reader: "value",
    apply: (state, value) => {
      state.modelCreator = value;
    }
  }
];

function buildModelMutationResult(
  state: ModelMutationState,
  costFlags: CostFlagState,
  errorMessage?: string
): ModelMutationArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    stdin: state.stdin,
    jsonInputPath: state.jsonInputPath,
    name: state.name,
    displayName: state.displayName,
    modelCreator: state.modelCreator,
    ...costFlags,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

export function parseModelsCreateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ModelMutationArgs {
  const state: ModelMutationState = {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    name: undefined,
    displayName: undefined,
    modelCreator: undefined
  };
  const costFlags: CostFlagState = { clearCost: false };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: modelMutationBooleanFlagSpecs,
    longFlags: modelMutationLongFlagSpecs,
    customConsumers: [
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
    return buildModelMutationResult(state, costFlags, parsedArgs.errorMessage);
  }

  return buildModelMutationResult(state, costFlags);
}

export function parseModelsUpdateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ReturnType<typeof parseModelsCreateArgs> {
  return parseModelsCreateArgs(argv, readLongFlagValue);
}
