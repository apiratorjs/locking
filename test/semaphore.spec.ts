import { describe, it } from "node:test";
import assert from "node:assert";
import { Semaphore, TimeoutLockingError, CancelledLockingError } from "../src";
import { TSemaphoreToken } from "../src/types";
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

    assert.ok(error instanceof TimeoutLockingError, "Error should be TimeoutLockingError");
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

    assert.ok(error1 instanceof CancelledLockingError, "Error should be CancelledLockingError");
    assert.ok(error2 instanceof CancelledLockingError, "Error should be CancelledLockingError");
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

  it("should wait for the semaphore to be unlocked", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    assert.strictEqual(await semaphore.isLocked(), true, "Semaphore should be locked");

    setTimeout(() => {
      releaser.release();
    }, 100);

    assert.strictEqual(await semaphore.isLocked(), true, "Semaphore should be locked")

    await semaphore.waitForAnyUnlock();

    assert.strictEqual(await semaphore.isLocked(), false, "Semaphore should be unlocked");
  });

  it("should wait for the semaphore to be unlocked of first 3 slots of 5", async () => {
    const semaphore = new Semaphore(5);
    const releaser = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();
    const releaser3 = await semaphore.acquire();
    const releaser4 = await semaphore.acquire();
    const releaser5 = await semaphore.acquire();

    assert.strictEqual(await semaphore.isLocked(), true, "Semaphore should be locked");
    assert.strictEqual(await semaphore.freeCount(), 0, "Semaphore should have no free slots");

    setTimeout(() => {
      releaser.release();
      releaser2.release();
      releaser3.release();
    }, 100);

    setTimeout(() => {
      releaser4.release();
      releaser5.release();
    }, 200);

    await semaphore.waitForAnyUnlock();

    assert.strictEqual(await semaphore.freeCount(), 3, "Semaphore should have 3 slots free");
  });

  it("should wait for the semaphore to be fully unlocked", async () => {
    const semaphore = new Semaphore(5);
    const releaser = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();
    const releaser3 = await semaphore.acquire();
    const releaser4 = await semaphore.acquire();
    const releaser5 = await semaphore.acquire();

    assert.strictEqual(await semaphore.isLocked(), true, "Semaphore should be locked");
    assert.strictEqual(await semaphore.freeCount(), 0, "Semaphore should have no free slots");

    setTimeout(() => {
      releaser.release();
      releaser2.release();
      releaser3.release();
    }, 100);

    setTimeout(() => {
      releaser4.release();
      releaser5.release();
    }, 200);

    await semaphore.waitForFullyUnlock();

    assert.strictEqual(await semaphore.freeCount(), 5, "Semaphore should have 3 slots free");
  });

  it("should not hand back extra permits when the same releaser is released twice", async () => {
    const semaphore = new Semaphore(2);

    const releaser1 = await semaphore.acquire();
    const releaser2 = await semaphore.acquire();
    assert.strictEqual(await semaphore.freeCount(), 0);

    await releaser1.release();
    await releaser1.release();

    assert.strictEqual(await semaphore.freeCount(), 1, "Double release must free exactly one permit");

    // Only one permit is really free, so the second acquisition must not be admitted
    // while releaser2 is still inside its critical section.
    await semaphore.acquire();
    const extra = await semaphore.acquire({ timeoutMs: 100 }).catch(err => err);

    assert.ok(extra instanceof TimeoutLockingError, "Semaphore must not admit more holders than maxCount");

    await releaser2.release();
  });

  it("should keep held permits held when cancelAll is called", async () => {
    const semaphore = new Semaphore(1);

    const releaser = await semaphore.acquire();

    const pending = semaphore.acquire({ timeoutMs: 200 }).catch(err => err);
    await sleep(50);

    await semaphore.cancelAll();

    assert.ok((await pending) instanceof CancelledLockingError, "Pending acquisition should be cancelled");
    assert.strictEqual(await semaphore.isLocked(), true, "The active holder should still hold its permit");
    assert.strictEqual(await semaphore.freeCount(), 0, "cancelAll must not reset the permit count");

    const afterCancel = await semaphore.acquire({ timeoutMs: 100 }).catch(err => err);
    assert.ok(afterCancel instanceof TimeoutLockingError, "No new holder may be admitted alongside the active one");

    await releaser.release();
    assert.strictEqual(await semaphore.isLocked(), false);
    assert.strictEqual(await semaphore.freeCount(), 1);
  });

  it("should fail fast when timeoutMs is 0", async () => {
    const semaphore = new Semaphore(1);

    // A free semaphore is still acquired immediately with timeoutMs 0
    const releaser = await semaphore.acquire({ timeoutMs: 0 });

    const startedAt = Date.now();
    const rejected = await semaphore.acquire({ timeoutMs: 0 }).catch(err => err);

    assert.ok(rejected instanceof TimeoutLockingError, "timeoutMs 0 must not fall back to the default timeout");
    assert.ok(Date.now() - startedAt < 1_000, "timeoutMs 0 must reject right away");

    await releaser.release();
  });

  it("should keep unlock listeners waiting when cancelAll is called", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    let anyUnlockSettled = false;
    let fullyUnlockSettled = false;
    const anyUnlock = semaphore.waitForAnyUnlock().then(() => { anyUnlockSettled = true; });
    const fullyUnlock = semaphore.waitForFullyUnlock().then(() => { fullyUnlockSettled = true; });

    await semaphore.cancelAll();
    await sleep(50);

    assert.strictEqual(anyUnlockSettled, false, "cancelAll must not settle waitForAnyUnlock - the semaphore is still alive");
    assert.strictEqual(fullyUnlockSettled, false, "cancelAll must not settle waitForFullyUnlock - the semaphore is still alive");

    // ...and they are notified once the permit actually comes back
    await releaser.release();
    await anyUnlock;
    await fullyUnlock;

    assert.strictEqual(anyUnlockSettled, true);
    assert.strictEqual(fullyUnlockSettled, true);
  });

  it("should resolve unlock listeners when the semaphore is disposed", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    const anyUnlock = semaphore.waitForAnyUnlock();
    const fullyUnlock = semaphore.waitForFullyUnlock();
    const pendingAcquire = semaphore.acquire({ timeoutMs: 500 }).catch(err => err);

    await semaphore.dispose("Semaphore destroyed");

    // Unlock listeners resolve rather than reject: a lock that no longer exists
    // cannot be held, and a fire-and-forget waiter must not blow up the process.
    await anyUnlock;
    await fullyUnlock;

    assert.ok((await pendingAcquire) instanceof CancelledLockingError, "Pending acquisitions are still cancelled");
  });

  it("should use the token it was given for the acquisition", async () => {
    const semaphore = new Semaphore(2);

    const withOwnToken = await semaphore.acquire();
    assert.ok(withOwnToken.getToken(), "Without a token a uuid is generated");

    // A layer on top of the semaphore brands the acquisition, and the releaser the
    // caller gets back reports exactly that token - one acquisition, one identity.
    const given = "mutex:orders:42" as unknown as TSemaphoreToken;
    const withGivenToken = await semaphore.acquire({ timeoutMs: 100 }, given);

    assert.strictEqual(withGivenToken.getToken(), given);

    await withOwnToken.release();
    await withGivenToken.release();
  });

  it("should keep the given token for an acquisition that had to wait", async () => {
    const semaphore = new Semaphore(1);

    const held = await semaphore.acquire();
    const given = "semaphore:uploads:7" as unknown as TSemaphoreToken;
    const queued = semaphore.acquire({ timeoutMs: 500 }, given);

    await sleep(20);
    await held.release();

    assert.strictEqual((await queued).getToken(), given);
  });
});
