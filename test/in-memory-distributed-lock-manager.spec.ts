import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CancelledLockingError,
  InMemoryDistributedLockManager,
  ELockDisplayType,
  LockConfigMismatchError,
  LockNotFoundError,
  TimeoutLockingError,
} from "../src";
import { sleep } from "./utils";

describe("InMemoryDistributedLockManager", () => {
  it("should hand out the same instance for the same name", () => {
    const manager = new InMemoryDistributedLockManager();

    assert.strictEqual(manager.mutex("orders"), manager.mutex("orders"));
    assert.strictEqual(
      manager.semaphore("uploads", 3),
      manager.semaphore("uploads", 3),
    );
    assert.strictEqual(
      manager.readWriteLock("catalog"),
      manager.readWriteLock("catalog"),
    );

    assert.notStrictEqual(manager.mutex("orders"), manager.mutex("payments"));
  });

  it("should answer hasMutex / hasSemaphore / hasRWLock", () => {
    const manager = new InMemoryDistributedLockManager();

    assert.strictEqual(manager.hasMutex("orders"), false);
    assert.strictEqual(manager.hasSemaphore("uploads"), false);
    assert.strictEqual(manager.hasRWLock("catalog"), false);

    manager.mutex("orders");
    manager.semaphore("uploads", 2);
    manager.readWriteLock("catalog");

    assert.strictEqual(manager.hasMutex("orders"), true);
    assert.strictEqual(manager.hasSemaphore("uploads"), true);
    assert.strictEqual(manager.hasRWLock("catalog"), true);

    assert.strictEqual(manager.hasSemaphore("orders"), false);
    assert.strictEqual(manager.hasMutex("uploads"), false);
  });

  it("should drop a destroyed lock from has*", async () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("orders");
    assert.strictEqual(manager.hasMutex("orders"), true);

    await mutex.destroy();
    assert.strictEqual(manager.hasMutex("orders"), false);
  });

  it("should keep locks of different kinds under the same name apart", () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("shared");
    const semaphore = manager.semaphore("shared", 2);
    const rwLock = manager.readWriteLock("shared");

    assert.strictEqual(manager.count(), 3);
    assert.strictEqual(manager.count(ELockDisplayType.Mutex), 1);

    return mutex.runExclusive(async () => {
      assert.strictEqual(await mutex.isLocked(), true);
      assert.strictEqual(await semaphore.isLocked(), false);
      assert.strictEqual(await rwLock.isWriteLocked(), false);
    });
  });

  it("should share state through the deduplicated instance", async () => {
    const manager = new InMemoryDistributedLockManager();

    const releaser = await manager.mutex("orders").acquire();
    assert.strictEqual(await manager.mutex("orders").isLocked(), true);

    const rejected = await manager
      .mutex("orders")
      .acquire({ timeoutMs: 50 })
      .catch((err) => err);
    assert.ok(rejected instanceof TimeoutLockingError);

    await releaser.release();
    assert.strictEqual(await manager.mutex("orders").isLocked(), false);
  });

  it("should reject a semaphore name registered with a different maxCount", () => {
    const manager = new InMemoryDistributedLockManager();

    manager.semaphore("uploads", 2);

    assert.throws(
      () => manager.semaphore("uploads", 5),
      (err: Error) =>
        err instanceof LockConfigMismatchError &&
        /maxCount 2, requested 5/.test(err.message),
    );
  });

  it("should reject a read-write lock name registered with a different maxReaders", () => {
    const manager = new InMemoryDistributedLockManager();

    manager.readWriteLock("catalog", 3);

    assert.throws(
      () => manager.readWriteLock("catalog", 7),
      (err: Error) =>
        err instanceof LockConfigMismatchError &&
        /maxReaders 3, requested 7/.test(err.message),
    );

    assert.strictEqual(
      manager.readWriteLock("catalog"),
      manager.readWriteLock("catalog", 3),
    );
  });

  it("should reject an empty name and a non-positive capacity", () => {
    const manager = new InMemoryDistributedLockManager();

    assert.throws(() => manager.mutex(""), /non-empty lock name/);
    assert.throws(
      () => manager.semaphore("s", 0),
      /maxCount must be greater than 0/,
    );
    assert.throws(
      () => manager.readWriteLock("rw", 0),
      /maxReaders must be greater than 0/,
    );
  });

  it("should list what it holds", async () => {
    const manager = new InMemoryDistributedLockManager();

    manager.mutex("orders");
    manager.semaphore("uploads", 3);
    manager.readWriteLock("catalog", 5);

    const list = manager.list();
    assert.strictEqual(list.length, 3);
    assert.deepStrictEqual(
      list.map((info) => `${info.kind}:${info.name}`).sort(),
      ["mutex:orders", "rwlock:catalog", "semaphore:uploads"],
    );

    const semaphoreInfo = list.find(
      (info) => info.kind === ELockDisplayType.Semaphore,
    )!;
    assert.strictEqual(semaphoreInfo.maxCount, 3);
    assert.strictEqual(semaphoreInfo.implementation, "in-memory");
    assert.strictEqual(semaphoreInfo.isDestroyed, false);

    assert.strictEqual(
      list.find((info) => info.kind === ELockDisplayType.RWLock)!.maxReaders,
      5,
    );
    assert.strictEqual(
      list.find((info) => info.kind === ELockDisplayType.Mutex)!.maxCount,
      undefined,
    );
  });

  it("should report the state of every lock in a snapshot", async () => {
    const manager = new InMemoryDistributedLockManager();

    await manager.mutex("orders").acquire();
    await manager.semaphore("uploads", 3).acquire();
    await manager.readWriteLock("catalog").acquireRead();

    const snapshot = await manager.snapshot();

    const mutex = snapshot.find((info) => info.kind === ELockDisplayType.Mutex)!;
    assert.strictEqual(mutex.isLocked, true);

    const semaphore = snapshot.find(
      (info) => info.kind === ELockDisplayType.Semaphore,
    )!;
    assert.strictEqual(semaphore.isLocked, false);
    assert.strictEqual(semaphore.freeCount, 2);

    const rwLock = snapshot.find((info) => info.kind === ELockDisplayType.RWLock)!;
    assert.strictEqual(rwLock.activeReaders, 1);
    assert.strictEqual(rwLock.isReadLocked, true);
    assert.strictEqual(rwLock.isWriteLocked, false);
  });

  it("should cancel pending acquisitions without releasing held locks", async () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("orders");
    const semaphore = manager.semaphore("uploads", 1);
    const rwLock = manager.readWriteLock("catalog");

    const held = await mutex.acquire();
    await semaphore.acquire();
    await rwLock.acquireWrite();

    const pending = [
      mutex.acquire({ timeoutMs: 500 }).catch((err) => err),
      semaphore.acquire({ timeoutMs: 500 }).catch((err) => err),
      rwLock.acquireRead({ timeoutMs: 500 }).catch((err) => err),
    ];
    await sleep(20);

    await manager.cancelAll("Draining");

    for (const settled of await Promise.all(pending)) {
      assert.ok(
        settled instanceof CancelledLockingError,
        "Pending acquisition should be cancelled",
      );
      assert.strictEqual(settled.message, "Draining");
    }

    assert.strictEqual(await mutex.isLocked(), true);
    assert.strictEqual(manager.count(), 3);
    assert.strictEqual(manager.mutex("orders"), mutex);

    await held.release();
    assert.strictEqual(await mutex.isLocked(), false);
  });

  it("should destroy everything it holds and start fresh afterwards", async () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("orders");
    const semaphore = manager.semaphore("uploads", 1);
    manager.readWriteLock("catalog");

    await mutex.acquire();
    await semaphore.acquire();
    const pending = [
      mutex.acquire({ timeoutMs: 500 }).catch((err) => err),
      semaphore.acquire({ timeoutMs: 500 }).catch((err) => err),
    ];
    await sleep(20);

    await manager.destroyAll("Shutting down");

    for (const settled of await Promise.all(pending)) {
      assert.ok(settled instanceof CancelledLockingError);
      assert.strictEqual(settled.message, "Shutting down");
    }

    assert.strictEqual(mutex.isDestroyed, true);
    assert.strictEqual(semaphore.isDestroyed, true);
    assert.strictEqual(manager.count(), 0);
    assert.deepStrictEqual(manager.list(), []);
    await assert.rejects(() => mutex.acquire(), LockNotFoundError);

    const fresh = manager.mutex("orders");
    assert.notStrictEqual(fresh, mutex);
    assert.strictEqual(await fresh.isLocked(), false);
  });

  it("should treat destroyAll as idempotent", async () => {
    const manager = new InMemoryDistributedLockManager();
    manager.mutex("orders");

    await manager.destroyAll();
    await manager.destroyAll();

    assert.strictEqual(manager.count(), 0);
  });

  it("should forget a lock destroyed through its own handle", async () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("orders");
    await mutex.destroy();

    assert.strictEqual(manager.count(), 0, "A destroyed lock must not be counted");
    assert.deepStrictEqual(manager.list(), []);

    const fresh = manager.mutex("orders");
    assert.notStrictEqual(
      fresh,
      mutex,
      "A destroyed lock must not be handed out again",
    );
    assert.strictEqual(await fresh.isLocked(), false);
  });

  it("should keep separate managers independent", async () => {
    const first = new InMemoryDistributedLockManager();
    const second = new InMemoryDistributedLockManager();

    const fromFirst = first.mutex("orders");
    const fromSecond = second.mutex("orders");

    assert.notStrictEqual(fromFirst, fromSecond);

    const releaser = await fromFirst.acquire();
    assert.strictEqual(await fromFirst.isLocked(), true);
    assert.strictEqual(await fromSecond.isLocked(), false);
    await releaser.release();

    await first.destroyAll();

    assert.strictEqual(first.hasMutex("orders"), false);
    assert.strictEqual(second.hasMutex("orders"), true);
    assert.strictEqual(second.count(), 1);
    assert.strictEqual(await fromSecond.isLocked(), false);
  });

  it("should create in-memory locks", async () => {
    const manager = new InMemoryDistributedLockManager();

    const mutex = manager.mutex("orders");
    assert.strictEqual(mutex.implementation, "in-memory");
    assert.strictEqual(manager.hasMutex("orders"), true);
  });
});
