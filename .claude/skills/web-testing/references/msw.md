# MSW v2 — deep dive

Read this when designing handlers in `frontend/test/mocks/` or overriding them per-test. MSW v2 changed the import surface and request matching — old `rest.get` style is gone.

## 1. Handler anatomy

```ts
import { http, HttpResponse, delay } from 'msw';

http.get('*/api/v1/runs/:runId', async ({ params, request }) => {
  await delay(50);                                       // optional latency
  const url = new URL(request.url);
  const includeEvidence = url.searchParams.get('include_evidence') === 'true';
  return HttpResponse.json({
    ok: true,
    data: { id: params.runId, stage: 'PROPOSAL', evidence: includeEvidence ? [] : undefined },
    trace_id: 'mock-trace',
  });
});
```

Key changes from v1:
- `rest.get` → `http.get`.
- Handler returns `HttpResponse` (or throws); no `res()` callback.
- `params` is typed when you type the URL: `http.get<{ runId: string }>(...)`.
- `request` is a standard `Request` — use `request.json()`, `request.text()`, `request.headers.get(...)`.

## 2. URL matching

Patterns from most permissive to most specific:

| Pattern                                       | Matches                                                  |
|-----------------------------------------------|----------------------------------------------------------|
| `'*'`                                         | Any URL (catch-all; use only in `server.use` for one assertion). |
| `'*/api/v1/runs'`                              | Any host, exact path.                                    |
| `'*/api/v1/runs/:id'`                          | Path param.                                              |
| `'*/api/v1/runs/:id/evidence'`                 | Multi-segment.                                           |
| `'http://localhost:8000/api/v1/runs'`          | Exact origin + path (avoid; brittle on env switch).      |

Prefer `'*/...'` — the host can vary by `VITE_API_URL` and you don't want handlers to silently miss.

## 3. Order matters

Handlers registered later don't override earlier ones — they're matched **first-match-wins**. `server.use(...)` *prepends* to the chain, so per-test handlers correctly override defaults:

```ts
// frontend/test/mocks/server.ts
const handlers = [
  http.get('*/api/v1/runs/:id', () => HttpResponse.json({ ok: true, data: { stage: 'PENDING' } })),
];
export const server = setupServer(...handlers);

// in a test
server.use(
  http.get('*/api/v1/runs/:id', () => HttpResponse.json({ ok: true, data: { stage: 'PUBLISHED' } }))
);
// the per-test handler wins
```

## 4. Capturing the request

```ts
let captured: { body: unknown; headers: Record<string, string> } | null = null;
server.use(
  http.post('*/api/v1/hitl/sessions', async ({ request }) => {
    captured = {
      body: await request.json(),
      headers: Object.fromEntries(request.headers),
    };
    return HttpResponse.json({ ok: true, data: { id: 'sess-1' } }, { status: 201 });
  })
);
// ... trigger the UI action
expect(captured?.body).toEqual({ kind: 'extraction', project_template_id: '...' });
expect(captured?.headers['x-trace-id']).toBeTruthy();
```

`request.json()` is one-shot. If you need to read the body twice, `request.clone().json()`.

## 5. Status codes and errors

```ts
return HttpResponse.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });

return new HttpResponse(null, { status: 204 });            // no body
return HttpResponse.text('plain', { status: 200 });
return HttpResponse.error();                                // network error
```

`HttpResponse.error()` triggers a true network failure in the client — useful for testing retry logic and error boundaries.

## 6. Streaming / SSE

```ts
http.get('*/api/v1/runs/:id/events', () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: stage\ndata: REVIEW\n\n'));
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode('event: stage\ndata: PUBLISHED\n\n'));
        controller.close();
      }, 100);
    },
  });
  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});
```

We don't use SSE in prumo today, but pattern is here when we do.

## 7. Unhandled requests fail loudly

`server.listen({ onUnhandledRequest: 'error' })` in `frontend/test/setup.ts` means any unmocked request crashes the test. Keep this. If you really want a permissive default for one test:

```ts
server.use(
  http.all('*', () => HttpResponse.json({})),  // catch-all, dangerous
);
```

But this almost always means you missed a handler. Don't ship it.

## 8. Per-test reset is automatic

```ts
// frontend/test/setup.ts
afterEach(() => {
  server.resetHandlers();   // restore baseline handlers, drop per-test ones
});
```

So `server.use(...)` is automatically scoped to one test. Don't manually `server.resetHandlers()` mid-test — re-register instead.

## 9. Testing optimistic updates with delay

```ts
server.use(
  http.post('*/api/v1/hitl/sessions/:id/publish', async () => {
    await delay(300);                                       // simulate latency
    return HttpResponse.json({ ok: true, data: { stage: 'PUBLISHED' } });
  })
);

const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: /publish/i }));
// during the 300ms window, the UI should show optimistic state
expect(screen.getByText(/publishing/i)).toBeInTheDocument();
await screen.findByText(/published/i);
```

`delay` is awaited inside the handler; the test still resolves naturally via `findBy*`.

## 10. Common pitfalls

| Symptom                                                        | Cause                                                      | Fix                                                            |
|----------------------------------------------------------------|------------------------------------------------------------|----------------------------------------------------------------|
| Test fails with `onUnhandledRequest: 'error'` on a real URL    | Handler URL doesn't match (host mismatch, missing `*/`)    | Switch to `'*/api/...'` glob.                                   |
| Handler returns but test still sees stale data                  | TanStack Query cached; `gcTime` not zeroed                 | Fresh `QueryClient` per test with `gcTime: 0, retry: false`.    |
| Mock works in isolation, breaks in suite                        | Handler order; earlier handler caught the request          | Use `server.use(...)` which prepends. Audit `setup.ts` baseline.|
| `request.json()` throws "Body already consumed"                 | Read twice                                                  | `await request.clone().json()` if you need a second pass.       |
| `params` is `never`                                              | URL pattern doesn't declare params                         | Add `:id` to the path; type with `http.get<{ id: string }>`.    |

## 11. When NOT to use MSW

- **Module-level mocks** (Zustand store, `lib/copy/useLocale`, time): use `vi.mock` instead — MSW intercepts HTTP, not function calls.
- **Backend integration tests** (pytest): never. Use real Postgres. MSW is frontend-only.
- **Playwright E2E**: prefer `page.route` for backend response shaping; MSW only runs inside the test process, not in the browser tab driven by Playwright.

## 12. Resources to skim

- MSW v2 docs: https://mswjs.io/docs/
- Migration from v1 (if you find a stale handler): https://mswjs.io/docs/migrations/1.x-to-2.x/
