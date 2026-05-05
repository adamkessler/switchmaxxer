import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAllowedObservabilityDbExtension,
  assertSafeExistingObservabilityDbFile,
  assertSafeObservabilityDbParent,
  assertSafeResolvedObservabilityDbPath
} from "./store-path-security";

function withStubbedGetuid<T>(uid: number, action: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");

  Object.defineProperty(process, "getuid", {
    configurable: true,
    value: () => uid
  });

  try {
    return action();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "getuid", descriptor);
    } else {
      delete (process as { getuid?: () => number }).getuid;
    }
  }
}

void test("observability DB path security allows only known SQLite extensions", () => {
  assert.doesNotThrow(() => assertAllowedObservabilityDbExtension("/tmp/observability.db"));
  assert.doesNotThrow(() => assertAllowedObservabilityDbExtension("/tmp/observability.sqlite"));
  assert.doesNotThrow(() => assertAllowedObservabilityDbExtension("/tmp/observability.SQLITE3"));

  assert.throws(
    () => assertAllowedObservabilityDbExtension("/tmp/observability.txt"),
    /must end in one of:/
  );
});

void test("observability DB path security rejects a symlink nearest parent", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-parent-symlink-"));
  const realParent = path.join(tempDir, "real-parent");
  const symlinkParent = path.join(tempDir, "link-parent");
  const dbPath = path.join(symlinkParent, "missing-child", "observability.sqlite");

  try {
    mkdirSync(realParent);
    symlinkSync(realParent, symlinkParent);

    assert.throws(
      () => assertSafeObservabilityDbParent(dbPath),
      /nearest existing parent '.+' is a symbolic link/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability DB path security rejects group-writable parents", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-group-parent-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    chmodSync(tempDir, 0o770);

    assert.throws(
      () => assertSafeObservabilityDbParent(dbPath),
      /group- or world-writable/
    );
  } finally {
    chmodSync(tempDir, 0o700);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability DB path security rejects foreign-owned parents", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-foreign-parent-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const observedUid = lstatSync(tempDir).uid;

  try {
    withStubbedGetuid(observedUid + 1, () => {
      assert.throws(
        () => assertSafeObservabilityDbParent(dbPath),
        /must be owned by the current user uid/
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability DB path security rejects unsafe existing DB file shapes and modes", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-existing-file-"));
  const targetPath = path.join(tempDir, "target.sqlite");
  const symlinkPath = path.join(tempDir, "observability.sqlite");
  const directoryPath = path.join(tempDir, "directory.sqlite");
  const sharedPath = path.join(tempDir, "shared.sqlite");

  try {
    writeFileSync(targetPath, "");
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, symlinkPath);

    assert.throws(
      () => assertSafeExistingObservabilityDbFile(symlinkPath),
      /must not be a symbolic link/
    );

    mkdirSync(directoryPath);
    assert.throws(
      () => assertSafeExistingObservabilityDbFile(directoryPath),
      /must be a regular file/
    );

    writeFileSync(sharedPath, "");
    chmodSync(sharedPath, 0o644);
    assert.throws(
      () => assertSafeExistingObservabilityDbFile(sharedPath),
      /must not be readable or writable by group or other users/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability DB path security rejects foreign-owned existing DB files", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-foreign-file-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    writeFileSync(dbPath, "");
    chmodSync(dbPath, 0o600);
    const observedUid = lstatSync(dbPath).uid;

    withStubbedGetuid(observedUid + 1, () => {
      assert.throws(
        () => assertSafeExistingObservabilityDbFile(dbPath),
        /must be owned by the current user uid/
      );
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability DB path security accepts a private SQLite file in a private parent", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-store-path-safe-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    chmodSync(tempDir, 0o700);
    writeFileSync(dbPath, "");
    chmodSync(dbPath, 0o600);

    assert.doesNotThrow(() => assertSafeResolvedObservabilityDbPath(dbPath));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
