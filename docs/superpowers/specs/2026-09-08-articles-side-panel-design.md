---
status: draft
last_reviewed: 2026-09-08
owner: '@raphaelfh'
---

> **Status:** Draft · Last reviewed: 2026-09-08 · Owner: @raphaelfh

# Articles Side Panel — Design Spec

**Date:** 2026-09-08
**Status:** Draft for review

## 1. Problem

The Articles tab lists articles in a table. Editing or adding an article opens
a right-side overlay `Sheet` that covers the table, and there is no way to read
an article's PDF from the Articles tab at all — the PDF viewer only exists
inside the extraction and quality-assessment run screens.

Two consequences:

- to check what a paper actually says while curating metadata, you leave the
  Articles tab and enter a run screen;
- with the editor open, the table is hidden, so you cannot see which article
  comes next.

## 2. Goal

A **docked, resizable right panel** in the Articles tab that shows, for the
selected article, **either** the document viewer (PDF or the markdown reader,
whichever the viewer is set to) **or** the article's edit fields — switched by a
segmented control inside the panel, with the table remaining visible beside it.

## 3. What already exists (verified 2026-09-08)

| Piece | Where | Note |
| --- | --- | --- |
| Right-side article editor | `frontend/pages/ProjectView.tsx` | overlay `Sheet`, URL-driven `?articleEditor=add\|edit&articleId=` |
| Panel-shaped article form | `ArticleForm` `variant="panel"` | built for that Sheet; own header + section nav |
| Docked split shell | `RunSplitShell` | `ResizablePanelGroup`, form left / PDF right, `usePdfPanel` |
| Article document pane | `RunPdfContent` | takes `articleId`; document switcher + parse status + `PrumoPdfViewer` |
| PDF ↔ markdown switch | `PrumoPdfViewer` `mode: 'pdf' \| 'reader'` | already in the viewer store |
| Panel toggle button | `components/layout/PanelToggleButton` | shared by Topbar and `RunHeader.PanelToggle` |
| Media-query hook | `hooks/use-mobile.tsx` | `useMediaQuery` via `useSyncExternalStore`; `useIsNarrow` at 640px |

The PDF/markdown requirement therefore needs **no viewer work** — only mounting
`RunPdfContent` with the selected article's id.

`ArticleForm` has **no dirty tracking** (plain `useState` over one `formData`
object plus `authorRows`/`stagedFiles`, no react-hook-form). The unsaved-edits
guard in §8 is new machinery.

## 4. Approach decision

Three options were considered for the shell:

- **A — reuse `RunSplitShell` directly.** Rejected: its `assessment-shell*`
  panel ids are the DOM test contract for the QA fullscreen and PDF-collapsed
  E2E specs, and its in-shell "Show PDF" fallback label is wrong for a panel
  that usually shows fields.
- **B — extract a generic `SplitWorkspaceShell` for both.** Rejected for now:
  it means editing the extraction/QA layout — the structural heart — for zero
  functional gain on that side, and the `viewerStore` wrap and legacy testids
  would have to survive the extraction exactly.
- **C — a new `ArticlesSplitShell` beside `RunSplitShell`, both on the same
  `ResizablePanelGroup` primitives.** **Chosen.** ~50 lines, own testids, zero
  risk to the run screens, free to differ where it should.

**Follow-up, recorded not hidden:** if a third split-workspace consumer
appears, do B and collapse both shells into it. The duplication accepted here
is layout scaffolding around shared primitives, not logic.

## 5. Layout

```text
ProjectView (tab=articles)
└── ArticlesSplitShell               ResizablePanelGroup, horizontal
    ├── ArticlesList                 id=articles-shell-list
    │                                defaultSize 100% → 55% when open, minSize 35%
    ├── ResizableHandle              only when the panel is open
    └── ArticleSidePanel             id=articles-shell-panel
                                     defaultSize 45%, minSize 30%, maxSize 65%
```

- **No `ViewerProvider` wrap.** The run shell needs one so the extraction
  form's evidence popover and the PDF share a store. Nothing in Articles
  reaches into the viewer store, so `RunPdfContent` creates its own.
- **The table under compression.** `ArticlesList`'s root is already
  `flex h-full min-h-0 flex-col` and drops in unchanged. Its column visibility
  uses **viewport** breakpoints (`hidden md:table-cell`, `lg:table-cell`) and
  its widths are user-resizable and persisted, so at 55% width on a wide screen
  every `lg` column stays mounted and the table scrolls horizontally. This is
  accepted: `minSize 35%` bounds it, and the default split is tuned during
  design review. Column widths, breakpoints and persistence are **not** changed.
- **Below `lg`** the shell renders the existing overlay `Sheet` instead of the
  docked panel — same content, same URL state. Driven by `useMediaQuery`
  (JS, mockable), never by CSS alone: jsdom sees no layout, so a CSS-only
  fallback would be untestable.
- **`ProjectView`:** the `articles` tab moves from the padded
  `max-w-[1800px]` centred container into the full-bleed branch. This changes
  the tab's framing even when the panel is closed.

## 6. Panel internals

```text
ArticleSidePanel
├── strip (h-8):  [ Details | Document ]  ······  [ collapse ▸ ]
└── articleView === 'details'  → <ArticleForm variant="panel" … />
    │                            ├── actions row: ······ [ Cancel ] [ Save ]
    │                            └── section nav + fields
    articleView === 'document' → <RunPdfContent articleId projectId />
                                 or <NoDocumentEmptyState /> when files.length === 0
```

- **`ArticleForm`'s header is retired in the panel.** Today it renders a back
  button, the add/edit title, the article's title as description, and
  Cancel/Save. In `variant="panel"` it keeps **only the actions** — a slim
  right-aligned Cancel/Save row — and drops the back button, title and
  description. The panel strip already says which article you are on and how
  to leave, so that row was restating it. `variant="page"` is unchanged; the
  header block becomes conditional on the variant, which is the smallest edit
  that removes the duplication without hoisting `saving`/validation state out
  of the form.
- **`RunPdfContent` is used as-is** — it brings the document switcher,
  parse-status control, and the PDF/reader toggle.
- **Two dismiss affordances, two meanings:** the strip's collapse control
  (`PanelToggleButton side="right"`) hides the panel and keeps the selected
  article; the form's Cancel clears the selection (§7). The form's back button
  is gone with the header, so Cancel is the only in-form exit.
- **Empty document state:** when the article has no files, Document mode shows
  a small empty state with an "Add file" button opening
  `ArticleFileUploadDialogNew` — the dialog `ArticlesList` already opens from
  its row menu. `Viewer.Root` accepts `source: null` and no-ops, so without
  this the pane would render blank. A file still parsing is already handled by
  `RunPdfContent`'s polling.
- **Add mode:** the Document segment renders disabled with a hint that it
  becomes available once the article is saved. It enables the moment the form
  creates the row. The panel learns the new id from a new
  `onArticleCreated?: (id: string) => void` prop rather than from the URL,
  because `ArticleForm` deliberately does not rewrite the URL on create —
  rewriting it would remount the tree and destroy the staged `File` objects
  (see the comment at `ArticleForm.tsx:207`).

## 7. URL contract & state

**The URL owns selection and view; local state owns whether the panel is open.**

| Param | Values | Status |
| --- | --- | --- |
| `articleEditor` | `add` \| `edit` | unchanged |
| `articleId` | uuid | unchanged, required when `edit` |
| `articleView` | `details` \| `document` | **new**, defaults to `details` |

- `articleView` is written with `{replace: true}` so toggling does not pile up
  history entries, and persists across article switches.
- `panelOpen` is local state in `ArticlesSplitShell`, default `false`. It
  starts `true` when the URL arrives with a valid selection (deep link or
  reload). Set by a row click and by "Add article"; toggled by the toolbar
  sidebar icon and by the strip's collapse control — those two are the same
  action from two places. A reload comes back expanded: the URL records what
  you were looking at, not whether the panel was tucked away.

Panel content depends on the selection, using exactly today's
`articleEditorSheetOpen` predicate (untouched, so the existing invalid-state
cleanup effects and the legacy-route redirect tests keep passing):

- valid selection → `ArticleSidePanel`;
- otherwise → a **"Select an article" placeholder** at the same width and
  chrome. No disabled toolbar button: an empty, self-explaining panel is
  better than a control that refuses to respond.

**Cancel** therefore clears the selection and returns to the placeholder with
the panel still open; **collapse** hides the panel entirely.

Additive edits to `ProjectView`:

1. the leave-the-tab cleanup effect and `closeArticleEditor` also delete
   `articleView`;
2. `openArticleEditorEdit` stays in `ProjectView` and keeps its current body.
   `ArticlesSplitShell` wraps it as the `onArticleClick` it passes down (it
   already wraps it for the dirty guard, §8), setting `panelOpen` before
   delegating — a row click while collapsed must reveal the panel.

## 8. Unsaved-edits guard

**Dirty detection.** `ArticleForm` snapshots a baseline right after load (edit)
or mount (add) and computes `isDirty` as a shallow compare of `formData`, plus
`authorRows` and `stagedFiles.length !== 0`. It reports upward through a new
`onDirtyChange?: (dirty: boolean) => void`. With `onArticleCreated` (§6) these
are the only two new props on the form — no imperative handle, no context.

**Interception.** `ArticlesSplitShell` holds `dirty` and wraps the row-click
handler: when dirty and the clicked article differs from the current one, it
stashes the pending id and opens an `AlertDialog` — *Discard changes? / Keep
editing*. Discard proceeds with the swap and clears dirty; Keep editing drops
the pending id.

**Not guarded, stated so it is not a surprise:**

- switching to Document mode and back does **not** unmount the form, so edits
  survive it — that is the point of the toggle;
- navigating away from the Articles tab, or browser back, bypasses the guard
  (no `beforeunload`, no router blocker). Widening the guard to every exit path
  is a larger behavioural change than this slice asks for.

## 9. Testing

Test-first, per task.

| File | Covers |
| --- | --- |
| `ArticlesSplitShell.test.tsx` | panel closed by default; row click opens it and sets the URL; toolbar icon collapses/expands without losing selection; placeholder when open with no selection; `matchMedia` stubbed below `lg` renders the Sheet, above `lg` the panel group |
| `ArticleSidePanel.test.tsx` | toggle swaps Details↔Document and persists across an article change; Document disabled in add mode, enabled after `onArticleCreated`; empty state when the article has no files |
| `ArticlesSplitShell.dirtyGuard.test.tsx` | dirty + click another row ⇒ dialog; Keep editing ⇒ no swap, URL unchanged; Discard ⇒ swap |
| `ArticleForm.dirty.test.tsx` | `onDirtyChange(false)` after load; `true` after a field edit; `true` on a staged file |

The dirty-guard tests **assert the precondition** (the form reported dirty)
before asserting the dialog — a guard test that passes because the form never
became dirty is a vacuous green.

**Existing tests:**

- `ArticlesList.toolbar.test.tsx` gains the new sidebar icon.
- `ArticleFormNarrowViewport.test.tsx` **must change**: it asserts the
  panel-variant header that §6 retires — the `addArticle` title, the
  `editArticle` header block and its `back` button. Its narrow-viewport
  intent survives as assertions on the step rail and the actions row; the
  header assertions are deleted, not adapted, because the header is gone in
  that variant. The `variant="page"` header keeps its coverage.
- `ArticleForm.characterization.test.tsx` and `ArticleForm.stagedFiles.test.tsx`
  assert the step rail and staged-file behaviour, not the header, so they
  should pass untouched. If they fail, the variant split leaked.
- `legacyArticleRoutes.test.tsx` must pass untouched; if it does not, the URL
  contract was broken.

**E2E:** `articles-side-panel.ui.e2e.ts`, following
`pdf-collapsed-default.ui.e2e.ts` — open a project, click a row, assert the
panel docks, switch to Document, assert the PDF canvas renders. The split
layout is only observable in Playwright.

**Gates:** new strings go in `frontend/lib/copy/articles.ts` and must be
referenced (copy-key fitness ratchet fails on unreferenced members); `npx knip`
in both modes (`ArticleSidePanel` must be reached from production code, not
only from its test); then `make quality-scan` and `design-review` on the
Articles route.

## 10. Non-goals

- No evidence/citation wiring between panel and viewer (no shared
  `viewerStore`).
- No changes to `ArticlesList` column widths, breakpoints, or persistence.
- No `RunSplitShell` generalisation (see §4 follow-up).
- No autosave.
- No guard on tab navigation or browser back.
- No local preview of staged files before the article is created.

## 11. Files

**New**

- `frontend/components/articles/ArticlesSplitShell.tsx`
- `frontend/components/articles/ArticleSidePanel.tsx`
- tests per §9

**Modified**

- `frontend/pages/ProjectView.tsx` — full-bleed articles tab, mount the shell,
  `articleView` cleanup
- `frontend/components/articles/ArticlesList.tsx` — toolbar sidebar icon
- `frontend/components/articles/ArticleForm.tsx` — `onDirtyChange`,
  `onArticleCreated`, and the header retired in `variant="panel"` (actions row
  only; `variant="page"` unchanged)
- `frontend/hooks/use-mobile.tsx` — export the `lg` media-query helper
- `frontend/lib/copy/articles.ts` — new strings

---

## Amendment A (2026-09-09) — panel density and orientation

Verified in the browser after the original nine tasks shipped, at a 1600px
viewport with the panel open on Details:

| Region | Width |
| --- | --- |
| table | 725 px |
| panel | 594 px |
| ↳ `ArticleFormSteps` rail | **224 px (38% of the panel)** |
| ↳ fields column | 370 px |

The rail costs more than a third of the panel, and the fields column holds
two-across author rows. At 1280px the panel is ~470px and the fields column
falls to ~250px. §6's accepted "two stacked header rows" was the wrong thing
to worry about; the rail is what hurts.

Reference: Zotero, which puts its section switcher in a narrow icon strip and
flips the split to horizontal (list above, item below) as the window narrows.

### A1 — the section rail is compact by prop, not by viewport

`ArticleFormSteps` already carries a `LucideIcon` per step and already folds
its labels to `sr-only` with a tooltip — but keyed to the **viewport** `lg:`
breakpoint. Inside the panel the viewport is wide while the container is not,
so the full-width rail renders anyway.

Change: `ArticleFormSteps` takes `compact?: boolean`. When set, it renders the
icon-only column unconditionally — vertical, labels `sr-only` (never `hidden`,
which would strip the accessible name), tooltip always available.
`ArticleForm` passes `compact={isPanel}`. `variant="page"` is unchanged.

Expected: the fields column goes from ~370px to ~555px at 1600px, a ~50% gain,
with no change to the form's contents.

### A2 — the split flips to vertical instead of falling back to an overlay

The below-`lg` overlay `Sheet` in `ArticlesSplitShell` is **removed**. Below
1024px the same `ResizablePanelGroup` renders `orientation="vertical"`: the
table on top, the panel underneath. The table therefore stays visible at every
width, which was the point of docking the panel in the first place.

`useIsBelowDesktop` is unchanged and now selects orientation rather than a
layout. The 1024px threshold stays: with A1's icon rail, side-by-side remains
comfortable down to it. Tunable in design review.

This supersedes §5's "Below `lg` the shell renders the existing overlay
`Sheet`" and the Sheet half of §7's layout notes. Spec §10's non-goals are
otherwise unaffected.
