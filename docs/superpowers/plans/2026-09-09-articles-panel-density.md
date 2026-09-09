# Articles Panel Density & Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the article side panel's fields room to breathe — collapse the section rail to icons inside the panel, and flip the split to vertical instead of falling back to an overlay sheet.

**Architecture:** Two independent changes. `ArticleFormSteps` gains a `compact` prop so its already-existing icon-only mode is driven by the container's needs rather than the viewport. `ArticlesSplitShell` drops its overlay-`Sheet` branch and instead passes `orientation="vertical"` to the same `ResizablePanelGroup` below 1024px.

**Tech Stack:** TypeScript strict, React 19, `react-resizable-panels` v4, Tailwind, vitest + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-08-articles-side-panel-design.md`](../specs/2026-09-08-articles-side-panel-design.md) — see **Amendment A (2026-09-09)**.

## Global Constraints

- **English only** for code, comments, commits, docs, and copy keys.
- **All user-facing strings** in `frontend/lib/copy/articles.ts`, referenced via `t('articles', key)` — the copy-key ratchet fails on an unreferenced member.
- **Frontend tooling runs from the repo root.** Never `cd frontend`.
- **Use `npm run typecheck`**, never `npx tsc --noEmit` — the root tsconfig is solution-style (`files: []` + references) and checks nothing, exiting 0 regardless. This is a documented trap (`scripts/verify_all.sh:197`).
- **Never read an exit code through a pipe.** `cmd | tail` returns tail's status. Run the command, then `echo $?` on the next line.
- **`npx knip` and `npx knip --production`** must both stay at zero findings.
- **Both fitness ratchets are shrink-only.** `check_file_size.py` and `check_button_scale.py` must pass WITHOUT `--update-baseline`. Current headroom is thin: `ArticleForm.tsx` 1210 / cap 1213, `ArticlesList.tsx` 1306 / cap 1335. Adding more than 3 lines to `ArticleForm.tsx` breaks the gate — extract instead.
- **The local Supabase stack is SHARED** by every session on this machine. Never `make reset-db`, `make db-fresh`, `supabase db reset`, or `supabase stop`.
- **Do not modify** `RunSplitShell.tsx`, `RunPdfContent.tsx`, or anything under `frontend/pdf-viewer/`.
- Conventional commits.

### Environment facts (verified)

1. `frontend/test/setup.ts` stubs `window.matchMedia` to `matches: false` for every query. A test of the side-by-side layout MUST override it, or it silently exercises the stacked path. `ArticlesSplitShell.test.tsx` already has `setDesktop()` / `setNarrow()` helpers — reuse them.
2. Backend (127.0.0.1:8000) and Vite (127.0.0.1:8080) are running. Do not restart them.
3. `ArticleFormSteps` ALREADY has a `LucideIcon` per step and ALREADY folds labels to `sr-only` + tooltip below `lg`. This task re-keys that from a viewport breakpoint to a prop. Do not write a new rail.

---

## Task 1: Compact section rail inside the panel

**Files:**
- Modify: `frontend/components/articles/ArticleFormSteps.tsx`
- Modify: `frontend/components/articles/ArticleForm.tsx` (the `<ArticleFormSteps …/>` call site only — at most 1 added line, see the size-ratchet constraint)
- Test: `frontend/test/components/ArticleFormNarrowViewport.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `ArticleFormStepsProps.compact?: boolean`. When true the rail is an icon-only vertical column at every viewport width.

- [ ] **Step 1: Write the failing test**

Append to `frontend/test/components/ArticleFormNarrowViewport.test.tsx`. `renderAdd()` in that file already renders `variant="panel"`:

```tsx
describe('article editor — compact section rail in the panel', () => {
    it('keeps every step label sr-only in the panel, whatever the viewport', async () => {
        renderAdd(); // panel variant

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        // Precondition: the rail actually rendered all five steps.
        const buttons = within(rail).getAllByRole('button');
        expect(buttons).toHaveLength(5);

        for (const button of buttons) {
            const label = button.querySelector('[data-slot="step-label"]');
            // sr-only, never `hidden` — `hidden` would strip the accessible name.
            expect(label!.className).toContain('sr-only');
            expect(label!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
            // The lg: escape hatch must NOT be present in compact mode: inside
            // the panel the viewport is wide while the container is not, so a
            // viewport-keyed un-fold is exactly the bug being fixed.
            expect(label!.className).not.toContain('lg:not-sr-only');
        }
    });

    it('still un-folds the labels at lg in the page variant', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        const rail = await screen.findByRole('navigation', {name: 'formStepsAria'});
        const label = within(rail).getAllByRole('button')[0].querySelector('[data-slot="step-label"]');
        expect(label!.className).toContain('lg:not-sr-only');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticleFormNarrowViewport.test.tsx`

Expected: the first test FAILS (`lg:not-sr-only` is present in the panel today — that is the bug); the second PASSES.

- [ ] **Step 3: Add the prop**

In `ArticleFormSteps.tsx`, add to `ArticleFormStepsProps`:

```tsx
    /**
     * Icon-only rail, regardless of viewport width. The panel host is narrow
     * while the VIEWPORT is wide, so the `lg:` fold below cannot see the
     * constraint that matters; the container's owner passes this instead.
     */
    compact?: boolean;
```

Destructure `compact = false`.

- [ ] **Step 4: Make the three viewport-keyed spots respect it**

`aside` className — in compact mode it is always a narrow column, never a horizontal strip:

```tsx
            className={cn(
                'shrink-0 bg-[#fafafa] dark:bg-[#0c0c0c]',
                compact
                    ? 'w-auto border-r border-border/40 overflow-y-auto'
                    : 'w-full border-b border-border/40 lg:w-56 lg:border-b-0 lg:border-r overflow-x-auto lg:overflow-y-auto',
            )}
```

`nav` className:

```tsx
                className={cn(
                    'flex gap-0.5',
                    compact ? 'flex-col px-1.5 py-3' : 'flex-row px-2 py-3 lg:flex-col lg:px-2 lg:py-4',
                )}
```

button className — drop the `lg:w-full lg:shrink` growth in compact mode:

```tsx
                                        compact ? 'w-auto' : 'lg:w-full lg:shrink',
```

label span:

```tsx
                                    <span
                                        data-slot="step-label"
                                        className={cn(
                                            'sr-only whitespace-nowrap',
                                            !compact && 'lg:not-sr-only lg:whitespace-normal',
                                        )}
                                    >
```

tooltip — in compact mode the label is always folded, so the tooltip must always be available:

```tsx
                            <TooltipContent side={compact ? 'right' : 'bottom'} className={cn(!compact && 'lg:hidden')}>
```

Keep the existing explanatory comment about `sr-only` vs `hidden`, and extend it to say the fold is now unconditional in compact mode.

- [ ] **Step 5: Pass it from the panel variant**

In `ArticleForm.tsx`, at the existing `<ArticleFormSteps …/>` call, add ONE line:

```tsx
                    compact={isPanel}
```

Do not add anything else to this file — it is 3 lines under its size cap.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run frontend/test/components/ArticleFormNarrowViewport.test.tsx frontend/test/components/ArticleForm.characterization.test.tsx frontend/test/components/ArticleForm.dirty.test.tsx frontend/test/components/ArticleForm.stagedFiles.test.tsx`

Expected: all PASS.

- [ ] **Step 7: Check the size ratchet before committing**

Run: `python3 scripts/fitness/check_file_size.py` then `echo $?`

Expected: exit 0. If `ArticleForm.tsx` went over 1213, you added more than the one line — remove the excess.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/articles/ArticleFormSteps.tsx frontend/components/articles/ArticleForm.tsx frontend/test/components/ArticleFormNarrowViewport.test.tsx
git commit -m "feat(articles): collapse the section rail to icons inside the panel"
```

---

## Task 2: Vertical split replaces the overlay sheet

**Files:**
- Modify: `frontend/components/articles/ArticlesSplitShell.tsx`
- Test: `frontend/test/components/ArticlesSplitShell.test.tsx`

**Interfaces:**
- Consumes: `useIsBelowDesktop` (unchanged).
- Produces: no public API change. Below 1024px the shell renders the SAME panel group with `orientation="vertical"` instead of a `Sheet`.

- [ ] **Step 1: Rewrite the narrow-viewport test**

In `frontend/test/components/ArticlesSplitShell.test.tsx`, replace the existing `falls back to the overlay sheet below lg` test with:

```tsx
    it('stacks the panel under the table below lg instead of overlaying it', () => {
        setNarrow();
        renderShell({mode: 'edit', articleId: 'a1'});

        // Same docked panel, no overlay: the table must remain in the tree.
        expect(screen.getByTestId('article-side-panel')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByTestId('panel-open')).toHaveTextContent('true');
    });

    it('uses a vertical panel group below lg and a horizontal one above', () => {
        setNarrow();
        const {unmount} = renderShellRaw({mode: 'edit', articleId: 'a1'});
        expect(document.querySelector('[data-panel-group-direction="vertical"]')).not.toBeNull();
        unmount();

        setDesktop();
        renderShellRaw({mode: 'edit', articleId: 'a1'});
        expect(document.querySelector('[data-panel-group-direction="horizontal"]')).not.toBeNull();
    });
```

`renderShell` currently returns only the mocked handlers; add a `renderShellRaw` that returns Testing Library's full result (including `unmount`), or adapt `renderShell` to return it — either is fine, but do not duplicate the JSX.

**If `data-panel-group-direction` is not the attribute `react-resizable-panels` v4 emits**, find the real one by rendering and inspecting the DOM once, then assert on that. Do NOT assert on a Tailwind class — jsdom resolves no CSS, so a class assertion proves nothing about layout.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.test.tsx`

Expected: the two new tests FAIL (a `dialog` is still rendered below lg).

- [ ] **Step 3: Delete the Sheet branch**

In `ArticlesSplitShell.tsx`, remove the entire `if (belowDesktop) { … <Sheet> … }` early return, and remove the now-unused `Sheet` / `SheetContent` imports.

- [ ] **Step 4: Make the single panel group orientation-aware**

```tsx
    <ResizablePanelGroup
      orientation={belowDesktop ? 'vertical' : 'horizontal'}
      className="h-full"
    >
      <ResizablePanel
        id="articles-shell-list"
        defaultSize={panelOpen ? '55%' : '100%'}
        minSize="35%"
      >
```

Keep the panel ids exactly as they are — they are the DOM contract for the E2E. The `ResizableHandle withHandle` needs no change; the primitive orients itself from the group.

Add a comment saying why vertical rather than an overlay: the table stays visible at every width, which is the point of docking the panel.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.test.tsx frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx`

Expected: all PASS. The dirty-guard file renders the shell too; if it fails, the dialog is no longer reachable in one of the branches — fix that, do not weaken the test.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/articles/ArticlesSplitShell.tsx frontend/test/components/ArticlesSplitShell.test.tsx
git commit -m "feat(articles): stack the article panel below lg instead of overlaying it"
```

---

## Task 3: Gates and visual verification

**Files:** none created; this task verifies.

- [ ] **Step 1: Full frontend suite**

Run: `npm run test:run` then `echo $?`

Expected: exit 0, 2557+ passing.

- [ ] **Step 2: Typecheck and lint**

Run `npm run typecheck` then `echo $?`, and `npm run lint` then `echo $?`. Both exit 0.

- [ ] **Step 3: Dead code**

Run `npx knip` and `npx knip --production`. Both ZERO findings. If `Sheet`/`SheetContent` became unused anywhere, remove the import — do not add an ignore.

- [ ] **Step 4: Fitness ratchets**

Run `python3 scripts/fitness/check_file_size.py`, `python3 scripts/fitness/check_button_scale.py`, and `python3 scripts/fitness/check_copy_keys.py`, capturing each exit code on its own line. All must pass WITHOUT `--update-baseline`.

- [ ] **Step 5: E2E**

Run: `npx playwright test frontend/e2e/flows/articles-side-panel.ui.e2e.ts --workers 1`

Expected: 1 passed. Servers are already up; do not restart them.

- [ ] **Step 6: Measure the win**

With the panel open on Details at a 1600px viewport, measure the fields column. Before this plan it was 370px against a 224px rail. Record the new numbers. Expected: rail ~40px, fields ~555px.

- [ ] **Step 7: Commit any fixes**

Only if steps 1-6 required code changes.

## Self-Review Notes

**Spec coverage:** Amendment A1 → Task 1; A2 → Task 2; the measurement claim → Task 3 step 6.

**Risk:** Task 1's `ArticleForm.tsx` has 3 lines of headroom under the size ratchet. The plan adds exactly one. Anything more must be extracted, not absorbed.
