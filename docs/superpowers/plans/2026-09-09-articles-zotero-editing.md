---
status: draft
last_reviewed: 2026-09-09
owner: '@raphaelfh'
---

# Article Editing — Zotero-lean Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the article editor from a form into a record — a dense, single-column list of label→value rows that become inputs only when clicked.

**Architecture:** Decompose `ArticleForm` into per-section components first (it is at its size cap and cannot grow), then introduce an `ArticleFieldRow` read/edit primitive, then convert each section to rows while stripping the nested-card chrome and the multi-column grids. Save, validation and dirty tracking are untouched — only how a value is entered changes.

**Tech Stack:** TypeScript strict, React 19 (React Compiler, `panicThreshold: 'all_errors'`), Tailwind, shadcn/Radix, vitest + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-09-articles-zotero-editing-design.md`](../specs/2026-09-09-articles-zotero-editing-design.md)

## Global Constraints

- **English only** for code, comments, commits, docs, copy keys.
- **All user-facing strings** in `frontend/lib/copy/articles.ts` via `t('articles', key)`. The copy-key ratchet fails on an unreferenced member; deleting a key that is still referenced ships a blank string, because `t()` returns `''` for a miss.
- **Frontend tooling runs from the repo root.** Never `cd frontend`.
- **Use `npm run typecheck`**, never `npx tsc --noEmit` — the root tsconfig is solution-style (`files: []` + references), checks nothing, and exits 0 regardless (`scripts/verify_all.sh:197` documents this).
- **Never read an exit code through a pipe.** `cmd | tail` returns tail's status. Run the command, then `echo $?` on its own line.
- **`npx knip` and `npx knip --production`** must both stay at zero findings.
- **`ArticleForm.tsx` is at EXACTLY 1213/1213**, a shrink-only cap. It cannot grow by one line until Task 1 lands. Never run `--update-baseline` on `check_file_size.py` or `check_button_scale.py`.
- **The local Supabase stack is SHARED** by every session on this machine. Never `make reset-db`, `make db-fresh`, `supabase db reset`, `supabase stop`.
- **Do not modify** `RunSplitShell.tsx`, `RunPdfContent.tsx`, `frontend/pdf-viewer/`, or `ArticlesList`'s column widths/breakpoints/persistence.
- **React Compiler:** no `try/finally` or `throw` inside component/hook bodies; no ref reads during render. IO belongs in `frontend/services/` returning `ErrorResult<T>`.
- Conventional commits.

### Environment facts (verified 2026-09-09)

1. `frontend/test/setup.ts` stubs `window.matchMedia` to `matches:false` and `IntersectionObserver` to a no-op. jsdom resolves no CSS and no layout, so assert **emitted className strings**, never computed style — that is the established idiom, explained at the top of `ArticleFormNarrowViewport.test.tsx`.
2. `ArticleForm`'s import graph reaches the Supabase client, which throws at module scope without env. Copy the `vi.hoisted` env stub from `ArticleForm.dirty.test.tsx` into any new test that mounts it, or the test fails in CI only.
3. Section anchors are `id="article-section-<step>"` and are consumed by both `scrollToSection` and the IntersectionObserver. Any decomposition MUST keep those ids on the same elements.
4. `AuthorFormRow.id` is a `uuidv4()`; the dirty fingerprint compares `authorsFromRows(rows)` for that reason. Do not change that comparison.

---

## Task 1: Decompose `ArticleForm` into section components

**Files:**
- Create: `frontend/components/articles/sections/BasicInfoSection.tsx`, `PublicationSection.tsx`, `IdentifiersSection.tsx`, `AdditionalInfoSection.tsx`, `FilesSection.tsx`
- Modify: `frontend/components/articles/ArticleForm.tsx`
- Test: existing suites must stay green; no new test

**Interfaces:**
- Produces: five section components, each taking the slice of `formData` it renders plus the setters it needs. `ArticleForm` keeps ownership of state, `handleSave`, validation, dirty tracking and the section anchors.

**This is a pure refactor.** No visual change, no behaviour change. It exists to create the headroom every later task needs.

- [ ] **Step 1: Confirm the starting state**

```
python3 scripts/fitness/check_file_size.py
echo $?
wc -l frontend/components/articles/ArticleForm.tsx
```
Expected: exit 0, and 1213 lines — at the cap.

- [ ] **Step 2: Move one section at a time, running the suite after each**

For each of the five sections, move its JSX into the new component, passing exactly the props it reads. Keep `id="article-section-<step>"` on the same element it is on today — `scrollToSection` and the observer both look those ids up by `getElementById`, so moving an id breaks the rail silently (the tests cannot catch it: `IntersectionObserver` is stubbed to a no-op).

After each move: `npm run test:run` then `echo $?`.

- [ ] **Step 3: Verify the shrink**

```
python3 scripts/fitness/check_file_size.py
echo $?
wc -l frontend/components/articles/ArticleForm.tsx
```
Expected: exit 0 and a substantially smaller `ArticleForm.tsx`. Do NOT bump the baseline — tightening it (`--update-baseline` to record the SHRINK) is acceptable only as a separate, clearly-labelled commit, and only downward.

- [ ] **Step 4: Full gates**

`npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production` — each with its real exit code on its own line. All five new files must be reachable from production code or knip fails.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(articles): split the article form into section components"
```

---

## Task 1b: Delete the unreachable `variant="page"` path

**Files:**
- Modify: `frontend/components/articles/ArticleForm.tsx` (drop the `variant` prop and the page branch)
- Delete: `frontend/components/articles/ArticleFormHeader.tsx`'s page header (keep `ArticleFormActions`, which the panel uses)
- Modify: `frontend/test/components/ArticleFormNarrowViewport.test.tsx` (remove the page-variant describe block)
- Modify: `scripts/fitness/check_button_scale.baseline`

**Evidence (verified 2026-09-09, do not re-derive):** `ArticleSidePanel.tsx:14,98` is the ONLY production import and render of `ArticleForm`, and it hardcodes `variant="panel"`. No production file passes `variant="page"`; the sole remaining textual mention is a comment in `ArticleFormHeader.tsx:4`. The legacy `/articles/add` and `/articles/:articleId/edit` routes were retired earlier — `frontend/test/legacyArticleRoutes.test.tsx` asserts they 404.

`.claude/rules/frontend.md` prescribes the action: *"is it genuinely orphaned — no caller anywhere but its own test? delete the code **and** the test."* Knip cannot see this because reachability is by prop VALUE, not by export.

- [ ] **Step 1: Delete the page branch and the `variant` prop**

`isPanel` becomes unconditional. Remove the `variant` prop from `ArticleFormProps` and every call site. Keep `ArticleFormActions` — the panel renders it.

- [ ] **Step 2: Delete the page-variant tests**

Remove the `article editor — header identity (page variant)` describe block. Do NOT keep it "just in case": a test for a path no user can reach is what let this survive. Keep the panel-variant tests.

- [ ] **Step 3: Tighten the button-scale baseline downward**

The two overrides recorded against `ArticleFormHeader.tsx` disappear with the page header. Remove that baseline line (a downward tighten, never an upward bump) and note it in the commit body.

- [ ] **Step 4: Gates**

`npm run test:run`, `npm run typecheck`, `npm run lint`, `npx knip`, `npx knip --production`, `python3 scripts/fitness/check_file_size.py`, `check_button_scale.py`, `check_copy_keys.py` — real exit codes. Delete any copy key whose last reference went with the page header.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(articles): delete the unreachable page variant of the article form"
```

---

## Task 2: The `ArticleFieldRow` primitive

**Files:**
- Create: `frontend/components/articles/ArticleFieldRow.tsx`
- Create: `frontend/test/components/ArticleFieldRow.test.tsx`
- Modify: `frontend/lib/copy/articles.ts`

**Interfaces:**
- Produces:

```tsx
export interface ArticleFieldRowProps {
  label: string;
  /** Current committed value, rendered as text in read state. */
  value: string;
  /** Commit a new value to the parent's form state. Not a save. */
  onCommit: (next: string) => void;
  /** Which control edit state renders. Default 'text'. */
  control?: 'text' | 'multiline' | 'select' | 'switch';
  /** For control='select'. */
  options?: {value: string; label: string}[];
  placeholder?: string;
  /** Marks the row required and surfaces the error. */
  error?: string;
  disabled?: boolean;
}
```

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/components/ArticleFieldRow.test.tsx` covering:

1. **Read state shows the value as text, not an input.** Precondition: the label renders. Then `expect(screen.queryByRole('textbox')).not.toBeInTheDocument()`.
2. **Click enters edit state** and the input carries the current value.
3. **Enter commits** — `onCommit` called once with the typed value, and the row returns to read state showing it.
4. **Esc reverts** — `onCommit` NOT called, and the row shows the original value. Assert the precondition that the input held the edited text before Esc, or the test is vacuous.
5. **Blur commits.**
6. **Keyboard reachable:** the read state is focusable and `{Enter}` on it enters edit state without a mouse.
7. **An empty value is still reachable** — a row with `value=""` renders a clickable placeholder and can be entered.
8. **The label stays associated across the swap** — the input's accessible name is the label.

- [ ] **Step 2: Run and watch them fail**

`npx vitest run frontend/test/components/ArticleFieldRow.test.tsx` → fails, module not found.

- [ ] **Step 3: Implement the primitive**

Read state is a `button` with `type="button"`, the label rendered in a fixed-width left column (`w-32 shrink-0 text-right text-muted-foreground`) and the value on the right. Edit state swaps the value area for the control, focused on mount, with `onKeyDown` handling Enter (commit) and Escape (revert) and `onBlur` committing. One `useState` for the editing flag and one for the draft.

No `try/finally`, no ref reads during render (React Compiler runs at `panicThreshold: 'all_errors'`).

Copy keys for the empty-value placeholder go in `frontend/lib/copy/articles.ts`.

- [ ] **Step 4: Green, then gates**

`npx vitest run frontend/test/components/ArticleFieldRow.test.tsx`, then `npm run typecheck`, `npm run lint`, each with real exit codes.

Note `npx knip --production` will flag `ArticleFieldRow` as unused until Task 3 consumes it. Expected — do not add a fake consumer.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(articles): add the read/edit article field row"
```

---

## Task 3: Convert the sections to rows and strip the chrome

**Files:**
- Modify: the five section components from Task 1
- Modify: `frontend/lib/copy/articles.ts` (delete helper text that only restates a placeholder)
- Test: `frontend/test/components/ArticleFormChrome.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/components/ArticleFormChrome.test.tsx`:

1. **No nested card headings.** Render the panel form and assert the duplicated inner headings ("Article details" and its siblings) are absent, while the section headings remain. This is what stops the chrome creeping back.
2. **Single column.** Assert no rendered element inside the form carries a `grid-cols-2` / `grid-cols-3` class — read `className` strings, since jsdom resolves no CSS.
3. **Section order.** Query all `[id^="article-section-"]` and assert their ids appear in DOM order: basic, publication, identifiers, additional, files.

- [ ] **Step 2: Run and watch them fail**

Expected: (1) and (2) fail today — the cards and `xl:grid-cols-2` at `ArticleForm.tsx:825` are present; (3) may pass already, since the wrapper changes visual order but not DOM order. Say which failed in the report.

- [ ] **Step 3: Convert, section by section**

Per section: replace each labelled input with an `ArticleFieldRow`; delete the nested card wrapper and its heading/description; delete helper text that restates the placeholder; remove `xl:grid-cols-2` (the Publication/Identifiers wrapper) and every inner `sm:grid-cols-*`.

Keep helper text that carries real information (format constraints, consequences). Keep the required-title validation and its error surface.

Run `npm run test:run` after each section, not once at the end.

- [ ] **Step 4: Delete the orphaned copy keys**

Any copy key whose only reference you removed must be deleted from `frontend/lib/copy/articles.ts`, or the ratchet fails. Run `python3 scripts/fitness/check_copy_keys.py`, then `echo $?`. Deleting a key that is still referenced ships a blank string, so run `npm run test:run` too — some tests assert a key's presence at runtime.

- [ ] **Step 5: Prove the dirty contract survived**

The editing model changed, so re-verify the guard: `npx vitest run frontend/test/components/ArticleForm.dirty.test.tsx frontend/test/components/ArticleSidePanel.identity.test.tsx frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx`. Add a test that a row commit marks the form dirty and an Esc does not.

- [ ] **Step 6: Full gates and commit**

All gates, real exit codes, then:
```bash
git commit -m "feat(articles): render article fields as zotero-style rows"
```

---

## Task 4: Panel chrome

**Files:**
- Modify: `frontend/components/articles/ArticleFormSteps.tsx` or `ArticleFormHeader.tsx` (Save/Cancel into the rail row)
- Modify: `frontend/components/layout/PanelToggleButton.tsx` or its caller (stacked glyph)
- Modify: `frontend/components/navigation/Topbar.tsx` and `ArticlesList.tsx` (toggle into the header)

Three user-reported items, each independently committable:

- [ ] **Step 1: Save/Cancel join the icon row below `lg`**

A WIP test already exists at `.superpowers/sdd/2026-09-09-articles-panel-density/fix3-wip-test.patch` — apply it as the starting point (`git apply`), confirm it is RED, then implement. Below `lg` the actions sit on the same row as the horizontal icon rail, right-aligned; at `lg`+ the current arrangement stays.

- [ ] **Step 2: The toggle glyph reflects the split direction**

In the stacked layout the panel opens from the bottom, so `PanelRightOpen`/`PanelRightClose` read wrong. Use a bottom-opening glyph when `useIsBelowDesktop()` is true. `PanelToggleButton` currently takes `side: 'left' | 'right'` — extend it to accept `'bottom'` rather than special-casing at the call site. Keep the `aria-label` accurate for whichever direction is showing.

- [ ] **Step 3: Move the toggle into the global header**

The control belongs to the right of the notification icon in `Topbar`. `Topbar` is global and must not learn about articles, so give it a slot the Articles page fills (a context or a portal target), and remove the toggle from the Articles toolbar. Update `ArticlesList.toolbar.test.tsx`, which currently asserts the toolbar toggle.

State the mechanism you chose and why in the report — this is the one judgment call in this task.

- [ ] **Step 4: Gates and commits (one per step)**

---

## Task 5: Verification and design review

- [ ] **Step 1** `npm run test:run`, `npm run typecheck`, `npm run lint` — real exit codes.
- [ ] **Step 2** `npx knip` and `npx knip --production` — both zero. `ArticleFieldRow` must now be reachable from production.
- [ ] **Step 3** `python3 scripts/fitness/check_file_size.py`, `check_button_scale.py`, `check_copy_keys.py` — all pass, **no baseline bumped upward**.
- [ ] **Step 4** `npx playwright test frontend/e2e/flows/articles-side-panel.ui.e2e.ts --workers 1` → 1 passed. Servers on :8000 and :8080 are already running; do not restart them.
- [ ] **Step 5** Design review in a real browser at **1600px and 900px**, in both read and edit state. Screenshot both. Compare against the Zotero reference: flat rows, no cards, one column, values reading as text until clicked. Record the measured rail width and fields width as the previous plan did.
- [ ] **Step 6** Commit any fixes the review produced.

## Self-Review Notes

**Spec coverage:** §3.1 → Task 2; §3.2 → Task 3; §3.3 → Task 3 step 1(3); §3.4 → Task 4; §3.5 → Task 1; §6 (page-variant deletion) → Task 1b; §5 → Tasks 2, 3, 5.

**Ordering is load-bearing.** Task 1 must land first — every other task adds lines to a file that is currently at its cap. Task 1b should follow immediately: deleting the unreachable page variant shrinks `ArticleForm` further and removes the `variant` prop before Tasks 2-3 start editing the same render tree, so they never have two branches to keep in sync.

**Risk:** Task 3 is the largest diff and the one that can silently break the dirty guard, which is why step 5 re-runs the identity and guard suites specifically rather than trusting the aggregate.
