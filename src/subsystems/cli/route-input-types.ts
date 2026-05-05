import type { CostConfig } from "../../platform/types";

export type RouteCliMutationArgs = {
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
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  clearCost?: boolean;
  clearTimeoutMs?: boolean;
  errorMessage?: string;
};

export type NormalizedRouteCreateInput = {
  name: string;
  model: string;
  service_provider: string;
  provider_model_id: string;
  display_name: string;
  timeout_ms?: number;
  cost?: CostConfig;
};

export type NormalizedRouteUpdateInput = {
  name: string;
  model?: string;
  service_provider?: string;
  provider_model_id?: string;
  display_name?: string;
  timeout_ms?: number | null;
  cost?: CostConfig | null;
};
