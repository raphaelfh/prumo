# TanStack Query cache playbook (prumo)

Stale-cache bugs are silent. The user clicks a button, the mutation succeeds on the server, the cache shows the old data, the user reloads and the change "magically" appears. They assume their click failed and click again.

Most stale-cache bugs on prumo are one of three things: a missing scope in the cache key, a missing `invalidateQueries` after a mutation, or a key shape mismatch between the writer and the reader.

## Cache-key conventions

A cache key on prumo must include **every variable that scopes the data**:

```ts
// WRONG — global, leaks between projects
queryKey: ["runs"]

// WRONG — scoped to project but not run
queryKey: ["run-detail", projectId]

// RIGHT — the factory key carries the id that identifies the run
queryKey: runsKeys.detail(runId) // ["runs", runId]
```

Minimum scopes by data type:

| Data                                | Required scope                                |
| ----------------------------------- | --------------------------------------------- |
| Project list                        | userId implicit via auth; no extra needed     |
| Project detail                      | `projectId`                                   |
| Run list                            | `projectId`                                   |
| Run view (`runsKeys.detail`)        | `runId` (unique across projects)              |
| Article text blocks                 | `articleFileId` (see `useArticleTextBlocks.ts:41`)|
| Decision list per article in run    | `projectId`, `runId`, `articleId`             |
| HITL session                        | `projectId`, `runId`, `kind`                  |
| Templates list (project)            | `projectId`                                   |

Invalidation matches by prefix: invalidating `["foo", a]` refetches readers of `["foo", a]` and `["foo", a, b]`, while invalidating `["foo", a, b]` misses a reader of `["foo", a]`. **The invalidated key must be a prefix of the reader's key.** Use the same key-builder function for both reader and invalidator.

## Invalidation patterns

```ts
// Mutation completes — invalidate the key of every reader it can affect
useMutation({
  mutationFn: ...,
  onSuccess: (_, vars) => {
    // useRun: the run view (stage, instances, proposals, decisions, consensus)
    queryClient.invalidateQueries({ queryKey: runsKeys.detail(vars.runId) });
    // worklist progress: a prefix of the key useArticleExtractionValues reads
    queryClient.invalidateQueries({
      queryKey: articleExtractionValuesKeys.byCaller(vars.projectId, vars.templateId, vars.userId),
    });
  },
});
```

Checklist for any mutation:

- [ ] Detail key invalidated (the row that changed).
- [ ] List key invalidated (the list that may now order/filter differently).
- [ ] Cross-entity keys invalidated (a decision change invalidates the run view, `runsKeys.detail`, which carries consensus and published state).
- [ ] Every invalidated key has a reader: its factory member appears in a `useQuery`. Invalidating a key no `useQuery` reads compiles, runs, and refreshes nothing.
- [ ] If the server advances a run's stage as a side effect, `runsKeys.detail(runId)` is invalidated — otherwise the UI shows the old stage.

## Optimistic updates

Optimistic update without rollback = cache lies on failure.

```ts
useMutation({
  onMutate: async (vars) => {
    await queryClient.cancelQueries({ queryKey: key });
    const prev = queryClient.getQueryData(key);
    queryClient.setQueryData(key, optimistic);
    return { prev };
  },
  onError: (_err, _vars, ctx) => {
    if (ctx?.prev !== undefined) queryClient.setQueryData(key, ctx.prev);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
});
```

If `onError` is empty, you have a bug-in-waiting. Either implement rollback or remove the optimistic update.

## Autosave + invalidate interaction

See the header comment of `frontend/hooks/runs/useAutoSaveProposals.ts` — it is load-bearing:

> autosave writes through `apiClient` rather than a TanStack mutation, so it **does not** invalidate the run detail key; invalidating on every debounced tick would trigger a `GET /runs/{id}` per save.

That is a deliberate exception. The downside: the run-detail view can be slightly stale during typing. That's a UX tradeoff documented at the source. Don't replicate the pattern elsewhere without the same comment.

## When to use `setQueryData` vs `invalidateQueries`

- **`setQueryData`** when the server returned the full new representation. You can write it directly, no refetch needed.
- **`invalidateQueries`** when the server returned a partial result, or when the change affects other keys you don't have data for. Forces a refetch on next render.

Prefer `setQueryData` when possible — it's faster and avoids loading states. But only when you have the full payload.

## Audit greps

```sh
# All cache key definitions — eyeball whether they include the right scopes
grep -RnE "queryKey:\s*\[" frontend/

# Mutations that don't invalidate (suspicious)
grep -RnB2 -A20 "useMutation" frontend/hooks/ | grep -B22 "useMutation" | grep -v "invalidateQueries"

# Mutations missing onError but with onMutate (optimistic without rollback)
grep -RnB2 -A30 "onMutate" frontend/hooks/ | grep -B32 "onMutate" | grep -v "onError"
```

## Test patterns

Assert through the reader hook with MSW, not a spy on `invalidateQueries`: a spy passes for a key no `useQuery` reads. `wrapper` holds a fresh `QueryClient` per test.

```ts
it("refetches the run view after approve-finalize", async () => {
  let stage = "consensus";
  server.use(
    http.get("*/api/v1/runs/:runId/view", () =>
      HttpResponse.json({ ok: true, data: { run: { id: runId, stage } } })),
    http.post("*/api/v1/runs/:runId/approve-finalize", () => {
      stage = "finalized";
      return HttpResponse.json({ ok: true, data: {} });
    }),
  );
  const run = renderHook(() => useRun(runId), { wrapper });
  await waitFor(() => expect(run.result.current.data?.run.stage).toBe("consensus"));
  const finalize = renderHook(() => useApproveFinalize(runId), { wrapper });
  await act(() => finalize.result.current.mutateAsync());
  await waitFor(() => expect(run.result.current.data?.run.stage).toBe("finalized"));
});
```

## Historical incidents

- Several of the 17 frontend bugs in commit `5493631` were missing `invalidateQueries` after a mutation, or key shape mismatches between reader and writer.
- `373069b feat(extraction): unify Data Extraction with QA proposal-write pattern` — required a coordinated cache-key sweep across all extraction hooks; the fixes are the current convention.

## Bottom line

- Scope every cache key by every variable that scopes the data.
- Invalidate every key your mutation can affect — not just the obvious one.
- Optimistic updates without `onError` rollback are bugs.
- Use the same key-builder for readers and invalidators. No prose key construction.
