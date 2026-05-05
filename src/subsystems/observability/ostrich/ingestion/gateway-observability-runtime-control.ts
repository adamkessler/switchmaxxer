import { shutdownGatewayObservability } from "../../gateway";
import { resetGatewayObservabilityRuntimeState } from "./gateway-observability-runtime";
import { gatewayObservationRuntimeState } from "./gateway-observation-runtime-state";

export async function resetGatewayObservabilityRuntimeForIsolatedRun(): Promise<void> {
  gatewayObservationRuntimeState.flush.clearGatewayObservationFlushTimer();
  gatewayObservationRuntimeState.flush.clearGatewayObservationDrainHandle();
  await shutdownGatewayObservability();
  resetGatewayObservabilityRuntimeState();
  gatewayObservationRuntimeState.flush.resetGatewayObservationFlushState();
  gatewayObservationRuntimeState.queue.resetDroppedGatewayObservationCount();
}
