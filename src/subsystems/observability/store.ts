export {
  ObservabilitySchemaVersionMismatchError,
  assertAllowedObservabilitySchemaTableName,
  bootstrapObservabilityStore,
  closeObservabilityStore
} from "./ostrich/store/store";
export type {
  BootstrapObservabilityStoreOptions,
  ObservabilityStore
} from "./ostrich/store/store";
