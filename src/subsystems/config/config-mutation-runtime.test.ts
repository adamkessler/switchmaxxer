import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CURRENT_CONFIG_VERSION } from "./config";
import { createConfigMutationRuntime } from "./mutation/config";
import { createEntityMutationRuntimes } from "./mutation";
import { withConfigMutationLock, writeConfigBackupSnapshot } from "./config-file";
import {
  setConfigMutationLockTestHooksForTests,
  writeSplitConfigForTests
} from "./config-file.test-support";
import { loadConfigJsonDocument, loadRawConfigJsonDocument } from "./read-model";
import { createStringKeyRecord } from "../../platform/object-key-policy";
import { createModelMutationRuntime } from "./mutation/model";
import { createProviderMutationRuntime } from "./mutation/provider";
import { createRouteMutationRuntime } from "./mutation/route";
import { validateMutableProviderEntity } from "./mutation/entity-validation";
import { pickCostFields } from "./model-input-contract";

function createInvalidInputMutationError(message: string) {
  return Object.assign(new Error(message), { code: "invalid_input_field" });
}

function createInvalidConfigMutationError(message: string) {
  return Object.assign(new Error(message), { code: "invalid_config_mutation" });
}

function writeConfigMutationLockForTests(lockPath: string, metadata: Record<string, unknown>): void {
  writeFileSync(lockPath, JSON.stringify(metadata), "utf8");
  chmodSync(lockPath, 0o600);
}

function createRouteMutationRuntimeForValidationTests() {
  let mutateCallCount = 0;
  const routeStore: Record<string, unknown> = {
    route_test: {
      model: "model_test",
      service_provider: "provider_test",
      provider_model_id: "provider-model-test",
      display_name: "Route Test",
      timeout_ms: 5000,
      cost: {
        input: 1,
        output: 2,
        cache_read: 0.5,
        cache_write: 0.75
      }
    }
  };
  const runtime = createRouteMutationRuntime({
    loadCliReadModel: () => ({
      routesByName: {
        route_test: { name: "route_test" }
      },
      modelsByName: {
        model_test: {}
      },
      providersByName: {
        provider_test: {}
      }
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ routes: routeStore });
    },
    getMutableRoutes: (document) => document["routes"] as Record<string, unknown>,
    createRouteAlreadyExistsError: (routeId) => Object.assign(new Error(`route exists ${routeId}`), { code: "route_already_exists" }),
    createRouteNotFoundError: (routeId) => Object.assign(new Error(`route missing ${routeId}`), { code: "route_not_found" }),
    createUnknownModelError: (routeId, modelId) => Object.assign(new Error(`unknown model ${routeId} ${modelId}`), { code: "unknown_model" }),
    createUnknownServiceProviderError: (routeId, providerId) => Object.assign(new Error(`unknown provider ${routeId} ${providerId}`), { code: "unknown_service_provider" }),
    createInvalidInputMutationError,
    createInvalidStoredRouteError: (routeId) => createInvalidConfigMutationError(`invalid route ${routeId}`)
  });

  return {
    runtime,
    routeStore,
    getMutateCallCount: () => mutateCallCount
  };
}

function createEntityMutationRuntimeForValidationTests() {
  let mutateCallCount = 0;
  const runtimes = createEntityMutationRuntimes({
    loadCliReadModel: () => ({
      modelsByName: {},
      providersByName: {},
      routesByName: {},
      routes: []
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({
        models: Object.create(null) as Record<string, unknown>,
        service_providers: Object.create(null) as Record<string, unknown>,
        routes: Object.create(null) as Record<string, unknown>
      });
    },
    getMutableModels: (document) => document["models"] as Record<string, unknown>,
    getMutableProviders: (document) => document["service_providers"] as Record<string, unknown>,
    getMutableRoutes: (document) => document["routes"] as Record<string, unknown>,
    entityStateErrorCodes: {
      modelAlreadyExists: "model_already_exists",
      modelNotFound: "model_not_found",
      modelInUse: "model_in_use",
      providerAlreadyExists: "provider_already_exists",
      providerNotFound: "provider_not_found",
      providerInUse: "provider_in_use",
      routeAlreadyExists: "route_already_exists",
      routeNotFound: "route_not_found",
      unknownModel: "unknown_model",
      unknownServiceProvider: "unknown_service_provider"
    },
    createEntityStateError: (code, message) => Object.assign(new Error(message), { code }),
    createInvalidInputMutationError,
    createInvalidConfigMutationError
  });

  return {
    ...runtimes,
    getMutateCallCount: () => mutateCallCount
  };
}

void test("entity mutation runtimes centrally validate model candidates before mutating", () => {
  const runtime = createEntityMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;

  try {
    runtime.modelMutationRuntime.createModel(undefined, "model_test", {
      model_creator: "openai"
    });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /Model 'model_test' is missing a valid 'display_name' value\./);
  assert.equal(error.code, "invalid_input_field");
  assert.equal(runtime.getMutateCallCount(), 0);
});

void test("entity mutation runtimes centrally validate provider candidates before mutating", () => {
  const runtime = createEntityMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;

  try {
    runtime.providerMutationRuntime.createProvider(undefined, "provider_test", {
      endpoint: "https://127.0.0.1/v1/chat/completions",
      api_mode: "openai-completions",
      api_key_env: null
    });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /Service provider 'provider_test' targets a private or local endpoint/);
  assert.equal(error.code, "invalid_input_field");
  assert.equal(runtime.getMutateCallCount(), 0);
});

void test("mutable provider validation returns only validated provider fields", () => {
  assert.deepEqual(
    validateMutableProviderEntity("provider_test", {
      endpoint: "https://example.test/v1/chat/completions",
      api_mode: "openai-completions",
      api_key: "sk-inline-secret"
    }),
    {
      endpoint: "https://example.test/v1/chat/completions",
      api_mode: "openai-completions",
      model_id_format: "passthrough",
      allow_private_endpoints: false,
      allow_insecure_http: false,
      api_key: "sk-inline-secret"
    }
  );
});

void test("pickCostFields returns the canonical mutable cost shape", () => {
  assert.deepEqual(
    pickCostFields({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      extra_future_field: 5
    } as unknown as Parameters<typeof pickCostFields>[0]),
    {
      input: 1,
      output: 2,
      cache_read: 3,
      cache_write: 4
    }
  );
});

void test("model mutation runtime owns entity validation", () => {
  let mutateCallCount = 0;
  let error: (Error & { code?: string }) | null = null;
  const runtime = createModelMutationRuntime({
    loadCliReadModel: () => ({
      modelsByName: {}
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ models: Object.create(null) as Record<string, unknown> });
    },
    getMutableModels: (document) => document["models"] as Record<string, unknown>,
    createModelAlreadyExistsError: (modelId) => new Error(`model exists ${modelId}`),
    createModelNotFoundError: (modelId) => new Error(`model missing ${modelId}`),
    createModelInUseError: (modelId, routeCount) => new Error(`model in use ${modelId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredModelError: (modelId) => new Error(`invalid model ${modelId}`)
  });

  try {
    runtime.createModel(undefined, "model_test", { model_creator: "openai" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /Model 'model_test' is missing a valid 'display_name' value\./);
  assert.equal(error.code, "invalid_input_field");
  assert.equal(mutateCallCount, 0);
});

void test("provider mutation runtime owns entity validation", () => {
  let mutateCallCount = 0;
  let error: (Error & { code?: string }) | null = null;
  const runtime = createProviderMutationRuntime({
    loadCliReadModel: () => ({
      providersByName: {},
      routes: []
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ service_providers: Object.create(null) as Record<string, unknown> });
    },
    getMutableProviders: (document) => document["service_providers"] as Record<string, unknown>,
    createProviderAlreadyExistsError: (providerId) => new Error(`provider exists ${providerId}`),
    createProviderNotFoundError: (providerId) => new Error(`provider missing ${providerId}`),
    createProviderInUseError: (providerId, routeCount) => new Error(`provider in use ${providerId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredProviderError: (providerId) => new Error(`invalid provider ${providerId}`)
  });

  try {
    runtime.createProvider(undefined, "provider_test", {
      endpoint: "https://127.0.0.1/v1/chat/completions",
      api_mode: "openai-completions"
    });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /Service provider 'provider_test' targets a private or local endpoint/);
  assert.equal(error.code, "invalid_input_field");
  assert.equal(mutateCallCount, 0);
});

void test("route mutation runtime owns create-time entity validation", () => {
  const { runtime, getMutateCallCount } = createRouteMutationRuntimeForValidationTests();
  const invalidRouteCases: Array<{
    name: string;
    route: Record<string, unknown>;
    message: RegExp;
  }> = [
    {
      name: "missing display_name",
      route: {
        model: "model_test",
        service_provider: "provider_test",
        provider_model_id: "provider-model-test"
      },
      message: /Route 'route_new' is missing a valid 'display_name' value\./
    },
    {
      name: "empty provider_model_id",
      route: {
        model: "model_test",
        service_provider: "provider_test",
        provider_model_id: "",
        display_name: "Route New"
      },
      message: /Route 'route_new' is missing a valid 'provider_model_id' value\./
    },
    {
      name: "invalid timeout_ms",
      route: {
        model: "model_test",
        service_provider: "provider_test",
        provider_model_id: "provider-model-test",
        display_name: "Route New",
        timeout_ms: 0
      },
      message: /Route 'route_new' field 'timeout_ms' must be a positive integer when provided\./
    },
    {
      name: "incomplete cost",
      route: {
        model: "model_test",
        service_provider: "provider_test",
        provider_model_id: "provider-model-test",
        display_name: "Route New",
        cost: {
          input: 1,
          output: 2,
          cache_read: 0.5
        }
      },
      message: /Route 'route_new' field 'cost' must contain a non-negative numeric 'cache_write'\./
    }
  ];

  for (const testCase of invalidRouteCases) {
    let error: (Error & { code?: string }) | null = null;

    try {
      runtime.createRoute(undefined, "route_new", testCase.route);
    } catch (caught) {
      error = caught as Error & { code?: string };
    }

    assert.ok(error, testCase.name);
    assert.match(error.message, testCase.message, testCase.name);
    assert.equal(error.code, "invalid_input_field", testCase.name);
  }

  assert.equal(getMutateCallCount(), 0);
});

void test("route mutation runtime validates update final state before writing", () => {
  const { runtime, routeStore, getMutateCallCount } = createRouteMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;

  try {
    runtime.updateRoute(undefined, "route_test", { provider_model_id: "" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /Route 'route_test' is missing a valid 'provider_model_id' value\./);
  assert.equal(error.code, "invalid_input_field");
  assert.equal(getMutateCallCount(), 1);
  assert.equal((routeStore["route_test"] as Record<string, unknown>)["provider_model_id"], "provider-model-test");
});

void test("route mutation runtime owns final-state reference validation", () => {
  const { runtime, routeStore, getMutateCallCount } = createRouteMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;

  try {
    runtime.updateRoute(undefined, "route_test", { service_provider: "missing_provider" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /unknown provider route_test missing_provider/);
  assert.equal(error.code, "unknown_service_provider");
  assert.equal(getMutateCallCount(), 1);
  assert.equal((routeStore["route_test"] as Record<string, unknown>)["service_provider"], "provider_test");
});

void test("model mutation runtime rejects non-object stored models without rewriting them", () => {
  let mutateCallCount = 0;
  let error: (Error & { code?: string }) | null = null;
  const modelStore: Record<string, unknown> = {
    model_test: "not-an-object"
  };
  const runtime = createModelMutationRuntime({
    loadCliReadModel: () => ({
      modelsByName: {
        model_test: {
          name: "model_test",
          display_name: "Model Test",
          model_creator: "openai",
          route_count: 0,
          cost: null
        }
      }
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ models: modelStore });
    },
    getMutableModels: (document) => document["models"] as Record<string, unknown>,
    createModelAlreadyExistsError: (modelId) => new Error(`model exists ${modelId}`),
    createModelNotFoundError: (modelId) => new Error(`model missing ${modelId}`),
    createModelInUseError: (modelId, routeCount) => new Error(`model in use ${modelId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredModelError: (modelId) => createInvalidConfigMutationError(`invalid model ${modelId}`)
  });

  try {
    runtime.updateModel(undefined, "model_test", { display_name: "Updated Model Test" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /invalid model model_test/);
  assert.equal(error.code, "invalid_config_mutation");
  assert.equal(mutateCallCount, 1);
  assert.equal(modelStore["model_test"], "not-an-object");
});

void test("provider mutation runtime rejects non-object stored providers without rewriting them", () => {
  let mutateCallCount = 0;
  let error: (Error & { code?: string }) | null = null;
  const providerStore: Record<string, unknown> = {
    provider_test: ["not-an-object"]
  };
  const runtime = createProviderMutationRuntime({
    loadCliReadModel: () => ({
      providersByName: {
        provider_test: { name: "provider_test" }
      },
      routes: []
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ service_providers: providerStore });
    },
    getMutableProviders: (document) => document["service_providers"] as Record<string, unknown>,
    createProviderAlreadyExistsError: (providerId) => new Error(`provider exists ${providerId}`),
    createProviderNotFoundError: (providerId) => new Error(`provider missing ${providerId}`),
    createProviderInUseError: (providerId, routeCount) => new Error(`provider in use ${providerId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredProviderError: (providerId) => createInvalidConfigMutationError(`invalid provider ${providerId}`)
  });

  try {
    runtime.updateProvider(undefined, "provider_test", { endpoint: "https://example.test/v1/chat/completions" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /invalid provider provider_test/);
  assert.equal(error.code, "invalid_config_mutation");
  assert.equal(mutateCallCount, 1);
  assert.deepEqual(providerStore["provider_test"], ["not-an-object"]);
});

void test("provider mutation runtime rejects malformed stored auth fields before applying unrelated updates", () => {
  let mutateCallCount = 0;
  let error: (Error & { code?: string }) | null = null;
  const originalProvider = {
    endpoint: "https://example.test/v1/chat/completions",
    api_mode: "openai-completions",
    api_key: 123
  };
  const providerStore: Record<string, unknown> = {
    provider_test: originalProvider
  };
  const runtime = createProviderMutationRuntime({
    loadCliReadModel: () => ({
      providersByName: {
        provider_test: { name: "provider_test" }
      },
      routes: []
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutateCallCount += 1;
      mutator({ service_providers: providerStore });
    },
    getMutableProviders: (document) => document["service_providers"] as Record<string, unknown>,
    createProviderAlreadyExistsError: (providerId) => new Error(`provider exists ${providerId}`),
    createProviderNotFoundError: (providerId) => new Error(`provider missing ${providerId}`),
    createProviderInUseError: (providerId, routeCount) => new Error(`provider in use ${providerId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredProviderError: (providerId) => createInvalidConfigMutationError(`invalid provider ${providerId}`)
  });

  try {
    runtime.updateProvider(undefined, "provider_test", { endpoint: "https://example.test/v2/chat/completions" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /invalid provider provider_test/);
  assert.equal(error.code, "invalid_config_mutation");
  assert.equal(mutateCallCount, 1);
  assert.equal(providerStore["provider_test"], originalProvider);
  assert.equal(originalProvider.endpoint, "https://example.test/v1/chat/completions");
});

void test("route mutation runtime rejects non-object stored routes without rewriting them", () => {
  const { runtime, routeStore, getMutateCallCount } = createRouteMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;
  routeStore["route_test"] = null;

  try {
    runtime.updateRoute(undefined, "route_test", { display_name: "Updated Route Test" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /invalid route route_test/);
  assert.equal(error.code, "invalid_config_mutation");
  assert.equal(getMutateCallCount(), 1);
  assert.equal(routeStore["route_test"], null);
});

void test("route mutation runtime rejects malformed stored routes before applying unrelated updates", () => {
  const { runtime, routeStore, getMutateCallCount } = createRouteMutationRuntimeForValidationTests();
  let error: (Error & { code?: string }) | null = null;
  const originalRoute = {
    model: "model_test",
    service_provider: "provider_test",
    display_name: "Route Test"
  };
  routeStore["route_test"] = originalRoute;

  try {
    runtime.updateRoute(undefined, "route_test", { display_name: "Updated Route Test" });
  } catch (caught) {
    error = caught as Error & { code?: string };
  }

  assert.ok(error);
  assert.match(error.message, /invalid route route_test/);
  assert.equal(error.code, "invalid_config_mutation");
  assert.equal(getMutateCallCount(), 1);
  assert.equal(routeStore["route_test"], originalRoute);
  assert.equal(originalRoute.display_name, "Route Test");
});

void test("config mutation lock blocks concurrent writers and cleans up after release", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-lock-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(configPath, "{}\n", "utf8");

    const result = withConfigMutationLock(configPath, () => {
      assert.equal(existsSync(`${configPath}.lock`), true);
      assert.throws(
        () => withConfigMutationLock(configPath, () => undefined),
        /already being modified by another process/
      );
      return "locked";
    });

    assert.equal(result, "locked");
    assert.equal(existsSync(`${configPath}.lock`), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock reclaims stale lock files left by dead processes", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-stale-lock-test-"));
  const configPath = path.join(tempDir, "config.json");
  const lockPath = `${configPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    writeConfigMutationLockForTests(lockPath, {
      pid: 999_999_999,
      created_at: "2000-01-01T00:00:00.000Z"
    });

    const result = withConfigMutationLock(configPath, () => "reclaimed");

    assert.equal(result, "reclaimed");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock canonicalizes symlinked config paths to one shared lock file", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-symlink-lock-test-"));
  const configPath = path.join(tempDir, "config.json");
  const symlinkPath = path.join(tempDir, "config-link.json");
  const canonicalLockPath = `${configPath}.lock`;
  const symlinkLockPath = `${symlinkPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    symlinkSync(configPath, symlinkPath);

    const result = withConfigMutationLock(symlinkPath, () => {
      assert.equal(existsSync(canonicalLockPath), true);
      assert.equal(existsSync(symlinkLockPath), false);
      assert.throws(
        () => withConfigMutationLock(configPath, () => undefined),
        /already being modified by another process/
      );
      return "canonicalized";
    });

    assert.equal(result, "canonicalized");
    assert.equal(existsSync(canonicalLockPath), false);
    assert.equal(existsSync(symlinkLockPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock ignores live pid checks for stale locks owned by a different hostname", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-host-lock-test-"));
  const configPath = path.join(tempDir, "config.json");
  const lockPath = `${configPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    writeConfigMutationLockForTests(lockPath, {
      pid: process.pid,
      hostname: "different-host.example.invalid",
      created_at: "2000-01-01T00:00:00.000Z"
    });

    const result = withConfigMutationLock(configPath, () => "reclaimed-foreign-host-lock");

    assert.equal(result, "reclaimed-foreign-host-lock");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock reclaims malformed stale lock files using filesystem age fallback", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-malformed-lock-test-"));
  const configPath = path.join(tempDir, "config.json");
  const lockPath = `${configPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    writeFileSync(lockPath, "{not-json", "utf8");
    utimesSync(lockPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

    const result = withConfigMutationLock(configPath, () => "reclaimed-malformed");

    assert.equal(result, "reclaimed-malformed");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock reclaims oversized stale lock metadata using filesystem age fallback", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-oversized-lock-test-"));
  const configPath = path.join(tempDir, "config.json");
  const lockPath = `${configPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    writeFileSync(lockPath, "x".repeat(4_097), "utf8");
    chmodSync(lockPath, 0o600);
    utimesSync(lockPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

    const result = withConfigMutationLock(configPath, () => "reclaimed-oversized");

    assert.equal(result, "reclaimed-oversized");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config backup snapshots with inline provider keys are written with secure permissions", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-backup-mode-test-"));
  const configPath = path.join(tempDir, "config.json");
  const backupPath = `${configPath}.bak`;

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          service_providers: {
            provider_test: {
              endpoint: "https://example.test/v1/chat/completions",
              api_mode: "openai-completions",
              api_key: "sk-inline-secret"
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(configPath, 0o644);

    writeConfigBackupSnapshot(configPath, backupPath);

    assert.equal(readFileSync(backupPath, "utf8"), readFileSync(configPath, "utf8"));
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation lock surfaces a distinct error when stale-lock recovery loses a race", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-stale-lock-race-test-"));
  const configPath = path.join(tempDir, "config.json");
  const lockPath = `${configPath}.lock`;

  try {
    writeFileSync(configPath, "{}\n", "utf8");
    writeConfigMutationLockForTests(lockPath, {
      pid: 999_999_999,
      created_at: "2000-01-01T00:00:00.000Z"
    });

    setConfigMutationLockTestHooksForTests({
      afterStaleLockRemoved: (removedLockPath) => {
        writeFileSync(
          removedLockPath,
          JSON.stringify({
            pid: process.pid,
            hostname: "race-winner.example.invalid",
            created_at: new Date().toISOString()
          }),
          "utf8"
        );
      }
    });

    assert.throws(
      () => withConfigMutationLock(configPath, () => "unreachable"),
      /had a stale mutation lock, but another process acquired the lock during recovery\. Retry the command\./
    );
  } finally {
    setConfigMutationLockTestHooksForTests(null);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation runtime serializes the full read mutate write cycle", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-mutation-runtime-lock-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeSplitConfigForTests(configPath, {
      port: 4080,
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      service_providers: {
        provider_test: {
          endpoint: "https://example.test/v1/chat/completions",
          api_mode: "openai-completions",
          api_key: "sk-inline-secret"
        }
      },
      models: {
        model_test: {
          display_name: "Model Test",
          model_creator: "openai"
        }
      },
      routes: {
        route_test: {
          model: "model_test",
          service_provider: "provider_test",
          provider_model_id: "provider-model-test",
          display_name: "Route Test"
        }
      }
    });

    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";

    const runtime = createConfigMutationRuntime({
      currentConfigVersion: CURRENT_CONFIG_VERSION,
      defaultMaxPayloadSize: 4_000_000,
      defaultSystemdUnit: "switchmaxxer.service",
      resolveCliConfigPath: () => configPath,
      loadConfigJsonDocument: () => {
        const document = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        return {
          sourcePath: configPath,
          sourceFile: path.basename(configPath),
          document
        };
      },
      assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
      getEnv: () => process.env
    });

    runtime.mutateConfigDocument(configPath, (document) => {
      document["bind_host"] = "127.0.0.2";
      assert.throws(
        () => runtime.mutateConfigDocument(configPath, () => undefined),
        /already being modified by another process/
      );
    });

    const written = JSON.parse(readFileSync(configPath, "utf8")) as {
      bind_host?: string;
      bindHost?: string;
      timeout_ms?: number;
      stream_idle_timeout_ms?: number;
      max_connections?: number;
      config_version?: number;
    };
    assert.equal(written["bind_host"], "127.0.0.2");
    assert.equal(written["bindHost"], undefined);
    assert.equal(written["timeout_ms"], 5_000);
    assert.equal(written["stream_idle_timeout_ms"], 5_000);
    assert.equal(written["max_connections"], 200);
    assert.equal(written["config_version"], CURRENT_CONFIG_VERSION);
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation runtime writes catalog-owned sections back to catalog.json", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-mutation-catalog-test-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          config_version: CURRENT_CONFIG_VERSION,
          port: 4080,
          timeout_ms: 5000,
          stream_idle_timeout_ms: 5000,
          inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
          allow_unauthenticated_gateway: false,
          max_payload_size: 4_000_000,
          rate_limit: {
            requests: 50,
            window: "1s"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    writeFileSync(
      catalogPath,
      JSON.stringify(
        {
          catalog_version: 1,
          service_providers: {
            provider_test: {
              endpoint: "https://example.test/v1/chat/completions",
              api_mode: "openai-completions",
              api_key: "sk-inline-secret"
            }
          },
          models: {
            model_test: {
              display_name: "Model Test",
              model_creator: "openai"
            }
          },
          routes: {
            route_test: {
              model: "model_test",
              service_provider: "provider_test",
              provider_model_id: "provider-model-test",
              display_name: "Route Test"
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(configPath, 0o600);
    chmodSync(catalogPath, 0o600);

    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";

    const runtime = createConfigMutationRuntime({
      currentConfigVersion: CURRENT_CONFIG_VERSION,
      defaultMaxPayloadSize: 4_000_000,
      defaultSystemdUnit: "switchmaxxer.service",
      resolveCliConfigPath: () => configPath,
      loadConfigJsonDocument: () => loadRawConfigJsonDocument(configPath),
      assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
      getEnv: () => process.env
    });

    runtime.mutateConfigDocument(configPath, (document) => {
      document["max_payload_size"] = 5_000_000;
      runtime.getMutableConfigSection(document, "models")["model_added"] = {
        display_name: "Model Added",
        model_creator: "switchmaxxer"
      };
    });

    const writtenConfig = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const writtenCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      models?: Record<string, unknown>;
      service_providers?: Record<string, unknown>;
      routes?: Record<string, unknown>;
    };

    assert.equal(writtenConfig["max_payload_size"], 5_000_000);
    assert.equal(writtenConfig["models"], undefined);
    assert.equal(writtenConfig["service_providers"], undefined);
    assert.equal(writtenConfig["routes"], undefined);
    assert.deepEqual(writtenCatalog.models?.["model_added"], {
      display_name: "Model Added",
      model_creator: "switchmaxxer"
    });
    assert.equal(typeof writtenCatalog.service_providers?.["provider_test"], "object");
    assert.equal(typeof writtenCatalog.routes?.["route_test"], "object");
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation runtime classifies missing flag values with the canonical usage code", () => {
  const runtime = createConfigMutationRuntime({
    currentConfigVersion: CURRENT_CONFIG_VERSION,
    defaultMaxPayloadSize: 4_000_000,
    defaultSystemdUnit: "switchmaxxer.service",
    resolveCliConfigPath: (configPath) => configPath ?? "/tmp/config.json",
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {}
    }),
    assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
    getEnv: () => ({})
  });

  assert.deepEqual(
    runtime.classifyCliUsageFailure(new Error("Flag '--api-mode' requires a value"), {
      usageFallbackCode: "config_import_error",
      mutationFallbackCode: "config_import_error",
      isUsageMessage: () => true
    }),
    {
      message: "Flag '--api-mode' requires a value",
      code: "missing_flag_value",
      exitCode: 2
    }
  );
});

void test("config mutation runtime rejects insecure inline-key config permissions before mutating", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-mutation-inline-mode-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          config_version: CURRENT_CONFIG_VERSION,
          bind_host: "127.0.0.1",
          port: 4080,
          timeout_ms: 5000,
          stream_idle_timeout_ms: 5000,
          max_connections: 200,
          max_payload_size: 4_000_000,
          rate_limit: {
            requests: 50,
            window: "1s"
          },
          allow_unauthenticated_gateway: true,
          service_providers: {
            provider_test: {
              endpoint: "https://api.example.com/v1",
              api_key: "sk-test-inline-secret",
              api_mode: "openai-completions"
            }
          },
          models: {
            model_test: {
              display_name: "Model Test",
              model_creator: "openai"
            }
          },
          routes: {
            route_test: {
              model: "model_test",
              service_provider: "provider_test",
              provider_model_id: "provider-model-test",
              display_name: "Route Test"
            }
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    chmodSync(configPath, 0o644);

    process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"] = "0123456789abcdef0123456789abcdef";

    const runtime = createConfigMutationRuntime({
      currentConfigVersion: CURRENT_CONFIG_VERSION,
      defaultMaxPayloadSize: 4_000_000,
      defaultSystemdUnit: "switchmaxxer.service",
      resolveCliConfigPath: () => configPath,
      loadConfigJsonDocument: () => loadConfigJsonDocument(configPath),
      assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
      getEnv: () => process.env
    });

    assert.throws(
      () =>
        runtime.mutateConfigDocument(configPath, (document) => {
          document["bind_host"] = "127.0.0.2";
        }),
      /has insecure mode 0644;.*Run: chmod 0600 .+config\.json/
    );

    const written = JSON.parse(readFileSync(configPath, "utf8")) as { bind_host?: string };
    assert.equal(written["bind_host"], "127.0.0.1");
  } finally {
    delete process.env["SWITCHMAXXER_TEST_INBOUND_AUTH"];
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("config mutation normalization returns a new document and does not partially mutate the input on failure", () => {
  const runtime = createConfigMutationRuntime({
    currentConfigVersion: CURRENT_CONFIG_VERSION,
    defaultMaxPayloadSize: 4_000_000,
    defaultSystemdUnit: "switchmaxxer.service",
    resolveCliConfigPath: (configPath) => configPath ?? "/tmp/config.json",
    loadConfigJsonDocument: () => ({
      sourcePath: "/tmp/config.json",
      sourceFile: "config.json",
      document: {}
    }),
    assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
    getEnv: () => ({})
  });

  const document: Record<string, unknown> = {
    port: 4080,
    bind_host: "127.0.0.1",
    timeout_ms: 5_000,
    stream_idle_timeout_ms: 5_000,
    inbound_api_key_env: "SWITCHMAXXER_MISSING_TEST_KEY",
    rate_limit: {
      requests: 10,
      window: "1s"
    },
    systemd_unit: "switchmaxxer.service",
    service_providers: {},
    models: {},
    routes: {}
  };

  assert.throws(
    () => runtime.normalizeAndValidateConfigDocumentForMutation(document),
    /requires environment variable 'SWITCHMAXXER_MISSING_TEST_KEY'/
  );

  assert.equal(document["bind_host"], "127.0.0.1");
  assert.equal(document["config_version"], undefined);
  assert.equal(document["max_payload_size"], undefined);
  assert.equal(document["max_connections"], undefined);
});

void test("config mutation runtime loads the mutable config document only once per locked mutation", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-config-single-load-test-"));
  const configPath = path.join(tempDir, "config.json");
  let loadCount = 0;

  try {
    writeSplitConfigForTests(configPath, {
      port: 4080,
      bind_host: "127.0.0.1",
      timeout_ms: 5_000,
      stream_idle_timeout_ms: 5_000,
      inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
      rate_limit: {
        requests: 10,
        window: "1s"
      },
      systemd_unit: "switchmaxxer.service",
      service_providers: {},
      models: {},
      routes: {}
    });

    const runtime = createConfigMutationRuntime({
      currentConfigVersion: CURRENT_CONFIG_VERSION,
      defaultMaxPayloadSize: 4_000_000,
      defaultSystemdUnit: "switchmaxxer.service",
      resolveCliConfigPath: (candidatePath) => candidatePath ?? configPath,
      loadConfigJsonDocument: () => {
        loadCount += 1;
        return {
          sourcePath: configPath,
          sourceFile: "config.json",
          document: {
            port: 4080,
            bind_host: "127.0.0.1",
            timeout_ms: 5_000,
            stream_idle_timeout_ms: 5_000,
            inbound_api_key_env: "SWITCHMAXXER_TEST_INBOUND_AUTH",
            rate_limit: {
              requests: 10,
              window: "1s"
            },
            systemd_unit: "switchmaxxer.service"
          }
        };
      },
      assertSafeCliConfigIdentifier: (_value: string, _label: string) => undefined,
      getEnv: () => ({
        SWITCHMAXXER_TEST_INBOUND_AUTH: "0123456789abcdef0123456789abcdef"
      })
    });

    runtime.mutateConfigDocument(configPath, (document) => {
      document["bind_host"] = "127.0.0.2";
    });

    assert.equal(loadCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("model mutation runtime rejects reserved keys at the write site", () => {
  const runtime = createModelMutationRuntime({
    loadCliReadModel: () => ({
      modelsByName: {
        model_test: {
          name: "model_test",
          display_name: "Model Test",
          model_creator: "openai",
          route_count: 0,
          cost: null
        }
      }
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutator({ models: Object.create(null) as Record<string, unknown> });
    },
    getMutableModels: (document) => document["models"] as Record<string, unknown>,
    createModelAlreadyExistsError: (modelId) => new Error(`model exists ${modelId}`),
    createModelNotFoundError: (modelId) => new Error(`model missing ${modelId}`),
    createModelInUseError: (modelId, routeCount) => new Error(`model in use ${modelId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredModelError: (modelId) => new Error(`invalid model ${modelId}`)
  });

  const requested = createStringKeyRecord<unknown>();
  requested["display_name"] = "Model Test";
  requested["model_creator"] = "openai";
  requested["__proto__"] = "bad";

  assert.throws(
    () => runtime.createModel(undefined, "model_test_2", requested),
    /Model field '__proto__' is reserved and cannot be used\./
  );
});

void test("provider mutation runtime rejects reserved keys at the write site", () => {
  const runtime = createProviderMutationRuntime({
    loadCliReadModel: () => ({
      providersByName: {
        provider_test: { name: "provider_test" }
      },
      routes: []
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutator({
        service_providers: {
          provider_test: {
            endpoint: "https://example.test/v1",
            api_mode: "openai-completions",
            api_key_env: null
          }
        }
      });
    },
    getMutableProviders: (document) => document["service_providers"] as Record<string, unknown>,
    createProviderAlreadyExistsError: (providerId) => new Error(`provider exists ${providerId}`),
    createProviderNotFoundError: (providerId) => new Error(`provider missing ${providerId}`),
    createProviderInUseError: (providerId, routeCount) => new Error(`provider in use ${providerId} ${routeCount}`),
    createInvalidInputMutationError,
    createInvalidStoredProviderError: (providerId) => new Error(`invalid provider ${providerId}`)
  });

  const changes = createStringKeyRecord<unknown>();
  changes["constructor"] = "bad";

  assert.throws(
    () => runtime.updateProvider(undefined, "provider_test", changes),
    /Provider field 'constructor' is reserved and cannot be used\./
  );
});

void test("route mutation runtime rejects reserved keys at the write site", () => {
  const runtime = createRouteMutationRuntime({
    loadCliReadModel: () => ({
      routesByName: {
        route_test: { name: "route_test" }
      },
      modelsByName: {
        model_test: {}
      },
      providersByName: {
        provider_test: {}
      }
    }),
    mutateConfigDocument: (_configPath, mutator) => {
      mutator({
        routes: {
          route_test: {
            model: "model_test",
            service_provider: "provider_test",
            provider_model_id: "provider-model-test",
            display_name: "Route Test"
          }
        }
      });
    },
    getMutableRoutes: (document) => document["routes"] as Record<string, unknown>,
    createRouteAlreadyExistsError: (routeId) => new Error(`route exists ${routeId}`),
    createRouteNotFoundError: (routeId) => new Error(`route missing ${routeId}`),
    createUnknownModelError: (routeId, modelId) => new Error(`unknown model ${routeId} ${modelId}`),
    createUnknownServiceProviderError: (routeId, providerId) => new Error(`unknown provider ${routeId} ${providerId}`),
    createInvalidInputMutationError,
    createInvalidStoredRouteError: (routeId) => new Error(`invalid route ${routeId}`)
  });

  const changes = createStringKeyRecord<unknown>();
  changes["__proto__"] = "bad";

  assert.throws(
    () => runtime.updateRoute(undefined, "route_test", changes),
    /Route field '__proto__' is reserved and cannot be used\./
  );
});
