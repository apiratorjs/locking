import { describe, it } from "node:test";
import assert from "node:assert";
import { ReadWriteLock } from "../src/read-write-lock";
import { sleep } from "./utils";

describe("ReadWriteLock", () => {
  it("should immediately acquire write lock and release", async () => {
    const rwLock = new ReadWriteLock();
    assert.strictEqual(await rwLock.isWriteLocked(), false);

    const releaser = await rwLock.acquireWrite();
    assert.strictEqual(await rwLock.isWriteLocked(), true);

    await releaser.release();
    assert.strictEqual(await rwLock.isWriteLocked(), false);
  });

  it("should immediately acquire read lock and release", async () => {
    const rwLock = new ReadWriteLock();
    assert.strictEqual(await rwLock.activeReaders(), 0);

    const releaser = await rwLock.acquireRead();
    assert.strictEqual(await rwLock.activeReaders(), 1);

    await releaser.release();
    assert.strictEqual(await rwLock.activeReaders(), 0);
  });

  it("should allow multiple concurrent read locks", async () => {
    const rwLock = new ReadWriteLock();

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
    const rwLock = new ReadWriteLock();

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
    const rwLock = new ReadWriteLock();

    const writeReleaser = await rwLock.acquireWrite();

    let readAcquired = false;
    const readPromise = rwLock.acquireRead().then(releaser => {
      readAcquired = true;
      return releaser;
    });

    // Give time for the readPromise to potentially resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    // Read lock should not be acquired while write lock is active
    assert.strictEqual(readAcquired, false);

    // Release write lock
    await writeReleaser.release();

    // Now read lock should be acquired
    const readReleaser = await readPromise;
    assert.strictEqual(readAcquired, true);
    assert.strictEqual(await rwLock.activeReaders() == 1, true);

    await readReleaser.release();
  });

  it("should queue write locks", async () => {
    const rwLock = new ReadWriteLock();

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
    await new Promise(resolve => setTimeout(resolve, 50));

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
    const rwLock = new ReadWriteLock({ maxReaders });

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
    await new Promise(resolve => setTimeout(resolve, 50));

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
    const rwLock = new ReadWriteLock();

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
    const rwLock = new ReadWriteLock();

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
    const rwLock = new ReadWriteLock();

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
    const rwLock = new ReadWriteLock();

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

  it("should allow concurrent readers when no writer is active", async () => {
    const rwLock = new ReadWriteLock();

    // First reader acquires lock
    const reader1 = await rwLock.acquireRead();

    // Another reader should be able to acquire without waiting
    let reader2Acquired = false;
    const reader2Promise = rwLock.acquireRead().then(releaser => {
      reader2Acquired = true;
      return releaser;
    });

    // Give some time for the second reader to acquire
    await sleep(10);

    // Second reader should be able to acquire without waiting
    assert.strictEqual(reader2Acquired, true);

    // Clean up
    const reader2 = await reader2Promise;
    await reader1.release();
    await reader2.release();
  });

  it("should allow cancelAll to cancel pending acquisitions", async () => {
    const rwLock = new ReadWriteLock();
    
    // Acquire write lock so others will wait
    const writeReleaser = await rwLock.acquireWrite();
    
    // Queue some acquisitions
    const read1Promise = rwLock.acquireRead().catch(err => err);
    const read2Promise = rwLock.acquireRead().catch(err => err);
    const write1Promise = rwLock.acquireWrite().catch(err => err);
    
    // Give time for promises to queue
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Cancel all waiting acquisitions
    await rwLock.cancelAll("Operation cancelled");
    
    // All promises should resolve with errors
    const read1Error = await read1Promise;
    const read2Error = await read2Promise;
    const write1Error = await write1Promise;
    
    assert.strictEqual(read1Error instanceof Error, true);
    assert.strictEqual(read2Error instanceof Error, true);
    assert.strictEqual(write1Error instanceof Error, true);
    assert.strictEqual(read1Error.message, "Operation cancelled");
  });

  it("should apply timeout only to semaphore acquisition, not to waitForFullyUnlock", async () => {
    const rwLock = new ReadWriteLock();
    
    // Acquire write lock so others will wait
    const writeReleaser = await rwLock.acquireWrite();
    
    // Start a read acquisition with timeout
    const readPromise = rwLock.acquireRead({ timeoutMs: 100 }).catch(err => err);
    
    // Wait longer than the timeout
    await sleep(200);
    
    // The read acquisition should still be waiting (not timed out)
    // because the timeout only applies to the semaphore.acquire() call
    // which doesn't happen until after waitForFullyUnlock() completes
    const isResolved = await Promise.race([
      readPromise.then(() => true),
      Promise.resolve(false)
    ]);
    
    assert.strictEqual(isResolved, false, "Read acquisition should still be pending");
    
    // Release the write lock
    await writeReleaser.release();
    
    // Now the read acquisition should succeed
    const result = await readPromise;
    assert.ok(typeof result !== 'string', "Read acquisition should succeed after write lock is released");
    
    // Clean up if it's a releaser
    if (result && typeof result === 'object' && 'release' in result) {
      await result.release();
    }
  });
});
