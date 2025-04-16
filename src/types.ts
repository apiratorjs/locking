export interface IDeferred {
  resolve: (...args: any[]) => void;
  reject: (error: Error) => void;
}

export type AcquireParams = {
  /**
   * Maximum time to wait for acquisition in milliseconds
   * If not specified, default timeout will be used
   */
  timeoutMs?: number;
};

// Branded type for Semaphore tokens to prevent mixing with Mutex tokens
export type SemaphoreToken = string & { readonly __brand: unique symbol };

// Branded type for Mutex tokens to prevent mixing with Semaphore tokens
export type MutexToken = string & { readonly __brand: unique symbol };

// Branded types for read-write locks
export type ReadLockToken = string & { readonly __brand: unique symbol };
export type WriteLockToken = string & { readonly __brand: unique symbol };

export type RWLockToken = ReadLockToken | WriteLockToken;

// Generic token type for code that works with both semaphores and mutexes
export type AcquireToken = SemaphoreToken | MutexToken | ReadLockToken | WriteLockToken;

export type ExclusiveCallback<T> = () => Promise<T> | T;

export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  /**
   * Acquire the semaphore
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the semaphore
   */
  acquire(params?: AcquireParams): Promise<IReleaser<SemaphoreToken>>;

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
  runExclusive<T>(fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  runExclusive<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;

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
  acquire(params?: AcquireParams): Promise<IReleaser<MutexToken>>;

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
  runExclusive<T>(fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  runExclusive<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;

    /**
   * Wait for the mutex to be unlocked
   */
  waitForUnlock(): Promise<void>;
}

export interface IReleaser<T extends AcquireToken = AcquireToken> {
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

  acquire(params?: AcquireParams): Promise<IReleaser<SemaphoreToken>>;
}

export interface IDistributedMutex extends Omit<IMutex, "acquire"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: AcquireParams): Promise<IReleaser<MutexToken>>;
}

export type DistributedSemaphoreConstructorProps = {
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

export type DistributedMutexConstructorProps = {
  /**
   * Unique name for this distributed mutex
   * Used to identify the mutex across processes
   */
  name: string;
};

export type DistributedSemaphoreFactory = (props: DistributedSemaphoreConstructorProps) => IDistributedSemaphore;

export type DistributedMutexFactory = (props: DistributedMutexConstructorProps) => IDistributedMutex;

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
  acquireRead(params?: AcquireParams): Promise<IReleaser<ReadLockToken>>;

  /**
   * Acquire a write lock. Only one writer can hold the lock, and no readers can hold it concurrently.
   * @param params Optional acquisition parameters
   * @returns A releaser that can be used to release the write lock
   */
  acquireWrite(params?: AcquireParams): Promise<IReleaser<WriteLockToken>>;

  /**
   * Cancel all pending acquisitions
   * @param errMessage Optional error message for cancelled acquisitions
   */
  cancelAll(errMessage?: string): Promise<void>;

  /**
   * Run a callback with shared read access
   * @param fn The callback to run
   */
  withReadLock<T>(fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with shared read access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  withReadLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive write access
   * @param fn The callback to run
   */
  withWriteLock<T>(fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Run a callback with exclusive write access
   * @param params Acquisition parameters
   * @param fn The callback to run
   */
  withWriteLock<T>(params: AcquireParams, fn: ExclusiveCallback<T>): Promise<T>;

  /**
   * Check if write access is currently locked
   */
  isWriteLocked(): Promise<boolean>;

  /**
   * Check if read access is currently locked
   */
  isReadLocked(): Promise<boolean>;

  /**
   * Get the current number of active read locks
   */
  activeReaders(): Promise<number>;
}

export interface IDistributedRWLock extends IReadWriteLock {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;
}

export type RWLockConstructorProps = {
  /**
   * Maximum number of concurrent readers allowed
   * Must be greater than 0
   * Default: 100
   */
  maxReaders?: number;
};

export type DistributedRWLockConstructorProps = {
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

export type DistributedRWLockFactory = (props: DistributedRWLockConstructorProps) => IDistributedRWLock;

