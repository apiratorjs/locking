import assert from "node:assert";
import { AcquireParams, Deferred, ISemaphore } from "./types";

const DEFAULT_TIMEOUT_IN_MS = 1_000 * 60; // 1 minute

export class Semaphore implements ISemaphore {
  public readonly maxCount: number;

  private _freeCount: number;
  private _queue: Deferred[];

  public constructor(maxCount: number) {
    assert.ok(maxCount > 0, "maxCount must be greater than 0");

    this.maxCount = maxCount;
    this._freeCount = maxCount;
    this._queue = [];
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

    await this.acquire(params);
    try {
      return await callback();
    } finally {
      await this.release();
    }
  }

  public async freeCount(): Promise<number> {
    return this._freeCount;
  }

  public async acquire(params?: { timeoutMs?: number; }): Promise<void> {
    const timeoutMs = params?.timeoutMs || DEFAULT_TIMEOUT_IN_MS;

    if (this._freeCount > 0) {
      this._freeCount--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const deferred: Deferred = {
        resolve,
        reject,
        timer: null
      };

      deferred.timer = setTimeout(() => {
        const index = this._queue.indexOf(deferred);
        if (index !== -1) {
          this._queue.splice(index, 1);
        }

        reject(new Error("Timeout acquiring semaphore"));
      }, timeoutMs);

      this._queue.push(deferred);
    });
  }

  public async release(): Promise<void> {
    if (this._freeCount === this.maxCount) {
      return;
    }

    if (this._queue.length > 0) {
      const { resolve, timer } = this._queue.shift()!;
      if (timer) {
        clearTimeout(timer);
      }
      resolve();
    } else {
      this._freeCount++;
    }
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    while (this._queue.length > 0) {
      const { timer, reject } = this._queue.shift()!;

      if (timer) {
        clearTimeout(timer);
      }

      reject(new Error(errMessage ?? "Semaphore cancelled"));
    }

    this._freeCount = this.maxCount;
  }

  public async isLocked(): Promise<boolean> {
    return this._freeCount === 0;
  };
}
