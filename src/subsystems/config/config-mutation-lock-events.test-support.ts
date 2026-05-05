import type { ConfigMutationLockEvents } from "./config-mutation-lock-events";
import { getConfigMutationLockEvents } from "./config-mutation-lock-events";

const CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS = Symbol.for("switchmaxxer.configMutationLockEventsForTests");

type ConfigMutationLockEventGlobal = typeof globalThis & {
  [CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS]?: ConfigMutationLockEvents | null;
};

export function setConfigMutationLockEventsForTests(events: ConfigMutationLockEvents | null): void {
  (globalThis as ConfigMutationLockEventGlobal)[CONFIG_MUTATION_LOCK_EVENTS_FOR_TESTS] = events;
}

export function getConfigMutationLockEventsForTests(): ConfigMutationLockEvents | null {
  return getConfigMutationLockEvents();
}
