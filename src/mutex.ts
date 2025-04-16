import { Semaphore } from "./semaphore";
import { AcquireParams, IMutex, IReleaser, MutexToken } from "./types";

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

  public async acquire(params?: { timeoutMs?: number; }, acquireToken?: string): Promise<IReleaser<MutexToken>> {
    // Cast SemaphoreToken to MutexToken since we're implementing a mutex interface
    const releaser = await this._semaphore.acquire(params, acquireToken);
    const wrappedReleaser: IReleaser<MutexToken> = {
      release: async () => releaser.release(),
      getToken: () => releaser.getToken() as unknown as MutexToken
    };
    return wrappedReleaser;
  }

  public async cancel(errMessage?: string): Promise<void> {
    return this._semaphore.cancelAll(errMessage ?? "Mutex cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this._semaphore.isLocked();
  }

  public async waitForUnlock(): Promise<void> {
    return await this._semaphore.waitForAnyUnlock();
  }
}
