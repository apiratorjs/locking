import assert from "node:assert";
import {
  ELockDisplayType,
  IDistributedRWLock,
  IReleaser,
  TAcquireParams,
  TDistributedRWLockConstructorProps,
  TExclusiveCallback,
  TReadLockToken,
  TWriteLockToken,
} from "../types";
import { ReadWriteLock } from "../read-write-lock";
import { LockNotFoundError } from "../errors";

export class InMemoryDistributedReadWriteLock implements IDistributedRWLock {
  public readonly name: string;
  public readonly implementation: string = "in-memory";

  private readonly rwLock: ReadWriteLock;
  private destroyed: boolean = false;

  public constructor(props: TDistributedRWLockConstructorProps) {
    assert.ok(
      props.name,
      "InMemoryDistributedReadWriteLock requires a non-empty name.",
    );
    assert.ok(
      props.maxReaders === undefined || props.maxReaders > 0,
      "maxReaders must be greater than 0",
    );

    this.name = `${ELockDisplayType.RWLock}:${props.name}`;
    this.rwLock = new ReadWriteLock({ maxReaders: props.maxReaders });
  }

  public get isDestroyed(): boolean {
    return this.destroyed;
  }

  public async maxReaders(): Promise<number> {
    return this.ensureAlive().maxReaders();
  }

  public async activeReaders(): Promise<number> {
    return this.ensureAlive().activeReaders();
  }

  public async acquireRead(
    params?: TAcquireParams,
  ): Promise<IReleaser<TReadLockToken>> {
    return this.ensureAlive().acquireRead(params);
  }

  public async acquireWrite(
    params?: TAcquireParams,
  ): Promise<IReleaser<TWriteLockToken>> {
    return this.ensureAlive().acquireWrite(params);
  }

  public async tryAcquireRead(
    params?: TAcquireParams,
  ): Promise<IReleaser<TReadLockToken> | null> {
    return this.ensureAlive().tryAcquireRead(params);
  }

  public async tryAcquireWrite(
    params?: TAcquireParams,
  ): Promise<IReleaser<TWriteLockToken> | null> {
    return this.ensureAlive().tryAcquireWrite(params);
  }

  public async withReadLock<T>(fn: TExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(
    params: TAcquireParams,
    fn: TExclusiveCallback<T>,
  ): Promise<T>;
  public async withReadLock<T>(...args: any[]): Promise<T> {
    let callback: TExclusiveCallback<T>;
    let params: TAcquireParams | undefined;

    if (args.length === 1) {
      callback = args[0];
    } else {
      params = args[0];
      callback = args[1];
    }

    const rwLock = this.ensureAlive();
    if (params) {
      return rwLock.withReadLock(params, callback);
    } else {
      return rwLock.withReadLock(callback);
    }
  }

  public async withWriteLock<T>(fn: TExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(
    params: TAcquireParams,
    fn: TExclusiveCallback<T>,
  ): Promise<T>;
  public async withWriteLock<T>(...args: any[]): Promise<T> {
    let callback: TExclusiveCallback<T>;
    let params: TAcquireParams | undefined;

    if (args.length === 1) {
      callback = args[0];
    } else {
      params = args[0];
      callback = args[1];
    }

    const rwLock = this.ensureAlive();
    if (params) {
      return rwLock.withWriteLock(params, callback);
    } else {
      return rwLock.withWriteLock(callback);
    }
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this.ensureAlive().cancelAll(errMessage);
  }

  public async isReadLocked(): Promise<boolean> {
    return this.ensureAlive().isReadLocked();
  }

  public async isWriteLocked(): Promise<boolean> {
    return this.ensureAlive().isWriteLocked();
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
    await this.rwLock.cancelAll(message ?? "ReadWriteLock destroyed");
  }

  private ensureAlive(): ReadWriteLock {
    if (this.destroyed) {
      throw new LockNotFoundError(
        `${ELockDisplayType.RWLock} '${this.name}' does not exist`,
      );
    }

    return this.rwLock;
  }
}
