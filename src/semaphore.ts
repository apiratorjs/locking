import assert from "node:assert";
import { Deferred, ISemaphore } from "./types";

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

  public async freeCount(): Promise<number> {
    return this._freeCount;
  }

  public async acquire(params?: { timeoutInMs?: number; }): Promise<void> {
    const timeoutInMs = params?.timeoutInMs || DEFAULT_TIMEOUT_IN_MS;

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
      }, timeoutInMs);

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

  public async cancelAll(errMessage = "Semaphore acquisition cancelled"): Promise<void> {
    while (this._queue.length > 0) {
      const { timer, reject } = this._queue.shift()!;

      if (timer) {
        clearTimeout(timer);
      }
      reject(new Error(errMessage));
    }

    this._freeCount = this.maxCount;
  }

  public async isLocked(): Promise<boolean> {
    return this._freeCount === 0;
  };
}
