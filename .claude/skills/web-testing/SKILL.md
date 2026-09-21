---
name: web-testing
description: "Use when writing, running, debugging or planning prumo tests: pytest backend integration, Vitest unit and component, MSW mocks, Playwright E2E, or a flaky test. Carries the fixture semantics, commands, project split and CI gates that differ from the defaults, and the rule that integration beats mocking."
---

# Web Testing (prumo)

pytest + Vitest + Playwright. **Integration beats mocking**: mocked database tests have stayed green while the real migration broke. Backend tests run against the real local Supabase Postgres; frontend tests stub the network with MSW.

## Which test

```text
Pure logic (formatter, reducer, util)             -> Vitest or pytest unit
Touches the schema, a constraint or a trigger     -> pytest integration, real Postgres
A hook or component over TanStack Query           -> Vitest + MSW
Crosses UI -> API -> DB                           -> Playwright flow
Race, timing or leaking state                     -> read "Flakes" first
```

**Name the seam before the test**: the endpoint, the service function, the hook's return value, or what the user sees. Tests observe through it, never through internals. For non-trivial work, agree the seams with the user first.

## Commands

| Goal | Command |
|---|---|
| Backend suite | `make test-backend` |
| One backend test | `cd backend && uv run pytest tests/integration/test_x.py -k name -x` |
| Frontend suite | `npm run test:run` (repo root) |
| One Vitest file | `npx vitest run frontend/path/X.test.tsx -t "name"` |
| E2E, parallel projects | `npm run test:e2e:local:core` (`local-api` + `local-ui`) |
| E2E, stateful HITL | `npm run test:e2e:local:hitl` (`local-hitl`, one worker) |
| One E2E flow | `npx playwright test frontend/e2e/flows/x.e2e.ts --project=local-api` |
| Trace after a failure | `npx playwright show-trace test-results/<test-dir>/trace.zip` |

## Backend: pytest

`asyncio_mode = "auto"`; many files still add `@pytest.mark.asyncio`, so match the file. Markers: `integration` (auto-applied under `tests/integration/`), `e2e`, `performance`, `llm`. `addopts` deselects `llm`; your own `-m` replaces that, so write `-m "e2e and not llm"`.

| Fixture (`backend/tests/conftest.py`) | What it is | Use for |
|---|---|---|
| `client` | mocked database and auth | transport, validation and 401 paths only |
| `db_session` | real Postgres; each test runs in an outer transaction + SAVEPOINT rolled back at teardown, so commits are allowed and undone | the default |
| `db_client` | HTTP client over `db_session`; auth is a fake `test-user-id` that belongs to no project | endpoint tests |
| `db_session_real` | commits for real | DEFERRED triggers, cross-session reads; delete what you insert |

- **RLS never runs here**: tests connect as `postgres`, a superuser. Prove a policy with `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE authenticated`, as `tests/integration/test_llm_connection_rls.py` does.
- **Passing a guard** needs a real member: override `get_current_user` with a seeded profile, as the `auth_as_profile` fixture in `tests/integration/test_hitl_session.py` does.
- **Seed.** The autouse `seeded_integration_db` fixture creates the seed graph; reference its ids through `SEED` (`tests/integration/conftest.py`). Never skip on a missing seed: CI caps skipped tests at 25 because a missing seed once skipped about 196.
- **Builders.** `backend/tests/factories/` (`TemplateFactory`, `make_entity_type`) and the helpers in `tests/integration/conftest.py` (`open_session`, `make_proposal`, `make_ai_proposal`). Integration helpers scope article and template queries by `project_id`.
- **Authorization.** Every state-changing endpoint gets one test per guard it depends on: a non-member (403), a member with the wrong role (403), and a foreign row id (the guard's own refusal, 404-class).
- **Time and order.** No clock library is installed: inject `now`. pytest-randomly shuffles test order; rerun with the seed it prints (`--randomly-seed=<n>`) or pin it with `-p no:randomly`.
- `parametrize(..., ids=[...])` so `-k <id>` selects one case.

## Frontend: Vitest

- `vitest.config.ts` at the repo root: jsdom, globals, setup `frontend/test/setup.ts`. No coverage threshold is enforced.
- Placement: `frontend/test/{components,hooks,lib,services}/` or co-located (`X.test.tsx`, `__tests__/`). Match the neighbors.
- **Network → MSW v2** (`frontend/test/mocks/server.ts`) with `onUnhandledRequest: 'error'`, except that its baseline silently answers Supabase auth (`POST */auth/v1/token`) and REST (`GET */rest/v1/*` → `[]`, `POST */rest/v1/*`). Override per test with `server.use(http.post('*/api/v1/...', () => HttpResponse.json({ ok: true, data })))`: responses carry the envelope.
- **`vi.mock` is for modules MSW can't reach**: the copy layer (`vi.mock('@/lib/copy', () => ({ t: (_ns, key) => key }))`), `sonner`, the Supabase client.
- A fresh `QueryClient` per test (`retry: false`, `gcTime: 0`) in the file's own wrapper; screen-level helpers live in `frontend/test/helpers/`.
- Query by role and name, then label, then test id; `findBy*` for anything async; one `userEvent.setup()` per test.
- jsdom has no layout and no Tailwind, so a class-string assertion proves nothing visual; and its user agent is not a Mac, so `mod` means Control in tests.

## E2E: Playwright

- Three projects (`playwright.config.ts`): `local-api` (`flows/**/*.e2e.ts`), `local-ui` (`flows/**/*.ui.e2e.ts`, plus `auth.e2e.ts` and `projects.e2e.ts`) and `local-hitl`, an explicit list of stateful specs with one worker and always one retry. Stateful specs share a project/article/template triple, and parallel runs delete each other's runs: a new one goes into the `local-hitl` list **and** into the other projects' `testIgnore`.
- Retries are `CI ? 1 : 0` elsewhere. Diagnose a flake before raising them.
- Helpers live in `frontend/e2e/_fixtures/` (`auth.ts`, `api.ts`, `hitl.ts`, `ensure-fixtures.ts`, `registry.ts`, …); add new ones there. API calls go to `${apiUrl}/api/v1/…`: the base URL is the frontend on :8080, with no proxy.
- Product pages sit behind auth under `/projects/:projectId/...` (e.g. `/projects/:projectId/extraction/:articleId`).
- `expect.poll` for eventual consistency (Celery jobs, stage transitions). Run stages are lowercase: `pending`, `extract`, `consensus`, `finalized`, `cancelled`.
- Selectors: `getByRole`, then `getByLabel`, then `getByTestId`; no CSS or XPath in new code.
- `locator.click()` waits forever on an `aria-disabled` control; pass `force: true` when the control is deliberately clickable.
- Accessibility: `new AxeBuilder({ page }).withTags([...]).analyze()` from `@axe-core/playwright`; `extraction-review-workspace.ui.e2e.ts` is the flow that asserts it today.
- There are no screenshot baselines; `design-review` is the visual check.

## CI

`.github/workflows/ci.yml` runs its test jobs in parallel: backend (`uv run pytest tests/ --cov-fail-under=62`, a 25-skip budget, diff coverage ≥ 80% on PRs, critical-path coverage ≥ 85%), frontend (`npm run test:run`, no coverage), the backend `-m e2e` suite, and the ephemeral-stack Playwright job (`test:e2e:local:core`, plus `:hitl` only when `scripts/ci/extraction_pipeline_touched.py` fires). Playwright artifacts upload on every run: open the trace before guessing.

## Flakes

Find the loose lever before touching retries:

| Source | Pin it with |
|---|---|
| Time | inject `now` (pytest) · `vi.useFakeTimers` · `page.clock.install` |
| Randomness | a seeded `random.Random` in a fixture · `vi.spyOn(Math, 'random')` |
| Network | real Postgres (pytest) · MSW (Vitest) · route fulfillment (Playwright) |
| Shared state | SAVEPOINT isolation · a fresh `QueryClient` · `local-hitl` for stateful flows |
| Order | pytest-randomly's printed seed |

- Repeat to reproduce: Playwright `--repeat-each=20 --workers=1` (without `--workers=1` the repeats run in parallel); Vitest has no repeat flag, so use `it(..., { repeats: 20 })` or a shell loop.
- An `await import()` inside `it()` times out under load: import at module scope.

## Anti-patterns

- **Mocking `AsyncSession.execute`**: use `db_session` or `db_client`.
- **Tautological assertions**: the expected value is computed the way the code computes it (`expect(total(items)).toBe(items.reduce(...))`, or comparing a Pydantic response model to one built from the same inputs, which stays green when fields drift). Expected values come from a literal, a worked example or the spec.
- **Vacuous tests**: the assertion never meets the case it names (an empty list iterated, a branch never taken, a filter that matches nothing). Assert the precondition before the outcome.
- **Testing past the interface**: mocking your own collaborators, asserting call counts or order, or checking a write by querying the table instead of reading it back through the interface. The tell: it breaks on a refactor that changed no behavior.
- **Silencing a flake** by raising `retries` or a diff threshold.
