export interface IDeferred {
  resolve: (...args: any[]) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout | null;
}

export type AcquireParams = {
  /**
   * Maximum time to wait for acquisition in milliseconds
   * If not specified, default timeout will be used
   */
  timeoutMs?: number;
};

export type SemaphoreToken = string & { readonly __brand: unique symbol };

export type MutexToken = string & { readonly __brand: unique symbol };

export type AcquireToken = SemaphoreToken | MutexToken;

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

