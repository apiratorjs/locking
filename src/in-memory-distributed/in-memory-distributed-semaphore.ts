import crypto from "node:crypto";
import {
  AcquireParams,
  DistributedSemaphoreConstructorProps,
  IDistributedSemaphore,
  IReleaser,
  SemaphoreToken
} from "../types";
import { Semaphore } from "../semaphore";

export class InMemoryDistributedSemaphore implements IDistributedSemaphore {
  public readonly maxCount!: number;
  public readonly name!: string;

  private _isDestroyed: boolean = false;

  public constructor(
    props: DistributedSemaphoreConstructorProps,
    private readonly _registry: Map<string, Semaphore>,
    private readonly _type = "semaphore"
  ) {
    this.maxCount = props.maxCount;
    this.name = `${_type}:${props.name}`;

    if (!this._registry.has(this.name)) {
      this._registry.set(this.name, new Semaphore(this.maxCount));
    }
  }

  public async waitForFullyUnlock(): Promise<void> {
    return this.getSemaphoreOrException().waitForFullyUnlock();
  }

  public async waitForAnyUnlock(): Promise<void> {
    return this.getSemaphoreOrException().waitForAnyUnlock();
  }

  get isDestroyed() {
    return this._isDestroyed;
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

    const releaser = await this.acquire(params);
    try {
      return await callback();
    } finally {
      await releaser.release();
    }
  }

  public async destroy(message?: string): Promise<void> {
    const semaphore = this.getSemaphoreOrException();
    this._isDestroyed = true;
    this._registry.delete(this.name);
    await semaphore.cancelAll(message ?? "Semaphore destroyed");
  }

  public readonly implementation: string = "in-memory";

  public async freeCount(): Promise<number> {
    return this.getSemaphoreOrException().freeCount();
  }

  public async acquire(params?: {
    timeoutMs?: number;
  }, acquireToken?: SemaphoreToken): Promise<IReleaser<SemaphoreToken>> {
    const token = `${this.name}:${crypto.randomUUID()}` as SemaphoreToken;
    return this.getSemaphoreOrException().acquire(params, acquireToken ?? token);
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this.getSemaphoreOrException().cancelAll(errMessage);
  }

  public async isLocked(): Promise<boolean> {
    return this.getSemaphoreOrException().isLocked();
  }

  private getSemaphoreOrException(): Semaphore {
    const semaphore = this._registry.get(this.name);
    if (!semaphore) {
      throw new Error(`${this._type} '${this.name}' does not exist`);
    }

    return semaphore;
  }
}
