type SerializedCostConfig = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type CostFlagState = {
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
};

export function resolveCostFlags(
  state: CostFlagState,
  options: { allowPartial: boolean }
): {
  cost?: SerializedCostConfig | null;
  errorMessage?: string;
} {
  if (state.clearCost) {
    const hasAnyCostValue =
      typeof state.costInput !== "undefined" ||
      typeof state.costOutput !== "undefined" ||
      typeof state.costCacheRead !== "undefined" ||
      typeof state.costCacheWrite !== "undefined";

    if (hasAnyCostValue) {
      return {
        errorMessage: "Flag '--clear-cost' cannot be combined with explicit '--cost-*' values"
      };
    }

    return { cost: null };
  }

  const values = [
    state.costInput,
    state.costOutput,
    state.costCacheRead,
    state.costCacheWrite
  ];
  const providedCount = values.filter((value) => typeof value !== "undefined").length;

  if (providedCount === 0) {
    return {};
  }

  if (!options.allowPartial && providedCount !== 4) {
    return {
      errorMessage:
        "Cost flags must be provided as a complete set: '--cost-input', '--cost-output', '--cost-cache-read', and '--cost-cache-write'"
    };
  }

  return {
    cost: {
      input: state.costInput ?? 0,
      output: state.costOutput ?? 0,
      cache_read: state.costCacheRead ?? 0,
      cache_write: state.costCacheWrite ?? 0
    }
  };
}

export function assertResolvedCostFlags(
  resolvedCostFlags: {
    cost?: SerializedCostConfig | null;
    errorMessage?: string;
  },
  deps: {
    createCliUsageError: (code: string, message: string) => Error;
    mcpUsageErrorCodes: {
      conflictingCostFlags: string;
      incompleteCostFlags: string;
    };
  }
): asserts resolvedCostFlags is {
  cost?: SerializedCostConfig | null;
} {
  if (!resolvedCostFlags.errorMessage) {
    return;
  }

  const code = resolvedCostFlags.errorMessage.startsWith("Flag '--clear-cost' cannot be combined")
    ? deps.mcpUsageErrorCodes.conflictingCostFlags
    : deps.mcpUsageErrorCodes.incompleteCostFlags;

  throw deps.createCliUsageError(code, resolvedCostFlags.errorMessage);
}
