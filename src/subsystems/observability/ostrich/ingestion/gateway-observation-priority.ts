import type { RecordObservationBatchItem } from "../../service";
import type { ObservationRecord } from "../../types";

export type GatewayObservationPriority = 0 | 1 | 2 | 3;

function isTerminalGatewayObservation(record: ObservationRecord): boolean {
  if (record.event === "client_response_completed" || record.event === "debug_error_context") {
    return true;
  }

  switch (record.outcome) {
    case "succeeded":
    case "failed":
    case "cancelled":
    case "timed_out":
    case "rejected":
    case "partial":
      return true;
    default:
      return false;
  }
}

export function gatewayObservationPriority(item: RecordObservationBatchItem): GatewayObservationPriority {
  const { record } = item;

  if (record.kind === "error" || isTerminalGatewayObservation(record)) {
    return 3;
  }

  switch (record.kind) {
    case "usage":
    case "cost":
    case "benchmark":
    case "optimization":
    case "system":
      return 2;
    case "debug":
      return 0;
    default:
      return 1;
  }
}
