import { describe, it } from "node:test";
import assert from "node:assert";
import {
  InMemoryDistributedLockManager,
  TimeoutLockingError,
  CancelledLockingError,
  LockNotFoundError,
} from "../src";
import { InMemoryDistributedSemaphore } from "../src/in-memory-distributed/in-memory-distributed-semaphore";
import { sleep } from "./utils";

describe("In-memory distributed semaphore", () => {
  it("should immediately acquire and release", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });
    assert.strictEqual(await semaphore.isLocked(), false);
    assert.strictEqual(await semaphore.freeCount(), 1);

    const releaser = await semaphore.acquire();
    assert.strictEqual(await semaphore.isLocked(), true);
    assert.strictEqual(await semaphore.freeCount(), 0);

    await releaser.release();
    assert.strictEqual(await semaphore.isLocked(), false);
    assert.strictEqual(await semaphore.freeCount(), 1);
  });

  it("should wait for semaphore to be available", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });
    const releaser = await semaphore.acquire();

    let acquired = false;
    const acquirePromise = semaphore.acquire().then(() => {
      acquired = true;
    });

    await sleep(50);
    assert.strictEqual(acquired, false, "Second acquire should be waiting");

    await releaser.release();
    await acquirePromise;
    assert.strictEqual(
      acquired,
      true,
      "Second acquire should succeed after release",
    );
  });

  it("should time out on acquire if semaphore is not released", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });
    const releaser = await semaphore.acquire();

    let error: Error | undefined;
    try {
      await semaphore.acquire({ timeoutMs: 100 });
    } catch (err: any) {
      error = err;
    }

    assert.ok(
      error instanceof TimeoutLockingError,
      "Error should be TimeoutLockingError",
    );
    assert.strictEqual(error!.message, "Timeout acquiring semaphore");

    await releaser.release();
  });

  it("should cancel all pending acquisitions", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });
    const releaser = await semaphore.acquire();

    let error1: Error | undefined,
      error2: Error | undefined;
    const p1 = semaphore.acquire().catch((err) => {
      error1 = err;
    });
    const p2 = semaphore.acquire().catch((err) => {
      error2 = err;
    });

    await sleep(50);
    await semaphore.cancelAll();

    await Promise.allSettled([p1, p2]);

    assert.ok(
      error1 instanceof CancelledLockingError,
      "Error should be CancelledLockingError",
    );
    assert.ok(
      error2 instanceof CancelledLockingError,
      "Error should be CancelledLockingError",
    );
    assert.strictEqual(error1!.message, "Semaphore cancelled");
    assert.strictEqual(error2!.message, "Semaphore cancelled");

    await releaser.release();
  });

  it("should not increase freeCount beyond maxCount on over-release", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 2,
      name: "semaphore1",
    });

    const releaser1 = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();

    await releaser1.release();
    await releaser2.release();

    assert.strictEqual(await semaphore.isLocked(), false);

    await releaser2.release();
    assert.strictEqual(await semaphore.isLocked(), false);
  });

  it("should limit concurrent access according to semaphore count", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 3,
      name: "semaphore1",
    });
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }).map(async () => {
      const releaser = await semaphore.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(50);
      concurrent--;
      await releaser.release();
    });

    await Promise.all(tasks);
    assert.ok(
      maxConcurrent <= 3,
      "Max concurrent tasks should not exceed semaphore limit",
    );
  });

  it("should share state through the manager for the same name", async () => {
    const manager = new InMemoryDistributedLockManager();
    const sem1 = manager.semaphore("sharedSemaphore", 1);
    const sem2 = manager.semaphore("sharedSemaphore", 1);

    assert.strictEqual(sem1, sem2);

    const releaser = await sem1.acquire();
    assert.strictEqual(await sem2.freeCount(), 0);

    await releaser.release();
    assert.strictEqual(await sem2.freeCount(), 1);
  });

  it("should destroy the semaphore and reject further acquires", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphoreDestroyTest",
    });

    const releaser = await semaphore.acquire();
    await releaser.release();
    assert.strictEqual(await semaphore.isLocked(), false);

    await semaphore.destroy();
    assert.strictEqual(
      semaphore.isDestroyed,
      true,
      "Semaphore should be marked as destroyed",
    );

    await assert.rejects(
      async () => semaphore.acquire(),
      (err: Error) =>
        err instanceof LockNotFoundError && /does not exist/.test(err.message),
      "Acquiring after destroy should throw LockNotFoundError",
    );
  });

  it("should return acquired distributed token after successful acquire", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });

    const releaser = await semaphore.acquire();

    const token = releaser.getToken();
    assert.ok(token);
    assert.ok(token.includes("semaphore:semaphore1:"));

    await releaser.release();
  });

  it("should reject waiters when destroy is called while locked", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "semaphore1",
    });

    assert.ok((await semaphore.freeCount()) === 1, "Initial freeCount should be 1");

    await semaphore.acquire();

    assert.ok(
      (await semaphore.freeCount()) === 0,
      "After acquire, freeCount should be 0",
    );

    let acquired = false;
    const pending = semaphore.acquire().then(() => {
      acquired = true;
    });

    await semaphore.destroy();

    let pendingError: Error | undefined;
    try {
      await pending;
    } catch (err: any) {
      pendingError = err;
    }

    assert.ok(
      pendingError instanceof CancelledLockingError,
      "Error should be CancelledLockingError",
    );
    assert.strictEqual(
      pendingError!.message,
      "Semaphore destroyed",
      "Error message should be 'Semaphore destroyed'",
    );
    assert.ok(!acquired, "Pending acquire should not succeed");
  });

  it("should treat destroy as idempotent", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "destroyTwice",
    });

    await semaphore.destroy();
    await semaphore.destroy();

    assert.strictEqual(semaphore.isDestroyed, true);
  });

  it("should not attach an old handle to a lock recreated under the same name via the manager", async () => {
    const manager = new InMemoryDistributedLockManager();
    const oldHandle = manager.semaphore("recreated", 1);

    const heldOnOldGeneration = await oldHandle.acquire();
    await oldHandle.destroy();

    assert.strictEqual(manager.hasSemaphore("recreated"), false);

    const newHandle = manager.semaphore("recreated", 1);
    assert.notStrictEqual(newHandle, oldHandle);
    assert.strictEqual(await newHandle.isLocked(), false);

    assert.strictEqual(oldHandle.isDestroyed, true);
    await assert.rejects(() => oldHandle.acquire(), LockNotFoundError);

    await heldOnOldGeneration.release();
    assert.strictEqual(await newHandle.freeCount(), 1);
  });

  it("should resolve unlock listeners when the semaphore is destroyed", async () => {
    const semaphore = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "destroyWaiters",
    });
    await semaphore.acquire();

    const anyUnlock = semaphore.waitForAnyUnlock();
    const fullyUnlock = semaphore.waitForFullyUnlock();
    const pendingAcquire = semaphore
      .acquire({ timeoutMs: 500 })
      .catch((err) => err);

    await semaphore.destroy();

    await anyUnlock;
    await fullyUnlock;
    assert.ok(
      (await pendingAcquire) instanceof CancelledLockingError,
      "Pending acquisitions are still cancelled",
    );
  });

  it("should create independent locks for the same name outside a manager", async () => {
    const first = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "alone",
    });
    const second = new InMemoryDistributedSemaphore({
      maxCount: 1,
      name: "alone",
    });

    const releaser = await first.acquire();
    assert.strictEqual(await first.freeCount(), 0);
    assert.strictEqual(await second.freeCount(), 1);

    await first.destroy();
    assert.strictEqual(first.isDestroyed, true);
    assert.strictEqual(second.isDestroyed, false);

    await releaser.release();
  });
});
