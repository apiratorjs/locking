import {
  AcquireParams,
  DistributedRWLockConstructorProps,
  DistributedRWLockFactory,
  ExclusiveCallback,
  IDistributedRWLock,
  IReleaser,
  ReadLockToken,
  WriteLockToken
} from "./types";
import { InMemoryDistributedReadWriteLock } from "./in-memory-distributed/in-memory-distributed-read-write-lock";
import assert from "node:assert";

export class DistributedReadWriteLock implements IDistributedRWLock {
  public static factory: DistributedRWLockFactory =
    (props: DistributedRWLockConstructorProps) => new InMemoryDistributedReadWriteLock(props);

  private readonly _implementation: IDistributedRWLock;

  public constructor(props: DistributedRWLockConstructorProps) {
    assert.ok(props.name, "DistributedReadWriteLock requires a non-empty name.");
    assert.ok(props.maxReaders === undefined || props.maxReaders > 0, "maxReaders must be greater than 0");

    this._implementation = DistributedReadWriteLock.factory(props);
  }

  public async maxReaders(): Promise<number> {
    return this._implementation.maxReaders();
  }

  public async activeReaders(): Promise<number> {
    return this._implementation.activeReaders();
  }

  get isDestroyed() {
    return this._implementation.isDestroyed;
  }

  public async withReadLock<T>(fn: ExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._implementation.withReadLock<T>(...args);
  }

  public async withWriteLock<T>(fn: ExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(...args: any[]): Promise<T> {
    // @ts-ignore
    return this._implementation.withWriteLock<T>(...args);
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

  public async acquireRead(params?: AcquireParams): Promise<IReleaser<ReadLockToken>> {
    return this._implementation.acquireRead(params);
  }

  public async acquireWrite(params?: AcquireParams): Promise<IReleaser<WriteLockToken>> {
    return this._implementation.acquireWrite(params);
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this._implementation.cancelAll(errMessage ?? "ReadWriteLock cancelled");
  }

  public async isReadLocked(): Promise<boolean> {
    return this._implementation.isReadLocked();
  }

  public async isWriteLocked(): Promise<boolean> {
    return this._implementation.isWriteLocked();
  }
} 