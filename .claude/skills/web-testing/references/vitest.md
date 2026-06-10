# Vitest (frontend) — deep dive

Read this when writing tests under `frontend/test/` or `frontend/**/*.test.tsx`. SKILL.md covers the rules; this is the playbook.

## 1. Config in plain terms

`vitest.config.ts`:
- `globals: true` — `describe/it/expect` available without import.
- `environment: 'jsdom'` — DOM globals (`document`, `window`) available.
- `setupFiles`: `frontend/test/mocks/localStorage.ts` (must load first), `frontend/test/setup.ts` (MSW + RTL cleanup + jest-dom matchers).
- Path alias `@` -> `./frontend`. Use it: `import { foo } from '@/lib/copy'`.
- Coverage threshold: 70% across branches/functions/lines/statements.

## 2. Component test recipe

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ConsensusPanel } from '@/components/extraction/ConsensusPanel';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('ConsensusPanel', () => {
  it('shows manual_override when reviewers disagree', async () => {
    renderWithProviders(<ConsensusPanel runId="run-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /resolve/i }));
    expect(await screen.findByText(/manual override/i)).toBeInTheDocument();
  });
});
```

**Per-test `QueryClient`** is non-negotiable — sharing leaks cache between tests and produces non-deterministic ordering bugs.

## 3. Hook tests

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { useReviewerSummary } from '@/hooks/useReviewerSummary';

it('exposes loading then data', async () => {
  const { result } = renderHook(() => useReviewerSummary('run-1'), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }}})}>
        {children}
      </QueryClientProvider>
    ),
  });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.data).toBeDefined());
});
```

Use `waitFor` for state transitions inside hooks; use `findBy*` for DOM in component tests.

## 4. `vi.mock` patterns

### Partial mocks — preserve the rest of the module

```ts
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    fetchAuthToken: vi.fn(() => 'mock-token'),
  };
});
```

### Hoisting trap

`vi.mock` is hoisted to the top of the file. Variables referenced inside the factory must be `vi.hoisted`:

```ts
const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(() => ({ id: 'u-1' })),
}));

vi.mock('@/lib/auth', () => ({ getUser: mockGetUser }));

// In tests:
mockGetUser.mockReturnValueOnce({ id: 'u-2' });
```

### Resetting between tests

```ts
beforeEach(() => {
  vi.clearAllMocks(); // resets call counts, keeps implementations
  // vs vi.resetAllMocks() which also resets implementations
  // vs vi.restoreAllMocks() which restores spies to originals
});
```

## 5. Time control

```ts
import { vi } from 'vitest';

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-05-17T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

it('advances by 5s', () => {
  vi.advanceTimersByTime(5000);
});
```

**Pitfall:** `await` inside fake timers can hang because microtasks don't tick. Use `vi.advanceTimersByTimeAsync(...)` for promise-based code.

## 6. MSW v2 in practice

The setup at `frontend/test/mocks/server.ts` registers a few defaults; **all other handlers come per-test via `server.use(...)`**. `onUnhandledRequest: 'error'` means an unmocked request crashes the test — keep that.

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';

it('publishes on click', async () => {
  let captured: unknown;
  server.use(
    http.post('*/api/v1/hitl/sessions/:id/publish', async ({ request }) => {
      captured = await request.json();
      return HttpResponse.json({ ok: true, data: { stage: 'PUBLISHED' } });
    })
  );
  // ... render + click + assert
  expect(captured).toEqual({ confirmed: true });
});
```

The setup's `afterEach` calls `server.resetHandlers()`, so per-test handlers don't leak. **Don't `server.close()` mid-test** — the next test will fail.

More handler patterns in [`msw.md`](msw.md).

## 7. `expect.poll`

For non-mocked async (jest-dom timing, intersection observer, etc.):

```ts
await expect.poll(() => screen.queryByText(/loaded/i), {
  timeout: 5000,
  interval: 100,
}).not.toBeNull();
```

Prefer `findByText` when you can — `poll` is for non-DOM assertions.

## 8. In-source testing

Vitest 2 supports tests adjacent to the implementation (Rust-style). We don't use it project-wide but it's fine for small pure utilities:

```ts
// frontend/lib/copy/format.ts
export function pluralize(n: number, one: string, other: string) {
  return n === 1 ? one : other;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it('pluralizes', () => {
    expect(pluralize(1, 'item', 'items')).toBe('item');
    expect(pluralize(2, 'item', 'items')).toBe('items');
  });
}
```

Add `includeSource: ['frontend/**/*.{ts,tsx}']` to `vitest.config.ts` and a `defineConfig` flag if you go this route. Currently off by default — don't enable it ad-hoc in one file.

## 9. Browser mode (real DOM)

`@vitest/browser` runs tests in a real browser via Playwright transport. Useful when jsdom diverges from real-DOM behavior (CSS layout, ResizeObserver, focus management). Heavy — only reach for it when jsdom-based assertions are insufficient.

```ts
// vitest.config.ts addition
test: {
  browser: { enabled: true, name: 'chromium', provider: 'playwright', headless: true },
}
```

Don't mix jsdom and browser-mode in the same run — split into `vitest.unit.config.ts` and `vitest.browser.config.ts`.

## 10. Snapshots (use sparingly)

```ts
expect(result).toMatchInlineSnapshot();  // fills on first run
```

Snapshots are noisy in PR review. Prefer explicit `expect(x).toBe(...)` for primitives; use snapshots only for stable serialized output (e.g. a normalized AST).

## 11. Coverage

```bash
npx vitest run --coverage
open coverage/index.html
```

Threshold is 70% in `vitest.config.ts`. CI fails below that. Coverage is per-PR aspirational, not per-file.

## 12. Anti-patterns

| Anti-pattern                                   | Why it hurts                                            | Do instead                                          |
|------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------|
| Sharing `QueryClient` across tests             | Cache leaks; non-deterministic                          | Fresh client per test                               |
| `screen.getByText(...)` for async UI           | Throws synchronously before the element appears         | `await screen.findByText(...)`                      |
| `setTimeout` in a test                         | Race condition disguised as a wait                       | `expect.poll` or real fake timers                   |
| `vi.mock('@/hooks/useFoo')` for everything     | Loses integration coverage; replaces React with stubs   | MSW for network; mock modules only when unavoidable |
| `data-testid` everywhere                       | Couples tests to internals                              | Role/label queries first                            |
| Skipping `userEvent.setup()` per test          | Pointer state leaks                                     | Call once per `it` block                            |
