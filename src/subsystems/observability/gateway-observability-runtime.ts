export {
  bootstrapGatewayObservabilityRuntime,
  closeGatewayObservabilityRuntime,
  configureGatewayObservabilityRuntime,
  createGatewayObservabilityRuntime,
  getGatewayObservabilityDbPath,
  getGatewayObservabilityService,
  markGatewayObservabilityRuntimeFailed,
  pruneGatewayObservabilityRetentionNowRuntime,
  resetGatewayObservabilityRuntimeState
} from "./ostrich/ingestion/gateway-observability-runtime";
export type { GatewayObservabilityRuntime } from "./ostrich/ingestion/gateway-observability-runtime";
