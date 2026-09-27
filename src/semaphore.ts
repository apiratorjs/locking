import assert from "node:assert";
import crypto from "node:crypto";
import {
  IDeferred,
  ISemaphore,
  ISemaphorePermits,
  ISemaphoreReleaser,
  TAcquireParams,
  TAcquireToken,
  THeldSemaphorePermit,
  TSemaphoreAcquireParams,
  TSemaphoreToken
} from "./types";
import { DEFAULT_TIMEOUT_IN_MS } from "./constants";
import { CancelledLockingError, TimeoutLockingError } from "./errors";
import { assertTtl, nullOnTimeout, refTimer, unrefTimer } from "./utils";

class Releaser implements ISemaphoreReleaser {
  public constructor(
    private readonly permits: ISemaphorePermits,
    private readonly token: TSemaphoreToken
  ) {}

  /**
   * Releasing is idempotent: the permit is looked up by token, so repeated calls -
   * through this releaser or any other one for the same token - must not hand
   * extra permits back to the semaphore.
   */
  public async release(): Promise<void> {
    await this.permits.release(this.token);
  }

  public async extend(ttlMs: number): Promise<boolean> {
    return this.permits.extend(this.token, ttlMs);
  }

  public async remainingTtl(): Promise<number | null> {
    return this.permits.remainingTtl(this.token);
  }

  public async isHeld(): Promise<boolean> {
    return (await this.permits.remainingTtl(this.token)) !== null;
  }

  public getToken(): TSemaphoreToken {
    return this.token;
  }
}

export class Semaphore implements ISemaphore {
  public readonly maxCount: number;

  private availablePermits: number;
  private queue: IDeferred[];
  private anyUnlockListeners: IDeferred[];
  private fullyUnlockListeners: IDeferred[];
  private readonly heldPermits: Map<TSemaphoreToken, THeldSemaphorePermit>;
  private readonly permits: ISemaphorePermits;

  public constructor(maxCount: number) {
    assert.ok(maxCount > 0, "maxCount must be greater than 0");

    this.maxCount = maxCount;
    this.availablePermits = maxCount;
    this.queue = [];
    this.anyUnlockListeners = [];
    this.fullyUnlockListeners = [];
    this.heldPermits = new Map();
    this.permits = {
      release: async (token) => this.releasePermit(token),
      extend: async (token, ttlMs) => this.extendPermit(token, ttlMs),
      remainingTtl: async (token) => this.permitRemainingTtl(token)
    };
  }

  public async waitForFullyUnlock(): Promise<void> {
    if (this.maxCount === this.availablePermits) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.fullyUnlockListeners.push({
        resolve,
        reject
      });
    });
  }

  public async waitForAnyUnlock(): Promise<void> {
    if (this.availablePermits > 0) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.anyUnlockListeners.push({
        resolve,
        reject
      });
    });
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: TAcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    let callback: () => Promise<T> | T;
    let params: TAcquireParams | undefined;

    if (args.length === 1) {
      callback = args[0];
    } else {
      params = args[0];
      callback = args[1];
    }

    const releaser = await this.acquire(params);
    try {
      return await callback();
    } finally {
      await releaser.release();
    }
  }

  public async freeCount(): Promise<number> {
    return this.availablePermits;
  }

  /**
   * @param acquireToken Identity for this acquisition. Layers built on top of a
   * semaphore - a distributed mutex, for instance - pass their own token, so that
   * one acquisition has one identity all the way down instead of the caller seeing
   * one token while the releaser holds another. Left out, a fresh uuid is used.
   */
  public async acquire(params?: TSemaphoreAcquireParams, acquireToken?: TAcquireToken): Promise<ISemaphoreReleaser> {
    const timeoutMs = params?.timeoutMs ?? DEFAULT_TIMEOUT_IN_MS;
    const ttlMs = params?.ttlMs;

    if (ttlMs !== undefined) {
      assertTtl(ttlMs);
    }

    const token = (acquireToken ?? crypto.randomUUID()) as TSemaphoreToken;
    assert.ok(!this.heldPermits.has(token), "acquireToken already holds a permit");

    const releaser = new Releaser(this.permits, token);

    if (this.availablePermits > 0) {
      this.availablePermits--;
      this.holdPermit(token, ttlMs);
      return releaser;
    }

    return new Promise<ISemaphoreReleaser>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(deferred);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.updateExpiryTimersRef();
        }

        reject(new TimeoutLockingError("Timeout acquiring semaphore"));
      }, timeoutMs);

      // A pending acquisition must not keep the process alive on its own: only
      // code already running can release the permit this waiter is after.
      unrefTimer(timer);

      const deferred: IDeferred = {
        resolve: () => {
          clearTimeout(timer);
          this.holdPermit(token, ttlMs);
          resolve(releaser);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      };

      this.queue.push(deferred);
      this.updateExpiryTimersRef();
    });
  }

  /**
   * Same as acquire(), but resolves to null instead of throwing
   * TimeoutLockingError, and timeoutMs defaults to 0.
   */
  public async tryAcquire(params?: TSemaphoreAcquireParams, acquireToken?: TAcquireToken): Promise<ISemaphoreReleaser | null> {
    const timeoutMs = params?.timeoutMs ?? 0;

    // Checked and taken in one synchronous step. A free permit also means an
    // empty queue - release() hands permits to waiters directly - so this never
    // overtakes anybody already waiting.
    if (timeoutMs <= 0 && this.availablePermits === 0) {
      return null;
    }

    return nullOnTimeout(this.acquire({ ...params, timeoutMs }, acquireToken));
  }

  public restoreReleaser(token: TSemaphoreToken): ISemaphoreReleaser {
    return new Releaser(this.permits, token);
  }

  /**
   * Cancels pending acquisitions.
   *
   * Permits that are already held stay held: their owners are still inside their
   * critical sections, and handing their permits back here would let extra
   * acquirers in alongside them.
   *
   * Unlock listeners (waitForAnyUnlock / waitForFullyUnlock) keep waiting - the
   * semaphore is still alive and will notify them once permits come back.
   */
  public async cancelAll(errMessage?: string): Promise<void> {
    const cancellationList = [...this.queue];
    this.queue = [];
    this.updateExpiryTimersRef();

    cancellationList.forEach(deferred => deferred.reject(new CancelledLockingError(errMessage ?? "Semaphore cancelled")));
  }

  /**
   * Called when the semaphore itself goes away: pending acquisitions are
   * cancelled, held permits are forgotten (their releasers turn into no-ops) and
   * unlock listeners are resolved, because a semaphore that no longer exists
   * cannot be held by anybody. Resolving rather than rejecting also
   * keeps a fire-and-forget `void sem.waitForAnyUnlock()` from turning into an
   * unhandled rejection.
   */
  public async dispose(errMessage?: string): Promise<void> {
    await this.cancelAll(errMessage);

    this.heldPermits.forEach(permit => clearTimeout(permit.expiryTimer));
    this.heldPermits.clear();

    const anyUnlockWaiters = [...this.anyUnlockListeners];
    this.anyUnlockListeners = [];
    anyUnlockWaiters.forEach(listener => listener.resolve());

    const fullyUnlockWaiters = [...this.fullyUnlockListeners];
    this.fullyUnlockListeners = [];
    fullyUnlockWaiters.forEach(listener => listener.resolve());
  }

  public async isLocked(): Promise<boolean> {
    return this.availablePermits === 0;
  }

  private holdPermit(token: TSemaphoreToken, ttlMs: number | undefined): void {
    const permit: THeldSemaphorePermit = { expiresAt: null };
    this.heldPermits.set(token, permit);

    this.setPermitTtl(token, permit, ttlMs ?? Infinity);
  }

  /**
   * Replaces whatever TTL the permit had; Infinity leaves it without one.
   */
  private setPermitTtl(token: TSemaphoreToken, permit: THeldSemaphorePermit, ttlMs: number): void {
    clearTimeout(permit.expiryTimer);

    if (ttlMs === Infinity) {
      permit.expiresAt = null;
      permit.expiryTimer = undefined;
      return;
    }

    permit.expiresAt = performance.now() + ttlMs;
    permit.expiryTimer = setTimeout(() => void this.releasePermit(token), ttlMs);
    this.updateExpiryTimerRef(permit);
  }

  /**
   * An expiring permit alone is no reason to keep the process running - same as
   * for acquisition timeouts. With somebody queued it is: the expiry is what
   * hands them the permit, and nothing else may be left to do it.
   */
  private updateExpiryTimerRef(permit: THeldSemaphorePermit): void {
    if (this.queue.length > 0) {
      refTimer(permit.expiryTimer);
    } else {
      unrefTimer(permit.expiryTimer);
    }
  }

  private updateExpiryTimersRef(): void {
    this.heldPermits.forEach(permit => this.updateExpiryTimerRef(permit));
  }

  private async extendPermit(token: TSemaphoreToken, ttlMs: number): Promise<boolean> {
    assertTtl(ttlMs);

    const permit = this.heldPermits.get(token);
    if (!permit) {
      return false;
    }

    this.setPermitTtl(token, permit, ttlMs);
    return true;
  }

  private async permitRemainingTtl(token: TSemaphoreToken): Promise<number | null> {
    const permit = this.heldPermits.get(token);
    if (!permit) {
      return null;
    }

    if (permit.expiresAt === null) {
      return Infinity;
    }

    return Math.max(0, permit.expiresAt - performance.now());
  }

  /**
   * Only a token that still holds a permit gives one back. That makes release
   * idempotent, and keeps a permit that already expired - and may have been
   * handed to somebody else since - from being released a second time by its
   * late original holder.
   */
  private async releasePermit(token: TSemaphoreToken): Promise<void> {
    const permit = this.heldPermits.get(token);
    if (!permit) {
      return;
    }

    clearTimeout(permit.expiryTimer);
    this.heldPermits.delete(token);

    if (this.queue.length > 0) {
      const { resolve } = this.queue.shift()!;
      resolve();
      this.updateExpiryTimersRef();
    } else {
      this.availablePermits++;

      if (this.anyUnlockListeners.length > 0) {
        const listeners = [...this.anyUnlockListeners];
        this.anyUnlockListeners = [];
        listeners.forEach(listener => listener.resolve());
      }

      if (this.availablePermits === this.maxCount) {
        const listeners = [...this.fullyUnlockListeners];
        this.fullyUnlockListeners = [];
        listeners.forEach(listener => listener.resolve());
      }
    }
  }
}
