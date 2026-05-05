import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";

export const MAX_CONFIG_FILE_BYTES = 8 * 1024 * 1024;
const INSECURE_CONFIG_MODE_MASK = 0o077;

function formatFileMode(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

// This module is the shared config-file read boundary. Keep size limits,
// symlink rejection, and filesystem permission checks centralized here so
// every config-load path inherits the same read-time security posture.
export function readConfigTextWithinLimit(
  sourcePath: string,
  options: {
    logicalName: string;
    maxBytes?: number;
  }
): string {
  const maxBytes = options.maxBytes ?? MAX_CONFIG_FILE_BYTES;

  if (!existsSync(sourcePath)) {
    throw new Error(`Unable to find ${options.logicalName} at '${sourcePath}'.`);
  }

  let sizeBytes: number;

  try {
    const fileInfo = lstatSync(sourcePath);

    if (fileInfo.isSymbolicLink()) {
      throw new Error(`${options.logicalName} at '${sourcePath}' must not be a symbolic link.`);
    }

    const resolvedFileInfo = statSync(sourcePath);

    if ((resolvedFileInfo.mode & INSECURE_CONFIG_MODE_MASK) !== 0) {
      throw new Error(
        `${options.logicalName} at '${sourcePath}' has insecure mode ${formatFileMode(resolvedFileInfo.mode)}; ` +
        `it must not be group- or world-accessible. ` +
        `Run: chmod 0600 ${sourcePath}`
      );
    }

    sizeBytes = resolvedFileInfo.size;
  } catch (error) {
    throw new Error(`Unable to read ${options.logicalName} at '${sourcePath}': ${(error as Error).message}`);
  }

  if (sizeBytes > maxBytes) {
    throw new Error(
      `${options.logicalName} at '${sourcePath}' exceeds the maximum supported size of ${Math.floor(maxBytes / (1024 * 1024))} MB.`
    );
  }

  try {
    return readFileSync(sourcePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${options.logicalName} at '${sourcePath}': ${(error as Error).message}`);
  }
}
