import { DistributedMutexConstructorProps, IDistributedMutex } from "./types";
import { DistributedSemaphore } from "./distributed-semaphore";
import { inMemoryDistributedSemaphoreStore } from "./in-memory-distributed-semaphore";

export class InMemoryDistributedMutex implements IDistributedMutex {
  private readonly _distributedSemaphore: DistributedSemaphore;

  public name: string;

  public constructor(props: DistributedMutexConstructorProps) {
    this.name = props.name;
    this._distributedSemaphore = new DistributedSemaphore({
      maxCount: 1,
      name: this.name
    });
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    return this._distributedSemaphore.runExclusive(fn);
  }

  public readonly implementation: string = "in-memory";

  public async destroy(): Promise<void> {
    inMemoryDistributedSemaphoreStore.delete(this.name);
  }

  public getProvider() {
    return this._distributedSemaphore;
  }

  public acquire(params?: { timeoutMs?: number; }): Promise<void> {
    return this._distributedSemaphore.acquire(params);
  }

  public release(): Promise<void> {
    return this._distributedSemaphore.release();
  }

  public cancel(errMessage?: string): Promise<void> {
    return this._distributedSemaphore.cancelAll(errMessage);
  }

  public isLocked(): Promise<boolean> {
    return this._distributedSemaphore.isLocked();
  }
}
