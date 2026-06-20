---
status: proposed
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

> **Status:** Proposed — design approved in brainstorm 2026-06-20, not yet
> planned/implemented. Next step: `superpowers:writing-plans` to produce a
> task-level implementation plan.

# Design: Table-view UX consolidation (status ring, static toolbar, top-bar view-switcher, selection cleanup)

**Date:** 2026-06-20
**Branch:** `claude/gallant-goodall-5e9fa9`
**Related:** [`2026-06-19-extraction-view-ux-design.md`](./2026-06-19-extraction-view-ux-design.md)
(P0 nav-rail / dense-rows redesign — complementary; this spec is a different
slice and does not supersede it). Shared list primitives live under
`frontend/components/shared/list/`. The shared `RunHeader` lib shipped in #338.

## 1. Context & problem

The extraction worklist (`ArticleExtractionTable`) is the primary table in the
app. Reviewing it surfaced four issues, each of which also exists in the sibling
tables (`HITLArticleTable` for QA, `ArticlesList` for the article browser):

1. **Redundant PROGRESS vs STATUS columns.** The STATUS badge already encodes
   the percentage for in-progress rows — `getStatusBadge()`
   (`ArticleExtractionTable.tsx:547`) renders the orange pill with
   `{roundedProgress}%` inside it, while the separate PROGRESS column
   (`:948`/`:1093`) renders a bar + the same number. The number is shown twice.
2. **The toolbar scrolls away.** The search / filter / display / export / count
   row lives inside the scrolling content container (`ArticleExtractionTable.tsx:755`),
   so it disappears on scroll. Only the page's description+tabs band is pinned
   (`ProjectView.tsx:286`). No table has a pinned column header (`thead`) either.
3. **The description+tabs band wastes vertical space.** `ProjectView` spends a
   full row on a low-value description string (`TAB_DESCRIPTIONS`,
   `ProjectView.tsx:30`) plus the section's view tabs (`:294-348`). The global
   top-bar (`Topbar.tsx:124`) already shows the section title and has an **empty
   center**.
4. **The selection state triples up.** When rows are selected the toolbar shows
   `"19 of 19 articles"` (ListCount) **and** `"19 articles selected"` **and** a
   `"Clear selection"` button **and** Actions, simultaneously
   (`ArticleExtractionTable.tsx:798-837`). `ArticlesList` has the same pattern
   (`ArticlesList.tsx:1237-1245`).

### Duplication worth removing

`getStatusBadge()` (`ArticleExtractionTable.tsx:547`) and `renderStatus()`
(`HITLArticleTable.tsx:363`) are twin implementations of the same status glyph.
The progress-bar cell is likewise duplicated. This is the one place where
extracting a shared component is clearly justified.

## 2. Goals & non-goals

**Goals**

- Remove the PROGRESS/STATUS redundancy with a single, premium status glyph.
- Make the toolbar static and the column header pinned, so both stay visible
  while rows scroll.
- Reclaim the vertical band by moving each section's view tabs into the (empty)
  center of the global top-bar, and demoting the description to a tooltip.
- Collapse the selection state to one compact, non-duplicated indicator.
- Propagate the above across the three tables, **reusing shared components only
  where duplication is real** — not a wholesale table rewrite.

**Non-goals**

- No rewrite of the column model. The existing resizable-column infrastructure
  (`useResizableTableColumns`, persisted widths, breakpoint visibility) is kept
  verbatim. Changes to columns are limited to deleting the PROGRESS column and
  swapping the STATUS cell renderer.
- No new generic toolbar abstraction (`ListToolbar` wrapper) and no rewrite of
  `DataTableWrapper`. Static-toolbar behaviour is achieved by layout, in place.
- No change to URL parameter **values** or existing `data-testid`s (deep links
  and E2E must keep working).
- No broader app-schema / data-path work (out of scope; tracked elsewhere).

## 3. Decisions (resolved in brainstorm)

| # | Decision |
|---|----------|
| D1 | STATUS cell becomes a **progress ring**: grey track always; warning-coloured arc + centered `%` for in-progress; full success ring + `✓` for complete; empty grey ring for not-started. Hover tooltip carries the full label. PROGRESS column is deleted. |
| D2 | Toolbar is made **static by layout** (it sits outside the scroll viewport — only the rows scroll), not by `position: sticky`. The `thead` stays pinned via `sticky top:0` **inside** the table's dedicated scroll container (the standard, bleed-free contained pattern). |
| D3 | Section view tabs move to the **center of the global top-bar** as a centered segmented control (`grid 1fr auto 1fr`). The description moves to an `(i)` tooltip on the section title. The first extraction sub-tab is **relabelled "Worklist"** (the section is already "Extraction", so "Extraction › Extraction" was redundant). URL param values are unchanged — only the visible label changes. |
| D4 | Selection state collapses to one compact indicator: idle shows the existing `"N of M articles"` count; with a selection it shows `"N selected"` + Actions, and **drops** both the duplicated spelled-out count and the **"Clear selection"** button. The header master checkbox (indeterminate / checked) is the clear affordance. |
| A1 | Approach is **surgical + shared-where-duplicated**, not shared-first rewrite. The only new shared UI component is `StatusRing`. Everything else is targeted edits to each table and to the top-bar. |

## 4. Detailed design

### 4.1 `StatusRing` (new shared component)

`frontend/components/shared/list/StatusRing.tsx` — a pure presentational
component (no IO, React-Compiler safe).

- **Input:** the row's progress number plus whether it has any extraction
  instances (so "not started" vs "0% in progress" can differ if needed). The
  status is derived: `>=100 → complete`, `>0 → in_progress`, else `not_started`.
- **Render:** a ~28px SVG donut. Grey track ring always present; a coloured arc
  (`--color-text-warning`) drawn via `stroke-dasharray`/`-dashoffset` for
  in-progress; `--color-text-success` full ring + `✓` for complete; bare grey
  ring for not-started. Centered number uses `tabular-nums`.
- **Accessibility:** wrap in the existing tooltip primitive; `aria-label` and
  tooltip text come from copy keys (`"Not started"`, `"In progress · {n}%"`,
  `"Complete"`). The ring SVG is `aria-hidden`; the label is the accessible name.
- **Replaces:** `getStatusBadge()` (`ArticleExtractionTable.tsx:547-611`) and
  `renderStatus()` (`HITLArticleTable.tsx:363-428`). Both call sites import
  `StatusRing` instead. The card/`ResponsiveList` variant uses it too.

### 4.2 Column changes (surgical, per table)

`ArticleExtractionTable.tsx`:

- Remove `progress` from the column-width definition list (`:145-154`) and its
  storage migration is unnecessary (extra persisted keys are ignored).
- Delete the PROGRESS header (`:948-964`) and its cell body (`:1093-1107`).
- The STATUS cell (`:1109`) renders `<StatusRing …/>`.
- Merge the two now-equivalent sort options (`extraction_progress` + `status`,
  `:782-783`) into a single "Status" sort.

`HITLArticleTable.tsx`: same removal of the PROGRESS column (`:567-572`,
`:614-630`) and STATUS cell → `StatusRing` (`:574-579`).

All other columns (Title, Authors, Year, Actions) and the resizable-column
hookup are untouched.

### 4.3 Static toolbar + pinned header (layout)

Today the scroll lives on `<main className="flex-1 overflow-y-auto">`
(`AppLayout.tsx:73`), so everything inside scrolls. The change, **scoped to the
extraction and QA interfaces**:

- The table's content region becomes a flex column: a non-scrolling toolbar
  block (search / filter / display / export / count + `ActiveFilterChips`) on
  top, and a scroll container holding the table below (`overflow-y-auto` on the
  inner container; the outer region is `overflow-hidden`).
- Inside that inner scroll container, the table `thead` uses `position: sticky;
  top: 0` so the column header stays put while the rows scroll. Because the
  scroll context is the dedicated table container (not the page), there is no
  z-index / background bleed against the global top-bar.
- This is implemented in place in `ExtractionInterface.tsx` / the QA interface +
  `ArticleExtractionTable.tsx` / `HITLArticleTable.tsx`. `ArticlesList` gets the
  same treatment. Sections that still rely on `<main>` scrolling are left alone.

### 4.4 Top-bar view-switcher (D3)

New `frontend/components/navigation/SectionViewSwitcher.tsx` and a config
`frontend/components/layout/sectionViews.ts`:

```
sectionViews = {
  extraction: [
    { value: 'extraction',    labelKey: 'tabWorklist',      urlParam: 'extractionTab' },
    { value: 'dashboard',     labelKey: 'tabDashboard',     urlParam: 'extractionTab' },
    { value: 'configuration', labelKey: 'tabConfiguration', urlParam: 'extractionTab', managerOnly: true },
  ],
  quality: [
    { value: 'assessment',    labelKey: 'tabAssessment',     urlParam: 'qaTab' },
    { value: 'dashboard',     labelKey: 'tabDashboard',      urlParam: 'qaTab' },
    { value: 'configuration', labelKey: 'tabConfiguration',  urlParam: 'qaTab', managerOnly: true },
  ],
}
```

- `SectionViewSwitcher` reads the active section from `ProjectContext.activeTab`,
  the current sub-tab from `useSearchParams`, and the manager role from
  `useProjectMemberRole`; it renders a centered segmented control and writes the
  `urlParam` on click (`replace: true`, mirroring today's `setExtractionTab`).
- It preserves the existing `data-testid` convention
  (`hitl-quality_assessment-tab-${value}`) so QA E2E keeps passing.
- `Topbar.tsx` left section keeps the section title and gains an `(i)` icon whose
  tooltip is the section description (moved out of `TAB_DESCRIPTIONS`). Layout
  becomes `grid-template-columns: 1fr auto 1fr`: title left, switcher center,
  notifications/feedback right. The center renders nothing for sections without
  views (Articles, Settings, Overview, …).
- `ProjectView.tsx` drops the description+tabs band for extraction/quality
  (`:286-348`) but keeps it for Articles (which holds the import/add actions).
  It still reads `currentExtractionTab` / `currentQaTab` to pick which view to
  render.

### 4.5 Selection cleanup (D4)

In `ArticleExtractionTable.tsx` (`:798-839`) and `ArticlesList.tsx`
(`:1237-1245`):

- When `selectedCount === 0`: render the existing `ListCount` (`"N of M
  articles"`) only.
- When `selectedCount > 0`: render a single compact `"N selected"` label +
  Actions; **remove** the duplicated idle count and the **"Clear selection"**
  button.
- The header master checkbox already exists and reflects all / none /
  indeterminate; clicking it when all-selected clears the selection. Ensure its
  `aria` state (`aria-checked="mixed"` for indeterminate) is correct.
- `HITLArticleTable` has no multi-select; unaffected.

## 5. Copy changes (English only, via `frontend/lib/copy/`)

- `extraction.ts`: add `tabWorklist` ("Worklist"); add StatusRing labels
  (`statusNotStarted`, `statusInProgress` = `"In progress · {{n}}%"`,
  `statusComplete`); add a compact `tableSelectedCount` = `"{{n}} selected"`;
  stop rendering `tableClearSelection` (key removed once unreferenced).
- `qa.ts`: tab labels unchanged (Assessment/Dashboard/Configuration). The
  `StatusRing` reads its labels from the `extraction` copy namespace, so no new
  status keys are added here.
- `articles.ts`: add the same compact `listSelectedCount` = `"{{n}} selected"`
  and stop rendering the clear-selection control.
- `navigation.ts`: section description keys for the top-bar `(i)` tooltip
  (migrated from `TAB_DESCRIPTIONS`).

## 6. Testing (interleaved per layer, not batched)

**Vitest (unit / component)**

- `StatusRing`: renders all three states; correct `aria-label`/tooltip text;
  arc geometry for a mid value; centered number rounds.
- `SectionViewSwitcher`: renders the right views per section config; hides
  `configuration` for non-managers; writes the correct `urlParam` on click;
  reflects the active value from the URL; preserves the QA `data-testid`s.
- Selection: with a selection, the compact `"N selected"` shows and the
  duplicated count + "Clear selection" are absent; master-checkbox toggle
  clears.
- Update existing tests referencing the removed PROGRESS column, the
  "Clear selection" control, or the old in-`ProjectView` tab location.

**Playwright (E2E)**

- Switch views from the top-bar switcher (extraction + QA); URL param updates;
  deep-link with the param selects the right view.
- Scroll a long list: toolbar stays visible, `thead` stays visible, rows scroll.
- Select-all then clear via the master checkbox.

**Visual** — run the `design-review` loop on the extraction route after
implementation (render → screenshot → compare to the Plane/Linear target → fix).

## 7. Risks & edge cases

- **Scroll relocation.** Moving `overflow` off `<main>` and onto the table
  region must be scoped to extraction/quality so other sections' scrolling is
  not broken. Verify dashboards and Articles still scroll.
- **Top-bar dependencies.** `SectionViewSwitcher` depends on `ProjectContext`,
  `useSearchParams`, and the role hook; it must no-op safely off project pages
  and for sections without views (empty center).
- **URL / test-id stability.** Param values and `data-testid`s are preserved;
  only labels change.
- **React Compiler.** All new components are pure; no `try/finally` in
  component/hook bodies (`panicThreshold: 'all_errors'`).
- **Card mode.** `ResponsiveList`'s card variant (narrow viewports) also shows
  progress/status — switch it to `StatusRing`, and confirm the static-toolbar
  layout holds on mobile.
- **Ring legibility.** The centered number must stay legible at the table's row
  height; the tooltip always carries the exact value as a fallback.

## 8. Rollout

Single branch, conventional commits, PR → `dev`, squash-merge. Implementation
order (each with its tests): (1) `StatusRing` + wire both tables and drop the
PROGRESS column; (2) static-toolbar + pinned-`thead` layout; (3) top-bar
`SectionViewSwitcher` + `sectionViews` config + `ProjectView`/`Topbar` edits +
copy; (4) selection cleanup. Prod deploy follows the usual dev→main promotion
(Railway deploys from main; frontend on Vercel).
