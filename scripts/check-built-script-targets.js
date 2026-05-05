#!/usr/bin/env node

const { existsSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const requiredBuildOutputs = [
  "dist/index.js",
  "dist/subsystems/observability/observability.test.js",
  "dist/subsystems/gateway/perf-gateway.js"
];

const missing = requiredBuildOutputs.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));

if (missing.length > 0) {
  process.stderr.write(
    [
      "Build completed but expected script targets were not found:",
      ...missing.map((relativePath) => `- ${relativePath}`)
    ].join("\n") + "\n"
  );
  process.exit(1);
}

process.stdout.write("Verified built script targets.\n");
