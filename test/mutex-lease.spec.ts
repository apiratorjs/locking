import { describe, it } from "node:test";
import assert from "node:assert";
import { InMemoryDistributedLockManager, LockNotFoundError, Mutex } from "../src";
import { TMutexToken } from "../src/types";
import { sleep } from "./utils";

describe("Mutex locks by token and TTL", () => {
  it("should release the lock through a releaser restored from its token", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire();

    const restored = mutex.restoreReleaser(releaser.getToken());
    assert.strictEqual(restored.getToken(), releaser.getToken());
    assert.strictEqual(await restored.isHeld(), true);

    await restored.release();
    assert.strictEqual(await mutex.isLocked(), false);
    assert.strictEqual(await releaser.isHeld(), false);
  });

  it("should ignore tokens that never held the lock", async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    const unknown = mutex.restoreReleaser("unknown" as TMutexToken);
    await unknown.release();

    assert.strictEqual(await mutex.isLocked(), true);
    assert.strictEqual(await unknown.extend(1000), false);
  });

  it("should hold the lock without a TTL until released", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.acquire();

    assert.strictEqual(await releaser.remainingTtl(), Infinity);

    await releaser.release();
  });

  it("should unlock when the TTL runs out and hand the lock to a waiter", async () => {
    const mutex = new Mutex();
    const expiring = await mutex.acquire({ ttlMs: 50 });

    const waiter = await mutex.acquire({ timeoutMs: 1000 });
    await expiring.release();

    assert.strictEqual(await mutex.isLocked(), true, "The late holder must not unlock the waiter's lock");
    assert.strictEqual(await waiter.isHeld(), true);

    await waiter.release();
  });

  it("should extend the lock and remove its TTL with Infinity", async () => {
    const mutex = new Mutex();
    const releaser = await mutex.tryAcquire({ ttlMs: 50 });
    assert.ok(releaser);

    assert.strictEqual(await releaser.extend(Infinity), true);
    await sleep(80);

    assert.strictEqual(await releaser.remainingTtl(), Infinity);
    assert.strictEqual(await mutex.isLocked(), true);

    await releaser.release();
  });

  it("should reject invalid TTLs", async () => {
    const mutex = new Mutex();

    await assert.rejects(mutex.acquire({ ttlMs: 0 }));
    assert.strictEqual(await mutex.isLocked(), false);
  });
});

describe("In-memory distributed mutex locks by token", () => {
  it("should release a lock restored from a token in another place", async () => {
    const locks = new InMemoryDistributedLockManager();
    const releaser = await locks.mutex("orders").acquire({ ttlMs: 60_000 });

    const restored = locks.mutex("orders").restoreReleaser(releaser.getToken());
    assert.strictEqual(await restored.isHeld(), true);

    await restored.release();
    assert.strictEqual(await locks.mutex("orders").isLocked(), false);
  });

  it("should turn releasers into no-ops once the mutex is destroyed", async () => {
    const locks = new InMemoryDistributedLockManager();
    const mutex = locks.mutex("orders");
    const releaser = await mutex.acquire({ ttlMs: 60_000 });

    await mutex.destroy();

    assert.strictEqual(await releaser.isHeld(), false);
    await releaser.release();
    assert.throws(() => mutex.restoreReleaser(releaser.getToken()), LockNotFoundError);
  });
});
