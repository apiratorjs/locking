export type Deferred = {
  resolve: (...args: any[]) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout | null;
}

export type AcquireParams = {
  timeoutMs?: number;
};

export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  acquire(params?: AcquireParams): Promise<void>;

  release(): Promise<void>;

  cancelAll(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;

  runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>;
}

export interface IMutex {
  acquire(params?: AcquireParams): Promise<void>;

  release(): Promise<void>;

  cancel(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;

  runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>;
}

export type AcquiredDistributedToken = string;

export interface IDistributedSemaphore extends Omit<ISemaphore, "acquire" | "release"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: AcquireParams): Promise<AcquiredDistributedToken>;

  release(token?: AcquiredDistributedToken): Promise<void>;
}

export interface IDistributedMutex extends Omit<IMutex, "acquire" | "release"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: AcquireParams): Promise<AcquiredDistributedToken>;

  release(token?: AcquiredDistributedToken): Promise<void>;
}

export type DistributedSemaphoreConstructorProps = {
  maxCount: number;
  name: string;
};

export type DistributedMutexConstructorProps = {
  name: string;
};

export type DistributedSemaphoreFactory = (props: DistributedSemaphoreConstructorProps) => IDistributedSemaphore;

export type DistributedMutexFactory = (props: DistributedMutexConstructorProps) => IDistributedMutex;

