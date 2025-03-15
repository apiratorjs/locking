# @apiratorjs/locking

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/locking.svg)](https://www.npmjs.com/package/@apiratorjs/locking)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/locking.svg)](https://github.com/apiratorjs/locking/blob/main/LICENSE)

A lightweight Node.js library providing both local and distributed locking primitives—mutexes and semaphores—for
managing concurrency and ensuring synchronization in asynchronous operations. Designed for single-process as well as
multi-instance environments, it supports (via additional packages) distributed locking backends such as Redis.

> **Note:** Requires Node.js version **>=16.4.0**

---

## What Are Mutexes and Semaphores?

- **Mutex**
    - A mutex (short for “mutual exclusion”) ensures only one operation or task can access a resource at any time.
    - Once acquired by a task, other tasks must wait until it is released.
    - Real-life analogy: A bathroom key in a small office. If one person is using the bathroom (has the key), no one
      else can enter until the key is returned.

- **When to use a Mutex**
    - Whenever you need exclusive access to a shared resource.
    - For example, updating a single record in a file or database so that no two processes modify it at the same time.


- **Semaphore**
    - A semaphore manages access to a resource by keeping track of a certain number of “permits.” A task must acquire a
      permit before it can proceed, and releases a permit when finished.
    - Semaphores allow multiple concurrent holders (up to a limit), rather than just one.
    - Real-life analogy: A parking garage with a limited number of parking spots. Each car must find an available spot (
      permit) to park, and if the garage is full, incoming cars must wait for someone to leave.
- **When to use a Semaphore**
    - Whenever you need to limit concurrency to a fixed number.
    - For example, limiting the number of simultaneous API requests or controlling concurrency in a task queue.

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

> Both Mutex and Semaphore (including their distributed versions) have a default acquire timeout of 1 minute.

### Local Mutex

A mutex allows only one active holder at a time, enforcing exclusive access to a resource:

```typescript
import { Mutex } from "@apiratorjs/locking";

async function main() {
  const mutex = new Mutex();

  // Acquire the mutex
  const releaser = await mutex.acquire();

  try {
    // Critical section:
    // Perform operations that need exclusive access
    console.log("Local mutex acquired, performing critical operation.");
  } finally {
    // Always release the mutex
    await releaser.release();
  }
}

main();
```

```typescript
import { Mutex } from "@apiratorjs/locking";

(async () => {
  const mutex = new Mutex();

  const result = await mutex.runExclusive(async () => {
    console.log("Local mutex locked automatically.");
    return 42;
  });

  console.log("Lock was released automatically. Result =", result);
})();
```

Timeouts

A mutex can wait for a specified duration to acquire the lock before throwing an error.

You can also specify a timeout in milliseconds:

```typescript
import { Mutex, types } from "@apiratorjs/locking";

async function main() {
  const mutex = new Mutex();

  // Try to acquire with a timeout
  let releaser: types.IReleaser;

  try {
    releaser = await mutex.acquire({ timeoutMs: 2000 }); // 2 seconds
    // Perform exclusive operations
  } catch (error: any) {
    console.error("Failed to acquire mutex:", error.message);
  } finally {
    await releaser?.release();
  }
}

main();
````

```typescript
import { Mutex } from "@apiratorjs/locking";

(async () => {
  const mutex = new Mutex();

  try {
    const result = await mutex.runExclusive({ timeoutMs: 2000 }, async () => {
      console.log("Local mutex locked automatically.");
      return 42;
    });
  } catch (error: any) {
    console.error("Failed to acquire mutex:", error.message);
  }

  console.log("Lock was released automatically.");
})();
```

### Local Semaphore

A semaphore allows you to limit concurrent access by a specified count:

```typescript
import { Semaphore, types } from "@apiratorjs/locking";

async function main() {
  // Create a semaphore with a max of 3 concurrent holders
  const semaphore = new Semaphore(3);

  // Acquire one slot
  let releaser: types.IReleaser;

  try {
    releaser = await semaphore.acquire();
    // Perform operations allowed under concurrency limit
  } finally {
    // Always release the slot
    await releaser?.release();
  }
}

main();
```

```typescript
import { Semaphore } from "@apiratorjs/locking";

(async () => {
  const semaphore = new Semaphore(3);

  const data = await semaphore.runExclusive(async () => {
    console.log("Acquired one of the semaphore slots automatically.");
    return "Some data";
  });

  console.log("Semaphore slot released automatically. Data =", data);
})();
```

Timeouts

Similarly, you can set a timeout for semaphore acquisition:

```typescript
import { Semaphore, types } from "@apiratorjs/locking";

async function main() {
  const semaphore = new Semaphore(2);

  let releaser: types.IReleaser;

  try {
    releaser = await semaphore.acquire({ timeoutMs: 1000 }); // 1 second
    // Perform operation within concurrency limit
  } catch (error: any) {
    console.error("Failed to acquire semaphore:", error.message);
  } finally {
    // Always release the slot
    await releaser?.release();
  }
}

main();
````

```typescript
import { Semaphore } from "@apiratorjs/locking";

(async () => {
  const semaphore = new Semaphore(3);

  try {
    const data = await semaphore.runExclusive({ timeoutMs: 1000 }, async () => {
      console.log("Acquired one of the semaphore slots automatically.");
      return "Some data";
    });
  } catch (err: any) {
    console.error("Failed to acquire semaphore slot:", error.message);
  }

  console.log("Semaphore slot released automatically.");
})();
```

### Distributed Mutex

A distributed mutex (by default in this package) uses an in-memory store. This works within a single Node.js process (
e.g., multiple modules in the same process can share the same name).

> Important: For multi-process or multi-instance environments, use additional backend-specific packages (
> e.g., [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis)).

```typescript
import { DistributedMutex, types } from "@apiratorjs/locking";

async function main() {
  // Create a distributed mutex identified by a unique name
  const mutex = new DistributedMutex({ name: "shared-mutex" });

  let releaser: types.IReleaser;

  try {
    releaser = await mutex.acquire();
    // Exclusive access across the same process or
    // (with an alternate backend) across multiple processes
    console.log("Distributed mutex acquired, performing critical operation.");
  } finally {
    // Always release the mutex
    await releaser.release(token);
  }
}

main();
```

```typescript
import { DistributedMutex } from "@apiratorjs/locking";

(async () => {
  const mutex = new DistributedMutex({ name: "shared-distributed-mutex" });

  const result = await mutex.runExclusive(async () => {
    console.log("Distributed mutex locked automatically (single-process in-memory by default).");
    return 123;
  });

  console.log("Distributed mutex released automatically. Result =", result);
})();
```

Timeouts

```typescript
import { DistributedMutex, types } from "@apiratorjs/locking";

async function main() {
  const mutex = new DistributedMutex({ name: "shared-resource" });

  let releaser: types.IReleaser;

  try {
    releaser = await mutex.acquire({ timeoutMs: 3000 });
    // Perform operations
  } catch (error: any) {
    console.error("Failed to acquire distributed mutex:", error.message);
  } finally {
    await releaser?.release();
  }
}

main();
```

### Distributed Semaphore

A distributed semaphore (by default, also in memory for this package) allows a specified maximum number of holders.

> Important: For multi-process or multi-instance environments, use additional backend-specific packages (
> e.g., [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis)).

```typescript
import { DistributedSemaphore, types } from "@apiratorjs/locking";

async function main() {
  // Create a distributed semaphore with max 3 concurrent holders
  const semaphore = new DistributedSemaphore({
    name: "shared-semaphore",
    maxCount: 3
  });

  let releaser: types.IReleaser;

  try {
    releaser = await semaphore.acquire();
    // Perform operations that can be concurrently accessed up to 3 times
    console.log("Distributed semaphore acquired.");
  } finally {
    // Always release the semaphore
    await releaser?.release();
  }
}

main();
```

```typescript
import { DistributedSemaphore } from "@apiratorjs/locking";

(async () => {
  const semaphore = new DistributedSemaphore({
    name: "shared-distributed-semaphore",
    maxCount: 3,
  });

  const data = await semaphore.runExclusive(async () => {
    console.log("Distributed semaphore slot acquired automatically.");
    return "some result";
  });

  console.log("Distributed semaphore slot released automatically. Data =", data);
})();
```

Timeouts

```typescript
import { DistributedSemaphore, types } from "@apiratorjs/locking";

async function main() {
  const semaphore = new DistributedSemaphore({
    name: "shared-resource",
    maxCount: 2
  });

  let releaser: types.IReleaser;

  try {
    releaser = await semaphore.acquire({ timeoutMs: 5000 });
    // Perform operations within concurrency limit
  } catch (error: any) {
    console.error("Failed to acquire distributed semaphore:", error.message);
  } finally {
    await releaser?.release();
  }
}

main();
```

---

### Cancellation

You can cancel all pending waits for either a Semaphore or a Mutex (and their distributed versions) by calling:

```typescript
await semaphore.cancelAll("Custom error message");
// or
await mutex.cancel("Custom error message");
```

Any callers waiting to acquire will receive a rejection with the provided message.

---

### Switching to a Real Distributed Backend

By default, `DistributedMutex` and `DistributedSemaphore` use an in-memory store. This does not provide real
cross-process synchronization if you run multiple Node.js processes or servers.

If you need actual distributed locking, install an additional package such
as [@apiratorjs/locking-redis](https://github.com/apiratorjs/locking-redis) (coming soon), which plugs into this library
to enable Redis-based locking primitives. You would then configure the `DistributedMutex.factory` or
`DistributedSemaphore.factory` to use the Redis-based constructor, for example:

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
`DistributedSemaphoreFactory`, `DistributedMutexFactory` interfaces. And apply them:

```typescript
DistributedMutex.factory = (props: DistributedMutexConstructorProps) => IDistributedMutex;

DistributedSemaphore.factory = (props: DistributedSemaphoreConstructorProps) => IDistributedSemaphore;
````

---

## Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/locking).
