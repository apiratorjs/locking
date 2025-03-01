export interface ISemaphore {
  maxCount: number;

  freeCount(): Promise<number>;

  acquire(params?: { timeoutInMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancelAll(): Promise<void>;

  isLocked(): Promise<boolean>;
}

export interface IMutex {
  acquire(params?: { timeoutInMs?: number; }): Promise<void>;

  release(): Promise<void>;

  cancel(): Promise<void>;

  isLocked(): Promise<boolean>;
}

