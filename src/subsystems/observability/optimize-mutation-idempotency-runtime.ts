import type { ObservabilityRuntimeHandle } from "./runtime-loader";
import { OptimizeMutationIdempotencyRepository } from "./optimize-mutation-idempotency";

export function createOptimizeMutationIdempotencyRepository(
  handle: Pick<ObservabilityRuntimeHandle, "store">
): OptimizeMutationIdempotencyRepository {
  return new OptimizeMutationIdempotencyRepository(handle.store.db);
}
