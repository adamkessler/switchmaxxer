import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";

import {
  buildExternalOptimizeMutationCommandFromPlan,
  validateObservabilityOptimizeMutationPlanCommand,
  validateObservabilityOptimizeMutationPlanResult,
  type ObservabilityOptimizeMutationPlanApplyCommand,
  type ObservabilityOptimizeMutationPlanRestoreCommand,
  type ObservabilityOptimizeMutationPlanResult
} from "./observability-ipc-optimize-mutation-plan";
import {
  validateObservabilityExternalOptimizeApplyCommand,
  validateObservabilityExternalOptimizeRestoreCommand
} from "./observability-ipc-validation";
import { test } from "./observability.test-support";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "subsystems", "observability", "tests", "fixtures", name), "utf8")
  ) as unknown;
}

function compileGeneratedSchema() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });
  const schema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "src", "subsystems", "observability", "ipc-schemas", "observability-ipc.schema.json"),
      "utf8"
    )
  ) as Record<string, unknown>;

  return ajv.compile(schema);
}

const VALID_PLAN_APPLY_COMMAND = {
  command: "optimizeMutation.planApply",
  runId: "opt-ipc-plan",
  targetRouteId: "route-ipc-plan",
  readModel: {
    sourcePath: "/tmp/config.json",
    rawText: "{\"api_key\":\"sk-secret-should-not-cross\"}",
    routes: {},
    providersByName: {
      "provider-a": {
        auth_source: "env var",
        api_key_env: "PROVIDER_A_API_KEY",
        api_key_masked: "********"
      },
      "provider-b": {
        auth_source: "not required",
        api_key_env: null,
        api_key_masked: null
      }
    }
  },
  sourceSurface: "cli",
  createdBy: "switchmaxxer IPC plan test",
  actorKind: "operator",
  actorId: null,
  sessionId: null,
  dryRun: false,
  metadata: {
    phase: "ipc-plan-validation"
  }
} satisfies ObservabilityOptimizeMutationPlanApplyCommand;

const VALID_PLAN_RESTORE_COMMAND = {
  command: "optimizeMutation.planRestore",
  selector: {
    mode: "action",
    actionId: "action-ipc-plan"
  },
  readModel: VALID_PLAN_APPLY_COMMAND.readModel,
  sourceSurface: VALID_PLAN_APPLY_COMMAND.sourceSurface,
  createdBy: VALID_PLAN_APPLY_COMMAND.createdBy,
  actorKind: VALID_PLAN_APPLY_COMMAND.actorKind,
  actorId: VALID_PLAN_APPLY_COMMAND.actorId,
  sessionId: VALID_PLAN_APPLY_COMMAND.sessionId,
  dryRun: VALID_PLAN_APPLY_COMMAND.dryRun,
  metadata: VALID_PLAN_APPLY_COMMAND.metadata
} satisfies ObservabilityOptimizeMutationPlanRestoreCommand;

const VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT = {
  ok: true,
  plan: {
    kind: "route_provider_target",
    routeId: "route-ipc-plan",
    from: {
      serviceProvider: "provider-a",
      providerModelId: "model-a",
      cost: null
    },
    to: {
      serviceProvider: "provider-b",
      providerModelId: "model-b",
      cost: {
        input: 1.25,
        output: 2.5,
        cache_read: 0.25,
        cache_write: 0.5
      }
    },
    reason: "Lowest valid cost candidate for the persisted run."
  },
  warnings: []
} satisfies ObservabilityOptimizeMutationPlanResult;

void test("observability optimize mutation plan validation accepts valid commands", () => {
  const applyResult = validateObservabilityOptimizeMutationPlanCommand(VALID_PLAN_APPLY_COMMAND);
  const restoreActionResult = validateObservabilityOptimizeMutationPlanCommand(VALID_PLAN_RESTORE_COMMAND);
  const restoreRunRouteResult = validateObservabilityOptimizeMutationPlanCommand({
    ...VALID_PLAN_RESTORE_COMMAND,
    selector: {
      mode: "run_route",
      runId: "opt-ipc-plan",
      routeId: "route-ipc-plan"
    }
  });

  assert.equal(applyResult.ok, true);
  assert.equal(restoreActionResult.ok, true);
  assert.equal(restoreRunRouteResult.ok, true);
});

void test("observability optimize mutation plan validation accepts JSON command fixtures", () => {
  const fixtures = [
    "optimize-mutation-plan-apply-command.json",
    "optimize-mutation-plan-restore-command.json"
  ];

  for (const fixture of fixtures) {
    const result = validateObservabilityOptimizeMutationPlanCommand(loadFixture(fixture));

    assert.equal(result.ok, true, fixture);
  }
});

void test("observability optimize mutation plan validation rejects malformed commands", () => {
  const malformedCommands: Array<{
    readonly name: string;
    readonly value: unknown;
    readonly field: string;
  }> = [
    {
      name: "unknown command",
      value: {
        ...VALID_PLAN_APPLY_COMMAND,
        command: "optimizeMutation.nope"
      },
      field: "command"
    },
    {
      name: "missing apply run id",
      value: {
        ...VALID_PLAN_APPLY_COMMAND,
        runId: ""
      },
      field: "runId"
    },
    {
      name: "bad restore selector mode",
      value: {
        ...VALID_PLAN_RESTORE_COMMAND,
        selector: {
          mode: "latest"
        }
      },
      field: "selector.mode"
    },
    {
      name: "bad actor kind",
      value: {
        ...VALID_PLAN_APPLY_COMMAND,
        actorKind: "service"
      },
      field: "actorKind"
    },
    {
      name: "non-json command value",
      value: {
        ...VALID_PLAN_APPLY_COMMAND,
        metadata: {
          now: new Date("2026-05-12T12:00:00.000Z")
        }
      },
      field: "command.metadata.now"
    }
  ];

  for (const { name, value, field } of malformedCommands) {
    const result = validateObservabilityOptimizeMutationPlanCommand(value);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.field, field, name);
  }
});

void test("observability optimize mutation plan validation accepts valid results", () => {
  const targetResult = validateObservabilityOptimizeMutationPlanResult(VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT);
  const noopResult = validateObservabilityOptimizeMutationPlanResult({
    ok: true,
    plan: {
      kind: "none",
      reason: "No config change is needed."
    },
    warnings: ["Route already matches the selected provider target."]
  });

  assert.equal(targetResult.ok, true);
  assert.equal(noopResult.ok, true);
});

void test("observability optimize mutation plan validation accepts JSON result fixtures", () => {
  const fixtures = [
    "optimize-mutation-plan-route-provider-target-result.json",
    "optimize-mutation-plan-none-result.json"
  ];

  for (const fixture of fixtures) {
    const result = validateObservabilityOptimizeMutationPlanResult(loadFixture(fixture));

    assert.equal(result.ok, true, fixture);
  }
});

void test("observability optimize mutation plan builds JSON-safe external apply command", () => {
  const schemaValidate = compileGeneratedSchema();
  const command = buildExternalOptimizeMutationCommandFromPlan({
    command: VALID_PLAN_APPLY_COMMAND,
    result: VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
    reload: true,
    verify: false,
    completion: {
      warnings: ["reload pending"]
    }
  });
  const serialized = JSON.stringify(command);

  assert.equal(validateObservabilityExternalOptimizeApplyCommand(command).ok, true);
  assert.equal(schemaValidate(command), true);
  assert.equal(command.idempotencyKey, "apply:opt-ipc-plan:route-ipc-plan:false:true:false");
  assert.equal(command.runId, VALID_PLAN_APPLY_COMMAND.runId);
  assert.equal(command.targetRouteId, VALID_PLAN_APPLY_COMMAND.targetRouteId);
  assert.equal(command.reload, true);
  assert.equal(command.verify, false);
  assert.equal(command.catalog.kind, "narrowed_command_context");
  assert.equal(serialized.includes("sk-secret-should-not-cross"), false);
  assert.equal(serialized.includes("api_key_masked"), false);
  assert.equal(serialized.includes("PROVIDER_A_API_KEY"), true);
});

void test("observability optimize mutation plan builds JSON-safe external restore commands", () => {
  const schemaValidate = compileGeneratedSchema();
  const actionCommand = buildExternalOptimizeMutationCommandFromPlan({
    command: VALID_PLAN_RESTORE_COMMAND,
    result: VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
    reload: false,
    verify: true
  });
  const runRouteCommand = buildExternalOptimizeMutationCommandFromPlan({
    command: {
      ...VALID_PLAN_RESTORE_COMMAND,
      selector: {
        mode: "run_route",
        runId: "opt-ipc-plan",
        routeId: "route-ipc-plan"
      }
    },
    result: VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
    reload: false,
    verify: true
  });

  assert.equal(validateObservabilityExternalOptimizeRestoreCommand(actionCommand).ok, true);
  assert.equal(validateObservabilityExternalOptimizeRestoreCommand(runRouteCommand).ok, true);
  assert.equal(schemaValidate(actionCommand), true);
  assert.equal(schemaValidate(runRouteCommand), true);
  assert.equal(actionCommand.idempotencyKey, "restore:action:action-ipc-plan:false:false:true");
  assert.equal(runRouteCommand.idempotencyKey, "restore:run_route:opt-ipc-plan:route-ipc-plan:false:false:true");
  assert.equal("actionId" in actionCommand, true);
  assert.equal("runId" in runRouteCommand, true);
  assert.equal(actionCommand.catalog.kind, "narrowed_command_context");
  assert.equal(runRouteCommand.catalog.kind, "narrowed_command_context");
});

void test("observability optimize mutation plan validation rejects malformed results", () => {
  const malformedResults: Array<{
    readonly name: string;
    readonly value: unknown;
    readonly field: string;
  }> = [
    {
      name: "unknown plan kind",
      value: {
        ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
        plan: {
          ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan,
          kind: "catalog_rewrite"
        }
      },
      field: "plan.kind"
    },
    {
      name: "missing route id",
      value: {
        ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
        plan: {
          ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan,
          routeId: ""
        }
      },
      field: "plan.routeId"
    },
    {
      name: "missing from provider",
      value: {
        ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
        plan: {
          ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan,
          from: {
            ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan.from,
            serviceProvider: ""
          }
        }
      },
      field: "plan.from.serviceProvider"
    },
    {
      name: "bad target cost",
      value: {
        ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
        plan: {
          ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan,
          to: {
            ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan.to,
            cost: {
              ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT.plan.to.cost,
              output: -1
            }
          }
        }
      },
      field: "plan.to.cost.output"
    },
    {
      name: "non-json result value",
      value: {
        ...VALID_ROUTE_PROVIDER_TARGET_PLAN_RESULT,
        warnings: [Symbol("nope")]
      },
      field: "result.warnings[0]"
    }
  ];

  for (const { name, value, field } of malformedResults) {
    const result = validateObservabilityOptimizeMutationPlanResult(value);

    assert.equal(result.ok, false, name);
    if (result.ok) {
      continue;
    }

    assert.equal(result.field, field, name);
  }
});
