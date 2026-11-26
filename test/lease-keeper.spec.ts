import { describe, it } from "node:test";
import assert from "node:assert";
import { LeaseKeeper, LeaseLostLockingError, Mutex, Semaphore } from "../src";
import { ILeaseReleaser, TAcquireToken } from "../src/types";
import { sleep } from "./utils";

function fakeReleaser(extend: () => Promise<boolean>): ILeaseReleaser<TAcquireToken> & { released: boolean } {
  const releaser = {
    released: false,
    extend,
    release: async () => {
      releaser.released = true;
    },
    getToken: () => "fake" as TAcquireToken,
    remainingTtl: async () => null,
    isHeld: async () => !releaser.released,
  };

  return releaser;
}

describe("LeaseKeeper", () => {
  it("should keep a mutex lock alive past its TTL while the work runs", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire({ ttlMs: 50 });

    const result = await LeaseKeeper.hold(releaser, { ttlMs: 50, extendIntervalMs: 15 }, async ({ signal }) => {
      await sleep(150);

      assert.strictEqual(signal.aborted, false);
      assert.strictEqual(await releaser.isHeld(), true);

      return "done";
    });

    assert.strictEqual(result, "done");
    assert.strictEqual(await mutex.isLocked(), false, "The lock must be released after the work");
  });

  it("should keep a semaphore permit alive and release it", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 50 });

    await LeaseKeeper.hold(releaser, { ttlMs: 50, extendIntervalMs: 15 }, async () => {
      await sleep(120);
      assert.strictEqual(await semaphore.freeCount(), 0);
    });

    assert.strictEqual(await semaphore.freeCount(), 1);
  });

  it("should release the lease and rethrow when the work throws", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire({ ttlMs: 1000 });

    await assert.rejects(
      LeaseKeeper.hold(releaser, { ttlMs: 1000, extendIntervalMs: 100 }, async () => {
        throw new Error("work failed");
      }),
      /work failed/,
    );

    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should abort the signal when an extension finds the lease gone", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire({ ttlMs: 1000 });

    await LeaseKeeper.hold(releaser, { ttlMs: 1000, extendIntervalMs: 15 }, async ({ signal, throwIfLost }) => {
      await mutex.restoreReleaser(releaser.getToken()).release();
      await sleep(60);

      assert.strictEqual(signal.aborted, true);
      assert.ok(signal.reason instanceof LeaseLostLockingError);
      assert.throws(() => throwIfLost(), LeaseLostLockingError);
    });
  });

  it("should abort the signal with the cause when an extension fails", async () => {
    const failure = new Error("backend unreachable");
    const releaser = fakeReleaser(async () => {
      throw failure;
    });

    await LeaseKeeper.hold(releaser, { ttlMs: 100, extendIntervalMs: 10 }, async ({ signal }) => {
      await sleep(40);

      assert.ok(signal.reason instanceof LeaseLostLockingError);
      assert.strictEqual((signal.reason as LeaseLostLockingError).cause, failure);
    });

    assert.strictEqual(releaser.released, true);
  });

  it("should not let a slow extension overlap with the next one", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releaser = fakeReleaser(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(50);
      inFlight--;

      return true;
    });

    await LeaseKeeper.hold(releaser, { ttlMs: 1000, extendIntervalMs: 10 }, async () => {
      await sleep(150);
    });

    assert.strictEqual(maxInFlight, 1);
  });

  it("should not throw from throwIfLost while the lease is held", async () => {
    const releaser = fakeReleaser(async () => true);

    await LeaseKeeper.hold(releaser, { ttlMs: 100, extendIntervalMs: 10 }, async ({ throwIfLost }) => {
      await sleep(30);
      throwIfLost();
    });
  });

  it("should reject an extension interval that is not below the TTL", async () => {
    const releaser = fakeReleaser(async () => true);

    await assert.rejects(
      LeaseKeeper.hold(releaser, { ttlMs: 100, extendIntervalMs: 100 }, async () => undefined),
      /extendIntervalMs must be greater than 0 and smaller than ttlMs/,
    );
    assert.strictEqual(releaser.released, false, "Invalid options must fail before the lease is taken over");
  });
});
