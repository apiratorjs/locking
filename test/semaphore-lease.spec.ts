import { describe, it } from "node:test";
import assert from "node:assert";
import { InMemoryDistributedLockManager, LockNotFoundError, Semaphore } from "../src";
import { TSemaphoreToken } from "../src/types";
import { sleep } from "./utils";

describe("Semaphore permits by token", () => {
  it("should release a permit through a releaser restored from its token", async () => {
    const semaphore = new Semaphore(2);
    const releaser = await semaphore.acquire();

    const restored = semaphore.restoreReleaser(releaser.getToken());
    assert.strictEqual(restored.getToken(), releaser.getToken());
    assert.strictEqual(await restored.isHeld(), true);

    await restored.release();
    assert.strictEqual(await semaphore.freeCount(), 2);
    assert.strictEqual(await releaser.isHeld(), false);
  });

  it("should release once no matter how many releasers share the token", async () => {
    const semaphore = new Semaphore(2);
    const first = await semaphore.acquire();
    const second = await semaphore.acquire();

    await semaphore.restoreReleaser(first.getToken()).release();
    await semaphore.restoreReleaser(first.getToken()).release();
    await first.release();

    assert.strictEqual(await semaphore.freeCount(), 1, "Only the first permit comes back");
    assert.strictEqual(await second.isHeld(), true);

    await second.release();
  });

  it("should ignore tokens that never held a permit", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    const unknown = semaphore.restoreReleaser("unknown" as TSemaphoreToken);
    await unknown.release();

    assert.strictEqual(await semaphore.isLocked(), true);
    assert.strictEqual(await unknown.isHeld(), false);
    assert.strictEqual(await unknown.remainingTtl(), null);
    assert.strictEqual(await unknown.extend(1000), false);

    await releaser.release();
  });
});

describe("Semaphore acquisition tokens", () => {
  it("should refuse an acquireToken that already holds a permit", async () => {
    const semaphore = new Semaphore(2);
    const token = "same-token" as TSemaphoreToken;
    const releaser = await semaphore.acquire(undefined, token);

    await assert.rejects(semaphore.acquire(undefined, token));
    assert.strictEqual(await semaphore.freeCount(), 1, "The refused acquisition takes no permit");

    await releaser.release();
  });

  it("should restore a queued token as not held until its permit is granted", async () => {
    const semaphore = new Semaphore(1);
    const holder = await semaphore.acquire();

    const token = "queued-token" as TSemaphoreToken;
    const pending = semaphore.acquire(undefined, token);
    const restored = semaphore.restoreReleaser(token);

    assert.strictEqual(await restored.isHeld(), false);
    await restored.release();
    assert.strictEqual(await semaphore.isLocked(), true, "Releasing a queued token frees nothing");

    await holder.release();
    await pending;

    assert.strictEqual(await restored.isHeld(), true, "Same token, so the restored releaser now owns the permit");
    await restored.release();
    assert.strictEqual(await semaphore.isLocked(), false);
  });
});

describe("Semaphore permit TTL", () => {
  it("should hold a permit without a TTL until released", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    assert.strictEqual(await releaser.remainingTtl(), Infinity);

    await releaser.release();
    assert.strictEqual(await releaser.remainingTtl(), null);
  });

  it("should report the remaining TTL", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 1000 });

    const remaining = await releaser.remainingTtl();
    assert.ok(remaining !== null && remaining > 900 && remaining <= 1000, `remaining was ${remaining}`);

    await releaser.release();
  });

  it("should give the permit back when the TTL runs out", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 50 });

    assert.strictEqual(await semaphore.isLocked(), true);
    await sleep(80);

    assert.strictEqual(await semaphore.isLocked(), false);
    assert.strictEqual(await releaser.isHeld(), false);
  });

  it("should hand an expired permit to a waiter and not let the late holder release it", async () => {
    const semaphore = new Semaphore(1);
    const expiring = await semaphore.acquire({ ttlMs: 50 });

    const waiter = await semaphore.acquire({ timeoutMs: 1000 });
    assert.strictEqual(await waiter.isHeld(), true);

    await expiring.release();
    assert.strictEqual(await semaphore.isLocked(), true, "The waiter still holds the permit");

    await waiter.release();
    assert.strictEqual(await semaphore.isLocked(), false);
  });

  it("should start the TTL when the permit is granted, not when it is requested", async () => {
    const semaphore = new Semaphore(1);
    const holder = await semaphore.acquire();

    const pending = semaphore.acquire({ ttlMs: 100 });
    await sleep(80);
    await holder.release();

    const waiter = await pending;
    const remaining = await waiter.remainingTtl();
    assert.ok(remaining !== null && remaining > 90, `remaining was ${remaining}`);

    await waiter.release();
  });

  it("should extend a held permit", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 50 });

    await sleep(30);
    assert.strictEqual(await releaser.extend(100), true);
    await sleep(40);

    assert.strictEqual(await releaser.isHeld(), true, "Would have expired without extend");

    await sleep(90);
    assert.strictEqual(await releaser.isHeld(), false);
    assert.strictEqual(await releaser.extend(100), false, "An expired permit cannot be extended");
  });

  it("should give a TTL to a permit acquired without one", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire();

    assert.strictEqual(await releaser.extend(50), true);
    await sleep(80);

    assert.strictEqual(await semaphore.isLocked(), false);
  });

  it("should pass the TTL through tryAcquire", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.tryAcquire({ ttlMs: 1000 });

    assert.ok(releaser);
    const remaining = await releaser.remainingTtl();
    assert.ok(remaining !== null && remaining <= 1000 && remaining > 900, `remaining was ${remaining}`);

    await releaser.release();
  });

  it("should reject invalid TTLs", async () => {
    const semaphore = new Semaphore(1);

    await assert.rejects(semaphore.acquire({ ttlMs: 0 }));
    await assert.rejects(semaphore.acquire({ ttlMs: -1 }));
    await assert.rejects(semaphore.acquire({ ttlMs: NaN }));
    await assert.rejects(semaphore.acquire({ ttlMs: 2 ** 31 }));
    assert.strictEqual(await semaphore.freeCount(), 1, "A rejected acquisition takes no permit");

    const releaser = await semaphore.acquire();
    await assert.rejects(releaser.extend(0));

    await releaser.release();
  });

  it("should treat an Infinity TTL as no TTL", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: Infinity });

    assert.strictEqual(await releaser.remainingTtl(), Infinity);

    await releaser.release();
  });

  it("should remove the TTL when extended by Infinity", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 50 });

    assert.strictEqual(await releaser.extend(Infinity), true);
    assert.strictEqual(await releaser.remainingTtl(), Infinity);

    await sleep(80);
    assert.strictEqual(await releaser.isHeld(), true, "The old TTL must not fire");

    await releaser.release();
  });

  it("should forget held permits when disposed", async () => {
    const semaphore = new Semaphore(1);
    const releaser = await semaphore.acquire({ ttlMs: 1000 });

    await semaphore.dispose();

    assert.strictEqual(await releaser.isHeld(), false);
    await releaser.release();
  });
});

describe("In-memory distributed semaphore permits by token", () => {
  it("should release a permit restored from a token in another place", async () => {
    const locks = new InMemoryDistributedLockManager();
    const releaser = await locks.semaphore("jobs", 2).tryAcquire({ ttlMs: 60_000 });
    assert.ok(releaser);

    // e.g. the token travelled in a job payload
    const token = releaser.getToken();

    const restored = locks.semaphore("jobs", 2).restoreReleaser(token);
    assert.strictEqual(await restored.isHeld(), true);

    await restored.release();
    assert.strictEqual(await locks.semaphore("jobs", 2).freeCount(), 2);
  });

  it("should turn releasers into no-ops once the semaphore is destroyed", async () => {
    const locks = new InMemoryDistributedLockManager();
    const semaphore = locks.semaphore("jobs", 1);
    const releaser = await semaphore.acquire({ ttlMs: 60_000 });

    await semaphore.destroy();

    assert.strictEqual(await releaser.isHeld(), false);
    await releaser.release();
    assert.throws(() => semaphore.restoreReleaser(releaser.getToken()), LockNotFoundError);
  });
});
