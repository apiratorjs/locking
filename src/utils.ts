import { TimeoutLockingError } from "./errors";

/**
 * Detaches a timer from the event loop when the runtime supports it (Node), so a
 * pending acquisition timeout does not keep the process alive by itself. Browsers
 * and other runtimes return a plain number from setTimeout - nothing to do there.
 */
export function unrefTimer(timer: unknown): void {
  if (timer && typeof timer === "object" && typeof (timer as { unref?: unknown }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}

/**
 * Turns a timed out acquisition into null - the "try" flavour of acquire. Any
 * other failure (cancellation, a destroyed lock, ...) is not "the lock is busy"
 * and keeps propagating.
 */
export async function nullOnTimeout<T>(acquisition: Promise<T>): Promise<T | null> {
  try {
    return await acquisition;
  } catch (err) {
    if (err instanceof TimeoutLockingError) {
      return null;
    }

    throw err;
  }
}
