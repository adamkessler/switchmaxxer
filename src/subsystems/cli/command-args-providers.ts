import {
  parseFlagArgv,
  type BooleanFlagSpec,
  type LongFlagSpec,
  type ReadLongFlagValue
} from "./command-arg-primitives";

type ProviderSetKeyArgs = {
  configPath?: string;
  json: boolean;
  apiKeyStdin: boolean;
  errorMessage?: string;
};

type ProviderMutationArgs = {
  configPath?: string;
  json: boolean;
  stdin: boolean;
  jsonInputPath?: string;
  apiKeyStdin: boolean;
  noAuth: boolean;
  allowPrivateEndpoints: boolean;
  allowInsecureHttp: boolean;
  name?: string;
  endpoint?: string;
  apiMode?: string;
  apiKeyEnv?: string;
  anthropicVersion?: string;
  modelIdFormat?: string;
  errorMessage?: string;
};

type ProviderMutationState = Omit<ProviderMutationArgs, "errorMessage">;

const providerSetKeyBooleanFlagSpecs: readonly BooleanFlagSpec<Omit<ProviderSetKeyArgs, "errorMessage">>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  },
  {
    flagName: "--api-key-stdin",
    apply: (state) => {
      state.apiKeyStdin = true;
    }
  }
];

const providerMutationBooleanFlagSpecs: readonly BooleanFlagSpec<ProviderMutationState>[] = [
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
    flagName: "--api-key-stdin",
    apply: (state) => {
      state.apiKeyStdin = true;
    }
  },
  {
    flagName: "--no-auth",
    apply: (state) => {
      state.noAuth = true;
    }
  },
  {
    flagName: "--allow-private-endpoints",
    apply: (state) => {
      state.allowPrivateEndpoints = true;
    }
  },
  {
    flagName: "--allow-insecure-http",
    apply: (state) => {
      state.allowInsecureHttp = true;
    }
  }
];

const providerMutationLongFlagSpecs: readonly LongFlagSpec<ProviderMutationState>[] = [
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
    flagName: "--endpoint",
    reader: "value",
    apply: (state, value) => {
      state.endpoint = value;
    }
  },
  {
    flagName: "--api-mode",
    reader: "value",
    apply: (state, value) => {
      state.apiMode = value;
    }
  },
  {
    flagName: "--api-key-env",
    reader: "value",
    apply: (state, value) => {
      state.apiKeyEnv = value;
    }
  },
  {
    flagName: "--anthropic-version",
    reader: "value",
    apply: (state, value) => {
      state.anthropicVersion = value;
    }
  },
  {
    flagName: "--model-id-format",
    reader: "value",
    apply: (state, value) => {
      state.modelIdFormat = value;
    }
  }
];

const providerSetKeyLongFlagSpecs: readonly LongFlagSpec<Omit<ProviderSetKeyArgs, "errorMessage">>[] = [
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  }
];

function buildProviderSetKeyResult(
  state: Omit<ProviderSetKeyArgs, "errorMessage">,
  errorMessage?: string
): ProviderSetKeyArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    apiKeyStdin: state.apiKeyStdin,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

function buildProviderMutationResult(
  state: ProviderMutationState,
  errorMessage?: string
): ProviderMutationArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    stdin: state.stdin,
    jsonInputPath: state.jsonInputPath,
    apiKeyStdin: state.apiKeyStdin,
    noAuth: state.noAuth,
    allowPrivateEndpoints: state.allowPrivateEndpoints,
    allowInsecureHttp: state.allowInsecureHttp,
    name: state.name,
    endpoint: state.endpoint,
    apiMode: state.apiMode,
    apiKeyEnv: state.apiKeyEnv,
    anthropicVersion: state.anthropicVersion,
    modelIdFormat: state.modelIdFormat,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

export function parseProviderSetKeyArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ProviderSetKeyArgs {
  const state: Omit<ProviderSetKeyArgs, "errorMessage"> = {
    configPath: undefined,
    json: false,
    apiKeyStdin: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: providerSetKeyBooleanFlagSpecs,
    longFlags: providerSetKeyLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return buildProviderSetKeyResult(state, parsedArgs.errorMessage);
  }

  if (!state.apiKeyStdin) {
    return buildProviderSetKeyResult(state, "Flag '--api-key-stdin' is required for 'providers set-key'");
  }

  return buildProviderSetKeyResult(state);
}

export function parseProvidersCreateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ProviderMutationArgs {
  const state: ProviderMutationState = {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    apiKeyStdin: false,
    noAuth: false,
    allowPrivateEndpoints: false,
    allowInsecureHttp: false,
    name: undefined,
    endpoint: undefined,
    apiMode: undefined,
    apiKeyEnv: undefined,
    anthropicVersion: undefined,
    modelIdFormat: undefined
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: providerMutationBooleanFlagSpecs,
    longFlags: providerMutationLongFlagSpecs,
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
    return buildProviderMutationResult(state, parsedArgs.errorMessage);
  }

  return buildProviderMutationResult(state);
}

export function parseProvidersUpdateArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ReturnType<typeof parseProvidersCreateArgs> {
  return parseProvidersCreateArgs(argv, readLongFlagValue);
}
