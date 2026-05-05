import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ObservabilityService } from "../../service";
import { withSqliteBusyRetry } from "./sqlite-busy";
import { closeObservabilityStore, bootstrapObservabilityStore } from "./store";
import { makeObservationForRequest } from "../../test-helpers";
import { test } from "../../observability.test-support";

void test("observability service handles caller-side concurrent promise bursts", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-burst-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);
    const requestIds = Array.from({ length: 12 }, (_, index) => `req-burst-${index + 1}`);

    await Promise.all(
      requestIds.map((requestId, index) =>
        Promise.resolve().then(() =>
          service.recordObservation(
            makeObservationForRequest(
              requestId,
              `2026-04-18T12:${String(index).padStart(2, "0")}:00.000Z`,
              "request_received"
            )
          )
        )
      )
    );

    assert.equal(service.listRecentObservations({ limit: 20 }).length, requestIds.length);
    for (const requestId of requestIds) {
      assert.equal(service.getRequestExecution(requestId)?.observation_count, 1);
    }

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store rejects symlinked DB paths before SQLite opens them", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-symlink-test-"));
  const targetPath = path.join(tempDir, "target.sqlite");
  const symlinkPath = path.join(tempDir, "observability.sqlite");

  try {
    writeFileSync(targetPath, "");
    chmodSync(targetPath, 0o600);
    symlinkSync(targetPath, symlinkPath);

    assert.throws(
      () => bootstrapObservabilityStore({ dbPath: symlinkPath }),
      /must not be a symbolic link/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store rejects shared existing DB files", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-shared-file-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    writeFileSync(dbPath, "");
    chmodSync(dbPath, 0o640);

    assert.throws(
      () => bootstrapObservabilityStore({ dbPath }),
      /must not be readable or writable by group or other users/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store rejects group-writable parent directories", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-shared-parent-test-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  try {
    chmodSync(tempDir, 0o770);

    assert.throws(
      () => bootstrapObservabilityStore({ dbPath }),
      /nearest existing parent '.+' is group- or world-writable/
    );
  } finally {
    chmodSync(tempDir, 0o700);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store tolerates concurrent writer processes", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-writer-contention-"));
  const dbPath = path.join(tempDir, "observability.sqlite");

  const waitForChild = (label: string, child: ReturnType<typeof spawn>): Promise<void> =>
    new Promise((resolve, reject) => {
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `${label} failed with code ${code ?? "null"} signal ${signal ?? "null"}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      });
    });

  try {
    const seededStore = bootstrapObservabilityStore({ dbPath });
    closeObservabilityStore(seededStore);

    const childScript = `
        const { bootstrapObservabilityStore, closeObservabilityStore } = require(${JSON.stringify(
          path.resolve(process.cwd(), "dist/subsystems/observability/store.js")
        )});
        const { ObservabilityService } = require(${JSON.stringify(
          path.resolve(process.cwd(), "dist/subsystems/observability/service.js")
        )});

        const dbPath = process.argv[1];
        const writerId = process.argv[2];
        const store = bootstrapObservabilityStore({ dbPath });
        const service = new ObservabilityService(store.db);

        try {
          for (let index = 0; index < 10; index += 1) {
            const observedAt = \`2026-04-18T12:\${String(Number(writerId)).padStart(2, "0")}:\${String(index).padStart(2, "0")}.000Z\`;
            const requestId = \`req-writer-\${writerId}-\${index}\`;
            service.recordObservation({
              id: \`\${requestId}-request_received\`,
              observed_at: observedAt,
              request_id: requestId,
              surface: "gateway",
              kind: "measurement",
              event: "request_received",
              stage: "ingress",
              outcome: null,
              route_id: "route-alpha",
              route_name: "route-alpha",
              provider_id: "provider-main",
              provider_model_id: "provider-model-1",
              model_id: "model-alpha",
              client_api_mode: "openai",
              upstream_api_mode: "openai-completions",
              status_code: null,
              attributes_json: null
            });
          }
        } finally {
          closeObservabilityStore(store);
        }
      `;

    const writerA = spawn(process.execPath, ["-e", childScript, dbPath, "1"], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"]
    });
    const writerB = spawn(process.execPath, ["-e", childScript, dbPath, "2"], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"]
    });

    await Promise.all([waitForChild("writer-a", writerA), waitForChild("writer-b", writerB)]);

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    assert.equal(service.listRecentObservations({ limit: 25 }).length, 20);
    assert.equal(service.getRequestExecution("req-writer-1-0")?.observation_count, 1);
    assert.equal(service.getRequestExecution("req-writer-2-9")?.observation_count, 1);

    closeObservabilityStore(store);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability store recovers cleanly after a writer process is SIGKILLed mid-flight", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-observability-wal-recovery-"));
  const dbPath = path.join(tempDir, "observability.sqlite");
  const startedPath = path.join(tempDir, "writer.started");
  let writer: ChildProcess | null = null;

  try {
    const seededStore = bootstrapObservabilityStore({ dbPath });
    closeObservabilityStore(seededStore);

    const childScript = `
        const { bootstrapObservabilityStore } = require(${JSON.stringify(
          path.resolve(process.cwd(), "dist/subsystems/observability/store.js")
        )});
        const { ObservabilityService } = require(${JSON.stringify(
          path.resolve(process.cwd(), "dist/subsystems/observability/service.js")
        )});
        const { writeFileSync } = require("node:fs");

        const dbPath = process.argv[1];
        const startedPath = process.argv[2];
        const store = bootstrapObservabilityStore({ dbPath });
        const service = new ObservabilityService(store.db);
        const baseTimeMs = Date.parse("2026-04-18T13:00:00.000Z");

        let index = 0;
        const writeNext = () => {
          const observedAt = new Date(baseTimeMs + index * 1_000).toISOString();
          const requestId = \`req-crash-\${index}\`;
          service.recordObservation({
            id: \`\${requestId}-request_received\`,
            observed_at: observedAt,
            request_id: requestId,
            surface: "gateway",
            kind: "measurement",
            event: "request_received",
            stage: "ingress",
            outcome: null,
            route_id: "route-alpha",
            route_name: "route-alpha",
            provider_id: "provider-main",
            provider_model_id: "provider-model-1",
            model_id: "model-alpha",
            client_api_mode: "openai",
            upstream_api_mode: "openai-completions",
            status_code: null,
            attributes_json: null
          });

          if (index === 0) {
            writeFileSync(startedPath, "started\\n");
          }

          index += 1;
          setTimeout(writeNext, 5);
        };

        writeNext();
      `;

    writer = spawn(process.execPath, ["-e", childScript, dbPath, startedPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"]
    });

    const waitForStarted = new Promise<void>((resolve, reject) => {
      let stderr = "";
      let settled = false;
      let pollHandle: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        writer?.stderr?.off("data", onStderr);
        writer?.off("error", onError);
        writer?.off("exit", onExitBeforeStart);
        if (pollHandle) {
          clearInterval(pollHandle);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const onStderr = (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      };

      const onError = (error: Error) => {
        settleReject(error);
      };

      const onExitBeforeStart = (code: number | null, signal: NodeJS.Signals | null) => {
        settleReject(
          new Error(
            `crash-writer exited before start signal with code ${code ?? "null"} signal ${signal ?? "null"}${
              stderr ? `: ${stderr.trim()}` : ""
            }`
          )
        );
      };

      writer?.stderr?.on("data", onStderr);
      writer?.once("error", onError);
      writer?.once("exit", onExitBeforeStart);

      pollHandle = setInterval(() => {
        if (existsSync(startedPath)) {
          settleResolve();
        }
      }, 5);

      timeoutHandle = setTimeout(() => {
        settleReject(new Error(`crash-writer did not create start sentinel${stderr ? `: ${stderr.trim()}` : ""}`));
      }, 1_000);
    });

    await waitForStarted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    writer.kill("SIGKILL");

    await new Promise<void>((resolve, reject) => {
      let stderr = "";
      let settled = false;

      const cleanup = () => {
        writer?.stderr?.off("data", onStderr);
        writer?.off("error", onError);
        writer?.off("exit", onExit);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const onStderr = (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      };

      const onError = (error: Error) => {
        settleReject(error);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (signal === "SIGKILL" || code === 137) {
          settleResolve();
          return;
        }

        settleReject(
          new Error(
            `crash-writer exited unexpectedly with code ${code ?? "null"} signal ${signal ?? "null"}${
              stderr ? `: ${stderr.trim()}` : ""
            }`
          )
        );
      };

      writer?.stderr?.on("data", onStderr);
      writer?.once("error", onError);
      writer?.once("exit", onExit);
    });

    const store = bootstrapObservabilityStore({ dbPath });
    const service = new ObservabilityService(store.db);

    const integrity = store.db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    assert.equal(integrity.integrity_check, "ok");

    const foreignKeyViolations = store.db.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
    assert.equal(foreignKeyViolations.length, 0);

    const observationsCountRow = store.db.prepare("SELECT COUNT(*) AS count FROM observations").get() as { count?: number };
    const requestExecutionsCountRow = store.db
      .prepare("SELECT COUNT(*) AS count FROM request_executions")
      .get() as { count?: number };
    const orphanRequestExecutionsRow = store.db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM request_executions re
      LEFT JOIN observations o ON o.request_id = re.request_id
          WHERE o.id IS NULL`
      )
      .get() as { count?: number };

    assert.ok((observationsCountRow.count ?? 0) >= 1);
    assert.equal(requestExecutionsCountRow.count, observationsCountRow.count);
    assert.equal(orphanRequestExecutionsRow.count, 0);
    assert.equal(service.listRecentObservations({ limit: 50 }).length, observationsCountRow.count);

    closeObservabilityStore(store);
  } finally {
    if (writer && !writer.killed) {
      writer.kill("SIGKILL");
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("observability busy retry retries SQLITE_BUSY before succeeding", async () => {
  let attempts = 0;

  const result = await withSqliteBusyRetry(
    () => {
      attempts += 1;

      if (attempts < 3) {
        const error = new Error("database is locked") as Error & { errcode?: number; errstr?: string };
        error.errcode = 5;
        error.errstr = "database is locked";
        throw error;
      }

      return "ok";
    },
    {
      retryAttempts: 3,
      retryDelayMs: 0
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});
