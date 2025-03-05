import {
  AcquireParams, AcquireToken,
  DistributedSemaphoreConstructorProps,
  DistributedSemaphoreFactory,
  IDistributedSemaphore,
  IReleaser
} from "./types";
import assert from "node:assert";
import { InMemoryDistributedSemaphore } from "./in-memory-distributed/in-memory-distributed-semaphore";
import { inMemoryDistributedSemaphoreRegistry } from "./in-memory-distributed/in-memory-distributed-registry";

export class DistributedSemaphore implements IDistributedSemaphore {
  public static factory: DistributedSemaphoreFactory =
    (props: DistributedSemaphoreConstructorProps) => new InMemoryDistributedSemaphore(props, inMemoryDistributedSemaphoreRegistry);

  private readonly _implementation: IDistributedSemaphore;

  public constructor(props: DistributedSemaphoreConstructorProps) {
    assert.ok(props.maxCount > 0, "maxCount must be greater than 0");
    assert.ok(props.name, "DistributedSemaphore requires a non-empty name.");

    this._implementation = DistributedSemaphore.factory(props);
  }

  get isDestroyed() {
    return this._implementation.isDestroyed;
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._implementation.runExclusive<T>(...args);
  }

  public async destroy(): Promise<void> {
    return this._implementation.destroy();
  }

  public get name(): string {
    return this._implementation.name;
  };

  public get maxCount(): number {
    return this._implementation.maxCount;
  };

  public get implementation() {
    return this._implementation.implementation;
  }

  public async freeCount(): Promise<number> {
    return this._implementation.freeCount();
  }

  public async acquire(params?: { timeoutMs?: number; }, acquireToken?: AcquireToken): Promise<IReleaser> {
    return this._implementation.acquire(params, acquireToken);
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this._implementation.cancelAll(errMessage ?? "Semaphore cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this._implementation.isLocked();
  }
}
