import {
  AcquireParams,
  DistributedRWLockConstructorProps,
  ExclusiveCallback,
  IDistributedRWLock,
  IReleaser,
  ReadLockToken,
  WriteLockToken
} from "../types";
import { ReadWriteLock } from "../read-write-lock";
import { inMemoryDistributedRWLockRegistry } from "./in-memory-distributed-registry";

export class InMemoryDistributedReadWriteLock implements IDistributedRWLock {
  public readonly name!: string;
  private _isDestroyed: boolean = false;

  public constructor(
    props: DistributedRWLockConstructorProps,
    private readonly _registry: Map<string, ReadWriteLock> = inMemoryDistributedRWLockRegistry,
    private readonly _type = "rwlock"
  ) {
    this.name = `${_type}:${props.name}`;

    if (!this._registry.has(this.name)) {
      this._registry.set(this.name, new ReadWriteLock({ maxReaders: props.maxReaders }));
    }
  }

  get isDestroyed() {
    return this._isDestroyed;
  }

  public async maxReaders(): Promise<number> {
    return this.getRWLockOrException().maxReaders();
  }

  public async activeReaders(): Promise<number> {
    return this.getRWLockOrException().activeReaders();
  }

  public async withReadLock<T>(fn: ExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(...args: any[]): Promise<T> {
    let callback: ExclusiveCallback<T>;
    let params: AcquireParams | undefined;

    if (args.length === 1) {
      callback = args[0];
    } else {
      params = args[0];
      callback = args[1];
    }

    const rwLock = this.getRWLockOrException();
    if (params) {
      return rwLock.withReadLock(params, callback);
    } else {
      return rwLock.withReadLock(callback);
    }
  }

  public async withWriteLock<T>(fn: ExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(...args: any[]): Promise<T> {
    let callback: ExclusiveCallback<T>;
    let params: AcquireParams | undefined;

    if (args.length === 1) {
      callback = args[0];
    } else {
      params = args[0];
      callback = args[1];
    }

    const rwLock = this.getRWLockOrException();
    if (params) {
      return rwLock.withWriteLock(params, callback);
    } else {
      return rwLock.withWriteLock(callback);
    }
  }

  public async destroy(message?: string): Promise<void> {
    const rwLock = this.getRWLockOrException();
    this._isDestroyed = true;
    this._registry.delete(this.name);
    await rwLock.cancelAll(message ?? "ReadWriteLock destroyed");
  }

  public readonly implementation: string = "in-memory";

  public async acquireRead(params?: AcquireParams): Promise<IReleaser<ReadLockToken>> {
    return this.getRWLockOrException().acquireRead(params);
  }

  public async acquireWrite(params?: AcquireParams): Promise<IReleaser<WriteLockToken>> {
    return this.getRWLockOrException().acquireWrite(params);
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    return this.getRWLockOrException().cancelAll(errMessage);
  }

  public async isReadLocked(): Promise<boolean> {
    return this.getRWLockOrException().isReadLocked();
  }

  public async isWriteLocked(): Promise<boolean> {
    return this.getRWLockOrException().isWriteLocked();
  }

  private getRWLockOrException(): ReadWriteLock {
    const rwLock = this._registry.get(this.name);
    if (!rwLock) {
      throw new Error(`${this._type} '${this.name}' does not exist`);
    }

    return rwLock;
  }
} 