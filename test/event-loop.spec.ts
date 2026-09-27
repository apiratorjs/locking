import { describe, it } from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import path from "node:path";

const PACKAGE_ENTRY = path.join(__dirname, "..", "src");

/**
 * Runs a snippet in a child process and reports how long the process stayed alive.
 * The default acquire timeout is a minute, so anything that exits quickly proves
 * the pending timers are not holding the event loop by themselves.
 */
function runSnippet(snippet: string): Promise<{ ms: number; stderr: string; }> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const code = `const locking = require(${JSON.stringify(PACKAGE_ENTRY)});\n${snippet}`;

    execFile(process.execPath, ["-e", code], { timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Child process failed: ${err.message}\n${stderr}`));
        return;
      }

      resolve({ ms: Date.now() - startedAt, stderr });
    });
  });
}

describe("Event loop", () => {
  it("should not keep the process alive for a pending semaphore acquisition", async () => {
    const { ms, stderr } = await runSnippet(`
      (async () => {
        const semaphore = new locking.Semaphore(1);
        await semaphore.acquire();
        semaphore.acquire().catch(() => {});
      })();
    `);

    assert.ok(ms < 10_000, `Process should exit without waiting out the acquire timeout, took ${ms}ms`);
    assert.strictEqual(stderr, "");
  });

  it("should not keep the process alive for a pending read-write lock acquisition", async () => {
    const { ms, stderr } = await runSnippet(`
      (async () => {
        const rwLock = new locking.ReadWriteLock();
        await rwLock.acquireWrite();
        rwLock.acquireRead().catch(() => {});
        rwLock.acquireWrite().catch(() => {});
      })();
    `);

    assert.ok(ms < 10_000, `Process should exit without waiting out the acquire timeout, took ${ms}ms`);
    assert.strictEqual(stderr, "");
  });

  it("should not keep the process alive for an expiring semaphore permit", async () => {
    const { ms, stderr } = await runSnippet(`
      (async () => {
        const semaphore = new locking.Semaphore(1);
        await semaphore.acquire({ ttlMs: 30_000 });
      })();
    `);

    assert.ok(ms < 10_000, `Process should exit without waiting out the TTL, took ${ms}ms`);
    assert.strictEqual(stderr, "");
  });

  it("should keep the process alive until an expiring permit reaches a waiter", async () => {
    const { stderr } = await runSnippet(`
      (async () => {
        const semaphore = new locking.Semaphore(1);
        await semaphore.acquire({ ttlMs: 200 });

        // Fails the run unless the waiter is actually granted the permit
        process.exitCode = 1;

        await semaphore.acquire();
        process.exitCode = 0;
      })();
    `);

    assert.strictEqual(stderr, "");
  });

  it("should still reject a pending acquisition while the process is busy", async () => {
    const { stderr } = await runSnippet(`
      (async () => {
        const mutex = new locking.Mutex();
        await mutex.acquire();

        // Something else keeps the loop alive, so the timeout must still fire
        const keepAlive = setInterval(() => {}, 20);

        try {
          await mutex.acquire({ timeoutMs: 100 });
          process.exitCode = 1;
        } catch (err) {
          if (!(err instanceof locking.TimeoutLockingError)) {
            process.exitCode = 1;
          }
        } finally {
          clearInterval(keepAlive);
        }
      })();
    `);

    assert.strictEqual(stderr, "");
  });
});
