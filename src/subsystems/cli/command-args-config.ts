import {
  parseFlagArgv,
  type LongFlagSpec,
  type BooleanFlagSpec,
  type ReadLongFlagValue
} from "./command-arg-primitives";

type ConfigCommandArgs = {
  configPath?: string;
  json: boolean;
  errorMessage?: string;
};

type ConfigExportArgs = {
  configPath?: string;
  json: boolean;
  outputPath?: string;
  includeSecrets: boolean;
  errorMessage?: string;
};

type ConfigImportArgs = {
  configPath?: string;
  json: boolean;
  stdin: boolean;
  jsonInputPath?: string;
  dryRun: boolean;
  backup: boolean;
  errorMessage?: string;
};

type ConfigSetArgs = {
  key?: string;
  value?: string;
  configPath?: string;
  json: boolean;
  errorMessage?: string;
};

type ConfigCommandState = Omit<ConfigCommandArgs, "errorMessage">;
type ConfigExportState = Omit<ConfigExportArgs, "errorMessage">;
type ConfigImportState = Omit<ConfigImportArgs, "errorMessage">;
type ConfigSetState = Omit<ConfigSetArgs, "errorMessage">;

const configOnlyLongFlagSpecs: readonly LongFlagSpec<ConfigCommandState>[] = [
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  }
];

const configExportLongFlagSpecs: readonly LongFlagSpec<ConfigExportState>[] = [
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  },
  {
    flagName: "--output",
    reader: "path",
    apply: (state, value) => {
      state.outputPath = value;
    }
  }
];

const configImportLongFlagSpecs: readonly LongFlagSpec<ConfigImportState>[] = [
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
  }
];

const configCommandBooleanFlagSpecs: readonly BooleanFlagSpec<ConfigCommandState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const configExportBooleanFlagSpecs: readonly BooleanFlagSpec<ConfigExportState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  },
  {
    flagName: "--include-secrets",
    apply: (state) => {
      state.includeSecrets = true;
    }
  }
];

const configImportBooleanFlagSpecs: readonly BooleanFlagSpec<ConfigImportState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  },
  {
    flagName: "--dry-run",
    apply: (state) => {
      state.dryRun = true;
    }
  },
  {
    flagName: "--backup",
    apply: (state) => {
      state.backup = true;
    }
  },
  {
    flagName: "--stdin",
    apply: (state) => {
      state.stdin = true;
    }
  }
];

const configSetBooleanFlagSpecs: readonly BooleanFlagSpec<ConfigSetState>[] = [
  {
    flagName: "--json",
    apply: (state) => {
      state.json = true;
    }
  }
];

const configSetLongFlagSpecs: readonly LongFlagSpec<ConfigSetState>[] = [
  {
    flagName: "--config",
    reader: "path",
    apply: (state, value) => {
      state.configPath = value;
    }
  }
];

function buildConfigCommandResult(
  state: ConfigCommandState,
  errorMessage?: string
): ConfigCommandArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

function buildConfigExportResult(
  state: ConfigExportState,
  errorMessage?: string
): ConfigExportArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    outputPath: state.outputPath,
    includeSecrets: state.includeSecrets,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

function buildConfigImportResult(
  state: ConfigImportState,
  errorMessage?: string
): ConfigImportArgs {
  return {
    configPath: state.configPath,
    json: state.json,
    stdin: state.stdin,
    jsonInputPath: state.jsonInputPath,
    dryRun: state.dryRun,
    backup: state.backup,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

function buildConfigSetResult(
  state: ConfigSetState,
  errorMessage?: string
): ConfigSetArgs {
  return {
    key: state.key,
    value: state.value,
    configPath: state.configPath,
    json: state.json,
    ...(typeof errorMessage === "undefined" ? {} : { errorMessage })
  };
}

export function parseConfigCommandArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ConfigCommandArgs {
  const state: ConfigCommandState = {
    configPath: undefined,
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: configCommandBooleanFlagSpecs,
    longFlags: configOnlyLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return buildConfigCommandResult(state, parsedArgs.errorMessage);
  }

  return buildConfigCommandResult(state);
}

export function parseConfigExportArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ConfigExportArgs {
  const state: ConfigExportState = {
    configPath: undefined,
    json: false,
    outputPath: undefined,
    includeSecrets: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: configExportBooleanFlagSpecs,
    longFlags: configExportLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return buildConfigExportResult(state, parsedArgs.errorMessage);
  }

  return buildConfigExportResult(state);
}

export function parseConfigImportArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ConfigImportArgs {
  const state: ConfigImportState = {
    configPath: undefined,
    json: false,
    stdin: false,
    jsonInputPath: undefined,
    dryRun: false,
    backup: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: configImportBooleanFlagSpecs,
    longFlags: configImportLongFlagSpecs,
    readLongFlagValue
  });
  if (parsedArgs.errorMessage) {
    return buildConfigImportResult(state, parsedArgs.errorMessage);
  }

  return buildConfigImportResult(state);
}

export function parseConfigSetArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): ConfigSetArgs {
  const state: ConfigSetState = {
    key: undefined,
    value: undefined,
    configPath: undefined,
    json: false
  };

  const parsedArgs = parseFlagArgv({
    argv,
    state,
    booleanFlags: configSetBooleanFlagSpecs,
    longFlags: configSetLongFlagSpecs,
    readLongFlagValue,
    consumePositionalArg: (nextState, arg) => {
      if (!nextState.key) {
        nextState.key = arg;
        return undefined;
      }

      if (!nextState.value) {
        nextState.value = arg;
        return undefined;
      }

      return `Unexpected argument '${arg}'`;
    }
  });
  if (parsedArgs.errorMessage) {
    return buildConfigSetResult(state, parsedArgs.errorMessage);
  }

  return buildConfigSetResult(state);
}
