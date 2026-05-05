import assert from "node:assert/strict";
import test from "node:test";

import { buildCliAppRegistries } from "./app-registry";
import {
  createCliEntrypointErrorGuard,
  GENERIC_CLI_ENTRYPOINT_FAILURE_MESSAGE
} from "./entrypoint-error-guard";

void test("CLI entrypoint guard converts unexpected json-mode throws into a stable internal_error envelope", async () => {
  const writes: Array<Record<string, string>> = [];
  const usageContexts: Array<{ command: string; json: boolean }> = [];
  const guard = createCliEntrypointErrorGuard({
    writeJsonErrorEnvelope: (command, code, message) => {
      writes.push({ channel: "json", command, code, message });
    },
    writeStderr: (message) => {
      writes.push({ channel: "stderr", message });
    },
    runWithUsageContext: async (context, fn) => {
      usageContexts.push(context);
      return await fn();
    }
  });

  const exitCode = await guard.runCliEntrypoint("models", ["create", "--json"], async () => {
    throw new Error("boom");
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(usageContexts, [{ command: "models", json: true }]);
  assert.deepEqual(writes, [
    {
      channel: "json",
      command: "models",
      code: "internal_error",
      message: GENERIC_CLI_ENTRYPOINT_FAILURE_MESSAGE
    }
  ]);
});

void test("CLI entrypoint guard writes sanitized stderr for unexpected non-json throws", async () => {
  const stderr: string[] = [];
  const guard = createCliEntrypointErrorGuard({
    writeJsonErrorEnvelope: () => {
      throw new Error("json envelope should not be written for non-json failures");
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    runWithUsageContext: async (_context, fn) => await fn()
  });

  const exitCode = await guard.runCliEntrypoint("trace", ["list"], async () => {
    throw new Error("unexpected trace failure");
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stderr, ["trace failed: unexpected trace failure"]);
});

void test("CLI entrypoint guard redacts absolute file paths in unexpected stderr details", async () => {
  const stderr: string[] = [];
  const guard = createCliEntrypointErrorGuard({
    writeJsonErrorEnvelope: () => {
      throw new Error("json envelope should not be written for non-json failures");
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    runWithUsageContext: async (_context, fn) => await fn()
  });

  const exitCode = await guard.runCliEntrypoint("trace", ["list"], async () => {
    throw new Error("unexpected trace failure at /tmp/switchmaxxer/private-config.json");
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stderr, ["trace failed: unexpected trace failure at <path>"]);
});

void test("CLI app registry routes every registered top-level entry through the shared entrypoint guard", async () => {
  const seenCommands = new Set<string>();
  const registries = buildCliAppRegistries({
    runCliEntrypoint: async (commandName, argv, runCommand) => {
      seenCommands.add(commandName);
      return await runCommand(argv);
    },
    printConfigHelp: () => undefined,
    printGatewayHelp: () => undefined,
    printTestHelp: () => undefined,
    printBenchHelp: () => undefined,
    printLedgerHelp: () => undefined,
    printModelsHelp: () => undefined,
    printProvidersHelp: () => undefined,
    printPruneHelp: () => undefined,
    printRoutesHelp: () => undefined,
    printToolHelp: () => undefined,
    printOptimizeHelp: () => undefined,
    printTraceHelp: () => undefined,
    writeMcpHelp: () => undefined,
    printInvokeHelp: () => undefined,
    printTopLevelHelp: () => undefined,
    printVersion: () => undefined,
    printHelpTopic: () => false,
    printUsageError: () => undefined,
    handleConfigCommand: async () => 0,
    handleGatewayCommand: async () => 0,
    handleTestCommand: async () => 0,
    handleBenchCommand: async () => 0,
    handleLedgerCommand: async () => 0,
    handleModelsCommand: async () => 0,
    handleProvidersCommand: async () => 0,
    handlePruneCommand: async () => 0,
    handleRoutesCommand: async () => 0,
    handleToolCommand: async () => 0,
    handleOptimizeCommand: async () => 0,
    handleTraceCommand: async () => 0,
    handleMcpCommand: async () => 0,
    runInvokeCommand: async () => 0,
    runDefaultGatewayEntry: async () => 0
  });

  for (const command of registries.cliCommandRegistry) {
    const matchedArgs = command.match([command.name]);
    assert.ok(matchedArgs !== null, `Expected top-level command '${command.name}' to match itself.`);
    await command.run(matchedArgs);
  }

  for (const command of registries.globalMetaCommandRegistry) {
    const seedArg =
      command.name === "--help" ? "--help" :
      command.name === "version" ? "version" :
      "help";
    const matchedArgs = command.match([seedArg]);
    assert.ok(matchedArgs !== null, `Expected meta command '${command.name}' to match '${seedArg}'.`);
    await command.run(matchedArgs);
  }

  for (const command of registries.defaultEntryCommandRegistry) {
    const matchedArgs = command.match([]);
    assert.ok(matchedArgs !== null, `Expected default entry '${command.name}' to match an empty argv.`);
    await command.run(matchedArgs);
  }

  assert.deepEqual(
    [...seenCommands].sort(),
    [
      "bench",
      "config",
      "gateway",
      "gateway run",
      "help",
      "invoke",
      "ledger",
      "mcp",
      "models",
      "optimize",
      "providers",
      "prune",
      "routes",
      "test",
      "tool",
      "trace",
      "version"
    ]
  );
});
