# Release notes — @apiratorjs/locking 7.0.0

Semaphore permits can now be handed over and can expire. A permit is identified by its token: it can be released, extended or inspected somewhere other than where it was acquired - for example in a job queue worker - and a `ttlMs` gives it back automatically if its holder gets lost. This is a major release because the semaphore interfaces gained new required members. Code that only uses the semaphores shipped with this package upgrades without changes.

## Breaking change

`ISemaphore` and `IDistributedSemaphore` now require `restoreReleaser(token)`, and their `acquire()` / `tryAcquire()` return `ISemaphoreReleaser` - an `IReleaser` with `extend()`, `remainingTtl()` and `isHeld()`. Custom backends such as Redis or Postgres, and hand-written implementations or test doubles of these interfaces, must add them.

## Highlights

- **`ttlMs`** when acquiring a semaphore permit: once it runs out, the permit goes back as if released. It counts from the moment the permit is granted, not from the call. `Infinity` means no TTL.
- **`restoreReleaser(token)`** rebuilds the releaser of a permit from its token.
- **`extend(ttlMs)`**, **`remainingTtl()`** and **`isHeld()`** on the semaphore releaser. `extend(Infinity)` removes the TTL.
- **Release is idempotent per token**, across every releaser of that token. A holder whose permit already expired cannot release the permit of whoever got it next.
- **Without `ttlMs`** the in-memory semaphores hold the permit until it is released; backends whose permits outlive the process are expected to default to a finite TTL.
- An expiring permit keeps the process alive only while somebody is queued for it.

## At a glance

```typescript
import { InMemoryDistributedLockManager } from "@apiratorjs/locking";

const locks = new InMemoryDistributedLockManager();
const semaphore = locks.semaphore("exports", 3);

// Producer: take a slot or skip, and hand the permit over to the job
const releaser = await semaphore.tryAcquire({ ttlMs: 10 * 60_000 });
if (!releaser) {
  return; // all slots busy
}
await queue.add("export", { permitToken: releaser.getToken() });

// Worker
const permit = semaphore.restoreReleaser(job.data.permitToken);
if (!(await permit.isHeld())) {
  return; // expired while waiting in the queue
}

try {
  // ... work, calling permit.extend(10 * 60_000) while it goes on
} finally {
  await permit.release();
}
```

The in-memory semaphores keep permits in the current process, so tokens can only be restored there; handing permits over between processes needs a backend such as `@apiratorjs/locking-redis`.

Full details and the migration checklist for backend authors: [CHANGELOG.md](./CHANGELOG.md).
