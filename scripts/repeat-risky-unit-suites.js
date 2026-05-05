#!/usr/bin/env node

const { accessSync } = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const riskyCompiledTests = [
  "dist/subsystems/observability/observability.test.js",
  "dist/subsystems/observability/ostrich/store/observability.store-runtime.test.js",
  "dist/subsystems/hot-path/manatee/proxy/proxy-runtime.test.js"
];
const repetitions = 3;

async function runCompiledTest(compiledTest, iteration) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      ["--enable-source-maps", "--test", "--test-force-exit", compiledTest],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit"
      }
    );

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }

      reject(new Error(`Repeat-run smoke check exited unexpectedly with signal ${signal ?? "unknown"}.`));
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Repeat-run smoke check failed for ${compiledTest} on iteration ${iteration}.`);
  }
}

async function main() {
  for (const compiledTest of riskyCompiledTests) {
    accessSync(path.join(repoRoot, compiledTest));
  }

  for (let iteration = 1; iteration <= repetitions; iteration += 1) {
    process.stdout.write(`Repeat-run smoke iteration ${iteration}/${repetitions}\n`);

    for (const compiledTest of riskyCompiledTests) {
      await runCompiledTest(compiledTest, iteration);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
