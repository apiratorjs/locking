import {
  AcquiredDistributedToken,
  AcquireParams,
  DistributedSemaphoreConstructorProps,
  IDistributedSemaphore
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

    this._registry.set(this.name, new Semaphore(this.maxCount));
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

    const token = await this.acquire(params);
    try {
      return await callback();
    } finally {
      await this.release(token);
    }
  }

  public async destroy(): Promise<void> {
    this._isDestroyed = true;
    this._registry.delete(this.name);
  }

  public readonly implementation: string = "in-memory";

  public async freeCount(): Promise<number> {
    return this.getSemaphoreOrException().freeCount();
  }

  public async acquire(params?: { timeoutMs?: number; }): Promise<AcquiredDistributedToken> {
    await this.getSemaphoreOrException().acquire(params);

    // In-memory semaphore does not need a token, so just return for interface compatibility
    return `${this.name}:${crypto.randomUUID()}`;
  }

  public async release(token?: AcquiredDistributedToken): Promise<void> {
    return this.getSemaphoreOrException().release();
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this.getSemaphoreOrException().cancelAll(errMessage);
  }

  public async isLocked(): Promise<boolean> {
    return this.getSemaphoreOrException().isLocked();
  }

  private getSemaphoreOrException(): Semaphore {
    if (this._isDestroyed) {
      throw new Error(`${this._type} '${this.name}' has been destroyed`);
    }

    const semaphore = this._registry.get(this.name);
    if (!semaphore) {
      throw new Error(`${this._type} '${this.name}' does not exist`);
    }

    return semaphore;
  }
}
