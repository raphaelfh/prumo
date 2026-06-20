---
status: ready
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# RunHeader Plan 2 — namespace seam, reveal, worklist, Cmd-K, QA migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the shared `RunHeader` lib so QA can adopt it and the 2026 header is complete: a `runs` copy namespace (de-couple the slots from `extraction` copy), an actionable blind reveal, a worklist queue peek, Cmd-K + container-query collapse, and the QA header migrated onto `<RunHeader>` (deleting QA's hand-rolled header).

**Architecture:** Builds on Plan 1's lib at `frontend/components/runs/header/`. Task order is gated: the **namespace seam (A)** must land before the **QA migration (E)** so QA renders its own copy, not extraction's. Reveal/worklist/Cmd-K are independent slot additions.

**Tech Stack:** React 19 + TS strict, Vite, shadcn/Radix (`command`, `popover`), Tailwind + `@tailwindcss/container-queries` (already installed in Plan 1), Vitest + Testing Library + user-event.

**Source spec:** `docs/superpowers/specs/2026-06-19-extraction-view-ux-design.md` §3.3a (see the "Plan 2 scope" status note).

## Global Constraints

- **English only**; all user-facing strings via `frontend/lib/copy/`. Shared run-header strings live in the **new `runs` namespace** (`t('runs', …)`), not `extraction`.
- **No schema / API / run-state changes.** Reveal reuses the existing `setManagerReviewVisibility` PUT; the worklist uses only the already-loaded `articles` (`id`/`title`) list — **no per-article status dots** (that needs a batch endpoint = out of scope; ship search/jump/count only).
- **React Compiler `panicThreshold: 'all_errors'`**: no `try/finally` in component/hook bodies; IO via `services/*` returning `ErrorResult` (`toResult`); read API errors as `error.message`. Preserve `// kept:` memos.
- **Visible focus** on every interactive element. Tests from repo ROOT: `npm run test:run`; mock copy `vi.mock('@/lib/copy', () => ({ t: (_ns, key) => key }))`.
- **Reuse, don't reinvent:** reveal mirrors `frontend/components/runs/ManagerReviewVisibilityToggle.tsx` (calls `setManagerReviewVisibility` from `frontend/services/hitlConfigService.ts`); `useComparisonPermissions` exposes `refresh()`.

## File Structure

**Create:** `frontend/lib/copy/runs.ts` (new namespace); `frontend/components/runs/header/Worklist.tsx`; `frontend/components/runs/header/CommandPalette.tsx` (Cmd-K); `frontend/lib/qa/qaTransition.ts` (QA's `StageTransition` builder). Tests alongside.
**Modify:** `frontend/lib/copy/index.ts` (register `runs`); `frontend/lib/copy/extraction.ts` (remove moved keys); all `frontend/components/runs/header/*.tsx` slots + `stage.ts` (`t('extraction'…)` → `t('runs'…)`); `RunHeaderContext.tsx` (widen `StageTransition.to`); `RoleChip.tsx` (reveal already supports `onReveal` — page wires it); `ExtractionHeader.tsx` + `ExtractionFullScreen.tsx` (Worklist + reveal + Cmd-K + `@container`); `QualityAssessmentFullScreen.tsx` (swap header). `.markdownlintignore` (+this plan).

---

### Task 1 (A): `runs` copy namespace + de-couple the slots

**Files:** Create `frontend/lib/copy/runs.ts` + test `frontend/test/copyRuns.test.ts`; Modify `frontend/lib/copy/index.ts`, `frontend/lib/copy/extraction.ts`, every `frontend/components/runs/header/*.tsx` that calls `t('extraction', 'runHeader*')`, and `stage.ts`.

**Interfaces:** Produces `runs` namespace (`t('runs', key)`); `CopyNamespace` auto-gains `'runs'`.

- [ ] **Step 1 — failing test** `frontend/test/copyRuns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/copy';
describe('runs copy namespace', () => {
  it('resolves shared run-header keys', () => {
    expect(t('runs', 'revision')).toBe('Revision');
    expect(t('runs', 'stageReview')).toBe('Review');
    expect(t('runs', 'reconcile')).toBe('Reconcile');
  });
});
```

- [ ] **Step 2** run → fail (`runs` not a namespace).
- [ ] **Step 3 — create `frontend/lib/copy/runs.ts`** following the namespace pattern (`export const runs = {…} as const; export type RunsCopy = typeof runs;`). Move the `runHeader*`/stage/transition keys added in Plan 1 out of `extraction.ts` into here, renamed without the `runHeader` prefix where natural, e.g.:

```ts
export const runs = {
  revision: 'Revision',
  gateRemaining: '{{count}} left',
  requiredOfTotal: '{{done}} of {{total}} required',
  reviewersDiffer: '{{count}} differ',
  blindSuffix: 'blind',
  revealedSuffix: 'revealed',
  reveal: 'Reveal reviewers',
  blindExplainer: "You're blind to reviewers' values for this kind.",
  togglePanel: 'Toggle source panel',
  saved: 'Saved', saving: 'Saving…', saveFailed: 'Save failed',
  more: 'More options',
  submitForReview: 'Submit for review', reconcile: 'Reconcile', finalize: 'Finalize',
  gateBlocked: 'Complete the required fields first',
  stageProposal: 'Proposal', stageReview: 'Review', stageConsensus: 'Consensus', stageFinalized: 'Finalized',
  extractWithAI: 'Extract with AI',
  articlePrevious: 'Previous article', articleNext: 'Next article',
} as const;
export type RunsCopy = typeof runs;
```

- [ ] **Step 4 — register** in `frontend/lib/copy/index.ts`: `import {runs} from './runs';` and add `runs,` to the `copy` object.
- [ ] **Step 5 — repoint slots + stage.ts:** in every `frontend/components/runs/header/*.tsx` change `t('extraction', 'runHeaderX')` → `t('runs', 'x')` (matching the renamed keys); in `stage.ts` replace the hardcoded `LABEL` map with the keys (`StageRail` renders `t('runs', 'stage'+Key)` — pass the key from `stageNodeStates`, or map key→`runs` key in `StageRail`). Remove the now-orphaned `runHeader*` keys from `extraction.ts`.
- [ ] **Step 6** run the header test group + `npm run test:run` (full) + `npm run typecheck`; fix any `t('extraction'…)` the slot tests asserted (they mock copy → assert on the new keys). Update slot tests' expected key strings.
- [ ] **Step 7 — commit** `refactor(runs): move shared RunHeader copy into a runs namespace`.

---

### Task 2: widen `StageTransition.to` off `ExtractionRunStage`

**Files:** Modify `frontend/components/runs/header/RunHeaderContext.tsx`; Test: extend `RunHeader.test.tsx`.

- [ ] **Step 1 — failing test:** a `StageTransition` with `to: 'published'` (a non-`ExtractionRunStage` string) type-checks when constructed in the test (compile-level; assert the object builds and `PrimaryAction` renders its label).
- [ ] **Step 2** run → fail (type error on `to`).
- [ ] **Step 3** change `StageTransition.to` from `ExtractionRunStage` to `string` in `RunHeaderContext.tsx` (the shared context must not bake in extraction's stage union; the extraction/QA builders keep the narrow type internally). Keep everything else.
- [ ] **Step 4** run → pass; `npm run typecheck` clean.
- [ ] **Step 5 — commit** `refactor(runs): widen StageTransition.to to string in shared context`.

---

### Task 3 (B): actionable reveal on RoleChip

**Files:** Modify `frontend/pages/ExtractionFullScreen.tsx` (compute `canReveal`/`onReveal`); Test: `frontend/test/extractionReveal.test.tsx` (or a focused page test).

**Interfaces:** Consumes `setManagerReviewVisibility(projectId, kind, value)` (`@/services/hitlConfigService`), `useComparisonPermissions(...).refresh()`. RoleChip already renders the reveal popover when `canReveal` (Plan 1).

- [ ] **Step 1 — failing test:** mock `hitlConfigService.setManagerReviewVisibility` (resolved) and a `refresh` spy; render the extraction header path with `permissions.userRole==='manager'` + blind; assert clicking RoleChip → Reveal calls `setManagerReviewVisibility(projectId, 'extraction', true)` then `refresh`.
- [ ] **Step 2** run → fail (page passes `canReveal={false}` today).
- [ ] **Step 3 — wire in `ExtractionFullScreen`:** `const canReveal = permissions.userRole === 'manager' && permissions.isBlindMode;` and `const onReveal = () => { void setManagerReviewVisibility(projectId, 'extraction', true).then(() => permissions.refresh()).catch((e) => toast.error(e instanceof Error ? e.message : String(e))); };` Pass `canReveal`/`onReveal` to `<ExtractionHeader>` (props already exist from Plan 1). Use `ReviewKind` `'extraction'`. No try/finally (promise `.then/.catch`).
- [ ] **Step 4** run → pass; full suite + typecheck clean.
- [ ] **Step 5 — commit** `feat(extraction): wire manager reveal on the RunHeader role chip`.

---

### Task 4 (C): `RunHeader.Worklist` peek (search + jump + count; no status dots)

**Files:** Create `frontend/components/runs/header/Worklist.tsx` + test; Modify `RunHeader.tsx` (attach), `ExtractionHeader.tsx` (render Worklist with the `articles`/`currentArticleId`/`onNavigateToArticle` props it already receives, replacing the inline prev/next pager from Plan 1).

**Interfaces:** Produces `RunHeader.Worklist` props `{ articles: {id:string; title:string}[]; currentId: string; onNavigate: (id:string)=>void }`. Uses `@/components/ui/{popover,command}` + `t('runs',…)`.

- [ ] **Step 1 — failing test** (`__tests__/Worklist.test.tsx`): renders a `‹ 4 / 28 ›` trigger; opening the popover shows a `Command` list of titles + a "N of M · K remaining"-style header; clicking a row calls `onNavigate(id)`; prev/next buttons call `onNavigate` with the adjacent id and disable at the ends. (Mock copy.)
- [ ] **Step 2** run → fail.
- [ ] **Step 3 — implement `Worklist.tsx`:** a pill `‹ {idx+1} / {len} ›` where the center is a `PopoverTrigger`; prev/next ghost icon-buttons (ChevronLeft/Right, disabled at ends, `aria-label` via `t('runs','articlePrevious'/'articleNext')`, onClick → `onNavigate(adjacent)`). `PopoverContent` (w-80, `shadow-elev-popover`) contains a `Command`: `CommandInput` (placeholder "Go to article…"), a header line "{idx+1} of {len}", `CommandItem` per article (title truncated; current row `bg-info/10`; `onSelect` → `onNavigate(id)` + close). Keyboard: cmdk handles up/down/enter/filter natively. No per-article status dot (data not available — leave a `// TODO(plan-future): per-article status needs a batch runs endpoint` comment, and `log()`-free). Attach `Worklist` to the compound export.
- [ ] **Step 4 — swap into ExtractionHeader:** replace the Plan-1 inline prev/next pager block with `<RunHeader.Worklist articles={articles} currentId={currentArticleId} onNavigate={onNavigateToArticle} />` in the Left zone (only when `articles.length > 1`).
- [ ] **Step 5** run → pass; full suite + typecheck + bailout check clean.
- [ ] **Step 6 — commit** `feat(runs): RunHeader.Worklist queue peek (search + jump)`.

---

### Task 5 (D): Cmd-K long-tail + container-query collapse

**Files:** Create `frontend/components/runs/header/CommandPalette.tsx` + test; Modify `ExtractionHeader.tsx` (mount palette + add a `@container` + collapse classes), `ExtractionFullScreen.tsx` (pass the action handlers + open-state, or use a keydown listener).

**Interfaces:** Produces `RunHeader.CommandPalette` props `{ open; onOpenChange; actions: { id:string; label:string; run:()=>void }[]; articles?; onNavigate? }` using `@/components/ui/command` (`CommandDialog`).

- [ ] **Step 1 — failing test:** with `open=true` and two actions, the dialog renders both labels; selecting one calls its `run`; a "Go to article…" group navigates. (Mock copy.)
- [ ] **Step 2** run → fail.
- [ ] **Step 3 — implement `CommandPalette.tsx`** with `CommandDialog` (open/onOpenChange) + `CommandInput` + grouped `CommandItem`s for the passed `actions` (Compare, Reopen, Export, Reveal, toggle panel, shortcuts) and an optional "Go to article…" group. Attach to compound export. Add a global `⌘K`/`Ctrl+K` keydown listener in `ExtractionHeader` (or the page) scoped to not-while-typing that toggles `open` — use a small `useEffect` with `addEventListener`/`removeEventListener` cleanup (NOT try/finally).
- [ ] **Step 4 — container-query collapse:** wrap the header bar content in a `@container` and apply width-based collapse so the bar stops overflowing below ~1100px: e.g. stage-rail labels hide under `@max-[68rem]` (show dots only), the breadcrumb truncates harder, the worklist counter collapses — primary action + Cmd-K hint stay. (Use the installed `@tailwindcss/container-queries` `@`-variants; the container goes on the header's own wrapper, not the viewport.) Add a small visible `⌘K` hint chip.
- [ ] **Step 5 — wire the page:** pass the edge actions (Compare/Reopen/Export/Reveal/panel-toggle/shortcuts) as `actions` to the palette; these are the same handlers the Menu uses. Move shortcuts/help here (restoring what HeaderMoreMenu had).
- [ ] **Step 6** run full suite + typecheck + lint + bailouts; controller does an in-browser pass (⌘K opens; bar collapses cleanly at ~900px with no overlap).
- [ ] **Step 7 — commit** `feat(runs): Cmd-K palette + container-query header collapse`.

---

### Task 6 (E): migrate the QA header onto `<RunHeader>`

**Files:** Create `frontend/lib/qa/qaTransition.ts` + test; Modify `frontend/pages/QualityAssessmentFullScreen.tsx` (swap `:477-580` for `<RunHeader>`); delete any now-dead QA-header bits.

**Interfaces:** Consumes the full `RunHeader` lib + a new `buildQaTransition` (mirrors `buildExtractionTransition` but for QA's publish/advance handlers).

- [ ] **Step 1 — `buildQaTransition` test + impl** (`frontend/lib/qa/qaTransition.ts`): pure builder mapping QA `stage` + `canResolveConflicts` + completeness → a `StageTransition` whose label uses `t('runs',…)` and whose `onAdvance` is QA's `handlePublish`/advance/`onGuide` (gate from QA's completeness). Test the branches like Task 8 of Plan 1. Commit.
- [ ] **Step 2 — failing page test:** assert the QA page renders `getByRole('navigation', { name: 'Run stage' })` and NOT the old `data-testid="qa-publish-button"` strip wrapper (or whichever marker identifies the hand-rolled header). 
- [ ] **Step 3 — swap the header:** replace the `header` JSX (`:477-580`) with a `<RunHeader value={…} kind="qa">` composition: Left(Breadcrumb[project › article + a `qa` kind badge + `v{version}`] + StageRail) · Center(Reviewers + RoleChip) · Right(AIActions[QA's `extractForRun`] + PanelToggle[QA has a PDF panel] + Save + PrimaryAction[from `buildQaTransition`, label "Publish"/"Finalize"] + Menu[Compare toggle + Reopen]). Map QA's state/handlers (title=`template?.name`, stage=`runDetail?.run.stage`, finalized, parentRunId→isRevision, reviewerSummary, saveState, aiSuggestions/extractingAI, publishing→submitting, handlePublish/handleReopen). Wire QA reveal with `kind='quality_assessment'`.
- [ ] **Step 4 — delete** the dead QA header JSX + any helpers only it used; keep `pdfPanel`/`AssessmentShell`.
- [ ] **Step 5** run full suite + typecheck + lint + bailouts; controller in-browser pass on the QA route (calm bar parity with extraction).
- [ ] **Step 6 — commit** `feat(qa): migrate quality-assessment header onto shared RunHeader`.

---

## Final verification

- [ ] `npm run test:run` (full) · `npm run typecheck` · `npm run lint` · `node scripts/enumerate_compiler_bailouts.mjs` (no new bailouts).
- [ ] `design-review` on both routes (extraction + QA): one calm bar each, Cmd-K, collapse at narrow width, worklist peek, working reveal.
- [ ] Confirm zero `t('extraction', 'runHeader…')` left in `components/runs/header/` (all shared slots now use `t('runs',…)`).

## Self-review notes (author)

- **Spec coverage (§3.3a Plan-2 scope):** A→Task 1+2; B→Task 3; C→Task 4; D→Task 5; E→Task 6. The carried minors (stage labels via copy, namespace seam, `StageTransition.to`, reveal) are folded into Tasks 1-3.
- **Constraint honesty:** the worklist ships **without per-article status dots** (Task 4) because that data isn't loaded and a batch endpoint is out of scope — documented in the task + a code TODO; this is a deliberate scope cut, not a silent gap.
- **Type consistency:** `runs` keys named in Task 1 are the exact strings the slots/`stage.ts`/builders reference; `buildQaTransition` (Task 6) returns the same `StageTransition` (widened in Task 2) that `PrimaryAction` consumes.
- **Gating:** Task 1 (namespace) precedes Task 6 (QA) so QA doesn't inherit extraction copy — the review's Important finding.
- **No try/finally:** the Cmd-K keydown listener (Task 5) and reveal (Task 3) use effect-cleanup / promise-chains, not try/finally.
