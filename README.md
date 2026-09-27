# @apiratorjs/locking

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/locking.svg)](https://www.npmjs.com/package/@apiratorjs/locking)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/locking.svg)](https://github.com/apiratorjs/locking/blob/main/LICENSE)

A lightweight Node.js library for concurrency management with three types of locking primitives: mutexes, semaphores, and read-write locks. Supports both local (in-process) and distributed (multi-process) synchronization, with Redis backend support via additional packages.

> **Note:** Requires Node.js version **>=16.4.0**
>
> Upgrading from 4.x? See [CHANGELOG](./CHANGELOG.md) and [5.0.0 release notes](./RELEASE_NOTES.md).

---

## What Are Mutexes, Semaphores, ReadWriteLock?

- **Mutex**
    - A mutex (short for "mutual exclusion") ensures only one operation or task can access a resource at any time.
    - Once acquired by a task, other tasks must wait until it is released.
    - Real-life analogy: A bathroom key in a small office. If one person is using the bathroom (has the key), no one
      else can enter until the key is returned.

- **When to use a Mutex**
    - Whenever you need exclusive access to a shared resource.
    - For example, updating a single record in a file or database so that no two processes modify it at the same time.


- **Semaphore**
    - A semaphore manages access to a resource by keeping track of a certain number of "permits." A task must acquire a
      permit before it can proceed, and releases a permit when finished.
    - Semaphores allow multiple concurrent holders (up to a limit), rather than just one.
    - Real-life analogy: A parking garage with a limited number of parking spots. Each car must find an available spot (
      permit) to park, and if the garage is full, incoming cars must wait for someone to leave.
- **When to use a Semaphore**
    - Whenever you need to limit concurrency to a fixed number.
    - For example, limiting the number of simultaneous API requests or controlling concurrency in a task queue.


- **ReadWriteLock**
    - A read-write lock allows multiple readers to access a resource simultaneously, but only one writer at a time.
    - When a writer holds the lock, no readers can access the resource.
    - Real-life analogy: A library where multiple people can read books at the same time, but when someone is updating the catalog (writing), no one else can read or update until they finish.
- **When to use a ReadWriteLock**
    - When you have a resource that is read frequently but written to infrequently.
    - For example, a cache, configuration store, or any data structure that needs to be thread-safe with high read throughput.

---

## Features

### Local Locking Primitives

- **Mutex**
    - Immediate lock acquisition and release.
    - Waits for lock availability with configurable timeouts.
    - Supports cancellation of pending acquisitions.

- **Semaphore**
    - Configurable concurrent access limits.
    - Waits for an available slot with timeouts and cancellation support.
    - Ideal for limiting concurrency to a specific maximum number.

- **ReadWriteLock**
    - Allows multiple readers to access data simultaneously.
    - Ensures exclusive access when writing data.
    - Configurable maximum number of concurrent readers.
    - Supports timeouts for both read and write lock acquisition.
    - Provides convenience methods for automatic lock release.

### Distributed Locking Primitives

Distributed locks are created by name through an `InMemoryDistributedLockManager`.

- **Distributed Mutex** — same API as the local Mutex, shared by name.
- **Distributed Semaphore** — same API as the local Semaphore, shared by name.
- **Distributed ReadWriteLock** — same API as the local ReadWriteLock, shared by name.

By default a manager keeps everything in memory, which only synchronizes code inside one process. For
cross-process or multi-instance locking, use a backend that implements `IDistributedLockManager` — for
example [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis) (currently without
read-write lock support).

- **InMemoryDistributedLockManager**
    - Process-local implementation of `IDistributedLockManager`.
    - A single place that owns your named locks: the same name gives you the same instance while it is alive.
    - Answers `hasMutex` / `hasSemaphore` / `hasRWLock`, lists what exists and reports live state.
    - `cancelAll()` to drain waiters, `destroyAll()` for graceful shutdown.
    - Backend packages implement `IDistributedLockManager` themselves; several managers can run side by side.

### General

- **Asynchronous & Framework-Agnostic:** Fully compatible with async/await and works with any Node.js framework.
- **Lightweight & Reliable:** Minimal overhead with comprehensive test coverage to ensure robust locking behavior.

---

## Installation

Install via npm:

```bash
npm install @apiratorjs/locking
```

Or using yarn:

```bash
yarn add @apiratorjs/locking
```

---

## Usage

> All locking primitives have a default acquire timeout of 1 minute. Pass `timeoutMs: 0` to fail fast with a
> `TimeoutLockingError` when the lock is not immediately available.
>
> `cancel()` (mutex) / `cancelAll()` (semaphore, read-write lock, manager) reject the pending acquisitions only:
> locks that are already held stay held, and `waitForUnlock()` / `waitForAnyUnlock()` / `waitForFullyUnlock()` keep
> waiting until the holders actually release. On distributed locks, `destroy()` additionally resolves those waiters,
> since a lock that no longer exists cannot be held.

### Trying to acquire without waiting

`tryAcquire()` (mutex, semaphore) and `tryAcquireRead()` / `tryAcquireWrite()` (read-write lock) return a releaser
when the lock was taken and `null` when it was not - instead of throwing `TimeoutLockingError`. Unlike `acquire()`,
`timeoutMs` defaults to `0`, so by default they return right away. Pass `timeoutMs` to wait a bounded time first.

Only a timeout turns into `null`: cancellation (`CancelledLockingError`) and destroyed distributed locks
(`LockNotFoundError`) still throw, so "busy" is never confused with "gone".

```typescript
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

### Handing a semaphore permit over: tokens and TTL

A semaphore permit is identified by its token (`releaser.getToken()`), so it does not have to be released where it was
acquired. `restoreReleaser(token)` rebuilds the releaser anywhere the same semaphore is reachable - for instance in a
job queue worker that received the token in the job payload.

A permit whose holder can get lost (a crashed or dropped job) should get a `ttlMs`: when it runs out, the permit goes
back to the semaphore as if it had been released. The TTL counts from the moment the permit is granted, not from the
call. `extend(ttlMs)` sets a new TTL counted from now, `remainingTtl()` tells how much is left (`Infinity` without a
TTL, `null` once the permit is gone), and `isHeld()` whether the token still holds a permit. `Infinity` works as input
too: `ttlMs: Infinity` means no TTL, and `extend(Infinity)` removes the one a permit has. It does not survive JSON
(`JSON.stringify` turns it into `null`), so hand the token over to other code, not the `remainingTtl()` value.

Without `ttlMs` the backend decides: the in-memory semaphores hold the permit until it is released, since their permits
go away with the process anyway. Backends whose permits outlive the process (such as Redis) default to a finite TTL, so
a crashed holder cannot take a slot forever - pass `ttlMs` explicitly if the work can take longer than that default.

Releasing is idempotent per token: releasing the same permit twice - through the same releaser or through a restored
one - gives back one permit, and a holder whose permit already expired cannot release the permit of whoever got it
next.

```typescript
const semaphore = locks.semaphore("exports", 3);

// Producer: take a slot or skip, and hand the permit over to the job
const releaser = await semaphore.tryAcquire({ ttlMs: 10 * 60_000 });
if (!releaser) {
  return; // all slots busy
}
await queue.add("export", { permitToken: releaser.getToken() });

// Worker
const permit = locks.semaphore("exports", 3).restoreReleaser(job.data.permitToken);
if (!(await permit.isHeld())) {
  return; // expired in the queue - the slot was not reserved for this job anymore
}

try {
  // ... long work, extending the permit while it goes on
  await permit.extend(10 * 60_000);
} finally {
  await permit.release();
}
```

> The in-memory semaphore keeps its permits in the current process, so a token can only be restored there. Handing
> permits over between processes needs a backend that stores them outside the process, such as Redis.
>
> An expiring permit does not keep the process alive by itself, unless somebody is queued on the semaphore - then the
> process stays up until the expiry hands them the permit.

### Local Primitives

#### Mutex

```typescript
import { Mutex } from "@apiratorjs/locking";

async function example() {
  const mutex = new Mutex();
  
  // Method 1: Manual acquisition and release
  const releaser = await mutex.acquire({ timeoutMs: 5000 });
  try {
    // Critical section - exclusive access
    console.log("Mutex acquired");
  } finally {
    await releaser.release();
  }
  
  // Method 2: Automatic acquisition and release
  const result = await mutex.runExclusive(async () => {
    console.log("Mutex locked automatically");
    return "operation result";
  });
  
  // Cancel all pending acquisitions
  await mutex.cancel("Operation cancelled");
}
```

#### Semaphore

```typescript
import { Semaphore } from "@apiratorjs/locking";

async function example() {
  // Create semaphore with max 3 concurrent holders
  const semaphore = new Semaphore(3);
  
  // Method 1: Manual acquisition and release
  const releaser = await semaphore.acquire({ timeoutMs: 5000 });
  try {
    // Protected section - limited concurrency
    console.log("Semaphore slot acquired");
  } finally {
    await releaser.release();
  }
  
  // Method 2: Automatic acquisition and release
  const result = await semaphore.runExclusive(async () => {
    console.log("Semaphore slot acquired automatically");
    return "operation result";
  });
  
  // Cancel all pending acquisitions
  await semaphore.cancelAll("Operation cancelled");
}
```

#### ReadWriteLock

```typescript
import { ReadWriteLock } from "@apiratorjs/locking";

async function example() {
  const rwLock = new ReadWriteLock({ maxReaders: 100 });
  
  // For read operations (multiple readers allowed)
  const readReleaser = await rwLock.acquireRead({ timeoutMs: 3000 });
  try {
    // Read operations - multiple readers can access simultaneously
    console.log("Read lock acquired");
  } finally {
    await readReleaser.release();
  }
  
  // For write operations (exclusive access)
  const writeReleaser = await rwLock.acquireWrite({ timeoutMs: 5000 });
  try {
    // Write operations - no readers or other writers allowed
    console.log("Write lock acquired");
  } finally {
    await writeReleaser.release();
  }
  
  // Automatic acquisition and release
  await rwLock.withReadLock(async () => {
    console.log("Read lock acquired and released automatically");
  });
  
  await rwLock.withWriteLock(async () => {
    console.log("Write lock acquired and released automatically");
  });
  
  // Cancel all pending acquisitions
  await rwLock.cancelAll("Operation cancelled");
}
```

### Distributed Primitives

Distributed locks are created through an `InMemoryDistributedLockManager`: it owns them by name and hands out the same
instance for the same name. See [Managing Locks](#managing-locks-inmemorydistributedlockmanager) for the manager itself.

> By default, a manager is in-memory and therefore suitable only for single-process usage. For multi-process or
> multi-instance environments, use a backend that implements `IDistributedLockManager` - see
> [Switching to a Real Distributed Backend](#switching-to-a-real-distributed-backend).

#### Distributed Mutex

```typescript
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();

async function example() {
  const mutex = locks.mutex("shared-resource");
  
  // Method 1: Manual acquisition and release
  const releaser = await mutex.acquire({ timeoutMs: 5000 });
  try {
    // Critical section - exclusive access (shared by name within this manager)
    console.log("Distributed mutex acquired");
  } finally {
    await releaser.release();
  }
  
  // Method 2: Automatic acquisition and release
  const result = await mutex.runExclusive(async () => {
    console.log("Distributed mutex locked automatically");
    return "operation result";
  });
  
  // Cancel all pending acquisitions
  await mutex.cancel("Operation cancelled");
}
```

#### Distributed Semaphore

```typescript
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();

async function example() {
  const semaphore = locks.semaphore("api-rate-limiter", 5);
  
  // Method 1: Manual acquisition and release
  const releaser = await semaphore.acquire({ timeoutMs: 5000 });
  try {
    // Protected section - limited concurrency (shared by name within this manager)
    console.log("Distributed semaphore slot acquired");
  } finally {
    await releaser.release();
  }
  
  // Method 2: Automatic acquisition and release
  const result = await semaphore.runExclusive(async () => {
    console.log("Distributed semaphore slot acquired automatically");
    return "operation result";
  });
  
  // Cancel all pending acquisitions
  await semaphore.cancelAll("Operation cancelled");
}
```

#### Distributed ReadWriteLock

```typescript
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();

async function example() {
  const rwLock = locks.readWriteLock("shared-config", 50);
  
  // For read operations (multiple readers allowed)
  const readReleaser = await rwLock.acquireRead({ timeoutMs: 3000 });
  try {
    // Read operations - multiple readers can access simultaneously
    console.log("Distributed read lock acquired");
  } finally {
    await readReleaser.release();
  }
  
  // For write operations (exclusive access)
  const writeReleaser = await rwLock.acquireWrite({ timeoutMs: 5000 });
  try {
    // Write operations - no readers or other writers allowed
    console.log("Distributed write lock acquired");
  } finally {
    await writeReleaser.release();
  }
  
  // Automatic acquisition and release
  await rwLock.withReadLock(async () => {
    console.log("Distributed read lock acquired and released automatically");
  });
  
  await rwLock.withWriteLock(async () => {
    console.log("Distributed write lock acquired and released automatically");
  });
  
  // Cancel all pending acquisitions
  await rwLock.cancelAll("Operation cancelled");
}
```

### Cancellation

All primitives support cancelling pending acquisitions:

```typescript
// Cancel all pending acquisitions with custom error message
await mutex.cancel("Operation cancelled");
await semaphore.cancelAll("Operation cancelled");
await rwLock.cancelAll("Operation cancelled");

// ...or everything a manager holds at once
await locks.cancelAll("Operation cancelled");
```

Cancelling never takes a lock away from whoever is holding it — it rejects the waiters, and the owners release as
usual.

### Error Handling

The library provides specific error classes to help you handle different failure scenarios:

```typescript
import {
  LockingError,
  TimeoutLockingError,
  CancelledLockingError,
  LockNotFoundError,
  LockConfigMismatchError
} from "@apiratorjs/locking";
```

#### Error Classes

| Error Class | Description | When Thrown |
|-------------|-------------|-------------|
| `LockingError` | Base class for all locking errors | Parent class, not thrown directly |
| `TimeoutLockingError` | Lock acquisition timed out | When `acquire()` exceeds `timeoutMs` (the `tryAcquire*()` methods return `null` instead) |
| `CancelledLockingError` | Lock acquisition was cancelled | When `cancel()` / `cancelAll()` or `destroy()` is called |
| `LockNotFoundError` | Lock no longer exists | When accessing a destroyed distributed lock |
| `LockConfigMismatchError` | A lock with this name already exists with different settings | When a distributed lock is constructed with a `maxCount` / `maxReaders` that conflicts with the existing lock of the same name |

#### Example Usage

```typescript
import { Mutex, TimeoutLockingError, CancelledLockingError } from "@apiratorjs/locking";

const mutex = new Mutex();

try {
  const releaser = await mutex.acquire({ timeoutMs: 1000 });
  // ... critical section ...
  await releaser.release();
} catch (error) {
  if (error instanceof TimeoutLockingError) {
    console.log("Failed to acquire lock within timeout");
  } else if (error instanceof CancelledLockingError) {
    console.log("Lock acquisition was cancelled");
  } else {
    throw error;
  }
}
```

#### Distributed Lock Error Handling

```typescript
import { InMemoryDistributedLockManager, LockNotFoundError, CancelledLockingError } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();
const mutex = locks.mutex("my-resource");

try {
  const releaser = await mutex.acquire();
  // ... critical section ...
  await releaser.release();
} catch (error) {
  if (error instanceof LockNotFoundError) {
    console.log("Lock was destroyed by another process");
  } else if (error instanceof CancelledLockingError) {
    console.log("Lock acquisition was cancelled");
  } else {
    throw error;
  }
}
```

### Waiting for Lock State Changes

All locking primitives provide methods to wait for lock state changes without attempting to acquire the lock:

#### Mutex: `waitForUnlock()`

Waits until the mutex is released by its current holder:

> **Important:** The `waitForUnlock()` method allows you to monitor mutex availability without actually acquiring the lock. It returns a promise that resolves when the mutex becomes free for acquisition. Note that this is purely observational - the mutex remains unlocked, and due to the asynchronous nature of JavaScript, the mutex may be acquired by another operation before you have a chance to acquire it yourself.

```typescript
import { Mutex } from "@apiratorjs/locking";

async function example() {
  const mutex = new Mutex();
  
  // In one part of your code
  const releaser = await mutex.acquire();
  
  // In another part (e.g., different function or service)
  try {
    // Wait for the mutex to be unlocked without trying to acquire it
    await mutex.waitForUnlock();
    console.log("Mutex is now unlocked!");
    
    // Now you can try to acquire it if needed
    const myReleaser = await mutex.acquire();
    // ...
  } catch (error) {
    console.error("Waiting was interrupted:", error.message);
  }
}
```

#### Semaphore: `waitForAnyUnlock()` and `waitForFullyUnlock()`

Semaphores provide two waiting methods:
- `waitForAnyUnlock()`: Resolves when at least one permit becomes available
- `waitForFullyUnlock()`: Resolves when all permits are available (semaphore is fully unlocked)

> **Important:** These waiting methods allow you to monitor semaphore permit availability without actually acquiring any permits. They return promises that resolve when the specified conditions are met (at least one permit available or all permits available). Note that these are purely observational - no permits are acquired, and due to the asynchronous nature of JavaScript, permits may be acquired by other operations before you have a chance to acquire them yourself.

```typescript
import { Semaphore } from "@apiratorjs/locking";

async function example() {
  const semaphore = new Semaphore(3);
  
  // Acquire all permits
  const releasers = await Promise.all([
    semaphore.acquire(),
    semaphore.acquire(),
    semaphore.acquire()
  ]);
  
  // In another part of your code
  setTimeout(() => {
    // Release one permit
    releasers[0].release();
  }, 1000);
  
  // This will resolve after one permit is released
  await semaphore.waitForAnyUnlock();
  console.log("At least one permit is now available!");
  
  setTimeout(() => {
    // Release all remaining permits
    releasers[1].release();
    releasers[2].release();
  }, 1000);
  
  // This will resolve only when all permits are available
  await semaphore.waitForFullyUnlock();
  console.log("Semaphore is fully unlocked!");
}
```

### Managing Locks: `InMemoryDistributedLockManager`

`InMemoryDistributedLockManager` owns a set of named locks. It hands out the same instance for the same name while that
lock is alive, so you no longer have to pass lock objects around, and it knows what it handed out — which makes
listing, draining and shutdown possible.

```typescript
import { InMemoryDistributedLockManager, ELockDisplayType } from "@apiratorjs/locking";

// One per backend; inject it instead of reaching for a global
export const locks = new InMemoryDistributedLockManager();

// Same name -> same instance, created on first use
locks.mutex("orders") === locks.mutex("orders"); // true

await locks.mutex("orders").runExclusive(() => shipOrder());
await locks.semaphore("uploads", 5).runExclusive(() => upload());
await locks.readWriteLock("catalog").withReadLock(() => readCatalog());
```

#### Inspecting what exists

```typescript
locks.hasMutex("orders");           // true
locks.hasSemaphore("uploads");      // true
locks.hasRWLock("catalog");         // true

locks.count();                      // 3
locks.count(ELockDisplayType.Semaphore);   // 1

locks.list();
// [ { kind: "mutex", name: "orders", implementation: "in-memory", isDestroyed: false },
//   { kind: "semaphore", name: "uploads", implementation: "in-memory", isDestroyed: false, maxCount: 5 }, ... ]

await locks.snapshot();
// same, plus current state: isLocked / freeCount / isWriteLocked / isReadLocked / activeReaders
```

`has*`, `list()` and `count()` are synchronous and cheap; `snapshot()` reads live state through the lock implementation,
so it is asynchronous. Locks destroyed in the meantime are dropped rather than reported.

#### Draining and shutdown

```typescript
// Reject everything that is waiting; held locks stay held and the locks stay usable
await locks.cancelAll("Draining before deploy");

// Tear everything down: waiters are rejected, handles report isDestroyed, the manager empties itself
process.on("SIGTERM", async () => {
  await locks.destroyAll("Shutting down");
});
```

> `cancelAll()` never force-releases a lock somebody is holding — that would put two owners inside the same
> critical section. It cancels the queue; the owners release as usual.

If a lock fails to cancel or destroy, the bulk operation still processes the rest and then throws an
`AggregateError` with the collected failures.

#### Requesting a different configuration

A name is registered together with its configuration, so asking for the same name with a different capacity is a
mistake rather than a silent reconfiguration:

```typescript
locks.semaphore("uploads", 5);
locks.semaphore("uploads", 10); // throws LockConfigMismatchError

locks.readWriteLock("catalog", 3);
locks.readWriteLock("catalog");  // fine - no maxReaders means "whatever is registered"
```

---

### Switching to a Real Distributed Backend

`InMemoryDistributedLockManager` synchronizes code inside one Node.js process, and nothing more. For
several processes or servers you need a backend that all of them talk to — a package that implements
`IDistributedLockManager`, such as [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis).

> **Note:** The current version of `@apiratorjs/locking-redis` does not yet support distributed read-write locks.

```typescript
import { types } from "@apiratorjs/locking";
import { RedisDistributedLockManager } from "@apiratorjs/locking-redis";

// Same IDistributedLockManager contract, Redis-backed
export const locks: types.IDistributedLockManager = new RedisDistributedLockManager({
  url: "redis://localhost:6379",
});

await locks.mutex("shared-resource").runExclusive(() => chargeCard());
await locks.semaphore("api-rate-limiter", 5).runExclusive(() => callUpstream());
```

Nothing is global here, so a Redis-backed manager and an in-memory one can coexist — useful when only part of the
system needs cross-process coordination, and in tests.

---

### Own implementation of a distributed backend

Implement `IDistributedLockManager` (and, behind it, `IDistributedMutex` / `IDistributedSemaphore` /
`IDistributedRWLock`):

```typescript
import { types } from "@apiratorjs/locking";

export class MyDistributedLockManager implements types.IDistributedLockManager {
  public mutex(name: string): types.IDistributedMutex {
    // create or return the named mutex
  }

  public semaphore(name: string, maxCount: number): types.IDistributedSemaphore {
    // ...
  }

  public readWriteLock(name: string, maxReaders?: number): types.IDistributedRWLock {
    // ...
  }

  public hasMutex(name: string): boolean { /* ... */ }
  public hasSemaphore(name: string): boolean { /* ... */ }
  public hasRWLock(name: string): boolean { /* ... */ }

  public list(): types.TDistributedLockInfo[] { /* ... */ }
  public count(kind?: types.ELockDisplayType): number { /* ... */ }
  public snapshot(): Promise<types.TDistributedLockSnapshot[]> { /* ... */ }
  public cancelAll(errMessage?: string): Promise<void> { /* ... */ }
  public destroyAll(errMessage?: string): Promise<void> { /* ... */ }
}
```

What an implementation is responsible for:

- **Owning locks by name.** The same name should return the same live instance; destroyed locks are forgotten.
- **Rejecting a conflicting configuration.** If `"uploads"` already exists with `maxCount: 2`, a request for
  `maxCount: 5` should throw `LockConfigMismatchError` rather than silently return a different capacity.
- **Never force-releasing a held lock.** `cancelAll()` cancels waiters; owners release their own locks. The one
  exception is a semaphore permit whose TTL ran out - that goes back as if released.
- **Semaphore permits addressed by token:**
  - `release()` is idempotent per token, across every releaser of that token, including those from
    `restoreReleaser()`;
  - once a permit expired, a late `release()` of its token is a no-op and `extend()` returns `false`, even if the
    backend cleans expired permits up lazily;
  - `restoreReleaser(token)` is synchronous and does no I/O - an unknown token gives a releaser that holds nothing;
  - `ttlMs` counts from the moment the permit is granted, not from the call. `Infinity` means no TTL. Without
    `ttlMs`, pick a finite default if permits outlive the process.
- **`destroy()` being idempotent**, and `isDestroyed` becoming `true` once a lock is torn down.

`InMemoryDistributedLockManager` and the in-memory locks under `src/in-memory-distributed` can be read as a
reference.

---

## Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/locking).
