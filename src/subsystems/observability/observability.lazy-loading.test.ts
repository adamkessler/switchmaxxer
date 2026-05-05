import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SQLITE_WARNING_PATTERN = /SQLite is an experimental feature|node:sqlite/i;

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

void test("non-observability CLI startup paths do not load node:sqlite", () => {
  const root = repoRoot();
  const entrypoint = path.join(root, "dist", "index.js");
  const commands = [
    ["--help"],
    ["version"],
    ["config", "--help"],
    ["models", "--help"],
    ["providers", "--help"],
    ["routes", "--help"]
  ];

  for (const argv of commands) {
    const result = spawnSync(process.execPath, ["--enable-source-maps", entrypoint, ...argv], {
      cwd: root,
      encoding: "utf8",
      env: process.env
    });
    const commandLabel = argv.join(" ");

    assert.equal(
      result.status,
      0,
      `${commandLabel} failed unexpectedly\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.doesNotMatch(result.stderr, SQLITE_WARNING_PATTERN, `${commandLabel} loaded node:sqlite during startup`);
  }
});

void test("observability-backed CLI json commands suppress node:sqlite experimental warning", () => {
  const root = repoRoot();
  const entrypoint = path.join(root, "dist", "index.js");
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-sqlite-warning-test-"));
  const configPath = path.join(tempDir, "config.json");
  const catalogPath = path.join(tempDir, "catalog.json");
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    copyFileSync(path.join(root, "config-examples", "config.example.json"), configPath);
    copyFileSync(path.join(root, "config-examples", "catalog.example.json"), catalogPath);
    chmodSync(configPath, 0o600);
    chmodSync(catalogPath, 0o600);

    const result = spawnSync(
      process.execPath,
      [
        "--enable-source-maps",
        entrypoint,
        "optimize",
        "--model",
        "gpt-4o-mini",
        "--objective",
        "cost",
        "--config",
        configPath,
        "--json"
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          SWITCHMAXXER_OBSERVABILITY_DB: dbPath,
          SWITCHMAXXER_INBOUND_API_KEY: "0123456789abcdef0123456789abcdef",
          SWITCHMAXXER_OPENAI_API_KEY: "test-openai-key",
          SWITCHMAXXER_OPENROUTER_API_KEY: "test-openrouter-key",
          SWITCHMAXXER_ANTHROPIC_API_KEY: "test-anthropic-key",
          SWITCHMAXXER_MINIMAX_API_KEY: "test-minimax-key"
        }
      }
    );

    assert.equal(
      result.status,
      0,
      `optimize failed unexpectedly\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.doesNotMatch(result.stderr, SQLITE_WARNING_PATTERN);
    assert.doesNotMatch(result.stdout, SQLITE_WARNING_PATTERN);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
