import assert from "node:assert";
import crypto from "node:crypto";
import {
  ELockDisplayType,
  IDistributedSemaphore,
  ISemaphoreReleaser,
  TAcquireParams,
  TDistributedSemaphoreConstructorProps,
  TSemaphoreAcquireParams,
  TSemaphoreToken,
} from "../types";
import { Semaphore } from "../semaphore";
import { LockNotFoundError } from "../errors";

export class InMemoryDistributedSemaphore implements IDistributedSemaphore {
  public readonly maxCount: number;
  public readonly name: string;
  public readonly implementation: string = "in-memory";

  private readonly semaphore: Semaphore;
  private destroyed: boolean = false;

  public constructor(props: TDistributedSemaphoreConstructorProps) {
    assert.ok(
      props.name,
      "InMemoryDistributedSemaphore requires a non-empty name.",
    );
    assert.ok(props.maxCount > 0, "maxCount must be greater than 0");

    this.name = `${ELockDisplayType.Semaphore}:${props.name}`;
    this.maxCount = props.maxCount;
    this.semaphore = new Semaphore(props.maxCount);
  }

  public get isDestroyed(): boolean {
    return this.destroyed;
  }

  public async waitForFullyUnlock(): Promise<void> {
    return this.ensureAlive().waitForFullyUnlock();
  }

  public async waitForAnyUnlock(): Promise<void> {
    return this.ensureAlive().waitForAnyUnlock();
  }

  public async freeCount(): Promise<number> {
    return this.ensureAlive().freeCount();
  }

  public async acquire(
    params?: TSemaphoreAcquireParams,
  ): Promise<ISemaphoreReleaser> {
    const token = `${this.name}:${crypto.randomUUID()}` as TSemaphoreToken;

    return this.ensureAlive().acquire(params, token);
  }

  public async tryAcquire(
    params?: TSemaphoreAcquireParams,
  ): Promise<ISemaphoreReleaser | null> {
    const token = `${this.name}:${crypto.randomUUID()}` as TSemaphoreToken;

    return this.ensureAlive().tryAcquire(params, token);
  }

  public restoreReleaser(token: TSemaphoreToken): ISemaphoreReleaser {
    return this.ensureAlive().restoreReleaser(token);
  }

  public async runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;
  public async runExclusive<T>(
    params: TAcquireParams,
    fn: () => Promise<T> | T,
  ): Promise<T>;
  public async runExclusive<T>(...args: any[]): Promise<T> {
    let callback: () => Promise<T> | T;
    let params: TAcquireParams | undefined;

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

  public async cancelAll(errMessage?: string): Promise<void> {
    return this.ensureAlive().cancelAll(errMessage);
  }

  public async isLocked(): Promise<boolean> {
    return this.ensureAlive().isLocked();
  }

  /**
   * Destroying is idempotent and never throws for an already destroyed lock:
   * tearing something down twice is not an error.
   */
  public async destroy(message?: string): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    await this.semaphore.dispose(message ?? "Semaphore destroyed");
  }

  private ensureAlive(): Semaphore {
    if (this.destroyed) {
      throw new LockNotFoundError(
        `${ELockDisplayType.Semaphore} '${this.name}' does not exist`,
      );
    }

    return this.semaphore;
  }
}
