# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.0.0] - 2026-09-27

Compared to **7.0.0**.

### Breaking Changes

- `IMutex` (and therefore `IDistributedMutex`) declares a new required method, `restoreReleaser(token)`, and its `acquire()` / `tryAcquire()` now return `IMutexReleaser` instead of `IReleaser<TMutexToken>`. Custom mutex backends and hand-written implementations or test doubles stop compiling until they add them.

### Added

- Mutexes get what semaphores got in 7.0.0: `ttlMs` in the acquisition parameters (`TMutexAcquireParams`), `restoreReleaser(token)`, and `extend(ttlMs)` / `remainingTtl()` / `isHeld()` on the releaser (`IMutexReleaser`). Applies to `Mutex` and the distributed mutex.
- `ILeaseReleaser<T>`: the common base of `ISemaphoreReleaser` and `IMutexReleaser`, for code that works with either.

### Migration checklist

Code that only *uses* the mutexes shipped with this package needs no changes.

For implementers of `IMutex` / `IDistributedMutex`: follow the 7.0.0 checklist for semaphores below, for the mutex - return `IMutexReleaser`, add `restoreReleaser(token)`, accept `ttlMs` independently of `timeoutMs`, track the lock by token, and bump the `@apiratorjs/locking` range to `^8.0.0`.

## [7.0.0] - 2026-09-27

Compared to **6.0.0**.

### Breaking Changes

- `ISemaphore` (and therefore `IDistributedSemaphore`) declares a new required method, `restoreReleaser(token)`, and its `acquire()` / `tryAcquire()` now return `ISemaphoreReleaser` instead of `IReleaser<TSemaphoreToken>`. Custom semaphore backends and hand-written implementations or test doubles stop compiling until they add them.

### Added

- `ttlMs` in the acquisition parameters of `Semaphore` and the distributed semaphore (`TSemaphoreAcquireParams`): the permit is released automatically once it runs out. The TTL counts from the moment the permit is granted. Without `ttlMs` the backend's default applies: the in-memory semaphores hold the permit until it is released, while backends whose permits outlive the process (Redis, ...) are expected to default to a finite TTL.
- `ISemaphoreReleaser` with `extend(ttlMs)`, `remainingTtl()` and `isHeld()` on top of `release()` / `getToken()`. `remainingTtl()` returns `Infinity` for a permit without a TTL and `null` once the permit is gone; `Infinity` is accepted as input too (`ttlMs: Infinity` means no TTL, `extend(Infinity)` removes the TTL).
- `restoreReleaser(token)` on `Semaphore` and the distributed semaphore: rebuilds the releaser of a permit from its token, so a permit can be released somewhere other than where it was acquired (e.g. in a job queue worker).

### Behavior

- Semaphore permits are tracked by token. Releasing is idempotent per token rather than per releaser object, and a releaser whose permit already expired can no longer release a permit that has been granted to somebody else since.
- Destroying a distributed semaphore (or `dispose()` on a local one) forgets its held permits: their releasers become no-ops and `isHeld()` returns `false`.
- An expiring permit does not keep the process alive by itself; while somebody is queued on the semaphore it does, so the queued acquirer is not abandoned when nothing else is left running.

### Migration checklist

Code that only *uses* the semaphores shipped with this package needs no changes: `IReleaser` members keep working, and permits without `ttlMs` behave as before.

For implementers of `ISemaphore` / `IDistributedSemaphore`:

1. Return an `ISemaphoreReleaser` from `acquire()` / `tryAcquire()`: `release()`, `getToken()`, `extend(ttlMs)`, `remainingTtl()`, `isHeld()`.
2. Add `restoreReleaser(token)`. It is synchronous and does no I/O; an unknown token gives a releaser that holds nothing.
3. Accept `ttlMs` in `TSemaphoreAcquireParams`, counted from the moment the permit is granted. `Infinity` means no TTL. Keep the permit's lifetime separate from `timeoutMs`, which only bounds the wait.
4. Without `ttlMs`, default to a finite TTL if your permits outlive the process (Redis, Postgres, ...), so a crashed holder cannot take a slot forever.
5. Track permits by token: `release()` is idempotent per token, a late `release()` after expiry is a no-op, and `extend()` after expiry returns `false` - even when expired permits are cleaned up lazily.
6. Use a single clock for expiry (e.g. the Redis server time via `TIME` in a script), not each client's `Date.now()`: the permit may be acquired, extended and released on different hosts.
7. Wake queued acquirers when a permit expires, not only when one is released - an expired permit may never see a `release()`.
8. Bump the `@apiratorjs/locking` peer / dependency range of the backend package to `^7.0.0`.

## [6.0.0] - 2026-09-27

Compared to **5.0.0**.

### Breaking Changes

- `IMutex`, `ISemaphore`, and `IReadWriteLock` declare new required methods: `tryAcquire()` (mutex, semaphore) and `tryAcquireRead()` / `tryAcquireWrite()` (read-write lock). Since `IDistributedMutex`, `IDistributedSemaphore`, and `IDistributedRWLock` extend them, every custom distributed backend (Redis, Postgres, ...) and every hand-written implementation or test double of these interfaces stops compiling until it adds the methods.

Code that only *uses* the locks shipped with this package needs no changes.

### Added

- `tryAcquire()` on `Mutex`, `Semaphore`, and the distributed mutex / semaphore returned by `InMemoryDistributedLockManager`.
- `tryAcquireRead()` / `tryAcquireWrite()` on `ReadWriteLock` and the distributed read-write lock.
- The new methods resolve to a releaser, or to `null` when the lock could not be acquired within `timeoutMs`, instead of throwing `TimeoutLockingError`.

```typescript
const releaser = await mutex.tryAcquire();
if (!releaser) {
  return; // lock is busy
}

try {
  // ... critical section ...
} finally {
  await releaser.release();
}
```

### Behavior

- `timeoutMs` defaults to `0` for the `tryAcquire*()` methods (the `acquire*()` default stays at 1 minute): a busy lock yields `null` right away. Pass `timeoutMs` to wait a bounded time first.
- Only a timeout becomes `null`. Cancellation (`CancelledLockingError`) and destroyed distributed locks (`LockNotFoundError`) still throw, so "busy" is never confused with "gone".
- With `timeoutMs: 0` the check and the acquisition happen in one synchronous step, and a failed attempt leaves nothing queued behind.
- `tryAcquire*()` never overtakes waiters that are already queued; it grants the lock under exactly the same conditions as the matching `acquire*()`.

### Migration checklist

For implementers of `IMutex` / `ISemaphore` / `IReadWriteLock` or their `IDistributed*` counterparts:

1. Add `tryAcquire(params?)` to mutex and semaphore implementations, and `tryAcquireRead(params?)` / `tryAcquireWrite(params?)` to read-write lock implementations, returning `IReleaser<...> | null`.
2. Default `timeoutMs` to `0` in these methods, return `null` on timeout, and keep throwing on cancellation or a destroyed lock.
3. Make the `timeoutMs: 0` path a single atomic operation on the backend (e.g. `SET NX` or a Lua script in Redis), not an `isLocked()` check followed by `acquire()`.
4. Bump the `@apiratorjs/locking` peer / dependency range of the backend package to `^6.0.0`.

## [5.0.0] - 2026-07-26

Compared to **4.0.x** (`4.0.3`).

### Breaking Changes

#### Distributed API

- Removed public classes `DistributedMutex`, `DistributedSemaphore`, and `DistributedReadWriteLock`.
- Removed `InMemoryDistributedRegistry` and the process-global in-memory registries behind it.
- Removed static `.factory` hooks used to swap backends (`DistributedMutex.factory`, etc.).
- Removed factory types: `DistributedMutexFactory`, `DistributedSemaphoreFactory`, `DistributedRWLockFactory`.
- Distributed locks are created through an `IDistributedLockManager` instance. This package ships `InMemoryDistributedLockManager`; backends such as `@apiratorjs/locking-redis` should implement the same interface.

**Before (4.x):**

```typescript
import { DistributedMutex } from "@apiratorjs/locking";

const mutex = new DistributedMutex({ name: "orders" });
```

**After (5.x):**

```typescript
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();
const mutex = locks.mutex("orders");
```

**Before (4.x, Redis via factory):**

```typescript
DistributedMutex.factory = lockFactory.createDistributedMutex;
const mutex = new DistributedMutex({ name: "orders" });
```

**After (5.x):**

```typescript
import { types } from "@apiratorjs/locking";
import { RedisDistributedLockManager } from "@apiratorjs/locking-redis";

const locks: types.IDistributedLockManager = new RedisDistributedLockManager({ url });
const mutex = locks.mutex("orders");
```

#### Type renames (`types.*`)

| 4.x | 5.x |
|-----|-----|
| `AcquireParams` | `TAcquireParams` |
| `SemaphoreToken` | `TSemaphoreToken` |
| `MutexToken` | `TMutexToken` |
| `ReadLockToken` | `TReadLockToken` |
| `WriteLockToken` | `TWriteLockToken` |
| `AcquireToken` | `TAcquireToken` |
| `ExclusiveCallback` | `TExclusiveCallback` |
| `DistributedSemaphoreConstructorProps` | `TDistributedSemaphoreConstructorProps` |
| `DistributedMutexConstructorProps` | `TDistributedMutexConstructorProps` |
| `RWLockConstructorProps` | `TRWLockConstructorProps` |
| `DistributedRWLockConstructorProps` | `TDistributedRWLockConstructorProps` |

- Removed `RWLockToken` (use `TReadLockToken | TWriteLockToken`).

#### Cancellation and unlock waiters

- `cancel()` / `cancelAll()` no longer force-release held locks. In 4.x, semaphore `cancelAll()` reset permits to `maxCount`, which could let new acquirers into a critical section still held by someone else.
- `cancel()` / `cancelAll()` no longer reject `waitForUnlock()` / `waitForAnyUnlock()` / `waitForFullyUnlock()` waiters. Those keep waiting until a real unlock (or until `destroy()` / `dispose()` on distributed locks, which resolves them).

#### Acquire timeout

- `timeoutMs: 0` now means fail immediately with `TimeoutLockingError` when the lock is not free.
- In 4.x, `timeoutMs: 0` was treated as “use the default” because the timeout was resolved with `||` instead of `??`.

### Added

- `InMemoryDistributedLockManager` — owns named locks, hands out the same live instance per name, supports `hasMutex` / `hasSemaphore` / `hasRWLock`, `list()`, `count()`, `snapshot()`, `cancelAll()`, and `destroyAll()`.
- `IDistributedLockManager` and related snapshot/info types for backend implementations.
- `ELockDisplayType` (`mutex` / `semaphore` / `rwlock`).
- `LockConfigMismatchError` when the same name is requested with a conflicting `maxCount` / `maxReaders`.
- Idempotent `release()` on semaphore releasers (double-release no longer returns an extra permit).
- Acquire timers are `unref()`’d so a pending wait alone does not keep the process alive.

### Changed

- `ReadWriteLock` no longer delegates to two independent semaphores; lock state is owned by the class so a concurrent reader and writer cannot both pass availability checks.
- In-memory distributed locks are scoped to a manager instance instead of a process-wide singleton registry.
- Documented and aligned cancel / destroy semantics across local and distributed primitives.

### Migration checklist

1. Replace `new DistributedMutex({ name })` with `locks.mutex(name)` (same for semaphore / read-write lock).
2. Replace `Distributed*.factory = ...` with constructing / injecting an `IDistributedLockManager` backend.
3. Stop using `InMemoryDistributedRegistry`; use manager `list()` / `has*` / `destroyAll()` instead.
4. Update `types.*` imports to the `T…` names.
5. Review any code that relied on `cancelAll()` freeing held permits or rejecting unlock waiters.
6. If you passed `timeoutMs: 0` expecting the default timeout, omit the option or pass `undefined` instead.

## [4.0.3] - 2026-01-20

See Git history and npm for 4.0.x patch notes. This changelog starts detailed entries at 5.0.0.

[6.0.0]: https://github.com/apiratorjs/locking/releases/tag/v6.0.0
[5.0.0]: https://github.com/apiratorjs/locking/releases/tag/v5.0.0
[4.0.3]: https://github.com/apiratorjs/locking/releases/tag/v4.0.3
