import { Semaphore } from "./semaphore";
import { AcquireParams, IMutex } from "./types";

export class Mutex implements IMutex {
  private readonly _semaphore: Semaphore;

  public constructor() {
    this._semaphore = new Semaphore(1);
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._semaphore.runExclusive<T>(...args);
  }

  public async acquire(params?: { timeoutMs?: number; }): Promise<void> {
    return this._semaphore.acquire(params);
  }

  public async release(): Promise<void> {
    return this._semaphore.release();
  }

  public async cancel(errMessage?: string): Promise<void> {
    return this._semaphore.cancelAll(errMessage ?? "Mutex cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this._semaphore.isLocked();
  }
}
