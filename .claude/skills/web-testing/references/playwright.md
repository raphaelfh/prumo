# Playwright (E2E) — deep dive

Read this before adding a new E2E flow or touching `playwright.config.ts`. SKILL.md covers the rules; this is the workshop.

## 1. Project layout

```
playwright.config.ts                    # at repo root
frontend/e2e/
  _fixtures/                            # auth.ts, api.ts, hitl.ts, supabase-admin.ts, ...
  flows/
    *.e2e.ts        -> local-api  (API-driven, parallel)
    *.ui.e2e.ts     -> local-ui   (UI-driven, parallel)
    qa-*.e2e.ts     -> local-hitl (stateful, single-worker)
    extraction-edit.ui.e2e.ts, extraction-reopen.ui.e2e.ts -> local-hitl
    hitl-*.api.e2e.ts -> local-hitl
  remote/*.e2e.ts                       # -> remote-smoke
```

The four-project split exists because:
- `local-api` and `local-ui` are stateless and parallelize cleanly.
- `local-hitl` shares a fixed (project, article, template) triple — running >1 worker causes runs to step on each other. Don't fight this; add new HITL-stateful tests under matching glob patterns.
- `remote-smoke` runs against deployed env with `retries: 2`.

## 2. Choosing your project

| If the test...                                                                  | Place it under...                  | Suffix              |
|---------------------------------------------------------------------------------|------------------------------------|---------------------|
| hits only `/api/v1/...` via `request.fetch`, no UI                              | `flows/<feature>.e2e.ts`           | `.e2e.ts`           |
| drives the UI but doesn't touch HITL run state                                  | `flows/<feature>.ui.e2e.ts`        | `.ui.e2e.ts`        |
| mutates HITL runs (qa-*, extraction-edit, extraction-reopen, hitl-* APIs)       | matching glob in `flows/`          | per the config map  |
| runs against a deployed environment                                             | `remote/<feature>.e2e.ts`          | `.e2e.ts`           |

If you add a new HITL-stateful glob, update `playwright.config.ts` projects map.

## 3. Composable fixtures

`test.extend` builds chains of fixtures without page-object boilerplate:

```ts
import { test as base, expect } from '@playwright/test';
import { resolveAuthToken } from '../_fixtures/auth';
import { ensureProject } from '../_fixtures/registry';

type Fixtures = {
  authToken: string;
  projectId: string;
};

const test = base.extend<Fixtures>({
  authToken: async ({ page }, use) => {
    const token = await resolveAuthToken(page);
    await use(token);
  },
  projectId: async ({ request, authToken }, use) => {
    const id = await ensureProject(request, authToken);
    await use(id);
    // teardown happens after `use` returns
  },
});

test('lists templates in project', async ({ request, authToken, projectId }) => {
  const body = await expectEnvelopeOk(request, 'get', `/api/v1/projects/${projectId}/templates`, {
    token: authToken,
    traceId: 'list-templates',
  });
  expect(body.data).toHaveProperty('items');
});
```

Existing `_fixtures/api.ts` already exposes `expectEnvelopeOk`. Use it; don't roll your own.

## 4. `expect.poll` over manual retry loops

For eventual consistency (background workers, multi-reviewer consensus, run stage transitions):

```ts
await expect.poll(
  async () => {
    const body = await expectEnvelopeOk<RunDetail>(request, 'get', `/api/v1/runs/${runId}`, opts);
    return body.data.stage;
  },
  { timeout: 15_000, intervals: [200, 500, 1000, 2000] }
).toBe('REVIEW');
```

`intervals` is an array: backoff happens automatically. Default is `[100]` which DOSes the API — set it explicitly for anything that involves the worker.

## 5. Selector hierarchy

```ts
// Best -> worst
page.getByRole('button', { name: /publish/i })
page.getByLabel('Email address')
page.getByPlaceholder('your.email@example.com')
page.getByText('Review needed')          // for non-interactive content
page.getByTestId('publish-action')        // last resort, semantic loss
page.locator('.btn-primary')              // avoid in new code
```

If you have to use `getByTestId`, add the `data-testid` in the component file with a comment explaining the role/label couldn't disambiguate.

## 6. Network interception

Two flavors, pick by intent:

### Route fulfillment (replace the backend)

```ts
await page.route('**/api/v1/runs/*', async (route) => {
  if (route.request().method() === 'POST') {
    await route.fulfill({ status: 409, json: { ok: false, error: { code: 'CONFLICT' } } });
  } else {
    await route.continue();
  }
});
```

Use for testing UI behavior under specific server states (errors, slow responses).

### Real backend (default)

If you want to test the full stack, don't intercept — let the request hit `localhost:8000`. That's the whole point of `local-api`/`local-ui` projects.

## 7. Tracing and debugging

`playwright.config.ts` sets:
- `trace: 'retain-on-failure'` — `.zip` saved on fail.
- `screenshot: 'only-on-failure'`.
- `video: 'retain-on-failure'`.
- `reporter: [['list'], ['html', { open: 'never' }]]` — open with `npx playwright show-report`.

After a failing CI run:
1. Download the artifact (PR → checks → Playwright → artifacts).
2. `npx playwright show-trace test-results/<test>-trace.zip` — opens the time-travel UI.
3. Inspect network, console, DOM at each step.

Local debug:
```bash
npx playwright test --ui                              # interactive UI mode
npx playwright test --debug frontend/e2e/flows/x.e2e.ts  # PWDEBUG=1 inspector
PWDEBUG=console npx playwright test ...               # console-only inspector
```

## 8. Mobile emulation

```ts
import { devices } from '@playwright/test';

projects: [
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
]
```

We don't run mobile by default in CI; add a project when shipping a touch-specific feature. Test gesture flows with `page.touchscreen.tap`, `page.locator(...).swipe(...)`, viewport rotation via `page.setViewportSize`.

## 9. Accessibility checks

`@axe-core/playwright` integrates cleanly into any flow:

```ts
import AxeBuilder from '@axe-core/playwright';

test('extraction page is a11y-clean', async ({ page }) => {
  await page.goto('/extraction/123');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="third-party-widget"]')   // scope out untestable subtrees
    .analyze();
  expect(results.violations).toEqual([]);
});
```

When a violation is real but not yet fixable, capture it with `.disableRules(['color-contrast'])` and link a ticket. Don't silently lower the bar across the suite — see [`a11y.md`](a11y.md).

## 10. Visual regression

```ts
await expect(page).toHaveScreenshot('extraction-empty.png', {
  fullPage: true,
  maxDiffPixels: 100,
  threshold: 0.2,                                         // SSIM-ish
  mask: [
    page.getByTestId('current-user-avatar'),
    page.locator('time'),                                  // dates
  ],
  animations: 'disabled',
});
```

Mask everything volatile. Update baselines via `--update-snapshots` only after you've verified the diff is intentional in the HTML report.

## 11. Per-test page state

```ts
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await context.clearPermissions();
  await page.evaluate(() => localStorage.clear());
});
```

For HITL-stateful tests, reset run state via the admin API at the start of each test — see `_fixtures/hitl.ts` for the helper.

## 12. Parallelism gotchas

- `fullyParallel: true` is on for `local-api` and `local-ui` — tests run in different workers, **different browser contexts**, isolated by default. Don't share data via global module state.
- `local-hitl` has `fullyParallel: false, workers: 1` — tests run serially. Don't rely on this implicitly; reset state in `beforeEach` anyway, so the tests survive being moved between projects.
- `worker-scoped` fixtures: declare with `{ scope: 'worker' }` — used for expensive setup like seeding a project once per worker.

## 13. Failure investigation checklist

When a Playwright test fails in CI:

1. Download trace + screenshot + video artifact.
2. `show-trace` → walk to the failing action; check the DOM snapshot before/after.
3. Check console: was there an unhandled rejection? Stray React error?
4. Check network: which request 4xx/5xx'd? What was the response body?
5. Check if the test was in `local-hitl` and parallel timing caused conflict.
6. Re-run locally with `--repeat-each=10 --workers=1` to confirm reproducibility.
7. Only then patch — don't add `retries`.

## 14. Anti-patterns

| Anti-pattern                                          | Why it hurts                                             | Do instead                                  |
|-------------------------------------------------------|----------------------------------------------------------|---------------------------------------------|
| `await page.waitForTimeout(1000)`                     | Hides race conditions; flakes silently                   | `expect.poll` or `waitForResponse`          |
| CSS class selectors (`.btn-primary`)                  | Breaks on Tailwind refactor                              | `getByRole` / `getByLabel`                  |
| Adding HITL tests to `local-api`                      | Stateful conflicts; non-deterministic failures            | Match the glob -> `local-hitl`              |
| `retries: 3` to silence flake                         | Hides real bugs                                           | Diagnose source — see flakiness.md          |
| Logging in via UI every test                          | 10s of overhead per test                                  | `E2E_AUTH_TOKEN` env or storageState reuse  |
| Asserting on raw HTML/CSS                             | Couples to design tokens                                  | Assert on roles, text, accessible names     |
