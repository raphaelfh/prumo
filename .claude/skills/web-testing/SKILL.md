---
name: web-testing
description: Use whenever writing, debugging, or designing tests for prumo — Playwright E2E (with a11y + visual), Vitest unit/component, pytest backend integration, MSW v2 network mocks, or whenever a test is flaky. Pulls in the right tool, the right fixture pattern, and the project rule that integration beats heavy mocking. Trigger on "test", "spec", "flaky", "Playwright", "Vitest", "pytest", "MSW", "axe", "snapshot", "visual regression", "test strategy", "mock the database", "test fixture", "CI test".
---

# Web Testing — prumo

Prumo's testing stack is pytest + Vitest + Playwright. The project memory is explicit: **integration tests beat heavily-mocked tests**. Past incidents had green mocked tests while the prod migration broke. Bias toward real Postgres in backend tests and real network with MSW in frontend tests.

## 1. Pyramid (prumo-shape)

The classic 70/20/10 doesn't fit this codebase. The DB schema is the structural heart (HITL/extraction stack); mocked DB tests have lied before. Skew toward integration.

| Layer            | Share | Stack                                                   | Wall-clock budget |
|------------------|-------|---------------------------------------------------------|-------------------|
| Unit             | ~40%  | Vitest (`frontend/test/*.test.ts`), pytest (`backend/tests/unit/`) | <50ms / test      |
| Integration      | ~45%  | pytest + real Postgres (`backend/tests/integration/`), Vitest + MSW | 100ms–2s / test   |
| E2E              | ~15%  | Playwright (`frontend/e2e/flows/`)                       | 5–30s / test      |

**Why integration-heavy:** RLS policies, migrations, deferred constraints, and the `extraction_*` workflow tables don't survive being mocked. Test the real composition.

## 2. Decision flow — which test to write

```
Is it pure logic (formatter, reducer, util)?       -> Vitest unit OR pytest unit
Does it touch the DB schema or an Alembic invariant? -> pytest integration (real Postgres, never mock)
Does it touch a React hook + TanStack Query?       -> Vitest component + MSW
Does it cross >=2 layers (UI -> API -> DB)?         -> Playwright E2E flow
Is the bug a race / timing / fixture leak?          -> read references/flakiness.md first
```

## 3. Commands

| Goal                                              | Command                                                                                |
|---------------------------------------------------|----------------------------------------------------------------------------------------|
| Full backend suite                                | `make test-backend`                                                                    |
| One backend test                                  | `cd backend && pytest tests/integration/test_run_lifecycle_service.py -k advance_pending` |
| Run backend tests with stdout                     | `cd backend && pytest -s -vv tests/path/to/test.py::test_name`                         |
| Full frontend unit suite                          | `npm test`                                                                             |
| One Vitest file                                   | `npx vitest run frontend/test/ConsensusPanel.test.tsx -t "renders"`                    |
| Vitest watch (TDD)                                | `npx vitest frontend/test/...`                                                         |
| Playwright (all projects)                         | `npx playwright test`                                                                  |
| Playwright UI mode (local dev)                    | `npx playwright test --ui`                                                             |
| Playwright single flow                            | `npx playwright test frontend/e2e/flows/extraction.e2e.ts --project=local-api`         |
| Playwright with trace viewer after a failure      | `npx playwright show-trace test-results/.../trace.zip`                                 |

The Playwright config (`playwright.config.ts`) defines four projects: `local-api`, `local-ui`, `local-hitl` (single-worker, stateful), `remote-smoke`. **HITL-stateful tests must stay pinned to `local-hitl`** — they share a project/article/template triple and parallelism causes runs to delete each other.

## 4. Backend — pytest (8+, async)

Config lives in `backend/pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

That means `async def test_*` is automatically wrapped — **don't** add `@pytest.mark.asyncio` unless you want explicit loop_scope control. The existing codebase still uses the decorator for clarity; match the surrounding file's style.

### 4.1 Two fixtures: `client` vs `db_client`

`backend/tests/conftest.py` exposes two HTTP fixtures:

- **`client`** — mocked DB + mocked auth. Use only for endpoints whose logic is dependency-light (input validation, 401 paths, transport plumbing). **Do not** use it to assert anything that depends on a real query plan or RLS.
- **`db_client`** — real Postgres session via `db_session`, mocked auth. Use this for everything touching `app/models/` or that needs RLS, triggers, FKs to hold. Default to this fixture.

Memory rule: if you're about to mock `AsyncSession.execute`, stop. Use `db_client`.

```python
# backend/tests/integration/test_my_feature.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_run_records_snapshot(db_client: AsyncClient, db_session) -> None:
    response = await db_client.post(
        "/api/v1/hitl/sessions",
        json={"kind": "extraction", "project_template_id": str(template_id), ...},
    )
    assert response.status_code == 201
    # Then read back through SQLAlchemy to confirm the row exists with the expected
    # invariants (deferred trigger, version snapshot, etc.).
    await db_session.rollback()  # leave the test DB clean for the next test
```

### 4.2 Rollback strategy

`db_session` is **function-scoped** and creates a fresh engine per test. You're responsible for `await db_session.rollback()` if you want to be polite to neighbors, but the per-test engine isolates you. Don't commit in tests unless you also clean up in a finally block.

### 4.3 Parametrize with ids

```python
@pytest.mark.parametrize(
    ("stage", "allowed"),
    [("PENDING", True), ("PROPOSAL", True), ("PUBLISHED", False)],
    ids=["pending-advances", "proposal-advances", "published-locked"],
)
async def test_stage_transition(stage, allowed, db_session): ...
```

`ids=` makes failure output greppable — `pytest -k published-locked` works.

### 4.4 Time and randomness

Use `freezegun` or `time-machine` (whichever is already a dep — check `pyproject.toml`) to pin clocks. For seeded random, set `random.seed` in a fixture, not module-level (module-level leaks across the session).

Deeper patterns: [`references/pytest.md`](references/pytest.md).

## 5. Frontend unit / component — Vitest 2+

Config at `vitest.config.ts`: `jsdom`, globals on, MSW server attached via `frontend/test/setup.ts`. Coverage threshold is 70% (branches/functions/lines/statements).

### 5.1 Test placement

| Test kind                          | Location                                  | Suffix          |
|------------------------------------|-------------------------------------------|-----------------|
| Hook / pure logic                  | `frontend/test/<name>.test.ts`            | `.test.ts`      |
| Component                          | `frontend/test/<name>.test.tsx`           | `.test.tsx`     |
| Co-located (rare; service tests)   | next to source as `<file>.test.tsx`       | `.test.tsx`     |

### 5.2 MSW v2 — runtime handlers, not module mocks

The setup at `frontend/test/mocks/server.ts` uses `http.get/post` style with `HttpResponse.json`. **Use `server.use(...)` to override per test, not `vi.mock`**, for anything that hits the network:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { renderHook, waitFor } from '@testing-library/react';

it('handles 409 conflict on publish', async () => {
  server.use(
    http.post('*/api/v1/hitl/sessions/:id/publish', () =>
      HttpResponse.json({ ok: false, error: { code: 'CONFLICT' } }, { status: 409 })
    )
  );
  const { result } = renderHook(() => usePublish(), { wrapper });
  await waitFor(() => expect(result.current.error?.code).toBe('CONFLICT'));
});
```

`onUnhandledRequest: 'error'` is set in setup — an unmocked request fails the test loudly. Good. Don't soften it.

### 5.3 `vi.mock` is for *modules*, not the network

Reserve `vi.mock` for swapping a sibling module (e.g. mocking `lib/copy` to a fixed locale, or stubbing a Zustand store) where MSW can't reach. Partial mocks:

```ts
vi.mock('@/lib/copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/copy')>();
  return { ...actual, useLocale: () => 'en' };
});
```

### 5.4 React Testing Library

- Query by role/name first, by label second, by test-id last. `screen.getByRole('button', { name: /publish/i })`.
- `userEvent.setup()` once per test; `await user.click(...)`. Don't share a `user` across tests.
- `findBy*` for anything async (TanStack Query, transitions). Never `waitFor(() => expect(getByText(...)))` — use `findByText`.

### 5.5 TanStack Query test wrapper

Always wrap with a fresh `QueryClient` per test, retries off, gcTime 0. There's likely a shared `renderWithProviders` helper — search `frontend/test/` before rolling your own.

Deeper patterns: [`references/vitest.md`](references/vitest.md) and [`references/msw.md`](references/msw.md).

## 6. E2E — Playwright 1.50+

Tests live under `frontend/e2e/`, two categories:
- `flows/*.e2e.ts` — API-driven flow tests (project `local-api`).
- `flows/*.ui.e2e.ts` — UI-driven flow tests (project `local-ui`).
- `flows/qa-*.e2e.ts`, `extraction-edit.ui.e2e.ts`, `hitl-*.api.e2e.ts` — stateful, single-worker (`local-hitl`).
- `remote/*.e2e.ts` — smoke against deployed env.

### 6.1 Fixtures live in `_fixtures/`

Don't reinvent them. Existing helpers:

| File                      | Purpose                                       |
|---------------------------|-----------------------------------------------|
| `auth.ts`                 | `resolveAuthToken(page)`, `loginViaUi(page)`  |
| `api.ts`                  | `expectEnvelopeOk`, `authHeaders`, envelope types |
| `hitl.ts`                 | HITL session/run helpers                       |
| `supabase-admin.ts`       | Service-role client for admin DB ops          |
| `storage.ts`              | Storage bucket setup/teardown                 |
| `console-errors.ts`       | Fail tests on stray console errors            |
| `env.ts`                  | E2E env var loading                            |
| `registry.ts`             | Cross-test resource registry                   |

Use them. New helpers go here, not inline.

### 6.2 `test.extend` over page-object classes

Page objects are only worth it when a flow exceeds ~50 lines of selector code. Prefer composable fixtures:

```ts
import { test as base, expect } from '@playwright/test';
import { resolveAuthToken } from '../_fixtures/auth';

type Fixtures = { authToken: string };
const test = base.extend<Fixtures>({
  authToken: async ({ page }, use) => {
    const token = await resolveAuthToken(page);
    await use(token);
  },
});

test('publishes an extraction run', async ({ page, authToken }) => { ... });
```

### 6.3 `expect.poll` over `waitFor` chains

For eventual consistency (Celery jobs, multi-reviewer consensus, run stage transitions):

```ts
await expect.poll(
  async () => (await api.getRun(runId)).stage,
  { timeout: 15_000, intervals: [200, 500, 1000] }
).toBe('REVIEW');
```

### 6.4 Traces — always on for failures

Config sets `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`. After a failing CI run, download the artifact and `npx playwright show-trace trace.zip` — don't try to debug from logs alone.

### 6.5 Selector hierarchy

1. `getByRole('button', { name: /save/i })` — semantic, a11y-friendly.
2. `getByLabel('Email')` — forms.
3. `getByTestId('publish-action')` — last resort, only if role/label don't disambiguate.

Avoid CSS selectors and XPath in new code.

### 6.6 Accessibility — bake `@axe-core/playwright` into flows

Add to any flow that renders a new page:

```ts
import AxeBuilder from '@axe-core/playwright';

test('extraction page is accessible', async ({ page }) => {
  await page.goto('/extraction/123');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

If a violation is intentional (third-party widget), disable that rule with `.disableRules(['color-contrast'])` and leave a comment with the ticket.

Deeper patterns: [`references/playwright.md`](references/playwright.md) and [`references/a11y.md`](references/a11y.md).

## 7. Visual regression

Playwright snapshots are stored alongside tests; diffs land in `test-results/`. Use sparingly — visual tests are heavy and easy to break with cosmetic refactors.

```ts
await expect(page).toHaveScreenshot('extraction-empty-state.png', {
  maxDiffPixels: 100,
  threshold: 0.2,
  mask: [page.locator('[data-testid="timestamp"]')], // mask volatile regions
});
```

Update baselines deliberately: `npx playwright test --update-snapshots <file>`. Review diffs in the HTML reporter before committing.

## 8. Determinism — the four levers

Flake comes from non-determinism. Pin all four:

| Source     | Fix                                                                                       |
|------------|-------------------------------------------------------------------------------------------|
| Time       | `freezegun.freeze_time` (py) / `vi.useFakeTimers` (vitest) / `page.clock.install` (PW).   |
| Random     | Seeded `random.Random(42)` / `Math.random` stub / `vi.spyOn(Math, 'random')`.             |
| Network    | MSW (vitest), route fulfillment (Playwright), real Postgres (pytest).                     |
| DB state   | Per-test rollback (pytest), per-test `QueryClient` (vitest), admin reset hooks (Playwright). |

If a test is flaky, identify which lever isn't pinned **before** adding retries. See [`references/flakiness.md`](references/flakiness.md).

## 9. CI integration

GitHub Actions runs pytest then Playwright. Gates:

1. Lint (`make lint-backend`, `npm run lint`)
2. Unit (`make test-backend`, `npm test`)
3. E2E (`npx playwright test`)

A failure in any earlier gate cancels later ones. Playwright artifacts (traces, screenshots, HTML report) upload on failure — pull them before guessing.

Retries: `retries: process.env.CI ? 1 : 0` for `local-api`/`local-ui`/`local-hitl`. **Don't** raise this to mask real flake — diagnose instead.

## 10. Anti-patterns we've been bitten by

- **Mocking `AsyncSession.execute`** — green test, prod migration broke. Use `db_client`.
- **Module-level random seeding in pytest** — bleeds across the session; use a fixture.
- **Parallel HITL tests** — they share state; pin to `local-hitl`.
- **`waitFor(() => expect(getByText(...))` in RTL** — use `findByText`; it has its own timeout.
- **CSS selectors in Playwright** — break on the next Tailwind refactor; use role/label.
- **Bumping `retries` to silence flake** — re-read §8.
- **Snapshotting volatile UI** — mask timestamps, IDs, user names. Don't ratchet `maxDiffPixels` upward to hide drift.

## 11. References (progressive disclosure)

| File                                | When to read                                                                |
|-------------------------------------|------------------------------------------------------------------------------|
| [`references/pytest.md`](references/pytest.md)         | Writing backend integration tests, async fixture scope, factory patterns.    |
| [`references/vitest.md`](references/vitest.md)         | Component tests, hook tests, partial `vi.mock`, in-source tests, browser mode. |
| [`references/playwright.md`](references/playwright.md) | New E2E flow, fixture composition, expect.poll, project setup, debugging.   |
| [`references/msw.md`](references/msw.md)               | Designing handlers, runtime overrides, request-matching pitfalls.            |
| [`references/a11y.md`](references/a11y.md)             | WCAG checklist + axe rules to disable vs. fix.                               |
| [`references/flakiness.md`](references/flakiness.md)   | Diagnosing a flake — classify the source before patching.                    |
