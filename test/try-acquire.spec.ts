import { describe, it } from "node:test";
import assert from "node:assert";
import { sleep } from "./utils";
import {
  Mutex,
  Semaphore,
  ReadWriteLock,
  InMemoryDistributedLockManager,
  CancelledLockingError,
  LockNotFoundError,
} from "../src";

describe("tryAcquire", () => {
  describe("Semaphore", () => {
    it("should return a releaser while permits are free and null once they run out", async () => {
      const semaphore = new Semaphore(2);

      const first = await semaphore.tryAcquire();
      const second = await semaphore.tryAcquire();
      assert.ok(first);
      assert.ok(second);
      assert.notStrictEqual(first.getToken(), second.getToken());

      assert.strictEqual(await semaphore.tryAcquire(), null);

      await first.release();
      const third = await semaphore.tryAcquire();
      assert.ok(third, "A released permit should be available again");

      await second.release();
      await third.release();
      assert.strictEqual(await semaphore.freeCount(), 2);
    });

    it("should not leave anything queued after failing fast", async () => {
      const semaphore = new Semaphore(1);
      const releaser = await semaphore.acquire();

      assert.strictEqual(await semaphore.tryAcquire(), null);

      // Had the failed attempt stayed queued, this release would go to it
      // instead of freeing the permit.
      await releaser.release();
      assert.strictEqual(await semaphore.freeCount(), 1);
    });

    it("should wait up to timeoutMs and return the releaser if a permit frees up", async () => {
      const semaphore = new Semaphore(1);
      const releaser = await semaphore.acquire();

      const attempt = semaphore.tryAcquire({ timeoutMs: 1000 });
      await sleep(20);
      await releaser.release();

      const acquired = await attempt;
      assert.ok(acquired);
      assert.strictEqual(await semaphore.isLocked(), true);

      await acquired.release();
    });

    it("should return null when timeoutMs elapses", async () => {
      const semaphore = new Semaphore(1);
      const releaser = await semaphore.acquire();

      assert.strictEqual(await semaphore.tryAcquire({ timeoutMs: 30 }), null);

      await releaser.release();
      assert.strictEqual(await semaphore.freeCount(), 1);
    });

    it("should still throw when the pending attempt is cancelled", async () => {
      const semaphore = new Semaphore(1);
      const releaser = await semaphore.acquire();

      const attempt = semaphore.tryAcquire({ timeoutMs: 1000 });
      await sleep(10);
      await semaphore.cancelAll();

      await assert.rejects(attempt, CancelledLockingError);

      await releaser.release();
    });
  });

  describe("Mutex", () => {
    it("should return a releaser when free and null when locked", async () => {
      const mutex = new Mutex();

      const releaser = await mutex.tryAcquire();
      assert.ok(releaser);
      assert.strictEqual(await mutex.isLocked(), true);

      assert.strictEqual(await mutex.tryAcquire(), null);

      await releaser.release();
      assert.strictEqual(await mutex.isLocked(), false);
    });

    it("should not overtake a waiter that is already queued", async () => {
      const mutex = new Mutex();
      const releaser = await mutex.acquire();
      const waiter = mutex.acquire();

      await releaser.release();

      // The permit went straight to the waiter.
      assert.strictEqual(await mutex.tryAcquire(), null);

      await (await waiter).release();
    });

    it("should wait up to timeoutMs", async () => {
      const mutex = new Mutex();
      const releaser = await mutex.acquire();

      assert.strictEqual(await mutex.tryAcquire({ timeoutMs: 30 }), null);

      const attempt = mutex.tryAcquire({ timeoutMs: 1000 });
      await sleep(10);
      await releaser.release();

      const acquired = await attempt;
      assert.ok(acquired);
      await acquired.release();
    });

    it("should still throw when the pending attempt is cancelled", async () => {
      const mutex = new Mutex();
      const releaser = await mutex.acquire();

      const attempt = mutex.tryAcquire({ timeoutMs: 1000 });
      await sleep(10);
      await mutex.cancel();

      await assert.rejects(attempt, CancelledLockingError);

      await releaser.release();
    });
  });

  describe("ReadWriteLock", () => {
    it("should share read locks and refuse a write lock while readers are active", async () => {
      const rwLock = new ReadWriteLock();

      const reader1 = await rwLock.tryAcquireRead();
      const reader2 = await rwLock.tryAcquireRead();
      assert.ok(reader1);
      assert.ok(reader2);
      assert.strictEqual(await rwLock.activeReaders(), 2);

      assert.strictEqual(await rwLock.tryAcquireWrite(), null);

      await reader1.release();
      await reader2.release();

      const writer = await rwLock.tryAcquireWrite();
      assert.ok(writer);
      await writer.release();
    });

    it("should refuse both read and write locks while a writer is active", async () => {
      const rwLock = new ReadWriteLock();
      const writer = await rwLock.acquireWrite();

      assert.strictEqual(await rwLock.tryAcquireRead(), null);
      assert.strictEqual(await rwLock.tryAcquireWrite(), null);

      await writer.release();
      assert.strictEqual(await rwLock.isWriteLocked(), false);
      assert.strictEqual(await rwLock.isReadLocked(), false);
    });

    it("should refuse a read lock once maxReaders is reached", async () => {
      const rwLock = new ReadWriteLock({ maxReaders: 1 });
      const reader = await rwLock.acquireRead();

      assert.strictEqual(await rwLock.tryAcquireRead(), null);

      await reader.release();
      assert.strictEqual(await rwLock.activeReaders(), 0);
    });

    it("should wait up to timeoutMs for a write lock", async () => {
      const rwLock = new ReadWriteLock();
      const reader = await rwLock.acquireRead();

      assert.strictEqual(await rwLock.tryAcquireWrite({ timeoutMs: 30 }), null);

      const attempt = rwLock.tryAcquireWrite({ timeoutMs: 1000 });
      await sleep(10);
      await reader.release();

      const writer = await attempt;
      assert.ok(writer);
      assert.strictEqual(await rwLock.isWriteLocked(), true);
      await writer.release();
    });

    it("should still throw when the pending attempt is cancelled", async () => {
      const rwLock = new ReadWriteLock();
      const writer = await rwLock.acquireWrite();

      const readAttempt = rwLock.tryAcquireRead({ timeoutMs: 1000 });
      const writeAttempt = rwLock.tryAcquireWrite({ timeoutMs: 1000 });
      await sleep(10);
      await rwLock.cancelAll();

      await assert.rejects(readAttempt, CancelledLockingError);
      await assert.rejects(writeAttempt, CancelledLockingError);

      await writer.release();
    });
  });

  describe("In-memory distributed locks", () => {
    it("mutex should return null when locked and throw once destroyed", async () => {
      const locks = new InMemoryDistributedLockManager();
      const mutex = locks.mutex("try-mutex");

      const releaser = await mutex.tryAcquire();
      assert.ok(releaser);
      assert.ok(releaser.getToken().startsWith(`${mutex.name}:`));
      assert.strictEqual(await locks.mutex("try-mutex").tryAcquire(), null);

      await releaser.release();
      await mutex.destroy();

      await assert.rejects(mutex.tryAcquire(), LockNotFoundError);
    });

    it("semaphore should return null when exhausted and throw once destroyed", async () => {
      const locks = new InMemoryDistributedLockManager();
      const semaphore = locks.semaphore("try-semaphore", 1);

      const releaser = await semaphore.tryAcquire();
      assert.ok(releaser);
      assert.ok(releaser.getToken().startsWith(`${semaphore.name}:`));
      assert.strictEqual(await semaphore.tryAcquire(), null);

      await releaser.release();
      await semaphore.destroy();

      await assert.rejects(semaphore.tryAcquire(), LockNotFoundError);
    });

    it("read-write lock should return null when unavailable and throw once destroyed", async () => {
      const locks = new InMemoryDistributedLockManager();
      const rwLock = locks.readWriteLock("try-rwlock");

      const writer = await rwLock.tryAcquireWrite();
      assert.ok(writer);
      assert.strictEqual(await rwLock.tryAcquireRead(), null);
      assert.strictEqual(await rwLock.tryAcquireWrite(), null);

      await writer.release();
      await rwLock.destroy();

      await assert.rejects(rwLock.tryAcquireRead(), LockNotFoundError);
      await assert.rejects(rwLock.tryAcquireWrite(), LockNotFoundError);
    });

    it("should still throw when destroyed while an attempt is pending", async () => {
      const locks = new InMemoryDistributedLockManager();
      const mutex = locks.mutex("try-mutex-destroy");
      await mutex.acquire();

      const attempt = mutex.tryAcquire({ timeoutMs: 1000 });
      await sleep(10);
      await mutex.destroy();

      await assert.rejects(attempt, CancelledLockingError);
    });
  });
});
