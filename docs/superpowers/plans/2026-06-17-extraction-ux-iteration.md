---
status: draft
last_reviewed: 2026-06-17
owner: '@raphaelfh'
---

# Extraction Views — UX/UI Iteration Plan

> **For agentic workers:** implement task-by-task with
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
> Verify UI changes with `/design-review <route>` (desktop + mobile, light +
> dark). All user-facing strings via `frontend/lib/copy/` (English only) — no
> hardcoded JSX text or aria-labels.

**Goal:** Close the paper-cuts across the four extraction surfaces (article
list, HITL workspace, dashboard, configuration) found by a multi-agent UX
evaluation driven against the running app on 2026-06-17. Findings fall into
three buckets: **hard-rule violations** (Portuguese / hardcoded copy),
**accessibility gaps**, and **design-system drift** (low-density dashboard,
floating actions, header/icon token inconsistency).

**Provenance legend:** 🤖 found by the eval workflow and line-verified in
source · 👁 observed live in the running app · ✅ already shipped.

## Iteration 0 — shipped in [#311](https://github.com/raphaelfh/prumo/pull/311)

- ✅ **Stuck AI-accept spinner** — `FieldInput` memo comparator now tracks the
  `isActionLoading` signal; pinned by `FieldInput.memo.test.tsx`.
- ✅ "Importar Template" PT → copy key (`TemplateConfigEditor.tsx:154,331`).
- ✅ "Templates Globais" PT title + desc → copy keys (`TemplateManager.tsx:182,185`).
- ✅ "Unidade:" PT label → `fieldUnitLabel` (`FieldsManagerWithDragDrop.tsx:165`).
- ✅ Article-select checkbox aria-label (desktop) → `tableSelectArticleAria`
  (`ArticleExtractionTable.tsx:992`).
- ✅ Removed invalid `role="banner"` nested in `role="main"` (`FieldsHeader.tsx:40`).
- ✅ `aria-hidden` on the 3 decorative dashboard stat icons
  (`ExtractionInterface.tsx:175,187,206`).

## Iteration 1 — P0 / remaining hard-rule violations (all S)

- [ ] 👁 **Second checkbox aria-label still hardcoded (mobile card variant)** —
  `ArticleExtractionTable.tsx:1121` renders ``aria-label={`Select: ${article.title}`}``.
  The desktop variant was fixed in #311 but this one was missed. Reuse the same
  key: `aria-label={t('extraction','tableSelectArticleAria').replace('{{title}}', article.title)}`.

## Iteration 2 — P1 / high-impact polish

### Task 2.1 — Realign the Export button into the list toolbar row (👁, this turn's request)

**Problem.** Export renders as a lone button in its own band above the table
(`ExtractionInterface.tsx:254-266`), leaving an empty strip below the tabs —
while the toolbar one component down (`ArticleExtractionTable.tsx`) already holds
search + filter + the **Display options** control (`ListDisplaySortPopover`, the
sliders button the user selected). Two action bands where one dense row would do.

**Decision (2026-06-17): Option A — icon-only.** Add an optional
`toolbarActions?: React.ReactNode` slot to `ArticleExtractionTable`, rendered in
the toolbar row right after `ListDisplaySortPopover` (before the `ml-auto` count
group). Pass Export down through that slot as an `h-8 w-8` ghost `Download` icon
button so it pixel-matches the Display options (sliders) button. It MUST carry an
`aria-label={t('extraction','exportButton')}` + tooltip (icon-only → the label
moves into the accessible name, per the cross-cutting a11y rule). Delete the
floating band wrapper in `ExtractionInterface`; keep
`data-testid="extraction-export-button"` (update any test asserting its position).
Trade-off accepted: no visible "Export" word — tooltip + aria-label carry meaning.

Not chosen: B (labeled button, keeps the word) · C (overflow `…` menu).

Verify with `/design-review` on the list (light + dark, desktop + the mobile card
layout, since the toolbar uses `flex-wrap`).

### Task 2.2 — Enforce completeness as a finalize requirement (investigated 2026-06-17)

**Decision: BLOCK — all required fields must be filled before a run can finalize.**
This is stricter than the current design spec (consensus-only, no completeness), so
the ADR below **gates the work: land it before the code sub-tasks.**

Current state — the three gates disagree (verified 2026-06-17):

| Layer | Today | Where |
|---|---|---|
| Header button | ✅ already blocks at <100% (`isComplete`) — the canonical rule | `HeaderFinalizeButton.tsx:34`, `ExtractionFullScreen.tsx:701` |
| ConsensusPanel card | ❌ offers finalize on no-divergence alone (always true for 1 reviewer), then **silently swallows** the backend rejection | `ConsensusPanel.tsx:327-348`, `ExtractionFullScreen.tsx:259` |
| Backend | ❌ blocks only when `consensus_count == 0`; allows empty required fields | `run_lifecycle_service.py:172-190` |

Sub-tasks:

- [ ] **Spec/ADR (gate — do first).** Record the completeness-requirement change in
  a new `docs/adr/` entry before landing the code below; do not silently edit the
  immutable design spec. (S)
- [ ] **Backend (authoritative gate).** Add a required-fields-filled check to the
  `advance_stage → finalized` precondition (`IncompleteFinalizeError`). Completeness
  lives only in the frontend today (`frontend/lib/extraction/progress.ts`); the
  backend needs an equivalent check against published/consensus values. (M–L)
- [ ] **ConsensusPanel card.** Gate the fast-path on completeness + ≥1 decision,
  surface the backend error instead of the silent no-op, fix the misleading "agreed
  on every field" copy, and route the hardcoded strings through `frontend/lib/copy/`. (M)
- [ ] **`useAdvanceRun`.** Add an `onError` toast so finalize rejections always
  surface (currently silent). (S)

### Other P1 items

- [ ] 👁 **Mobile workspace header overlap** — the "1 / 20" pager collides with the
  truncated title. Give the title `min-w-0 truncate` and the pager a `shrink-0`
  column; space at `sm`. `header/HeaderNavigation.tsx` / `ExtractionFullScreen.tsx`. (S–M)
- [ ] 👁 **Workspace toolbar icons unlabeled** — eye / reviewers / AI toggle have no
  accessible name; add `aria-label` + tooltip to each. `header/*`. (S)
- [ ] 👁 **Export summary renders a broken dash** — "Will export 20 articles
  × — fields" prints a dangling placeholder when the field count is unknown.
  Compute the count or reword. `ExtractionExportDialog.tsx`. (S)
- [ ] 🤖 **Role badges hardcode emoji+English as accessible text** — `'👑 Manager'`
  etc. are hardcoded and the emoji leaks into the aria-label
  (`FieldsHeader.tsx:31,33,35,47`). Reuse `roleManager/roleReviewer/roleViewer`
  (`common.ts:64,66,67`); move the emoji into an `aria-hidden` span; map roles
  explicitly. (S–M)
- [ ] 🤖 **Desktop rows look clickable but aren't keyboard-operable** — the card
  variant opens on row-click, the table doesn't. **Recommendation:** promote the
  row to a real control (`role="button"`, `tabIndex={0}`, Enter/Space,
  `focus-visible:ring`) for parity, not drop the hover. `ArticleExtractionTable.tsx:986`. (M)
- [ ] 🤖👁 **Dashboard is 3 oversized single-number cards** — **Decided scope:**
  collapse to a dense stat strip + a completeness distribution bar (0% / 1–99% /
  100%) from the per-article `pct` already computed in `extractionStats`; new
  labels via `t()`. Status-breakdown / reviewer widgets are out of scope (data is
  reviewer-scoped). `ExtractionInterface.tsx:169-213`. (L)

## Iteration 3 — P2 / P3 refinement

- [ ] 🤖 **Config surface uses heavy stacked Cards** — replace the header Card with a
  thin `h-12` command bar; tighten `AccordionTrigger px-6 py-4 → py-2 text-[13px]`;
  swap the full-width "Add section" Card for a ghost row.
  `TemplateConfigEditor.tsx:133-162,347-361`. (P2, L)
- [ ] 👁 **Field label/input two-column doesn't stack on mobile** — heavy truncation
  ("Select…", "Retrospecti…"); add `flex-col sm:flex-row` / responsive grid.
  `FieldInput.tsx`. (P2, S–M)
- [ ] 👁 **List status column is a bare circle with no legend** — add a tooltip or a
  small legend mapping circle states to status. `ArticleExtractionTable.tsx`. (P2, S)
- [ ] 🤖 **ExtractionHeader token drift** — `backdrop-blur-sm → backdrop-blur-md`,
  drop `shadow-sm` (canonical headers carry no shadow). `ExtractionHeader.tsx:122`. (P2, S)
- [ ] 🤖 **Article prev/next chevrons sub-32px** — `h-7 w-7 → h-8 w-8`.
  `HeaderNavigation.tsx:117,140`. (P2, S)
- [ ] 🤖 **Portuguese code comments/JSDoc + `colaboracao/` folder name** — one
  translation pass over `frontend/components/extraction/**` (code hygiene, no UX
  surface). (P2, S)
- [ ] 🤖 **Mixed icon sizes vs DS** — drop redundant `h-3.5 w-3.5` inside `<Button>`
  (overridden by `[&_svg]:size-4`); standardize to `h-4 w-4 strokeWidth 1.5`; keep
  `h-3 w-3` only for badge dots. `ArticleExtractionTable.tsx`, `button.tsx`. (P3, M)
- [ ] 🤖 **"{n} sections" pluralization** — `14 sections (8 main)` always plural;
  pluralize via copy. `TemplateConfigEditor.tsx`. (P3, S)

## Cross-cutting themes

1. **Copy discipline breaks at the margins.** Components route ~90% of strings
   through `t()` then hardcode one or two outliers, several Portuguese. *Principle:*
   zero inline user-facing strings (incl. aria-labels and emoji). Consider a
   grep/lint gate for literal JSX text in `components/extraction/**`.
2. **Decorative glyphs as accessible text.** *Principle:* decorative icons get
   `aria-hidden`; meaning lives in text, never the glyph.
3. **Affordance honesty.** *Principle:* if it looks clickable it must be operable
   by mouse *and* keyboard with a focus ring; parallel variants (table vs card)
   behave identically.
4. **Density & action placement.** *Principle:* one number per card is a smell;
   prefer dense strips + small visualizations, and keep actions in the toolbar row
   rather than floating bands (see Task 2.1).
5. **Token consistency.** *Principle:* single source for header tokens
   (`backdrop-blur-md`, no shadow) and icon sizing (`h-4 w-4 strokeWidth 1.5`,
   `h-8 w-8` icon buttons).

## Open question (separate from UX)

- 🔎 **Does the AI-accept actually persist on a REVIEW-stage run?** During the
  spinner debug the accept produced no persistence write (only
  `POST /api/v1/hitl/sessions`) — it took the `human-proposal` strategy branch.
  Worth verifying whether the decision survives a reload; out of scope for this
  UX plan.
