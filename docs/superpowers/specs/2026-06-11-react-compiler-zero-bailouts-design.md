---
status: approved
created: 2026-06-11
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# Design — React Compiler Zero Bailouts (handler extraction + memo unlock)

## Why

PR #268 enabled the React Compiler, but 80 of 474 frontend files fail to
compile and therefore keep all of their manual memoization — 210 of the
226 remaining `useMemo`/`useCallback`/`memo()` sites are pinned by
bailouts, not by genuine need. Regenerated inventory (2026-06-11, dev @
`c281ce3`, via `panicThreshold: 'all_errors'`):

| Bucket | Files | Root causes |
| --- | --- | --- |
| Try-family | 72 | `try/finally` in handlers (62), `throw` inside `try/catch` — the Supabase `if (error) throw error` idiom (35), conditionals/optional chaining inside `try` (3); counts overlap per file |
| Oddballs | 8 | `x++` captured in lambdas (2), manual memo deps narrower than inferred `props` (2), non-reorderable JSX expression (2), compiler `Invariant` errors (2). One (`useBatchAllModelsSectionsExtraction.ts`) also contains try-family handlers and gets the service treatment in addition |

Eliminating the bailouts compiles the hot extraction screens, unlocks
the 210 pinned memo sites for removal by the proven #268 method, and —
the durable prize — lets `panicThreshold: 'all_errors'` become permanent
in CI: every file either compiles or carries a visible opt-out.

## Decisions (approved 2026-06-11)

- **Sequencing**: full sweep now; do not wait for (or skip files owned
  by) the extraction data-path consolidation. Loader hooks keep their
  public signatures so consolidation phases rebase cleanly and later
  reuse the same service functions under TanStack Query.
- **Idiom**: extract handler/IO logic to module-level functions in
  `frontend/services/` (extending the 14 existing domain services). No
  wrapper combinators; no inline finally-restructuring as house style.
- **Error contract**: exported service functions never throw across the
  boundary. They return `Promise<ErrorResult<T>>` (existing type in
  `frontend/lib/error-utils.ts`), normalizing Supabase `{data, error}`
  envelopes and exceptions via `normalizeError()`. Services do not
  toast and take no UI callbacks; components own all presentation.
- **Structure**: two stacked PRs — PR A (extraction sweep + oddballs +
  `all_errors` flip), PR B (memo removal sweep), each squash-merged,
  separate revert units.

## Architecture (end-state)

- **Services own IO and exceptions.** `try/catch/finally/throw` are free
  inside `frontend/services/*` — module-level functions are never
  compiled by the React Compiler.
- **Components and hooks keep only UI state.** Handler shape:
  set pending flag → `await` service → branch on `result.ok` → toast /
  set state → clear pending flag. No `try`, `throw`, or `finally`
  anywhere in compiled code; bailouts die by construction.
- **Escape hatch**: a file still uncompilable after reasonable effort
  gets the `'use no memo'` directive plus a `// kept:` comment. Budget:
  0–2 files (known candidate: `components/ui/resizable-panel.tsx`).
- **Permanent CI gate**: with bailouts at zero,
  `vite.shared-plugins.ts` sets `panicThreshold: 'all_errors'`
  permanently — any future bailout fails both the build and vitest
  (shared preset). `scripts/check_compiler_coverage.mjs` stays: it
  proves the plugin runs at all, which a panic threshold cannot.

## PR A — service-extraction sweep

Per-file recipe (mechanical, individually audited):

1. Identify the IO core of each try-family handler; move it into the
   domain service (new function or extension of an existing service),
   returning `ErrorResult<T>`. Pre-existing service functions not
   touched by the sweep are left as-is in this PR.
2. Rewrite the component handler straight-line (shape above). Cleanup
   is unconditional because services never throw.
3. **Early-return audit** (named checklist item per file): `finally`
   ran cleanup on early `return` inside `try`; the new shape must place
   cleanup before every exit path.

Loader hooks (`useProjectsList`, `useExtractionData`, QA template
hooks, …): fetch body moves to a service; the hook keeps its public
signature and state machine (`data`/`loading`/`error`/`refetch`).
Consumers untouched.

Oddballs, individually:

| File | Error | Treatment |
| --- | --- | --- |
| `hooks/performance/useOptimizedCache.ts` | Invariant | Delete — zero consumers |
| `components/ui/resizable-panel.tsx` | Invariant | Attempt restructure; else `'use no memo'` + comment |
| `shared/comparison/ComparisonTable.tsx`, `hooks/extraction/useBatchAllModelsSectionsExtraction.ts` | `x++` in lambdas | Replace counter mutation with local accumulation |
| `shared/comparison/EntitySelectorComparison.tsx`, `shared/comparison/SingleInstanceComparison.tsx` | memo deps narrower than inferred `props` | Destructure props at top so deps are locals |
| `shared/list/FilterNumericRangeField.tsx`, `components/ui/file-drop-zone.tsx` | non-reorderable JSX expression | Hoist expression to a const before JSX |

Batching: the burn-down's domain batches (articles → extraction
components → extraction hooks → QA/HITL → user/auth/pages → shared/ui);
vitest per batch; bailout enumerator re-run per batch (count only goes
down). The enumerator is committed as
`scripts/enumerate_compiler_bailouts.mjs` (lists ALL failing files in
one pass; a panicking build stops at the first; also previews bailouts
on future compiler upgrades). PR A ends with the `all_errors` flip and
a short escape-hatch note in `.claude/rules/frontend.md`.

## PR B — memo removal sweep (stacked on A)

Rerun the #268 method over the newly compiling 80 files: regenerate the
memo inventory; one-off `react-hooks/exhaustive-deps` report splits
sites into "deps match inference → mechanical removal" vs "narrower →
individual audit (`useEffectEvent` where the case is a fresh-props
handler)"; apply the same exception rules (custom comparators stay,
parent-bail rule now mostly vacuous). Expected end-state: kept-memo
count drops from 226 to ≈16, and every survivor carries a `// kept:`
comment — viable at the new volume.

## Verification (each PR, same bar as #268)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npm run typecheck` — clean.
3. `npm run test:run` — full suite against compiled output (with panics
   armed the suite is itself a bailout gate).
4. `npm run build` — green; bundle delta recorded in the PR body.
5. `npm run test:e2e:local` — dev baseline profile (no NEW failures or
   skips attributable to the PR).
6. Manual smoke (`teste@prumo.local`). PR A emphasis: handler behavior
   — failure toasts, pending flags resetting, early-return paths
   (uploads, auth, profile, dialogs, Zotero). PR B emphasis: render
   performance parity — ExtractionFullScreen typing latency, autosave
   badge, PDF panel resize, comparison views.

## Risks and mitigations

- **Behavior drift in extracted handlers** (top risk, concentrated in
  error paths and early returns): per-file early-return checklist,
  typed Result making every error path explicit, per-batch vitest,
  E2E, error-path smoke.
- **`all_errors` turns future innocent `try/finally` into a build
  failure**: intended; signposted in `.claude/rules/frontend.md`
  (extract to a service, or `'use no memo'` + comment).
- **Unfixable Invariant files**: capped by the escape-hatch budget.
- **Consolidation overlap**: loader hooks keep signatures; services
  become the shared substrate `useQuery` calls later.

## Rollback

Each PR squash-merges → one-commit revert each. Reverting A restores
the #268 status quo (B not yet merged). Reverting B alone keeps files
compiled, so the compiler still memoizes — minimal perf exposure.

## Out of scope

- TanStack Query migration (extraction data-path consolidation owns it).
- Rewriting service internals the sweep does not touch.
- Removing the residual ≈16 memo exceptions.
- Performance profiling evidence (same stance as #268).
