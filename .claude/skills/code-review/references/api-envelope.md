# ApiResponse envelope rules (prumo)

Every API response on prumo is wrapped in an `ApiResponse` envelope. The envelope adds consistency (an `ok` flag, a structured `error`, a `trace_id`) and makes it possible to evolve the response without breaking clients. **But every envelope drift on prumo has cost a bug.**

## The envelope

```jsonc
{
  "ok": true | false,
  "data": <payload> | null,
  "error": null | { "code": "...", "message": "...", "details": null | { ... } },
  "trace_id": "<uuid>"
}
```

Real shape (`backend/app/schemas/common.py` → `ApiResponse`): `{ ok, data, error, trace_id }` — there is **no** top-level `meta`. The frontend client checks `responseData.ok` and reads `error.message`. Pagination lives *inside* `data` via `PaginatedResponse`, not a top-level field. The payload is whatever the endpoint returns — an object, a list, a UUID, a boolean. The envelope is *always* the outer shape.

## The four envelope sins

### 1. Bare-payload endpoints

```python
# WRONG
@router.get("/things")
async def list_things() -> list[Thing]:
    return [...]

# RIGHT
@router.get("/things")
async def list_things() -> ApiResponse[list[Thing]]:
    return ApiResponse(data=[...])
```

If a single endpoint returns the bare payload while everything else returns the envelope, the client's generic `unwrap` function will mis-handle one or the other. Bug shipped.

### 2. Double unwrap on the frontend

```ts
// WRONG — fetcher already unwraps `.data`
const { data } = useQuery({
  queryFn: async () => {
    const res = await api.get<Thing>("/things/1");
    return res.data;     // res is already the payload, this is res.payload.data === undefined
  },
});
```

This was the exact shape of commit `7100956 fix(qa): drop double-unwrap of ApiResponse envelope in useRunAIExtraction`. Pattern: one layer unwraps, then another layer unwraps again, and the resulting data is `undefined`.

**Rule:** pick a layer (`api.get` / `api.post` typed helper) that unwraps once, and **never unwrap again** in hooks or components. If the helper doesn't unwrap, then the hook unwraps once and that's it.

Document which layer unwraps. In prumo, the typed `api.*` helpers (frontend `lib/api/...`) unwrap `.data` for you and surface `.error` as a thrown error. So hooks receive the bare payload.

### 3. Single-unwrap inconsistency between queries and mutations

```ts
// Hook A (query) — gets the payload directly
const { data: thing } = useQuery({ queryFn: () => api.get("/things/1") });

// Hook B (mutation) — gets the envelope because mutation helper doesn't unwrap
const mutation = useMutation({ mutationFn: () => api.post("/things") });
// later: mutation.data is { data: Thing, error: null }, not Thing
```

If the typed helpers don't apply uniformly to queries and mutations, half your hooks see `Thing` and the other half see `{data: Thing, ...}`. Pick one. The convention on prumo is: **both query and mutation helpers unwrap, both throw on `error`**.

### 4. Error envelope ignored

```ts
// WRONG — assumes throw on error, but the helper might return { data: null, error: {...} }
const result = await api.post("/things");
queryClient.setQueryData(key, result.data);  // null, oops
```

The error envelope must be either thrown by the helper (preferred) or visibly checked at the call site. Silent `null`-handling masks failures and stale-caches bad data.

## The prumo convention (stick to it)

- **Backend**: every endpoint declares `ApiResponse[T]` in the return type. Errors bubble up via `HTTPException` and the global handler wraps them in the envelope.
- **Frontend typed helpers** (`frontend/lib/api/*.ts`): unwrap `.data`, throw on `.error`. They are the single layer of unwrap.
- **Hooks and components**: receive the bare payload. They do **not** access `.data` on the result.
- **Mutations**: same as queries. The mutation helper unwraps and throws.

Any deviation from this convention is a defect, even if it works today — it will trip up the next developer.

## Audit greps

```sh
# Endpoints declaring return type that is NOT ApiResponse
grep -RnE 'async def [a-z_]+\([^)]*\)\s*->\s*[A-Za-z]' backend/app/api/v1/endpoints/ | grep -v "ApiResponse"

# Hooks / fetchers double-accessing .data
grep -Rn "\.data\.data" frontend/
grep -Rn "res\.data\.data\|response\.data\.data" frontend/

# Helpers returning envelope where hooks treat them as payload (manual review)
grep -RnB2 -A6 "useQuery\|useMutation" frontend/hooks/ | head -200
```

## Test patterns

```python
def test_endpoint_returns_envelope(client, ...):
    r = client.get("/api/v1/things/1")
    assert r.status_code == 200
    body = r.json()
    assert "data" in body and "error" in body
    assert body["error"] is None
```

```ts
// Vitest — hook returns bare payload, not envelope
it("returns the thing, not the envelope", async () => {
  const { result } = renderHook(() => useThing("1"), { wrapper });
  await waitFor(() => expect(result.current.data?.id).toBe("1"));
  // negative assertion catches accidental double-wrap:
  expect((result.current.data as any)?.data).toBeUndefined();
});
```

## Historical incidents

- `7100956 fix(qa): drop double-unwrap of ApiResponse envelope in useRunAIExtraction` — exactly this bug.
- Several of the 17 auto-found frontend bugs in commit `5493631` were envelope inconsistencies between query and mutation flows.

## Bottom line

One envelope. One unwrap layer. One convention. Drift is a defect. Grep the patterns above whenever you touch `frontend/lib/api/` or any endpoint return signature.
