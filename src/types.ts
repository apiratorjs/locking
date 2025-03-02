export type Deferred = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout | null;
}

export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  acquire(params?: { timeoutMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancelAll(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;
}

export interface IMutex {
  acquire(params?: { timeoutMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancel(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;
}

export interface IDistributedSemaphore extends ISemaphore {
  name: string;

  implementation: string;

  destroy(): Promise<void>;
}

export interface IDistributedMutex extends IMutex {
  name: string;

  implementation: string;

  destroy(): Promise<void>;
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

