import { describe, it } from "node:test";
import assert from "node:assert";
import { Mutex } from "../src";
import { sleep } from "./utils";

describe("Mutex", () => {
  it("should immediately acquire and release", async () => {
    const mutex = new Mutex();
    assert.strictEqual(await mutex.isLocked(), false);

    const releaser = await mutex.acquire();
    assert.strictEqual(await mutex.isLocked(), true);

    await releaser.release();
    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should wait for mutex to be available", async () => {
    const mutex = new Mutex();
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
    const mutex = new Mutex();
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
    const mutex = new Mutex();
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
    const mutex = new Mutex();
    const releaser = await mutex.acquire();

    await releaser.release();
    await releaser.release();

    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should limit concurrent access", async () => {
    const mutex = new Mutex();
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

  it("should acquire and release the mutex automatically", async () => {
    const mutex = new Mutex();
    let lockedInside = false;

    await mutex.runExclusive(() => {
      lockedInside = true;
      return;
    });

    assert.strictEqual(lockedInside, true, "Callback should have been executed");
    assert.strictEqual(await mutex.isLocked(), false, "Mutex should be unlocked after runExclusive");
  });

  it("should return the result of the callback", async () => {
    const mutex = new Mutex();

    const result = await mutex.runExclusive(() => {
      return 42;
    });

    assert.strictEqual(result, 42, "runExclusive should return the callback’s result");
  });

  it("should handle async callbacks properly", async () => {
    const mutex = new Mutex();

    const result = await mutex.runExclusive(async () => {
      await sleep(50);
      return "async result";
    });

    assert.strictEqual(result, "async result", "runExclusive should return result of async callback");
    assert.strictEqual(await mutex.isLocked(), false, "Mutex should be unlocked");
  });


  it("should release the mutex if the callback throws an error", async () => {
    const mutex = new Mutex();

    let errorCaught = false;
    try {
      await mutex.runExclusive(() => {
        throw new Error("Test Error");
      });
    } catch (err: any) {
      errorCaught = true;
      assert.strictEqual(err.message, "Test Error");
    }

    assert.strictEqual(errorCaught, true, "Error should be thrown from callback");
    assert.strictEqual(await mutex.isLocked(), false, "Mutex should be unlocked after error");
  });

  it("should enforce exclusive access", async () => {
    const mutex = new Mutex();
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }).map(async () => {
      return mutex.runExclusive(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(50);
        concurrent--;
      });
    });

    await Promise.all(tasks);

    assert.strictEqual(maxConcurrent, 1, "Should never exceed concurrency of 1");
  });

  it("should wait for the mutex to be unlocked", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire();

    assert.strictEqual(await mutex.isLocked(), true, "Mutex should be locked");

    setTimeout(() => {
      releaser.release();
    }, 100);

    assert.strictEqual(await mutex.isLocked(), true, "Mutex should be locked")

    await mutex.waitForUnlock();

    assert.strictEqual(await mutex.isLocked(), false, "Mutex should be unlocked");
  });
});
