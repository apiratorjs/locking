export class LockingError extends Error {
  public readonly cause?: Error;

  public constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class TimeoutLockingError extends LockingError {
  public constructor(message: string = "Timeout acquiring lock", cause?: Error) {
    super(message, cause);
    this.name = this.constructor.name;
  }
}

export class CancelledLockingError extends LockingError {
  public constructor(message: string = "Lock was cancelled", cause?: Error) {
    super(message, cause);
    this.name = this.constructor.name;
  }
}

export class LockNotFoundError extends LockingError {
  public constructor(message: string = "Lock does not exist", cause?: Error) {
    super(message, cause);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a distributed lock is requested under a name that already exists
 * with a different configuration - the existing lock keeps its settings, so
 * silently accepting the new ones would hand out a lock that does not behave as
 * the caller asked.
 */
export class LockConfigMismatchError extends LockingError {
  public constructor(message: string = "Lock already exists with a different configuration", cause?: Error) {
    super(message, cause);
    this.name = this.constructor.name;
  }
}
