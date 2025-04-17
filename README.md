# @apiratorjs/locking

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/locking.svg)](https://www.npmjs.com/package/@apiratorjs/locking)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/locking.svg)](https://github.com/apiratorjs/locking/blob/main/LICENSE)

A lightweight Node.js library providing both local and distributed locking primitives—mutexes and semaphores—for
managing concurrency and ensuring synchronization in asynchronous operations. Designed for single-process as well as
multi-instance environments, it supports (via additional packages) distributed locking backends such as Redis.

> **Note:** Requires Node.js version **>=16.4.0**

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

- **Distributed Mutex**
    - Similar API to the local Mutex.
    - By default, uses an in-memory store—only suitable for single-process usage.
    - Use external packages (e.g., [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis))
      to enable cross-process or multi-instance distributed locking with Redis.

- **Distributed Semaphore**
    - Similar API to the local Semaphore.
    - By default, uses an in-memory store—only suitable for single-process usage.
    - Use external packages (e.g., [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis))
      to enable cross-process or multi-instance distributed locking with Redis.

- **Distributed ReadWriteLock**
    - Similar API to the local ReadWriteLock.
    - By default, uses an in-memory store—only suitable for single-process usage.
    - Use external packages (e.g., [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis) (currently does not support it))
      to enable cross-process or multi-instance distributed locking with Redis.

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

> All locking primitives have a default acquire timeout of 1 minute.

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
  await mutex.cancelAll("Operation cancelled");
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

> By default, distributed primitives use an in-memory store suitable only for single-process usage.
> For multi-process or multi-instance environments, use an external backend like `@apiratorjs/locking-redis`.

#### Distributed Mutex

```typescript
import { DistributedMutex } from "@apiratorjs/locking";

async function example() {
  const mutex = new DistributedMutex({ name: "shared-resource" });
  
  // Method 1: Manual acquisition and release
  const releaser = await mutex.acquire({ timeoutMs: 5000 });
  try {
    // Critical section - exclusive access across processes
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
  await mutex.cancelAll("Operation cancelled");
}
```

#### Distributed Semaphore

```typescript
import { DistributedSemaphore } from "@apiratorjs/locking";

async function example() {
  const semaphore = new DistributedSemaphore({
    name: "api-rate-limiter",
    maxCount: 5
  });
  
  // Method 1: Manual acquisition and release
  const releaser = await semaphore.acquire({ timeoutMs: 5000 });
  try {
    // Protected section - limited concurrency across processes
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
import { DistributedReadWriteLock } from "@apiratorjs/locking";

async function example() {
  const rwLock = new DistributedReadWriteLock({
    name: "shared-config",
    maxReaders: 50
  });
  
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
await mutex.cancelAll("Operation cancelled");
await semaphore.cancelAll("Operation cancelled");
await rwLock.cancelAll("Operation cancelled");
```

### Waiting for Lock State Changes

All locking primitives provide methods to wait for lock state changes without attempting to acquire the lock:

#### Mutex: `waitForUnlock()`

Waits until the mutex is released by its current holder:

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

### Switching to a Real Distributed Backend

By default, `DistributedMutex`, `DistributedSemaphore`, and `DistributedReadWriteLock` use an in-memory store. This does not provide real
cross-process synchronization if you run multiple Node.js processes or servers.

If you need actual distributed locking, install an additional package such
as [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis), which plugs into this library
to enable Redis-based locking primitives. You would then configure the `DistributedMutex.factory` or 
`DistributedSemaphore.factory` to use the Redis-based constructor, for example:

> **Note:** The current version of `@apiratorjs/locking-redis` does not yet support `DistributedReadWriteLock`. Support for distributed read-write locks will be added in a future release.

```typescript
import { DistributedSemaphore } from "@apiratorjs/locking";
import { createRedisLockFactory } from "@apiratorjs/locking-redis";

(async () => {
  const lockFactory = await createRedisLockFactory({ url: "redis://localhost:6379" });

  DistributedSemaphore.factory = lockFactory.createDistributedSemaphore;

  // Now all new DistributedSemaphore instances use Redis for synchronization
  const semaphore = new DistributedSemaphore({ name: "shared-name", maxCount: 5 });
})();
```

```typescript
import { DistributedMutex } from "@apiratorjs/locking";
import { createRedisLockFactory } from "@apiratorjs/locking-redis";

(async () => {
  const lockFactory = await createRedisLockFactory({ url: "redis://localhost:6379" });

  DistributedMutex.factory = lockFactory.createDistributedMutex;

  // Now all new DistributedMutex instances use Redis for synchronization
  const mutex = new DistributedMutex({ name: "shared-name" });
})();
```

---

### Own implementation of a distributed backend

You can also implement your own distributed backend by implementing the `IDistributedSemaphore`, `IDistributedMutex`,
`IDistributedReadWriteLock`, `DistributedSemaphoreFactory`, `DistributedMutexFactory`, and `DistributedRWLockFactory` interfaces. And apply them:

```typescript
DistributedMutex.factory = (props: DistributedMutexConstructorProps) => IDistributedMutex;

DistributedSemaphore.factory = (props: DistributedSemaphoreConstructorProps) => IDistributedSemaphore;

DistributedReadWriteLock.factory = (props: DistributedRWLockConstructorProps) => IDistributedReadWriteLock;
```

---

## Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/locking).
