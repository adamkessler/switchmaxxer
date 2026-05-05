import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  buildInClausePlaceholders,
  deleteRowsBySelectedIds,
  runImmediateTransaction
} from "./history-delete";
import { test } from "../../observability.test-support";

void test("buildInClausePlaceholders rejects empty placeholder sets", () => {
  assert.equal(buildInClausePlaceholders(3), "(?, ?, ?)");
  assert.throws(() => buildInClausePlaceholders(0), /zero placeholders/);
});

void test("deleteRowsBySelectedIds deletes selected rows in batches", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE cleanup_targets (id TEXT PRIMARY KEY, expired INTEGER NOT NULL)");
    db.prepare("INSERT INTO cleanup_targets (id, expired) VALUES (?, ?)").run("old-1", 1);
    db.prepare("INSERT INTO cleanup_targets (id, expired) VALUES (?, ?)").run("old-2", 1);
    db.prepare("INSERT INTO cleanup_targets (id, expired) VALUES (?, ?)").run("old-3", 1);
    db.prepare("INSERT INTO cleanup_targets (id, expired) VALUES (?, ?)").run("new-1", 0);

    const deleted = deleteRowsBySelectedIds(
      db,
      `
        SELECT id
        FROM cleanup_targets
        WHERE expired = ?
        ORDER BY id
        LIMIT ?
      `,
      "cleanup_targets",
      "id",
      [1],
      2
    );

    assert.equal(deleted, 3);
    assert.deepEqual(
      db.prepare("SELECT id FROM cleanup_targets ORDER BY id").all().map((row) => ({ id: (row as { id: string }).id })),
      [{ id: "new-1" }]
    );
  } finally {
    db.close();
  }
});

void test("runImmediateTransaction rolls back failed cleanup work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE cleanup_targets (id TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO cleanup_targets (id) VALUES (?)").run("kept");

    assert.throws(
      () => runImmediateTransaction(db, () => {
        db.prepare("DELETE FROM cleanup_targets").run();
        throw new Error("cleanup failed");
      }),
      /cleanup failed/
    );

    assert.deepEqual(
      db.prepare("SELECT id FROM cleanup_targets").all().map((row) => ({ id: (row as { id: string }).id })),
      [{ id: "kept" }]
    );
  } finally {
    db.close();
  }
});
