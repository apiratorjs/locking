import { DistributedMutexConstructorProps, IDistributedMutex } from "./types";
import { DistributedSemaphore } from "./distributed-semaphore";

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

  getProvider() {
    return this._distributedSemaphore;
  }

  acquire(params?: { timeoutInMs?: number; }): Promise<void> {
    return this._distributedSemaphore.acquire(params);
  }

  release(): Promise<void> {
    return this._distributedSemaphore.release();
  }

  cancel(errMessage?: string): Promise<void> {
    return this._distributedSemaphore.cancelAll(errMessage);
  }

  isLocked(): Promise<boolean> {
    return this._distributedSemaphore.isLocked();
  }
}
