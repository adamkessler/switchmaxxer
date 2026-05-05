import assert from "node:assert/strict";
import test from "node:test";

import { createToolCli } from "./tool";

function readLongFlagValue(
  argv: string[],
  index: number,
  flagName: string,
  missingValueMessage?: string
):
  | {
      value?: string;
      consumed: number;
      errorMessage?: string;
    }
  | null {
  if (argv[index] !== flagName) {
    return null;
  }

  const next = argv[index + 1];
  if (typeof next === "undefined" || next.startsWith("--")) {
    return {
      consumed: 0,
      errorMessage: missingValueMessage ?? `Flag '${flagName}' requires a value`
    };
  }

  return {
    value: next,
    consumed: 1
  };
}

void test("tool date reports unknown flags through the local usage path", async () => {
  let usageMessage: string | null = null;

  const cli = createToolCli({
    runRegisteredCommandFamily: async () => {
      throw new Error("did not expect family handler");
    },
    runHelpAwareCommand: async (_argv, options) => await options.run(_argv),
    readLongFlagValue,
    loadConfigJsonDocument: () => {
      throw new Error("did not expect config loading");
    },
    fetchGatewayRuntimeConfigPayload: async () => {
      throw new Error("did not expect runtime config fetch");
    },
    printUsageError: (message) => {
      usageMessage = message;
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJsonSuccessEnvelope: () => {
      throw new Error("did not expect json success envelope");
    },
    writeJsonErrorEnvelope: () => {
      throw new Error("did not expect json error envelope");
    }
  });

  const command = cli.getCommandRegistry().find((entry) => entry.name === "date");
  assert.ok(command, "expected tool date command registration");

  const exitCode = await command.run(["--bogus"]);
  assert.equal(exitCode, 2);
  assert.equal(usageMessage, "Unknown flag '--bogus'");
});

void test("tool uptime reports missing --config values before trying to load config", async () => {
  let usageMessage: string | null = null;

  const cli = createToolCli({
    runRegisteredCommandFamily: async () => {
      throw new Error("did not expect family handler");
    },
    runHelpAwareCommand: async (_argv, options) => await options.run(_argv),
    readLongFlagValue,
    loadConfigJsonDocument: () => {
      throw new Error("did not expect config loading");
    },
    fetchGatewayRuntimeConfigPayload: async () => {
      throw new Error("did not expect runtime config fetch");
    },
    printUsageError: (message) => {
      usageMessage = message;
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJsonSuccessEnvelope: () => {
      throw new Error("did not expect json success envelope");
    },
    writeJsonErrorEnvelope: () => {
      throw new Error("did not expect json error envelope");
    }
  });

  const command = cli.getCommandRegistry().find((entry) => entry.name === "uptime");
  assert.ok(command, "expected tool uptime command registration");

  const exitCode = await command.run(["--config"]);
  assert.equal(exitCode, 2);
  assert.equal(usageMessage, "Flag '--config' requires a path value");
});

void test("tool random emits a typed json success envelope locally", async () => {
  const jsonEnvelopes: Array<{ command: string; data: unknown }> = [];

  const cli = createToolCli({
    runRegisteredCommandFamily: async () => {
      throw new Error("did not expect family handler");
    },
    runHelpAwareCommand: async (_argv, options) => await options.run(_argv),
    readLongFlagValue,
    loadConfigJsonDocument: () => {
      throw new Error("did not expect config loading");
    },
    fetchGatewayRuntimeConfigPayload: async () => {
      throw new Error("did not expect runtime config fetch");
    },
    printUsageError: () => {
      throw new Error("did not expect usage error");
    },
    writeStdout: () => {},
    writeStderr: () => {},
    writeJsonSuccessEnvelope: (command, data) => {
      jsonEnvelopes.push({ command, data });
    },
    writeJsonErrorEnvelope: () => {
      throw new Error("did not expect json error envelope");
    }
  });

  const command = cli.getCommandRegistry().find((entry) => entry.name === "random");
  assert.ok(command, "expected tool random command registration");

  const exitCode = await command.run(["--json"]);
  assert.equal(exitCode, 0);
  assert.equal(jsonEnvelopes.length, 1);
  assert.equal(jsonEnvelopes[0]?.command, "tool random");
  assert.equal(typeof (jsonEnvelopes[0]?.data as { value?: unknown })?.value, "number");
});
