# Release notes — @apiratorjs/locking 9.0.0

Locks with a TTL can now outlive the TTL safely: `LeaseKeeper` extends a semaphore permit or a mutex lock while slow work
runs and tells the work when the lease is lost.

## Breaking change

**Requires Node.js 17.2.0 or newer** (was 16.4.0): the lost-lease error is the reason of the `AbortSignal`, and
`AbortController.abort(reason)` ignores the reason before 17.2. The API is unchanged: code and backends written for 8.x
keep working; backend packages only need to widen their `@apiratorjs/locking` range to `^9.0.0`.

## Highlights

- **`LeaseKeeper.hold(releaser, options, work)`** - extends the lease every `extendIntervalMs` to `ttlMs` while `work`
  runs, releases it afterwards (also on errors).
- **`signal` and `throwIfLost()`** in the work context - an `AbortSignal` aborted once an extension returns `false` or
  fails, and a check to call before committing.
- **`LeaseLostLockingError`** - the reason of that signal.
- Works with every backend: it only needs `ILeaseReleaser` (`extend()` / `release()`).

## At a glance

```typescript
const releaser = await locks.mutex("taxonomy").acquire({ ttlMs: 60_000 });

await LeaseKeeper.hold(releaser, { ttlMs: 60_000, extendIntervalMs: 10_000 }, async ({ signal, throwIfLost }) => {
  const result = await fetch(url, { signal });
  throwIfLost();
  await save(result);
});
```

The TTL now means "how long others wait if the holder dies", not "how long the work may take".

Full details: [CHANGELOG.md](./CHANGELOG.md).
