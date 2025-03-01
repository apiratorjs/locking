# @apiratorjs/locking

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/locking.svg)](https://www.npmjs.com/package/@apiratorjs/locking)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/locking.svg)](https://github.com/apiratorjs/locking/blob/main/LICENSE)

A lightweight Node.js library providing both local and distributed locking primitives—mutexes and semaphores—for managing concurrency and ensuring synchronization in asynchronous operations. Designed for single-process as well as multi-instance environments, it supports distributed locking backends such as Redis.

> **Note:** Requires Node.js version **>=16.4.0**

---

## Features

### Local Locking Primitives

- **Mutex**
  - Immediate lock acquisition and release.
  - Waits for lock availability with configurable timeouts.
  - Supports cancellation of pending acquisitions.

- **Semaphore**
  - Configurable concurrent access limits.
  - Implements timeout and cancellation for pending acquisitions.
  - Limits concurrent access as specified.

### Distributed Locking Primitives

- **Distributed Mutex and Semaphore**
  - Built-in support for distributed locking using backends like Redis via abstraction and additional packages.
  - Enables coordination and synchronization across multiple processes or machines.
  - Ideal for scaling applications in distributed environments.

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

### Local Mutex

```typescript
import { Mutex } from "@apiratorjs/locking";

(async () => {
  const mutex = new Mutex();

  // Acquire the mutex.
  await mutex.acquire();

  try {
    // Critical section: perform operations that require exclusive access.
    console.log("Mutex acquired, performing critical operation.");
  } finally {
    // Always release the mutex.
    await mutex.release();
  }
})();
```

### Local Semaphore

```typescript
import { Semaphore } from "@apiratorjs/locking";

(async () => {
  // Create a semaphore allowing up to 3 concurrent operations.
  const semaphore = new Semaphore(3);

  // Acquire the semaphore.
  await semaphore.acquire();

  try {
    // Critical section: perform operations that require limited concurrent access.
    console.log("Semaphore acquired, performing concurrent operation.");
  } finally {
    // Always release the semaphore.
    await semaphore.release();
  }
})();
```

### Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/locking).
