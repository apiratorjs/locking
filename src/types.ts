export interface IDeferred {
  resolve: (...args: any[]) => void;
  reject: (error: Error) => void;
}

export type TAcquireParams = {
  /**
   * Maximum time to wait for acquisition in milliseconds.
   * If not specified, default timeout will be used.
   * Pass 0 to fail fast with a TimeoutLockingError when the lock is not
   * immediately available.
   */
  timeoutMs?: number;
};

// Branded type for Semaphore tokens to prevent mixing with Mutex tokens
export type TSemaphoreToken = string & { readonly __brand: unique symbol };

// Branded type for Mutex tokens to prevent mixing with Semaphore tokens
export type TMutexToken = string & { readonly __brand: unique symbol };

// Branded types for read-write locks
export type TReadLockToken = string & { readonly __brand: unique symbol };
export type TWriteLockToken = string & { readonly __brand: unique symbol };

// Generic token type for code that works with both semaphores and mutexes
export type TAcquireToken = TSemaphoreToken | TMutexToken | TReadLockToken | TWriteLockToken;

export type TExclusiveCallback<T> = () => Promise<T> | T;

export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  /**
   * Acquire the semaphore
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the semaphore
   */
  acquire(params?: TAcquireParams): Promise<IReleaser<TSemaphoreToken>>;

  /**
   * Try to acquire the semaphore without throwing on timeout
   * @param params Optional acquisition parameters. Unlike acquire(), timeoutMs
   * defaults to 0: return right away when no permit is free.
   * @returns A releaser, or null if no permit could be acquired within timeoutMs.
   * Cancellation and other failures still throw.
   */
  tryAcquire(params?: TAcquireParams): Promise<IReleaser<TSemaphoreToken> | null>;

  /**
   * Cancel all pending acquisitions
   * @param errMessage Optional error message for cancelled acquisitions
   */
  cancelAll(errMessage?: string): Promise<void>;

  /**
   * Check if all permits are currently acquired
   */
  isLocked(): Promise<boolean>;

  /**
   * Run a callback with exclusive access
   * @param fn The callback to run
   */
  runExclusive<T>(fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  runExclusive<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Wait for any semaphore slot to be unlocked
   */
  waitForAnyUnlock(): Promise<void>;

  /**
   * Wait for the semaphore to be fully unlocked
   */
  waitForFullyUnlock(): Promise<void>;
}

export interface IMutex {
  /**
   * Acquire the mutex
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the mutex
   */
  acquire(params?: TAcquireParams): Promise<IReleaser<TMutexToken>>;

  /**
   * Try to acquire the mutex without throwing on timeout
   * @param params Optional acquisition parameters. Unlike acquire(), timeoutMs
   * defaults to 0: return right away when the mutex is locked.
   * @returns A releaser, or null if the mutex could not be acquired within
   * timeoutMs. Cancellation and other failures still throw.
   */
  tryAcquire(params?: TAcquireParams): Promise<IReleaser<TMutexToken> | null>;

  /**
   * Cancel any pending acquisitions
   * @param errMessage Optional error message for cancelled acquisitions
   */
  cancel(errMessage?: string): Promise<void>;

  /**
   * Check if the mutex is currently locked
   */
  isLocked(): Promise<boolean>;

  /**
   * Run a callback with exclusive access
   * @param fn The callback to run
   */
  runExclusive<T>(fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  runExclusive<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;

    /**
   * Wait for the mutex to be unlocked
   */
  waitForUnlock(): Promise<void>;
}

export interface IReleaser<T extends TAcquireToken = TAcquireToken> {
  /**
   * Release the acquired resource
   */
  release(): Promise<void>;

  /**
   * Get the token for this acquisition
   */
  getToken(): T;
}

export interface IDistributedSemaphore extends Omit<ISemaphore, "acquire"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: TAcquireParams): Promise<IReleaser<TSemaphoreToken>>;
}

export interface IDistributedMutex extends Omit<IMutex, "acquire"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: TAcquireParams): Promise<IReleaser<TMutexToken>>;
}

export type TDistributedSemaphoreConstructorProps = {
  /**
   * Maximum number of concurrent acquisitions allowed
   * Must be greater than 0
   */
  maxCount: number;

  /**
   * Unique name for this distributed semaphore
   * Used to identify the semaphore across processes
   */
  name: string;
};

export type TDistributedMutexConstructorProps = {
  /**
   * Unique name for this distributed mutex
   * Used to identify the mutex across processes
   */
  name: string;
};

/**
 * Interface for a read-write lock
 * Allows multiple concurrent readers but only one writer
 */
export interface IReadWriteLock {
  /**
   * Get the maximum number of concurrent readers allowed
   */
  maxReaders(): Promise<number>;

  /**
   * Get the current number of active read locks
   */
  activeReaders(): Promise<number>;

  /**
   * Acquire a read lock. Multiple readers can hold the lock concurrently.
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the read lock
   */
  acquireRead(params?: TAcquireParams): Promise<IReleaser<TReadLockToken>>;

  /**
   * Acquire a write lock. Only one writer can hold the lock, and no readers can hold it concurrently.
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the write lock
   */
  acquireWrite(params?: TAcquireParams): Promise<IReleaser<TWriteLockToken>>;

  /**
   * Try to acquire a read lock without throwing on timeout
   * @param params Optional acquisition parameters. Unlike acquireRead(), timeoutMs
   * defaults to 0: return right away when a read lock is not available.
   * @returns A releaser, or null if the read lock could not be acquired within
   * timeoutMs. Cancellation and other failures still throw.
   */
  tryAcquireRead(params?: TAcquireParams): Promise<IReleaser<TReadLockToken> | null>;

  /**
   * Try to acquire a write lock without throwing on timeout
   * @param params Optional acquisition parameters. Unlike acquireWrite(), timeoutMs
   * defaults to 0: return right away when the write lock is not available.
   * @returns A releaser, or null if the write lock could not be acquired within
   * timeoutMs. Cancellation and other failures still throw.
   */
  tryAcquireWrite(params?: TAcquireParams): Promise<IReleaser<TWriteLockToken> | null>;

  /**
   * Cancel all pending acquisitions
   * @param errMessage Optional error message for cancelled acquisitions
   */
  cancelAll(errMessage?: string): Promise<void>;

  /**
   * Run a callback with shared read access
   * @param fn The callback to run
   */
  withReadLock<T>(fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with shared read access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  withReadLock<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive write access
   * @param fn The callback to run
   */
  withWriteLock<T>(fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive write access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  withWriteLock<T>(params: TAcquireParams, fn: TExclusiveCallback<T>): Promise<T>;

  /**
   * Check if write access is currently locked
   */
  isWriteLocked(): Promise<boolean>;

  /**
   * Check if read access is currently locked
   */
  isReadLocked(): Promise<boolean>;
}

export interface IDistributedRWLock extends IReadWriteLock {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;
}

export type TRWLockConstructorProps = {
  /**
   * Maximum number of concurrent readers allowed
   * Must be greater than 0
   * Default: 100
   */
  maxReaders?: number;
};

export type TDistributedRWLockConstructorProps = {
  /**
   * Unique name for this distributed read-write lock
   * Used to identify the lock across processes
   */
  name: string;

    /**
   * Maximum number of concurrent readers allowed
   * Must be greater than 0
   * Default: 100
   */
  maxReaders?: number;
};

export enum ELockDisplayType {
  Mutex = "mutex",
  Semaphore = "semaphore",
  RWLock = "rwlock"
}

/**
 * Owns a set of named distributed locks: hands out the same instance for the
 * same name while that lock is alive, answers whether a name is registered, and
 * knows what it handed out so an application can list, cancel, or tear down
 * everything on shutdown.
 *
 * Backend packages (Redis, Postgres, ...) implement this interface; the in-memory
 * manager in this package is the process-local default.
 */
export interface IDistributedLockManager {
  /**
   * Returns the mutex registered under this name, creating it on first use.
   */
  mutex(name: string): IDistributedMutex;

  /**
   * Returns the semaphore registered under this name, creating it on first use.
   *
   * @throws LockConfigMismatchError if the name is already registered with a
   * different maxCount.
   */
  semaphore(name: string, maxCount: number): IDistributedSemaphore;

  /**
   * Returns the read-write lock registered under this name, creating it on first
   * use. Omitting maxReaders means "whatever the registered lock uses".
   *
   * @throws LockConfigMismatchError if maxReaders is given and differs from the
   * value the lock was registered with.
   */
  readWriteLock(name: string, maxReaders?: number): IDistributedRWLock;

  /**
   * Whether a live mutex is registered under this name.
   */
  hasMutex(name: string): boolean;

  /**
   * Whether a live semaphore is registered under this name.
   */
  hasSemaphore(name: string): boolean;

  /**
   * Whether a live read-write lock is registered under this name.
   */
  hasRWLock(name: string): boolean;

  /**
   * Every lock this manager currently holds. Locks destroyed in the meantime are
   * dropped rather than reported.
   */
  list(): TDistributedLockInfo[];

  /**
   * How many live locks this manager holds, optionally of one kind only.
   */
  count(kind?: ELockDisplayType): number;

  /**
   * Same as list(), plus the current state of every lock.
   */
  snapshot(): Promise<TDistributedLockSnapshot[]>;

  /**
   * Cancels everything waiting on every registered lock. Held locks stay held.
   */
  cancelAll(errMessage?: string): Promise<void>;

  /**
   * Destroys every registered lock and empties the manager.
   */
  destroyAll(errMessage?: string): Promise<void>;
}

/**
 * Cheap synchronous description of a registered lock.
 */
export type TDistributedLockInfo = {
  kind: ELockDisplayType;

  /**
   * The name the lock was registered under in the manager - not the (possibly
   * prefixed) name the implementation uses internally.
   */
  name: string;

  implementation: string;

  isDestroyed: boolean;

  /**
   * Semaphores only.
   */
  maxCount?: number;

  /**
   * Read-write locks only, and only when it was requested explicitly.
   */
  maxReaders?: number;
};

/**
 * Lock description together with its current state. Fields that do not apply to
 * the lock kind - or that could not be read because the lock was destroyed
 * concurrently - are left out.
 */
export type TDistributedLockSnapshot = TDistributedLockInfo & {
  isLocked?: boolean;

  freeCount?: number;

  isWriteLocked?: boolean;

  isReadLocked?: boolean;

  activeReaders?: number;
};

export type TManagedLock =
  | { kind: ELockDisplayType.Mutex; name: string; lock: IDistributedMutex; }
  | { kind: ELockDisplayType.Semaphore; name: string; lock: IDistributedSemaphore; maxCount: number; }
  | { kind: ELockDisplayType.RWLock; name: string; lock: IDistributedRWLock; maxReaders?: number; };

