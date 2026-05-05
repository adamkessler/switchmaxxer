#!/usr/bin/env node

const { mkdirSync, readdirSync, createWriteStream } = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const SMOKE_TEST_SCRIPTS = new Set([
  "tests/test-001-model-create-delete.sh",
  "tests/test-002-provider-create-delete.sh",
  "tests/test-003-route-create-delete.sh",
  "tests/test-006-test-command-path-semantics.sh",
  "tests/test-007-logging-lwts-contract.sh",
  "tests/test-008-debug-event-taxonomy.sh",
  "tests/test-009-debug-error-stages.sh",
  "tests/test-010-log-json-debug-contract.sh",
  "tests/test-011-observability-suite.sh",
  "tests/test-024-streaming-backpressure.sh",
  "tests/test-027-gateway-inbound-auth-contract.sh",
  "tests/test-029-cli-equals-flags.sh"
]);

const ENV_DEPENDENT_SCRIPTS = new Set([
  "tests/test-004-invoke-content-encoding-regression.sh",
  "tests/test-005-invoke-all-routes.sh"
]);

function timestampForPath(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") +
    "-" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

function resolveLogRoot(repoRoot) {
  if (typeof process.env.SWITCHMAXXER_TEST_LOG_DIR === "string" && process.env.SWITCHMAXXER_TEST_LOG_DIR.trim().length > 0) {
    return path.resolve(process.env.SWITCHMAXXER_TEST_LOG_DIR);
  }

  return path.join(repoRoot, ".switchmaxxer", "test-logs", "integration", timestampForPath(new Date()));
}

function normalizeMode(mode) {
  if (mode === "env" || mode === "all" || mode === "self-contained" || mode === "smoke") {
    return mode;
  }

  return "smoke";
}

function listIntegrationScripts(repoRoot, mode) {
  const testsDir = path.join(repoRoot, "tests");
  const allScripts = readdirSync(testsDir)
    .filter((entry) => /^test-\d+.*\.sh$/.test(entry))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join("tests", entry));

  if (mode === "all") {
    return allScripts;
  }

  if (mode === "env") {
    return allScripts.filter((scriptPath) => ENV_DEPENDENT_SCRIPTS.has(scriptPath));
  }

  if (mode === "smoke") {
    return allScripts.filter((scriptPath) => SMOKE_TEST_SCRIPTS.has(scriptPath));
  }

  return allScripts.filter((scriptPath) => !ENV_DEPENDENT_SCRIPTS.has(scriptPath));
}

function buildIntegrationEnv() {
  return {
    ...process.env,
    MCP_READ_TIMEOUT_SECONDS: process.env.MCP_READ_TIMEOUT_SECONDS || "30",
    SWITCHMAXXER_INBOUND_API_KEY: process.env.SWITCHMAXXER_INBOUND_API_KEY || "12345678901234567890123456789012",
    SWITCHMAXXER_OPENAI_API_KEY: process.env.SWITCHMAXXER_OPENAI_API_KEY || "test-openai-key",
    SWITCHMAXXER_ANTHROPIC_API_KEY: process.env.SWITCHMAXXER_ANTHROPIC_API_KEY || "test-anthropic-key",
    SWITCHMAXXER_OPENROUTER_API_KEY: process.env.SWITCHMAXXER_OPENROUTER_API_KEY || "test-openrouter-key",
    SWITCHMAXXER_MINIMAX_API_KEY: process.env.SWITCHMAXXER_MINIMAX_API_KEY || "test-minimax-key"
  };
}

function runScript(repoRoot, scriptPath, logRoot) {
  return new Promise((resolve) => {
    const baseName = path.basename(scriptPath, ".sh");
    const logPath = path.join(logRoot, `${baseName}.log`);
    const logStream = createWriteStream(logPath, { flags: "w" });
    const child = spawn("bash", [scriptPath], {
      cwd: repoRoot,
      env: buildIntegrationEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    const writeChunk = (chunk) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      logStream.write(text);
    };

    child.stdout.on("data", writeChunk);
    child.stderr.on("data", writeChunk);

    child.on("error", (error) => {
      logStream.end();
      resolve({
        ok: false,
        scriptPath,
        logPath,
        reason: `Unable to launch ${scriptPath}: ${error.message}`
      });
    });

    child.on("close", (code, signal) => {
      logStream.end();
      if (code === 0) {
        resolve({
          ok: true,
          scriptPath,
          logPath
        });
        return;
      }

      const reason = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
      resolve({
        ok: false,
        scriptPath,
        logPath,
        reason: `${scriptPath} failed with ${reason}. Log: ${logPath}`
      });
    });
  });
}

function runBuild(repoRoot) {
  process.stdout.write("Building project before integration scripts\n");
  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (result.status === 0) {
    process.stdout.write("PASS npm run build completed\n\n");
    return;
  }

  const reason = result.status === null
    ? `signal ${result.signal ?? "unknown"}`
    : `exit code ${result.status}`;
  throw new Error(`npm run build failed before integration scripts (${reason}).`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const logRoot = resolveLogRoot(repoRoot);
  const mode = normalizeMode(process.argv[2]);
  mkdirSync(logRoot, { recursive: true });

  const scripts = listIntegrationScripts(repoRoot, mode);
  if (scripts.length === 0) {
    console.error(`No integration scripts matched mode '${mode}'.`);
    process.exit(1);
  }

  process.stdout.write(`Running ${scripts.length} integration scripts (mode: ${mode})\n`);
  process.stdout.write(`Logs: ${logRoot}\n\n`);

  runBuild(repoRoot);

  const failures = [];

  for (const scriptPath of scripts) {
    process.stdout.write(`=== ${scriptPath} ===\n`);
    const result = await runScript(repoRoot, scriptPath, logRoot);

    if (result.ok) {
      process.stdout.write(`PASS ${scriptPath}\n\n`);
      continue;
    }

    failures.push(result);
    process.stdout.write(`FAIL ${scriptPath}\n`);
    process.stdout.write(`${result.reason}\n\n`);
  }

  const passedCount = scripts.length - failures.length;
  process.stdout.write(
    `Integration suite summary (${mode}): ${passedCount} passed, ${failures.length} failed, ${scripts.length} total\n`
  );
  process.stdout.write(`Logs: ${logRoot}\n`);

  if (failures.length === 0) {
    process.stdout.write("PASS integration suite completed successfully.\n");
    return;
  }

  process.stdout.write("\nFailed scripts:\n");
  for (const failure of failures) {
    process.stdout.write(`- ${failure.scriptPath}\n`);
    process.stdout.write(`  ${failure.reason}\n`);
  }

  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
