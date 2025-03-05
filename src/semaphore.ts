import assert from "node:assert";
import crypto from "node:crypto";
import { AcquireToken, AcquireParams, IDeferred, IReleaser, ISemaphore } from "./types";
import { DEFAULT_TIMEOUT_IN_MS } from "./constants";

class Releaser implements IReleaser {
  constructor(
    private readonly _onRelease: () => Promise<void>,
    private readonly _token: AcquireToken
  ) {}

  public async release(): Promise<void> {
    await this._onRelease();
  }

  public getToken(): AcquireToken {
    return this._token;
  }
}

export class Semaphore implements ISemaphore {
  public readonly maxCount: number;

  private _freeCount: number;
  private _queue: IDeferred[];

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

  public async acquire(params?: { timeoutMs?: number; }, acquireToken?: AcquireToken): Promise<IReleaser> {
    const timeoutMs = params?.timeoutMs || DEFAULT_TIMEOUT_IN_MS;

    const releaser = new Releaser(this.release.bind(this), acquireToken ?? crypto.randomUUID());

    if (this._freeCount > 0) {
      this._freeCount--;
      return releaser;
    }

    return new Promise<IReleaser>((resolve, reject) => {
      const deferred: IDeferred = {
        resolve: () => resolve(releaser),
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
  }

  private async release(): Promise<void> {
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
}
