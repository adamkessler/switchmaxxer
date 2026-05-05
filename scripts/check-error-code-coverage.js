#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

require("ts-node/register/transpile-only");

const { getContractSourcePaths } = require("./lib/contract-source-paths.js");
const { APP_ERROR_CODES } = require("../src/platform/error-codes.ts");
const {
  MCP_USAGE_ERROR_CODES,
  MCP_ENTITY_STATE_ERROR_CODES
} = require("../src/subsystems/config/config-metadata.ts");

function walkCoverageFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkCoverageFiles(entryPath);
    }

    return entry.name.endsWith(".test.ts") || entry.name.endsWith(".sh") ? [entryPath] : [];
  });
}

function walkSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkSourceFiles(entryPath);
    }

    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [entryPath] : [];
  });
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLiteralPattern(code) {
  return new RegExp(`(["'\`])${escapeRegex(code)}\\1`);
}

function buildSendJsonErrorLiteralPattern(code) {
  return new RegExp(`sendJsonError\\s*\\([\\s\\S]{0,240}?(["'\`])${escapeRegex(code)}\\1`, "g");
}

function collectDeprecatedCodes(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const deprecated = new Set();
  const markerPattern = /@deprecated\s+([a-z0-9_]+)/g;
  let match = markerPattern.exec(source);

  while (match) {
    deprecated.add(match[1]);
    match = markerPattern.exec(source);
  }

  return deprecated;
}

function readCoverageBaseline(repoRoot) {
  const baselinePath = path.join(repoRoot, "scripts", "error-code-coverage-baseline.json");
  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray(parsed.missingTestCoverage) ||
    parsed.missingTestCoverage.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`Invalid error-code coverage baseline file: ${baselinePath}`);
  }

  return {
    baselinePath,
    missingTestCoverage: [...new Set(parsed.missingTestCoverage)].sort((left, right) => left.localeCompare(right))
  };
}

function main() {
  const strict = process.argv.includes("--strict");
  const sourcePaths = getContractSourcePaths();
  const repoRoot = sourcePaths.repoRoot;
  const baseline = readCoverageBaseline(repoRoot);
  const coverageFiles = [
    ...walkCoverageFiles(path.join(repoRoot, "src")),
    ...walkCoverageFiles(path.join(repoRoot, "tests"))
  ];
  const gatewayAndProxySourceFiles = [
    ...walkSourceFiles(sourcePaths.subsystems.gatewayRoot),
    ...walkSourceFiles(sourcePaths.subsystems.proxyRoot)
  ];
  const deprecatedCodes = new Set([
    ...collectDeprecatedCodes(sourcePaths.platform.errorCodes),
    ...collectDeprecatedCodes(sourcePaths.subsystems.configMetadata)
  ]);
  const codeEntries = Object.entries(APP_ERROR_CODES).map(([name, value]) => ({
    name,
    value,
    literalPattern: buildLiteralPattern(value),
    sourceLiteralPattern: buildSendJsonErrorLiteralPattern(value),
    appReference: `APP_ERROR_CODES.${name}`,
    usageReference: Object.prototype.hasOwnProperty.call(MCP_USAGE_ERROR_CODES, name)
      ? `MCP_USAGE_ERROR_CODES.${name}`
      : null,
    entityReference: Object.prototype.hasOwnProperty.call(MCP_ENTITY_STATE_ERROR_CODES, name)
      ? `MCP_ENTITY_STATE_ERROR_CODES.${name}`
      : null
  }));

  const missing = [];
  const rawGatewayProxyLiterals = [];

  for (const entry of codeEntries) {
    if (deprecatedCodes.has(entry.value)) {
      continue;
    }

    const covered = coverageFiles.some((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return (
        entry.literalPattern.test(source) ||
        source.includes(entry.appReference) ||
        (entry.usageReference !== null && source.includes(entry.usageReference)) ||
        (entry.entityReference !== null && source.includes(entry.entityReference))
      );
    });

    if (!covered) {
      missing.push(entry.value);
    }

    const hasRawGatewayProxyLiteral = gatewayAndProxySourceFiles.some((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return entry.sourceLiteralPattern.test(source) && !source.includes(entry.appReference);
    });

    if (hasRawGatewayProxyLiteral) {
      rawGatewayProxyLiterals.push(entry.value);
    }
  }

  const missingSorted = [...missing].sort((left, right) => left.localeCompare(right));
  const newCoverageGaps = missingSorted.filter((code) => !baseline.missingTestCoverage.includes(code));
  const staleBaselineEntries = baseline.missingTestCoverage.filter((code) => !missingSorted.includes(code));

  if (strict && (newCoverageGaps.length > 0 || staleBaselineEntries.length > 0 || rawGatewayProxyLiterals.length > 0)) {
    const output = [
      "Error-code coverage check failed.",
      ...(newCoverageGaps.length > 0
        ? [
            "The following codes are newly missing test coverage and must be covered or explicitly baselined:",
            ...newCoverageGaps.map((code) => `- ${code}`)
          ]
        : []),
      ...(staleBaselineEntries.length > 0
        ? [
            `The following baseline entries are stale and should be removed from ${path.relative(repoRoot, baseline.baselinePath)}:`,
            ...staleBaselineEntries.map((code) => `- ${code}`)
          ]
        : []),
      ...(rawGatewayProxyLiterals.length > 0
        ? [
            "The following codes still appear as raw string literals in gateway/proxy sendJsonError paths:",
            ...rawGatewayProxyLiterals.map((code) => `- ${code}`)
          ]
        : [])
    ].join("\n") + "\n";

    process.stderr.write(output);
    process.exitCode = 1;
    return;
  }

  if (missing.length > 0 || rawGatewayProxyLiterals.length > 0) {
    const output = [
      strict ? "Error-code coverage baseline check passed with known gaps." : "Error-code coverage report:",
      ...(missingSorted.length > 0
        ? [
          "The following codes are defined but currently rely on the checked-in coverage baseline:",
            ...missingSorted.map((code) => `- ${code}`)
          ]
        : []),
      ...(rawGatewayProxyLiterals.length > 0
        ? [
            "The following codes still appear as raw string literals in gateway/proxy sendJsonError paths:",
            ...rawGatewayProxyLiterals.map((code) => `- ${code}`)
          ]
        : [])
    ].join("\n") + "\n";

    (strict ? process.stderr : process.stdout).write(output);
    return;
  }

  process.stdout.write(
    `Verified ${codeEntries.length} error codes across ${coverageFiles.length} coverage files.\n`
  );
}

main();
