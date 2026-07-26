import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CancelledLockingError,
  LockConfigMismatchError,
  LockingError,
  LockNotFoundError,
  TimeoutLockingError
} from "../src";

describe("Errors", () => {
  it("should fall back to a default message when none is given", () => {
    assert.strictEqual(new TimeoutLockingError().message, "Timeout acquiring lock");
    assert.strictEqual(new CancelledLockingError().message, "Lock was cancelled");
    assert.strictEqual(new LockNotFoundError().message, "Lock does not exist");
    assert.strictEqual(new LockConfigMismatchError().message, "Lock already exists with a different configuration");
  });

  it("should keep an explicit message", () => {
    assert.strictEqual(new TimeoutLockingError("Timeout acquiring semaphore").message, "Timeout acquiring semaphore");
    assert.strictEqual(new CancelledLockingError("Mutex cancelled").message, "Mutex cancelled");
  });

  it("should expose name, cause and the LockingError base type", () => {
    const cause = new Error("underlying");

    for (const error of [
      new TimeoutLockingError("a", cause),
      new CancelledLockingError("b", cause),
      new LockNotFoundError("c", cause),
      new LockConfigMismatchError("d", cause)
    ]) {
      assert.ok(error instanceof LockingError, `${error.name} should extend LockingError`);
      assert.ok(error instanceof Error);
      assert.strictEqual(error.name, error.constructor.name);
      assert.strictEqual(error.cause, cause);
      assert.ok(error.stack?.includes(error.name));
    }
  });
});
