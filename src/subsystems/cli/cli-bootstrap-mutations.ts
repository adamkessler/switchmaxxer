import type { CliBootstrapDeps } from "./cli-bootstrap-types";
import { createCliModelMutations } from "./cli-mutations-models";
import { createCliProviderMutations } from "./cli-mutations-providers";
import { createCliRouteMutations } from "./cli-mutations-routes";
import { createCliMutationShared } from "./cli-mutations-shared";

export function createCliMutationBootstrap(rawDeps: CliBootstrapDeps) {
  const shared = createCliMutationShared(rawDeps);
  const modelMutations = createCliModelMutations(shared);
  const providerMutations = createCliProviderMutations(shared);
  const routeMutations = createCliRouteMutations(shared);

  return {
    ...modelMutations,
    ...providerMutations,
    ...routeMutations
  };
}
