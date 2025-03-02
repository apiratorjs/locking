import { AcquireParams, DistributedSemaphoreConstructorProps, IDistributedSemaphore } from "./types";
import { Semaphore } from "./semaphore";

export const inMemoryDistributedSemaphoreStore = new Map<string, Semaphore>();

export class InMemoryDistributedSemaphore implements IDistributedSemaphore {
  public readonly maxCount!: number;
  public readonly name!: string;

  public constructor(props: DistributedSemaphoreConstructorProps, prefix = "semaphore") {
    this.maxCount = props.maxCount;
    this.name = `${prefix}:${props.name}`;

    inMemoryDistributedSemaphoreStore.set(this.name, new Semaphore(this.maxCount));
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

  public async destroy(): Promise<void> {
    inMemoryDistributedSemaphoreStore.delete(this.name);
  }

  public readonly implementation: string = "in-memory";

  public async freeCount(): Promise<number> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.freeCount();
  }

  public async acquire(params?: { timeoutMs?: number; }): Promise<void> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.acquire(params);
  }

  public async release(): Promise<void> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.release();
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.cancelAll(errMessage);
  }

  public async isLocked(): Promise<boolean> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.isLocked();
  }
}
