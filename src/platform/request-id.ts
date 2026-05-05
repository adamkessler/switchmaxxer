import { randomUUID } from "node:crypto";

const assignedRequestIds = new WeakMap<object, string>();

export function assignRequestId(target: object, requestId = randomUUID()): string {
  assignedRequestIds.set(target, requestId);
  return requestId;
}

function getAssignedRequestId(target: object): string | null {
  return assignedRequestIds.get(target) ?? null;
}

export function getOrAssignRequestId(target: object): string {
  return getAssignedRequestId(target) ?? assignRequestId(target);
}
