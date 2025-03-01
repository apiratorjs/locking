import { DistributedSemaphoreConstructorProps, DistributedSemaphoreFactory, IDistributedSemaphore } from "./types";
import assert from "node:assert";
import { InMemoryDistributedSemaphore } from "./in-memory-distributed-semaphore";

export class DistributedSemaphore implements IDistributedSemaphore {
  public static concreteImplementationFactory: DistributedSemaphoreFactory =
    (props: DistributedSemaphoreConstructorProps) => new InMemoryDistributedSemaphore(props);

  private readonly _concreteImplementation: IDistributedSemaphore;

  public constructor(props: DistributedSemaphoreConstructorProps) {
    assert.ok(props.maxCount > 0, "maxCount must be greater than 0");
    assert.ok(props.name, "name must be provided");

    this._concreteImplementation = DistributedSemaphore.concreteImplementationFactory(props);
  }

  public get name(): string {
    return this._concreteImplementation.name;
  };

  public get maxCount(): number {
    return this._concreteImplementation.maxCount;
  };

  public async getProvider() {
    return this._concreteImplementation;
  }

  public async freeCount(): Promise<number> {
    return this._concreteImplementation.freeCount();
  }

  public async acquire(params?: { timeoutInMs?: number; }): Promise<void> {
    return this._concreteImplementation.acquire(params);
  }

  public async release(): Promise<void> {
    return this._concreteImplementation.release();
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this._concreteImplementation.cancelAll(errMessage);
  }

  public async isLocked(): Promise<boolean> {
    return this._concreteImplementation.isLocked();
  }
}
