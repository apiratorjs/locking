export interface IDeferred {
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

  acquire(params?: AcquireParams): Promise<IReleaser>;

  cancelAll(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;

  runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>;
}

export interface IMutex {
  acquire(params?: AcquireParams): Promise<IReleaser>;

  cancel(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T>;

  runExclusive<T>(params: AcquireParams, fn: () => Promise<T> | T): Promise<T>;
}

export interface IReleaser {
  release(): Promise<void>;

  getToken(): AcquireToken;
}

export type AcquireToken = string;

export interface IDistributedSemaphore extends Omit<ISemaphore, "acquire"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: AcquireParams): Promise<IReleaser>;
}

export interface IDistributedMutex extends Omit<IMutex, "acquire"> {
  name: string;

  implementation: string;

  destroy(): Promise<void>;

  isDestroyed: boolean;

  acquire(params?: AcquireParams): Promise<IReleaser>;
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

