#!/usr/bin/env node

const { readdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const boundaryRules = [
  {
    targets: [path.resolve(repoRoot, "src/subsystems/proxy/proxy-core.ts")],
    allowedDirectories: [path.resolve(repoRoot, "src/subsystems/proxy")],
    publicEntrypoint: "src/subsystems/proxy/proxy.ts",
    description: "External consumers should import the proxy public barrel instead of ./proxy-core."
  },
  {
    targets: [
      path.resolve(repoRoot, "src/subsystems/config/config-validators-entities.ts"),
      path.resolve(repoRoot, "src/subsystems/config/config-validators-gateway.ts"),
      path.resolve(repoRoot, "src/subsystems/config/config-validators-primitives.ts")
    ],
    allowedDirectories: [path.resolve(repoRoot, "src/subsystems/config")],
    publicEntrypoint: "src/subsystems/config/config-validation.ts",
    description: "External consumers should import config validation through the validation barrel."
  },
  {
    targets: [
      path.resolve(repoRoot, "src/subsystems/config/mutation/config.ts"),
      path.resolve(repoRoot, "src/subsystems/config/mutation/model.ts"),
      path.resolve(repoRoot, "src/subsystems/config/mutation/provider.ts"),
      path.resolve(repoRoot, "src/subsystems/config/mutation/provider-auth.ts"),
      path.resolve(repoRoot, "src/subsystems/config/mutation/route.ts")
    ],
    allowedDirectories: [
      path.resolve(repoRoot, "src/subsystems/config"),
      path.resolve(repoRoot, "src/subsystems/config/mutation")
    ],
    publicEntrypoint: "src/subsystems/config/mutation/index.ts",
    description: "External consumers should import config mutation runtimes through the mutation barrel."
  },
  {
    targets: [
      path.resolve(repoRoot, "src/subsystems/observability/gateway-observation-flush.ts"),
      path.resolve(repoRoot, "src/subsystems/observability/gateway-observation-queue.ts"),
      path.resolve(repoRoot, "src/subsystems/observability/gateway-observation-shutdown.ts"),
      path.resolve(repoRoot, "src/subsystems/observability/gateway-observation-worker.ts")
    ],
    allowedDirectories: [path.resolve(repoRoot, "src/subsystems/observability")],
    publicEntrypoint: "src/subsystems/observability/gateway.ts",
    description: "External consumers should import gateway observability through the public gateway API."
  },
  {
    targetDirectories: [path.resolve(repoRoot, "src/subsystems/cli")],
    forbiddenDirectories: [path.resolve(repoRoot, "src/subsystems/gateway")],
    publicEntrypoint: "src/subsystems/cli/gateway-cli-bootstrap.ts",
    description: "Gateway runtime code must not import CLI modules; CLI composition may import gateway runtime helpers."
  }
];

function pathIsInside(filePath, directory) {
  return filePath === directory || filePath.startsWith(directory + path.sep);
}

function isTestSupportModule(filePath) {
  return /\.test-support\.(?:ts|js)$/.test(path.basename(filePath));
}

function isTestOnlyModule(filePath) {
  return /\.(?:test|test-support)\.(?:ts|js)$/.test(path.basename(filePath));
}

function ruleMatchesTarget(rule, resolvedTarget) {
  if (rule.targets?.includes(resolvedTarget)) {
    return true;
  }

  return rule.targetDirectories?.some((directory) => pathIsInside(resolvedTarget, directory)) ?? false;
}

function fileIsAllowedByRule(rule, filePath) {
  return rule.allowedDirectories.some((directory) => pathIsInside(filePath, directory));
}

function fileIsForbiddenByRule(rule, filePath) {
  return rule.forbiddenDirectories?.some((directory) => pathIsInside(filePath, directory)) ?? false;
}

function normalizeSpecifier(specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  return specifier;
}

function resolveImportTarget(fromFile, specifier) {
  const normalized = normalizeSpecifier(specifier);
  if (!normalized) {
    return null;
  }

  const resolvedBase = path.resolve(path.dirname(fromFile), normalized);
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.js`,
    path.join(resolvedBase, "index.ts"),
    path.join(resolvedBase, "index.js")
  ];

  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

function parseImportSpecifiers(sourceText) {
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g
  ];
  const specifiers = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(sourceText)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function listTrackedFiles() {
  const files = [];
  const pendingDirectories = ["src", "scripts"];

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

      if (entry.isFile() && (relativePath.endsWith(".ts") || relativePath.endsWith(".js"))) {
        files.push(path.resolve(repoRoot, relativePath));
      }
    }
  }

  return files.sort();
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const filePath of files) {
    const sourceText = readFileSync(filePath, "utf8");
    const specifiers = parseImportSpecifiers(sourceText);

    for (const specifier of specifiers) {
      const resolvedTarget = resolveImportTarget(filePath, specifier);
      if (!resolvedTarget) {
        continue;
      }

      if (isTestSupportModule(resolvedTarget) && !isTestOnlyModule(filePath)) {
        violations.push({
          filePath: path.relative(repoRoot, filePath),
          specifier,
          publicEntrypoint: "a production module, or move the importing code into a *.test.ts file",
          description: "Non-test modules must not import *.test-support modules."
        });
        continue;
      }

      for (const rule of boundaryRules) {
        if (!ruleMatchesTarget(rule, resolvedTarget)) {
          continue;
        }

        if (rule.forbiddenDirectories) {
          if (!fileIsForbiddenByRule(rule, filePath)) {
            continue;
          }
        } else if (fileIsAllowedByRule(rule, filePath)) {
          continue;
        }

        violations.push({
          filePath: path.relative(repoRoot, filePath),
          specifier,
          publicEntrypoint: rule.publicEntrypoint,
          description: rule.description
        });
      }
    }
  }

  if (violations.length === 0) {
    process.stdout.write("Import boundary checks passed.\n");
    return;
  }

  process.stderr.write("Import boundary violations found:\n");
  for (const violation of violations) {
    process.stderr.write(
      `- ${violation.filePath} imports '${violation.specifier}'. ${violation.description} Use ${violation.publicEntrypoint}.\n`
    );
  }
  process.exit(1);
}

main();
