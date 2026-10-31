---
status: draft
last_reviewed: 2026-10-30
owner: '@raphaelfh'
---

# Screening workspace S0 — shell extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a generic `ListDetailSplitShell` (resizable list/panel split, `⌘⇧B` toggle, below-`lg` vertical orientation, Topbar toggle, opt-in maximize on `⇧⌘\` and opt-in Esc chain) and move the Articles tab onto it with no visible change.

**Architecture:** `ListDetailSplitShell` owns layout, the Topbar toggle, the shortcuts (chords through `useKeyboardShortcuts`; the Esc chain as its own capture-phase window listener, the `RunSplitShell.tsx:78-88` precedent) and the local `maximized` flag; the panel's open state is controlled by the caller (`panelOpen` / `onPanelOpenChange`) so Articles keeps its dirty-discard guard and its false→true selection edge. `ArticlesSplitShell` stays the caller and keeps everything article-specific (discard dialog, `ArticleSidePanel`, placeholder, copy keys, `articles-shell` ids); its layout and shortcut code is deleted. Articles passes neither `maximizable` nor `escapeCloses`.

**Tech Stack:** React 19 (React Compiler), TypeScript, `react-resizable-panels` v4 via `@/components/ui/resizable`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S0 only: §4.1, the shell rows of §4.5 (Esc, `⇧⌘\`), §9 S0 row and the S0 acceptance row.

**Scope:** 3 tasks, one PR to `dev`, title `refactor(articles): extract ListDetailSplitShell from the Articles split`. Task 1 → Task 2 → Task 3, strictly sequential (Task 2 consumes Task 1's component; Task 3 verifies both). No backend, no migration, no copy keys, no `ProjectView.tsx` change (its `<ArticlesSplitShell>` props are unchanged).

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace` (branch `screening-workspace`). Every command runs from `$WT` with absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. Confirm with `git -C "$WT" status` that edits landed there.
- **Tooling runs from the repo root of the worktree** (`$WT/package.json`); there is no `frontend/package.json` — never `cd frontend && npm ...`. `node_modules` is already installed in `$WT`. If `npm`/`npx` is not on PATH: `mise exec node@24 -- <cmd>`.
- **English only** — code, comments, commit messages.
- **Post-edit hook** (`.claude/hooks/post-edit-format.sh`) runs `eslint --fix` after every Edit/Write and strips unused imports: add an import in the same edit as its first use.
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render (refs only inside effects/handlers), no `try/finally` in a component or hook body. To reset state when a prop changes, use the "store the previous value in state and adjust during render" pattern, not an effect that calls `setState`.
- **Keyboard:** chords (`⌘⇧B`, `⇧⌘\`) go through `useKeyboardShortcuts` (`frontend/hooks/useKeyboardShortcuts.ts`). The one exception is the shell's Escape chain, which is a **capture-phase window listener** (coordinator ruling 2026-10-30, precedent `RunSplitShell.tsx:78-88`) so it outranks every bubble-phase Escape (`useListKeyboardShortcuts.ts:53-64`, `useKeyboardShortcuts` bare chords); it yields while a popover/menu/dialog is open (`isDialogOpen()`) or focus is in a text field (`isTypingTarget`). Do not add keys to `useListKeyboardShortcuts`; S0 does not modify it.
- **No dead code** (CI-gated): `npm run deadcode` and `npm run deadcode:production` both report zero; the layout/shortcut code `ListDetailSplitShell` replaces is deleted from `ArticlesSplitShell.tsx` in the same task that moves Articles onto it.
- **No new copy keys** in S0: the Topbar toggle label is the caller's existing `t('articles', 'panelToggle')`. `python3 scripts/fitness/check_copy_keys.py` stays green.
- **File size:** `python3 scripts/fitness/check_file_size.py` exits 0 (800-line soft ceiling for new files).
- **DOM contract kept:** panel ids `articles-shell-list` / `articles-shell-panel` (react-resizable-panels v4 stamps `data-testid={id}`; `frontend/e2e/flows/articles-side-panel.ui.e2e.ts:31,43` reads `articles-shell-panel`).
- **Commands:** tests `npm run test:run -- <path>`; typecheck `npm run typecheck` (`tsc -p tsconfig.app.json --noEmit`); lint `npm run lint`; knip `npm run deadcode` and `npm run deadcode:production`.
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Esc typed in a text field inside the panel** (e.g. `ArticleFieldRow` revert, `ArticleFieldRow.tsx:241`): the shell must not close/restore anything — test in Task 1 (`ignores Escape in a text field`).
2. **Esc while a popover, menu or dialog is open**: the capture listener runs before Radix's document-capture dismiss, so it must yield (no step, no `preventDefault`, no `stopPropagation`) and let the overlay close — test in Task 1 (`yields Escape to an open overlay`).
3. **List state while maximized**: the list stays mounted (`display: none`), so its filters/scroll/checked rows survive a restore — test in Task 1 (`keeps list state across maximize and restore`). **Panel closed by the caller while maximized, then reopened**: it reopens docked, never maximized — test in Task 1 (`reopens docked after a close while maximized`).
4. **Esc with nothing to undo**: the event is neither `preventDefault`ed nor stopped, so bubble-phase Escape handlers elsewhere on the page still see it — test in Task 1 (`leaves an idle Escape untouched`).
5. **Articles really opted out**: `⇧⌘\` and Escape change nothing on the Articles split — test in Task 2 (`ignores maximize and Escape`).

---

### Task 1: `ListDetailSplitShell` with opt-in maximize and Esc chain

**Depends on:** nothing. **Files:**
- Create: `frontend/components/layout/ListDetailSplitShell.tsx`
- Modify: `frontend/hooks/useKeyboardShortcuts.ts` (export `isTypingTarget` at `:38`; optional `code` on `ChordBinding`)
- Test (modify): `frontend/hooks/useKeyboardShortcuts.test.ts`
- Test: `frontend/components/layout/ListDetailSplitShell.test.tsx`

**Interfaces:**
- Consumes (existing): `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `@/components/ui/resizable`; `useIsBelowDesktop` from `@/hooks/use-mobile`; `useKeyboardShortcuts`, `isDialogOpen` and `isTypingTarget` from `@/hooks/useKeyboardShortcuts` (this task adds `export` to the existing `function isTypingTarget(e: KeyboardEvent): boolean`, `useKeyboardShortcuts.ts:38`, and an optional `code?: string` to `ChordBinding`: when set, `runChord` matches `e.code === b.code` instead of `e.key`; no other change to that file); `PanelToggleButton` from `@/components/layout/PanelToggleButton`; `useSetHeaderActions` from `@/contexts/HeaderActionsContext`.
- Produces (Task 2 and S1 rely on these exact names):

```ts
export interface ListDetailSplitShellProps {
  list: ReactNode;
  panel: ReactNode;
  /** Controlled: the caller owns open state (Articles guards close behind a discard dialog). */
  panelOpen: boolean;
  /** Every open/close request: Topbar toggle, ⌘⇧B, Esc's panel step, ⇧⌘\ on a closed panel. */
  onPanelOpenChange: (open: boolean) => void;
  /** Panel ids `${idPrefix}-list` and `${idPrefix}-panel` (also their data-testid). */
  idPrefix: string;
  /** Accessible name + tooltip of the Topbar PanelToggleButton. */
  toggleLabel: string;
  /** ⇧⌘\ maximizes the panel (list stays mounted, hidden). Default false. */
  maximizable?: boolean;
  /** Escape undoes one step per press: maximize → panel → URL selection → checked rows. Default false. */
  escapeCloses?: boolean;
  /** Esc's selection step (the URL param); read only when escapeCloses. */
  hasSelection?: boolean;
  onClearSelection?: () => void;
  /** Esc's last step. A consumer passing these passes no `deselectAll` to useListKeyboardShortcuts. */
  checkedCount?: number;
  onClearChecked?: () => void;
}
export function ListDetailSplitShell(props: ListDetailSplitShellProps): JSX.Element;
```

Behaviour the implementation must keep from today's `ArticlesSplitShell.tsx:148-170, 221-249` (copy, do not reinvent):
- Group: `orientation={belowDesktop ? 'vertical' : 'horizontal'}`, `className="h-full"`.
- List panel: `id={`${idPrefix}-list`}`, `defaultSize={panelOpen ? '55%' : '100%'}`, `minSize="35%"`, child wrapper `<div className="flex h-full min-h-0 flex-col p-2">{list}</div>` (keep the existing "full-bleed tab owns a minimal inset" comment).
- Panel (only while `panelOpen`): `<ResizableHandle withHandle/>` then `id={`${idPrefix}-panel`}`, `defaultSize="45%"`, `minSize="30%"`, `maxSize="65%"`.
- Topbar: `useSetHeaderActions(<PanelToggleButton side={belowDesktop ? 'bottom' : 'right'} pressed={panelOpen} onToggle={toggle} ariaLabel={toggleLabel} shortcut={['mod', '⇧', 'B']} />)`, where `toggle = () => onPanelOpenChange(!panelOpen)`.
- One `useKeyboardShortcuts({bindings, enabled: true})` call. `bindings` always holds `{type: 'chord', key: 'b', mod: true, shift: true, handler: toggle}`; the `⇧⌘\` chord is added when `maximizable` (below). Escape is NOT a binding (below). Keep the `⌘B is the app sidebar, so this panel takes Shift` comment.

Maximize (only when `maximizable`; chord and `data-` attribute after `RunSplitShell.tsx:59-64, 143-156`, but the list is **kept mounted**, unlike RunSplitShell, so list state survives — coordinator ruling):
- Local `const [maximized, setMaximized] = useState(false)`; effective `isMaximized = maximizable && panelOpen && maximized`.
- Binding `{type: 'chord', key: '\\', code: 'Backslash', mod: true, shift: true, handler}` — matched on `e.code` because Shift+\\ reports `e.key === '|'` on real keyboards (RunSplitShell has the same bug; do not touch it, S3b fixes it): panel closed → `setMaximized(true)` + `onPanelOpenChange(true)`; open → `setMaximized(m => !m)`.
- Key the three children (`key="list"`, `key="handle"`, `key="panel"`). While `isMaximized` **nothing leaves the tree** (no remount of the list or the panel body): the list `ResizablePanel` gets `minSize="0%"` and is hidden with `display: none` only (no `aria-hidden`, no `inert`); the handle is hidden the same way; the panel `ResizablePanel` gets `minSize="100%" maxSize="100%"` and `data-maximized="true"` (attribute absent otherwise). v4 panels carry inline styles that may beat the `hidden` attribute: if `hidden` does not yield `display: none` (the `not.toBeVisible()` assertions catch it), use the Tailwind important class `hidden!`. jsdom cannot check that the panel actually fills the width; S1's `design-review` of the maximized screening panel does.
- `panelOpen` going false (by any path, including the caller's own discard confirm) clears `maximized`: reset with a guarded set during render, `if (!panelOpen && maximized) setMaximized(false)` (no effect, no previous-value state; React Compiler safe).

Esc chain (only when `escapeCloses`): a `useEffect` that registers `window.addEventListener('keydown', onKeyDownCapture, {capture: true})` and removes it on cleanup (copy the shape of `RunSplitShell.tsx:77-88`; read the latest state through the effect's deps, not refs). The listener:
1. returns untouched unless `event.key === 'Escape'`, or when `event.defaultPrevented || isDialogOpen() || isTypingTarget(event)` (an open popover/menu/dialog takes this press: Radix dismisses in its later document-capture listener);
2. picks the first step that applies: `isMaximized` → `setMaximized(false)`; else `panelOpen` → `onPanelOpenChange(false)`; else `hasSelection && onClearSelection` → `onClearSelection()`; else `(checkedCount ?? 0) > 0 && onClearChecked` → `onClearChecked()`;
3. if a step ran: `event.preventDefault()` and `event.stopPropagation()` (no bubble-phase Escape handler may do a second step on the same press); if none applies, returns untouched.
Comment above the effect: the full order (popover/menu → maximize → panel → URL selection → checked rows), why capture (outranks every bubble-phase Escape, incl. `useListKeyboardShortcuts`), why it yields to overlays and text fields.

- [ ] **Step 1: Write the failing tests** in `frontend/components/layout/ListDetailSplitShell.test.tsx`

Harness: render inside `HeaderActionsProvider` with a `HeaderActionsOutlet` (`<>{useHeaderActions()}</>`), as `frontend/test/components/ArticlesSplitShell.test.tsx:58-92` does. A `Harness` component holds `const [open, setOpen] = useState(initialOpen)` and passes `panelOpen={open}`, `onPanelOpenChange={(o) => {spy(o); setOpen(o);}}`, `idPrefix="t-shell"`, `toggleLabel="Toggle panel"`, `list={<input aria-label="search"/>}`, `panel={<div data-testid="panel-body"><input aria-label="field"/></div>}`, plus props under test. Set `window.matchMedia` per test (`setDesktop` = `matches: true`, `setNarrow` = `matches: false`, copy `setMatches` from that file). Fire chords platform-agnostically: `fireEvent.keyDown(window, {key: '\\', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true})`, `{key: 'B', ctrlKey: true, metaKey: true, shiftKey: true}`, `{key: 'Escape'}`. `const list = () => document.querySelector('[data-testid="t-shell-list"]')`, `const panelEl = () => document.querySelector('[data-testid="t-shell-panel"]')`.

Layout (dock/stack, vertical vs horizontal group, toggle icon, Topbar toggle, ⌘⇧B) is NOT re-asserted here: `ArticlesSplitShell.test.tsx:146,153,170,234` keeps those assertions and runs through the shell after Task 2. Shell tests cover only what is new: maximize, the Esc chain, the chord and the mounted list.

```ts
describe('ListDetailSplitShell maximize', () => {
  it('maximizes on ⇧⌘\\ and restores on the second press')
  //   maximizable, open: chord → list() still in the DOM but not.toBeVisible(), panelEl() has data-maximized="true",
  //   panel-body same node (identity captured before); chord → list() toBeVisible(), no data-maximized
  it('keeps list state across maximize and restore')
  //   list = a Counter child (useState, button "count N"); click to 2 → maximize → restore → button reads "count 2"
  it('matches the chord by code, as real keyboards send it')
  //   fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true}) → data-maximized present
  it('opens and maximizes a closed panel on ⇧⌘\\')             // spy(true); list() not.toBeVisible() after
  it('ignores ⇧⌘\\ when not maximizable')                      // list() toBeVisible(), no data-maximized
  it('reopens docked after a close while maximized')
  //   maximize → ⌘⇧B (spy(false)) → ⌘⇧B (spy(true)) → list() toBeVisible(), no data-maximized
  it('maximizes below lg too, hiding the stacked list')        // setNarrow; chord → list() not.toBeVisible()
});

describe('ListDetailSplitShell Escape chain', () => {
  // props: maximizable, escapeCloses, hasSelection, onClearSelection = vi.fn(), checkedCount, onClearChecked = vi.fn();
  // the harness makes hasSelection and checkedCount controllable (clear callbacks set them to false / 0)
  it('undoes one step per press: maximize, panel, selection, checked rows')
  //   open + maximized + hasSelection + checkedCount 2:
  //   Esc1 → list() toBeVisible() again, spy not called with false, neither clear called
  //   Esc2 → spy(false), panelEl() null, neither clear called
  //   Esc3 → onClearSelection once, onClearChecked not called
  //   Esc4 → onClearChecked once
  it('handles Escape in the capture phase, ahead of bubble-phase handlers')
  //   before render: const bubble = vi.fn(); window.addEventListener('keydown', bubble) (stands in for useListKeyboardShortcuts);
  //   open panel, Esc → spy(false) AND bubble not called (stopPropagation in capture);
  //   with nothing left to undo, Esc → bubble called once. Remove the listener after.
  it('leaves an idle Escape untouched')
  //   closed, no selection, checkedCount 0: const ev = createEvent.keyDown(window, {key: 'Escape'}); fireEvent(window, ev);
  //   expect(ev.defaultPrevented).toBe(false)
  it('honours an Escape something else already handled')
  //   open: const ev = createEvent.keyDown(window, {key: 'Escape'}); ev.preventDefault(); fireEvent(window, ev)
  //   → spy not called, panelEl() not null (a pre-handled press is never a second step)
  it('ignores Escape in a text field')                        // fireEvent.keyDown(getByLabelText('field'), {key:'Escape'}) → panel open, spy not called
  it('yields Escape to an open overlay')
  //   render a sibling <div role="menu"/> (also once with role="dialog"); Esc → panel open, spy not called, event not defaultPrevented
  it('does nothing on Escape when escapeCloses is off')        // open + maximizable only: chord to maximize, Esc → still maximized
});
```

Write each `it` with the assertions in its comment; the names above are the test names.

Also add to `frontend/hooks/useKeyboardShortcuts.test.ts`: `it('matches a chord by code when the binding names one')` — binding `{type: 'chord', key: '\\', code: 'Backslash', mod: true, shift: true, handler}`; `{key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true}` calls handler once; `{key: '\\', code: 'IntlBackslash', ...same mods}` does not.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- frontend/components/layout/ListDetailSplitShell.test.tsx frontend/hooks/useKeyboardShortcuts.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/layout/ListDetailSplitShell"`; the hook's code-match case fails (handler not called).

- [ ] **Step 3: Implement `ListDetailSplitShell` in `frontend/components/layout/ListDetailSplitShell.tsx`**

Per the Interfaces block and the behaviour lists above. File docstring: what the shell owns (layout, Topbar toggle, shortcuts, maximized flag), what the caller owns (open state, selection, panel content, guards), and why it is not `RunSplitShell` (its `assessment-shell*` ids are the run screens' DOM contract and it carries an in-shell PDF toggle). Target ≤ 180 lines.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- frontend/components/layout/ListDetailSplitShell.test.tsx`
Expected: PASS, 18 tests.

Run: `npm run test:run -- frontend/hooks && npm run typecheck && npx eslint frontend/components/layout/ListDetailSplitShell.tsx frontend/components/layout/ListDetailSplitShell.test.tsx frontend/hooks/useKeyboardShortcuts.ts`
Expected: exit 0, no output from eslint.

(`npm run deadcode:production` reports `ListDetailSplitShell.tsx` as an unused file until Task 2 wires it in; that is expected here and gated in Task 3.)

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add frontend/components/layout/ListDetailSplitShell.tsx frontend/components/layout/ListDetailSplitShell.test.tsx frontend/hooks/useKeyboardShortcuts.ts frontend/hooks/useKeyboardShortcuts.test.ts
git -C "$WT" commit -m "feat(layout): add ListDetailSplitShell with opt-in maximize and Esc chain" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Move Articles onto `ListDetailSplitShell`, delete the replaced code

**Depends on:** Task 1. **Files:**
- Modify: `frontend/components/articles/ArticlesSplitShell.tsx` (lines 21-46 imports, 86, 148-170, 221-249 replaced)
- Test (modify): `frontend/test/components/ArticlesSplitShell.test.tsx`
- Test (unchanged, must stay green): `frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx`, `frontend/test/pages/ProjectView.articleEditor.test.tsx`
- Not touched: `frontend/components/articles/ArticlesList.tsx` keeps passing `deselectAll` to `useListKeyboardShortcuts` (Articles has no Esc chain in S0)
- Scratch (never committed): `frontend/test/components/__articles_dom_dump.test.tsx`, output in the session scratchpad

**Interfaces:**
- Consumes from Task 1: `ListDetailSplitShell` and `ListDetailSplitShellProps` exactly as below:
  `{list, panel, panelOpen, onPanelOpenChange, idPrefix, toggleLabel, maximizable?, escapeCloses?, hasSelection?, onClearSelection?, checkedCount?, onClearChecked?}`.
- Produces: nothing new. `ArticlesSplitShell`'s exported names and props (`ArticlesSplitShellProps`, `ArticlesSplitShellListApi`) are unchanged, so `frontend/pages/ProjectView.tsx:214-243` is untouched.

- [ ] **Step 1: Capture the DOM baseline (before any edit)**

Create the scratch test `frontend/test/components/__articles_dom_dump.test.tsx`: reuse the mocks and `renderShell` helper of `ArticlesSplitShell.test.tsx` (mock `ArticleSidePanel` and `@/lib/copy` the same way) and, for four states — desktop closed, desktop `mode='edit' articleId='a1'`, desktop after clicking the toggle open with no selection (placeholder), narrow `mode='edit'` — append `document.body.innerHTML` to a string; finally `writeFileSync(process.env.DOM_DUMP!, out)`.

Run: `DOM_DUMP=<scratchpad>/articles-dom-before.html npm run test:run -- frontend/test/components/__articles_dom_dump.test.tsx`
Expected: PASS, file written (non-empty).

- [ ] **Step 2: Write the failing opt-out test** in `frontend/test/components/ArticlesSplitShell.test.tsx`, inside the top-level `describe`:

```ts
it('ignores maximize and Escape (Articles opts out of both)', () => {
  renderShell({mode: 'edit', articleId: 'a1'});
  fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
  expect(document.querySelector('[data-testid="articles-shell-list"]')).not.toBeNull();
  expect(document.querySelector('[data-maximized]')).toBeNull();
  fireEvent.keyDown(window, {key: 'Escape'});
  expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
  expect(getToggle()).toHaveAttribute('aria-pressed', 'true');
});
```

Run: `npm run test:run -- frontend/test/components/ArticlesSplitShell.test.tsx`
Expected: PASS already (today's shell binds neither key). This test is a regression pin, not a red step; the red/green proof for this task is Step 4's full suite plus Step 5's DOM diff. Record that in the task report.

- [ ] **Step 3: Rewrite `ArticlesSplitShell` as a caller of `ListDetailSplitShell`**

Keep unchanged: `panelOpen`/`dirty`/`pendingAction` state, the `prevHasSelectionRef` effect, `selectArticle`, `handleArticleClick`, `collapsePanel`, `requestCollapse`, `listApi`, `panelBody`, `discardDialog`, and their comments. Replace the rest with:

```tsx
<>
  <ListDetailSplitShell
    list={list(listApi)}
    panel={panelBody}
    panelOpen={panelOpen}
    onPanelOpenChange={(open) => (open ? setPanelOpen(true) : requestCollapse())}
    idPrefix="articles-shell"
    toggleLabel={t('articles', 'panelToggle')}
  />
  {discardDialog}
</>
```

Delete in the same edit: `togglePanel`, the `useKeyboardShortcuts` call and its comment, `useSetHeaderActions(...)` and its comment, `belowDesktop`, the `ResizablePanelGroup` JSX and its below-lg comment, and the now-unused imports (`ResizableHandle`, `ResizablePanel`, `ResizablePanelGroup`, `useIsBelowDesktop`, `useKeyboardShortcuts`, `PanelToggleButton`, `useSetHeaderActions`). Do **not** pass `maximizable` or `escapeCloses` (spec §4.1: Articles opts out in S0). Rewrite the file docstring's first paragraph: layout, Topbar toggle and shortcuts now live in `ListDetailSplitShell`; this file owns the article panel, its dirty-discard guard and the selection edge. Keep the `panelOpen` ref-edge paragraph.

The old `enabled: pendingAction === null` gate on ⌘⇧B is dropped: `useKeyboardShortcuts`' dialog guard matches the open `role="alertdialog"`. `ArticlesSplitShell.dirtyGuard.test.tsx` › `ignores the panel shortcut while the discard dialog is asking` proves it. If that test fails, stop and report — do not add a `shortcutsEnabled` prop without the controller's ruling.

- [ ] **Step 4: Run the Articles suites**

Run: `npm run test:run -- frontend/test/components/ArticlesSplitShell.test.tsx frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx frontend/test/pages/ProjectView.articleEditor.test.tsx frontend/test/components/ArticleSidePanel.test.tsx frontend/components/layout/`
Expected: PASS, 0 failed (every pre-existing case unchanged and green — 14 in `ArticlesSplitShell.test.tsx`, 13 in the dirty-guard file — plus the new opt-out case).

- [ ] **Step 5: Diff the DOM against the baseline (the visual-regression check)**

Run: `DOM_DUMP=<scratchpad>/articles-dom-after.html npm run test:run -- frontend/test/components/__articles_dom_dump.test.tsx`
Then: `diff <(sed -E 's/«r[0-9a-z]+»//g; s/:r[0-9a-z]+://g' <scratchpad>/articles-dom-before.html) <(sed -E 's/«r[0-9a-z]+»//g; s/:r[0-9a-z]+://g' <scratchpad>/articles-dom-after.html)`
Expected: no output (identical markup, React `useId` values normalised). Paste the diff result (empty) into the PR body notes. Any other difference (class, attribute, size, element order) is a visible change: fix the shell or report it, never accept it.

Then delete the scratch test: `rm "$WT/frontend/test/components/__articles_dom_dump.test.tsx"` and confirm `git -C "$WT" status --short` lists only `ArticlesSplitShell.tsx` and `ArticlesSplitShell.test.tsx`.

- [ ] **Step 6: Typecheck, lint, knip**

Run: `npm run typecheck && npx eslint frontend/components/articles/ArticlesSplitShell.tsx frontend/test/components/ArticlesSplitShell.test.tsx && npm run deadcode && npm run deadcode:production`
Expected: exit 0; knip prints no unused files/exports/dependencies in either mode.

- [ ] **Step 7: Commit**

```bash
git -C "$WT" add frontend/components/articles/ArticlesSplitShell.tsx frontend/test/components/ArticlesSplitShell.test.tsx
git -C "$WT" commit -m "refactor(articles): move the Articles split onto ListDetailSplitShell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Slice verification

**Depends on:** Tasks 1 and 2. **Files:** none modified (fixes found here go back to the owning task's files and get their own commit).

- [ ] **Step 1: Frontend tests for the touched dirs**

Run the full suite: `npm run test:run`
Expected: PASS, 0 failed. Full, not scoped: `runChord` changed (optional `code`), and its consumers span screening, extraction/review, runs and pdf-viewer.

- [ ] **Step 2: Static gates**

Run each; expected exit 0 for all:
- `npm run typecheck`
- `npm run lint`
- `npm run deadcode` — zero findings
- `npm run deadcode:production` — zero findings
- `python3 scripts/fitness/check_file_size.py`
- `python3 scripts/fitness/check_copy_keys.py`
- `python3 scripts/fitness/check_ui_primitives.py`

- [ ] **Step 3: Visual-regression check (no `/design-review`: S0 has no visible change)**

Evidence is Task 2 Step 5's empty DOM diff over four states (closed, open with article, open placeholder, below-`lg` stacked); restate it in the PR body. If the local stack is up (`make start`; coordinate first, it is shared), also run `npx playwright test frontend/e2e/flows/articles-side-panel.ui.e2e.ts --project=local-ui` — expected PASS; otherwise state in the PR that it was not run and CI's Frontend E2E covers it.

- [ ] **Step 4: Branch state**

Run: `git -C "$WT" status --short && git -C "$WT" log --oneline dev..HEAD`
Expected: clean tree; the two commits of Tasks 1–2 on top of the spec/plan commits.
