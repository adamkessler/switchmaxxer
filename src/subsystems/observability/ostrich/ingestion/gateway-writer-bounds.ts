import type { RecordObservationBatchItem } from "../../service";

export const MAX_GATEWAY_OBSERVATION_BATCH_ITEMS = 10_000;

export function normalizeGatewayObservationBatch(
  batch: unknown
): { accepted: RecordObservationBatchItem[]; dropped: number; warnings: string[] } {
  if (!Array.isArray(batch)) {
    throw new Error("Gateway observation writer batch payload must be an array.");
  }

  if (batch.length <= MAX_GATEWAY_OBSERVATION_BATCH_ITEMS) {
    return {
      accepted: batch as RecordObservationBatchItem[],
      dropped: 0,
      warnings: []
    };
  }

  const dropped = batch.length - MAX_GATEWAY_OBSERVATION_BATCH_ITEMS;
  return {
    accepted: batch.slice(0, MAX_GATEWAY_OBSERVATION_BATCH_ITEMS) as RecordObservationBatchItem[],
    dropped,
    warnings: [
      `Observability batch exceeded ${MAX_GATEWAY_OBSERVATION_BATCH_ITEMS} items; dropped ${dropped} overflow item(s).`
    ]
  };
}
