import {
  AcquireParams,
  DistributedMutexConstructorProps,
  IDistributedMutex,
  IReleaser,
  MutexToken,
  SemaphoreToken
} from "../types";
import { InMemoryDistributedSemaphore } from "./in-memory-distributed-semaphore";
import { inMemoryDistributedMutexRegistry } from "./in-memory-distributed-registry";
import crypto from "node:crypto";

export class InMemoryDistributedMutex implements IDistributedMutex {
  private readonly _inMemoryDistributedSemaphore: InMemoryDistributedSemaphore;

  public constructor(props: DistributedMutexConstructorProps) {
    this._inMemoryDistributedSemaphore = new InMemoryDistributedSemaphore(
      {
        maxCount: 1,
        name: props.name
      },
      inMemoryDistributedMutexRegistry,
      "mutex"
    );
  }

  public get name(): string {
    return this._inMemoryDistributedSemaphore.name;
  };

  public get isDestroyed() {
    return this._inMemoryDistributedSemaphore.isDestroyed;
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>
  public async runExclusive<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._inMemoryDistributedSemaphore.runExclusive(...args);
  }

  public readonly implementation: string = "in-memory";

  public async destroy(): Promise<void> {
    return this._inMemoryDistributedSemaphore.destroy("Mutex destroyed");
  }

  public acquire(params?: { timeoutMs?: number; }, acquireToken?: MutexToken): Promise<IReleaser<MutexToken>> {
    const token = `${this.name}:${crypto.randomUUID()}` as MutexToken;
    return this._inMemoryDistributedSemaphore.acquire(params, (acquireToken ?? token) as unknown as SemaphoreToken) as unknown as Promise<IReleaser<MutexToken>>;
  }

  public cancel(errMessage?: string): Promise<void> {
    return this._inMemoryDistributedSemaphore.cancelAll(errMessage);
  }

  public isLocked(): Promise<boolean> {
    return this._inMemoryDistributedSemaphore.isLocked();
  }
}
