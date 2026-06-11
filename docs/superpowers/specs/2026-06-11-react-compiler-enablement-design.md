---
status: approved
created: 2026-06-11
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# Design — React Compiler Enablement + Manual Memoization Removal

## Why

PRs #260–#265 burned the 94 React Compiler lint findings down to zero,
and #267 promoted the nine `react-hooks/*` rules to `error`. That work was the
prerequisite; this is the payoff: enable `babel-plugin-react-compiler` in
the Vite build so memoization is automatic, and remove the ~290 manual
memoization sites (`useMemo` ×79, `useCallback` ×211, `React.memo`) that
the compiler now subsumes.

## Decisions (approved 2026-06-11)

- **Rollout**: whole `frontend/` at once, single PR.
- **Manual memoization**: removed in the same PR (not deferred), with a
  short documented exception list.
- **Verification bar**: standard gates + full local E2E + manual smoke on
  the local preview.

## Scope

One PR against `dev`, squash-merged, structured as three review commits:

### Commit 1 — compiler on, zero app-code changes

- Swap `@vitejs/plugin-react-swc` for `@vitejs/plugin-react` in
  `vite.config.ts`; add `babel-plugin-react-compiler` (v1.x,
  devDependency); configure
  `react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })`.
- React 19.2.7 ships the compiler runtime — no extra runtime package.
- `vitest.config.ts` must use the same plugin so the 451-test suite
  exercises **compiled** output, not the original source.
- ESLint is untouched: the compiler rules already run at `error`, which is
  the contract the compiler assumes.
- Implementation-time check (current docs, not memory): if the SWC/OXC
  toolchain has gained official, stable compiler support, stay on SWC.
  Decision rule: the documented-stable path wins; Babel is the guaranteed
  fallback.

### Commit 2 — manual memoization sweep

Mechanical removal, directory by directory (same batch boundaries as the
burn-down), running `vitest` per batch locally:

- `useMemo(() => expr, deps)` → inline expression/const.
- `useCallback(fn, deps)` → plain function.
- `React.memo(X)` → unwrap.

**Exceptions that stay, each with a one-line comment explaining why:**

1. The three `memo()` calls with custom comparators (the compiler does not
   replicate `arePropsEqual`).
2. `useCallback` whose manual deps are intentionally narrower than the
   values referenced — removal changes the firing cadence of effects that
   depend on the callback's identity. Audited one by one; when the case is
   really a "handler that reads fresh props", the correct exit is
   `useEffectEvent` (stable in React 19.2), not keeping the memo.
3. Components the compiler healthcheck reports as bailouts (the compiler
   skips what it cannot prove safe; removing manual memo there loses
   memoization entirely). Expected ≈0 given the clean lint, but enumerated
   before the sweep, not assumed.

### Commit 3 — derived cleanup + final verification

Orphaned imports (`useMemo`/`useCallback`/`React.memo`), then the full
gate sequence below on the final tree.

## Verification (all mandatory on the final PR state)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npm run typecheck` — clean.
3. `npm run test:run` — 451 tests against compiled code (this is what
   makes the suite a real compiler gate; the autosave/session timing
   contracts live here).
4. `npm run build` — green; bundle-size delta recorded in the PR body
   (informational, not a gate — the compiler adds some code).
5. `npm run test:e2e:local` — full-stack Playwright (local Supabase;
   `make db-fresh` if needed; fixtures self-provision).
6. Manual smoke on the local preview (`teste@prumo.local`) over the
   memoization-sensitive screens: ExtractionFullScreen (typing latency,
   autosave badge, PDF panel resize), QA full screen (publish flow),
   extraction dialogs (open/close resets), multi-user comparison views,
   sidebar/skeletons.

## Risks and mitigations

- **Slower dev server** (Babel vs SWC): measure `npm run dev` cold start +
  HMR before/after; if degradation is gross (>2–3×), re-evaluate the
  native SWC path before merging.
- **Effect-cadence changes** from removing narrow-deps `useCallback`s: the
  number-one real risk — covered by the commit-2 audit (exception 2), the
  dense hook tests, and E2E.
- **Silent bailouts unmemoizing components**: enumerated by the
  healthcheck before the sweep (exception 3).
- **Infinite render loops** are the classic post-removal bug class; they
  fail loudly in tests/E2E (as the burn-down demonstrated), not silently.

## Rollback

Single squash-merged PR → one-commit revert. Built-in contingency: if the
sweep (commit 2) fails the smoke test, commit 1 (compiler on, manual memo
preserved) merges alone and the removal becomes an immediate follow-up PR.

## Out of scope

- Removing the memoization exceptions list (revisited only if the
  compiler/healthcheck evolves).
- Migrating hand-rolled fetch hooks to TanStack Query — that rides the
  extraction data-path consolidation, not this PR.
- Performance evidence (profiler before/after) — explicitly not part of
  the verification bar.
