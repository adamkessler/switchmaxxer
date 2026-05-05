import { APP_ERROR_CODES } from "../../platform/error-codes";
import { buildSuccessEnvelope } from "../../platform/response-envelope";
import { pickCostFields } from "../config/model-input-contract";
import type { CliMutationShared } from "./cli-mutations-shared";

export function createCliRouteMutations(shared: CliMutationShared) {
  const {
    deps,
    assertSafeCliConfigIdentifier,
    routeMutationRuntime,
    renderRouteSummary,
    createCliMutationAudit,
    withCliMutationAudit,
    classifyUsageOrMutationFailure,
    classifyMutationMessageFailure
  } = shared;

  const runRoutesCreate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseRoutesCreateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "routes_create",
      targetKind: "route",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "routes create",
        failurePrefix: "Routes create",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.routesCreateError)
      },
      () => {
        const routeInput = deps.normalizeRouteCreateInput(parsedArgs);
        const { route } = routeMutationRuntime.createRoute(configPath, routeInput.name, {
          model: routeInput.model,
          service_provider: routeInput.service_provider,
          provider_model_id: routeInput.provider_model_id,
          display_name: routeInput.display_name,
          ...(typeof routeInput.timeout_ms === "undefined" ? {} : { timeout_ms: routeInput.timeout_ms }),
          ...(typeof routeInput.cost === "undefined" ? {} : { cost: pickCostFields(routeInput.cost) })
        });
        audit?.succeed({ route_id: route.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("routes create", route));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderRouteSummary("Route created", route));
        return 0;
      }
    );
  };

  const runRoutesUpdate = async (argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseRoutesUpdateArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "routes_update",
      targetKind: "route",
      targetId: typeof parsedArgs.name === "string" ? parsedArgs.name : null,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "routes update",
        failurePrefix: "Routes update",
        classify: (error) => classifyUsageOrMutationFailure(error, APP_ERROR_CODES.routesUpdateError)
      },
      () => {
        const routeInput = deps.normalizeRouteUpdateInput(parsedArgs);
        const { route } = routeMutationRuntime.updateRoute(configPath, routeInput.name, {
          ...(typeof routeInput.model !== "undefined" ? { model: routeInput.model } : {}),
          ...(typeof routeInput.service_provider !== "undefined" ? { service_provider: routeInput.service_provider } : {}),
          ...(typeof routeInput.provider_model_id !== "undefined"
            ? { provider_model_id: routeInput.provider_model_id }
            : {}),
          ...(typeof routeInput.display_name !== "undefined" ? { display_name: routeInput.display_name } : {}),
          ...(typeof routeInput.timeout_ms !== "undefined" ? { timeout_ms: routeInput.timeout_ms } : {}),
          ...(typeof routeInput.cost !== "undefined"
            ? {
                cost: routeInput.cost === null
                  ? null
                  : pickCostFields(routeInput.cost)
              }
            : {})
        });
        audit?.succeed({ route_id: route.name });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("routes update", route));
          return 0;
        }
        deps.cliOutputDeps.writeStdout(renderRouteSummary("Route updated", route));
        return 0;
      }
    );
  };

  const runRoutesDelete = async (routeName: string, argv: string[]): Promise<number> => {
    const parsedArgs = deps.cliParserDeps.parseConfigCommandArgs(argv);
    if (parsedArgs.errorMessage) {
      deps.cliOutputDeps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }
    const { configPath, json } = parsedArgs;
    const audit = createCliMutationAudit({
      operation: "routes_delete",
      targetKind: "route",
      targetId: routeName,
      configPath
    });
    return await withCliMutationAudit(
      audit,
      {
        json,
        command: "routes delete",
        failurePrefix: "Routes delete",
        classify: (error) => classifyMutationMessageFailure(error, APP_ERROR_CODES.routesDeleteError, "Unknown routes delete error")
      },
      () => {
        assertSafeCliConfigIdentifier(routeName, "Route name");
        const deleted = routeMutationRuntime.deleteRoute(configPath, routeName);
        audit?.succeed({ route_id: deleted.name, deleted: true });
        if (json) {
          deps.cliOutputDeps.writeJson(buildSuccessEnvelope("routes delete", deleted));
          return 0;
        }
        deps.cliOutputDeps.writeStdout([`Route deleted: ${deleted.name}`, "Deleted: true"].join("\n"));
        return 0;
      }
    );
  };

  return {
    runRoutesCreate,
    runRoutesUpdate,
    runRoutesDelete
  };
}
