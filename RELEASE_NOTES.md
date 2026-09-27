# Release notes — @apiratorjs/locking 8.0.0

Mutexes catch up with semaphores: a mutex lock can be handed over by its token and can expire. This is a major release because the mutex interfaces gained new required members. Code that only uses the mutexes shipped with this package upgrades without changes.

## Breaking change

`IMutex` and `IDistributedMutex` now require `restoreReleaser(token)`, and their `acquire()` / `tryAcquire()` return `IMutexReleaser` - an `IReleaser` with `extend()`, `remainingTtl()` and `isHeld()`. Custom backends and hand-written implementations or test doubles must add them.

## Highlights

- **`ttlMs`** when acquiring a mutex, counted from the moment the lock is granted. `Infinity` means no TTL.
- **`restoreReleaser(token)`**, **`extend(ttlMs)`**, **`remainingTtl()`**, **`isHeld()`** - the same as for semaphore permits since 7.0.0.
- **`ILeaseReleaser<T>`**, the common base of `ISemaphoreReleaser` and `IMutexReleaser`.

## At a glance

```typescript
const mutex = locks.mutex("nightly-report");

const releaser = await mutex.tryAcquire({ ttlMs: 30 * 60_000 });
if (!releaser) {
  return; // already running
}
await queue.add("report", { lockToken: releaser.getToken() });

// Worker
const lock = locks.mutex("nightly-report").restoreReleaser(job.data.lockToken);
try {
  // ...
} finally {
  await lock.release();
}
```

Full details and the migration checklist for backend authors: [CHANGELOG.md](./CHANGELOG.md).
