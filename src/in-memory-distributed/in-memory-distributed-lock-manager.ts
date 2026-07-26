import assert from "node:assert";
import {
  TDistributedLockInfo,
  ELockDisplayType,
  TDistributedLockSnapshot,
  IDistributedMutex,
  IDistributedRWLock,
  IDistributedSemaphore,
  IDistributedLockManager,
  TManagedLock,
} from "../types";
import { LockConfigMismatchError, LockNotFoundError } from "../errors";
import { InMemoryDistributedMutex } from "./in-memory-distributed-mutex";
import { InMemoryDistributedSemaphore } from "./in-memory-distributed-semaphore";
import { InMemoryDistributedReadWriteLock } from "./in-memory-distributed-read-write-lock";

/**
 * Process-local implementation of IDistributedLockManager.
 *
 * Owns a set of named distributed locks: hands out the same instance for the same
 * name while that lock is alive, and knows what it handed out - so an application
 * can ask whether a name is registered, list its locks, cancel everything that
 * waits on them, or tear them all down on shutdown.
 *
 * A manager is an ordinary object, not a global: create one and inject it. Backend
 * packages (Redis, Postgres, ...) implement IDistributedLockManager themselves
 * rather than plugging into this class.
 *
 * ```ts
 * const locks = new InMemoryDistributedLockManager();
 * await locks.mutex("orders").runExclusive(() => shipOrder());
 *
 * process.on("SIGTERM", () => locks.destroyAll("Shutting down"));
 * ```
 */
export class InMemoryDistributedLockManager implements IDistributedLockManager {
  private readonly managedLocks: Map<string, TManagedLock> = new Map();

  /**
   * Returns the mutex registered under this name, creating it on first use.
   */
  public mutex(name: string): IDistributedMutex {
    assert.ok(name, "InMemoryDistributedLockManager requires a non-empty lock name.");

    const existing = this.takeAlive(ELockDisplayType.Mutex, name);
    if (existing?.kind === ELockDisplayType.Mutex) {
      return existing.lock;
    }

    const lock = new InMemoryDistributedMutex({ name });
    this.managedLocks.set(this.keyOf(ELockDisplayType.Mutex, name), {
      kind: ELockDisplayType.Mutex,
      name,
      lock,
    });

    return lock;
  }

  /**
   * Returns the semaphore registered under this name, creating it on first use.
   *
   * @throws LockConfigMismatchError if the name is already registered with a
   * different maxCount - the existing semaphore keeps its capacity, so returning
   * it would hand out a semaphore that does not behave as asked.
   */
  public semaphore(name: string, maxCount: number): IDistributedSemaphore {
    assert.ok(name, "InMemoryDistributedLockManager requires a non-empty lock name.");
    assert.ok(maxCount > 0, "maxCount must be greater than 0");

    const existing = this.takeAlive(ELockDisplayType.Semaphore, name);
    if (existing?.kind === ELockDisplayType.Semaphore) {
      if (existing.maxCount !== maxCount) {
        throw new LockConfigMismatchError(
          `${ELockDisplayType.Semaphore} '${name}' is already registered with maxCount ${existing.maxCount}, requested ${maxCount}`,
        );
      }

      return existing.lock;
    }

    const lock = new InMemoryDistributedSemaphore({ name, maxCount });
    this.managedLocks.set(this.keyOf(ELockDisplayType.Semaphore, name), {
      kind: ELockDisplayType.Semaphore,
      name,
      lock,
      maxCount,
    });

    return lock;
  }

  /**
   * Returns the read-write lock registered under this name, creating it on first
   * use. Omitting maxReaders means "whatever the registered lock uses".
   *
   * @throws LockConfigMismatchError if maxReaders is given and differs from the
   * value the lock was registered with.
   */
  public readWriteLock(name: string, maxReaders?: number): IDistributedRWLock {
    assert.ok(name, "InMemoryDistributedLockManager requires a non-empty lock name.");
    assert.ok(
      maxReaders === undefined || maxReaders > 0,
      "maxReaders must be greater than 0",
    );

    const existing = this.takeAlive(ELockDisplayType.RWLock, name);
    if (existing?.kind === ELockDisplayType.RWLock) {
      if (
        maxReaders !== undefined &&
        existing.maxReaders !== undefined &&
        existing.maxReaders !== maxReaders
      ) {
        throw new LockConfigMismatchError(
          `${ELockDisplayType.RWLock} '${name}' is already registered with maxReaders ${existing.maxReaders}, requested ${maxReaders}`,
        );
      }

      return existing.lock;
    }

    const lock = new InMemoryDistributedReadWriteLock({ name, maxReaders });
    this.managedLocks.set(this.keyOf(ELockDisplayType.RWLock, name), {
      kind: ELockDisplayType.RWLock,
      name,
      lock,
      maxReaders,
    });

    return lock;
  }

  /**
   * Whether a live mutex is registered under this name.
   */
  public hasMutex(name: string): boolean {
    return this.takeAlive(ELockDisplayType.Mutex, name) !== undefined;
  }

  /**
   * Whether a live semaphore is registered under this name.
   */
  public hasSemaphore(name: string): boolean {
    return this.takeAlive(ELockDisplayType.Semaphore, name) !== undefined;
  }

  /**
   * Whether a live read-write lock is registered under this name.
   */
  public hasRWLock(name: string): boolean {
    return this.takeAlive(ELockDisplayType.RWLock, name) !== undefined;
  }

  /**
   * Every lock this manager currently holds. Locks destroyed in the meantime are
   * dropped rather than reported.
   */
  public list(): TDistributedLockInfo[] {
    this.dropDestroyed();

    return [...this.managedLocks.values()].map((managed) =>
      this.describe(managed),
    );
  }

  /**
   * How many live locks this manager holds, optionally of one kind only.
   */
  public count(kind?: ELockDisplayType): number {
    this.dropDestroyed();

    if (kind === undefined) {
      return this.managedLocks.size;
    }

    let total = 0;
    for (const managed of this.managedLocks.values()) {
      if (managed.kind === kind) {
        total++;
      }
    }

    return total;
  }

  /**
   * Same as list(), plus the current state of every lock. Reading state goes
   * through the lock implementation, so this one is asynchronous.
   */
  public async snapshot(): Promise<TDistributedLockSnapshot[]> {
    this.dropDestroyed();

    return Promise.all(
      [...this.managedLocks.values()].map(async (managed) => {
        const info = this.describe(managed);

        try {
          if (managed.kind === ELockDisplayType.Mutex) {
            return { ...info, isLocked: await managed.lock.isLocked() };
          }

          if (managed.kind === ELockDisplayType.Semaphore) {
            return {
              ...info,
              isLocked: await managed.lock.isLocked(),
              freeCount: await managed.lock.freeCount(),
            };
          }

          return {
            ...info,
            isWriteLocked: await managed.lock.isWriteLocked(),
            isReadLocked: await managed.lock.isReadLocked(),
            activeReaders: await managed.lock.activeReaders(),
          };
        } catch (error) {
          if (error instanceof LockNotFoundError) {
            // Destroyed while we were reading it - report what we already know.
            return info;
          }

          throw error;
        }
      }),
    );
  }

  /**
   * Cancels everything waiting on every registered lock. The locks stay
   * registered and usable, and locks that are currently held stay held - their
   * owners are still inside their critical sections.
   */
  public async cancelAll(errMessage?: string): Promise<void> {
    this.dropDestroyed();

    const results = await Promise.allSettled(
      [...this.managedLocks.values()].map((managed) =>
        this.cancelOne(managed, errMessage),
      ),
    );

    this.throwIfAnyFailed(results, "Failed to cancel some locks");
  }

  /**
   * Destroys every registered lock and empties the manager. Pending acquisitions
   * are rejected, handles report isDestroyed, and the next call to mutex() /
   * semaphore() / readWriteLock() starts a fresh lock.
   */
  public async destroyAll(errMessage?: string): Promise<void> {
    const managedLocks = [...this.managedLocks.values()];
    this.managedLocks.clear();

    const results = await Promise.allSettled(
      managedLocks.map(async (managed) => {
        if (managed.lock.isDestroyed) {
          return;
        }

        // destroy() takes no message, so give the waiters the caller's message
        // first and tear the lock down afterwards.
        if (errMessage !== undefined) {
          await this.cancelOne(managed, errMessage);
        }

        await managed.lock.destroy();
      }),
    );

    this.throwIfAnyFailed(results, "Failed to destroy some locks");
  }

  private cancelOne(managed: TManagedLock, errMessage?: string): Promise<void> {
    return managed.kind === ELockDisplayType.Mutex
      ? managed.lock.cancel(errMessage)
      : managed.lock.cancelAll(errMessage);
  }

  private describe(managed: TManagedLock): TDistributedLockInfo {
    const info: TDistributedLockInfo = {
      kind: managed.kind,
      name: managed.name,
      implementation: managed.lock.implementation,
      isDestroyed: managed.lock.isDestroyed,
    };

    if (managed.kind === ELockDisplayType.Semaphore) {
      info.maxCount = managed.maxCount;
    }

    if (managed.kind === ELockDisplayType.RWLock && managed.maxReaders !== undefined) {
      info.maxReaders = managed.maxReaders;
    }

    return info;
  }

  private keyOf(kind: ELockDisplayType, name: string): string {
    return `${kind}:${name}`;
  }

  /**
   * A lock destroyed behind the manager's back - through its own destroy() - must
   * not be handed out again, so it is forgotten on the way.
   */
  private takeAlive(kind: ELockDisplayType, name: string): TManagedLock | undefined {
    const key = this.keyOf(kind, name);
    const managed = this.managedLocks.get(key);

    if (!managed) {
      return undefined;
    }

    if (managed.lock.isDestroyed) {
      this.managedLocks.delete(key);
      return undefined;
    }

    return managed;
  }

  private dropDestroyed(): void {
    for (const [key, managed] of this.managedLocks) {
      if (managed.lock.isDestroyed) {
        this.managedLocks.delete(key);
      }
    }
  }

  private throwIfAnyFailed(
    results: PromiseSettledResult<unknown>[],
    message: string,
  ): void {
    const errors = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason)
      // A lock that turned out to be gone is not a failure of a bulk operation.
      .filter((reason) => !(reason instanceof LockNotFoundError));

    if (errors.length > 0) {
      throw new AggregateError(errors, message);
    }
  }
}
