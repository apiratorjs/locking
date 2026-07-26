# Release notes — @apiratorjs/locking 5.0.0

Major rewrite of the distributed locking surface. Local `Mutex`, `Semaphore`, and `ReadWriteLock` remain; how you obtain and back distributed locks has changed.

## Highlights

- **`InMemoryDistributedLockManager`** replaces `DistributedMutex` / `DistributedSemaphore` / `DistributedReadWriteLock` and the global `InMemoryDistributedRegistry`.
- Backends implement **`IDistributedLockManager`** instead of patching static `.factory` hooks.
- **`cancel()` / `cancelAll()`** only reject waiters — held locks stay held.
- **`timeoutMs: 0`** fails immediately instead of falling back to the default timeout.
- Safer `ReadWriteLock` (no reader/writer race from two independent semaphores) and idempotent `release()`.

## Upgrade in one glance

```typescript
// 4.x
import { DistributedMutex } from "@apiratorjs/locking";
const mutex = new DistributedMutex({ name: "orders" });

// 5.x
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";
const locks = new InMemoryDistributedLockManager();
const mutex = locks.mutex("orders");
```

Types under `types` were renamed with a `T` prefix (`AcquireParams` → `TAcquireParams`, and so on).

Full migration notes, type rename table, and behavior details: [CHANGELOG.md](./CHANGELOG.md).
