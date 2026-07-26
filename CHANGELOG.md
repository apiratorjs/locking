# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[5.0.0]: https://github.com/apiratorjs/locking/releases/tag/v5.0.0
[4.0.3]: https://github.com/apiratorjs/locking/releases/tag/v4.0.3
