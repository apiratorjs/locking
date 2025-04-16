import assert from "node:assert";
import crypto from "node:crypto";
import { AcquireParams, IDeferred, IReleaser, ISemaphore, SemaphoreToken } from "./types";
import { DEFAULT_TIMEOUT_IN_MS } from "./constants";

class Releaser implements IReleaser<SemaphoreToken> {
  constructor(
    private readonly _onRelease: () => Promise<void>,
    private readonly _token: SemaphoreToken
  ) {}

  public async release(): Promise<void> {
    await this._onRelease();
  }

  public getToken(): SemaphoreToken {
    return this._token;
  }
}

export class Semaphore implements ISemaphore {
  public readonly maxCount: number;

  private _freeCount: number;
  private _queue: IDeferred[];
  private _waitingForAnyUnlockListeners: IDeferred[];
  private _waitingForFullyUnlockListeners: IDeferred[];

  public constructor(maxCount: number) {
    assert.ok(maxCount > 0, "maxCount must be greater than 0");

    this.maxCount = maxCount;
    this._freeCount = maxCount;
    this._queue = [];
    this._waitingForAnyUnlockListeners = [];
    this._waitingForFullyUnlockListeners = [];
  }

  public async waitForFullyUnlock(): Promise<void> {
    if (this.maxCount === this._freeCount) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this._waitingForFullyUnlockListeners.push({
        resolve,
        reject
      });
    });
  }

  public async waitForAnyUnlock(): Promise<void> {
    if (this._freeCount > 0) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this._waitingForAnyUnlockListeners.push({
        resolve,
        reject
      });
    });
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    let callback: () => Promise<T> | T;
    let params: AcquireParams | undefined;

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
    return this._freeCount;
  }

  public async acquire(params?: { timeoutMs?: number; }, acquireToken?: string): Promise<IReleaser<SemaphoreToken>> {
    const timeoutMs = params?.timeoutMs || DEFAULT_TIMEOUT_IN_MS;

    const token = (acquireToken ?? crypto.randomUUID()) as SemaphoreToken;
    const releaser = new Releaser(this.release.bind(this), token);

    if (this._freeCount > 0) {
      this._freeCount--;
      return releaser;
    }

    return new Promise<IReleaser<SemaphoreToken>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this._queue.indexOf(deferred);
        if (index !== -1) {
          this._queue.splice(index, 1);
        }

        reject(new Error("Timeout acquiring semaphore"));
      }, timeoutMs);

      const deferred: IDeferred = {
        resolve: () => {
          if (timer) {
            clearTimeout(timer);
          }
          resolve(releaser);
        },
        reject: (err) => {
          if (timer) {
            clearTimeout(timer);
          }
          reject(err);
        }
      };

      this._queue.push(deferred);
    });
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    const cancellationList = [...this._queue];

    await Promise.all(cancellationList.map(deferred => deferred.reject(new Error(errMessage ?? "Semaphore cancelled"))));

    this._queue = [];
    this._freeCount = this.maxCount;

    // Notify all waitingForAnyUnlockListeners listeners since we're resetting to unlocked state
    const waitingForAnyUnlockListeners = [...this._waitingForAnyUnlockListeners];
    this._waitingForAnyUnlockListeners = [];
    waitingForAnyUnlockListeners.forEach(listener => listener.reject(new Error(errMessage ?? "Semaphore cancelled")));

    // Notify all waitingForFullyUnlockListeners listeners since we're resetting to unlocked state
    const fullyUnlockListeners = [...this._waitingForFullyUnlockListeners];
    this._waitingForFullyUnlockListeners = [];
    fullyUnlockListeners.forEach(listener => listener.reject(new Error(errMessage ?? "Semaphore cancelled")));
  }

  public async isLocked(): Promise<boolean> {
    return this._freeCount === 0;
  }

  private async release(): Promise<void> {
    if (this._freeCount === this.maxCount) {
      return;
    }

    if (this._queue.length > 0) {
      const { resolve } = this._queue.shift()!;
      resolve();
    } else {
      this._freeCount++;

      if (this._freeCount > 0 && this._waitingForAnyUnlockListeners.length > 0) {
        const listeners = [...this._waitingForAnyUnlockListeners];
        this._waitingForAnyUnlockListeners = [];
        listeners.forEach(listener => listener.resolve());
      }

      if (this._freeCount === this.maxCount) {
        const listeners = [...this._waitingForFullyUnlockListeners];
        this._waitingForFullyUnlockListeners = [];
        listeners.forEach(listener => listener.resolve());
      }
    }
  }
}
