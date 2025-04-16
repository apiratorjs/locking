import { Semaphore } from "./semaphore";
import {
  AcquireParams,
  ExclusiveCallback,
  IReadWriteLock,
  IReleaser,
  ReadLockToken,
  RWLockConstructorProps,
  SemaphoreToken,
  WriteLockToken
} from "./types";

/**
 * ReadWriteLock (short for Read-Write Lock) is a synchronization mechanism that allows multiple threads to read from a resource simultaneously,
 * but prohibits writing if someone is reading, and vice versa: if writing is in progress, no one can read or write.
 *
 * The main principles of ReadWriteLock operation:
 *    • Multiple threads can read simultaneously if there is no writing.
 *    • Only one thread can write, and during writing, no reads are allowed.
 *    • This improves performance with a large number of read operations and infrequent writes.
 *
 * This implementation handles locks in the order they are requested:
 *    • Readers can acquire locks concurrently as long as no writer is active
 *    • Writers must wait for all active readers to release their locks before acquiring the write lock
 *    • New readers can acquire locks even if writers are waiting, as long as no writer is currently active
 *
 * Explanation in simple terms:
 * 1. There are multiple threads reading data — that's fine, they can do it simultaneously.
 * 2. At some point, a thread wants to write — it calls acquireWrite():
 *    • It cannot write while others are reading, so it queues and waits.
 * 3. Meanwhile, new read requests can still be granted while writers are waiting.
 */
export class ReadWriteLock implements IReadWriteLock {
  private _readSemaphore: Semaphore;
  private _writeSemaphore: Semaphore;

  constructor(props?: RWLockConstructorProps) {
    this._readSemaphore = new Semaphore(
      props?.maxReaders || 100
    );
    this._writeSemaphore = new Semaphore(1);
  }

  public async maxReaders(): Promise<number> {
    return this._readSemaphore.maxCount;
  }

  public async activeReaders(): Promise<number> {
    const freeCount = await this._readSemaphore.freeCount();
    const maxCount = this._readSemaphore.maxCount;
    return maxCount - freeCount;
  }

  public async acquireRead(params?: AcquireParams): Promise<IReleaser<ReadLockToken>> {
    await this._writeSemaphore.waitForFullyUnlock();

    const token = `rwlock:read:${crypto.randomUUID()}` as ReadLockToken;

    const readReleaser = await this._readSemaphore.acquire(params, token);

    return {
      release: () => readReleaser.release(),
      getToken: () => token
    };
  }

  public async acquireWrite(params?: AcquireParams): Promise<IReleaser<WriteLockToken>> {
    await this._readSemaphore.waitForFullyUnlock();

    const token = `rwlock:write:${crypto.randomUUID()}` as WriteLockToken;

    const writeReleaser = await this._writeSemaphore.acquire(params, token);

    return {
      release: () => writeReleaser.release(),
      getToken: () => token
    };
  }

  public async cancelAll(errMessage?: string): Promise<void> {
    await Promise.all([
      this._readSemaphore.cancelAll(errMessage),
      this._writeSemaphore.cancelAll(errMessage)
    ]);
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

    const releaser = await this.acquireRead(params);
    try {
      return await callback();
    } finally {
      await releaser.release();
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

    const releaser = await this.acquireWrite(params);
    try {
      return await callback();
    } finally {
      await releaser.release();
    }
  }

  public async isWriteLocked(): Promise<boolean> {
    return this._writeSemaphore.isLocked();
  }

  public async isReadLocked(): Promise<boolean> {
    return this._readSemaphore.isLocked();
  }
}
