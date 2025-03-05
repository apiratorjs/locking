import { describe, it } from "node:test";
import assert from "node:assert";
import { Semaphore } from "../src";
import { sleep } from "./utils";

describe("Semaphore", () => {
  it("should immediately acquire and release", async () => {
    const semaphore = new Semaphore(1);
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
    const semaphore = new Semaphore(1);
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
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    let error: Error | undefined;
    try {
      await semaphore.acquire({ timeoutMs: 100 });
    } catch (err: any) {
      error = err;
    }

    assert.ok(error instanceof Error, "Error should be thrown on timeout");
    assert.strictEqual(error!.message, "Timeout acquiring semaphore");

    await releaser.release();
  });

  it("should cancel all pending acquisitions", async () => {
    const semaphore = new Semaphore(1);
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
    const semaphore = new Semaphore(2);

    const releaser1 = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();

    await releaser1.release();
    await releaser2.release();

    assert.strictEqual(await semaphore.isLocked(), false);

    await releaser2.release();
    assert.strictEqual(await semaphore.isLocked(), false);
  });

  it("should limit concurrent access according to semaphore count", async () => {
    const semaphore = new Semaphore(3);
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

  it("should acquire and release a semaphore slot automatically", async () => {
    const semaphore = new Semaphore(2);
    let insideCallback = false;

    await semaphore.runExclusive(() => {
      insideCallback = true;
    });

    assert.strictEqual(insideCallback, true, "Callback should have run");
    assert.strictEqual(await semaphore.freeCount(), 2, "Semaphore should have all slots free after runExclusive");
  });

  it("should return the callback's result", async () => {
    const semaphore = new Semaphore(2);
    const result = await semaphore.runExclusive(() => 1234);

    assert.strictEqual(result, 1234, "Should return the callback’s value");
  });

  it("should handle async callbacks", async () => {
    const semaphore = new Semaphore(2);
    const result = await semaphore.runExclusive(async () => {
      await sleep(20);
      return "hello";
    });

    assert.strictEqual(result, "hello");
    assert.strictEqual(await semaphore.freeCount(), 2, "All slots should be free again");
  });


  it("should release a slot if the callback throws an error", async () => {
    const semaphore = new Semaphore(2);

    let errorCaught = false;
    try {
      await semaphore.runExclusive(() => {
        throw new Error("Failing callback");
      });
    } catch (err: any) {
      errorCaught = true;
      assert.strictEqual(err.message, "Failing callback");
    }

    assert.strictEqual(errorCaught, true, "Error was not caught");
    assert.strictEqual(await semaphore.freeCount(), 2, "All slots should be free");
  });


  it("should enforce the semaphore concurrency limit", async () => {
    const semaphore = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }).map(async () => {
      return semaphore.runExclusive(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(30);
        concurrent--;
      });
    });

    await Promise.all(tasks);
    assert.ok(maxConcurrent <= 2, "Should respect concurrency limit of 2");
  });
});
