import { readFileSync } from "node:fs";
import path from "node:path";

let cachedPackageVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedPackageVersion !== null) {
    return cachedPackageVersion;
  }

  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  const rawText = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(rawText) as { version?: unknown };

  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("package.json is missing a valid version");
  }

  cachedPackageVersion = parsed.version;
  return cachedPackageVersion;
}
