export type Deferred = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout | null;
}

export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  acquire(params?: { timeoutInMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancelAll(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;
}

export interface IMutex {
  acquire(params?: { timeoutInMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancel(errMessage?: string): Promise<void>;

  isLocked(): Promise<boolean>;
}

export interface IDistributedSemaphore extends ISemaphore {
  name: string;

  getProvider(): any;
}

export interface IDistributedMutex extends IMutex {
  name: string;

  getProvider(): any;
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

