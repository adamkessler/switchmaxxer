import {
  createGatewayObservationFlushState,
  type GatewayObservationFlushState
} from "./gateway-observation-flush";
import {
  createGatewayObservationQueueState,
  type GatewayObservationQueueState
} from "./gateway-observation-queue";
import {
  createGatewayObservationWorkerState,
  type GatewayObservationWorkerState
} from "./gateway-observation-worker";

export type GatewayObservationRuntimeState = {
  queue: GatewayObservationQueueState;
  flush: GatewayObservationFlushState;
  worker: GatewayObservationWorkerState;
};

export function createGatewayObservationRuntimeState(): GatewayObservationRuntimeState {
  const queue = createGatewayObservationQueueState();
  const worker = createGatewayObservationWorkerState();
  const flush = createGatewayObservationFlushState(queue);

  return {
    queue,
    flush,
    worker
  };
}

export const gatewayObservationRuntimeState = createGatewayObservationRuntimeState();
