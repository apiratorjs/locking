import assert from "node:assert";
import crypto from "node:crypto";
import {
  ELockDisplayType,
  IDistributedMutex,
  IMutexReleaser,
  TAcquireParams,
  TDistributedMutexConstructorProps,
  TMutexAcquireParams,
  TMutexToken,
  TSemaphoreToken,
} from "../types";
import { Semaphore } from "../semaphore";
import { LockNotFoundError } from "../errors";

export class InMemoryDistributedMutex implements IDistributedMutex {
  public readonly name: string;
  public readonly implementation: string = "in-memory";

  private readonly semaphore: Semaphore;
  private destroyed: boolean = false;

  public constructor(props: TDistributedMutexConstructorProps) {
    assert.ok(
      props.name,
      "InMemoryDistributedMutex requires a non-empty name.",
    );

    this.name = `${ELockDisplayType.Mutex}:${props.name}`;
    this.semaphore = new Semaphore(1);
  }

  public get isDestroyed(): boolean {
    return this.destroyed;
  }

  public async acquire(
    params?: TMutexAcquireParams,
  ): Promise<IMutexReleaser> {
    const token = `${this.name}:${crypto.randomUUID()}` as TMutexToken;

    const releaser = await this.ensureAlive().acquire(params, token);

    return releaser as unknown as IMutexReleaser;
  }

  public async tryAcquire(
    params?: TMutexAcquireParams,
  ): Promise<IMutexReleaser | null> {
    const token = `${this.name}:${crypto.randomUUID()}` as TMutexToken;

    const releaser = await this.ensureAlive().tryAcquire(params, token);

    return releaser as unknown as IMutexReleaser | null;
  }

  public restoreReleaser(token: TMutexToken): IMutexReleaser {
    const releaser = this.ensureAlive().restoreReleaser(token as unknown as TSemaphoreToken);

    return releaser as unknown as IMutexReleaser;
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

  public async cancel(errMessage?: string): Promise<void> {
    return this.ensureAlive().cancelAll(errMessage ?? "Mutex cancelled");
  }

  public async isLocked(): Promise<boolean> {
    return this.ensureAlive().isLocked();
  }

  public async waitForUnlock(): Promise<void> {
    return this.ensureAlive().waitForAnyUnlock();
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
    await this.semaphore.dispose(message ?? "Mutex destroyed");
  }

  private ensureAlive(): Semaphore {
    if (this.destroyed) {
      throw new LockNotFoundError(
        `${ELockDisplayType.Mutex} '${this.name}' does not exist`,
      );
    }

    return this.semaphore;
  }
}
