export type ConfigMutationLockEvents = {
  afterStaleLockRemoved?: (lockPath: string) => void;
};

const CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS = Symbol.for("switchmaxxer.configMutationLockEventsForTests");

type ConfigMutationLockEventGlobal = typeof globalThis & {
  [CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS]?: ConfigMutationLockEvents | null;
};

export function getConfigMutationLockEvents(): ConfigMutationLockEvents | null {
  return (globalThis as ConfigMutationLockEventGlobal)[CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS] ?? null;
}

export function notifyStaleConfigMutationLockRemoved(lockPath: string): void {
  getConfigMutationLockEvents()?.afterStaleLockRemoved?.(lockPath);
}
