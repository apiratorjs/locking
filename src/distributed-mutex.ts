import { DistributedMutexConstructorProps, DistributedMutexFactory, IDistributedMutex } from "./types";
import { InMemoryDistributedMutex } from "./in-memory-distributed-mutex";
import assert from "node:assert";

export class DistributedMutex implements IDistributedMutex {
  public static concreteImplementationFactory: DistributedMutexFactory =
    (props: DistributedMutexConstructorProps) => new InMemoryDistributedMutex(props);

  private readonly _concreteImplementation: IDistributedMutex;

  public constructor(props: DistributedMutexConstructorProps) {
    assert.ok(props.name, "name must be provided");

    this._concreteImplementation = DistributedMutex.concreteImplementationFactory(props);
  }

  public get name(): string {
    return this._concreteImplementation.name;
  }

  public getProvider() {
    return this._concreteImplementation;
  }

  public async acquire(params?: { timeoutInMs?: number; }): Promise<void> {
    return this._concreteImplementation.acquire(params);
  }

  public async release(): Promise<void> {
    return this._concreteImplementation.release();
  }

  public async cancel(errMessage?: string): Promise<void> {
    return this._concreteImplementation.cancel("Mutex acquisition cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this._concreteImplementation.isLocked();
  }
}
