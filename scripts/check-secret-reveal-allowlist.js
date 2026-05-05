#!/usr/bin/env node

const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const allowedRevealCallFiles = new Set([
  "src/subsystems/config/provider-auth.ts",
  "src/subsystems/hot-path/manatee/runtime/local-gateway-auth.ts",
  "src/platform/secret-redaction.test.ts",
  "src/platform/secret-string.test.ts"
]);

function listSourceFiles() {
  const files = [];
  const pendingDirectories = ["src"];

  while (pendingDirectories.length > 0) {
    const relativeDirectory = pendingDirectories.pop();
    const entries = readdirSync(path.join(repoRoot, relativeDirectory), {
      withFileTypes: true
    });

    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        pendingDirectories.push(relativePath);
        continue;
      }

      if (entry.isFile() && relativePath.endsWith(".ts")) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function lineNumberForIndex(sourceText, index) {
  return sourceText.slice(0, index).split("\n").length;
}

function main() {
  const revealCallPattern = /\.\s*reveal\s*\(/g;
  const violations = [];

  for (const relativePath of listSourceFiles()) {
    const sourceText = readFileSync(path.join(repoRoot, relativePath), "utf8");
    let match;

    while ((match = revealCallPattern.exec(sourceText)) !== null) {
      if (allowedRevealCallFiles.has(relativePath)) {
        continue;
      }

      violations.push({
        relativePath,
        line: lineNumberForIndex(sourceText, match.index)
      });
    }
  }

  if (violations.length === 0) {
    process.stdout.write("Secret reveal allowlist check passed.\n");
    return;
  }

  process.stderr.write("Secret reveal allowlist violations found:\n");
  for (const violation of violations) {
    process.stderr.write(
      `- ${violation.relativePath}:${violation.line} calls reveal() outside the approved secret unwrap boundary.\n`
    );
  }
  process.stderr.write(
    `Allowed reveal() call files: ${Array.from(allowedRevealCallFiles).sort().join(", ")}\n`
  );
  process.exit(1);
}

main();
