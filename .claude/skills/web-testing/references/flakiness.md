# Flakiness — diagnostic playbook

Read this **before** adding retries. Flake almost always has a single root cause; retries just hide it.

## 1. Classify the flake first

| Symptom                                                              | Likely class            | Go to                  |
|----------------------------------------------------------------------|-------------------------|------------------------|
| Test fails only in CI, passes locally                                | Order / state isolation | §3                     |
| Test fails 1-in-N runs locally                                       | Timing / race            | §2                     |
| Test fails right after the previous test changes                     | Fixture leak             | §4                     |
| Test fails when run in parallel, passes serially                     | Shared resource          | §5                     |
| Test fails after a Vite/dep upgrade                                  | Real bug or transitive   | §6                     |
| Test fails with `Future attached to different loop` (pytest)         | Async fixture scope      | §7                     |
| Test fails with `Cannot read property X of undefined` intermittently | Optimistic UI race       | §8                     |

## 2. Timing / race conditions

Symptoms: passes 9/10 times; failure shows "element not found" or "value undefined".

Root causes and fixes:

- **`waitForTimeout`** — using a wall-clock sleep to wait for async work. Replace with `expect.poll`, `waitForResponse`, `findBy*`, or `waitFor`.

```ts
// BAD
await page.waitForTimeout(2000);
await expect(page.getByText('Published')).toBeVisible();

// GOOD
await expect.poll(
  async () => (await api.getRun(id)).stage,
  { timeout: 10_000, intervals: [200, 500, 1000] }
).toBe('PUBLISHED');
```

- **Re-render race in RTL** — using `getBy*` for content that arrives async.

```ts
// BAD
render(<HitlPanel />);
expect(screen.getByText('Loaded')).toBeInTheDocument();  // throws synchronously

// GOOD
expect(await screen.findByText('Loaded')).toBeInTheDocument();
```

- **TanStack Query stale-time** — query cached from a previous test, returns stale data. Fresh `QueryClient` per test with `gcTime: 0, retry: false`.

- **SSE / Celery eventual consistency** — task hasn't completed when assertion fires. `expect.poll` with realistic `timeout`.

## 3. Order / state isolation

Symptoms: test passes in isolation (`-k name`) but fails in the suite.

Common causes:

- **Global module state.** A module-level variable mutated by another test. Move it into a fixture.
- **Shared seed data.** Two tests create a project with the same name; one's UNIQUE constraint trips. Use UUIDs or randomized names.
- **Test order randomization.** pytest-randomly or vitest defaults shuffle order; the failing test exposes a pre-existing dependency. Run `pytest -p no:randomly` to find which neighbor it depends on, then fix the dependency.
- **HITL run state.** New test creates a run, doesn't reset, next test inherits it. Always `beforeEach` reset in `local-hitl`.

Diagnostic: `pytest tests/integration/ -p no:randomly -x` then bisect by halving the file list.

## 4. Fixture leak

Symptoms: test A creates X, test B fails because X exists.

- **Pytest:** check `yield`-based fixtures have teardown. The per-test engine in our `db_session` cleans itself up; verify your custom fixtures do the same.
- **Playwright:** `test.beforeEach` cleanup isn't running because a previous `beforeAll` set state. Use `test.afterEach` for symmetric cleanup.
- **Vitest:** `vi.mock` from a previous file leaking — clear with `vi.restoreAllMocks()` in `afterEach`, or check if a setup file is auto-mocking globally.

## 5. Shared-resource contention

Symptoms: passes when `--workers=1`, fails parallel.

- **HITL tests:** must run in `local-hitl` project (single worker). Move them.
- **Port collision:** integration test starts a service on a fixed port. Use dynamic ports or session-scope the fixture.
- **DB row contention:** two workers UPSERT to the same row, deadlock. Use UUID keys and isolate by `project_id` per worker.

Diagnostic: `npx playwright test --workers=1` confirms shared-resource theory.

## 6. Real bug surfaced by upgrade

Symptoms: failing only after a dep bump.

Don't pin the dep back. Read the changelog for breaking changes, run the test in `--debug` mode, walk through the trace. 90% of the time it's a real regression that production would hit eventually.

## 7. Async fixture scope (pytest)

Symptoms: `RuntimeError: Future attached to different loop`, `coroutine was never awaited`.

Root cause: mixing fixture scopes that own loop-bound resources.

- `db_session` is function-scoped on purpose — each test gets a fresh engine + loop.
- Don't make engines `session`-scoped to "speed up" — it produces this exact failure.
- If you need a long-lived resource, use `pytest_asyncio.fixture(scope="function", loop_scope="session")` carefully and only for stateless objects.

## 8. Optimistic UI race

Symptoms: assertion fires during the optimistic state, expects the final state.

Either assert on the optimistic state explicitly (correct UX behavior), or wait for the server response:

```ts
const user = userEvent.setup();
const responsePromise = page.waitForResponse('**/api/v1/hitl/sessions/*/publish');
await user.click(screen.getByRole('button', { name: /publish/i }));
await responsePromise;                                       // wait for the round-trip
await expect(screen.findByText(/published/i)).resolves.toBeInTheDocument();
```

## 9. The flake budget

A flaky test that retries-to-green still wastes CI minutes and erodes signal. Threshold for action:

- **1 flake/week** → file an issue, fix in the next iteration.
- **1 flake/day** → fix this iteration, no merge until repaired.
- **Multiple in one suite** → quarantine the suite (mark `.skip` with ticket reference) and prioritize.

Quarantining must come with a ticket. A quarantined test without an owner becomes a deleted test.

## 10. Repro recipes

Lock the flake in before you fix it:

```bash
# pytest: run the test 50 times serially
cd backend && pytest tests/integration/test_x.py::test_y --count=50  # requires pytest-repeat

# Playwright: run 20 times, fail-fast
npx playwright test frontend/e2e/flows/x.e2e.ts --repeat-each=20

# Vitest: re-run in watch + bisect
npx vitest frontend/test/x.test.ts --repeat-each=20
```

If you can't reproduce in 50 runs locally, the cause is environmental — check CI logs for shared-resource pressure (memory, FD limits, postgres connection count).

## 11. Documenting the fix

When you fix a flake, leave a comment on the test:

```python
# Previously flaked under parallel HITL execution — moved to local-hitl glob in
# playwright.config.ts (commit abc1234). Don't re-parallelize without resetting
# the (project, article, template) triple per test.
```

The next person to touch this code will thank you.
