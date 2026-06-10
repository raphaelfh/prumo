# Error swallowing (prumo)

Error swallowing = an error happens, the code catches it, and then **pretends nothing went wrong**. The user sees a green tick, the data is in an inconsistent state, and the bug surfaces three days later as "the feature mysteriously doesn't work".

This was the dominant bug class in commit `5493631 fix(frontend): resolve 17 auto-found extraction hook + service bugs`. Half the auto-found bugs were `.catch(() => ({ success: true }))` and friends.

## The four shapes to watch for

### 1. The fake-success catch

```ts
// WRONG
await mutate(args).catch(() => ({ success: true }));

// Also WRONG
try {
  await something();
} catch {
  return { ok: true };
}
```

If the call can fail, the caller must learn it failed. Either re-throw, return a typed error, or surface to the user.

```ts
// RIGHT
const result = await mutate(args).catch((err) => {
  log.error("mutate failed", { err });
  throw err;
});
```

Or — and this is usually what you want — let it throw, and handle it in the React Query / mutation layer with `onError`.

### 2. Promise.all when you meant allSettled

```ts
// WRONG — first rejection cancels everything, others' results are lost
const [a, b, c] = await Promise.all([loadA(), loadB(), loadC()]);
```

If any one of `loadA/B/C` failing should still let the others' data render, you need `Promise.allSettled`:

```ts
// RIGHT
const [aRes, bRes, cRes] = await Promise.allSettled([loadA(), loadB(), loadC()]);
const a = aRes.status === "fulfilled" ? aRes.value : DEFAULT;
if (bRes.status === "rejected") log.warn("loadB failed", bRes.reason);
// ...
```

Use `Promise.all` only when "any failure = whole operation failed" is the actual semantics.

### 3. Empty result mistaken for success

```python
# WRONG
rows = await db.execute(select(Foo).where(Foo.project_id == pid))
items = rows.scalars().all()
return {"items": items}  # if RLS hid everything, you return [] silently
```

On prumo, an empty list is almost always **suspicious**. It usually means the caller doesn't have access (RLS filtered the rows) or you forgot a membership check. Either:

- Verify the caller has access *first* with `ensure_project_member`, then trust the empty list as real.
- Or, log when the result is empty and there was no membership check, so this gets caught in dev.

```ts
// WRONG (frontend)
const { data } = useQuery({ ... });
if (!data) return null;          // empty array? loading? error? we don't know
```

Distinguish `isLoading`, `error`, and `data.length === 0`. They are three different UI states.

### 4. Bare except / except Exception: pass

```python
# WRONG
try:
    await celery_task.delay(arg)
except Exception:
    pass  # task didn't enqueue, user gets a green tick anyway
```

If you must catch broadly (e.g. external API), log + re-raise or convert to a domain exception. Never `pass`.

```python
# RIGHT
try:
    await celery_task.delay(arg)
except Exception as e:
    log.exception("celery enqueue failed", task=celery_task.name)
    raise TaskEnqueueError("Could not enqueue extraction") from e
```

## Audit greps

```sh
# Frontend
grep -RnE '\.catch\(\s*\(\)\s*=>' frontend/
grep -RnE '\.catch\(\s*[a-zA-Z_]+\s*=>\s*\(\{' frontend/   # catch returning literal
grep -Rn 'Promise\.all\b' frontend/                          # audit each one for allSettled fit

# Backend
grep -RnE 'except\s*:' backend/                              # bare except
grep -RnE 'except .*:\s*$' backend/                          # potentially silent
grep -RnA1 'except .*:' backend/ | grep -B1 -E 'pass$|return'
```

## When a swallow is actually correct

Rare, but it exists. Acceptable cases:

- **Logging that itself fails.** If `log.error` raises, you don't want to mask the original exception. Wrap log calls in `try/except` that *swallow* — that is the one acceptable case.
- **Cleanup paths.** A `finally` block doing best-effort cleanup can swallow, but log the failure.
- **Optional side-effects** with a documented retry path. E.g. a "send a notification" call that's allowed to fail because a Celery job will retry. **Comment must say so.**

If you swallow on purpose, write a comment explaining why. A reviewer should not have to guess.

## Test patterns

```python
async def test_endpoint_surfaces_celery_failure(client, monkeypatch):
    monkeypatch.setattr(celery_task, "delay", _raise)
    response = await client.post("/api/v1/...", json={...})
    assert response.status_code == 503  # not 200
```

For every code path that might swallow, write the test that confirms the failure surfaces.

## Historical incidents

- `5493631 fix(frontend): resolve 17 auto-found extraction hook + service bugs` — the bulk were `.catch(() => ({success: true}))` patterns inside extraction hooks.
- `1994ceb fix(backend): resolve 31 auto-found bugs` — several were `except Exception: pass` in HITL services.

When you touch the extraction or HITL stack, grep the patterns above. The fixes don't immunize new code.
