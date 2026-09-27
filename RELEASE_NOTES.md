# Release notes — @apiratorjs/locking 6.0.0

Adds non-throwing "try" acquisition to every locking primitive. This is a major release because the lock interfaces gained new required methods. Code that only uses the locks shipped with this package upgrades without changes.

## Breaking change

`IMutex`, `ISemaphore`, and `IReadWriteLock` (and their `IDistributed*` counterparts) now require `tryAcquire()` / `tryAcquireRead()` / `tryAcquireWrite()`. Custom backends such as Redis or Postgres, and hand-written implementations or test doubles of these interfaces, must add them. The `timeoutMs: 0` path should be a single atomic operation on the backend store.

## Highlights

- **`tryAcquire()`** on `Mutex` and `Semaphore`, and **`tryAcquireRead()` / `tryAcquireWrite()`** on `ReadWriteLock`. The distributed locks from `InMemoryDistributedLockManager` get them too.
- They resolve to a **releaser**, or to **`null`** if the lock is busy, instead of throwing `TimeoutLockingError`.
- **`timeoutMs` defaults to `0`**, so by default they return right away. Pass `timeoutMs` to wait a bounded time first.
- Only a timeout becomes `null`: cancellation and destroyed locks still throw.
- Atomic check-and-take, and no overtaking of waiters already in the queue.

## At a glance

```typescript
import { Mutex, ReadWriteLock } from "@apiratorjs/locking";

const mutex = new Mutex();
const rwLock = new ReadWriteLock();

const releaser = await mutex.tryAcquire();
if (!releaser) {
  return; // somebody else is already doing this work
}

try {
  // ... critical section ...
} finally {
  await releaser.release();
}

// Wait up to 500 ms, then give up without an exception
const writer = await rwLock.tryAcquireWrite({ timeoutMs: 500 });
```

Full details and the migration checklist for backend authors: [CHANGELOG.md](./CHANGELOG.md).
