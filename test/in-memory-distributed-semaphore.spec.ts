import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { DistributedSemaphore, InMemoryDistributedRegistry } from "../src";
import { sleep } from "./utils";
import { IReleaser } from "../src/types";

describe("DistributedSemaphore (In Memory by default)", () => {
  beforeEach(() => {
    InMemoryDistributedRegistry.clearSemaphoreRegistry();
  });

  it("should immediately acquire and release", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });
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
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });
    const releaser = await semaphore.acquire();

    let acquired = false;
    const acquirePromise = semaphore.acquire().then(() => {
      acquired = true;
    });

    await sleep(50);
    assert.strictEqual(acquired, false, "Second acquire should be waiting");

    await releaser.release();
    await acquirePromise;
    assert.strictEqual(acquired, true, "Second acquire should succeed after release");
  });

  it("should time out on acquire if semaphore is not released", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });
    const releaser = await semaphore.acquire();

    let error: Error | undefined;
    try {
      const releaser2 = await semaphore.acquire({ timeoutMs: 100 });
    } catch (err: any) {
      error = err;
    }

    assert.ok(error instanceof Error, "Error should be thrown on timeout");
    assert.strictEqual(error!.message, "Timeout acquiring semaphore");

    await releaser.release();
  });

  it("should cancel all pending acquisitions", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });
    const releaser = await semaphore.acquire();

    let error1: Error | undefined, error2: Error | undefined;
    const p1 = semaphore.acquire().catch((err) => { error1 = err; });
    const p2 = semaphore.acquire().catch((err) => { error2 = err; });

    // Allow the pending acquisitions to queue.
    await sleep(50);
    await semaphore.cancelAll();

    // Wait for both promises to settle.
    await Promise.allSettled([p1, p2]);

    assert.strictEqual(error1!.message, "Semaphore cancelled");
    assert.strictEqual(error2!.message, "Semaphore cancelled");

    await releaser.release();
  });

  it("should not increase freeCount beyond maxCount on over-release", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 2, name: "semaphore1" });

    const releaser1 = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();

    await releaser1.release();
    await releaser2.release();

    assert.strictEqual(await semaphore.isLocked(), false);

    await releaser2.release();
    assert.strictEqual(await semaphore.isLocked(), false);
  });

  it("should limit concurrent access according to semaphore count", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 3, name: "semaphore1" });
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }).map(async () => {
      const releaser = await semaphore.acquire();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Simulate asynchronous work.
      await sleep(50);
      concurrent--;
      await releaser.release();
    });

    await Promise.all(tasks);
    assert.ok(maxConcurrent <= 3, "Max concurrent tasks should not exceed semaphore limit");
  });

  it("should share state between two instances with the same name", async () => {
    const name = "sharedSemaphore";
    const sem1 = new DistributedSemaphore({ maxCount: 1, name });
    const sem2 = new DistributedSemaphore({ maxCount: 1, name });

    assert.strictEqual(await sem1.freeCount(), 1, "sem1 initial freeCount should be 1");
    assert.strictEqual(await sem2.freeCount(), 1, "sem2 initial freeCount should be 1");

    const releaser1 = await sem1.acquire();
    assert.strictEqual(await sem1.freeCount(), 0, "After sem1 acquire, freeCount should be 0");
    assert.strictEqual(await sem2.freeCount(), 0, "After sem1 acquire, sem2 freeCount should be 0");

    let sem2Acquired = false;
    let releaser2: IReleaser;
    const acquirePromise = sem2.acquire().then((releaser) => {
      releaser2 = releaser;
      sem2Acquired = true;
    });

    await sleep(50);
    assert.strictEqual(sem2Acquired, false, "sem2 acquire should be pending");

    await releaser1.release();
    await acquirePromise;
    assert.strictEqual(sem2Acquired, true, "sem2 should acquire after sem1 releases");

    assert.strictEqual(await sem1.freeCount(), 0, "After sem2 acquired, freeCount should be 0");
    assert.strictEqual(await sem2.freeCount(), 0, "After sem2 acquired, freeCount should be 0");

    await releaser2!.release();
    assert.strictEqual(await sem1.freeCount(), 1, "After release, freeCount should be back to 1 (sem1)");
    assert.strictEqual(await sem2.freeCount(), 1, "After release, freeCount should be back to 1 (sem2)");
  });

  it("should cancel pending acquisitions across instances", async () => {
    const name = "sharedSemaphoreCancel";
    const sem1 = new DistributedSemaphore({ maxCount: 1, name });
    const sem2 = new DistributedSemaphore({ maxCount: 1, name });

    const releaser1 = await sem1.acquire();

    let errorFromSem2: Error;
    const pending = sem2.acquire().catch((err) => { errorFromSem2 = err; });

    await sleep(50);
    await sem1.cancelAll();

    await pending;
    assert.ok(errorFromSem2! instanceof Error, "Pending acquire should be rejected after cancelAll");
    assert.strictEqual(errorFromSem2!.message, "Semaphore cancelled");

    await releaser1.release();
    assert.strictEqual(await sem1.freeCount(), 1, "Semaphore should be free after release");
  });

  it("should destroy the semaphore and remove it from the store", async () => {
    const name = "semaphoreDestroyTest";
    const semaphore = new DistributedSemaphore({ maxCount: 1, name });

    const releaser = await semaphore.acquire();
    await releaser.release();
    assert.strictEqual(await semaphore.isLocked(), false);

    await semaphore.destroy();
    assert.strictEqual(semaphore.isDestroyed, true, "Semaphore should be marked as destroyed");

    assert.strictEqual(InMemoryDistributedRegistry.hasSemaphore(semaphore.name), false);

    await assert.rejects(
      async () => semaphore.acquire(),
      /does not exist/,
      "Acquiring after destroy should throw an error"
    );
  });

  it("should return acquired distributed token after successful acquire", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });

    const releaser = await semaphore.acquire();

    const token = releaser.getToken();
    assert.ok(token);
    assert.ok(token.includes("semaphore:semaphore1:"));

    await releaser.release();
  });

  it("should remove the lock and reject waiters when destroy is called while locked", async () => {
    const semaphore = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });

    assert.ok(await semaphore.freeCount() === 1, "Initial freeCount should be 1");

    const releaser = await semaphore.acquire();

    assert.ok(await semaphore.freeCount() === 0, "After acquire, freeCount should be 0");

    const semaphore2 = new DistributedSemaphore({ maxCount: 1, name: "semaphore1" });

    assert.ok(await semaphore2.freeCount() === 0, "New semaphore with the same name should not have free count");

    let semaphore2Acquired = false;
    const p = semaphore2.acquire().then(() => {
      semaphore2Acquired = true;
    });

    await semaphore.destroy();

    let pError: Error | undefined;
    try {
      await p;
    } catch (err: any) {
      pError = err;
    }

    assert.ok(pError, "Second semaphore should be rejected");
    assert.ok(pError!.message === "Semaphore destroyed", "Error message should be 'Semaphore destroyed'");
    assert.ok(!semaphore2Acquired, "Second semaphore should not be acquired");
  });
});
