import assert from "node:assert";
import crypto from "node:crypto";
import { IDeferred, IReleaser, ISemaphore, TAcquireParams, TAcquireToken, TSemaphoreToken } from "./types";
import { DEFAULT_TIMEOUT_IN_MS } from "./constants";
import { CancelledLockingError, TimeoutLockingError } from "./errors";
import { unrefTimer } from "./utils";

class Releaser implements IReleaser<TSemaphoreToken> {
  private isReleased: boolean = false;

  public constructor(
    private readonly onRelease: () => Promise<void>,
    private readonly token: TSemaphoreToken
  ) {}

  /**
   * Releasing is idempotent: one releaser owns exactly one permit, so repeated
   * calls must not hand extra permits back to the semaphore.
   */
  public async release(): Promise<void> {
    if (this.isReleased) {
      return;
    }

    this.isReleased = true;

    await this.onRelease();
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

  public constructor(maxCount: number) {
    assert.ok(maxCount > 0, "maxCount must be greater than 0");

    this.maxCount = maxCount;
    this.availablePermits = maxCount;
    this.queue = [];
    this.anyUnlockListeners = [];
    this.fullyUnlockListeners = [];
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
  public async acquire(params?: TAcquireParams, acquireToken?: TAcquireToken): Promise<IReleaser<TSemaphoreToken>> {
    const timeoutMs = params?.timeoutMs ?? DEFAULT_TIMEOUT_IN_MS;

    const token = (acquireToken ?? crypto.randomUUID()) as TSemaphoreToken;
    const releaser = new Releaser(this.release.bind(this), token);

    if (this.availablePermits > 0) {
      this.availablePermits--;
      return releaser;
    }

    return new Promise<IReleaser<TSemaphoreToken>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(deferred);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }

        reject(new TimeoutLockingError("Timeout acquiring semaphore"));
      }, timeoutMs);

      // A pending acquisition must not keep the process alive on its own: only
      // code already running can release the permit this waiter is after.
      unrefTimer(timer);

      const deferred: IDeferred = {
        resolve: () => {
          clearTimeout(timer);
          resolve(releaser);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      };

      this.queue.push(deferred);
    });
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

    cancellationList.forEach(deferred => deferred.reject(new CancelledLockingError(errMessage ?? "Semaphore cancelled")));
  }

  /**
   * Called when the semaphore itself goes away: pending acquisitions are
   * cancelled and unlock listeners are resolved, because a semaphore that no
   * longer exists cannot be held by anybody. Resolving rather than rejecting also
   * keeps a fire-and-forget `void sem.waitForAnyUnlock()` from turning into an
   * unhandled rejection.
   */
  public async dispose(errMessage?: string): Promise<void> {
    await this.cancelAll(errMessage);

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

  private async release(): Promise<void> {
    if (this.availablePermits === this.maxCount) {
      return;
    }

    if (this.queue.length > 0) {
      const { resolve } = this.queue.shift()!;
      resolve();
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
