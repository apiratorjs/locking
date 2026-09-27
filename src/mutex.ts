import { Semaphore } from "./semaphore";
import { TAcquireParams, IMutex, IReleaser, TMutexToken } from "./types";

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

  public async acquire(params?: TAcquireParams): Promise<IReleaser<TMutexToken>> {
    const releaser = await this.semaphore.acquire(params);

    // Same releaser and same token, only branded as a mutex one
    return releaser as unknown as IReleaser<TMutexToken>;
  }

  public async tryAcquire(params?: TAcquireParams): Promise<IReleaser<TMutexToken> | null> {
    const releaser = await this.semaphore.tryAcquire(params);

    return releaser as unknown as IReleaser<TMutexToken> | null;
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
