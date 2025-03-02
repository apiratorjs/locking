import { AcquireParams, DistributedMutexConstructorProps, DistributedMutexFactory, IDistributedMutex } from "./types";
import { InMemoryDistributedMutex } from "./in-memory-distributed-mutex";
import assert from "node:assert";

export class DistributedMutex implements IDistributedMutex {
  public static factory: DistributedMutexFactory =
    (props: DistributedMutexConstructorProps) => new InMemoryDistributedMutex(props);

  private readonly _implementation: IDistributedMutex;

  public constructor(props: DistributedMutexConstructorProps) {
    assert.ok(props.name, "DistributedMutex requires a non-empty name.");

    this._implementation = DistributedMutex.factory(props);
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._implementation.runExclusive(...args);
  }

  public async destroy(): Promise<void> {
    return this._implementation.destroy();
  }

  public get name(): string {
    return this._implementation.name;
  }

  public get implementation() {
    return this._implementation.implementation;
  }

  public async acquire(params?: { timeoutMs?: number; }): Promise<void> {
    return this._implementation.acquire(params);
  }

  public async release(): Promise<void> {
    return this._implementation.release();
  }

  public async cancel(errMessage?: string): Promise<void> {
    return this._implementation.cancel(errMessage ?? "Mutex cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this._implementation.isLocked();
  }
}
