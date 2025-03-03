export type Deferred = {
  resolve: () => void;
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

export interface IDistributedSemaphore extends ISemaphore {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;
}

export interface IDistributedMutex extends IMutex {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;
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

