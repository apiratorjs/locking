import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { DistributedReadWriteLock, InMemoryDistributedRegistry } from "../src";
import { sleep } from "./utils";
import { IReleaser, ReadLockToken, WriteLockToken } from "../src/types";

describe("DistributedReadWriteLock (In Memory by default)", () => {
  beforeEach(() => {
    InMemoryDistributedRegistry.clearRWLockRegistry();
  });

  it("should immediately acquire write lock and release", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });
    assert.strictEqual(await rwLock.isWriteLocked(), false);

    const releaser = await rwLock.acquireWrite();
    assert.strictEqual(await rwLock.isWriteLocked(), true);

    await releaser.release();
    assert.strictEqual(await rwLock.isWriteLocked(), false);
  });

  it("should immediately acquire read lock and release", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });
    assert.strictEqual(await rwLock.activeReaders(), 0);

    const releaser = await rwLock.acquireRead();
    assert.strictEqual(await rwLock.activeReaders(), 1);

    await releaser.release();
    assert.strictEqual(await rwLock.activeReaders(), 0);
  });

  it("should allow multiple concurrent read locks", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    const releaser1 = await rwLock.acquireRead();
    const releaser2 = await rwLock.acquireRead();
    const releaser3 = await rwLock.acquireRead();

    assert.strictEqual(await rwLock.activeReaders(), 3);

    await releaser1.release();
    assert.strictEqual(await rwLock.activeReaders(), 2);

    await releaser2.release();
    assert.strictEqual(await rwLock.activeReaders(), 1);

    await releaser3.release();
    assert.strictEqual(await rwLock.activeReaders(), 0);
  });

  it("should not allow write lock when read locks are active", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    const readReleaser = await rwLock.acquireRead();

    let writeAcquired = false;
    const writePromise = rwLock.acquireWrite().then(releaser => {
      writeAcquired = true;
      return releaser;
    });

    // Give time for the writePromise to potentially resolve
    await sleep(100);

    // Write lock should not be acquired while read lock is active
    assert.strictEqual(writeAcquired, false);

    // Release read lock
    await readReleaser.release();

    // Now write lock should be acquired
    const writeReleaser = await writePromise;
    assert.strictEqual(writeAcquired, true);
    assert.strictEqual(await rwLock.isWriteLocked(), true);

    await writeReleaser.release();
  });

  it("should not allow read locks when write lock is active", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    const writeReleaser = await rwLock.acquireWrite();

    let readAcquired = false;
    const readPromise = rwLock.acquireRead().then(releaser => {
      readAcquired = true;
      return releaser;
    });

    // Give time for the readPromise to potentially resolve
    await sleep(50);

    // Read lock should not be acquired while write lock is active
    assert.strictEqual(readAcquired, false);

    // Release write lock
    await writeReleaser.release();

    // Now read lock should be acquired
    const readReleaser = await readPromise;
    assert.strictEqual(readAcquired, true);
    assert.strictEqual(await rwLock.activeReaders(), 1);

    await readReleaser.release();
  });

  it("should queue write locks", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    const writer1 = await rwLock.acquireWrite();

    let writer2Acquired = false;
    const writer2Promise = rwLock.acquireWrite().then(releaser => {
      writer2Acquired = true;
      return releaser;
    });

    let writer3Acquired = false;
    const writer3Promise = rwLock.acquireWrite().then(releaser => {
      writer3Acquired = true;
      return releaser;
    });

    // Give time for promises to potentially resolve
    await sleep(50);

    // Neither writer2 nor writer3 should be acquired yet
    assert.strictEqual(writer2Acquired, false);
    assert.strictEqual(writer3Acquired, false);

    // Release writer1
    await writer1.release();

    // Now writer2 should be acquired, but not writer3
    const writer2 = await writer2Promise;
    assert.strictEqual(writer2Acquired, true);
    assert.strictEqual(writer3Acquired, false);

    // Release writer2
    await writer2.release();

    // Now writer3 should be acquired
    const writer3 = await writer3Promise;
    assert.strictEqual(writer3Acquired, true);

    await writer3.release();
  });

  it("should respect maxReaders limit", async () => {
    const maxReaders = 3;
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1", maxReaders });

    assert.strictEqual(await rwLock.maxReaders(), maxReaders);

    const releaser1 = await rwLock.acquireRead();
    const releaser2 = await rwLock.acquireRead();
    const releaser3 = await rwLock.acquireRead();

    assert.strictEqual(await rwLock.activeReaders(), 3);

    let reader4Acquired = false;
    const reader4Promise = rwLock.acquireRead().then(releaser => {
      reader4Acquired = true;
      return releaser;
    });

    // Give time for reader4 to potentially resolve
    await sleep(50);

    // reader4 should not be acquired due to maxReaders limit
    assert.strictEqual(reader4Acquired, false);

    // Release one reader
    await releaser1.release();

    // Now reader4 should be acquired
    const releaser4 = await reader4Promise;
    assert.strictEqual(reader4Acquired, true);
    assert.strictEqual(await rwLock.activeReaders(), 3);

    // Clean up
    await releaser2.release();
    await releaser3.release();
    await releaser4.release();
  });

  it("should allow using withReadLock helper", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    let executed = false;

    const result = await rwLock.withReadLock(async () => {
      assert.strictEqual(await rwLock.activeReaders(), 1);
      executed = true;
      return "result";
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(result, "result");
    assert.strictEqual(await rwLock.activeReaders(), 0);
  });

  it("should allow using withWriteLock helper", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    let executed = false;

    const result = await rwLock.withWriteLock(async () => {
      assert.strictEqual(await rwLock.isWriteLocked(), true);
      executed = true;
      return "result";
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(result, "result");
    assert.strictEqual(await rwLock.isWriteLocked(), false);
  });

  it("should handle withReadLock errors correctly", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    try {
      await rwLock.withReadLock(async () => {
        throw new Error("Test error");
      });
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.strictEqual((err as Error).message, "Test error");
    }

    // Lock should be released even if the function throws
    assert.strictEqual(await rwLock.isReadLocked(), false);
    assert.strictEqual(await rwLock.activeReaders(), 0);
  });

  it("should handle withWriteLock errors correctly", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "rwlock1" });

    try {
      await rwLock.withWriteLock(async () => {
        throw new Error("Test error");
      });
      assert.fail("Should have thrown an error");
    } catch (err) {
      assert.strictEqual((err as Error).message, "Test error");
    }

    // Lock should be released even if the function throws
    assert.strictEqual(await rwLock.isWriteLocked(), false);
  });

  it("should share state between two instances with the same name", async () => {
    const name = "sharedRWLock";
    const rwLock1 = new DistributedReadWriteLock({ name });
    const rwLock2 = new DistributedReadWriteLock({ name });

    assert.strictEqual(await rwLock1.isWriteLocked(), false);
    assert.strictEqual(await rwLock2.isWriteLocked(), false);

    const writeReleaser = await rwLock1.acquireWrite();
    assert.strictEqual(await rwLock1.isWriteLocked(), true);
    assert.strictEqual(await rwLock2.isWriteLocked(), true);

    let rwLock2Acquired = false;
    let releaser2!: IReleaser<WriteLockToken>;
    
    const acquirePromise = rwLock2.acquireWrite().then((rel) => {
      releaser2 = rel;
      rwLock2Acquired = true;
      return rel;
    });

    await sleep(50);
    assert.strictEqual(rwLock2Acquired, false, "rwLock2 write acquire should be pending");

    await writeReleaser.release();
    await acquirePromise;
    
    assert.strictEqual(rwLock2Acquired, true, "rwLock2 should acquire after rwLock1 releases");
    assert.strictEqual(await rwLock1.isWriteLocked(), true);
    assert.strictEqual(await rwLock2.isWriteLocked(), true);

    await releaser2.release();
    assert.strictEqual(await rwLock1.isWriteLocked(), false);
    assert.strictEqual(await rwLock2.isWriteLocked(), false);
  });

  it("should share read locks between two instances with the same name", async () => {
    const name = "sharedReadRWLock";
    const rwLock1 = new DistributedReadWriteLock({ name });
    const rwLock2 = new DistributedReadWriteLock({ name });

    const reader1 = await rwLock1.acquireRead();
    assert.strictEqual(await rwLock1.activeReaders(), 1);
    assert.strictEqual(await rwLock2.activeReaders(), 1);

    const reader2 = await rwLock2.acquireRead();
    assert.strictEqual(await rwLock1.activeReaders(), 2);
    assert.strictEqual(await rwLock2.activeReaders(), 2);

    await reader1.release();
    assert.strictEqual(await rwLock1.activeReaders(), 1);
    assert.strictEqual(await rwLock2.activeReaders(), 1);

    await reader2.release();
    assert.strictEqual(await rwLock1.activeReaders(), 0);
    assert.strictEqual(await rwLock2.activeReaders(), 0);
  });

  it("should cancel all pending acquisitions", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "cancelRWLock" });
    const writeReleaser = await rwLock.acquireWrite();

    let error1: Error | undefined, error2: Error | undefined;
    const p1 = rwLock.acquireRead().catch((err) => { error1 = err; });
    const p2 = rwLock.acquireWrite().catch((err) => { error2 = err; });

    // Allow the pending acquisitions to queue.
    await sleep(50);
    await rwLock.cancelAll("Testing cancellation");

    // Wait for both promises to settle.
    await Promise.allSettled([p1, p2]);

    assert.strictEqual(error1!.message, "Testing cancellation");
    assert.strictEqual(error2!.message, "Testing cancellation");

    await writeReleaser.release();
  });

  it("should destroy the read-write lock and remove it from the registry", async () => {
    const name = "destroyRWLock";
    const rwLock = new DistributedReadWriteLock({ name });

    assert.strictEqual(InMemoryDistributedRegistry.hasRWLock(`rwlock:${name}`), true);

    await rwLock.destroy();
    assert.strictEqual(rwLock.isDestroyed, true, "RWLock should be marked as destroyed");
    assert.strictEqual(InMemoryDistributedRegistry.hasRWLock(`rwlock:${name}`), false);

    await assert.rejects(
      async () => rwLock.acquireRead(),
      /does not exist/,
      "Acquiring read lock after destroy should throw an error"
    );

    await assert.rejects(
      async () => rwLock.acquireWrite(),
      /does not exist/,
      "Acquiring write lock after destroy should throw an error"
    );
  });

  it("should return appropriate token types for read and write locks", async () => {
    const rwLock = new DistributedReadWriteLock({ name: "tokenRWLock" });

    const readReleaser = await rwLock.acquireRead();
    const readToken = readReleaser.getToken();
    assert.ok(readToken.includes("rwlock:read:"));

    await readReleaser.release();

    const writeReleaser = await rwLock.acquireWrite();
    const writeToken = writeReleaser.getToken();
    assert.ok(writeToken.includes("rwlock:write:"));

    await writeReleaser.release();
  });
}); 