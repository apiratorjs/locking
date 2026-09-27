import { Semaphore } from "./semaphore";
import { TAcquireParams, IMutex, IMutexReleaser, TMutexAcquireParams, TMutexToken, TSemaphoreToken } from "./types";

export class Mutex implements IMutex {
  private readonly semaphore: Semaphore;

  public constructor() {
    this.semaphore = new Semaphore(1);
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: TAcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this.semaphore.runExclusive<T>(...args);
  }

  public async acquire(params?: TMutexAcquireParams): Promise<IMutexReleaser> {
    const releaser = await this.semaphore.acquire(params);

    // Same releaser and same token, only branded as a mutex one
    return releaser as unknown as IMutexReleaser;
  }

  public async tryAcquire(params?: TMutexAcquireParams): Promise<IMutexReleaser | null> {
    const releaser = await this.semaphore.tryAcquire(params);

    return releaser as unknown as IMutexReleaser | null;
  }

  public restoreReleaser(token: TMutexToken): IMutexReleaser {
    return this.semaphore.restoreReleaser(token as unknown as TSemaphoreToken) as unknown as IMutexReleaser;
  }

  public async cancel(errMessage?: string): Promise<void> {
    return this.semaphore.cancelAll(errMessage ?? "Mutex cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this.semaphore.isLocked();
  }

  public async waitForUnlock(): Promise<void> {
    return await this.semaphore.waitForAnyUnlock();
  }
}
