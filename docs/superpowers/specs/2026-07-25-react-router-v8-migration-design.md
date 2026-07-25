---
status: draft
last_reviewed: 2026-07-25
owner: '@raphaelfh'
---

# react-router v8 migration (GHSA-qwww-vcr4-c8h2) — design

> **Status:** Draft · Date: 2026-07-25 · Deciders: @raphaelfh
> **Scope:** move the frontend off the removed `react-router-dom` package onto
> `react-router` v8, clearing the HIGH advisory that blocks
> `npm audit --omit=dev --audit-level=high`.
> **Issue:** #562

## Problem

`npm audit --omit=dev --audit-level=high` — the blocking gate in
`.github/workflows/security-audit.yml` — fails on:

```text
react-router  7.12.0 - 8.2.0
Severity: high
React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response
GHSA-qwww-vcr4-c8h2
```

Installed: `react-router-dom@7.18.1` → `react-router@7.18.1`.

### Not exploitable here

The advisory is scoped to **RSC mode server actions**. prumo is a static Vite
SPA talking to a separate FastAPI backend:

- declarative `<BrowserRouter>` only (`frontend/App.tsx`)
- no `createBrowserRouter` / `RouterProvider`
- no `react-router.config.*`, no `@react-router/dev|node|serve`
- no route `loader`s or `action`s

This is hygiene plus clearing the audit gate, not an incident.

### Why this is a package migration, not a version bump

Verified against the GitHub advisory API rather than release notes:

| Fact | Value |
| --- | --- |
| Affected range | `>= 7.12.0, < 8.3.0` |
| First patched | `react-router@8.3.0` |
| Latest `react-router-dom` | `7.18.1` — there is no v8 |

`react-router-dom` was **removed** in React Router v8. The patched artifact is
`react-router@8.3.0`, so remediation means swapping the package.

`npm audit fix --force` would install `react-router-dom@7.11.0` — a downgrade
past the fix, not a fix. It must never be run here.

## Constraints verified before designing

| Check | Result |
| --- | --- |
| Our API surface on `react-router` v8 root | `BrowserRouter`, `MemoryRouter`, `Routes`, `Route`, `Link`, `Navigate`, `Outlet`, `useNavigate`, `useParams`, `useLocation`, `useSearchParams` — all present (loaded 8.3.0 in a scratch install and enumerated exports) |
| Declarative-API behaviour deltas v7→v8 | None. Every v8 breaking change is framework/data mode: `middleware` always on, `data`→`loaderData`, `hasErrorBoundary` removed, adapter changes. We use none. |
| Node floor (v8 needs ≥ 22.22) | Repo pins `24.x` (`.nvmrc`, `engines`) |
| React floor (v8 peer `>= 19.2.7`) | Repo has `react@^19.2.8` |
| Blast radius | 52 import specifiers across 43 files, plus one `package.json` line |
| Hidden references | None. No `vi.mock('react-router-dom')`, no CJS `require`, no vitest `deps.inline`, no `@types/react-router-dom` |
| File-size ratchet | Counts **lines**; import rewrites do not change line counts, so no baseline churn |

## Approaches considered

**A. Migrate to `react-router@^8.3.0` (chosen).** Uninstall `react-router-dom`,
rewrite the 52 specifiers, keep declarative routing byte-for-byte otherwise.
Lands on the supported package; a stale import becomes a hard build error.

**B. `overrides` forcing `react-router@8.3.0` under `react-router-dom@7.18.1`.**
Rejected. One-line diff that clears the audit, but pins a v7 re-export shim on
top of a v8 core that removed exports it expects — an unsupported combination
that can break at runtime without failing a build.

**C. Audit allowlist / advisory exception.** Rejected. Permanently weakens the
gate for a package that can simply be updated.

### Explicitly out of scope

- **No data-router migration.** Moving to `createBrowserRouter` /
  `RouterProvider` would rewrite every route. The advisory concerns RSC server
  actions; the data router moves *toward* that surface, not away from it.
- **No edits to archived plan docs** that mention `react-router-dom`
  (3 lines under `docs/superpowers/plans/`). They are point-in-time records.

## Design

1. **Dependency swap.** `react-router-dom@^7.18.1` → `react-router@^8.3.0` in
   `package.json`, plus the lockfile. Caret matches repo convention; any
   `>= 8.3.0` resolution is outside the advisory range.

2. **Import rewrite.** 52 specifiers `react-router-dom` → `react-router`.
   Nothing else on those lines changes. No import moves to `react-router/dom`,
   because that entry point exists for `RouterProvider` and `HydratedRouter`,
   neither of which we use.

3. **Regression guard.** An eslint `no-restricted-imports` rule banning
   `react-router-dom` with a message pointing at `react-router`. Uninstalling
   already makes a regression fail `tsc`, but a named lint error explains *why*
   instead of surfacing a bare module-not-found.

4. **No config changes.** `vite.config.ts` chunks on
   `id.includes("react-router")`, which still matches — the `router-vendor`
   chunk survives. Confirmed in build output rather than assumed.

## Verification

Routing is exercised end-to-end, so E2E carries the real weight.

| Step | Command | Proves |
| --- | --- | --- |
| 1 | `npm run test:run` | Component/unit suites incl. `MemoryRouter` harnesses |
| 2 | `npx tsc -p tsconfig.app.json --noEmit` | The CI typecheck gate (vitest passing is not a typecheck) |
| 3 | `npm run build` | React Compiler gate (`panicThreshold: 'all_errors'`) and the `router-vendor` chunk |
| 4 | `npm run lint` | The new import guard is wired and the tree is clean |
| 5 | `npm run test:e2e:local` | Real navigation across every route |
| 6 | `/design-review` on a run form + a list page | Rendering verified with eyes, not the diff |
| 7 | `npm audit --omit=dev --audit-level=high` | Advisory gone; exit 0 |

E2E runs against the existing local Supabase without a `db-fresh` wipe. If
fixtures fail for missing seed data, stop and report rather than wiping.

**Known flake class:** specs in different Playwright projects share one
database and can race. A failure in `qa-consensus-ai-trace` or
`extraction-multi-instance` is more likely that race than this diff — confirm
against a clean baseline before blaming the migration.

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| v8 publishes ESM-first; vitest/jsdom interop breaks | Low — Vitest 4 + Vite 8 handle ESM natively, and the scratch probe resolved the package cleanly | Surfaces immediately at verification step 1, not subtly at runtime |
| A route path silently stops matching | Low — no declarative behaviour changed in v8 | E2E step 5 walks every route |
| `router-vendor` chunk stops forming, bloating the entry bundle | Low | Read the build output in step 3 |

## Definition of done

PR against `dev` carrying the migration, the eslint guard, green CI, and the
audit output showing the advisory cleared. The PR body closes #562.

**Not promoted to `main` in the same pass.** A routing regression is the class
tests miss and users find, so the change sits on `dev` through at least one CI
cycle first.
