import { describe, it } from "node:test";
import assert from "node:assert";
import { sleep } from "./utils";
import {
  InMemoryDistributedLockManager,
  TimeoutLockingError,
  CancelledLockingError,
  LockNotFoundError,
} from "../src";
import { InMemoryDistributedMutex } from "../src/in-memory-distributed/in-memory-distributed-mutex";

const DISTRIBUTED_MUTEX_NAME = "mutex1";

describe("In-memory distributed mutex", () => {
  it("should immediately acquire and release", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    assert.strictEqual(await mutex.isLocked(), false);

    const releaser = await mutex.acquire();
    assert.strictEqual(await mutex.isLocked(), true);

    await releaser.release();
    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should wait for mutex to be available", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    const releaser = await mutex.acquire();

    let acquired = false;
    const acquirePromise = mutex.acquire().then(() => {
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

  it("should time out on acquire if mutex is not released", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    const releaser = await mutex.acquire();

    let error: Error | undefined;
    try {
      await mutex.acquire({ timeoutMs: 100 });
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

  it("should cancel pending acquisitions", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    const releaser = await mutex.acquire();

    let error1: Error | undefined,
      error2: Error | undefined;
    const p1 = mutex.acquire().catch((err) => {
      error1 = err;
    });
    const p2 = mutex.acquire().catch((err) => {
      error2 = err;
    });

    await sleep(50);
    await mutex.cancel();

    await Promise.allSettled([p1, p2]);

    assert.ok(
      error1 instanceof CancelledLockingError,
      "Error should be CancelledLockingError",
    );
    assert.ok(
      error2 instanceof CancelledLockingError,
      "Error should be CancelledLockingError",
    );
    assert.strictEqual(error1!.message, "Mutex cancelled");
    assert.strictEqual(error2!.message, "Mutex cancelled");

    await releaser.release();
  });

  it("should gracefully handle multiple consecutive release calls", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    const releaser = await mutex.acquire();

    await releaser.release();
    await releaser.release();

    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should limit concurrent access", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: DISTRIBUTED_MUTEX_NAME,
    });
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }).map(async () => {
      const releaser = await mutex.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(50);
      concurrent--;
      await releaser.release();
    });

    await Promise.all(tasks);
    assert.strictEqual(
      maxConcurrent,
      1,
      "Max concurrent tasks should not exceed 1",
    );
  });

  it("should share state through the manager for the same name", async () => {
    const manager = new InMemoryDistributedLockManager();
    const mutex1 = manager.mutex("sharedMutex");
    const mutex2 = manager.mutex("sharedMutex");

    assert.strictEqual(mutex1, mutex2);

    const releaser = await mutex1.acquire();
    assert.strictEqual(await mutex2.isLocked(), true);

    await releaser.release();
    assert.strictEqual(await mutex2.isLocked(), false);
  });

  it("should destroy the mutex and reject further acquires", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: "sharedMutex",
    });

    const releaser = await mutex.acquire();
    await releaser.release();
    assert.strictEqual(await mutex.isLocked(), false);

    await mutex.destroy();
    assert.strictEqual(mutex.isDestroyed, true, "Mutex should be marked as destroyed");

    await assert.rejects(
      async () => mutex.acquire(),
      (err: Error) =>
        err instanceof LockNotFoundError && /does not exist/.test(err.message),
      "Acquiring after destroy should throw LockNotFoundError",
    );
  });

  it("should return acquired distributed token after successful acquire", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: "semaphore1",
    });

    const releaser = await mutex.acquire();

    const token = releaser.getToken();
    assert.ok(token);
    assert.ok(token.includes("mutex:semaphore1:"));

    await releaser.release();
  });

  it("should reject waiters when destroy is called while locked", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: "semaphore1",
    });

    await mutex.acquire();

    let acquired = false;
    const pending = mutex.acquire().then(() => {
      acquired = true;
    });

    await mutex.destroy();

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
      "Mutex destroyed",
      "Error message should be 'Mutex destroyed'",
    );
    assert.ok(!acquired, "Pending acquire should not succeed");
  });

  it("should treat destroy as idempotent", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: "destroyTwice",
    });

    await mutex.destroy();
    await mutex.destroy();

    assert.strictEqual(mutex.isDestroyed, true);
  });

  it("should resolve waitForUnlock when the mutex is destroyed", async () => {
    const mutex = new InMemoryDistributedMutex({
      name: "destroyWaiters",
    });
    await mutex.acquire();

    const waiting = mutex.waitForUnlock();

    await mutex.destroy();

    await waiting;
  });

  it("should create independent locks for the same name outside a manager", async () => {
    const first = new InMemoryDistributedMutex({ name: "alone" });
    const second = new InMemoryDistributedMutex({ name: "alone" });

    const releaser = await first.acquire();
    assert.strictEqual(await first.isLocked(), true);
    assert.strictEqual(await second.isLocked(), false);

    await first.destroy();
    assert.strictEqual(first.isDestroyed, true);
    assert.strictEqual(second.isDestroyed, false);
    assert.strictEqual(await second.isLocked(), false);

    await releaser.release();
  });
});
