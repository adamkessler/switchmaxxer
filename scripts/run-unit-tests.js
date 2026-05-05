#!/usr/bin/env node

const { mkdtempSync, readdirSync, rmSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TEST_TIMEOUT_MS = 60_000;

function listCompiledUnitTests(repoRoot, rootDir) {
  const discovered = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir).sort((left, right) => left.localeCompare(right));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry);
      const stats = statSync(absolutePath);

      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (stats.isFile() && entry.endsWith(".test.js")) {
        discovered.push(path.relative(repoRoot, absolutePath));
      }
    }
  }

  walk(rootDir);
  return discovered;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const distRoot = path.join(repoRoot, "dist");
  const compiledTests = listCompiledUnitTests(repoRoot, distRoot);

  if (compiledTests.length === 0) {
    process.stderr.write("No compiled unit tests were found under dist/.\n");
    process.exit(1);
  }

  // Isolate the test process from the developer's ~/.config/switchmaxxer/secrets.json.
  // resolveDefaultSecretsPath checks XDG_CONFIG_HOME before HOME; pointing it at an
  // empty temp dir ensures loadOptionalConfiguredSecretsFile() finds no overrides
  // unless a test sets SWITCHMAXXER_SECRETS_PATH explicitly.
  const isolatedXdgConfigHome = mkdtempSync(path.join(tmpdir(), "switchmaxxer-test-xdg-"));
  process.on("exit", () => {
    rmSync(isolatedXdgConfigHome, { recursive: true, force: true });
  });

  const failedTests = [];

  for (const compiledTest of compiledTests) {
    process.stdout.write(`Running ${compiledTest}\n`);
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        "node",
        ["--enable-source-maps", "--test", "--test-force-exit", compiledTest],
        {
          cwd: repoRoot,
          env: { ...process.env, XDG_CONFIG_HOME: isolatedXdgConfigHome },
          stdio: "inherit"
        }
      );
      let settled = false;
      let timedOut = false;
      let forcedKillTimer = null;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        timedOut = true;
        process.stderr.write(`${compiledTest} timed out after ${DEFAULT_TEST_TIMEOUT_MS}ms; terminating test process.\n`);
        child.kill("SIGTERM");
        forcedKillTimer = setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, 2_000);
      }, DEFAULT_TEST_TIMEOUT_MS);

      child.on("error", (error) => {
        settled = true;
        clearTimeout(timeout);
        if (forcedKillTimer) {
          clearTimeout(forcedKillTimer);
        }
        reject(error);
      });

      child.on("close", (code, signal) => {
        settled = true;
        clearTimeout(timeout);
        if (forcedKillTimer) {
          clearTimeout(forcedKillTimer);
        }

        if (timedOut) {
          resolve(1);
          return;
        }

        if (typeof code === "number") {
          resolve(code);
          return;
        }

        reject(new Error(`Node test runner exited unexpectedly with signal ${signal ?? "unknown"}.`));
      });
    });

    if (exitCode !== 0) {
      failedTests.push(compiledTest);
    }
  }

  if (failedTests.length > 0) {
    process.stderr.write(
      [
        "The following compiled test files failed:",
        ...failedTests.map((compiledTest) => `- ${compiledTest}`)
      ].join("\n") + "\n"
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
