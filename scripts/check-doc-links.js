#!/usr/bin/env node

const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const markdownFiles = listMarkdownFiles(repoRoot);
const brokenLinks = [];

for (const markdownFile of markdownFiles) {
  const absolutePath = path.join(repoRoot, markdownFile);
  const contents = readFileSync(absolutePath, "utf8");

  for (const link of extractMarkdownLinks(contents)) {
    if (shouldIgnoreLink(link.target)) {
      continue;
    }

    const [targetPath, anchor] = splitTargetAndAnchor(link.target);
    const resolvedTarget = resolveMarkdownTargetPath(repoRoot, absolutePath, targetPath);

    try {
      const targetStats = statSync(resolvedTarget);

      if (anchor && targetStats.isFile()) {
        validateAnchor(markdownFile, resolvedTarget, anchor, brokenLinks, link.target);
      }
    } catch {
      brokenLinks.push(`${markdownFile}:${link.line} -> ${link.target}`);
    }
  }
}

if (brokenLinks.length > 0) {
  process.stderr.write(["Broken local markdown links:", ...brokenLinks.map((entry) => `- ${entry}`)].join("\n") + "\n");
  process.exit(1);
}

function listMarkdownFiles(rootDir) {
  const tracked = spawnSync("git", ["ls-files", "*.md"], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (tracked.status !== 0) {
    throw new Error(tracked.stderr || "Unable to enumerate tracked markdown files with git ls-files.");
  }

  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "*.md"], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (untracked.status !== 0) {
    throw new Error(untracked.stderr || "Unable to enumerate untracked markdown files with git ls-files.");
  }

  return [...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")]
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function extractMarkdownLinks(contents) {
  const results = [];
  const lines = contents.split("\n");
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;

  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      results.push({
        line: index + 1,
        target: match[1]
      });
    }
  });

  return results;
}

function shouldIgnoreLink(target) {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("file:") ||
    target.startsWith("#")
  );
}

function splitTargetAndAnchor(target) {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) {
    return [target, null];
  }

  return [target.slice(0, hashIndex), target.slice(hashIndex + 1)];
}

function validateAnchor(markdownFile, resolvedTarget, anchor, brokenLinks, originalTarget) {
  const fileContents = readFileSync(resolvedTarget, "utf8");

  if (/^L\d+$/.test(anchor)) {
    const lineNumber = Number(anchor.slice(1));
    const lineCount = fileContents.split("\n").length;

    if (lineNumber < 1 || lineNumber > lineCount) {
      brokenLinks.push(`${markdownFile} -> ${originalTarget} (line anchor out of range)`);
    }
  }
}

function resolveMarkdownTargetPath(rootDir, markdownAbsolutePath, targetPath) {
  const fileRelativeTarget = path.resolve(path.dirname(markdownAbsolutePath), targetPath);

  try {
    statSync(fileRelativeTarget);
    return fileRelativeTarget;
  } catch {
    return path.resolve(rootDir, targetPath);
  }
}
