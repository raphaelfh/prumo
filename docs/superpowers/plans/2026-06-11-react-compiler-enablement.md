---
status: in_progress
last_reviewed: 2026-06-11
owner: '@raphaelfh'
---

# React Compiler Enablement + Manual Memoization Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `babel-plugin-react-compiler` in the Vite build (app + vitest) and remove the ~300 manual memoization sites, in one PR on branch `feat/react-compiler-enablement`.

**Architecture:** Three review phases per the approved spec ([2026-06-11-react-compiler-enablement-design.md](../specs/2026-06-11-react-compiler-enablement-design.md)): (1) compiler on with zero app-code changes, gated by a pipeline-level compilation proof; (2) mechanical memo-removal sweep in six directory batches with a triage-driven exception list; (3) cleanup + full verification (gates, E2E, manual smoke). The sweep is refined into one commit per batch — finer-grained than the spec's "commit 2", same review intent; squash-merge collapses it anyway.

**Tech Stack:** Vite 7, `@vitejs/plugin-react` (replacing `@vitejs/plugin-react-swc`), `babel-plugin-react-compiler` v1.x, React 19.2.7 (compiler runtime built in), vitest 4, Playwright.

**Branch:** `feat/react-compiler-enablement` (exists; carries the spec commits). All commands run from the repo root.

---

### Task 1: Toolchain currency check

The spec's decision rule: the documented-stable path wins; Babel is the guaranteed fallback. Check whether the SWC/OXC toolchain gained official, stable React Compiler support since this plan was written.

- [ ] **Step 1: Check current docs**

Query context7 (or `npm view @vitejs/plugin-react-swc` changelog / react.dev compiler installation page) for: "React Compiler Vite installation" and "@vitejs/plugin-react-swc react compiler support".

- [ ] **Step 2: Decide**

- If `@vitejs/plugin-react-swc` (or an official OXC plugin) documents stable compiler support: keep the SWC plugin and adapt Task 3 to its documented option shape — everything else in this plan is unchanged (the coverage proof in Task 2 validates whichever pipeline is used).
- Otherwise (expected): proceed with the Babel path exactly as written below.

Record the decision in one line in the PR body draft (`/tmp/pr-notes.md`).

---

### Task 2: Compilation-proof script (red) + dev-server baseline

The detector comes first so we can watch it fail against the current SWC pipeline — proving it detects absence, not vacuously passing.

**Files:**
- Create: `scripts/check_compiler_coverage.mjs`

- [ ] **Step 1: Write the script**

```js
// scripts/check_compiler_coverage.mjs
// Proves the Vite pipeline applies the React Compiler to BOTH a .tsx
// component and a plain .ts hook (hooks have no JSX — a JSX-only Babel
// include filter would silently skip them). Exits 1 if any target lacks
// compiler artifacts. Run: node scripts/check_compiler_coverage.mjs
import { createServer } from 'vite';

const TARGETS = [
  '/frontend/components/ui/sidebar.tsx', // .tsx component
  '/frontend/hooks/useProjectsList.ts', // .ts hook, no JSX
];

const server = await createServer({ logLevel: 'silent' });
let failed = false;
try {
  for (const target of TARGETS) {
    const result = await server.transformRequest(target);
    const ok = Boolean(result?.code?.includes('react/compiler-runtime'));
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${target}`);
    if (!ok) failed = true;
  }
} finally {
  await server.close();
}
if (failed) {
  console.error('React Compiler is NOT applied to all targets by the Vite pipeline.');
  process.exit(1);
}
console.log('Compiler coverage proof: PASS');
```

- [ ] **Step 2: Run it — expect FAIL (compiler not enabled yet)**

Run: `node scripts/check_compiler_coverage.mjs`
Expected: `FAIL` on both targets, exit code 1.

- [ ] **Step 3: Record dev-server cold-start baseline (SWC)**

Precondition: nothing on port 8080 (`make stop` if the stack is up).

```bash
(npx vite > /tmp/dev-start-swc.log 2>&1 & echo $! > /tmp/vite.pid); sleep 12; kill "$(cat /tmp/vite.pid)"; grep -o "ready in [0-9]* ms" /tmp/dev-start-swc.log
```

Record the number in `/tmp/pr-notes.md` as `dev cold start (SWC): X ms`.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/check_compiler_coverage.mjs
git commit -m "test(build): add React Compiler pipeline coverage proof script"
```

---

### Task 3: Enable the compiler (green)

**Files:**
- Modify: `vite.config.ts:2,47`
- Modify: `vitest.config.ts:3,7`
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Swap dependencies**

```bash
npm remove @vitejs/plugin-react-swc && npm install -D @vitejs/plugin-react babel-plugin-react-compiler
```

- [ ] **Step 2: Update `vite.config.ts`**

Replace line 2 and line 47:

```ts
// line 2 — was: import react from "@vitejs/plugin-react-swc";
import react from "@vitejs/plugin-react";
```

```ts
// line 47 — was: plugins: [react()],
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
```

- [ ] **Step 3: Update `vitest.config.ts` identically**

Replace line 3 and line 7 with the same import and the same `react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } })` call — the 451-test suite must exercise compiled output, not the original source.

- [ ] **Step 4: Run the coverage proof — expect PASS**

Run: `node scripts/check_compiler_coverage.mjs`
Expected: `OK` on both targets, `Compiler coverage proof: PASS`, exit 0.
If the `.ts` hook fails while the `.tsx` passes, the Babel `include` filter is JSX-only — fix the plugin config (e.g., `react({ include: /\.[jt]sx?$/, babel: {...} })`) before proceeding. **Hard gate: no removal work until this passes.**

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts vitest.config.ts package.json package-lock.json
git commit -m "build(frontend): enable React Compiler via @vitejs/plugin-react + babel plugin"
```

---

### Task 4: Bailout enumeration

A component the compiler skips keeps working but unmemoized — removing manual memo there is a perf regression. Enumerate bailouts deterministically: with `panicThreshold: 'all_errors'` the build throws on any component that fails to compile.

- [ ] **Step 1: Temporarily harden the plugin (do not commit)**

In `vite.config.ts` only, change the plugin options to:

```ts
plugins: [["babel-plugin-react-compiler", { panicThreshold: "all_errors" }]],
```

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tee /tmp/bailouts.txt; tail -3 /tmp/bailouts.txt`

- Build passes → zero bailouts. Spec exceptions 3 and 4 are empty; plain `memo()` unwrapping is unconditionally allowed in the sweep.
- Build fails → each error names a bailing component. The named files KEEP their manual memoization (exception 3) and their child components keep plain `memo()` (exception 4). Save the list to `/tmp/pr-notes.md`.

- [ ] **Step 3: Revert the temporary option**

Restore `[["babel-plugin-react-compiler", {}]]` in `vite.config.ts`. Verify with `git diff vite.config.ts` → no diff against the Task 3 commit.

---

### Task 5: Commit-1 gates

The "compiler on, manual memo preserved" state must be fully green before any removal — it is also the re-cut point of the rollback ladder.

- [ ] **Step 1: Run the gates**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
```

Expected: lint 0 errors/0 warnings; typecheck clean; 451/451 tests; build green. Any failure here is a compiler-integration bug — fix before proceeding (escalation: `"use no memo"` directive on the offending component, with a tracking comment).

- [ ] **Step 2: Record post-swap dev cold start**

Same command as Task 2 step 3, log to `/tmp/dev-start-babel.log`. Record `dev cold start (Babel+compiler): Y ms` in `/tmp/pr-notes.md`. If Y > 3× the SWC baseline, stop and re-evaluate Task 1's decision before continuing.

- [ ] **Step 3: Record bundle baseline delta**

`du -sh dist/assets | tee -a /tmp/pr-notes.md` (compare against a `dev`-branch build if exact delta wanted; informational only).

---

### Task 6: Inventory + narrow/broad-deps triage report

Mechanical triage replaces hand-auditing ~300 sites. `react-hooks/exhaustive-deps` reports BOTH missing deps (manual narrower than referenced → identity changes more after removal) and unnecessary deps (manual broader than referenced → value goes STALE after removal, e.g. extra deps forcing recompute of impure store reads). Both classes go to the audit list.

**Files:**
- Create (temporary, not committed): `eslint.deps-report.config.js`

- [ ] **Step 1: Regenerate the memo inventory**

```bash
grep -rEn "useMemo\(|useCallback\(|React\.memo\(|[^a-zA-Z.]memo\(" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|frontend/test/" > /tmp/memo-inventory.txt; wc -l /tmp/memo-inventory.txt
```

- [ ] **Step 2: Create the one-off report config**

```js
// eslint.deps-report.config.js — one-off triage report, DELETE after Task 6
import base from './eslint.config.js';

export default [
  ...base,
  {
    files: ['frontend/**/*.{ts,tsx}'],
    rules: { 'react-hooks/exhaustive-deps': 'warn' },
  },
];
```

- [ ] **Step 3: Generate the report**

```bash
npx eslint frontend -c eslint.deps-report.config.js 2>&1 | tee /tmp/deps-report.txt | grep -c "exhaustive-deps"
```

Every `useMemo`/`useCallback` site flagged in `/tmp/deps-report.txt` (either "missing dependency" or "unnecessary dependency") is an **audit case**; unflagged sites are safe mechanical removals.

- [ ] **Step 4: Delete the temporary config**

```bash
rm eslint.deps-report.config.js
```

---

### Sweep batches — shared transformation recipe

Each batch task below applies these rules to its directories. Consult `/tmp/deps-report.txt` for the batch's files first.

**Rule A — unflagged `useMemo` → inline:**

```ts
// before
const reviewers = useMemo(() => reviewersQuery.data ?? [], [reviewersQuery.data]);
// after
const reviewers = reviewersQuery.data ?? [];
```

**Rule B — unflagged `useCallback` → plain function:**

```ts
// before
const scrollPrev = useCallback(() => { api?.scrollPrev(); }, [api]);
// after
const scrollPrev = () => { api?.scrollPrev(); };
```

**Rule C — plain `memo()` → unwrap** (only allowed because Task 4 found zero bailouts; if Task 4 listed bailouts, children of those files keep `memo()`):

```ts
// before
export const FieldsHeader = memo(function FieldsHeader({ a, b }: Props) { ... });
// after
export function FieldsHeader({ a, b }: Props) { ... }
```

**Rule D — flagged "missing dependency" (manual deps narrower):** the memo is load-bearing for effect cadence. If the callback is really a "latest-props handler" (reads fresh values, identity must be frozen), convert to `useEffectEvent` (React 19.2, already stable):

```ts
// before
const onTick = useCallback(() => { doSomething(props.value); }, []); // deliberately stale-free identity
// after
import { useEffectEvent } from 'react';
const onTick = useEffectEvent(() => { doSomething(props.value); });
```

Otherwise KEEP the memo with a one-line comment: `// kept: deps intentionally narrower than referenced — removal changes effect cadence (see compiler-enablement spec, exception 2)`.

**Rule E — flagged "unnecessary dependency" (manual deps broader):** the extra dep forces recompute of an impure read. Prefer rewriting as a pure derivation from the dep itself; if non-trivial, KEEP the memo with a one-line comment: `// kept: extra dep forces recompute of impure read — removal would freeze the value (spec exception 2)`.

```ts
// before (NotificationCenter.tsx:43) — getRecentJobs reads the store; `jobs` forces recompute
const recentJobs = useMemo(() => getRecentJobs(20), [jobs, getRecentJobs]);
// after — pure derivation from the reactive value
const recentJobs = jobs.slice(0, 20); // match getRecentJobs' actual selection logic, or keep memo + comment
```

**Rule F — custom comparators stay** (`memo(X, arePropsEqual)`): `FieldInput.tsx:502`, `ExtractionFormView.tsx:153`, and any others in the inventory — add `// kept: custom comparator, compiler does not replicate arePropsEqual` if no comment exists.

**Per-batch verification (identical for Tasks 7–12):**

```bash
npx eslint <batch-dirs> && npm run typecheck && npm run test:run
```

Expected: 0 lint problems in batch dirs, typecheck clean, 451/451. Then commit.

---

### Task 7: Sweep batch 1 — components/ui + components/shared

**Files:** Modify: every file under `frontend/components/ui/`, `frontend/components/shared/` listed in `/tmp/memo-inventory.txt`.

- [ ] **Step 1:** Apply rules A–F to the batch files (triage list first).
- [ ] **Step 2:** Run per-batch verification (dirs: `frontend/components/ui frontend/components/shared`). Expected: green.
- [ ] **Step 3:** Commit:

```bash
git add frontend/components/ui frontend/components/shared
git commit -m "refactor(frontend): drop manual memoization in ui + shared components (compiler)"
```

---

### Task 8: Sweep batch 2 — pages + contexts + pdf-viewer

**Files:** Modify: inventory files under `frontend/pages/`, `frontend/contexts/`, `frontend/pdf-viewer/`.

- [ ] **Step 1:** Apply rules A–F. **Extra check (spec exception 5):** `grep -rn "Provider value={" frontend/contexts frontend/pages frontend/pdf-viewer` — for every provider whose `value` was `useMemo`-wrapped, confirm the file is not on the bailout list before removing; providers go on the smoke checklist regardless.
- [ ] **Step 2:** Per-batch verification (dirs: `frontend/pages frontend/contexts frontend/pdf-viewer`). Expected: green.
- [ ] **Step 3:** Commit: `git add frontend/pages frontend/contexts frontend/pdf-viewer && git commit -m "refactor(frontend): drop manual memoization in pages, contexts, pdf-viewer (compiler)"`

---

### Task 9: Sweep batch 3 — shared/top-level hooks + performance

**Files:** Modify: inventory files under `frontend/hooks/` EXCEPT `extraction/ hitl/ qa/ runs/` (those are batch 6); Delete: `frontend/components/performance/ReactMemoWrapper.tsx`; Modify: `frontend/components/performance/index.ts:2`.

- [ ] **Step 1:** Verify `ReactMemoWrapper` has zero callers: `grep -rn "withListMemo\|withCustomMemo" frontend --include='*.ts*' | grep -v "ReactMemoWrapper\|performance/index"` → expect empty. Then delete the file and remove line 2 (`export { withListMemo, withCustomMemo } ...`) from `frontend/components/performance/index.ts`.
- [ ] **Step 2:** Apply rules A–F to the batch hooks.
- [ ] **Step 3:** Per-batch verification (dirs: `frontend/hooks frontend/components/performance`). Expected: green.
- [ ] **Step 4:** Commit: `git add -A frontend/hooks frontend/components/performance && git commit -m "refactor(frontend): drop manual memoization in shared hooks; delete ReactMemoWrapper (compiler)"`

---

### Task 10: Sweep batch 4 — feature components

**Files:** Modify: inventory files under `frontend/components/{articles,project,user,hitl,navigation}/`.

- [ ] **Step 1:** Apply rules A–F. `NotificationCenter.tsx:43` (`recentJobs`) is a known Rule-E case — resolve per Rule E.
- [ ] **Step 2:** Per-batch verification (dirs: the five component subdirs). Expected: green.
- [ ] **Step 3:** Commit: `git add frontend/components/articles frontend/components/project frontend/components/user frontend/components/hitl frontend/components/navigation && git commit -m "refactor(frontend): drop manual memoization in feature components (compiler)"`

---

### Task 11: Sweep batch 5 — extraction components

**Files:** Modify: inventory files under `frontend/components/extraction/` and `frontend/components/{assessment,runs}/` if present in inventory.

- [ ] **Step 1:** Apply rules A–F. **Rule F applies to the hot path:** `FieldInput.tsx:502` and `ExtractionFormView.tsx:153` keep their comparators. Plain `memo()` here (`ExtractionPDFPanel`, `FieldsTable`, `FieldsHeader`, `EmptyFieldsState`, `HeaderCheckbox`) unwraps per Rule C only because Task 4 proved zero bailouts.
- [ ] **Step 2:** Per-batch verification (dirs: `frontend/components/extraction frontend/components/assessment frontend/components/runs`). Expected: green.
- [ ] **Step 3:** Commit: `git add frontend/components/extraction frontend/components/assessment frontend/components/runs && git commit -m "refactor(frontend): drop manual memoization in extraction components (compiler)"`

---

### Task 12: Sweep batch 6 — domain hooks (extraction/hitl/qa/runs)

**Files:** Modify: inventory files under `frontend/hooks/{extraction,hitl,qa,runs}/`.

- [ ] **Step 1:** Apply rules A–F. These hooks carry timing contracts (autosave dirty badge sync after rerender; session POST starts synchronously in the effect — see the burn-down learnings). Rule D candidates here (e.g., latest-ref patterns) convert to `useEffectEvent` only if the dedicated test files stay green.
- [ ] **Step 2:** Run the contract tests explicitly first:

```bash
npx vitest run frontend/test/hooks/useAutoSaveProposals.test.tsx frontend/test/hooks/useExtractionSession.test.tsx frontend/test/hooks/useModelManagement.test.tsx
```

Expected: all pass.

- [ ] **Step 3:** Per-batch verification (dirs: `frontend/hooks/extraction frontend/hooks/hitl frontend/hooks/qa frontend/hooks/runs`). Expected: green.
- [ ] **Step 4:** Commit: `git add frontend/hooks && git commit -m "refactor(frontend): drop manual memoization in domain hooks (compiler)"`

---

### Task 13: Cleanup + full local gates

- [ ] **Step 1: Orphaned imports**

```bash
npm run lint 2>&1 | grep -E "no-unused-vars|useMemo|useCallback|memo" | head -20
```

Remove every unused `useMemo`/`useCallback`/`memo`/`React.memo` import the lint reports. Re-run until clean.

- [ ] **Step 2: Full gates on the final tree**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build && node scripts/check_compiler_coverage.mjs
```

Expected: 0/0 lint, clean typecheck, 451/451, build green, coverage proof PASS.

- [ ] **Step 3: Residual inventory check**

```bash
grep -rEn "useMemo\(|useCallback\(|[^a-zA-Z.]memo\(" frontend --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|frontend/test/" | grep -v "kept:" | head
```

Expected: every remaining hit sits on a line (or directly above one) carrying a `// kept:` exception comment. Fix stragglers.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(frontend): cleanup orphaned memo imports after compiler sweep"
```

---

### Task 14: E2E local

- [ ] **Step 1: Stack up**

```bash
make start
```

(Local Supabase via Docker + backend + frontend. If the DB was reset bare, run `make db-fresh` first — the global CHARMS template must exist.)

- [ ] **Step 2: Run E2E**

```bash
npm run test:e2e:local 2>&1 | tail -15
```

Expected: the current dev baseline profile — passes + known conditional skips, **no NEW failures**. If a test fails: check out `dev`, re-run the same spec file to confirm it is new to this branch before debugging here.

---

### Task 15: Manual smoke on the local preview

Login `teste@prumo.local` / `Senha123` (test account, never the personal one) at `http://localhost:8080`.

- [ ] **Step 1:** ExtractionFullScreen: open an article extraction; type rapidly across several fields — no input lag, autosave badge cycles dirty→saving→saved; resize the PDF panel (drag + click-collapse + snap-close animation).
- [ ] **Step 2:** QA full screen: open a quality assessment, fill domains, publish flow completes.
- [ ] **Step 3:** Extraction dialogs: open/close AddModel, ImportTemplate, Export — state resets on reopen, no flicker loops.
- [ ] **Step 4:** Comparison views (multi-user) render and switch entities/models without jank.
- [ ] **Step 5:** Sidebar collapse/expand, skeletons on reload, notifications dropdown.
- [ ] **Step 6:** While the dev server runs, note subjective HMR latency editing `frontend/components/ui/sidebar.tsx` (record in `/tmp/pr-notes.md`); watch the browser console for render-loop warnings (none expected).
- [ ] **Step 7:** `make stop`.

---

### Task 16: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/react-compiler-enablement
gh pr create --base dev --label needs-review --title "perf(frontend): enable React Compiler and remove manual memoization"
```

PR body: spec link, Task 1 decision line, compilation-proof output, bailout count (expected 0), exceptions kept (count + rule letters), dev cold-start before/after, bundle delta, gate checklist (lint/typecheck/451 tests/build/E2E baseline/smoke) — all from `/tmp/pr-notes.md`.

- [ ] **Step 2: Auto-merge**

```bash
gh pr merge feat/react-compiler-enablement --auto --squash
```

Nudge with `gh pr update-branch` if dev moves (strict status checks).

---

## Execution outcome (2026-06-11, appended post-execution)

Reality diverged from three planning assumptions — trust this block over
the task text above:

1. **Bailouts were NOT ≈0**: the compiler bails on ~80 files (~210 memo
   sites, 70% of the inventory), dominated by `try/finally` in handlers
   (unsupported by compiler v1) plus `props.x.y` destructuring patterns.
   Those files keep ALL manual memoization, uncommented (per-site comments
   at that volume would be noise). Regenerate the list with
   `reactCompilerPreset({panicThreshold: 'all_errors'})` in
   `vite.shared-plugins.ts` + `npm run build` — errors name the files.
2. **Task 3's config shape changed**: `@vitejs/plugin-react` v6 dropped
   built-in Babel; actual setup is `react()` + `@rolldown/plugin-babel`
   with `reactCompilerPreset()`, shared by both configs via
   `vite.shared-plugins.ts` (Vite 8, not 7).
3. **Task 13's residual check is superseded**: 226 sites remain by design
   (210 bailout + 16 documented exceptions, 8 with `// kept:` comments —
   custom comparators, parent-bails, the "compiled-no-memo" hook class
   discovered mid-sweep, and useSyncExternalStore subscribe stability).
   "Compiled-no-memo" (e.g. single free-function-call hook bodies) is NOT
   safe for removal — the true criterion is the per-file post-edit
   transform audit, enforced in CI by `scripts/check_compiler_coverage.mjs`.
