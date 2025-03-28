import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { sleep } from "./utils";
import { DistributedMutex, InMemoryDistributedRegistry } from "../src";
import { IReleaser } from "../src/types";

const DISTRIBUTED_MUTEX_NAME = "mutex1";

describe("DistributedMutex (In Memory by default)", () => {
  beforeEach(() => {
    InMemoryDistributedRegistry.clearMutexRegistry();
  });

  it("should immediately acquire and release", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    assert.strictEqual(await mutex.isLocked(), false);

    const releaser = await mutex.acquire();
    assert.strictEqual(await mutex.isLocked(), true);

    await releaser.release();
    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should wait for mutex to be available", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    const releaser = await mutex.acquire();

    let acquired = false;
    const acquirePromise = mutex.acquire().then(() => {
      acquired = true;
    });

    await sleep(50);
    assert.strictEqual(acquired, false, "Second acquire should be waiting");

    await releaser.release();
    await acquirePromise;
    assert.strictEqual(acquired, true, "Second acquire should succeed after release");
  });

  it("should time out on acquire if mutex is not released", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    const releaser = await mutex.acquire();

    let error: Error | undefined;
    try {
      await mutex.acquire({ timeoutMs: 100 });
    } catch (err: any) {
      error = err;
    }

    assert.ok(error instanceof Error, "Error should be thrown on timeout");
    assert.strictEqual(error!.message, "Timeout acquiring semaphore");

    await releaser.release();
  });

  it("should cancel pending acquisitions", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    const releaser = await mutex.acquire();

    let error1: Error | undefined, error2: Error | undefined;
    const p1 = mutex.acquire().catch((err) => { error1 = err; });
    const p2 = mutex.acquire().catch((err) => { error2 = err; });

    await sleep(50);
    await mutex.cancel();

    await Promise.allSettled([p1, p2]);

    assert.strictEqual(error1!.message, "Mutex cancelled");
    assert.strictEqual(error2!.message, "Mutex cancelled");

    await releaser.release();
  });

  it("should gracefully handle multiple consecutive release calls", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    const releaser = await mutex.acquire();

    await releaser.release();
    await releaser.release();

    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should limit concurrent access", async () => {
    const mutex = new DistributedMutex({ name: DISTRIBUTED_MUTEX_NAME });
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }).map(async () => {
      const releaser = await mutex.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Simulate asynchronous work.
      await sleep(50);
      concurrent--;
      await releaser.release();
    });

    await Promise.all(tasks);
    assert.strictEqual(maxConcurrent, 1, "Max concurrent tasks should not exceed 1");
  });

  it("should share state between two instances with the same name", async () => {
    const name = "sharedMutex";
    const mutex1 = new DistributedMutex({ name });
    const mutex2 = new DistributedMutex({ name });

    assert.strictEqual(await mutex1.isLocked(), false, "mutex1 should initially be unlocked");
    assert.strictEqual(await mutex2.isLocked(), false, "mutex2 should initially be unlocked");

    const releaser1 = await mutex1.acquire();
    assert.strictEqual(await mutex1.isLocked(), true, "After mutex1 acquire, mutex1 should be locked");
    assert.strictEqual(await mutex2.isLocked(), true, "After mutex1 acquire, mutex2 should be locked");

    let mutex2Acquired = false;
    let releaser2: IReleaser;
    const acquirePromise = mutex2.acquire().then((releaser) => {
      releaser2 = releaser;
      mutex2Acquired = true;
    });

    await sleep(50);
    assert.strictEqual(mutex2Acquired, false, "mutex2 acquire should be pending");

    await releaser1.release();
    await acquirePromise;
    assert.strictEqual(mutex2Acquired, true, "mutex2 should acquire after mutex1 releases");

    assert.strictEqual(await mutex1.isLocked(), true, "After mutex2 acquired, mutex1 should be locked");
    assert.strictEqual(await mutex2.isLocked(), true, "After mutex2 acquired, mutex2 should be locked");

    await releaser2!.release();
    assert.strictEqual(await mutex1.isLocked(), false, "After release, mutex1 should be unlocked");
    assert.strictEqual(await mutex2.isLocked(), false, "After release, mutex2 should be unlocked");
  });

  it("should cancel pending acquisitions across instances", async () => {
    const name = "sharedMutexCancel";
    const mutex1 = new DistributedMutex({ name });
    const mutex2 = new DistributedMutex({ name });

    const releaser = await mutex1.acquire();

    let errorFromMutex2: Error | undefined;
    const pending = mutex2.acquire().catch((err) => { errorFromMutex2 = err; });

    await sleep(50);
    await mutex1.cancel();

    await pending;
    assert.ok(errorFromMutex2 instanceof Error, "Pending acquire should be cancelled with an error");
    assert.strictEqual(errorFromMutex2!.message, "Mutex cancelled");

    await releaser.release();
    assert.strictEqual(await mutex1.isLocked(), false, "Mutex should be unlocked after release");
  });

  it("should destroy the semaphore and remove it from the store", async () => {
    const name = "sharedMutex";
    const mutex = new DistributedMutex({ name });

    const releaser = await mutex.acquire();
    await releaser.release();
    assert.strictEqual(await mutex.isLocked(), false);

    await mutex.destroy();
    assert.strictEqual(mutex.isDestroyed, true, "Mutex should be marked as destroyed");

    assert.strictEqual(InMemoryDistributedRegistry.hasMutex(mutex.name), false);

    await assert.rejects(
      async () => mutex.acquire(),
      /does not exist/,
      "Acquiring after destroy should throw an error"
    );
  });

  it("should return acquired distributed token after successful acquire", async () => {
    const mutex = new DistributedMutex({ name: "semaphore1" });

    const releaser = await mutex.acquire();

    const token = releaser.getToken();
    assert.ok(token);
    assert.ok(token.includes("mutex:semaphore1:"));

    await releaser.release();
  });

  it("should remove the lock and reject waiters when destroy is called while locked", async () => {
    const mutex = new DistributedMutex({ name: "semaphore1" });

    const releaser = await mutex.acquire();

    const mutex2 = new DistributedMutex({ name: "semaphore1" });

    let semaphore2Acquired = false;
    const p = mutex2.acquire().then(() => {
      semaphore2Acquired = true;
    });

    await mutex.destroy();

    let pError: Error | undefined;
    try {
      await p;
    } catch (err: any) {
      pError = err;
    }

    assert.ok(pError, "Second mutex should be rejected");
    assert.ok(pError!.message === "Mutex destroyed", "Error message should be 'Mutex destroyed'");
    assert.ok(!semaphore2Acquired, "Second mutex should not be acquired");
  });
});
