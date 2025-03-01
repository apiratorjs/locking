import { DistributedSemaphoreConstructorProps, IDistributedSemaphore } from "./types";
import { Semaphore } from "./semaphore";

export const inMemoryDistributedSemaphoreStore = new Map<string, Semaphore>();

export class InMemoryDistributedSemaphore implements IDistributedSemaphore {
  private static _instance: InMemoryDistributedSemaphore;

  public static create(props: DistributedSemaphoreConstructorProps): InMemoryDistributedSemaphore {
    if (!this._instance) {
      this._instance = new InMemoryDistributedSemaphore(props);
    }

    return this._instance;
  }

  public readonly maxCount!: number;
  public readonly name!: string;

  public constructor(props: DistributedSemaphoreConstructorProps, prefix = "semaphore") {
    this.maxCount = props.maxCount;
    this.name = `${prefix}:${props.name}`;

    inMemoryDistributedSemaphoreStore.set(this.name, new Semaphore(this.maxCount));
  }

  public getProvider() {
    return inMemoryDistributedSemaphoreStore;
  }

  public async freeCount(): Promise<number> {
    return inMemoryDistributedSemaphoreStore.get(this.name)!.freeCount();
  }

  public async acquire(params?: { timeoutInMs?: number; }): Promise<void> {
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
