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
