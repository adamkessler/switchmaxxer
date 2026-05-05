import { loadCliReadModel } from "../config/read-model";
import type {
  OptimizeApplyReloadView,
  OptimizeApplyVerificationView
} from "../observability/optimize-ledger-views";
import type { McpSessionContext } from "./types";

export type McpOptimizePostActionDeps = {
  runOptimizeApplyReload: (options: { configPath?: string; operation?: "apply" | "restore" }) => Promise<OptimizeApplyReloadView>;
  runOptimizeApplyVerify: (options: { configPath?: string; routeId: string; operation?: "apply" | "restore" }) => Promise<OptimizeApplyVerificationView>;
};

export type McpToolRuntimeDeps = {
  optimizePostActions?: McpOptimizePostActionDeps;
};

export type McpToolContext = {
  params: unknown;
  configPath?: string;
  sessionContext?: McpSessionContext;
  getReadModel: () => ReturnType<typeof loadCliReadModel>;
  runtimeDeps?: McpToolRuntimeDeps;
};
