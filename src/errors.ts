export class LockingError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}

export class TimeoutLockingError extends LockingError {
  constructor(message: string, cause?: Error) {
    super(message ?? "Timeout acquiring lock", cause);
    this.name = this.constructor.name;
  }
}

export class CancelledLockingError extends LockingError {
  constructor(message: string, cause?: Error) {
    super(message ?? "Lock was cancelled", cause);
    this.name = this.constructor.name;
  }
}

export class LockNotFoundError extends LockingError {
  constructor(message: string, cause?: Error) {
    super(message ?? "Lock does not exist", cause);
    this.name = this.constructor.name;
  }
}