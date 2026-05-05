import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

void test("contract verification scripts resolve canonical post-refactor sources", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const validateResult = spawnSync("node", ["scripts/validate-cli-envelope.js", "--self-test"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(validateResult.status, 0, validateResult.stderr);

  const coverageResult = spawnSync("node", ["scripts/check-error-code-coverage.js"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(coverageResult.status, 0, coverageResult.stderr);

  const boundariesResult = spawnSync("node", ["scripts/check-import-boundaries.js"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(boundariesResult.status, 0, boundariesResult.stderr);

  const secretRevealResult = spawnSync("node", ["scripts/check-secret-reveal-allowlist.js"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(secretRevealResult.status, 0, secretRevealResult.stderr);
});
