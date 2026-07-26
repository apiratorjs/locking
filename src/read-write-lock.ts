import assert from "node:assert";
import crypto from "node:crypto";
import {
  TAcquireParams,
  TExclusiveCallback,
  IDeferred,
  IReadWriteLock,
  IReleaser,
  TReadLockToken,
  TRWLockConstructorProps,
  TWriteLockToken
} from "./types";
import { DEFAULT_MAX_READERS, DEFAULT_TIMEOUT_IN_MS } from "./constants";
import { CancelledLockingError, TimeoutLockingError } from "./errors";
import { unrefTimer } from "./utils";

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
 *
 * Lock state is owned by this class rather than delegated to two independent
 * semaphores: deciding whether a lock is available and taking it must happen in
 * a single synchronous step, otherwise a reader and a writer that start
 * concurrently can both pass their checks and end up holding the lock together.
 */
export class ReadWriteLock implements IReadWriteLock {
  /**
   * Synchronous counterpart of maxReaders(), needed wherever the limit has to be
   * inspected outside of an async context.
   */
  public readonly maxReadersCount: number;

  private activeReaderCount: number = 0;
  private writerActive: boolean = false;
  private readQueue: IDeferred[] = [];
  private writeQueue: IDeferred[] = [];

  public constructor(props?: TRWLockConstructorProps) {
    const maxReaders = props?.maxReaders ?? DEFAULT_MAX_READERS;
    assert.ok(maxReaders > 0, "maxReaders must be greater than 0");

    this.maxReadersCount = maxReaders;
  }

  public async maxReaders(): Promise<number> {
    return this.maxReadersCount;
  }

  public async activeReaders(): Promise<number> {
    return this.activeReaderCount;
  }

  public async acquireRead(params?: TAcquireParams): Promise<IReleaser<TReadLockToken>> {
    const token = `rwlock:read:${crypto.randomUUID()}` as TReadLockToken;

    if (!this.writerActive && this.readQueue.length === 0 && this.activeReaderCount < this.maxReadersCount) {
      this.activeReaderCount++;
      return this.createReleaser(token, () => this.releaseRead());
    }

    // The dispatcher accounts for the reader slot before resolving the waiter.
    await this.enqueue(this.readQueue, params, "Timeout acquiring read lock");

    return this.createReleaser(token, () => this.releaseRead());
  }

  public async acquireWrite(params?: TAcquireParams): Promise<IReleaser<TWriteLockToken>> {
    const token = `rwlock:write:${crypto.randomUUID()}` as TWriteLockToken;

    if (!this.writerActive && this.activeReaderCount === 0 && this.writeQueue.length === 0) {
      this.writerActive = true;
      return this.createReleaser(token, () => this.releaseWrite());
    }

    // The dispatcher marks the lock as write-locked before resolving the waiter.
    await this.enqueue(this.writeQueue, params, "Timeout acquiring write lock");

    return this.createReleaser(token, () => this.releaseWrite());
  }

  /**
   * Cancels every pending acquisition. Locks that are already held stay held -
   * their owners are still inside their critical sections.
   */
  public async cancelAll(errMessage?: string): Promise<void> {
    const pending = [...this.readQueue, ...this.writeQueue];
    this.readQueue = [];
    this.writeQueue = [];

    pending.forEach(waiter => waiter.reject(new CancelledLockingError(errMessage ?? "ReadWriteLock cancelled")));
  }

  public async withReadLock<T>(fn: TExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;
  public async withReadLock<T>(...args: any[]): Promise<T> {
    let callback: TExclusiveCallback<T>;
    let params: TAcquireParams | undefined;

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

  public async withWriteLock<T>(fn: TExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;
  public async withWriteLock<T>(...args: any[]): Promise<T> {
    let callback: TExclusiveCallback<T>;
    let params: TAcquireParams | undefined;

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
    return this.writerActive;
  }

  public async isReadLocked(): Promise<boolean> {
    return this.activeReaderCount > 0;
  }

  private enqueue(queue: IDeferred[], params: TAcquireParams | undefined, timeoutMessage: string): Promise<void> {
    // `??` and not `||`: timeoutMs 0 means "fail fast", not "use the default".
    const timeoutMs = params?.timeoutMs ?? DEFAULT_TIMEOUT_IN_MS;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = queue.indexOf(deferred);
        if (index !== -1) {
          queue.splice(index, 1);
        }

        reject(new TimeoutLockingError(timeoutMessage));
      }, timeoutMs);

      // A pending acquisition must not keep the process alive on its own: only
      // code already running can release the lock this waiter is after.
      unrefTimer(timer);

      const deferred: IDeferred = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      };

      queue.push(deferred);
    });
  }

  private createReleaser<T extends TReadLockToken | TWriteLockToken>(token: T, onRelease: () => void): IReleaser<T> {
    let isReleased = false;

    return {
      // Releasing is idempotent: one releaser owns exactly one lock, so a repeated
      // call must not free a lock that somebody else is holding by now.
      release: async () => {
        if (isReleased) {
          return;
        }

        isReleased = true;
        onRelease();
      },
      getToken: () => token
    };
  }

  private releaseRead(): void {
    if (this.activeReaderCount > 0) {
      this.activeReaderCount--;
    }

    this.dispatch();
  }

  private releaseWrite(): void {
    this.writerActive = false;

    this.dispatch();
  }

  private dispatch(): void {
    if (this.writerActive) {
      return;
    }

    // A queued writer goes first as soon as the last reader leaves; new readers
    // may still overtake it while other readers are active.
    if (this.activeReaderCount === 0 && this.writeQueue.length > 0) {
      this.writerActive = true;
      this.writeQueue.shift()!.resolve();
      return;
    }

    while (this.readQueue.length > 0 && this.activeReaderCount < this.maxReadersCount) {
      this.activeReaderCount++;
      this.readQueue.shift()!.resolve();
    }
  }
}
