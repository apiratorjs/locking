import { Semaphore } from "./semaphore";
import { IMutex } from "./types";

export class Mutex implements IMutex {
  private readonly _semaphore: Semaphore;

  public constructor() {
    this._semaphore = new Semaphore(1);
  }

  acquire(params?: { timeoutInMs?: number; }): Promise<void> {
    return this._semaphore.acquire(params);
  }

  release(): Promise<void> {
    return this._semaphore.release();
  }

  cancel(errMessage?: string): Promise<void> {
    return this._semaphore.cancelAll("Mutex acquisition cancelled");
  }

  isLocked(): Promise<boolean> {
    return this._semaphore.isLocked();
  }
}
