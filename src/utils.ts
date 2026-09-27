import assert from "node:assert";
import { TimeoutLockingError } from "./errors";
import { MAX_TIMER_DELAY_IN_MS } from "./constants";

/**
 * Detaches a timer from the event loop when the runtime supports it (Node), so a
 * pending acquisition timeout does not keep the process alive by itself. Browsers
 * and other runtimes return a plain number from setTimeout - nothing to do there.
 */
export function unrefTimer(timer: unknown): void {
  if (
    !isNil(timer) &&
    typeof timer === "object" &&
    typeof (timer as { unref?: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}

/**
 * Counterpart of unrefTimer(): makes a detached timer hold the event loop again.
 */
export function refTimer(timer: unknown): void {
  if (
    !isNil(timer) &&
    typeof timer === "object" &&
    typeof (timer as { ref?: unknown }).ref === "function"
  ) {
    (timer as { ref: () => void }).ref();
  }
}

/**
 * Turns a timed out acquisition into null - the "try" flavour of acquire. Any
 * other failure (cancellation, a destroyed lock, ...) is not "the lock is busy"
 * and keeps propagating.
 */
export async function nullOnTimeout<T>(
  acquisition: Promise<T>,
): Promise<T | null> {
  try {
    return await acquisition;
  } catch (err) {
    if (err instanceof TimeoutLockingError) {
      return null;
    }

    throw err;
  }
}

export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * A TTL is backed by a setTimeout, which fires right away for delays above
 * MAX_TIMER_DELAY_IN_MS - so larger finite values are rejected rather than
 * silently expiring at once. Infinity is fine: it means "no TTL" and needs no
 * timer.
 */
export function assertTtl(ttlMs: number): void {
  assert.ok(
    ttlMs === Infinity || (ttlMs > 0 && ttlMs <= MAX_TIMER_DELAY_IN_MS),
    `ttlMs must be Infinity, or greater than 0 and at most ${MAX_TIMER_DELAY_IN_MS}`
  );
}
