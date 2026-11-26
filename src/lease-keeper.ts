import assert from "node:assert";
import { LeaseLostLockingError } from "./errors";
import { ILeaseReleaser, TAcquireToken, TLeaseKeeperCallback, TLeaseKeeperOptions } from "./types";
import { assertTtl, unrefTimer } from "./utils";

/**
 * Keeps a lease (a semaphore permit or a mutex lock with a TTL) alive while
 * work of unknown length runs: extends it on a timer, reports a lost lease
 * through an AbortSignal and releases it when the work is done.
 */
export class LeaseKeeper {
  private readonly abortController = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  private isExtending = false;

  private constructor(
    private readonly releaser: ILeaseReleaser<TAcquireToken>,
    private readonly options: TLeaseKeeperOptions,
  ) {
    this.timer = setInterval(() => this.extend(), this.options.extendIntervalMs);
    // The work keeps the process alive; the heartbeat alone must not
    unrefTimer(this.timer);
  }

  private async extend(): Promise<void> {
    // A slow extension must not overlap with the next tick
    if (this.isExtending || this.abortController.signal.aborted) {
      return;
    }

    this.isExtending = true;
    try {
      const isExtended = await this.releaser.extend(this.options.ttlMs);
      if (!isExtended) {
        this.markLost();
      }
    } catch (err) {
      this.markLost(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isExtending = false;
    }
  }

  private markLost(cause?: Error): void {
    clearInterval(this.timer);
    this.abortController.abort(new LeaseLostLockingError(undefined, cause));
  }

  private throwIfLost(): void {
    if (this.abortController.signal.aborted) {
      throw this.abortController.signal.reason;
    }
  }

  private async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.releaser.release();
  }

  /**
   * Runs work while keeping the acquired lease alive, then releases it - also
   * when the work throws. The work is not interrupted when the lease is lost:
   * it gets the signal and decides itself (stop a loop, throw before a write).
   */
  public static async hold<T>(
    releaser: ILeaseReleaser<TAcquireToken>,
    options: TLeaseKeeperOptions,
    work: TLeaseKeeperCallback<T>,
  ): Promise<T> {
    assertTtl(options.ttlMs);
    assert.ok(
      options.extendIntervalMs > 0 && options.extendIntervalMs < options.ttlMs,
      "extendIntervalMs must be greater than 0 and smaller than ttlMs",
    );

    const keeper = new LeaseKeeper(releaser, options);

    try {
      return await work({
        signal: keeper.abortController.signal,
        throwIfLost: () => keeper.throwIfLost(),
      });
    } finally {
      await keeper.stop();
    }
  }
}
